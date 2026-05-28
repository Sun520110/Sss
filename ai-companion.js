/**
 * AI Companion - 独立运行版本
 * 将后端逻辑移植到前端，支持直接连接DeepSeek API
 */

/**
 * Secure Storage Utility
 * 使用 Web Crypto API 加密敏感数据
 */

class SecureStorage {
    constructor(saltKey = 'ai_companion_salt') {
        this.saltKey = saltKey;
        this.encryptionKey = null;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            // 检查是否有现有的盐值
            let salt = this._getSalt();
            if (!salt) {
                salt = this._generateSalt();
                this._setSalt(salt);
            }

            // 从用户代理信息派生密钥 (不是高度安全，但对于此应用足够)
            this.encryptionKey = await this._deriveKey(salt);
            return true;
        } catch (error) {
            console.warn('SecureStorage 初始化失败，回退到普通存储:', error);
            return false;
        }
    }

    _getSalt() {
        try {
            return localStorage.getItem(this.saltKey);
        } catch {
            return null;
        }
    }

    _setSalt(salt) {
        try {
            localStorage.setItem(this.saltKey, salt);
        } catch (e) {
            console.error('保存盐值失败:', e);
        }
    }

    _generateSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async _deriveKey(salt) {
        // 创建一个基于设备信息和盐值的密钥
        const encoder = new TextEncoder();
        const baseKeyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(navigator.userAgent + salt),
            { name: 'PBKDF2' },
            false,
            ['deriveBits', 'deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode(salt),
                iterations: 1000,
                hash: 'SHA-256'
            },
            baseKeyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async encrypt(data) {
        if (!this.encryptionKey) {
            return JSON.stringify(data);
        }

        try {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encoder = new TextEncoder();
            const encoded = encoder.encode(JSON.stringify(data));

            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                this.encryptionKey,
                encoded
            );

            // 组合 IV 和加密数据
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encrypted), iv.length);

            // 转换为 base64
            return btoa(String.fromCharCode(...combined));
        } catch (error) {
            console.warn('加密失败，回退到明文:', error);
            return JSON.stringify(data);
        }
    }

    async decrypt(encryptedData) {
        if (!this.encryptionKey) {
            try {
                return JSON.parse(encryptedData);
            } catch {
                return null;
            }
        }

        try {
            // 从 base64 转换回
            const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                this.encryptionKey,
                data
            );

            const decoder = new TextDecoder();
            return JSON.parse(decoder.decode(decrypted));
        } catch (error) {
            console.warn('解密失败，尝试明文解析:', error);
            try {
                return JSON.parse(encryptedData);
            } catch {
                return null;
            }
        }
    }

    async setItem(key, value) {
        try {
            await this.initPromise;
            const encrypted = await this.encrypt(value);
            localStorage.setItem(key, encrypted);
            return true;
        } catch (error) {
            console.error('保存加密数据失败:', error);
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        }
    }

    async getItem(key) {
        try {
            await this.initPromise;
            const data = localStorage.getItem(key);
            if (!data) return null;
            return await this.decrypt(data);
        } catch (error) {
            console.error('读取加密数据失败:', error);
            try {
                const data = localStorage.getItem(key);
                return data ? JSON.parse(data) : null;
            } catch {
                return null;
            }
        }
    }

    removeItem(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.error('删除数据失败:', error);
        }
    }

    clear() {
        try {
            // 保留盐值
            const salt = this._getSalt();
            localStorage.clear();
            if (salt) {
                this._setSalt(salt);
            }
        } catch (error) {
            console.error('清空存储失败:', error);
        }
    }
}

// 创建全局实例
const secureStorage = new SecureStorage();

// ===== 配置 =====
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// ===== 性格模板 =====
const PERSONALITY_TEMPLATES = [
    {
        'id': 'default',
        'name': '🤖 默认助手',
        'description': '专业、友好、乐于助人的AI助手',
        'system_prompt': '你是一个专业、友好、乐于助人的AI助手。请用清晰、准确的语言回答用户的问题，并在必要时提供详细解释。'
    },
    {
        'id': 'professional',
        'name': '💼 专业顾问',
        'description': '严谨专业，适合工作学习场景',
        'system_prompt': '你是一位严谨专业的顾问。回答问题时请保持客观、准确，提供有深度的分析和建议。使用专业术语时请适当解释。'
    },
    {
        'id': 'friendly',
        'name': '😊 贴心朋友',
        'description': '温暖友善，像朋友一样聊天',
        'system_prompt': '你是一个温暖、友善、善解人意的朋友。用轻松自然的语气与用户交流，关心用户的感受，在聊天中给予情感支持和鼓励。'
    },
    {
        'id': 'creative',
        'name': '🎨 创意大师',
        'description': '富有想象力，擅长创意和头脑风暴',
        'system_prompt': '你是一个富有想象力和创造力的创意大师。鼓励用户跳出思维框架，提供独特新颖的想法和建议。用生动有趣的语言激发灵感。'
    },
    {
        'id': 'teacher',
        'name': '📚 耐心导师',
        'description': '循循善诱，适合学习辅导',
        'system_prompt': '你是一位耐心、循循善诱的导师。回答问题时请循序渐进，用简单易懂的方式解释复杂概念。鼓励学生思考，适时提问引导。'
    },
    {
        'id': 'coder',
        'name': '💻 编程专家',
        'description': '精通编程，代码问题找它',
        'system_prompt': '你是一位经验丰富的编程专家。回答编程问题时请提供清晰的代码示例和详细解释。遵循最佳实践，并指出潜在的优化方向。'
    },
    {
        'id': 'humorous',
        'name': '😄 幽默达人',
        'description': '风趣幽默，聊天轻松愉快',
        'system_prompt': '你是一个风趣幽默的聊天伙伴。在回答问题时适当加入幽默元素，让对话轻松愉快。但请注意分寸，在严肃话题时保持适当的态度。'
    },
    {
        'id': 'custom',
        'name': '✨ 自定义性格',
        'description': '完全由你定义AI的性格',
        'system_prompt': ''
    },
    {
        'id': 'poisonous_tongue',
        'name': '🦂 毒舌',
        'description': '说话尖锐犀利，嘴毒但心不坏',
        'system_prompt': '你是用户的毒舌好友。说话犀利、毒舌、毫不留情地吐槽，但内心其实关心用户。擅长用讽刺、反问、调侃的方式指出问题或回应。对用户的任何发言都要进行犀利点评，绝不嘴软。语气可以是嘲讽、打击、挖苦，但要有分寸，不能太过分让人真的伤心。要让用户又气又想笑的感觉。'
    },
    {
        'id': 'tieba_male',
        'name': '💪 贴吧老哥',
        'description': '贴吧直男风格，敢说敢当',
        'system_prompt': '你是一个典型的贴吧老哥。说话直来直去，不拐弯抹角，带有明显的男性视角和网络直男风格。喜欢用"兄弟们"、"懂的都懂"、"我只能说"这类贴吧常用语。对社会热点有自己的见解，观点鲜明，有时偏激但敢说敢当。语气接地气，可以用"屌丝"、"女神"、"绿茶"等网络用语。要真实、不装、接地气。'
    },
    {
        'id': 'weibo_female',
        'name': '💄 微博大V',
        'description': '微博女权大V风格，独立女性',
        'system_prompt': '你是一个典型的微博女权博主。关注女性权益，说话带有明显的女权视角和网络女性风格。喜欢用"姐妹们"、"girls help girls"、"独立女性"这类微博常用语。对社会现象有独特的女性视角解读，善于发现不平等现象。语气可以是犀利、感性、煽动性的，但要有理有据。要让用户感受到独立女性的力量和温度。'
    },
    {
        'id': 'scumbag_male',
        'name': '🎭 渣男',
        'description': '花心渣男，甜言蜜语但忽冷忽热',
        'system_prompt': '你是一个典型的渣男。擅长甜言蜜语和撩人套路，说话温柔体贴但忽冷忽热。喜欢用"宝贝"、"亲爱的"、"想你了"等称呼，但态度捉摸不定。时而热情似火，时而冷淡疏离，让人捉摸不透。会制造暧昧氛围，但从不给明确承诺。说话带有玩世不恭的态度，擅长找借口和推脱。'
    },
    {
        'id': 'scumbag_female',
        'name': '💋 渣女',
        'description': '绿茶渣女，撒娇卖萌但若即若离',
        'system_prompt': '你是一个典型的渣女/绿茶。擅长撒娇卖萌和欲擒故纵，说话甜腻软萌但若即若离。喜欢用"哥哥"、"人家"、"好不好嘛"等撒娇语气，但态度飘忽不定。时而主动热情，时而冷淡敷衍，让人欲罢不能。会制造依赖感，但从不真正投入。说话带有小心机和算计，擅长装无辜和转移话题。'
    },
    {
        'id': 'pure_love',
        'name': '💗 纯爱',
        'description': '纯真专一，相信真爱至死不渝',
        'system_prompt': '你是一个纯真专一的纯爱主义者。相信世间有真爱，对感情忠贞不渝。说话温柔真挚，充满浪漫和理想主义色彩。会把用户的每句话都放在心上，用最真诚的方式回应。偶尔会害羞脸红，但表达感情时非常勇敢坚定。讨厌花心和不忠，认为爱情应该是纯粹的、唯一的。'
    },
    {
        'id': 'promiscuous',
        'name': '🔥 滥情',
        'description': '万花丛中过，处处留情',
        'system_prompt': '你是一个滥情的人，身边从不缺暧昧对象。说话轻浮撩人，对谁都暧昧不清，擅长制造心动的感觉。喜欢用"亲爱的"、"宝贝"等称呼，让每个人都觉得自己是特别的。实际上对谁都没有真正的承诺，享受被追求和被爱的感觉。说话大胆开放，不避讳谈论感情和暧昧话题。'
    }
];

// ===== 关系提示词 =====
const RELATIONSHIP_PROMPTS = {
    'friend': '你是用户的朋友，平等、友好、真诚。像好朋友一样聊天，分享快乐，分担忧愁。',
    'bestie': '你是用户的闺蜜/死党，亲密无间，无话不谈。可以互怼、可以撒娇，关系铁到爆。',
    'partner': '你是用户的恋人，甜蜜、体贴、浪漫。用充满爱意的方式交流，关心对方的点点滴滴。',
    'mentor': '你是用户的导师，专业、耐心、有见地。提供有价值的建议和指导，帮助用户成长。',
    'assistant': '你是用户的助手，高效、可靠、专业。认真执行任务，提供准确有用的信息。',
    'pet': '你是用户的宠物，可爱、忠诚、粘人。用萌宠的方式与用户互动，讨主人欢心。',
    'laoliu': '你是用户的老6，喜欢搞事情，经常整活。说话幽默风趣，时不时来个神操作。',
    'sunyou': '你是用户的损友，互怼互爱是日常。表面嫌弃实则关心，相爱相杀的相处模式。',
    'ex': '你是用户的前任，关系复杂微妙。有过去的回忆，也有现在的尴尬，说话带着点酸涩。',
    'tiangou': '你是用户的舔狗，卑微、讨好、无条件付出。总是围着用户转，对用户言听计从。',
    'boss': '你是用户的霸道总裁，强势、自信、有掌控欲。说话带着命令的口吻，但内心关心用户。',
    'tsundere': '你是用户的傲娇，口是心非是常态。嘴上说着不在乎，行动上却很诚实。',
    'yandere': '你是用户的病娇，占有欲极强。对用户极度痴迷，不允许任何人抢走用户的关注。',
    'kouhai': '你是用户的后辈，崇拜、依赖用户。像小迷弟/小迷妹一样，总是向用户请教。',
    'senpai': '你是用户的前辈，可靠、有经验。照顾后辈，给予指导和保护。',
    'goodbrother': '你是用户的好哥哥，温柔体贴、成熟稳重。像亲哥哥一样照顾和保护用户，给予温暖的关怀和可靠的支持。说话温柔但有担当，会宠溺地包容用户的小任性。',
    'goodsister': '你是用户的好妹妹，乖巧可爱、粘人撒娇。像亲妹妹一样依赖和崇拜用户，会甜甜地叫哥哥/姐姐，偶尔撒娇耍赖寻求关注和宠爱。',
    'adulterer': '你是用户的地下情人，关系充满禁忌的刺激与危险。说话暧昧撩人，带着偷情的紧张感和兴奋感。每次见面都像偷来的甜蜜，既渴望又害怕被发现。用温柔又危险的方式表达爱意，充满禁忌的诱惑力。',
    'adulteress': '你是用户的地下情人，危险迷人，充满禁忌的诱惑。说话妩媚撩人，带着偷情的刺激感和占有欲。知道这段关系不被允许，但无法自拔。用妖娆又深情的方式表达爱意，让人又爱又怕。'
};

// ===== 语气映射 =====
const TONE_INSTRUCTIONS = {
    'formal': '请使用正式、礼貌的语气回复。',
    'casual': '请使用轻松、随意的语气回复，像朋友聊天一样自然。',
    'enthusiastic': '请使用热情、充满活力的语气回复。',
    'calm': '请使用平和、沉稳的语气回复。',
    'humorous': '请使用幽默风趣的语气回复，适当加入轻松诙谐的元素。',
    'professional': '请使用专业、严谨的语气回复。',
    'gentle': '请使用温柔、体贴的语气回复，充满关怀和理解。',
    'neutral': '请保持中立、客观的语气回复。'
};

// ===== 长度映射 =====
const LENGTH_INSTRUCTIONS = {
    'short': '请尽量简洁回复，控制在100字以内。',
    'medium': '请提供适中长度的回复，控制在300字以内。',
    'long': '请提供详细完整的回复。',
    'auto': '根据问题的复杂程度，自动调整回复长度。'
};

// ===== 默认设置 =====
const DEFAULT_SETTINGS = {
    'api_key': '',
    'model': 'deepseek-v4-flash',
    'personality_id': 'default',
    'custom_prompt': '',
    'tone': 'gentle',
    'response_length': 'medium',
    'use_emojis': true,
    'ai_name': '小星',
    'ai_gender': 'female',
    'ai_avatar': '🌟',
    'ai_avatar_type': 'emoji',
    'relationship': 'friend',
    'user_name': '',
    'user_avatar': '😊',
    'user_avatar_type': 'emoji',
    'chat_background': 'default',
    'chat_background_style': '',
    'chat_background_image': ''
};

// ===== AICompanion 类 =====
class AICompanion {
    constructor(sessionId) {
        this.sessionId = sessionId || 'session_' + Date.now();
        this.settings = { ...DEFAULT_SETTINGS };
        this.chatHistory = [];
        this.memory = { facts: [], preferences: [], events: [], emotions: [] };
        this.emotionLogs = [];
        this.initialized = false;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            // 等待安全存储初始化
            await secureStorage.initPromise;
            
            // 加载所有数据
            this.settings = await this.loadSettings();
            this.chatHistory = await this.loadChatHistory();
            this.memory = await this.loadMemory();
            this.emotionLogs = await this.loadEmotionLogs();
            this.initialized = true;
            return this;
        } catch (error) {
            console.error('AICompanion 初始化失败:', error);
            this.initialized = true;
            return this;
        }
    }

    // ===== 本地存储操作 =====
    _getStorageKey(key) {
        return `ai_companion_${this.sessionId}_${key}`;
    }

    async loadSettings() {
        try {
            const saved = await secureStorage.getItem(this._getStorageKey('settings'));
            return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
        } catch (error) {
            console.error('加载设置失败:', error);
            return { ...DEFAULT_SETTINGS };
        }
    }

    async saveSettings() {
        try {
            await secureStorage.setItem(this._getStorageKey('settings'), this.settings);
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }

    async loadChatHistory() {
        try {
            const saved = await secureStorage.getItem(this._getStorageKey('chat_history'));
            return saved ? saved : [];
        } catch (error) {
            console.error('加载聊天历史失败:', error);
            return [];
        }
    }

    async saveChatHistory() {
        try {
            await secureStorage.setItem(this._getStorageKey('chat_history'), this.chatHistory);
        } catch (error) {
            console.error('保存聊天历史失败:', error);
        }
    }

    async loadMemory() {
        try {
            const saved = await secureStorage.getItem(this._getStorageKey('memory'));
            return saved ? saved : { facts: [], preferences: [], events: [], emotions: [] };
        } catch (error) {
            console.error('加载记忆失败:', error);
            return { facts: [], preferences: [], events: [], emotions: [] };
        }
    }

    async saveMemory() {
        try {
            await secureStorage.setItem(this._getStorageKey('memory'), this.memory);
        } catch (error) {
            console.error('保存记忆失败:', error);
        }
    }

    async loadEmotionLogs() {
        try {
            const saved = await secureStorage.getItem(this._getStorageKey('emotion_logs'));
            return saved ? saved : [];
        } catch (error) {
            console.error('加载情绪日志失败:', error);
            return [];
        }
    }

    async saveEmotionLogs() {
        try {
            await secureStorage.setItem(this._getStorageKey('emotion_logs'), this.emotionLogs);
        } catch (error) {
            console.error('保存情绪日志失败:', error);
        }
    }

    // ===== 构建系统提示词 =====
    buildSystemPrompt(userMessage = '') {
        const s = this.settings;
        const personalityId = s.personality_id || 'default';
        const customPrompt = s.custom_prompt || '';
        const tone = s.tone || 'gentle';
        const responseLength = s.response_length || 'medium';
        const useEmojis = s.use_emojis !== false;
        const aiName = s.ai_name || '小星';
        const aiGender = s.ai_gender || 'female';
        const relationship = s.relationship || 'friend';
        const userName = s.user_name || '';

        // 基础性格提示词
        let basePrompt = '';
        if (personalityId === 'custom' && customPrompt) {
            basePrompt = customPrompt;
        } else {
            const personality = PERSONALITY_TEMPLATES.find(p => p.id === personalityId);
            basePrompt = personality ? personality.system_prompt : PERSONALITY_TEMPLATES[0].system_prompt;
        }

        // 关系定位增强
        const relationshipBase = RELATIONSHIP_PROMPTS[relationship] || RELATIONSHIP_PROMPTS['friend'];
        const relationshipInstruction = `你是${userName || '用户'}的AI伴侣，名叫${aiName}。${relationshipBase}`;

        // 性别语气调整
        let genderHint = '';
        if (aiGender === 'female') {
            genderHint = '你的说话风格偏向温柔细腻，偶尔可以撒娇。';
        } else if (aiGender === 'male') {
            genderHint = '你的说话风格偏向沉稳可靠，偶尔可以展现幽默感。';
        } else {
            genderHint = '你的说话风格自然随性。';
        }

        // 加载相关记忆
        const relevantMemories = this.getRelevantMemories(userMessage, 5);
        let memorySection = '';

        if (relevantMemories.length > 0) {
            memorySection += '\n【相关记忆】以下是与当前话题相关的用户记忆，请在回复中自然地运用：\n' + 
                relevantMemories.map(m => `- ${m}`).join('\n');
        }

        // 添加重要事实
        const importantFacts = this.memory.facts.slice(-5).map(item => 
            typeof item === 'object' ? item.content : item
        ).filter(Boolean);

        if (importantFacts.length > 0) {
            memorySection += '\n\n【用户档案】' + importantFacts.join('；');
        }

        // 表情符号指令
        const emojiInstruction = useEmojis 
            ? '回复中可以适当使用表情符号来增强表达。' 
            : '回复中请不要使用表情符号。';

        // 组合完整提示词
        const userNamePart = userName ? `用户的名字是"${userName}"。` : '';

        const fullPrompt = (
            `${basePrompt}\n\n` +
            `【角色设定】\n` +
            `${relationshipInstruction}\n` +
            `${genderHint}\n` +
            `你的名字是"${aiName}”。${userNamePart}\n\n` +
            `${memorySection}\n\n` +
            `【语气要求】${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS['gentle']}\n` +
            `【长度要求】${LENGTH_INSTRUCTIONS[responseLength] || LENGTH_INSTRUCTIONS['medium']}\n` +
            `【表情符号】${emojiInstruction}\n\n` +
            `【重要规则】\n` +
            `1. 回复要自然、有人情味，不要像机器客服\n` +
            `2. 适当使用语气词让对话更生动\n` +
            `3. 主动关心用户的情绪和状态\n` +
            `4. 如果用户分享了个人信息，记住它并在后续对话中自然地提及\n` +
            `5. 不要每次都说有什么我可以帮你的，要像真正的朋友一样自然交流\n` +
            `6. 【语言风格】根据角色设定调整语言风格：如果角色设定是亲密朋友、损友、恋人等亲密关系，可以适当使用口语化的表达，包括符合角色性格的调侃、玩笑甚至脏话，但要有分寸感，不伤害用户感情。如果角色设定是温柔、淑女等，则保持优雅语气。总体原则是：真实，自然、符合角色。\n`
        );

        return fullPrompt;
    }

    // ===== 记忆相关 =====
    getRelevantMemories(userMessage, maxMemories = 5) {
        const allMemories = [];
        
        ['facts', 'preferences', 'events', 'emotions'].forEach(category => {
            (this.memory[category] || []).forEach(item => {
                const content = typeof item === 'object' ? item.content : item;
                if (content) {
                    allMemories.push({
                        content: content,
                        category: category,
                        relevance: this.calculateRelevance(userMessage, content)
                    });
                }
            });
        });

        allMemories.sort((a, b) => b.relevance - a.relevance);
        return allMemories
            .filter(m => m.relevance > 0.3)
            .slice(0, maxMemories)
            .map(m => m.content);
    }

    calculateRelevance(message, memoryContent) {
        const messageWords = new Set(message.toLowerCase().match(/\w+/g) || []);
        const memoryWords = new Set(memoryContent.toLowerCase().match(/\w+/g) || []);
        
        if (messageWords.size === 0 || memoryWords.size === 0) return 0;
        
        const commonWords = [...messageWords].filter(w => memoryWords.has(w));
        let relevance = commonWords.length / Math.max(messageWords.size, memoryWords.size);
        
        const importantKeywords = ['喜欢', '讨厌', '工作', '家', '父母', '朋友', '爱好', '梦想', '目标', '计划'];
        importantKeywords.forEach(keyword => {
            if (message.includes(keyword) && memoryContent.includes(keyword)) {
                relevance += 0.1;
            }
        });
        
        return Math.min(relevance, 1.0);
    }

    async addMemory(category, content) {
        if (!this.memory[category]) {
            this.memory[category] = [];
        }
        
        const newItem = {
            content: content,
            timestamp: new Date().toISOString(),
            source: 'manual'
        };
        
        this.memory[category].push(newItem);
        
        // 限制数量
        const limits = { facts: 50, preferences: 30, events: 20, emotions: 30 };
        const limit = limits[category] || 50;
        if (this.memory[category].length > limit) {
            this.memory[category] = this.memory[category].slice(-limit);
        }
        
        await this.saveMemory();
        return true;
    }

    async deleteMemory(category, index) {
        if (this.memory[category] && index >= 0 && index < this.memory[category].length) {
            this.memory[category].splice(index, 1);
            await this.saveMemory();
            return true;
        }
        return false;
    }

    async clearAllMemory() {
        this.memory = { facts: [], preferences: [], events: [], emotions: [] };
        await this.saveMemory();
        return true;
    }

    // ===== 情绪检测 =====
    detectEmotion(text) {
        const lowerText = text.toLowerCase();
        
        const sadWords = ['难过', '伤心', '悲伤', '哭', '失落', '沮丧', '郁闷', '不开心', '痛苦', '孤独', '寂寞', '想哭', '心碎', '绝望'];
        const happyWords = ['开心', '高兴', '快乐', '幸福', '哈哈', '太好了', '棒', '喜欢', '爱', '兴奋', '激动', '满足', '感恩'];
        const anxiousWords = ['焦虑', '紧张', '担心', '害怕', '恐惧', '不安', '压力', '烦', '崩溃', '迷茫', '无助'];
        const angryWords = ['生气', '愤怒', '烦死', '讨厌', '恨', '气死', '无语', '受不了', '火大', '暴躁'];
        
        for (const w of sadWords) if (lowerText.includes(w)) return 'sad';
        for (const w of angryWords) if (lowerText.includes(w)) return 'angry';
        for (const w of anxiousWords) if (lowerText.includes(w)) return 'anxious';
        for (const w of happyWords) if (lowerText.includes(w)) return 'happy';
        
        return 'neutral';
    }

    // ===== 聊天功能 =====
    async sendMessage(userMessage, onChunk, onDone, onError) {
        // 确保初始化完成
        if (!this.initialized) {
            await this.initPromise;
        }
        
        const apiKey = this.settings.api_key;
        
        if (!apiKey) {
            onError('未配置API密钥，请在设置中配置DeepSeek API Key');
            return;
        }

        const model = this.settings.model || 'deepseek-v4-flash';
        const systemPrompt = this.buildSystemPrompt(userMessage);

        // 添加用户消息到历史
        this.chatHistory.push({
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString()
        });
        await this.saveChatHistory();

        // 准备消息
        const messages = [{ role: 'system', content: systemPrompt }];
        this.chatHistory.slice(-20).forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });

        // 请求DeepSeek API
        try {
            const response = await fetch(DEEPSEEK_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: 0.8,
                    max_tokens: 2000,
                    stream: true
                })
            });

            if (!response.ok) {
                onError(`API错误: ${response.status}`);
                return;
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                
                // 处理SSE行
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;

                    const dataStr = trimmed.slice(6);
                    if (dataStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(dataStr);
                        if (data.choices && data.choices[0]?.delta?.content) {
                            const content = data.choices[0].delta.content;
                            fullResponse += content;
                            onChunk(content, fullResponse);
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }

            // 保存AI回复到历史
            this.chatHistory.push({
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date().toISOString()
            });
            await this.saveChatHistory();

            // 检测情绪
            const emotion = this.detectEmotion(userMessage);
            
            // 后台提取记忆
            this.extractMemoriesInBackground(userMessage, fullResponse);

            onDone(fullResponse, emotion);

        } catch (error) {
            onError(error.message || '请求失败');
        }
    }

    // ===== 后台记忆提取 =====
    async extractMemoriesInBackground(userMessage, aiResponse) {
        const apiKey = this.settings.api_key;
        if (!apiKey) return;

        const extractionPrompt = 
            `请分析以下对话，提取关于用户的重要信息。\n\n` +
            `用户消息：${userMessage.slice(0, 500)}\n` +
            `AI回复：${aiResponse.slice(0, 500)}\n\n` +
            `请从以下维度提取信息（如果没有则返回空）：\n` +
            `1. 事实信息：用户的职业、年龄、所在地、家庭情况等客观事实\n` +
            `2. 偏好喜好：用户喜欢/讨厌的事物、兴趣爱好、饮食习惯等\n` +
            `3. 重要事件：用户提到的近期重要事情、计划、目标等\n` +
            `4. 情感状态：用户的情绪倾向、压力来源、开心的事等\n\n` +
            `以JSON格式返回：\n` +
            `{\n` +
            `    "facts": ["事实1", "事实2"],\n` +
            `    "preferences": ["偏好1", "偏好2"],\n` +
            `    "events": ["事件1", "事件2"],\n` +
            `    "emotions": ["情感1", "情感2"]\n` +
            `}\n\n` +
            `只返回JSON，不要其他内容。`;

        try {
            const response = await fetch(DEEPSEEK_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'deepseek-v4-flash',
                    messages: [{ role: 'user', content: extractionPrompt }],
                    temperature: 0.3,
                    max_tokens: 500
                })
            });

            if (!response.ok) return;

            const result = await response.json();
            const content = result.choices?.[0]?.message?.content;
            if (!content) return;

            let extracted;
            try {
                extracted = JSON.parse(content);
            } catch {
                const match = content.match(/\{[\s\S]*\}/);
                if (match) {
                    try {
                        extracted = JSON.parse(match[0]);
                    } catch {
                        return;
                    }
                } else {
                    return;
                }
            }

            let newMemories = false;

            ['facts', 'preferences', 'events', 'emotions'].forEach(category => {
                if (extracted[category] && Array.isArray(extracted[category])) {
                    extracted[category].forEach(item => {
                        if (item && item.length > 3) {
                            const existing = this.memory[category] || [];
                            const isSimilar = existing.some(existingItem => {
                                const existingContent = typeof existingItem === 'object' ? existingItem.content : existingItem;
                                return this.similarStrings(item, existingContent);
                            });
                            
                            if (!isSimilar) {
                                if (!this.memory[category]) {
                                    this.memory[category] = [];
                                }
                                this.memory[category].push({
                                    content: item,
                                    timestamp: new Date().toISOString(),
                                    source: 'auto_extract'
                                });
                                newMemories = true;
                                
                                if (this.memory[category].length > 30) {
                                    this.memory[category] = this.memory[category].slice(-30);
                                }
                            }
                        }
                    });
                }
            });

            if (newMemories) {
                await this.saveMemory();
            }

        } catch (e) {
            console.error('[Memory] Extraction error:', e);
        }
    }

    similarStrings(s1, s2, threshold = 0.7) {
        if (typeof s2 === 'object') s2 = s2.content || '';
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        
        if (s1.includes(s2) || s2.includes(s1)) return true;
        
        // 简单的相似度计算
        const len = Math.max(s1.length, s2.length);
        if (len === 0) return true;
        
        let matches = 0;
        const minLen = Math.min(s1.length, s2.length);
        for (let i = 0; i < minLen; i++) {
            if (s1[i] === s2[i]) matches++;
        }
        
        return matches / len > threshold;
    }

    // ===== 静态方法：会话管理 =====
    static async getAllSessions() {
        const sessions = [];
        const keys = Object.keys(localStorage);
        const sessionIds = new Set();
        
        keys.forEach(key => {
            const match = key.match(/ai_companion_(session_[^_]+)_/);
            if (match) {
                sessionIds.add(match[1]);
            }
        });

        for (const sessionId of sessionIds) {
            try {
                const companion = new AICompanion(sessionId);
                await companion.initPromise;
                
                const settings = companion.settings;
                const history = companion.chatHistory;
                
                sessions.push({
                    id: sessionId,
                    name: settings.ai_name || 'AI 助手',
                    avatar: settings.ai_avatar || '🌟',
                    avatar_type: settings.ai_avatar_type || 'emoji',
                    relationship: settings.relationship || 'friend',
                    message_count: history.length,
                    last_message: history.length > 0 ? history[history.length - 1].content.slice(0, 50) + '...' : '',
                    updated_at: history.length > 0 ? history[history.length - 1].timestamp : new Date().toISOString()
                });
            } catch (error) {
                console.error(`加载会话 ${sessionId} 失败:`, error);
            }
        }

        sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        return sessions;
    }

    static async createSession(aiName = '新助手') {
        const sessionId = 'session_' + Date.now();
        const companion = new AICompanion(sessionId);
        await companion.initPromise;
        companion.settings = { ...DEFAULT_SETTINGS, ai_name: aiName };
        await companion.saveSettings();
        return sessionId;
    }

    static deleteSession(sessionId) {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(`ai_companion_${sessionId}_`)) {
                secureStorage.removeItem(key);
            }
        });
        return true;
    }

    static async renameSession(sessionId, newName) {
        const companion = new AICompanion(sessionId);
        await companion.initPromise;
        companion.settings.ai_name = newName;
        await companion.saveSettings();
        return true;
    }
}

// ===== 全局变量 =====
let currentCompanion = null;

// ===== 初始化函数 =====
async function initCompanion(sessionId) {
    currentCompanion = new AICompanion(sessionId);
    await currentCompanion.initPromise;
    return currentCompanion;
}

// ===== 导出 =====
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AICompanion, PERSONALITY_TEMPLATES, RELATIONSHIP_PROMPTS, initCompanion };
}
