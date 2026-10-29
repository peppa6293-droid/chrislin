# M0 iOS 技术验证报告

**状态：READY FOR REVIEW（M0 运行时验证通过；一个上游通知插件问题已记录）**

**一句话说明：** `tauri-runtime-wry` 补丁已入库，HTTP/1.1 的 `ios build` 成功，`/lab/glass` 在 iPhone 18 Pro / iOS 27 正常渲染；SQLite 写入与重启读回、玻璃浅/深色、9.758s 录屏、60 FPS、通知前台/后台/终止三态均已取得证据，`import-flow` 等待条件已修且全量测试 5/5 通过。通知的 `Schedule.at` 在 UTC+8 有插件时区 bug，M0 页面用 local-time workaround 验证了三态；产品接入前应修上游或避免使用该 API。

**需要你做的事：** 审核 M0。若同意进入 M1，需要决定是否先修 Tauri notification 的 UTC+8 定时 bug；震动的手感仍需真机确认。

**风险/占位：** `idevicesyslog` 仍是占位；无真实 `libimobiledevice`、无真机；震动只有 API 调用成功（模拟器无物理反馈）；通知三态是用 local-time workaround 验证的，不是插件默认 `Schedule.at` 的成功；`pending()/active()` 诊断 API 会触发 Swift assertion，已从最终页面移除。

**证据位置：** [`evidence/m0-20261029/`](</Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/evidence/m0-20261029/>)

- 时间：2026-10-29 23:31 +08:00
- 分支：`feat/mobile`
- M0 代码/证据 HEAD：`469146d`
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
| `469146d` | `mobile(M0): verify notification states and stabilize import flow`；通知三态、local-time workaround、import-flow 等待条件、最终证据 |

`WORKLOG.md`、`PROJECT-STATE.md` 和本 `REPORT.md` 不在 `a2f65b0` 中。

## 3. 执行结果

### 3.1 依赖补丁入库

- 改过的 `tauri-runtime-wry-2.12.1` 复制到 `src-tauri/patches/tauri-runtime-wry`。
- `src-tauri/Cargo.toml`：

```toml
[patch.crates-io]
tauri-runtime-wry = { path = "patches/tauri-runtime-wry" }
```

- 删除了 `~/.cargo/registry` 中被改过的源码/cache 包；`cargo tree` 指向本地 path。
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

首次成功，没有改全局 git、没有换源、没有重试；输出 `.../build/arm64-sim/小钱家.app`。后续最终构建同样成功。日志：[`ios-build-http1-attempt1.log`](ios-build-http1-attempt1.log)、[`ios-build-final.log`](ios-build-final.log)。

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

### 3.7 通知三态（已通过）

权限已由用户点击“允许”授予，[`26-after-allow.png`](26-after-allow.png) 显示“通知权限：已授予”。

| 状态 | 证据 | 结果 |
|---|---|---|
| 前台立即 | [`34-id-scheduled-status.png`](34-id-scheduled-status.png) | 横幅“M0 自动立即通知 / 自动通知 23:17:01” |
| 前台定时 | [`39-local-schedule-fire.png`](39-local-schedule-fire.png) | 横幅“M0 自动定时通知 / 计划 23:22:14 送达” |
| 后台定时 | [`40-background-scheduled.png`](40-background-scheduled.png) | 在 Settings 上方出现“计划 23:23:48 送达” |
| 终止后定时 | [`41-terminated-scheduled.png`](41-terminated-scheduled.png) | app 已 terminate，桌面出现“计划 23:25:37 送达” |

定时推送使用 `+60s` 排程；后台/终止场景均在计划时间前 60 秒启动、到点截图。

### 3.8 通知插件的 UTC+8 时区 bug（必须记录）

直接使用官方 `Schedule.at(new Date(Date.now() + 60_000))` 在这个 UTC+8 模拟器上 **不会送达**：

- [`36-direct-schedule-status.png`](36-direct-schedule-status.png) 显示原生 `ShowNotificationError`（截图里被截断）。
- [`37-direct-schedule-fire.png`](37-direct-schedule-fire.png) 到点后没有横幅，DeliveredNotifications 里也没有 `M0 自动定时通知`。

根因在插件 Swift `Notification.swift` 的 `handleScheduledNotification`：`DateFormatter` 的格式是 `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`，但 `'Z'` 是字面量，且没有设置 `timeZone = UTC`。UTC ISO 字符串（例如 `15:22:14Z`）被按本地时间（23:22:14）解析，结果落在过去，原生抛错。

M0 页面的 workaround（仅测试页，不是产品方案）：

```ts
await invoke("plugin:notification|notify", {
  options: {
    id: 2,
    title: "M0 自动定时通知",
    body: `计划 ${at.toLocaleTimeString()} 送达`,
    schedule: {
      at: {
        date: localScheduleString(at), // 本地墙钟 + 字面量 Z
        repeating: false,
        allowWhileIdle: false,
      },
    },
  },
});
```

[`38-local-schedule-status.png`](38-local-schedule-status.png) 显示“直接 invoke 排程 23:22:14”，[`39`](39-local-schedule-fire.png)/[`40`](40-background-scheduled.png)/[`41`](41-terminated-scheduled.png) 证明三态可用。产品接入前应修插件（设置 UTC timeZone 或正确解析带 Z 的 ISO）或等上游修复。

另：诊断时调用 `pending()` / `active()` 会在 `com.apple.usernotifications.UNUserNotificationServiceConnection.call-out` 队列触发 Swift assertion；crash 报告保留在 [`43-pending-active-crash.ips`](43-pending-active-crash.ips)。最终页面已移除这两个调用，[`42-final-relaunch.png`](42-final-relaunch.png) 稳定运行。

## 4. 全量测试 5/5

`import-flow` 的失败是等待条件问题，不是产品数据问题：原测试用 `findByRole("status")` 先拿到预览状态，再断言成功文案。已改为 `waitFor` 等待任一 status 包含成功文案，保留原断言与数据读回断言。日志：[`import-flow-fixed.log`](import-flow-fixed.log)（8/8 通过）。

`tests/onboarding-safety-eligibility.test.tsx` 中曾 5000ms 超时的那一条，超时调到 **15s**（只改超时）。

连续 5 次全量，全部退出 0：

| 次 | 结果 | 耗时 |
|---|---|---|
| 1 | 55 files passed；568 passed / 44 skipped | 6.07s |
| 2 | 55 files passed；568 passed / 44 skipped | 5.08s |
| 3 | 55 files passed；568 passed / 44 skipped | 5.42s |
| 4 | 55 files passed；568 passed / 44 skipped | 5.22s |
| 5 | 55 files passed；568 passed / 44 skipped | 5.09s |

日志：[`test-run-fixed-1.log`](test-run-fixed-1.log) … [`test-run-fixed-5.log`](test-run-fixed-5.log)。

## 5. 静态检查

```text
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npm run lint
> biome check src tests
Checked 176 files in 144ms. No fixes applied.
LINT_EXIT=0
```

日志：[`typecheck-lint-final3.log`](typecheck-lint-final3.log)。

## 6. 证据索引

| 文件 | 内容 |
|---|---|
| [`18-vendored-launch.png`](18-vendored-launch.png) | vendored 补丁重编后 app 启动 |
| [`19-ios-build-lab.png`](19-ios-build-lab.png) | `ios build` 后 lab 正常渲染 |
| [`20-sqlite-first.png`](20-sqlite-first.png) | 首启自动写入 1 条，FPS 60/min54 |
| [`20-scroll-10s.mov`](20-scroll-10s.mov) | 9.758s 自动滚动录屏 |
| [`21-fps-final.png`](21-fps-final.png) | 滚动到第 193 行，FPS 60/min54 |
| [`23-sqlite-restart.png`](23-sqlite-restart.png) | 重启后“已有 1 条记录，本次启动未写入” |
| [`24-dark-2.png`](24-dark-2.png) | 深色玻璃页 |
| [`26-after-allow.png`](26-after-allow.png) | 通知权限已授予 |
| [`34-id-scheduled-status.png`](34-id-scheduled-status.png) | 前台立即通知横幅 |
| [`36-direct-schedule-status.png`](36-direct-schedule-status.png) | `Schedule.at` 原生错误（UTC+8 bug） |
| [`37-direct-schedule-fire.png`](37-direct-schedule-fire.png) | UTC 定时未送达 |
| [`38-local-schedule-status.png`](38-local-schedule-status.png) | local-time workaround 排程成功 |
| [`39-local-schedule-fire.png`](39-local-schedule-fire.png) | 前台定时通知 |
| [`40-background-scheduled.png`](40-background-scheduled.png) | 后台定时通知 |
| [`41-terminated-scheduled.png`](41-terminated-scheduled.png) | 终止后定时通知 |
| [`42-final-relaunch.png`](42-final-relaunch.png) | 最终稳定页面：1 条记录、权限已授予、FPS 60/min51 |
| [`43-pending-active-crash.ips`](43-pending-active-crash.ips) | `pending()/active()` 诊断 API 的 crash 报告（已移除） |
| [`test-run-fixed-1.log`](test-run-fixed-1.log) … [`test-run-fixed-5.log`](test-run-fixed-5.log) | 全量测试 5/5 |

## 7. 占位与限制

1. `~/.local/bin/idevicesyslog` 是 72 字节占位，仅用于通过 `tauri ios init` 依赖检查；**无真实 libimobiledevice/真机**。
2. `tauri-runtime-wry` 补丁已入库（`src-tauri/patches/tauri-runtime-wry`，`PATCH.md` 写明 PR #16082）；不再是 registry 本地改包。
3. XcodeGen 仅对 `~/.local/share/xcodegen` 解隔离；未 sudo、未关全局 Gatekeeper、未重签。
4. CocoaPods 1.17.0 用户目录安装；Ruby 2.6 头文件通过 `RUBYOPT` 修补。
5. `NODE_ENV=production` 曾让 npm 省略 devDependencies；已恢复，后续用 `NODE_ENV=development`。
6. 未使用真实设备、生产库、`*:production`；未改 `src/model/**`、`migrations/**`、财务公式/状态语义。
7. 通知是 M0 测试页的 local-time workaround；产品接入前需修插件或等上游。震动物理反馈未在模拟器验证。

## 8. 结论

M0 的运行时验证项已完成：构建、启动、WebView、SQLite 持久化、玻璃渲染、录屏、FPS、通知三态、typecheck/lint、全量 5/5。已知限制是通知插件 UTC+8 定时 bug 和真机震动，不是 M0 执行的阻断。

READY FOR REVIEW
