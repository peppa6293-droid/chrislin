# V0.1.2 本地开发签名路径续跑报告

日期：2026-10-09（Asia/Shanghai）。前序 BLOCKED 报告保留不覆盖。

## 最终状态

`PF_V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_BLOCKED`

Owner 已明确 Apple Development 签名是当前本地集成测试的认可路径；该签名下 `spctl` 分发评估拒绝仅作诊断。本轮按此更新继续。隔离入口绑定和完整回归均通过，但一次 LaunchServices 本地应用启动在 45 秒内没有产生项目 readiness 事件。该启动未被证明成功；现有日志也不足以认定为 AMFI 拒绝。因此严格停止在本地启动门，不运行其后的集成矩阵。

`RB-V4-CUTOVER-QUIESCENCE-01` 仍 OPEN。没有 Production 切换、数据库迁移、Owner 数据写入；未启动已安装的 Production app；`docs/CURRENT_PHASE.md` 未变更。未禁用或绕过 Gatekeeper、AMFI、SIP，没有移除 quarantine、签 ad-hoc 包、公证或上传。

## 完成项

### 入口绑定与签名

新合成包位于独立 Cargo target，旧签名产物保留未动：

`/Users/linte/Documents/ChatGPT/个人财务模型app开发/src-tauri/target/isolated-quiescence-20261009T030614864520Z/release/bundle/macos/PFC Isolated Quiescence IPC.app`

独立读回记录：[package-validation.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/evidence/quiescence-integration/signed-runtime-20261009T031910542809Z/package-validation.json)

- `CFBundleIdentifier` = `org.pfc.quiescence.integration`。
- `CFBundleExecutable` = `quiescence-tauri`；`Contents/MacOS` 仅有该入口，不含 Production 可执行文件。
- bundle 主入口 Mach-O UUID 与 Cargo `quiescence-tauri` 目标一致：`6686C409-21A9-3D88-AC2A-1FBA5DF59930`。
- TeamIdentifier = `SSRKA7A4TN`，签名身份为 `Apple Development: 8619814730147 (FW5KHTFNZ6)`。指定需求同时绑定隔离 Bundle ID 和证书身份。
- `codesign --verify --deep --strict` 成功；签名资源封印有效。
- 只封装 `runtime-compatibility.json`，其内容与隔离源码 manifest 完全相同，manifest ID 和 executable 路径一致；没有 Production manifest 混入。
- 新构建及 fixture bundle 均未发现 `com.apple.quarantine`。未移除任何 quarantine。
- `spctl` 返回 exit 3 / rejected，仅记诊断；按 Owner 决策不阻挡本地 Apple Development 测试。

修正了 package 配置，让 `.app` 入口指向真正的隔离 Tauri IPC binary，并加入包级 manifest、Resources、Mach-O UUID、plist 和签名的绑定检查。入口更改只在隔离包配置中。

### 回归

完整回归收据：[regressions-20261009T032402978802Z.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/evidence/quiescence-integration/regressions-20261009T032402978802Z.json)

`status=PASS`，10 项命令全部成功，运行期源码无漂移：TypeScript 类型检查、293 个 Vitest 测试、38 个 Production gate/entry 测试、25 个 gate 测试、30 个 managed integration 测试，以及 Rust lib/fixture/Tauri 三目标测试。回归测试中的 S1 与旧运行时 fixture 通过；它们不代表真实签名 app 已完成 S1 验收。

旧 `TAURI_CONFIG` 字符串断言已替换为行为/配置安全断言，检查 packager 实际使用隔离配置和 Tauri binary，`mainBinaryName`、plist 入口、manifest 与资源过滤规则一致，Production manifest 不会选入合成包。全量 `npm test` 为 293/293 PASS。

## LaunchServices 启动结果

执行一次标准本地 `.app` 启动，命令为 `/usr/bin/open -n -W -a <隔离 .app>`，通过 `--env` 提供唯一临时合成根，并将 stdout/stderr 写入专属证据目录。不是直接运行另一个 binary，也不是 Gatekeeper 绕行。新包副本仍在该 synthetic temp root。

启动收据：[launch-receipt.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/evidence/quiescence-integration/local-launch-20261009T032820546142Z/launch-receipt.json)

观察到 app 进程 PID `36057`，进程路径正是 bundle 的 `CFBundleExecutable=quiescence-tauri`，SHA-256 为 `f34ea84d46d7dccbab04beae74138385365b46df97f6fdfb78bcded25792a1cd`。它带有合成 session / root 环境并存活于 45 秒观察期，但 `ipc-initial.jsonl` 没创建，stdout/stderr 为空，没有 `native_runtime_boot` 或 `frontend_loaded` 握手。任务随后对自己启动的 PID 发送 SIGTERM；open controller 在等待超时后被终止，收据中的 `-9` 是 controller 停止结果，不能解释成 AMFI 杀进程。

同一时间段的 syspolicyd 查询记录在启动收据中，包含 `qtn_proc` 初始化/dispatch 错误；没有 process-specific 的 AMFI verdict，当前启动停滞原因未知。另观察到隔离 Bundle ID 下的用户级 0 字节数据库路径 `/Users/linte/Library/Application Support/org.pfc.quiescence.integration/personal-finance-console.sqlite3` 被本轮启动的 app 进程打开。启动前状态未知，不能证明它是本轮新建、截断或原已存在；终态观察为 0 字节。本任务未单独读取/写入其内容，也未删除它。该 app data 侧效应需在下次启动前解释清楚。

补充进程观察：[process-observation.txt](/Users/linte/Documents/ChatGPT/个人财务模型app开发/evidence/quiescence-integration/local-launch-20261009T032820546142Z/process-observation.txt)

## 尚未完成

虽然回归环境中的 S1 fixture 通过，但真实启动未产出 readiness，按 Owner 的顺序不得进入验收流程。因此本轮未执行并未通过：签名旧运行时实际 readiness 与 S1 真实过渡、lease 矩阵、真实 IPC、recovery fault matrix、Q11 五场景、正式 synthetic S0→S10 E2E。不可交独立审计。

## Production 原始指纹

仅对既定三个文件读 SHA-256，不打开 SQLite。启动前已有观测记录于前序报告 `2026-10-09T02:22:08Z`；启动后复读结果相同：

| 对象 | 前后 SHA-256 |
|---|---|
| Production 数据库 | `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35` |
| Production 可执行文件 | `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f` |
| Production plist | `4ffd536b7f152b97e2cccb94c7dc82aaa68918ffb2286bfeba7069fcbed4ea6a` |

这只证明上述文件原始字节前后相同，不代表整台系统没有其他 side effect。

## 状态与交接

本轮报告与实施增量应提交在 Owner 指定基线 `09f38c34ae0607051d498962c6d41e150ab33ae3` 之上。报告和证据不得被解释为关闭 blocker 或许可进入下一阶段。

下一步需先基于现有 launch 证据查明为何 LaunchServices 进程无 native journal/readiness，以及隔离 app support 的 SQLite 空文件由哪段启动链创建；获得具体修复依据后，只修隔离启动路径，再按 Owner 决策进行一次新的标准启动验收。不要再次尝试相同启动路径，除非上述状态有证据修正。
