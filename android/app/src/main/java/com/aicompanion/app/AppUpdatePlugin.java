package com.aicompanion.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.File;

/**
 * APK自动更新插件
 * 处理APK文件的下载和安装
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    /**
     * 安装APK文件
     * @param call 包含fileUri参数
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        String fileUri = call.getString("fileUri");
        if (fileUri == null || fileUri.isEmpty()) {
            call.reject("文件路径不能为空");
            return;
        }

        try {
            Activity activity = getActivity();
            
            // 处理文件路径
            String filePath = fileUri;
            if (filePath.startsWith("file://")) {
                filePath = filePath.substring(7);
            }
            
            File apkFile = new File(filePath);
            if (!apkFile.exists()) {
                call.reject("APK文件不存在: " + filePath);
                return;
            }

            // 创建安装Intent
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Uri apkUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Android 7.0+ 使用FileProvider
                apkUri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    apkFile
                );
            } else {
                apkUri = Uri.fromFile(apkFile);
            }

            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            
            // 启动安装界面
            activity.startActivity(intent);
            
            call.resolve();
            
        } catch (Exception e) {
            call.reject("安装失败: " + e.getMessage());
        }
    }
}
