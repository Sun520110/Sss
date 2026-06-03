# APK版本自动更新功能实施计划

## 一、功能概述

为AI Companion应用添加APK版本自动更新功能，通过GitHub Release作为更新源，在应用启动时或用户手动触发时检查新版本，下载并安装更新。

## 二、当前状态分析

### 版本管理现状
| 文件 | 当前值 | 用途 |
|------|--------|------|
| `VERSION` | 1.2.0 | 项目版本标识 |
| `build.gradle` versionName | 1.2.0 | Android显示版本 |
| `build.gradle` versionCode | 4 | Android内部版本号 |

### 技术栈
- Capacitor 8.x 框架
- GitHub Releases 作为APK托管
- 当前无自动更新机制

## 三、更新方案设计

### 更新源
- **GitHub API**: `GET https://api.github.com/repos/Sun520110/Sss/releases/latest`
- **APK下载**: Release Assets中的APK文件

### 更新检测流程
```
应用启动 → 读取本地版本 → 检查冷却时间 → 调用GitHub API → 比较版本 → 提示更新 → 下载 → 安装
```

### 版本比较逻辑
- 比较versionName（语义化版本）
- 比较versionCode（整数，用于精确判断）
- 支持冷却时间（默认24小时检查一次）

## 四、实施变更

### 文件1: package.json
添加Capacitor插件依赖：
```json
{
  "dependencies": {
    "@capacitor/app": "^6.0.0",
    "@capacitor/filesystem": "^6.0.0"
  }
}
```

### 文件2: www/static/update-manager.js（新增）
核心更新管理器，包含：
- `UpdateManager` 类
- `checkForUpdate()` - 检查更新
- `downloadAndInstall()` - 下载安装
- `compareVersion()` - 版本比较
- `init()` - 初始化获取当前版本

### 文件3: android/app/src/main/java/com/aicompanion/app/AppUpdatePlugin.java（新增）
Android原生插件，处理APK安装：
- `installApk()` 方法
- 使用FileProvider处理文件URI
- 调用系统Intent安装APK

### 文件4: android/app/src/main/AndroidManifest.xml
添加权限：
```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

### 文件5: android/app/src/main/java/com/aicompanion/app/MainActivity.java
注册自定义插件：
```java
registerPlugin(AppUpdatePlugin.class);
```

### 文件6: www/index.html
添加：
- 引入`update-manager.js`
- 更新提示UI组件（弹窗、进度条）
- 设置页面"检查更新"按钮
- 应用启动时自动检查更新逻辑

### 文件7: www/static/version.json（新增，构建时生成）
本地版本信息文件：
```json
{
  "version": "1.2.0",
  "versionCode": 4
}
```

## 五、UI设计

### 更新提示弹窗
- 新版本号、更新日志、文件大小
- 按钮：立即更新、稍后提醒、忽略此版本
- 与现有设置面板风格一致

### 下载进度
- 进度条、已下载/总大小
- 取消下载按钮

### 设置页面
- 显示当前版本
- "检查更新"按钮
- 更新状态显示

## 六、关键代码结构

### UpdateManager核心方法
```javascript
class UpdateManager {
  async init() // 获取当前版本
  async checkForUpdate(force) // 检查更新
  async downloadAndInstall(info, onProgress) // 下载安装
  compareVersion(v1, v2) // 版本比较
}
```

### 自动检查触发点
- 应用启动时（initApp中调用）
- 用户手动检查（设置页面按钮）
- 冷却时间控制（避免频繁检查）

## 七、安全与权限

### Android权限
- `REQUEST_INSTALL_PACKAGES` - 安装APK权限
- `INTERNET` - 网络访问（已存在）
- FileProvider配置（已存在）

### 安全措施
- HTTPS强制（GitHub API和下载链接）
- 相同证书签名验证（Android系统处理）
- 用户确认后才下载安装

## 八、验证步骤

1. 构建新版本APK并上传到GitHub Release
2. 安装旧版本APK到设备
3. 启动应用，验证自动检测到更新
4. 点击更新，验证下载进度显示
5. 下载完成，验证系统安装界面弹出
6. 安装完成，验证版本已更新

## 九、发布流程配合

每次发布新版本时：
1. 更新`VERSION`文件版本号
2. 更新`build.gradle`中的versionCode和versionName
3. 构建APK
4. 创建GitHub Release，上传APK
5. Release notes中包含versionCode信息
