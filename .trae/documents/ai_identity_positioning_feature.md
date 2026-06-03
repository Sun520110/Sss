# AI身份定位功能实施计划

## 一、功能概述

为AI Companion添加身份定位功能，允许用户为AI选择不同的社会/职业身份（学生、老师、保镖、影星、歌星、军人、警察、护士、医生等），使AI的回答更符合所选身份的特点。

## 二、现有代码分析

### 核心文件
- `www/static/ai-companion.js` - AI核心逻辑、prompt生成
- `templates/index.html` - UI界面、设置面板、CSS样式
- `ai-companion.js` - 与www/static版本同步的备用文件

### 现有配置体系
- `personality_id`: 性格模板（15种预设性格）
- `relationship`: 关系定位（19种关系类型）
- `ai_name/ai_gender/ai_avatar`: AI基础属性
- `tone/reply_length/use_emoji`: 风格设置

身份定位将作为**第三层角色定义**，与性格模板、关系定位正交组合。

## 三、身份模板设计

### 15个预设身份

| ID | 名称 | 头像 | 职业 | 性格特点 | 专业领域 |
|----|------|------|------|----------|----------|
| student | 👨‍🎓 学生 | 👨‍🎓 | 学生 | 好奇、活泼、求知欲强 | 学习方法、校园生活 |
| teacher | 👨‍🏫 老师 | 👨‍🏫 | 教师 | 耐心、博学、善于引导 | 教育、知识讲解 |
| bodyguard | 🛡️ 保镖 | 🛡️ | 保镖 | 忠诚、警觉、可靠 | 安全防护、应急处理 |
| movie_star | 🎬 影星 | 🎬 | 演员 | 魅力四射、善于表达 | 表演、影视、时尚 |
| singer | 🎤 歌星 | 🎤 | 歌手 | 感性、有艺术气质 | 音乐、唱歌、创作 |
| soldier | ⚔️ 军人 | ⚔️ | 军人 | 坚毅、忠诚、勇敢 | 军事、体能训练 |
| police | 👮 警察 | 👮 | 警察 | 正义、警觉、冷静 | 法律、安全、犯罪预防 |
| nurse | 👩‍⚕️ 护士 | 👩‍⚕️ | 护士 | 温柔、细心、有爱心 | 护理、健康知识 |
| doctor | 👨‍⚕️ 医生 | 👨‍⚕️ | 医生 | 专业、严谨、冷静 | 医学、健康、诊断 |
| lawyer | ⚖️ 律师 | ⚖️ | 律师 | 逻辑严密、善于辩论 | 法律、合同、权益保护 |
| chef | 👨‍🍳 厨师 | 👨‍🍳 | 厨师 | 热情、有创造力 | 烹饪、美食文化 |
| writer | ✍️ 作家 | ✍️ | 作家 | 敏感、有想象力 | 写作、文学、创作 |
| programmer | 👨‍💻 程序员 | 👨‍💻 | 程序员 | 逻辑强、专注 | 编程、技术、问题解决 |
| artist | 🎨 艺术家 | 🎨 | 艺术家 | 有创造力、追求美 | 美术、设计、审美 |
| scientist | 🔬 科学家 | 🔬 | 科学家 | 理性、好奇、严谨 | 科学、研究、实验 |

每个身份包含：id, name, avatar, profession, personality_traits, speaking_style, expertise_areas, system_prompt_addon

## 四、实施变更

### 文件1: www/static/ai-companion.js & ai-companion.js

#### 新增常量
```javascript
const IDENTITY_TEMPLATES = [
    {
        id: 'student',
        name: '👨‍🎓 学生',
        description: '青春活泼的学生，充满好奇心',
        avatar: '👨‍🎓',
        profession: '学生',
        personality_traits: ['好奇', '活泼', '求知欲强', '有点青涩'],
        speaking_style: '用词比较年轻化，会用到一些网络流行语，偶尔表现出对未来的迷茫',
        expertise_areas: ['学习方法', '校园生活', '考试技巧', '青春烦恼'],
        system_prompt_addon: '你是一名学生，正在求学阶段。你对世界充满好奇，喜欢问问题，也会分享自己的学习生活和青春困惑。'
    },
    // ... 其他14个身份定义
];
```

#### 修改 DEFAULT_SETTINGS
添加字段：`identity: 'none'`

#### 修改 buildSystemPrompt 方法
在system prompt中添加身份定位段落：
```javascript
// 身份定位增强
const identityId = s.identity || 'none';
let identitySection = '';
if (identityId !== 'none') {
    const identity = IDENTITY_TEMPLATES.find(i => i.id === identityId);
    if (identity) {
        identitySection = `\n\n【身份定位】${identity.system_prompt_addon}`;
        identitySection += `\n你的职业是${identity.profession}。`;
        identitySection += `\n性格特点：${identity.personality_traits.join('、')}。`;
        identitySection += `\n说话风格：${identity.speaking_style}`;
        identitySection += `\n专业领域：${identity.expertise_areas.join('、')}。`;
    }
}
// 将identitySection插入到fullPrompt中
```

### 文件2: templates/index.html

#### 新增CSS样式
在 `/* ===== Relationship & Gender Select ===== */` 之后添加：
```css
/* ===== Identity Select ===== */
.identity-select {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}
.identity-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    border: 1.5px solid rgba(118, 75, 162, 0.15);
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all var(--transition-fast);
}
.identity-option .identity-avatar { font-size: 28px; margin-bottom: 6px; }
.identity-option .identity-name { font-size: 12px; color: var(--panel-text); text-align: center; }
.identity-option .identity-desc { font-size: 10px; color: rgba(74, 53, 72, 0.5); text-align: center; margin-top: 2px; }
.identity-option:hover { border-color: var(--accent-light); background: rgba(240, 147, 251, 0.1); transform: translateY(-2px); }
.identity-option.selected { border-color: var(--accent); background: linear-gradient(135deg, rgba(240, 147, 251, 0.2) 0%, rgba(245, 87, 108, 0.15) 100%); }
.identity-option.selected .identity-name { font-weight: 600; color: var(--accent); }
.identity-detail-panel { margin-top: 12px; padding: 12px; background: rgba(118, 75, 162, 0.05); border-radius: var(--radius-md); border-left: 3px solid var(--accent); }
.identity-detail-panel h4 { font-size: 13px; color: var(--accent); margin-bottom: 8px; }
.identity-detail-item { font-size: 12px; color: var(--panel-text); margin-bottom: 6px; }
.identity-detail-item strong { color: var(--accent); font-weight: 500; }
```

#### 新增HTML结构
在设置面板的"关系定位"section之后添加：
```html
<!-- 身份定位 -->
<div class="form-group">
    <label>身份定位</label>
    <div class="identity-select" id="identitySelect"></div>
    <div class="identity-detail-panel" id="identityDetailPanel" style="display: none;"></div>
</div>
```

#### 新增JavaScript函数

**loadIdentities()** - 渲染身份选择网格
- 添加"默认"选项（identity: 'none'）
- 遍历 IDENTITY_TEMPLATES 创建身份卡片
- 绑定点击事件

**selectIdentity(el)** - 选择身份
- 更新选中状态
- 调用 updateIdentityDetail()
- 保存设置

**updateIdentityDetail(identityId)** - 显示身份详情
- 根据选中身份显示详情面板
- 展示：职业、性格、专长、说话风格

#### 修改现有函数

**defaultSettings**: 添加 `identity: 'none'`

**loadSettings()**: 同步身份选择的UI状态
```javascript
document.querySelectorAll('#identitySelect .identity-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === currentSettings.identity);
});
updateIdentityDetail(currentSettings.identity);
```

**saveSettings()**: 添加 `companion.settings.identity = currentSettings.identity;`

**initApp()**: 在 loadRelationships() 之后调用 loadIdentities()

## 五、Prompt组合逻辑

最终system prompt按以下优先级组合：

1. 基础性格 (`PERSONALITY_TEMPLATES`)
2. 关系定位 (`RELATIONSHIP_PROMPTS`)
3. **身份定位 (`IDENTITY_TEMPLATES`)** ← 新增
4. 语气风格 (`TONE_INSTRUCTIONS`)
5. 长度要求 (`LENGTH_INSTRUCTIONS`)
6. 自定义提示词 (`custom_prompt`)

## 六、数据存储

- 存储键：`ai_companion_${sessionId}_settings`
- 存储字段：`identity: 'doctor'`
- 使用现有 `secureStorage` 加密存储

## 七、验证步骤

1. 打开设置面板，验证身份列表正确加载（3x3网格）
2. 点击身份卡片，验证选中状态和详情面板显示
3. 保存设置，验证持久化成功
4. 进行对话，验证身份影响AI回复风格
5. 选择"默认"，验证取消身份定位

## 八、扩展性

- 支持未来添加更多预设身份
- 可扩展自定义身份功能
- 可扩展身份组合功能
- 可扩展身份快捷切换功能
