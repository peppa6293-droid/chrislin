# 小钱家 V4 Quiescence｜A/B/C/D 独立审计整改交付

日期：2026-10-09（Asia/Shanghai）。基线：`34ce22d01a37c0fc9c9839a5093314029ae38461`。

## 交付状态与授权

**READY_FOR_INDEPENDENT_REAUDIT**。A/B/C/D 已完成本次要求的实现和正反例验证，最终同版本集成和保存后回读 PASS。**独立复审待执行，不自称审计通过。** Renderer 单独终止为 `NOT VERIFIED`，按当次要求明确保留，不使用整个 App SIGKILL 代替。

最新授权来自独立审计聊天 `01a11f53-319a-71a1-b49d-5f35b240ede7`，已通过官方 read_thread 核对人类要求“输出可执行的完整方案，让他修完交给你复审”和随后“交给他”。依此执行转交的 A/B/C/D 方案，未从自动消息推定 Production 权限。

独立审计报告 `V012_V4_CUTOVER_QUIESCENCE_TAKEOVER_INDEPENDENT_AUDIT.md` 只读，SHA-256 保持 `875da85b459741126e9eeab52d1984e3e96562dcf692a9ebe9f086b9be26a516`，不纳入本次提交。原交付报告和旧证据未修改。九份原有未跟踪文件同样保留。

禁止项保持：未读取/打开/修改/迁移正式 Production 数据库；未启动或替换已安装 Production；未写 `/Applications`；未改变系统安全、证书或权限；未上传、公证或发布；未删除旧样本 ACTIVE/消费记录。`RB-V4-CUTOVER-QUIESCENCE-01 = OPEN`。Production/Owner 验收未授权、未执行。

本报告所在提交即整改提交；精确提交可由 `git log -1 --format=%H -- V012_V4_CUTOVER_QUIESCENCE_ABCD_REMEDIATION_REPORT.md` 获取，正式回复提供完整 SHA。不为嵌入自身 commit amend 历史。

## A｜旧构建收据来源绑定

入口：`scripts/package_quiescence_runtime.py --validate-build-receipt`。

问题：旧分支可拿旧包 A 配上复验当时的源码 B；退出码缺失/null 也可能被当作没有失败。本次原审计包不是该分支产生，不追溯伪称原包失败。

修复：

- 原件必须是 `receipt_kind=build`、准确版本/类型、synthetic_only=true、成功状态、无 error，不能是递归复验收据。
- 恰好四条必需命令，顺序/参数完全一致；退出码必须为 **int 0**，缺失/null/bool/float/string/非零全部拒绝。
- 原构建 source_before=source_after=当前完整输入集合；新增 manifest、默认与隔离配置、capabilities、migrations、npm lock、构建脚本等输入绑定。构建过程 source drift 仍失败关闭。
- 逐条核对原始 stdout/stderr hash；从原 Cargo stdout 重新解析 compiler-artifact，对准 target/source/manifest/executable/filenames/isolated build directory。
- 校验打包前 native hash、当前 cargo binary、包入口、plist、manifest hash、原始及当前 Mach-O UUID。复验后再次核对原 receipt 和输入未变。
- 复验保留 `original_build_provenance`、原 receipt hash、原 repo_head；本次来源另列 `revalidation_source_sha256_before/after`，不覆盖历史。

验证：10 组临时夹具/mock 工具单测 PASS，含 A/A 正例、A/B、构建期 before/after 不同、缺失/错误退出、命令缺失/乱序、日志 hash、错误入口和候选错配。完整新包构建后执行真实公共复验入口 PASS：`reaudit-build-revalidation-01.json`。再用原收据的隔离副本执行公共入口九个负例，均 **exit 2 + 准确预期错误**，不是把任何非零当成功：`reaudit-receipt-negative-01.json`。这些负例修改的是临时来源声明/收据，不篡改主工作区源码、原包或原始构建日志；原件 hash 前后相同。

历史不完整收据（缺 receipt_kind/完整输入集合等）现在会拒绝，不自动“补来源”。

## B｜readiness 完整结果判定

入口：`scripts/quiescence_local_launch_probe.py`；纯判定器：`validate_readiness`。

严格校验同 root/session/真实 executable/PID、连续 sequence、transport、时间顺序和 readiness 专用完整事件集合：

`native_entry_validated → native_runtime_boot → frontend_bootstrap → authenticated record_frontend_evidence → frontend_loaded → authenticated finish_frontend → frontend_complete → real_app_exit_event`。

必须 complete.passed=true、readiness_only=true、scenario=readiness、phase=initial、无 native worker/error、真实退出事件 code=0 且未被阻止。新增 fatal、失败断言、重复/未知事件、缺 complete、错误绑定/顺序、损坏/截断日志均拒绝；超时和探针终止分别保存，即使 launcher 最终 0 也拒绝。仍只声明默认隔离 app-support DB 的前后保存状态一致，不声明连续零 I/O。

验证：6 组单测 PASS。使用 `34ce22d` 的**实际源码 AST 判定式**与原真实日志在内存复制审计反例，证明旧判定 PASS、新判定拒绝。未改旧证据。最终新签名包经真实 LaunchServices 执行，完整八事件、正常退出和最终前端成功均 PASS：`reaudit-launch-01.json`。

## C｜Recovery 对象与原字节一致

问题是审计指出的条件性并发窗口，不是已发生的 Production 事故。

`AuthorizationSnapshot` 使用 NOFOLLOW/CLOEXEC 打开普通、单链接、限大小授权文件；同一个 FD 读出的同一 bytes 同时解析 JSON 与计算 SHA-256。保留 FD、原字节及 dev/inode/size/mode/mtime/ctime 等身份。每次 verify 检查路径和原 FD 身份，再从该 FD 重读并逐字节比较。

核对点：解析 callback 后、消费账本前、旧 consumed 文件写入前、`authorized_recovery_verified` callback 后、终态发布前以及已发布终态只读确认结束前。漂移统一返回 `RECOVERY_AUTHORIZATION_DRIFT`，不发布成功；原授权消费历史仍保留。single-writer、SQLite read guard 与 lease 发布顺序保持；不放宽 replay，不复活 permit，不删除旧样本 marker。

确定性测试通过真实 `recover-integrated --barrier` 回调握手，而非 sleep 碰运气：

| 场景 | 实际结果 |
| --- | --- |
| 解析后换 inode 并改 nonce | DRIFT，尚无消费/终态 |
| 解析后同 inode、同长度，仅空白字节变化，语义相同 | DRIFT，尚无消费/终态 |
| callback 后终态前换 inode/改 nonce | DRIFT，原 hash 消费记录和 FAILED 保存，未发布终态 |
| callback 后同 inode、同长度、语义相同的原字节变化 | DRIFT，保留失败证据，未发布终态 |
| callback 完全不变 | 成功，终态绑定原 bytes hash；原授权再次只读确认不改任何恢复记录 |
| 新授权冒充已发布旧终态 | `RECOVERY_TERMINAL_BINDING_MISMATCH`，原终态和账本不变 |

新增六组与原十组一起完整重跑：16 组、33 次实际 native 调用 PASS，源码无漂移；`reaudit-recovery-01.json` 保存屏障 event、原/新 hash 与 inode、完整 stdout/stderr、每次返回和保护文件指纹。每次原 DB、backup、permit.claimed、consumed、outcome、native 状态链均前后相同。终态前强杀留下的不完整 ACTIVE/ledger 仍失败关闭，不自动清除。

这修复并验证了列出的授权替换窗口，不宣称文件系统提供跨多个文件的原子授权事务，也不扩张为恶意 root/全时 namespace 防护。

## D｜文档丢失策略与真实覆盖

原生层始终独占 Connection C 和维护 lease。前端只能释放测试观察 barrier，不能提交、回滚或释放 C。

- 任意允许的同源导航以及 PageLoadEvent::Started（含 reload）在 cutover 活跃时记录 document loss；不再依赖 `/disconnected.html` 这个测试 URL。
- **native commit fence 前**：在受保护回调观测到丢失则停止，只有原 C 的 guarded rollback+V3 schema 确认后才写 FAILED_V3_CONFIRMED。
- **commit fence 后**：before_commit callback 在同一 mutex 中检查 loss 并设置 fence，再返回 COMMIT。此保守边界从 native 的提交决定开始，而非声称准确观测 SQLite 内部 syscall。之后 loss 不再能 veto COMMIT/readback；native 继续到 verified terminal，或按实际错误保留 UNKNOWN/GUARD_LOST，绝不凭断联猜 V3。
- postcommit 观察 barrier 遇 loss/timeout 由 native 继续；C/lease 不交给页面。未观测到的 renderer 消失在等待 barrier 时最终 timeout；其他时点可安全继续到原生终态。文档替换、重载或成功终态本身都不授权普通业务入口；重启仍须另外授权 handoff。

真实 Wry/TypeScript IPC 重跑原五场景并新增三个场景，全部 PASS：

| 场景 | 文档动作/结果 | 独立竞争证据 |
| --- | --- | --- |
| disconnect | 原指定真实导航，V3 明确回滚 | 原真实 IPC/close 防护与保存链 |
| refresh | 实际 `window.location.reload()`，V3 明确回滚 | 本例没有额外 SQLite/lease competitor，不冒称有 |
| disconnect_after_release | 第一 barrier 已释放，在 m4_started 保护点替换为普通同源 index 页面，V3 明确回滚 | SELECT 与 BEGIN IMMEDIATE 均 SQLite 主码/扩展码5；lease 实际争用 |
| disconnect_postcommit | 已 COMMIT 的 native 保护点替换同源 index 页面，native 继续到 V4_VERIFIED | SELECT 与 BEGIN IMMEDIATE 均码5；lease 实际争用 |

竞争由已构建的项目自有 SQLite peer 执行，保留其 PID、hash、SQLite source/version、原始响应及退出0，不依赖 Python 3.9 未提供的 sqlite_errorcode 属性。所有新增场景均有真实 replacement/reload 文档记录、普通业务 read/write 拒绝、对应原生持久结果及重启阻断证据。测试观察 barrier 是确定性阶段点；650ms 只是为竞争观察留窗口，若没有真实竞争记录 suite 会拒绝，不把等待时间本身当证明。

**renderer 进程单独终止：NOT VERIFIED。** 没有使用未经确认的 WebKit renderer 杀进程接口，也未把原 whole-App SIGKILL 两场景替换成 renderer 测试。不承诺所有 renderer 丢失均即时被观测/取消。策略与该边界已同步至 `docs/quiescence-integration-contract.json`。

## 最终包、证据和独立回读入口

最终包绝对路径：
`/Users/linte/Documents/ChatGPT/个人财务模型app开发/src-tauri/target/isolated-quiescence-20261009T064724502081Z/release/bundle/macos/PFC Isolated Quiescence IPC.app`

- Executable SHA-256：`8822324b03187ce526caf52dd3a8887f1c4d11d02ee832c939bc0d5f558fbee4`
- Mach-O UUID：`EDFF0A52-362D-3466-B012-450D0A1115C4`
- Bundle ID：`org.pfc.quiescence.integration`；入口：`quiescence-tauri`；现有 Apple Development 签名及 deep/strict 校验 PASS。
- Build receipt 的 repo_head 为修改前基线，**实际产物来源由完整 build source before/after hash 对准本次提交字节**，不冒称旧 HEAD 编译出了新代码。

最终证据总入口：`evidence/quiescence-integration/reaudit-readback-01.json`（九份报告/hash+最终非 managed 样本归档），SHA-256 以保存后 readback 为准，不在本文制造循环 hash。以下均相对仓库，旧证据原样保留：

| 项目 | 证据 |
| --- | --- |
| 新构建与签名 | `signed-runtime-20261009T064724502081Z/package-validation.json` |
| 实际公共入口复验 | `reaudit-build-revalidation-01.json` |
| 实际公共入口九个准确拒绝负例 | `reaudit-receipt-negative-01.json` |
| 严格真实 LaunchServices readiness | `reaudit-launch-01.json` |
| 原五项+新增三项真实 Q11，198 个前端断言 | `reaudit-ipc-01.json`及`ipc-cc1761c20c-*.jsonl` |
| 完整15项 lease | `reaudit-lease-01.json` |
| 完整16组/33次 recovery | `reaudit-recovery-01.json` |
| 正式 synthetic S0→S10 | `reaudit-formal-01.json` |
| 最终全回归+ A/B 负向单测+类型检查 | `regressions-20261009T065218965414Z.json` |
| Q11 全样本主任务独立保存后回读 | `main-readback-20261009T065254390488Z.json` |
| Q11 保存样本归档 | `readback-fixtures-20261009T065254390488Z.tar.gz` |
| lease/recovery/formal 样本与原始边界证据归档 | `reaudit-readback-01.tar.gz` |

表内均位于 `evidence/quiescence-integration/`。保存后 verifier 重新验证 A 原构建来源、B 完整判定、所有报告和源码 hash、C 每次原始记录及最终文件、正式 S0→S10 全阶段。明确终态数据库使用 `mode=ro&immutable=1` 检查完整 schema、版本、迁移 ledger、integrity、FK、全部19张旧业务表与 V3 backup；读前后 hash 不变。未知 crash DB 未自动打开恢复。刻意修改 DB 的 negative fixture 不被伪报为旧业务行未变化。

归档保留非 managed 数据/日志/收据，体积大的真实签名 bundle 保留在准确本地路径与原 temporary managed 根，hash 写入报告。没有把小归档宣称可安装包。

## 剩余项、收据和交接

- A/B/C/D 当前要求的实施与测试完成；独立复审尚未执行，下一步由聊天 `01a11f53-319a-71a1-b49d-5f35b240ede7` 的独立审计方读取冻结提交与新证据。
- Renderer termination 仍 NOT VERIFIED；历史 Q01–Q18 中 pager I/O、断电/fsync、WAL、全机/对抗性 namespace 等未覆盖项不标 PASS。进程死亡和控制注入不是这些证明。
- 本次没有 Production/Owner 业务验收，也无关闭 blocker 权限；blocker OPEN。实施方正式交付后停止扩展。
- 分工：A、B、C 各自独占相应实现及测试，主任务独占 D、GUI、最终集成、报告与 Git；主任务独立检查 diff、重建、重跑、回读。所有分包合同匹配；定向复核不冒称独立审计。模型参数继承未换模，实际后端模型/推理档位和精确费用 UNKNOWN。
- 准备阶段 CLI callback 编译捕获问题已用 move 修正；Python版本兼容性在运行前检查后使用原生 peer。第一次回归保留；验证工具变更后又完成最终全回归，最终 source_drift 为空。最终包来源、全部新矩阵与最后回归绑定当前源码。未用旧成功覆盖新失败。
