> 当前状态更新（2026-10-30）：**M0 COMPLETED / OWNER_ACCEPTED**。Owner 已明确确认通知、声音、定时、划掉后通知和震动全部通过；见 [人工验收记录](OWNER-ACCEPTANCE-20261030.md)。以下为当时技术记录，其“待人工”项不再代表当前未完成事项。

# M0 通知装机验证（2026-10-30）

设备：林特的iPhone，00008140-001C55E91A40801C。devicectl 可见、connected、paired，开发者模式开启。设备时区 Asia/Shanghai，经设备 NSTimeZone 与原生通知日志双重读取。

原项目命令行构建、安装和启动成功。bundle id com.personalfinance.console.smoke，沿用 Team SSRKA7A4TN，未改签名配置。

- 前台立即通知：willPresent 回调已出现。
- 前台 1 分钟定时通知：排程 error=none，willPresent id=3 已出现。
- 后台 1 分钟定时通知：重新排程成功，命令打开设置后 UIApplication.applicationState=2；系统已送达列表记录 id=3，于 UTC 2026-10-29 18:33:08（设备本地 2026-10-30 02:33:08）送达，trigger interval=59.987170s。
- 震动：页面状态显示自动震动调用完成；物理手感未验收。
- 划掉 App 后通知：未用命令 terminate 替代手动上划；待人工实测。
- 横幅外观、声音、触感：待手机人工确认，不由 native add/willPresent 日志代替。

本轮补入项目内 swift-rs 构建补丁并固定 1.0.9；现有通知 UTC 修复保留。只将已有 Swift 诊断调用同时输出到标准输出，未改排程、权限和业务页面。devicectl --console 实际未带出这些原生日志；后通过命令行调试器将本次应用 stdout/stderr 临时写到应用自有 tmp 日志，以 devicectl copy from 取回原始日志。临时重定向已恢复，调试器已 detach。

证据：tauri_plugin_notification.log、device-native-all.log、delivered-notifications.txt、device-runtime-observations.json；最终构建 ios-build-stdout.log，安装 install-stdout.json，IPA 校验 final-ipa-sha256.txt。

人工最短清单：
1. 前台点“立即通知”和“震动”，确认横幅、声音和手感。
2. 点“1 分钟后定时通知”后回桌面或锁屏，等一分钟看通知。
3. 再安排一次一分钟通知，立即上划划掉 App，等一分钟看通知。
