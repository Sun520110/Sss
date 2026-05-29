/**
 * AI Companion APK自动更新管理器
 * 通过GitHub Release检查并下载更新
 */

class UpdateManager {
    constructor(config = {}) {
        this.config = {
            githubOwner: config.githubOwner || 'Sun520110',
            githubRepo: config.githubRepo || 'Sss',
            checkInterval: config.checkInterval || 24 * 60 * 60 * 1000, // 24小时
            ...config
        };
        
        this.storageKey = 'ai_companion_update';
        this.currentVersion = null;
        this.currentVersionCode = null;
        this.isChecking = false;
        this.downloadAbortController = null;
    }

    // 初始化，获取当前版本
    async init() {
        try {
            // 尝试从Capacitor获取版本
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                const appInfo = await window.Capacitor.Plugins.App.getInfo();
                this.currentVersion = appInfo.version;
                this.currentVersionCode = parseInt(appInfo.build);
            } else {
                // 回退到本地version.json
                const response = await fetch('static/version.json?v=' + Date.now());
                const data = await response.json();
                this.currentVersion = data.version;
                this.currentVersionCode = data.versionCode;
            }
            console.log('[Update] 当前版本:', this.currentVersion, 'versionCode:', this.currentVersionCode);
        } catch (error) {
            console.error('[Update] 初始化失败:', error);
            // 使用默认值
            this.currentVersion = '1.2.0';
            this.currentVersionCode = 4;
        }
    }

    // 获取当前版本字符串（用于显示）
    getCurrentVersion() {
        return this.currentVersion || '1.2.0';
    }

    // 检查是否需要检查更新（基于冷却时间）
    shouldCheck() {
        const lastCheck = localStorage.getItem(`${this.storageKey}_last_check`);
        if (!lastCheck) return true;
        
        const elapsed = Date.now() - parseInt(lastCheck);
        return elapsed > this.config.checkInterval;
    }

    // 检查更新
    async checkForUpdate(force = false) {
        if (this.isChecking) return { hasUpdate: false, reason: '检查中' };
        
        if (!force && !this.shouldCheck()) {
            return { hasUpdate: false, reason: '冷却中' };
        }

        this.isChecking = true;

        try {
            const response = await fetch(
                `https://api.github.com/repos/${this.config.githubOwner}/${this.config.githubRepo}/releases/latest`,
                {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'AI-Companion-App'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`API错误: ${response.status}`);
            }

            const release = await response.json();
            
            // 解析版本号
            const remoteVersion = release.tag_name.replace(/^v/, '');
            const remoteVersionCode = this.extractVersionCode(release.body) || 
                                      this.versionToCode(remoteVersion);

            // 保存检查时间
            localStorage.setItem(`${this.storageKey}_last_check`, Date.now());

            // 比较版本
            const comparison = this.compareVersion(remoteVersion, this.currentVersion);
            const hasUpdate = comparison > 0 || 
                             (comparison === 0 && remoteVersionCode > this.currentVersionCode);

            if (hasUpdate) {
                // 查找APK资源
                const apkAsset = release.assets.find(asset => 
                    asset.name.endsWith('.apk')
                );

                return {
                    hasUpdate: true,
                    version: remoteVersion,
                    versionCode: remoteVersionCode,
                    changelog: release.body,
                    downloadUrl: apkAsset?.browser_download_url,
                    fileSize: apkAsset?.size,
                    publishedAt: release.published_at
                };
            }

            return { hasUpdate: false };

        } catch (error) {
            console.error('[Update] 检查更新失败:', error);
            return { hasUpdate: false, error: error.message };
        } finally {
            this.isChecking = false;
        }
    }

    // 版本号转versionCode（备用）
    versionToCode(version) {
        const parts = version.split('.').map(Number);
        return parts[0] * 10000 + parts[1] * 100 + (parts[2] || 0);
    }

    // 从release notes提取versionCode
    extractVersionCode(body) {
        if (!body) return null;
        const match = body.match(/versionCode[\s:]*(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }

    // 比较版本号
    compareVersion(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const a = parts1[i] || 0;
            const b = parts2[i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (!bytes) return '未知';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // 下载并安装
    async downloadAndInstall(updateInfo, onProgress) {
        if (!updateInfo.downloadUrl) {
            throw new Error('下载链接不可用');
        }

        this.downloadAbortController = new AbortController();

        try {
            // 使用fetch下载
            const response = await fetch(updateInfo.downloadUrl, {
                signal: this.downloadAbortController.signal,
                headers: {
                    'Accept': 'application/vnd.android.package-archive'
                }
            });

            if (!response.ok) {
                throw new Error(`下载失败: ${response.status}`);
            }

            const totalSize = parseInt(response.headers.get('content-length')) || updateInfo.fileSize || 0;
            const reader = response.body.getReader();
            
            let receivedSize = 0;
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                receivedSize += value.length;
                
                // 报告进度
                const progress = totalSize > 0 ? Math.round((receivedSize / totalSize) * 100) : 0;
                if (onProgress) onProgress(progress, receivedSize, totalSize);
            }

            // 合并chunks并转换为base64
            const blob = new Blob(chunks);
            const arrayBuffer = await blob.arrayBuffer();
            const base64Data = this.arrayBufferToBase64(arrayBuffer);

            // 保存到文件系统
            let fileUri;
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                const { Filesystem, Directory } = window.Capacitor.Plugins.Filesystem;
                const fileName = `ai-companion-update-${Date.now()}.apk`;
                
                await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Cache,
                    recursive: true
                });

                const result = await Filesystem.getUri({
                    path: fileName,
                    directory: Directory.Cache
                });

                fileUri = result.uri;
            } else {
                // Web环境：创建blob URL
                const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
                fileUri = URL.createObjectURL(blob);
            }

            // 调用安装
            await this.installApk(fileUri);

            return { success: true };

        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('下载已取消');
            }
            throw error;
        }
    }

    // ArrayBuffer转Base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // 安装APK
    async installApk(fileUri) {
        // 使用自定义插件
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppUpdate) {
            await window.Capacitor.Plugins.AppUpdate.installApk({ fileUri });
        } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
            // 备用：使用浏览器打开
            await window.Capacitor.Plugins.Browser.open({ url: fileUri });
        } else {
            // Web环境：直接打开
            window.open(fileUri, '_blank');
        }
    }

    // 取消下载
    cancelDownload() {
        if (this.downloadAbortController) {
            this.downloadAbortController.abort();
            this.downloadAbortController = null;
        }
    }

    // 忽略此版本
    ignoreVersion(version) {
        localStorage.setItem(`${this.storageKey}_ignored`, version);
    }

    // 检查是否已忽略
    isIgnored(version) {
        return localStorage.getItem(`${this.storageKey}_ignored`) === version;
    }
}

// 创建全局实例
const updateManager = new UpdateManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UpdateManager, updateManager };
}
