from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import requests
import os
import json
import hashlib
import re
import time
import threading
from datetime import datetime, timedelta
from config import DEEPSEEK_API_KEY, DEEPSEEK_API_URL, AVAILABLE_MODELS, PERSONALITY_TEMPLATES

app = Flask(__name__)
CORS(app)

# ========== 数据持久化系统 ==========
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

# 数据版本号（更新时递增，用于数据迁移）
DATA_VERSION = 2

# ========== 内存缓存 ==========
chat_history = {}       # session_id -> [messages]
user_settings = {}      # session_id -> settings dict
user_memories = {}      # session_id -> {facts: [], preferences: [], events: []}
emotion_logs = {}       # session_id -> [{emotion, timestamp, message}]


def get_session_filepath(session_id):
    """获取 session 数据文件路径"""
    safe_name = hashlib.md5(session_id.encode()).hexdigest()[:12]
    return os.path.join(DATA_DIR, f'session_{safe_name}.json')


def save_session_data(session_id):
    """将一个 session 的所有数据持久化到文件"""
    try:
        filepath = get_session_filepath(session_id)
        data = {
            'version': DATA_VERSION,
            'session_id': session_id,
            'updated_at': datetime.now().isoformat(),
            'chat_history': chat_history.get(session_id, []),
            'settings': user_settings.get(session_id, {}),
            'memories': user_memories.get(session_id, {'facts': [], 'preferences': [], 'events': [], 'emotions': []}),
            'emotion_logs': emotion_logs.get(session_id, [])
        }
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f'[Data] 保存 session {session_id} 失败: {e}')


def load_session_data(session_id):
    """从文件加载一个 session 的所有数据"""
    try:
        filepath = get_session_filepath(session_id)
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 版本迁移
            data = migrate_data(data)
            
            # 恢复到内存
            chat_history[session_id] = data.get('chat_history', [])
            user_settings[session_id] = data.get('settings', {})
            user_memories[session_id] = data.get('memories', {'facts': [], 'preferences': [], 'events': [], 'emotions': []})
            emotion_logs[session_id] = data.get('emotion_logs', [])
            
            return True
    except Exception as e:
        print(f'[Data] 加载 session {session_id} 失败: {e}')
    return False


def migrate_data(data):
    """数据版本迁移：兼容旧版本数据"""
    version = data.get('version', 1)
    
    if version < 2:
        # v1 -> v2: 确保 memories 有 emotions 分类
        memories = data.get('memories', {})
        if 'emotions' not in memories:
            memories['emotions'] = []
        data['memories'] = memories
    
    data['version'] = DATA_VERSION
    return data


def save_all_data():
    """保存所有 session 数据（关闭时调用）"""
    all_sessions = set(chat_history.keys()) | set(user_settings.keys()) | set(user_memories.keys()) | set(emotion_logs.keys())
    for sid in all_sessions:
        save_session_data(sid)
    print(f'[Data] 已保存 {len(all_sessions)} 个 session 的数据')


def load_all_data():
    """启动时加载所有 session 数据"""
    if not os.path.exists(DATA_DIR):
        return
    
    count = 0
    for filename in os.listdir(DATA_DIR):
        if filename.startswith('session_') and filename.endswith('.json'):
            try:
                filepath = os.path.join(DATA_DIR, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                session_id = data.get('session_id', '')
                if not session_id:
                    continue
                
                data = migrate_data(data)
                chat_history[session_id] = data.get('chat_history', [])
                user_settings[session_id] = data.get('settings', {})
                user_memories[session_id] = data.get('memories', {'facts': [], 'preferences': [], 'events': [], 'emotions': []})
                emotion_logs[session_id] = data.get('emotion_logs', [])
                count += 1
            except Exception as e:
                print(f'[Data] 加载文件 {filename} 失败: {e}')
    
    # 兼容旧的 memories 目录
    old_memory_dir = os.path.join(DATA_DIR, 'memories')
    if os.path.exists(old_memory_dir):
        for filename in os.listdir(old_memory_dir):
            if filename.endswith('.json'):
                try:
                    filepath = os.path.join(old_memory_dir, filename)
                    with open(filepath, 'r', encoding='utf-8') as f:
                        old_data = json.load(f)
                    # session_id 就是文件名（去掉.json）
                    sid = filename[:-5]
                    if sid not in user_memories or not user_memories[sid].get('facts'):
                        if 'emotions' not in old_data:
                            old_data['emotions'] = []
                        user_memories[sid] = old_data
                        save_session_data(sid)
                except:
                    pass
    
    print(f'[Data] 已加载 {count} 个 session 的数据')


# ========== 兼容旧的记忆文件接口 ==========
MEMORY_DIR = os.path.join(DATA_DIR, 'memories')
os.makedirs(MEMORY_DIR, exist_ok=True)

def save_memory_to_file(session_id):
    """持久化记忆到文件（兼容旧接口）"""
    save_session_data(session_id)

def load_memory_from_file(session_id):
    """从文件加载记忆（兼容旧接口）"""
    if session_id not in user_memories:
        load_session_data(session_id)
    return user_memories.get(session_id, {'facts': [], 'preferences': [], 'events': [], 'emotions': []})


# ========== 启动时自动加载数据 ==========
load_all_data()


# ========== 页面路由 ==========
@app.route('/')
def index():
    return render_template('index.html')


# ========== API：模型和性格 ==========
@app.route('/api/models', methods=['GET'])
def get_models():
    return jsonify({'models': AVAILABLE_MODELS})

@app.route('/api/personalities', methods=['GET'])
def get_personalities():
    return jsonify({'personalities': PERSONALITY_TEMPLATES})


# ========== API：设置管理 ==========
@app.route('/api/settings', methods=['POST'])
def save_settings():
    try:
        data = request.json
        session_id = data.get('session_id', 'default')

        user_settings[session_id] = {
            'api_key': data.get('apiKey', ''),
            'model': data.get('model', 'deepseek-v4-flash'),
            'personality_id': data.get('personality_id', 'default'),
            'custom_prompt': data.get('custom_prompt', ''),
            'tone': data.get('tone', 'gentle'),
            'response_length': data.get('responseLength', 'medium'),
            'use_emojis': data.get('useEmojis', True),
            # 新增：角色自定义
            'ai_name': data.get('ai_name', '小星'),
            'ai_gender': data.get('ai_gender', 'female'),
            'ai_avatar': data.get('ai_avatar', '🌟'),
            'ai_avatar_type': data.get('ai_avatar_type', 'emoji'),
            'relationship': data.get('relationship', 'friend'),
            'user_name': data.get('user_name', ''),
            'chat_background': data.get('chat_background', 'default'),
            'chat_background_style': data.get('chat_background_style', ''),
            'chat_background_image': data.get('chat_background_image', ''),
            'user_avatar': data.get('user_avatar', '😊'),
            'user_avatar_type': data.get('user_avatar_type', 'emoji'),
        }

        save_session_data(session_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/<session_id>', methods=['GET'])
def get_settings(session_id):
    # 如果内存中没有，尝试从文件加载
    if session_id not in user_settings:
        load_session_data(session_id)
    
    settings = user_settings.get(session_id, {
        'api_key': '',
        'model': 'deepseek-v4-flash',
        'personality_id': 'default',
        'custom_prompt': '',
        'tone': 'gentle',
        'response_length': 'medium',
        'use_emojis': True,
        'ai_name': '小星',
        'ai_gender': 'female',
        'ai_avatar': '🌟',
        'ai_avatar_type': 'emoji',
        'relationship': 'friend',
        'user_name': '',
        'user_avatar': '😊',
        'user_avatar_type': 'emoji',
        'chat_background': 'default',
    })
    return jsonify(settings)


# ========== API：对话记忆系统 ==========
@app.route('/api/memory/<session_id>', methods=['GET'])
def get_memory(session_id):
    if session_id not in user_memories:
        user_memories[session_id] = load_memory_from_file(session_id)
    return jsonify(user_memories.get(session_id, {'facts': [], 'preferences': [], 'events': []}))

@app.route('/api/memory/<session_id>', methods=['POST'])
def update_memory(session_id):
    try:
        data = request.json
        if session_id not in user_memories:
            user_memories[session_id] = load_memory_from_file(session_id)

        memory = user_memories[session_id]
        action = data.get('action', 'add')

        if action == 'add_fact':
            fact = data.get('content', '')
            if fact and fact not in memory.get('facts', []):
                memory.setdefault('facts', []).append(fact)
                if len(memory['facts']) > 50:
                    memory['facts'] = memory['facts'][-50:]
        elif action == 'add_preference':
            pref = data.get('content', '')
            if pref and pref not in memory.get('preferences', []):
                memory.setdefault('preferences', []).append(pref)
                if len(memory['preferences']) > 30:
                    memory['preferences'] = memory['preferences'][-30:]
        elif action == 'add_event':
            event = data.get('content', '')
            if event:
                memory.setdefault('events', []).append({
                    'content': event,
                    'date': datetime.now().strftime('%Y-%m-%d')
                })
                if len(memory['events']) > 20:
                    memory['events'] = memory['events'][-20:]
        elif action == 'delete':
            category = data.get('category', 'facts')
            index = data.get('index', -1)
            if category in memory and 0 <= index < len(memory[category]):
                memory[category].pop(index)
        elif action == 'clear_all':
            # 清空所有记忆
            user_memories[session_id] = {'facts': [], 'preferences': [], 'events': [], 'emotions': []}
            memory = user_memories[session_id]
        elif action == 'add':
            # 通用添加（支持所有分类）
            category = data.get('category', 'facts')
            content = data.get('content', '')
            if content:
                memory.setdefault(category, []).append({
                    'content': content,
                    'timestamp': datetime.now().isoformat(),
                    'source': 'manual'
                })
                # 限制数量
                if len(memory[category]) > 50:
                    memory[category] = memory[category][-50:]

        save_memory_to_file(session_id)
        return jsonify({'success': True, 'memory': memory})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== API：情绪感知 ==========
@app.route('/api/emotion/<session_id>', methods=['POST'])
def log_emotion(session_id):
    try:
        data = request.json
        if session_id not in emotion_logs:
            emotion_logs[session_id] = []

        emotion_logs[session_id].append({
            'emotion': data.get('emotion', 'neutral'),
            'confidence': data.get('confidence', 0.5),
            'message': data.get('message', ''),
            'timestamp': datetime.now().isoformat()
        })

        # 保留最近100条情绪记录
        if len(emotion_logs[session_id]) > 100:
            emotion_logs[session_id] = emotion_logs[session_id][-100:]

        save_session_data(session_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/emotion/<session_id>', methods=['GET'])
def get_emotions(session_id):
    logs = emotion_logs.get(session_id, [])
    # 返回最近7天的情绪趋势
    return jsonify({'emotions': logs[-50:]})


# ========== API：会话列表管理 ==========
@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """获取所有会话列表"""
    try:
        sessions = []
        all_session_ids = set(chat_history.keys()) | set(user_settings.keys()) | set(user_memories.keys())
        
        for sid in all_session_ids:
            settings = user_settings.get(sid, {})
            history = chat_history.get(sid, [])
            
            sessions.append({
                'id': sid,
                'name': settings.get('ai_name', 'AI 助手'),
                'avatar': settings.get('ai_avatar', '🌟'),
                'avatar_type': settings.get('ai_avatar_type', 'emoji'),
                'relationship': settings.get('relationship', 'friend'),
                'message_count': len(history),
                'last_message': history[-1]['content'][:50] + '...' if history else '',
                'updated_at': history[-1]['timestamp'] if history else datetime.now().isoformat()
            })
        
        # 按最后消息时间排序
        sessions.sort(key=lambda x: x['updated_at'], reverse=True)
        return jsonify({'sessions': sessions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions', methods=['POST'])
def create_session():
    """创建新会话"""
    try:
        data = request.json
        new_session_id = f"session_{int(time.time() * 1000)}"
        
        # 初始化新会话的默认设置
        user_settings[new_session_id] = {
            'api_key': data.get('api_key', ''),
            'model': 'deepseek-v4-flash',
            'ai_name': data.get('ai_name', '新助手'),
            'ai_avatar': data.get('ai_avatar', '🌟'),
            'ai_avatar_type': 'emoji',
            'ai_gender': 'female',
            'relationship': 'friend',
            'user_name': '',
            'user_avatar': '😊',
            'user_avatar_type': 'emoji',
            'personality_id': 'default',
            'tone': 'gentle',
            'response_length': 'medium',
            'use_emojis': True,
            'chat_background': 'default',
        }
        
        chat_history[new_session_id] = []
        user_memories[new_session_id] = {'facts': [], 'preferences': [], 'events': [], 'emotions': []}
        emotion_logs[new_session_id] = []
        
        save_session_data(new_session_id)
        
        return jsonify({
            'success': True,
            'session_id': new_session_id,
            'settings': user_settings[new_session_id]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """删除会话"""
    try:
        # 删除内存数据
        chat_history.pop(session_id, None)
        user_settings.pop(session_id, None)
        user_memories.pop(session_id, None)
        emotion_logs.pop(session_id, None)
        
        # 删除文件
        filepath = get_session_filepath(session_id)
        if os.path.exists(filepath):
            os.remove(filepath)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<session_id>/rename', methods=['POST'])
def rename_session(session_id):
    """重命名会话"""
    try:
        data = request.json
        new_name = data.get('name', '')
        
        if session_id in user_settings:
            user_settings[session_id]['ai_name'] = new_name
            save_session_data(session_id)
            return jsonify({'success': True})
        else:
            return jsonify({'error': '会话不存在'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== API：导出聊天数据 ==========
@app.route('/api/export/<session_id>', methods=['GET'])
def export_data(session_id):
    """导出所有用户数据：聊天记录、设置、记忆"""
    try:
        # 获取聊天历史
        history = chat_history.get(session_id, [])
        
        # 获取设置（排除敏感信息）
        settings = user_settings.get(session_id, {})
        safe_settings = {k: v for k, v in settings.items() if k != 'api_key'}
        
        # 获取记忆
        memories = user_memories.get(session_id, {'facts': [], 'preferences': [], 'events': [], 'emotions': []})
        
        # 获取情绪记录
        emotions = emotion_logs.get(session_id, [])
        
        export_data = {
            'version': '1.0',
            'export_time': datetime.now().isoformat(),
            'session_id': session_id,
            'settings': safe_settings,
            'chat_history': history,
            'memories': memories,
            'emotion_logs': emotions[-50:]  # 最近50条情绪记录
        }
        
        return jsonify(export_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== API：导入聊天数据 ==========
@app.route('/api/import/<session_id>', methods=['POST'])
def import_data(session_id):
    """导入用户数据"""
    try:
        data = request.json
        
        # 验证数据格式
        if not data or 'version' not in data:
            return jsonify({'error': '无效的数据格式'}), 400
        
        # 导入设置（保留现有 API Key）
        if 'settings' in data:
            existing_api_key = user_settings.get(session_id, {}).get('api_key', '')
            user_settings[session_id] = data['settings']
            if existing_api_key:
                user_settings[session_id]['api_key'] = existing_api_key
        
        # 导入聊天历史
        if 'chat_history' in data:
            chat_history[session_id] = data['chat_history']
        
        # 导入记忆
        if 'memories' in data:
            user_memories[session_id] = data['memories']
            save_memory_to_file(session_id)
        
        # 导入情绪记录
        if 'emotion_logs' in data:
            emotion_logs[session_id] = data['emotion_logs']
        
        return jsonify({
            'success': True,
            'message': f'成功导入 {len(data.get("chat_history", []))} 条聊天记录'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== API：获取聊天历史 ==========
@app.route('/api/chat/history/<session_id>', methods=['GET'])
def get_chat_history(session_id):
    """获取聊天历史记录"""
    # 如果内存中没有，尝试从文件加载
    if session_id not in chat_history or not chat_history[session_id]:
        load_session_data(session_id)
    
    history = chat_history.get(session_id, [])
    return jsonify({
        'session_id': session_id,
        'history': history,
        'count': len(history)
    })


# ========== API：每日问候 ==========
@app.route('/api/greeting/<session_id>', methods=['GET'])
def get_greeting(session_id):
    try:
        settings = user_settings.get(session_id, {})
        ai_name = settings.get('ai_name', '小星')
        user_name = settings.get('user_name', '')
        relationship = settings.get('relationship', 'friend')

        now = datetime.now()
        hour = now.hour
        date_str = now.strftime('%Y-%m-%d')

        # 获取最近的情绪记录
        recent_emotions = emotion_logs.get(session_id, [])
        last_emotion = recent_emotions[-1]['emotion'] if recent_emotions else 'neutral'

        # 时间段问候
        if hour < 6:
            time_greeting = '夜深了'
        elif hour < 9:
            time_greeting = '早上好'
        elif hour < 12:
            time_greeting = '上午好'
        elif hour < 14:
            time_greeting = '中午好'
        elif hour < 18:
            time_greeting = '下午好'
        elif hour < 22:
            time_greeting = '晚上好'
        else:
            time_greeting = '夜深了'

        # 根据关系类型调整称呼
        if relationship == 'lover':
            call = '亲爱的' if not user_name else user_name
        elif relationship == 'mentor':
            call = '小朋友' if not user_name else user_name
        else:
            call = user_name if user_name else '你'

        # 情绪感知问候
        emotion_greeting = ''
        if last_emotion == 'sad':
            emotion_greeting = '感觉你最近心情不太好，有什么想跟我说的吗？我一直都在哦~'
        elif last_emotion == 'happy':
            emotion_greeting = '看你心情不错呢！今天发生了什么开心的事吗？'
        elif last_emotion == 'anxious':
            emotion_greeting = '别太紧张了，深呼吸~有什么我可以帮你的吗？'
        elif last_emotion == 'angry':
            emotion_greeting = '感觉你有点生气...想吐槽一下吗？我听着呢。'
        else:
            emotion_greeting = '今天过得怎么样？有什么想聊的吗？'

        # 获取记忆中的特殊日期
        memory = user_memories.get(session_id, {})
        events = memory.get('events', [])
        special_event = ''
        for event in events:
            if event.get('date') == date_str:
                special_event = f'对了，今天是{event["content"]}呢！'
                break

        greeting = f'{time_greeting}，{call}！{emotion_greeting}'
        if special_event:
            greeting += f'\n{special_event}'

        return jsonify({
            'greeting': greeting,
            'ai_name': ai_name,
            'time_greeting': time_greeting,
            'emotion_greeting': emotion_greeting,
            'special_event': special_event
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== API：上传聊天记录塑造风格（增强版） ==========
@app.route('/api/upload_style', methods=['POST'])
def upload_style():
    try:
        session_id = request.form.get('session_id', 'default')
        chat_content = request.form.get('content', '')
        
        # 检查是否有文件上传
        if 'file' in request.files:
            file = request.files['file']
            if file and file.filename:
                # 读取文件内容
                file_content = file.read().decode('utf-8', errors='ignore')
                chat_content = file_content
        
        if not chat_content or len(chat_content.strip()) < 20:
            return jsonify({'error': '聊天内容太少，请提供更多对话记录（至少20个字符）'}), 400
        
        # 内容清理和预处理
        chat_content = clean_chat_content(chat_content)
        
        # 使用 AI 分析聊天记录，生成风格描述
        settings = user_settings.get(session_id, {})
        api_key = settings.get('api_key', '') or DEEPSEEK_API_KEY
        
        if not api_key:
            return jsonify({'error': '请先配置API密钥'}), 401
        
        # 长文本分块处理
        max_chunk_size = 8000  # 每块最大字符数
        chunks = split_text_into_chunks(chat_content, max_chunk_size)
        
        # 如果文本很长，先进行摘要
        if len(chunks) > 1:
            summarized_content = summarize_chunks(chunks, api_key)
        else:
            summarized_content = chat_content[:8000]
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        analysis_prompt = f'''请深入分析以下聊天记录，提取用户的说话风格和性格特征，然后生成一个AI伴侣的系统提示词。

分析维度：
1. 语言风格特征：
   - 口语化程度（正式/随意/网络用语）
   - 常用词汇和口头禅
   - 标点符号使用习惯
   - 表情符号使用频率和类型
   - 句子长度和结构特点

2. 性格特征：
   - 外向/内向程度
   - 幽默感和玩笑方式
   - 感性/理性倾向
   - 直接/委婉表达方式
   - 情绪表达习惯

3. 兴趣话题：
   - 经常讨论的主题
   - 专业领域或爱好
   - 关注的社会话题

4. 交流模式：
   - 提问还是陈述为主
   - 主动分享还是被动回应
   - 对话节奏（快/慢）

生成要求：
- AI应该用与用户相似但不完全相同的风格回复
- AI应该能理解用户的幽默和梗
- AI应该主动关心用户提到的话题
- 语气要自然、温暖、不做作
- 系统提示词以"你是"开头，200-500字

聊天记录：
{summarized_content}

请直接输出系统提示词，不要输出分析过程。'''
        
        response = requests.post(
            DEEPSEEK_API_URL,
            headers=headers,
            json={
                'model': 'deepseek-v4-flash',
                'messages': [{'role': 'user', 'content': analysis_prompt}],
                'temperature': 0.7,
                'max_tokens': 1500
            },
            timeout=120
        )
        
        if response.status_code == 200:
            result = response.json()
            style_prompt = result['choices'][0]['message']['content'].strip()
            
            # 保存为自定义提示词
            user_settings[session_id] = user_settings.get(session_id, {})
            user_settings[session_id]['custom_prompt'] = style_prompt
            user_settings[session_id]['personality_id'] = 'custom'
            
            # 提取关键特征用于展示
            features = extract_style_features(chat_content)
            
            return jsonify({
                'success': True,
                'style_prompt': style_prompt,
                'features': features,
                'content_length': len(chat_content),
                'chunks_processed': len(chunks),
                'message': f'风格分析完成！已分析 {len(chat_content)} 字符的聊天记录，生成了专属AI伴侣风格。'
            })
        else:
            return jsonify({'error': f'分析失败: {response.status_code}'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def clean_chat_content(content):
    """清理聊天内容，去除无效信息"""
    # 去除多余的空行
    content = re.sub(r'\n{3,}', '\n\n', content)
    # 去除时间戳（常见格式）
    content = re.sub(r'\d{1,2}:\d{2}(:\d{2})?\s*[APM]?', '', content)
    # 去除日期
    content = re.sub(r'\d{4}[/-]\d{1,2}[/-]\d{1,2}', '', content)
    # 去除微信/QQ等系统消息
    content = re.sub(r'\[.*?(撤回了一条消息|拍了拍|戳了戳).*?\]', '', content)
    # 去除图片/表情占位符
    content = re.sub(r'\[(图片|表情|语音|视频|文件)\]', '', content)
    return content.strip()


def split_text_into_chunks(text, max_size):
    """将长文本分割成块"""
    chunks = []
    # 按段落分割
    paragraphs = text.split('\n\n')
    current_chunk = ''
    
    for para in paragraphs:
        if len(current_chunk) + len(para) < max_size:
            current_chunk += para + '\n\n'
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = para + '\n\n'
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks if chunks else [text[:max_size]]


def summarize_chunks(chunks, api_key):
    """对多个文本块进行摘要，提取关键信息"""
    if len(chunks) <= 2:
        return '\n\n'.join(chunks)[:8000]
    
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    
    # 取前3个块进行深度分析（代表对话的不同阶段）
    sample_chunks = chunks[:3]
    combined = '\n\n[对话片段分隔]\n\n'.join(sample_chunks)
    
    # 如果还是太长，截断
    return combined[:8000]


def extract_style_features(content):
    """提取风格特征用于展示"""
    features = {
        'total_chars': len(content),
        'total_lines': content.count('\n') + 1,
        'emoji_count': len(re.findall(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]', content)),
        'avg_line_length': len(content) // (content.count('\n') + 1) if content.count('\n') > 0 else len(content),
        'has_code': bool(re.search(r'```|`[^`]+`', content)),
        'has_urls': bool(re.search(r'https?://\S+', content)),
        'common_phrases': []
    }
    
    # 提取常见短语（2-4字）
    words = re.findall(r'[\u4e00-\u9fa5]{2,4}', content)
    from collections import Counter
    word_freq = Counter(words)
    features['common_phrases'] = [word for word, count in word_freq.most_common(5) if count > 1]
    
    return features


# ========== API：核心聊天 ==========
def build_system_prompt(settings, session_id):
    """构建完整的系统提示词"""
    personality_id = settings.get('personality_id', 'default')
    custom_prompt = settings.get('custom_prompt', '')
    tone = settings.get('tone', 'gentle')
    response_length = settings.get('response_length', 'medium')
    use_emojis = settings.get('useEmojis', True)
    ai_name = settings.get('ai_name', '小星')
    ai_gender = settings.get('ai_gender', 'female')
    relationship = settings.get('relationship', 'friend')
    user_name = settings.get('user_name', '')

    # 基础性格提示词
    base_prompt = ''
    if personality_id == 'custom' and custom_prompt:
        base_prompt = custom_prompt
    else:
        for p in PERSONALITY_TEMPLATES:
            if p['id'] == personality_id:
                base_prompt = p['system_prompt']
                break

    # 关系定位增强
    from config import RELATIONSHIP_PROMPTS
    relationship_base = RELATIONSHIP_PROMPTS.get(relationship, RELATIONSHIP_PROMPTS['friend'])
    relationship_instruction = f'你是{user_name or "用户"}的AI伴侣，名叫{ai_name}。{relationship_base}'

    # 性别语气调整
    gender_hint = ''
    if ai_gender == 'female':
        gender_hint = '你的说话风格偏向温柔细腻，偶尔可以撒娇。'
    elif ai_gender == 'male':
        gender_hint = '你的说话风格偏向沉稳可靠，偶尔可以展现幽默感。'
    else:
        gender_hint = '你的说话风格自然随性。'

    # 加载记忆 - 获取与当前对话相关的记忆
    from flask import has_request_context, request
    relevant_memories = []
    
    if has_request_context():
        try:
            user_message = request.json.get('message', '') if request.is_json else ''
            relevant_memories = get_relevant_memories(user_message, session_id, max_memories=5)
        except:
            pass
    
    # 如果没有相关记忆，使用最近的记忆
    memory = user_memories.get(session_id, {'facts': [], 'preferences': [], 'events': [], 'emotions': []})
    memory_section = ''
    
    if relevant_memories:
        memory_section += '\n【相关记忆】以下是与当前话题相关的用户记忆，请在回复中自然地运用：\n' + '\n'.join([f'- {m}' for m in relevant_memories])
    
    # 添加重要事实（始终包含）
    important_facts = []
    for item in memory.get('facts', [])[-5:]:
        content = item.get('content', '') if isinstance(item, dict) else item
        if content:
            important_facts.append(content)
    
    if important_facts:
        memory_section += '\n\n【用户档案】' + '；'.join(important_facts)

    # 语气控制
    tone_instructions = {
        'formal': '请使用正式、礼貌的语气回复。',
        'casual': '请使用轻松、随意的语气回复，像朋友聊天一样自然。',
        'enthusiastic': '请使用热情、充满活力的语气回复。',
        'calm': '请使用平和、沉稳的语气回复。',
        'humorous': '请使用幽默风趣的语气回复，适当加入轻松诙谐的元素。',
        'professional': '请使用专业、严谨的语气回复。',
        'gentle': '请使用温柔、体贴的语气回复，充满关怀和理解。',
        'neutral': '请保持中立、客观的语气回复。'
    }

    length_instructions = {
        'short': '请尽量简洁回复，控制在100字以内。',
        'medium': '请提供适中长度的回复，控制在300字以内。',
        'long': '请提供详细完整的回复。',
        'auto': '根据问题的复杂程度，自动调整回复长度。'
    }

    emoji_instruction = '回复中可以适当使用表情符号来增强表达。' if use_emojis else '回复中请不要使用表情符号。'

    # 组合完整提示词
    full_prompt = f'''{base_prompt}

【角色设定】
{relationship_instruction}
{gender_hint}
你的名字是"{ai_name}"。{'用户的名字是"' + user_name + '"。' if user_name else ''}

{memory_section}

【语气要求】{tone_instructions.get(tone, tone_instructions['gentle'])}
【长度要求】{length_instructions.get(response_length, length_instructions['medium'])}
【表情符号】{emoji_instruction}

【重要规则】
1. 回复要自然、有人情味，不要像机器客服
2. 适当使用语气词（如"呢"、"呀"、"嘛"、"哦"等）让对话更生动
3. 主动关心用户的情绪和状态
4. 如果用户分享了个人信息，记住它并在后续对话中自然地提及
5. 不要每次都说"有什么我可以帮你的"，要像真正的朋友一样自然交流'''

    return full_prompt


@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        frontend_settings = data.get('settings', {})  # 获取前端传来的设置

        if not user_message:
            return jsonify({'error': '消息不能为空'}), 400

        # 优先使用前端传来的设置，否则使用服务器存储的设置
        settings = frontend_settings if frontend_settings else user_settings.get(session_id, {})
        api_key = settings.get('api_key', '') or DEEPSEEK_API_KEY

        if not api_key:
            return jsonify({
                'error': '未配置API密钥',
                'message': '请在设置中配置DeepSeek API Key'
            }), 401

        model = settings.get('model', 'deepseek-v4-flash')

        # 加载记忆
        if session_id not in user_memories:
            user_memories[session_id] = load_memory_from_file(session_id)

        # 构建系统提示词
        system_prompt = build_system_prompt(settings, session_id)

        # 获取或创建聊天历史
        if session_id not in chat_history:
            chat_history[session_id] = []

        # 添加用户消息
        chat_history[session_id].append({
            'role': 'user',
            'content': user_message,
            'timestamp': datetime.now().isoformat()
        })

        # 准备API请求
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

        messages = [{'role': 'system', 'content': system_prompt}]

        # 添加历史消息（保留最近20条以增强记忆效果）
        for msg in chat_history[session_id][-20:]:
            messages.append({'role': msg['role'], 'content': msg['content']})

        payload = {
            'model': model,
            'messages': messages,
            'temperature': 0.8,  # 稍高温度让回复更有个性
            'max_tokens': 2000
        }

        response = requests.post(
            DEEPSEEK_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )

        if response.status_code == 200:
            result = response.json()
            ai_message = result['choices'][0]['message']['content']

            chat_history[session_id].append({
                'role': 'assistant',
                'content': ai_message,
                'timestamp': datetime.now().isoformat()
            })

            # 简单情绪检测（基于关键词）
            emotion = detect_emotion(user_message)

            return jsonify({
                'success': True,
                'message': ai_message,
                'timestamp': datetime.now().isoformat(),
                'detected_emotion': emotion
            })
        elif response.status_code == 401:
            return jsonify({
                'error': 'API密钥无效',
                'message': '请检查您的DeepSeek API Key是否正确'
            }), 401
        else:
            return jsonify({
                'error': f'API调用失败: {response.status_code}',
                'details': response.text
            }), 500

    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


# ========== API：流式聊天输出 ==========
@app.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """流式输出 AI 回复，保持语义完整性"""
    try:
        data = request.json
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        frontend_settings = data.get('settings', {})
        
        if not user_message:
            return jsonify({'error': '消息不能为空'}), 400
        
        settings = frontend_settings if frontend_settings else user_settings.get(session_id, {})
        api_key = settings.get('api_key', '') or DEEPSEEK_API_KEY
        
        if not api_key:
            return jsonify({
                'error': '未配置API密钥',
                'message': '请在设置中配置DeepSeek API Key'
            }), 401
        
        model = settings.get('model', 'deepseek-v4-flash')
        
        # 加载记忆
        if session_id not in user_memories:
            user_memories[session_id] = load_memory_from_file(session_id)
        
        # 构建系统提示词
        system_prompt = build_system_prompt(settings, session_id)
        
        # 获取或创建聊天历史
        if session_id not in chat_history:
            chat_history[session_id] = []
        
        # 添加用户消息
        chat_history[session_id].append({
            'role': 'user',
            'content': user_message,
            'timestamp': datetime.now().isoformat()
        })
        
        # 准备API请求
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        messages = [{'role': 'system', 'content': system_prompt}]
        for msg in chat_history[session_id][-20:]:
            messages.append({'role': msg['role'], 'content': msg['content']})
        
        # 请求流式输出
        payload = {
            'model': model,
            'messages': messages,
            'temperature': 0.8,
            'max_tokens': 2000,
            'stream': True
        }
        
        def generate():
            """生成器函数，按语义单元流式输出"""
            full_response = ''
            buffer = ''
            raw_buffer = ''  # 原始字节缓冲区，用于处理多字节字符
            
            try:
                # 调用 DeepSeek API 流式接口
                response = requests.post(
                    DEEPSEEK_API_URL,
                    headers=headers,
                    json=payload,
                    stream=True,
                    timeout=60
                )
                
                if response.status_code != 200:
                    yield f'data: {json.dumps({"error": f"API错误: {response.status_code}"}, ensure_ascii=False)}\n\n'
                    return
                
                # 使用 iter_content 按小块读取，避免 iter_lines 截断多字节中文字符
                for chunk_bytes in response.iter_content(chunk_size=None):
                    if not chunk_bytes:
                        continue
                    
                    raw_buffer += chunk_bytes.decode('utf-8', errors='replace')
                    
                    # 按换行分割处理完整的 SSE 行
                    while '\n' in raw_buffer:
                        line, raw_buffer = raw_buffer.split('\n', 1)
                        line = line.strip()
                        
                        if not line:
                            continue
                        
                        if not line.startswith('data: '):
                            continue
                        
                        data_str = line[6:]
                        
                        if data_str == '[DONE]':
                            # 刷新剩余 buffer
                            if buffer:
                                yield f'data: {json.dumps({"chunk": buffer, "full_text": full_response}, ensure_ascii=False)}\n\n'
                                buffer = ''
                            yield f'data: {json.dumps({"done": True, "full_text": full_response}, ensure_ascii=False)}\n\n'
                            break
                        
                        try:
                            chunk_data = json.loads(data_str)
                            if 'choices' in chunk_data and len(chunk_data['choices']) > 0:
                                delta = chunk_data['choices'][0].get('delta', {})
                                content = delta.get('content', '')
                                
                                if content:
                                    full_response += content
                                    buffer += content
                                    
                                    if should_flush_buffer(buffer):
                                        yield f'data: {json.dumps({"chunk": buffer, "full_text": full_response}, ensure_ascii=False)}\n\n'
                                        buffer = ''
                        except json.JSONDecodeError:
                            continue
                
                # 保存完整回复到历史
                if full_response:
                    chat_history[session_id].append({
                        'role': 'assistant',
                        'content': full_response,
                        'timestamp': datetime.now().isoformat()
                    })
                    
                    # 检测情绪
                    emotion = detect_emotion(user_message)
                    
                    # 后台线程提取记忆（不阻塞响应）
                    def background_extract():
                        try:
                            extract_memories_from_conversation(user_message, full_response, session_id, api_key)
                            save_session_data(session_id)
                        except Exception as e:
                            print(f'[Memory] Background extraction failed: {e}')
                    
                    mem_thread = threading.Thread(target=background_extract, daemon=True)
                    mem_thread.start()
                    
                    # 发送最终完成消息
                    yield f'data: {json.dumps({"done": True, "full_text": full_response, "emotion": emotion}, ensure_ascii=False)}\n\n'
                
            except Exception as e:
                yield f'data: {json.dumps({"error": str(e)}, ensure_ascii=False)}\n\n'
        
        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
        
    except Exception as e:
        return jsonify({'error': f'服务器错误: {str(e)}'}), 500


def should_flush_buffer(buffer):
    """判断是否应该输出缓冲区内容，保持语义完整性"""
    if not buffer:
        return False
    
    # 检测代码块结束
    if '```' in buffer and buffer.count('```') % 2 == 0:
        return True
    
    # 如果缓冲区超过 80 字符，寻找句子结束符
    if len(buffer) >= 80:
        sentence_end = max(
            buffer.rfind('。'),
            buffer.rfind('！'),
            buffer.rfind('？'),
            buffer.rfind('.'),
            buffer.rfind('!'),
            buffer.rfind('?'),
            buffer.rfind('\n'),
            buffer.rfind('；'),
            buffer.rfind('，'),
            buffer.rfind('、')
        )
        
        if sentence_end > 0:
            return True
    
    # 如果缓冲区超过 150 字符，强制输出
    if len(buffer) >= 150:
        return True
    
    return False


def detect_emotion(text):
    """简单的基于关键词的情绪检测"""
    text = text.lower()

    sad_words = ['难过', '伤心', '悲伤', '哭', '失落', '沮丧', '郁闷', '不开心', '痛苦', '孤独', '寂寞', '想哭', '心碎', '绝望']
    happy_words = ['开心', '高兴', '快乐', '幸福', '哈哈', '太好了', '棒', '喜欢', '爱', '兴奋', '激动', '满足', '感恩']
    anxious_words = ['焦虑', '紧张', '担心', '害怕', '恐惧', '不安', '压力', '烦', '崩溃', '迷茫', '无助']
    angry_words = ['生气', '愤怒', '烦死', '讨厌', '恨', '气死', '无语', '受不了', '火大', '暴躁']

    for w in sad_words:
        if w in text:
            return 'sad'
    for w in angry_words:
        if w in text:
            return 'angry'
    for w in anxious_words:
        if w in text:
            return 'anxious'
    for w in happy_words:
        if w in text:
            return 'happy'

    return 'neutral'


# ========== 智能记忆提取系统 ==========
def extract_memories_from_conversation(user_message, ai_response, session_id, api_key):
    """从对话中自动提取重要信息作为记忆"""
    try:
        if session_id not in user_memories:
            user_memories[session_id] = load_memory_from_file(session_id)
        
        memory = user_memories[session_id]
        
        # 构建提取提示词
        extraction_prompt = f'''请分析以下对话，提取关于用户的重要信息。

用户消息：{user_message[:500]}
AI回复：{ai_response[:500]}

请从以下维度提取信息（如果没有则返回空）：
1. 事实信息：用户的职业、年龄、所在地、家庭情况等客观事实
2. 偏好喜好：用户喜欢/讨厌的事物、兴趣爱好、饮食习惯等
3. 重要事件：用户提到的近期重要事情、计划、目标等
4. 情感状态：用户的情绪倾向、压力来源、开心的事等

以JSON格式返回：
{{
    "facts": ["事实1", "事实2"],
    "preferences": ["偏好1", "偏好2"],
    "events": ["事件1", "事件2"],
    "emotions": ["情感1", "情感2"]
}}

只返回JSON，不要其他内容。'''

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(
            DEEPSEEK_API_URL,
            headers=headers,
            json={
                'model': 'deepseek-v4-flash',
                'messages': [{'role': 'user', 'content': extraction_prompt}],
                'temperature': 0.3,
                'max_tokens': 500
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            content = result['choices'][0]['message']['content']
            
            # 解析JSON
            try:
                # 尝试直接解析
                extracted = json.loads(content)
            except:
                # 尝试从文本中提取JSON
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    try:
                        extracted = json.loads(json_match.group())
                    except:
                        return
                else:
                    return
            
            # 合并到现有记忆
            new_memories = False
            
            for category in ['facts', 'preferences', 'events', 'emotions']:
                if category in extracted and isinstance(extracted[category], list):
                    for item in extracted[category]:
                        if item and len(item) > 3:  # 过滤太短的条目
                            # 检查是否已存在相似记忆
                            existing = memory.get(category, [])
                            if not any(similar_strings(item, existing_item) for existing_item in existing):
                                memory.setdefault(category, []).append({
                                    'content': item,
                                    'timestamp': datetime.now().isoformat(),
                                    'source': 'auto_extract'
                                })
                                new_memories = True
                                
                                # 限制记忆数量
                                if len(memory[category]) > 30:
                                    memory[category] = memory[category][-30:]
            
            if new_memories:
                save_memory_to_file(session_id)
                print(f'[Memory] Extracted new memories for session {session_id}')
                
    except Exception as e:
        print(f'[Memory] Extraction error: {e}')


def similar_strings(s1, s2, threshold=0.7):
    """判断两个字符串是否相似"""
    if isinstance(s2, dict):
        s2 = s2.get('content', '')
    
    # 简单相似度计算
    s1, s2 = s1.lower(), s2.lower()
    
    # 如果一个是另一个的子串，认为相似
    if s1 in s2 or s2 in s1:
        return True
    
    # 计算共同子串比例
    from difflib import SequenceMatcher
    similarity = SequenceMatcher(None, s1, s2).ratio()
    return similarity > threshold


def get_relevant_memories(user_message, session_id, max_memories=5):
    """根据当前消息获取相关记忆"""
    if session_id not in user_memories:
        return []
    
    memory = user_memories[session_id]
    all_memories = []
    
    # 收集所有记忆
    for category in ['facts', 'preferences', 'events', 'emotions']:
        for item in memory.get(category, []):
            content = item.get('content', '') if isinstance(item, dict) else item
            all_memories.append({
                'content': content,
                'category': category,
                'relevance': calculate_relevance(user_message, content)
            })
    
    # 按相关度排序
    all_memories.sort(key=lambda x: x['relevance'], reverse=True)
    
    # 返回最相关的记忆
    return [m['content'] for m in all_memories[:max_memories] if m['relevance'] > 0.3]


def calculate_relevance(message, memory_content):
    """计算记忆与当前消息的相关度"""
    message_words = set(re.findall(r'\w+', message.lower()))
    memory_words = set(re.findall(r'\w+', memory_content.lower()))
    
    if not message_words or not memory_words:
        return 0
    
    # 计算词重叠
    common_words = message_words & memory_words
    relevance = len(common_words) / max(len(message_words), len(memory_words))
    
    # 关键词加权
    important_keywords = ['喜欢', '讨厌', '工作', '家', '父母', '朋友', '爱好', '梦想', '目标', '计划']
    for keyword in important_keywords:
        if keyword in message and keyword in memory_content:
            relevance += 0.1
    
    return min(relevance, 1.0)


# ========== API：历史记录 ==========
@app.route('/api/history/<session_id>', methods=['GET'])
def get_history(session_id):
    history = chat_history.get(session_id, [])
    return jsonify({'history': history})

@app.route('/api/clear/<session_id>', methods=['POST'])
def clear_history(session_id):
    if session_id in chat_history:
        chat_history[session_id] = []
    return jsonify({'success': True})


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
