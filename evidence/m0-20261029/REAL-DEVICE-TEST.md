# M0 真机测试说明（iPhone）

目标：验证 iOS 通知三态与震动手感，并确认 `tauri-plugin-notification` 的 UTC+8 修复在真机生效。

## 前置

- Xcode 27，iPhone 已连接并在 Xcode 中信任。
- Apple Development 证书/团队可用（本机证书 OU 为 `SSRKA7A4TN`，以你当前账号为准）。
- 真机 iOS 版本不限，但需与部署目标兼容。
- 不要使用生产库或 `*:production` 脚本；本轮 bundle 固定为 `com.personalfinance.console.smoke`。

## 构建与安装

推荐用 Xcode（签名最直观）：

```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2"
export NODE_ENV=development
export VITE_M0_LAB=1
open src-tauri/gen/apple/personal-finance-console.xcodeproj
```

在 Xcode：

1. 选择 `personal-finance-console_iOS` target。
2. Signing & Capabilities → Team 选你的开发团队；Bundle Identifier 保持 `com.personalfinance.console.smoke`。
3. 选择已连接的 iPhone，Run。
4. 首次启动若出现通知权限弹窗，点“允许”。

命令行构建（自动签名已配置时可用）：

```bash
export NODE_ENV=development
export VITE_M0_LAB=1
npx tauri ios build --target aarch64 \
  --config src-tauri/tauri.smoke.conf.json \
  --config src-tauri/tauri.m0lab.conf.json
```

设备构建**不要加** `--no-sign`。若 Xcode 报 team/provisioning，按 Xcode 的提示修 signing，不要改 bundle id。

## 测试步骤

1. **启动页**：应看到 3 块玻璃卡、200 行列表、SQLite “已有 1 条记录，本次启动未写入”（首次可能自动写入 1 条）。
2. **通知立即**：点“立即通知”。期望：顶部出现“M0 立即通知”横幅。
3. **通知定时**：
   - 点“1 分钟后定时通知”，看到“已排程 HH:MM:SS”。
   - 回到桌面（不要划掉 app），等待 1 分钟：期望出现“M0 定时通知 / 计划 HH:MM:SS 送达”。
   - 再点一次定时，随后从多任务上划掉 app（terminate），等待 1 分钟：期望桌面仍出现同一条定时横幅。
4. **震动**：点“震动”，应能感觉到一次约 400ms 的震动（模拟器无物理反馈，真机必须有）。
5. **记录**：截图/录屏，并记录设备时区（设置 → 通用 → 日期与时间）。通知失败时把 Xcode Console 的原生错误一并留下。

## 预期与排查

- 定时使用官方 `Schedule.at(new Date(Date.now() + 60_000))`；仓库已 vendored `tauri-plugin-notification 2.8.0` 并修复 `DateFormatter` 的 UTC 解析（见 `src-tauri/patches/tauri-plugin-notification/PATCH.md`）。
- 如果真机定时仍不送达：先确认时区不是 UTC+8 之外的异常设置，再抓 Xcode Console 中 `tauri_plugin_notification` 的错误；不要用 local-time workaround 掩盖问题。
- 通知三态的真机结果与模拟器应一致；模拟器证据见 `44-official-schedule-status.png`、`45-official-schedule-fire.png`、`46-official-background.png`、`47-official-terminated.png`。

## 边界

- 真机签名/安装由你完成；仓库不保存证书、provisioning profile 或设备 UDID。
- 本轮只验证 M0 lab，不改产品页面、模型、迁移或生产数据库。
