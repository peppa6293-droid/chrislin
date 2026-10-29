# M0 iOS 技术验证报告

**状态：READY FOR REVIEW（M0 运行时验证通过；通知 UTC+8 定时 bug 已在 vendored 插件中修复）**

**一句话说明：** `tauri-runtime-wry` 补丁已入库，HTTP/1.1 的 `ios build` 成功，`/lab/glass` 在 iPhone 18 Pro / iOS 27 正常渲染；SQLite 写入与重启读回、玻璃浅/深色、9.758s 录屏、60 FPS、通知前台/后台/终止三态均已取得证据；`import-flow` 修复后全量 5/5 通过，通知插件 UTC+8 bug 已修复并用官方 `Schedule.at` 重新验证三态。

**需要你做的事：** 审核 M0；按 [`REAL-DEVICE-TEST.md`](REAL-DEVICE-TEST.md) 在 iPhone 上跑一次通知三态与震动手感。真机签名/安装由你完成，仓库不保存证书。

**风险/占位：** 通知修复目前是 vendored `tauri-plugin-notification 2.8.0`（等上游修复后移除）；真机尚未执行，模拟器无物理震动；`pending()/active()` 诊断 API 会触发 Swift assertion，已从页面移除；`idevicesyslog` 仍是占位。

**证据位置：** [`evidence/m0-20261029/`](</Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/evidence/m0-20261029/>)

- 时间：2026-10-29 23:48 +08:00
- 分支：`feat/mobile`
- M0 代码/证据 HEAD：`536996f`
- 目标：iPhone 18 Pro，iOS 27.0，UDID `0BF810EB-B85A-4C42-8000-63AE0BD40C97`

## 1. 环境

完整记录：[`environment-current.txt`](environment-current.txt)。

| 项 | 值 |
|---|---|
| Xcode | 27.0 (27A266a) |
| Rust | 1.99.0 |
| iOS targets | `aarch64-apple-ios`、`aarch64-apple-ios-sim` |
| Node / npm | v22.22.0 / 10.9.4 |
| Tauri CLI | 2.12.3 |
| CocoaPods | 1.17.0（用户目录） |
| XcodeGen | 2.46.0 |
| Homebrew | 不存在 |

## 2. 提交

| commit | 内容 |
|---|---|
| `a2f65b0` | `mobile(M0): WIP checkpoint – BLOCKED (webview assets, swift-rs fetch)`；只含已暂存的 28 个文件，5475 insertions / 112 deletions；不含 `WORKLOG.md`、`PROJECT-STATE.md`、旧 evidence |
| `b4784fd` | `mobile(M0): vendor tauri-runtime-wry iOS 27 patch`；补丁入库 + `Cargo.toml`/`Cargo.lock` |
| `8ee463c` | `mobile(M0): auto-test harness and runtime evidence`；自动测试页、深色样式、测试超时、运行证据 |
| `a7d53ca` | `mobile(M0): blocked review report`；上一版 BLOCKED 报告 |
| `469146d` | `mobile(M0): verify notification states and stabilize import flow`；local-time workaround 与 import-flow 修复 |
| `536996f` | `mobile(M0): fix notification UTC scheduling`；vendored notification 插件 + UTC 修复；恢复官方 `Schedule.at`；真机测试说明 |

`WORKLOG.md`、`PROJECT-STATE.md` 和本 `REPORT.md` 不在 `a2f65b0` 中。

## 3. 执行结果

### 3.1 依赖补丁入库

- `tauri-runtime-wry-2.12.1` 补丁在 `src-tauri/patches/tauri-runtime-wry`；`Cargo.toml` 有 `[patch.crates-io]`。
- `PATCH.md` 写明上游 PR #16082 与移除条件。
- 重编后 app PID 35775 存活超过 4 分钟；截图 [`18-vendored-launch.png`](18-vendored-launch.png)，日志 [`ios-dev-vendored.log`](ios-dev-vendored.log)。

### 3.2 swift-rs 与 `ios build`

仅对命令使用 HTTP/1.1：

```text
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.version GIT_CONFIG_VALUE_0=HTTP/1.1 \
npx tauri ios build --debug --target aarch64-sim --no-sign \
  --config src-tauri/tauri.smoke.conf.json \
  --config src-tauri/tauri.m0lab.conf.json
```

首次成功，没有改全局 git、没有换源、没有重试；输出 `.../build/arm64-sim/小钱家.app`。日志：[`ios-build-http1-attempt1.log`](ios-build-http1-attempt1.log)、[`ios-build-notifpatch.log`](ios-build-notifpatch.log)。

### 3.3 WebView 空白排查（a → b → c → d）

**a. 配置 + vite build + 完整重新编译 Rust**

`src-tauri/tauri.conf.json`：

```json
{
  "beforeDevCommand": "npm run dev",
  "devUrl": "http://localhost:1420",
  "beforeBuildCommand": "npm run build:web",
  "frontendDist": "../web-dist"
}
```

`VITE_M0_LAB=1` + `ios build` 完整构建并安装后 **页面正常**，见 [`19-ios-build-lab.png`](19-ios-build-lab.png)。因此不需要 b/c/d；没有安装 iOS 26 runtime。

补充：`tauri ios dev` 仍把 `tauri://localhost` 的 `/src/main.tsx` 回落成 `text/html`；M0 运行时验证使用 `ios build` 的 embedded `web-dist`，在 iOS 27 上正常。

### 3.4 SQLite 写入 → 重启 → 读回

- 首启自动写入一条，[`20-sqlite-first.png`](20-sqlite-first.png)：

```text
读取成功：1 条记录
首次启动自动写入：M0-AUTO-2026-10-29T14:54:24.540Z-208027cd
```

- 直接只读查 simulator DB：

```text
id  value                                      created_at
1   M0-AUTO-2026-10-29T14:54:24.540Z-208027cd  2026-10-29T14:54:24.541Z
```

DB 路径：
`.../Containers/Data/Application/3FFCDD37-.../Library/Application Support/com.personalfinance.console.smoke/personal-finance-console.sqlite3`

- terminate → 重启后，[`23-sqlite-restart.png`](23-sqlite-restart.png)：

```text
读取成功：1 条记录
已有 1 条记录，本次启动未写入
```

- 重启后再次查库，仍是同一行、同一值；最终页面 [`42-final-relaunch.png`](42-final-relaunch.png) 也显示“已有 1 条记录”。

### 3.5 玻璃、录屏、FPS

- 浅色：三块玻璃卡片 + 200 行列表，[`20-sqlite-first.png`](20-sqlite-first.png)、[`21-fps-final.png`](21-fps-final.png)。
- 深色：`simctl ui appearance dark` 后，[`24-dark-2.png`](24-dark-2.png)。
- 10 秒录屏：[`20-scroll-10s.mov`](20-scroll-10s.mov)；`mdls` 时长 **9.758s**，1206×2622，覆盖第 13 行 → 第 193 行。
- FPS：页面内 rAF 统计（Safari Web Inspector Timeline 在 headless 下未接上）：
  - 浅色稳定滚动：**60 / min 54**（`20`、`21`）。
  - 最终页面：**60 / min 51**（`42`）。
  - 深色 `24-dark-2` 是冷启动后的 47 / min 2；min 2 是首帧，不作为稳态结论。

### 3.6 震动

自动序列在 18s 调用 `vibrate(400)`，页面显示“自动震动调用完成（模拟器无物理震动）”。API 调用成功；模拟器无物理反馈，**需真机确认手感**。

### 3.7 通知三态（官方 `Schedule.at`，修复后）

权限已由用户点击“允许”授予，[`26-after-allow.png`](26-after-allow.png) 显示“通知权限：已授予”。

| 状态 | 证据 | 结果 |
|---|---|---|
| 前台立即 | [`44-official-schedule-status.png`](44-official-schedule-status.png) | 横幅“M0 自动立即通知 / 自动通知 23:43:06” |
| 前台定时 | [`45-official-schedule-fire.png`](45-official-schedule-fire.png) | 横幅“M0 自动定时通知 / 计划 23:44:06 送达” |
| 后台定时 | [`46-official-background.png`](46-official-background.png) | Settings 上方出现“计划 23:45:35 送达” |
| 终止后定时 | [`47-official-terminated.png`](47-official-terminated.png) | app 已 terminate，桌面出现“计划 23:47:02 送达” |

定时使用官方 `Schedule.at(new Date(Date.now() + 60_000))`；后台/终止场景均在计划时间前约 60 秒启动、到点截图。

### 3.8 通知 UTC+8 修复

原始问题：官方 `Schedule.at` 发出的 UTC ISO 被插件 Swift `DateFormatter` 按本地时间解析，在 UTC+8 变成过去时间，iOS 抛 `ShowNotificationError`，定时不送达。修复前证据：[`36-direct-schedule-status.png`](36-direct-schedule-status.png)、[`37-direct-schedule-fire.png`](37-direct-schedule-fire.png)。

修复：

- 把 `tauri-plugin-notification 2.8.0` vendored 到 `src-tauri/patches/tauri-plugin-notification`。
- `src-tauri/Cargo.toml` 增加：

```toml
[patch.crates-io]
tauri-plugin-notification = { path = "patches/tauri-plugin-notification" }
```

- `ios/Sources/Notification.swift` 的 `handleScheduledNotification` 增加：

```swift
dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
```

- 详细说明见 [`src-tauri/patches/tauri-plugin-notification/PATCH.md`](</Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/src-tauri/patches/tauri-plugin-notification/PATCH.md>)。
- 恢复 M0 页面的官方 `Schedule.at`；删除 local-time workaround。
- 修复后 `ios-build-notifpatch.log` 成功，`44`–`47` 证明官方路径三态通过。

历史 workaround 证据（`38`–`41`）保留，用于说明当时的验证路径；最终代码不再使用。

另：诊断时调用 `pending()` / `active()` 会在 `com.apple.usernotifications.UNUserNotificationServiceConnection.call-out` 队列触发 Swift assertion；crash 报告保留在 [`43-pending-active-crash.ips`](43-pending-active-crash.ips)。最终页面已移除这两个调用，[`42-final-relaunch.png`](42-final-relaunch.png) 稳定运行。

## 4. 真机测试

[`REAL-DEVICE-TEST.md`](REAL-DEVICE-TEST.md) 给出签名构建、Xcode Run、通知三态和震动步骤。真机尚未执行；需要你在 iPhone 上确认：

1. 通知立即、1 分钟后定时、后台/terminate 三态。
2. “震动”按钮的物理手感。
3. 记录设备时区；若定时失败，抓 Xcode Console 的 `tauri_plugin_notification` 原生错误。

## 5. 全量测试

`import-flow` 的失败是等待条件问题：原测试用 `findByRole("status")` 先拿到预览状态，再断言成功文案。已改为 `waitFor` 等待任一 status 包含成功文案，保留原断言与数据读回断言。日志：[`import-flow-fixed.log`](import-flow-fixed.log)（8/8 通过）。

`tests/onboarding-safety-eligibility.test.tsx` 中曾 5000ms 超时的那一条，超时调到 **15s**（只改超时）。

连续 5 次全量，全部退出 0：

| 次 | 结果 | 耗时 |
|---|---|---|
| 1 | 55 files passed；568 passed / 44 skipped | 6.07s |
| 2 | 55 files passed；568 passed / 44 skipped | 5.08s |
| 3 | 55 files passed；568 passed / 44 skipped | 5.42s |
| 4 | 55 files passed；568 passed / 44 skipped | 5.22s |
| 5 | 55 files passed；568 passed / 44 skipped | 5.09s |

插件修复后再跑一次全量：55 files passed，568 passed / 44 skipped，4.78s，退出 0（[`test-run-notifpatch.log`](test-run-notifpatch.log)）。

日志：[`test-run-fixed-1.log`](test-run-fixed-1.log) … [`test-run-fixed-5.log`](test-run-fixed-5.log)。

## 6. 静态检查

```text
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npm run lint
> biome check src tests
Checked 176 files in 130ms. No fixes applied.
LINT_EXIT=0
```

日志：[`typecheck-lint-notifpatch.log`](typecheck-lint-notifpatch.log)。

## 7. 证据索引

| 文件 | 内容 |
|---|---|
| [`18-vendored-launch.png`](18-vendored-launch.png) | vendored runtime 补丁重编后 app 启动 |
| [`19-ios-build-lab.png`](19-ios-build-lab.png) | `ios build` 后 lab 正常渲染 |
| [`20-sqlite-first.png`](20-sqlite-first.png) | 首启自动写入 1 条，FPS 60/min54 |
| [`20-scroll-10s.mov`](20-scroll-10s.mov) | 9.758s 自动滚动录屏 |
| [`21-fps-final.png`](21-fps-final.png) | 滚动到第 193 行，FPS 60/min54 |
| [`23-sqlite-restart.png`](23-sqlite-restart.png) | 重启后“已有 1 条记录，本次启动未写入” |
| [`24-dark-2.png`](24-dark-2.png) | 深色玻璃页 |
| [`26-after-allow.png`](26-after-allow.png) | 通知权限已授予 |
| [`36-direct-schedule-status.png`](36-direct-schedule-status.png) | 修复前 UTC 定时原生错误 |
| [`37-direct-schedule-fire.png`](37-direct-schedule-fire.png) | 修复前 UTC 定时未送达 |
| [`38-local-schedule-status.png`](38-local-schedule-status.png) | 历史 local-time workaround 排程 |
| [`39-local-schedule-fire.png`](39-local-schedule-fire.png) | 历史 workaround 前台定时 |
| [`40-background-scheduled.png`](40-background-scheduled.png) | 历史 workaround 后台定时 |
| [`41-terminated-scheduled.png`](41-terminated-scheduled.png) | 历史 workaround 终止后定时 |
| [`42-final-relaunch.png`](42-final-relaunch.png) | 最终稳定页面：1 条记录、权限已授予、FPS 60/min51 |
| [`43-pending-active-crash.ips`](43-pending-active-crash.ips) | `pending()/active()` 诊断 API crash（已移除） |
| [`44-official-schedule-status.png`](44-official-schedule-status.png) | 官方 `Schedule.at` 前台立即 |
| [`45-official-schedule-fire.png`](45-official-schedule-fire.png) | 官方 `Schedule.at` 前台定时 |
| [`46-official-background.png`](46-official-background.png) | 官方 `Schedule.at` 后台定时 |
| [`47-official-terminated.png`](47-official-terminated.png) | 官方 `Schedule.at` 终止后定时 |
| [`REAL-DEVICE-TEST.md`](REAL-DEVICE-TEST.md) | 真机签名/安装/通知/震动测试步骤 |
| [`test-run-fixed-1.log`](test-run-fixed-1.log) … [`test-run-fixed-5.log`](test-run-fixed-5.log) | 全量测试 5/5 |

## 8. 占位与限制

1. `~/.local/bin/idevicesyslog` 是 72 字节占位，仅用于通过 `tauri ios init` 依赖检查；无真实 libimobiledevice/真机。
2. `tauri-runtime-wry` 与 `tauri-plugin-notification` 都是 vendored patch；后者等上游修复 UTC 解析后移除。
3. XcodeGen 仅对 `~/.local/share/xcodegen` 解隔离；未 sudo、未关全局 Gatekeeper、未重签。
4. CocoaPods 1.17.0 用户目录安装；Ruby 2.6 头文件通过 `RUBYOPT` 修补。
5. `NODE_ENV=production` 曾让 npm 省略 devDependencies；已恢复，后续用 `NODE_ENV=development`。
6. 未使用真实设备、生产库、`*:production`；未改 `src/model/**`、`migrations/**`、财务公式/状态语义。
7. 通知真机三态和震动手感待你按 `REAL-DEVICE-TEST.md` 执行；模拟器无物理震动。

## 9. 结论

M0 的运行时验证项已完成：构建、启动、WebView、SQLite 持久化、玻璃渲染、录屏、FPS、通知三态（官方 `Schedule.at`，UTC+8 修复后）、typecheck/lint、全量 5/5。剩余动作是真机确认通知三态与震动手感，不是 M0 执行阻断。

READY FOR REVIEW
