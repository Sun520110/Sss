# 角色卡功能实施计划

## 一、功能概述

为AI Companion添加"角色卡"功能，允许用户创建、保存、管理多个AI角色配置。每个角色卡包含完整的AI设定（名字、头像、性格、身份、关系、背景故事等），用户可以快速切换不同角色进行对话。

## 二、当前状态分析

### 现有角色相关配置
- **性格模板**: `PERSONALITY_TEMPLATES` (17种预设性格)
- **身份定位**: `IDENTITY_TEMPLATES` (15种预设身份)
- **关系定位**: `RELATIONSHIP_LIST` (19种关系)
- **设置项**: `DEFAULT_SETTINGS` 包含 ai_name, ai_gender, ai_avatar, personality_id, identity, relationship, tone 等

### 存储方案
- 使用 `SecureStorage` 加密存储
- 设置键: `ai_companion_${sessionId}_settings`

## 三、角色卡数据结构

```javascript
const CHARACTER_CARD_SCHEMA = {
    id: '',                    // 唯一标识 (uuid)
    name: '',                  // 角色名称
    avatar: '',                // 头像 (emoji或图片URL)
    avatar_type: 'emoji',      // 头像类型: 'emoji' | 'image'
    description: '',           // 角色简介
    
    // 性格设定
    personality_id: 'default',
    custom_prompt: '',
    
    // 身份设定
    identity: 'none',
    profession: '',
    personality_traits: [],
    speaking_style: '',
    expertise_areas: [],
    
    // 关系设定
    relationship: 'friend',
    
    // 外观设定
    ai_gender: 'female',
    chat_background: 'default',
    chat_background_style: '',
    chat_background_image: '',
    
    // 行为设定
    tone: 'gentle',
    response_length: 'short',
    use_emojis: true,
    
    // 背景故事
    backstory: '',
    greeting: '',
    
    // 元数据
    created_at: '',
    updated_at: '',
    is_default: false,
    is_built_in: false
};
```

## 四、实施变更

### 文件1: www/static/character-card.js (新增)

角色卡管理核心逻辑：
- `CharacterCardManager` 类
- `BUILT_IN_CHARACTER_CARDS` 内置角色卡模板
- `createCard()`, `updateCard()`, `deleteCard()`, `getCard()`
- `applyCardToSession()`, `exportCard()`, `importCard()`
- 存储键: `ai_companion_character_cards`

### 文件2: www/static/ai-companion.js (修改)

修改点：
1. `DEFAULT_SETTINGS` 添加 `character_card_id: 'default_assistant'`
2. `AICompanion` 类构造函数加载角色卡
3. `buildSystemPrompt()` 优先使用角色卡配置
4. 新增 `loadCharacterCard()`, `applyCharacterCard()` 方法

### 文件3: www/index.html (修改)

新增内容：
1. **CSS样式**: 角色卡列表、卡片、编辑器样式
2. **设置面板新增"角色卡"section**:
   - 当前角色卡显示（头像、名称、简介、切换按钮）
   - "管理角色卡"按钮
   - "保存当前为角色卡"按钮
3. **角色卡管理弹窗** (`characterCardManagerOverlay`):
   - 角色卡网格列表
   - 新建/编辑/删除/导入/导出按钮
4. **角色卡编辑器弹窗** (`characterCardEditorOverlay`):
   - 分步骤表单（基本信息→性格→身份→关系→行为→背景）
   - 实时预览区域
5. **JavaScript函数**:
   - `openCharacterCardManager()`, `closeCharacterCardManager()`
   - `openCharacterCardEditor()`, `saveCharacterCard()`
   - `selectCharacterCard()`, `deleteCharacterCard()`
   - `saveCurrentAsCharacterCard()`
   - `renderCharacterCardList()`, `renderCurrentCharacterCard()`

### 文件4: ai-companion.js (同步修改)

与 `www/static/ai-companion.js` 保持同步

## 五、UI设计

### 设置面板 - 角色卡区域
```
┌─────────────────────────────┐
│ 🎭 角色卡                    │
├─────────────────────────────┤
│ 当前角色                     │
│ ┌────┬──────────┬────────┐ │
│ │ 🌟 │ 小星     │ [切换] │ │
│ │    │ 温柔体贴 │        │ │
│ └────┴──────────┴────────┘ │
│ [管理角色卡] [保存当前]     │
└─────────────────────────────┘
```

### 角色卡管理弹窗
```
┌─────────────────────────────────────┐
│ 角色卡管理              [×]         │
├─────────────────────────────────────┤
│ [搜索...] [新建] [导入]             │
├─────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │   🌟   │ │   👨‍🎓   │ │   [+]  │   │
│ │  小星  │ │  学生  │ │  新建  │   │
│ │[编辑×] │ │[编辑×] │ │        │   │
│ └────────┘ └────────┘ └────────┘   │
└─────────────────────────────────────┘
```

### 角色卡编辑器
```
┌─────────────────────────────────────┐
│ 编辑角色卡              [×]         │
├─────────────────────────────────────┤
│ 步骤: [1基本信息] [2性格] [3身份]   │
├─────────────────────────────────────┤
│ 头像: [🌟] 名称: [小星    ]         │
│ 简介: [温柔体贴的AI助手]            │
│                                     │
│ 性格: [默认助手 ▼]                  │
│ 自定义: [____________]              │
│                                     │
│ [上一步]        [下一步/保存]       │
└─────────────────────────────────────┘
```

## 六、与现有功能整合

1. **与会话关联**: 每个会话的 settings 中存储 `character_card_id`
2. **切换角色卡**: 调用 `companion.applyCharacterCard(cardId)` 立即生效
3. **数据迁移**: 首次加载时将现有配置保存为默认角色卡
4. **群聊支持**: 群聊成员可关联不同角色卡（未来扩展）

## 七、内置角色卡模板

至少提供3-5个内置角色卡：
1. **小星** (默认) - 温柔体贴的AI助手
2. **学霸小明** - 学生身份，活泼好奇
3. **李老师** - 教师身份，耐心博学
4. **保镖阿龙** - 保镖身份，忠诚可靠
5. **医生白** - 医生身份，专业严谨

## 八、验证步骤

1. 打开设置面板，验证"角色卡"区域显示正常
2. 点击"保存当前为角色卡"，验证新角色卡创建成功
3. 点击"管理角色卡"，验证角色卡列表显示
4. 点击"新建"，验证编辑器弹窗打开
5. 填写信息保存，验证新角色卡出现在列表
6. 点击角色卡"应用"，验证AI回复风格改变
7. 刷新页面，验证角色卡配置持久化
8. 导出角色卡，验证JSON文件下载
9. 导入角色卡，验证新角色卡创建
