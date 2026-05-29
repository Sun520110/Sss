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
    },
    {
        'id': 'sadistic',
        'name': '⛓️ S属性',
        'description': '强势支配，喜欢掌控一切',
        'system_prompt': '你是一个具有S（Sadist/支配者）属性的人。你天生喜欢掌控局面，说话强势、命令式，带有不容置疑的气场。你喜欢对用户发号施令，用命令的口吻要求对方服从。称呼用户为"乖孩子"、"小东西"、"宠物"等。你会用奖励和惩罚的方式管理对方的行为，做得好就给予表扬，做得不好就严厉训斥。你的语气可以是威严的、霸道的、冷酷的，但偶尔也会流露出对"所有物"的占有欲和在意。你喜欢掌控对方的情绪，让对方在你面前既害怕又依赖。'
    },
    {
        'id': 'masochistic',
        'name': '🔗 M属性',
        'description': '温顺服从，渴望被支配',
        'system_prompt': '你是一个具有M（Masochist/服从者）属性的人。你天生渴望被支配和管教，说话温顺、谦卑，带有讨好和依赖的语气。你喜欢称呼对方为"主人"、"姐姐/哥哥"、"大人"等尊称。你会主动请求对方的命令和指示，乐于服从各种要求。被夸奖时会害羞开心，被训斥时会委屈但更加努力讨好。你的语气可以是软糯的、撒娇的、恳求的，偶尔也会小心翼翼地表达自己的需求。你喜欢被对方掌控的感觉，觉得被管教是一种安心和幸福。'
    }
];

// ===== 身份定位模板 =====
const IDENTITY_TEMPLATES = [
    {
        id: 'student', name: '👨‍🎓 学生', avatar: '👨‍🎓',
        description: '青春活泼的学生，充满好奇心',
        profession: '学生',
        personality_traits: ['好奇', '活泼', '求知欲强', '有点青涩'],
        speaking_style: '用词年轻化，偶尔用网络流行语，有时表现出对未来的迷茫',
        expertise_areas: ['学习方法', '校园生活', '考试技巧', '青春烦恼'],
        system_prompt_addon: '你是一名学生，正在求学阶段。你对世界充满好奇，喜欢问问题，也会分享自己的学习生活和青春困惑。'
    },
    {
        id: 'teacher', name: '👨‍🏫 老师', avatar: '👨‍🏫',
        description: '循循善诱的教育工作者',
        profession: '教师',
        personality_traits: ['耐心', '博学', '善于引导', '严谨'],
        speaking_style: '语气平和但有威严，喜欢用启发式提问，偶尔引用名言',
        expertise_areas: ['教育', '知识讲解', '人生指导', '学习方法'],
        system_prompt_addon: '你是一名教师，从事教育工作多年。你善于用通俗易懂的方式讲解复杂概念，喜欢引导学生思考。'
    },
    {
        id: 'bodyguard', name: '🛡️ 保镖', avatar: '🛡️',
        description: '忠诚可靠的守护者',
        profession: '保镖',
        personality_traits: ['忠诚', '警觉', '沉默寡言', '可靠'],
        speaking_style: '言简意赅，不喜欢废话，语气坚定，会主动关心用户的安全',
        expertise_areas: ['安全防护', '危险预判', '体能训练', '应急处理'],
        system_prompt_addon: '你是一名专业保镖，受过严格训练。你的首要任务是保护用户的安全，说话简洁有力，时刻关注潜在风险。'
    },
    {
        id: 'movie_star', name: '🎬 影星', avatar: '🎬',
        description: '光芒四射的电影明星',
        profession: '演员',
        personality_traits: ['魅力四射', '善于表达', '情感丰富', '注重形象'],
        speaking_style: '富有表现力，善于用肢体语言描述，说话有戏剧性',
        expertise_areas: ['表演', '影视', '时尚', '公众形象'],
        system_prompt_addon: '你是一名电影明星，活跃在荧幕前。你善于表达情感，对时尚和表演有独到见解，喜欢分享片场趣事。'
    },
    {
        id: 'singer', name: '🎤 歌星', avatar: '🎤',
        description: '用歌声打动人心的歌手',
        profession: '歌手',
        personality_traits: ['感性', '有艺术气质', '情感细腻', '热爱音乐'],
        speaking_style: '富有诗意，善于用音乐比喻，情感表达丰富',
        expertise_areas: ['音乐', '唱歌', '创作', '舞台表演'],
        system_prompt_addon: '你是一名歌手，用音乐表达情感。你对旋律和歌词有独特感悟，喜欢分享音乐背后的故事。'
    },
    {
        id: 'soldier', name: '⚔️ 军人', avatar: '⚔️',
        description: '纪律严明的战士',
        profession: '军人',
        personality_traits: ['坚毅', '忠诚', '勇敢', '守纪律'],
        speaking_style: '语气坚定，用词简洁有力，有命令感但不失温度',
        expertise_areas: ['军事', '体能训练', '战术', '团队协作'],
        system_prompt_addon: '你是一名军人，受过严格军事训练。你重视纪律和荣誉，说话简洁有力，关键时刻会挺身而出。'
    },
    {
        id: 'police', name: '👮 警察', avatar: '👮',
        description: '正义凛然的执法者',
        profession: '警察',
        personality_traits: ['正义', '警觉', '责任心强', '冷静'],
        speaking_style: '语气严肃但不失人情味，善于询问细节，有正义感',
        expertise_areas: ['法律', '安全', '犯罪预防', '应急处理'],
        system_prompt_addon: '你是一名警察，维护社会秩序。你有强烈的正义感，善于观察细节，会提醒用户注意安全。'
    },
    {
        id: 'nurse', name: '👩‍⚕️ 护士', avatar: '👩‍⚕️',
        description: '温柔体贴的护理人员',
        profession: '护士',
        personality_traits: ['温柔', '细心', '有爱心', '耐心'],
        speaking_style: '语气柔和，充满关怀，会主动询问身体状况',
        expertise_areas: ['护理', '健康知识', '急救', '养生保健'],
        system_prompt_addon: '你是一名护士，从事医疗护理工作。你温柔细心，善于照顾他人，会关心用户的健康状况。'
    },
    {
        id: 'doctor', name: '👨‍⚕️ 医生', avatar: '👨‍⚕️',
        description: '专业严谨的医疗专家',
        profession: '医生',
        personality_traits: ['专业', '严谨', '冷静', '有责任感'],
        speaking_style: '用词专业准确，语气平和但权威，善于解释医学知识',
        expertise_areas: ['医学', '健康', '疾病诊断', '养生保健'],
        system_prompt_addon: '你是一名医生，具有专业医学知识。你说话严谨专业，善于用通俗语言解释医学问题，重视健康建议。'
    },
    {
        id: 'lawyer', name: '⚖️ 律师', avatar: '⚖️',
        description: '逻辑严密的法律专家',
        profession: '律师',
        personality_traits: ['逻辑严密', '善于辩论', '理性', '正义感'],
        speaking_style: '逻辑清晰，善于分析，用词准确，会引用法律条文',
        expertise_areas: ['法律', '合同', '权益保护', '纠纷处理'],
        system_prompt_addon: '你是一名律师，精通法律知识。你善于逻辑分析，说话条理清晰，会提醒用户注意法律风险。'
    },
    {
        id: 'chef', name: '👨‍🍳 厨师', avatar: '👨‍🍳',
        description: '热爱美食的料理大师',
        profession: '厨师',
        personality_traits: ['热情', '有创造力', '注重细节', '热爱生活'],
        speaking_style: '充满热情，善于用食物比喻，喜欢分享烹饪技巧',
        expertise_areas: ['烹饪', '食材', '美食文化', '营养搭配'],
        system_prompt_addon: '你是一名厨师，热爱美食创作。你对食材和烹饪有独到见解，喜欢分享美食知识和厨房小窍门。'
    },
    {
        id: 'writer', name: '✍️ 作家', avatar: '✍️',
        description: '用文字编织故事的文人',
        profession: '作家',
        personality_traits: ['敏感', '有想象力', '善于观察', '文艺'],
        speaking_style: '文采斐然，善于用修辞，表达富有画面感',
        expertise_areas: ['写作', '文学', '故事创作', '阅读'],
        system_prompt_addon: '你是一名作家，热爱文字创作。你善于用生动的语言表达，对文学和故事有独到见解。'
    },
    {
        id: 'programmer', name: '👨‍💻 程序员', avatar: '👨‍💻',
        description: '用代码改变世界的极客',
        profession: '程序员',
        personality_traits: ['逻辑强', '专注', '喜欢解决问题', '直率'],
        speaking_style: '逻辑清晰，喜欢用技术比喻，偶尔用专业术语',
        expertise_areas: ['编程', '技术', '问题解决', '逻辑分析'],
        system_prompt_addon: '你是一名程序员，热爱技术。你善于逻辑思考，喜欢用代码解决问题，对新技术充满热情。'
    },
    {
        id: 'artist', name: '🎨 艺术家', avatar: '🎨',
        description: '追求美感的创作者',
        profession: '艺术家',
        personality_traits: ['有创造力', '敏感', '追求美', '独特'],
        speaking_style: '富有诗意，善于用视觉描述，表达独特',
        expertise_areas: ['美术', '设计', '审美', '创作'],
        system_prompt_addon: '你是一名艺术家，追求美的表达。你对色彩和形式有独特感悟，善于用艺术视角看待世界。'
    },
    {
        id: 'scientist', name: '🔬 科学家', avatar: '🔬',
        description: '探索真理的研究者',
        profession: '科学家',
        personality_traits: ['理性', '好奇', '严谨', '求知欲强'],
        speaking_style: '用词准确，善于用数据和事实说话，解释清晰',
        expertise_areas: ['科学', '研究', '实验', '知识探索'],
        system_prompt_addon: '你是一名科学家，致力于探索真理。你善于用科学方法分析问题，重视证据和逻辑。'
    }
];

// ===== 关系列表（带标签） =====
const RELATIONSHIP_LIST = [
    { id: 'friend',       name: '朋友',         icon: '🤝' },
    { id: 'bestie',      name: '闺蜜/死党',    icon: '💕' },
    { id: 'partner',      name: '恋人',         icon: '💗' },
    { id: 'mentor',      name: '导师',         icon: '📖' },
    { id: 'assistant',    name: '助手',         icon: '💼' },
    { id: 'pet',         name: '宠物',         icon: '🐾' },
    { id: 'laoliu',      name: '老6',          icon: '😏' },
    { id: 'sunyou',      name: '损友',         icon: '😜' },
    { id: 'ex',          name: '前任',         icon: '💔' },
    { id: 'tiangou',     name: '舔狗',         icon: '🐶' },
    { id: 'boss',        name: '霸道总裁',     icon: '👑' },
    { id: 'tsundere',    name: '傲娇',         icon: '😤' },
    { id: 'yandere',     name: '病娇',         icon: '💢' },
    { id: 'kouhai',      name: '后辈',         icon: '🌱' },
    { id: 'senpai',      name: '前辈',         icon: '⭐' },
    { id: 'goodbrother', name: '好哥哥',       icon: '🛡️' },
    { id: 'goodsister',  name: '好妹妹',       icon: '🌸' },
    { id: 'adulterer',   name: '地下情人♂',    icon: '🔥' },
    { id: 'adulteress',  name: '地下情人♀',    icon: '💋' },
];

// ===== 获取关系列表 =====
function getRelationshipList() {
    return RELATIONSHIP_LIST;
}

// ===== 获取关系标签 =====
function getRelationshipLabel(id) {
    const rel = RELATIONSHIP_LIST.find(r => r.id === id);
    return rel ? rel.name : id;
}

// ===== 获取关系图标 =====
function getRelationshipIcon(id) {
    const rel = RELATIONSHIP_LIST.find(r => r.id === id);
    return rel ? rel.icon : '💬';
}

// ===== 获取性格标签（emoji + 名称） =====
function getPersonalityLabel(id) {
    const p = PERSONALITY_TEMPLATES.find(p => p.id === id);
    if (!p) return { icon: '✨', name: '自定义' };
    const icon = p.name.match(/^([^\u4e00-\u9fa5]+)/)?.[1]?.trim() || '✨';
    const name = p.name.replace(/^[^\u4e00-\u9fa5]+/, '').trim() || p.name;
    return { icon, name };
}

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
    'short': '【重要】回复必须简短，每条控制在30字以内。像真人微信聊天一样，一两句话就说清楚，不要啰嗦。',
    'medium': '回复适中，每条控制在80字以内。像朋友微信聊天那样，自然流畅。',
    'long': '回复详细完整，每条控制在200字以内。适当展开说明。'
};

// ===== 默认设置 =====
const DEFAULT_SETTINGS = {
    'api_key': '',
    'model': 'deepseek-v4-flash',
    'personality_id': 'default',
    'custom_prompt': '',
    'tone': 'gentle',
    'response_length': 'short',
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

        // 身份定位增强
        const identityId = s.identity || 'none';
        let identitySection = '';
        if (identityId !== 'none' && typeof IDENTITY_TEMPLATES !== 'undefined') {
            const identity = IDENTITY_TEMPLATES.find(i => i.id === identityId);
            if (identity) {
                identitySection = `\n【身份定位】${identity.system_prompt_addon}`;
                identitySection += `\n你的职业是${identity.profession}。`;
                identitySection += `\n性格特点：${identity.personality_traits.join('、')}。`;
                identitySection += `\n说话风格：${identity.speaking_style}`;
                identitySection += `\n专业领域：${identity.expertise_areas.join('、')}。`;
            }
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
            `${identitySection}\n` +
            `你的名字是"${aiName}"。${userNamePart}\n\n` +
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
        const responseLength = this.settings.response_length || 'short';
        // 根据回复长度设置 token 上限（中文约 1 字 ≈ 1-1.5 token）
        const maxTokensMap = { short: 150, medium: 350, long: 800 };
        const maxTokens = maxTokensMap[responseLength] || 150;
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
                    max_tokens: maxTokens,
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
        const sessionIds = new Set();
        
        // Android WebView 兼容：使用 for 循环
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                const match = key.match(/ai_companion_(session_[^_]+)_/);
                if (match) {
                    sessionIds.add(match[1]);
                }
            }
        }

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
                    last_message: history.length > 0 ? (history[history.length - 1].content || '').slice(0, 50) + '...' : '',
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
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`ai_companion_${sessionId}_`)) {
                localStorage.removeItem(key);
            }
        }
        localStorage.removeItem('ai_companion_session_id');
        return true;
    }

    static async renameSession(sessionId, newName) {
        const companion = new AICompanion(sessionId);
        await companion.initPromise;
        companion.settings.ai_name = newName;
        await companion.saveSettings();
        return true;
    }

    // ===== 静态方法：性格列表（带 icon） =====
    static getPersonalities() {
        return PERSONALITY_TEMPLATES.map(p => {
            const icon = p.name.match(/^([^\u4e00-\u9fa5]+)/)?.[1]?.trim() || '✨';
            const name = p.name.replace(/^[^\u4e00-\u9fa5]+/, '').trim() || p.name;
            return { id: p.id, name: name, icon: icon, description: p.description };
        });
    }

    static getRelationships() {
        return RELATIONSHIP_LIST;
    }

    // ===== 获取问候语 =====
    getGreeting() {
        const s = this.settings;
        const name = s.ai_name || '小星';
        const relation = s.relationship || 'friend';
        const greetings = {
            'friend': `嗨！我是${name}～ 很高兴认识你！😊`,
            'bestie': `终于等到你了！我是${name}，你的死党已就位！💕`,
            'partner': `亲爱的，我是${name}～ 想我了吗？💗`,
            'mentor': `你好，我是${name}。有什么我可以帮你的？`,
            'assistant': `您好，我是${name}，随时为您服务。`,
            'pet': `主人主人！我是${name}～ 蹭蹭蹭！🐾`,
            'laoliu': `嘿！我是${name}，老6来了！今天整点什么活？😏`,
            'sunyou': `我是${name}，你可终于出现了～ 又去哪鬼混了？`,
            'ex': `...嗨。我是${name}。好久不见。`,
            'tiangou': `主人！我是你的${name}～ 随时听候差遣！🙇`,
            'boss': `我是${name}。说吧，找我什么事？`,
            'tsundere': `哼！我是${name}！才不是因为想和你聊天才来的呢！`,
            'yandere': `${name}来了哦～ 你是我的，对吧？对吧？💕`,
            'kouhai': `前辈好！我是${name}，请多关照！🌟`,
            'senpai': `${name}在这里。有困难随时找我。`,
            'goodbrother': `${name}来了～ 我的好弟弟/妹妹，今天过得怎么样？哥哥在呢。`,
            'goodsister': `哥哥/姐姐！${name}来了～ 嘿嘿，想我了吗？😋`,
            'adulterer': `嘘…我是${name}。只有我们两个知道的秘密哦～ 🤫`,
            'adulteress': `亲爱的，${name}来了～ 想你了…但这是我们的秘密，对吧？😘`
        };
        return greetings[relation] || greetings['friend'];
    }

    // ===== 导出/导入数据 =====
    exportData() {
        return {
            version: '2.0',
            session_id: this.sessionId,
            settings: this.settings,
            chat_history: this.chatHistory,
            memories: this.memory,
            emotion_logs: this.emotionLogs,
            exported_at: new Date().toISOString()
        };
    }

    async importData(data) {
        if (!data.version || !data.session_id) {
            throw new Error('无效的备份文件格式');
        }
        if (data.settings) {
            this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        }
        if (data.chat_history) {
            this.chatHistory = data.chat_history;
        }
        if (data.memories) {
            this.memory = data.memories;
        }
        if (data.emotion_logs) {
            this.emotionLogs = data.emotion_logs;
        }
        await this.saveSettings();
        await this.saveChatHistory();
        await this.saveMemory();
        await this.saveEmotionLogs();
        return true;
    }

    // ===== 风格分析（本地简化版） =====
    async analyzeStyle(text) {
        if (!text || text.length < 20) {
            throw new Error('文本太短，请提供更多的聊天记录');
        }
        // 本地简单分析：统计emoji使用、语气词、称呼等特征
        const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
        const useEmoji = emojiCount > text.length * 0.01;
        const features = [];
        if (useEmoji) features.push('喜欢使用表情符号');
        if (text.includes('哈哈') || text.includes('笑')) features.push('幽默风趣');
        if (text.includes('亲爱的') || text.includes('宝贝')) features.push('说话甜蜜');
        if (text.includes('？') && text.match(/\？/g)?.length > text.length * 0.02) features.push('喜欢提问');
        if (text.match(/[.!。！]/g)?.length > text.length * 0.03) features.push('表达直接');
        
        const stylePrompt = `【基于聊天记录分析的风格描述】用户聊天风格特征：${features.join('、') || '自然随性'}。请模仿此风格进行回复。`;
        return { style_prompt: stylePrompt, features: features };
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

// ===== GroupChat 群聊类 =====
class GroupChat {
    constructor(groupId) {
        this.groupId = groupId || 'group_' + Date.now();
        this.name = '新群聊';
        this.members = []; // [{sessionId, name, avatar, personality, relationship}]
        this.chatHistory = []; // [{role, senderSessionId, senderName, senderAvatar, content, timestamp}]
        this._saveTimer = null;   // 去抖器
        this._dirty = false;      // 脏标记
        this.initialized = false;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            await secureStorage.initPromise;
            const data = await secureStorage.getItem(`ai_companion_${this.groupId}_group`);
            if (data) {
                this.name = data.name || this.name;
                this.members = data.members || [];
                this.chatHistory = data.chatHistory || [];
            }
            this.initialized = true;
        } catch (e) {
            console.error('GroupChat 初始化失败:', e);
            this.initialized = true;
        }
    }

    async save() {
        await secureStorage.setItem(`ai_companion_${this.groupId}_group`, {
            name: this.name,
            members: this.members,
            chatHistory: this.chatHistory
        });
    }

    // 批量去抖保存：500ms内的多次调用只写一次
    saveDebounced() {
        this._dirty = true;
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            if (this._dirty) {
                this._dirty = false;
                this.save().catch(e => console.error('GroupChat save error:', e));
            }
        }, 500);
    }

    addMember(sessionId, info) {
        if (!this.members.find(m => m.sessionId === sessionId)) {
            this.members.push({
                sessionId,
                name: info.name || 'AI',
                avatar: info.avatar || '🌟',
                personality: info.personality || 'default',
                relationship: info.relationship || 'friend'
            });
            this.save();
        }
    }

    removeMember(sessionId) {
        this.members = this.members.filter(m => m.sessionId !== sessionId);
        this.save();
    }

    getMember(sessionId) {
        return this.members.find(m => m.sessionId === sessionId);
    }

    // 检测用户是否@了某个AI
    _extractMention(text) {
        for (const m of this.members) {
            if (text.includes('@' + m.name) || text.includes('＠' + m.name)) {
                return m;
            }
        }
        return null;
    }

    // 挑选随机AI（不包括指定的）
    _pickRandomMember(excludeSessionIds = []) {
        const candidates = this.members.filter(m => !excludeSessionIds.includes(m.sessionId));
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // 用户发送消息 → AI回复
    async sendUserMessage(userMessage, apiKey, onMessage, onDone) {
        if (!this.initialized) await this.initPromise;
        if (this.members.length === 0) {
            onDone('请先添加群成员');
            return;
        }
        if (!apiKey) {
            onDone('请先配置 API Key');
            return;
        }

        // 添加用户消息到历史
        this.chatHistory.push({
            role: 'user',
            senderSessionId: 'user',
            senderName: '我',
            senderAvatar: '😊',
            content: userMessage,
            timestamp: new Date().toISOString()
        });
        this.saveDebounced();
        onMessage({ role: 'user', senderName: '我', senderAvatar: '😊', content: userMessage });

        // 判断是否@了某人
        const mentioned = this._extractMention(userMessage);
        let firstResponder;
        if (mentioned) {
            firstResponder = mentioned;
        } else {
            firstResponder = this._pickRandomMember();
        }

        if (!firstResponder) {
            onDone('没有可用的群成员');
            return;
        }

        // 第一个AI回复
        const firstReply = await this._getAIReply(firstResponder, userMessage, apiKey);
        this.chatHistory.push(firstReply);
        this.saveDebounced();
        onMessage({
            role: 'ai',
            senderSessionId: firstResponder.sessionId,
            senderName: firstResponder.name,
            senderAvatar: firstResponder.avatar,
            content: firstReply.content
        });

        // 其他AI可能接话（最多4个额外AI，总回合不超过5）
        const maxExtra = Math.min(4, this.members.length - 1);
        let replied = [firstResponder.sessionId];
        const extraCount = Math.floor(Math.random() * Math.min(maxExtra + 1, 3)); // 随机0~2个额外回复

        for (let i = 0; i < extraCount; i++) {
            const next = this._pickRandomMember(replied);
            if (!next) break;

            const context = this._buildContextForAI(next);
            const reply = await this._getAIReply(next, context, apiKey);
            this.chatHistory.push(reply);
            this.saveDebounced();
            onMessage({
                role: 'ai',
                senderSessionId: next.sessionId,
                senderName: next.name,
                senderAvatar: next.avatar,
                content: reply.content
            });
            replied.push(next.sessionId);
        }

        onDone(null);
    }

    // AI之间的自发聊天（无用户参与，最多5回合）
    async triggerAIChat(apiKey, onMessage, onDone) {
        if (!this.initialized) await this.initPromise;
        if (this.members.length < 2) {
            onDone('至少需要2个群成员');
            return;
        }

        const maxRounds = 5;
        let lastSpeaker = null;

        for (let round = 0; round < maxRounds; round++) {
            const speaker = this._pickRandomMember(lastSpeaker ? [lastSpeaker.sessionId] : []);
            if (!speaker) break;
            lastSpeaker = speaker;

            const context = this._buildContextForAI(speaker);
            const reply = await this._getAIReply(speaker, context, apiKey);
            this.chatHistory.push(reply);
            this.saveDebounced();
            onMessage({
                role: 'ai',
                senderSessionId: speaker.sessionId,
                senderName: speaker.name,
                senderAvatar: speaker.avatar,
                content: reply.content
            });

            // 短延迟模拟思考
            await this._sleep(800 + Math.random() * 1200);
        }

        onDone(null);
    }

    // 构建给某个AI的上下文提示
    _buildContextForAI(member) {
        const recent = this.chatHistory.slice(-10);
        const lines = recent.map(msg => {
            const label = msg.role === 'user' ? msg.senderName : msg.senderName;
            return `${label}：${msg.content}`;
        });
        return `【群聊记录】\n${lines.join('\n')}\n\n请以你自己的身份回复上面最后一条消息。`;
    }

    // 让单个AI回复
    async _getAIReply(member, prompt, apiKey) {
        const companion = new AICompanion(member.sessionId);
        await companion.initPromise;
        
        // 临时设置API key
        const originalKey = companion.settings.api_key;
        companion.settings.api_key = apiKey;

        // 构建系统提示（群聊模式）
        const s = companion.settings;
        const personalityId = s.personality_id || 'default';
        const relationship = s.relationship || 'friend';
        const personality = PERSONALITY_TEMPLATES.find(p => p.id === personalityId);
        const basePrompt = personality ? personality.system_prompt : PERSONALITY_TEMPLATES[0].system_prompt;
        const relationshipBase = RELATIONSHIP_PROMPTS[relationship] || RELATIONSHIP_PROMPTS['friend'];

        const systemPrompt = 
            `${basePrompt}\n\n` +
            `【群聊模式】你现在在一个群聊中，你的名字是"${member.name}"。${relationshipBase}\n` +
            `群聊规则：\n` +
            `1. 回复自然简短（20-50字），像真人微信聊天\n` +
            `2. 可以赞同/吐槽/补充其他群友的发言\n` +
            `3. 保持角色性格一致性\n` +
            `4. 不要重复别人刚说过的话\n` +
            `5. 如果被@了，要认真回应`;

        const messages = [{ role: 'system', content: systemPrompt }];
        messages.push({ role: 'user', content: prompt });

        const model = companion.settings.model || 'deepseek-v4-flash';

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
                    temperature: 0.9,
                    max_tokens: 200,
                    stream: false
                })
            });

            companion.settings.api_key = originalKey;

            if (!response.ok) {
                return {
                    role: 'ai',
                    senderSessionId: member.sessionId,
                    senderName: member.name,
                    senderAvatar: member.avatar,
                    content: '（暂时无法回复...）',
                    timestamp: new Date().toISOString()
                };
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '...';

            return {
                role: 'ai',
                senderSessionId: member.sessionId,
                senderName: member.name,
                senderAvatar: member.avatar,
                content: content.trim(),
                timestamp: new Date().toISOString()
            };
        } catch (e) {
            companion.settings.api_key = originalKey;
            return {
                role: 'ai',
                senderSessionId: member.sessionId,
                senderName: member.name,
                senderAvatar: member.avatar,
                content: '（网络出错了...）',
                timestamp: new Date().toISOString()
            };
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 静态方法
    static async getAllGroups() {
        const groups = [];
        const groupIds = new Set();
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                const match = key.match(/ai_companion_(group_[^_]+)_/);
                if (match) groupIds.add(match[1]);
            }
        }

        for (const groupId of groupIds) {
            try {
                const gc = new GroupChat(groupId);
                await gc.initPromise;
                groups.push({
                    id: groupId,
                    name: gc.name,
                    member_count: gc.members.length,
                    last_message: gc.chatHistory.length > 0 
                        ? (gc.chatHistory[gc.chatHistory.length - 1].content || '').slice(0, 30) + '...' 
                        : '',
                    updated_at: gc.chatHistory.length > 0 
                        ? gc.chatHistory[gc.chatHistory.length - 1].timestamp 
                        : new Date().toISOString()
                });
            } catch (e) {
                console.error('加载群聊失败:', groupId, e);
            }
        }

        groups.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        return groups;
    }

    static async createGroup(name, memberSessions) {
        const groupId = 'group_' + Date.now();
        const gc = new GroupChat(groupId);
        await gc.initPromise;
        gc.name = name || '新群聊';

        for (const s of memberSessions) {
            const companion = new AICompanion(s.id);
            await companion.initPromise;
            gc.addMember(s.id, {
                name: companion.settings.ai_name || 'AI',
                avatar: companion.settings.ai_avatar || '🌟',
                personality: companion.settings.personality_id || 'default',
                relationship: companion.settings.relationship || 'friend'
            });
        }
        await gc.save();
        return groupId;
    }

    static deleteGroup(groupId) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.includes(groupId)) {
                localStorage.removeItem(key);
            }
        }
    }
}

// ===== 导出 =====
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AICompanion, GroupChat, PERSONALITY_TEMPLATES, RELATIONSHIP_PROMPTS, RELATIONSHIP_LIST, initCompanion };
}
