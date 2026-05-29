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

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecureStorage, secureStorage };
}
