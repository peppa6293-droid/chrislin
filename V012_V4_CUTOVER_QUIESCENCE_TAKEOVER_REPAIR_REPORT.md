# 小钱家 V4 Cutover Quiescence｜隔离修复交付

日期：2026-10-09（Asia/Shanghai）。基线：`1ef7fdd`。本报告所属提交用 `git log -1 --format=%H -- V012_V4_CUTOVER_QUIESCENCE_TAKEOVER_REPAIR_REPORT.md` 解析；不 amend 历史。

## 最终状态

`PF_V012_V4_CUTOVER_QUIESCENCE_READY_FOR_INDEPENDENT_AUDIT`

本次明确列出的隔离 runtime 启动、readiness、意外默认 SQLite 路径、S1、lease、recovery、真实 Q11 与正式 synthetic S0→S10 集成，已完成修复、最终版本验证和保存后回读。**可交独立审计：是，仅限此隔离实现交付。独立审计尚未执行。**

`RB-V4-CUTOVER-QUIESCENCE-01 = OPEN`；Production V4 Migration = `NOT AUTHORIZED`。没有进入 Production 切换、正式数据库迁移、Experiment Closure 或 blocker 关闭。没有读取、打开或修改正式数据库，没有启动已安装 Production，没有修改 `/Applications`。使用现有 Xcode 和现有 Apple Development 身份构建本地测试包，不改变证书、Gatekeeper、AMFI、SIP、quarantine，不上传或公证。

## 本次授权与恢复依据

最新 Owner 消息允许在隔离环境连续诊断、改代码、重建签名包和多轮验证，替代前一归因任务的“一次启动/暂不进入 S1/Q11”限制；Production 禁区仍保留。通过官方 `read_thread` 读取 `Trace V4 startup attribution`（`01a11f30-bfed-79d0-9f2e-fbe108157cc5`）。项目未在项目记忆站索引命中，定向读取受管记忆后，以当前 Git、源码、报告和真实运行结果复核，未写持久化记忆。

当前源自旧 implementation、SQLite experiment、integration closure、blocker correction、signing resumption、runtime startup attribution 报告及其关联原始证据。历史失败报告与九份原有未跟踪规划/审计文档均保留，不覆盖、不重新标记为 PASS。当前工作根为 `/Users/linte/Documents/ChatGPT/个人财务模型app开发`，不是聊天工作目录的 `项目 2`。

## 已证实根因与修正

### 1. 包名正确不代表入口代码正确

旧 target `isolated-quiescence-20261009T030614864520Z/release/` 的独立 Mach-O UUID 核对：

| 对象 | UUID |
| --- | --- |
| `deps/quiescence_tauri-1b330dbaf65f93c4`，真正隔离入口 | `F8FC9D0E-5294-3F83-B538-A47B31CE20EF` |
| `deps/personal_finance_console-d036722fbf86a55d`，普通 main | `6686C409-21A9-3D88-AC2A-1FBA5DF59930` |
| `release/quiescence-tauri` 及旧 bundle 入口 | `6686C409-21A9-3D88-AC2A-1FBA5DF59930` |

本机 Tauri CLI 2.12.1 的配置契约明确：`mainBinaryName` 在 `tauri build` 中重命名默认主 binary。默认 `personal-finance-console` 被改名并覆盖真正隔离文件。旧校验只拿已被覆盖的 release 文件比对 bundle，形成循环误证。因此旧程序实际走普通 `main → lib::run → app_data_dir → Connection::open`，解释了没有隔离 journal、却访问隔离 Bundle ID 默认 DB 路径的行为。不是新的证书或 AMFI 证据。

修正为显式 `cargo build --bin quiescence-tauri --message-format=json-render-diagnostics`，通过 `TAURI_CONFIG` 绑定隔离 context，再用不编译、不重命名的 `tauri bundle --no-binary-patching`。解析 Cargo compiler-artifact 的准确 source path、target、executable，保存**打包前** SHA/UUID；签名后的 bundle 必须对应这个来源。保存构建前后源码指纹并拒绝漂移。没有改 Production 的 Cargo default-run、main 或 lib。

### 2. 启动与 SQLite 访问

新增 `native_entry_validated`，在 synthetic root、marker、session、实际可执行路径与 plist 验证后、diagnostic 与 Builder 前保存。`native_runtime_boot` 补 session 绑定。新增独立 readiness 场景，前端只做真实 IPC 握手后正常退出，不拿缺少 DB/lease 的最小 probe 冒充完整迁移。

启动 probe 保存启动前目录/文件 existence、dev/inode、size、mtime/ctime、hash、root 列表；保存 PID、真实 journal、进程命令及原始 lsof。最终 LaunchServices 测试 PASS：`native_entry_validated → native_runtime_boot → frontend_bootstrap → frontend_loaded → frontend_complete`，退出 0。

`~/Library/Application Support/org.pfc.quiescence.integration/personal-finance-console.sqlite3` 在本次启动前已经存在且为 0 字节；本次前后 dev/inode/size/mtime/ctime/hash 全部相同。测试根未创建默认 DB，原文件未删除或修复。**历史那次失败启动前是否存在，仍为 PREEXISTENCE_UNKNOWN**；新指纹不能倒推历史。这里证明正确入口无普通 DB bootstrap 可达路径及本轮保存状态未变，不声称 OS 全时 I/O 跟踪或全机零副作用。

### 3. S1、lease 与正式入口

S1 使用项目自有、合法开发签名的旧 synthetic runtime，验证真实 readiness 的 protocol/session/PID/executable hash，并保留准确进程和 waitpid。native 对 hash 链之外的 receipt 语义再次核验：完整 association、签名身份、启动证据、唯一退出观察、退出码 0、retained waitpid；-9、未知、PID/hash/session 不符均拒绝。

新增确定性 pre-ACK 与 ACK create-before-write 暂停点，真实 SIGKILL native/gate 验证锁连续性、同 inode/session、未消费 permit 与持续阻断。暂停点仅在显式隔离 fixture feature 下，**该 feature 同时被 quiescence-tauri 依赖，不是 CLI-only 编译隔离**；仍先校验 synthetic root/candidate/lease，并要求准确故障变量。不是 Production 功能。

实跑发现旧 lease 测试误从事件顶层读 `pid`；原始事件的 ACK 在 `details`。修复脚本字段、保留失败证据，并支持按 case 续跑和拒绝覆盖报告。最终在更新后的 native 上全矩阵 15 项 PASS、所有 coverage 为 PASS。早期 `takeover-lease-01.json` 失败及 `-02.json` 的选择性覆盖均保留，最终结果不靠拼接旧报告获得。

正式 IPC `run_formal` 原先会重新拼出错误 executable 布局且丢失完整签名包。本轮要求提供真实候选 bundle 并使用完整已签名 app；CLI 模式仍明确不是 Q11。实际正式入口已从 S0 走到 S10。

### 4. Recovery

原终态前提前删除 ACTIVE、释放 lease 存在并发发布窗口，before-terminal 错误也会被第二次删除 ACTIVE 的 IO 错误掩盖。现在 writer claim 先于可变历史决策，SQLite read guard、维护 lease 保留至终态发布与回读完成；失败保留原错误并记录清理问题。

append-only ledger 保留失败消费历史，拒绝重复 ID/nonce、重复 attempt、错误 terminal/STARTED 绑定。新授权只在已完成 FAILED 收尾后允许重验；不会复活 permit 或再次执行 M4。终态已经落盘但回复丢失时，同一原授权只能做受 lease/read lock 保护的**只读确认**：校验当前 DB hash、原 outcome/consumed、完整 runtime contract、authorization 原字节 hash、ledger、preterminal、terminal 和 ACTIVE 绑定，不重写这些记录。

普通启动增加孤立 `recovery-history.jsonl`、`recovery-active.json`、`recovery-preterminal-*` 检测；存在未解决记录仍失败关闭。普通无 quiescence 记录启动路径未改变。

## 最终版本与证据索引

最终包：`src-tauri/target/isolated-quiescence-20261009T061315261961Z/release/bundle/macos/PFC Isolated Quiescence IPC.app`。

- Executable SHA-256：`6f4295856e47b61f71871741a396cbe4a4b74f0de775ee7c5a512be669b46e36`
- Source-bound Mach-O UUID：`DFDEC7D8-B90D-39F0-B879-BD768C1C0DBC`
- Bundle ID：`org.pfc.quiescence.integration`；入口：`quiescence-tauri`；代码签名 deep/strict PASS。
- Gatekeeper assess 作为本地开发签名诊断保留，**不伪称公证/分发验收**；正常 LaunchServices 与真实直接子进程启动已有各自实证。

以下路径均相对仓库：

| 验证 | 最终结果与证据 |
| --- | --- |
| 构建/签名/源文件绑定 | PASS；`evidence/quiescence-integration/signed-runtime-20261009T061315261961Z/package-validation.json` |
| LaunchServices readiness/默认 DB 不变 | PASS；`evidence/quiescence-integration/takeover-launch-final.json` |
| 全回归，构建期与运行期源码无漂移 | PASS；`evidence/quiescence-integration/regressions-20261009T061509017819Z.json` |
| 真实 Tauri/Wry/TypeScript Q11，五场景，初始及重启 | PASS；`evidence/quiescence-integration/takeover-ipc-final.json` |
| Native lease，15 项 | PASS；`evidence/quiescence-integration/takeover-lease-final.json` |
| Recovery，10 组/25 次调用 | PASS；`evidence/quiescence-integration/takeover-recovery-final.json` |
| 正式 synthetic S0→S10，真实 frontend invoke | PASS；`evidence/quiescence-integration/takeover-formal-final.json` |
| 主任务复核 Q11 全部保存收据与 DB | PASS；`evidence/quiescence-integration/main-readback-20261009T061644806568Z.json` |
| 全交付源/包/报告/保存状态再次绑定 | PASS；`evidence/quiescence-integration/takeover-readback-final.json` |

Q11 的预期持久结果分别为：normal=`V4_VERIFIED`；disconnect=`FAILED_V3_CONFIRMED`；crash_at_quiescence=`QUIESCENCE_ACQUIRED`；crash_before_commit=`COMMIT_OUTCOME_UNKNOWN`；guard_lost=`GUARD_LOST_OR_UNPROVEN`。故障场景的 PASS 是**正确阻断与保存未知状态**，不是迁移成功。Q11 合计 110 个真实前端断言；不是 mock invoke 或 CLI 替代。

Recovery 覆盖 V4/V3、真实 SQLite BUSY、真实 lease 竞争、旧 ID/nonce 重放、fresh authority、终态前失败、终态后结果不明、只读确认、缺失/损坏 ledger、pending、candidate/DB 漂移。逐次比对原 DB/backup/consumed/native 状态链前后不变。正式 E2E 与 Q11 正常/回滚样本由独立只读 SQLite 连接逐表比对全部 legacy rows 与 backup；未解决 crash 样本不自动打开 SQLite 恢复。

归档：`readback-fixtures-20261009T061644806568Z.tar.gz` 保存 Q11；`takeover-readback-final.tar.gz` 保存最终 lease/recovery/formal 的非 managed 证据与数据库。原 temp 根均保留。较大签名 app 不装入这些小归档，准确 bundle 路径、hash、source receipt 单独保存；完整 managed temp 树仍在原位置。归档不等于重新可执行安装包。

## 验收边界、未确认和下一步

1. **下一步由独立审计方执行审计**，基于本提交和上述最终 evidence；Owner 尚未做业务验收。实施方本次没有未完成的已列集成修复项，不自动启动下一阶段。
2. 保留历史 SQLite Q01–Q18 报告中的原始 PARTIAL/NOT_RUN 字样；本次以新 Q11、S1、lease、recovery/E2E 证据补其对应集成缺口，**不冒称历史整张 Q01–Q18 矩阵已全部 PASS**。真实磁盘/pager I/O、断电/fsync 故障、全机或对抗性 namespace、WAL 支持等并未由进程死亡或 rollback_failure 控制证明。本报告的 audit-ready 仅是本次明确列出的隔离集成范围，不是所有 SQLite 实验/Production 就绪声明。
3. Recovery 在终态前被强杀遗留 ACTIVE/不完整 ledger 时仍阻断，没有自动清除或重试；这是未解决状态的保护策略，不把文件存在或 schema 版本当成功。若将来需要恢复这些情形，必须设计并审计准确的新授权恢复动作，不能直接删 marker。
4. 未作 Production 原始文件指纹读取、正式 DB 完整性检查、业务迁移或安装替换。因此不会以本轮结果声称 Production 当前余额/数据库状态或全 OS 零副作用已验收。

## 短任务收据

能力：受支持的现有开发签名包可正常启动，真实 IPC 与 native/SQLite 测试已执行。授权：仅隔离诊断/修复/重建/验证。执行与保存：最终源码、包来源、原始日志、失败历史、保存后回读与归档已保留。技术验收：当前列出集成项 PASS、可交审计；业务验收/Production/关闭 blocker：未授权、未执行。

分包使用独立文件所有权：运行归因/S1、recovery、lease；主任务独占打包、GUI 运行、整合、最终回读和提交。子任务结果先核对合同与范围，再由主任务重建并重跑最终矩阵。模型参数均继承，未显式换模；后端实际模型/推理档位及精确费用未暴露，记为 UNKNOWN。
