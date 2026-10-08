# V0.1.2 V4 Cutover Quiescence — Integration Closure Report

日期：2026-10-09（Asia/Shanghai）。

**PF_V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_BLOCKED**

已保存本轮隔离集成代码、可完成的回归、失败现场和主任务独立回读。**完整集成未关闭，不能进入 Experiment Closure，也不能进入独立复审或生产切换。**

主要阻断：真实 Tauri 程序被 macOS 拒绝启动；旧运行时占位副本也被系统终止，不能证明成功启动后受控退出。最终源码的 S1、实际 native 租约故障路径、Q11 和正式端到端均未完成验收。恢复接口另外存在两处已核实的失败收尾缺口。

本报告选择 BLOCKED，而不是 READY 或既有回归失败：已执行的最终回归均通过，但必需的运行集成覆盖被阻断。未执行不等于通过。

## 1. 本次授权与基线

- 项目实际根：`/Users/linte/Documents/ChatGPT/个人财务模型app开发`。聊天工作目录的 `项目 2` 后缀不是实现仓库。
- 起点：`ed412cb4f14e6f1336b8e4ade27336897a55a9da`；开始时已用 Git 核实。没有 amend 该提交。
- 当前授权：`/Users/linte/.codex/attachments/5f69e105-1951-4493-b593-21336356a4d2/已粘贴的文本.txt`，SHA-256 `fba0311685c10f05a2e2082223ddbd1caf7e5107e8e89c491334977a4d59086f`。
- 指定关联聊天 `01a11c22-18db-7490-87bb-5d1174991a9a` 已通过官方读取入口核对；其旧结论仍是部分实现，不把聊天中的历史授权扩大到本轮。
- 设计文件 `V012_V4_CUTOVER_QUIESCENCE_CONTRACT_REDESIGN.md` 原字节 SHA-256 仍为 `a21ced6cb8e565689f89c3d52a61aaacecfde5a3e6079cc7bc62b7d6c59cc228`。
- 九个原有未跟踪规划/设计/独立审计文件保持原样，不纳入本次实现提交。
- 原实施报告与 SQLite 实验报告逐字节保留。本报告是新的集成状态，不改写旧 Q01–Q18 实验结论。

治理保持：

```text
RB-V4-CUTOVER-INVENTORY-01 = SUPERSEDED_BY_RB-V4-CUTOVER-QUIESCENCE-01
RB-V4-CUTOVER-QUIESCENCE-01 = OPEN
RB-V4-OLD-RUNTIME-01 = CLOSED
Production V4 Migration = NOT AUTHORIZED
```

## 2. 已保存的实现与验收边界

| 范围 | 本轮保存的代码 | 当前验收状态 |
| --- | --- | --- |
| S0–S2 / 跨边界合同 | v2 permit、完整文件/目录对象集合、bundle/原始 plist/manifest、启动路径、旧进程关联、session/auth/nonce、租约 inode 绑定；native 自行遍历与重新核验，不接收 `complete=true` 放行 | 结构与单元边界已验证；完整正式运行未通过 |
| S1 | disable → 退出确认 → 保留 inode 的 archive rename → 初创即不可执行的 staging/install copy → 唯一安装入口启用 → 完整回读；九步持久收据 | 旧占位程序被 AMFI 杀死，原退出成功判断不足。已收紧失败关闭；仍缺真正旧合成 runtime 的 readiness 握手 |
| S3–S10 | `run_integrated`、native 独占 C、显式状态链、原子 claim、固定 M4、同 C 提交与保锁回读、持久结果 | 最终源码原生单测通过；早期原生烟测不是最终源码端到端证据 |
| 真实 IPC | 独立 Tauri/Wry binary、已打包 TS `invoke`、会话/令牌/重放检查、业务读写拦截、断联/关闭/重启测试代码 | 0 个真实 Q11 场景验收通过；源码检查不替代 IPC 运行 |
| 恢复/交付 | 只读诊断；独立授权后重新核验完整 DB/runtime/backup；不重跑 M4、不恢复旧程序或 DB、不复活 permit | 接口已实现，失败后的新授权账本和终态发布顺序尚未闭合，见第 5 节 |
| gate → native 租约 | 同 inode/session，双方描述符重叠持有，验证 ACK 后 gate 只 close、不 `LOCK_UN`；native 重复启动 claim | OS 基础原语回归通过；实际 native fault suite 首项阻断，其余未运行，不能称完整交接已通过 |
| 普通启动 | `cutover_startup.rs` 在普通 runtime 第一次 SQLite 访问前检查所有已知记录和 managed/native receipt 前缀 | 最终 Rust 回归通过；无记录才是 NOT_STARTED；损坏/待保存/不一致/未知均阻断；V4_VERIFIED 仍要求独立交付授权 |
| 正式入口 | `scripts/quiescence_integration.py run` 默认走真实 IPC `normal` 场景；native-only 模式明确使用 `run-integrated` | 入口代码已连接；最终正式合成端到端未通过 |

精确版本化字段、S0–S10 每态 entry/next/failure/restart、持久文件与绑定定义保存在 [`docs/quiescence-integration-contract.json`](docs/quiescence-integration-contract.json)。定义和代码存在不等于全部分支已被运行验收；本报告的未完成项优先于任何描述性成功路径。

实现文件分组：`scripts/quiescence_integration.py` / `quiescence_gate.py`；`src-tauri/src/quiescence.rs` / `quiescence_contract.rs` / `quiescence_recovery.rs`；`src-tauri/src/bin/quiescence_tauri.rs` 与 `quiescence-web/`；普通启动的 `cutover_startup.rs` / `lib.rs`。新增测试、控制器和证据 verifier 另存于 `scripts/`、`tests/`、`evidence/quiescence-integration/`。Rust 新增直接依赖 `plist = "=1.10.1"`，复用锁内已有版本，没有依赖升级或新 JavaScript 依赖。

仅构建而不启动的可复现入口是 `python3 scripts/quiescence_ipc_tests.py --build-only`。当前真实运行路径已经停止，不建议在依赖未改变前再次执行完整运行命令。

### 持久状态和连接边界

- gate 使用 `managed-state-<state>.json` 与 `managed-progress.json`，保留禁用、退出、归档、暂存、安装的次序与前一记录 hash。
- native 使用 `native-launch.json`、`permit.claimed.json`、`consumed.json`、`native-state-NNN.json` 和 `outcome.json`。每态绑定准确 session、nonce、authorization、合同/hash、DB C0、backup、可执行文件/manifest 和 lease inode。
- S9 分别保存 `V4_COMMITTED_PENDING_VERIFICATION` 与 `POST_READBACK_GUARDED`；不是第二次 BEGIN 或重连来冒充原保护窗口。
- 缺 receipt、额外的新 receipt 领先旧 outcome、pending、损坏、身份不一致均失败关闭。schema=3/4 不解除未解决状态。
- v2 `V4_VERIFIED` 的持久详情仍标记业务启动被拦截、重启需要独立交付授权。旧 v1 历史测试语义保留，不混为本轮交付。
- 原 C 的保护窗口与恢复时新建的只读 C 是不同事实；恢复不声称重新获得了原有连续锁。
- 没有实现或执行 DB restore / 旧 App restore。旧 CLI 生产 mutation 入口的 BLOCKED 边界保持，既有测试未删除。

## 3. 真实运行失败与停止依据

### 3.1 第一次 Tauri 尝试：配置选取错误

`generate_context!("tauri.quiescence.conf.json")` 单独使用自定义文件名，不足以让当前 `tauri-codegen` 读取该文件内容；它按目录读取常规配置，需 `TAURI_CONFIG` 合并。第一次实际 bundle 的 plist 是隔离 ID，但编译 context 仍为 `com.personalfinance.console`。

Tauri `app.rs` 的 setup 先创建配置内默认窗口，再调用应用的 setup hook。因此 `ISOLATED_APP_IDENTIFIER_MISMATCH` **不是窗口创建前拦截**。此前分项的这个说法已撤回，默认 WebView/default store 的可能副作用明确保留为限制。

已做一次有源码证据的修正：构建时显式加载隔离 `TAURI_CONFIG`；在 `Builder::build` 之前检查 context identifier、空默认窗口列表和空 devUrl；独立检查真实 plist；成功设计路径只创建手工指定的非持久 WebView。边界检查已有静态回归，但不将它称为真实 IPC 验收。

证据：`ipc-smoke-attempt-01.json`、`ipc-attempt-01-diagnostic.json`，以及主任务对该 fixture 的独立回读与归档。

### 3.2 修正后的尝试：系统拒绝执行

- 2026-10-09 00:46:41（+08:00），旧占位进程 PID **8766** 被 AMFI Launch Constraint 拒绝；其准确 PID 已与 `S1_OLD_RUNTIME_RETAINED` 和 waitpid 的 **-9** 退出记录绑定。
- 00:47:01，`syspolicyd` 明确记录 **“Terminating process due to Gatekeeper rejection: 8789”**，同一时段 kernel 记录把 PID 8789 绑定到准确的新合成 Installed.app 可执行路径。
- 第二次尝试没有 native journal、没有真实 TS invocation，stdout/stderr 为空。原控制器未保存失败时 native return code，该值仍是未知，未根据日志杜撰。
- 实际 native lease suite 也在首项遇到阻断；旧进程 PID **8583** 与 AMFI 拒绝及 -9 退出独立对上。该 suite 没有完整通过的 native handoff 场景。

只读 codesign 观察还显示复制后的合成 bundle 缺少签名期望的资源；此警告也存在于曾进入 setup 的第一次样本，因此**不单独拿它认定全部根因**。系统拒绝的准确 PID/路径日志是更强证据。

已经停止这条实际启动路径。没有关闭 Gatekeeper/AMFI、修改系统安全配置、重签已冻结样本、删除失败现场或整批重试。最终控制器现在会先保存 launch PID、return code 和 stdout/stderr 指纹，再检查是否有 IPC 证据；这属于后续可诊断性修正，未用来声称重跑成功。

证据：[`ipc-attempt-02-diagnostic.json`](evidence/quiescence-integration/ipc-attempt-02-diagnostic.json)、`ipc-attempt-02-os-log-excerpt.log`、[`lease-os-policy-observations.json`](evidence/quiescence-integration/lease-os-policy-observations.json)、`lease-native-report.json`。

### 3.3 对 S1 验收的纠正

`Popen + ps + waitpid 已退出` 不证明复制的 `/bin/sleep` 已成功进入受管旧 runtime。本轮此前受管单测的通过结果因此不代表完整 S1。

最终代码只接受所请求 SIGTERM 对应的预期退出；-9、未知或提前退出会进入 `BLOCKED_OLD_FIXTURE_EXECUTION_UNPROVEN`，不再生成后续合同/permit。原断言保留。但预期 SIGTERM 也不是 readiness 握手的替代；真正自有合成旧 runtime、合法开发 bundle 封装以及其准确运行身份仍需补齐。

## 4. 最终回归和独立回读

主任务执行：

```sh
python3 scripts/quiescence_integration_regressions.py --launch-boundary-blocked
```

完整命令、stdout/stderr、每项结果以及运行前后 source SHA 保存在 [`regressions-20261008T170209244578Z.json`](evidence/quiescence-integration/regressions-20261008T170209244578Z.json)。运行期间 source drift 为空。脚本整体返回 BLOCKED（exit 2），不是全量 PASS。

| 最终源码检查 | 结果 |
| --- | --- |
| TypeScript 主工程与独立 Q11 typecheck | PASS |
| TypeScript 测试 | PASS，292 项；其中 IPC source tests 不是 Q11 运行 |
| 既有 production gate + entry boundary | PASS，38 项，合成/模拟范围 |
| 既有 managed primitive tests | PASS，25 项；原语不等于 native 端到端 |
| 新 managed 非启动检查 | PASS，8 项；退出分类、损坏/孤立记录、lease inode/session |
| Rust lib / 普通 startup | PASS，29 项 |
| Rust quiescence fixture | PASS，22 项 |
| Rust quiescence Tauri bin unit tests | PASS，22 项；没有启动 Wry，不等于真实 IPC |
| 最终完整 managed runtime suite | BLOCKED_NOT_RUN；保留全部原断言 |
| 实际 native lease / 真实 Q11 / 正式端到端 | BLOCKED，未完成 |

主任务另用独立 verifier 回读两次失败 IPC fixture：

- 根目录均为准确 canonical temp synthetic marker；没有连接任何 Production DB。
- 两个失败样本都没有 native claim、consumed 或 outcome；合成 DB 的原始 SHA 与自己的 backup、permit C0 一致。这里只做 raw-file 回读，没有通过 schema 推断成功。
- 原实施/实验报告、TS migration 源及 M4 artifact 与基线原字节一致。
- 保存了失败样本 JSON、plist、日志、DB/backup，省略大体积可执行文件本体但保留其 SHA。
- 回读结果明确 `passed:false`、`delivery_status:BLOCKED`、`saved_state_readback_complete:true`。**证据保存完成不是集成完成。**

回读与归档：

- [`main-readback-20261008T170235963356Z.json`](evidence/quiescence-integration/main-readback-20261008T170235963356Z.json) 与对应 `readback-fixtures-20261008T170235963356Z.tar.gz`：第二次 IPC 尝试。
- [`main-readback-20261008T170353091999Z.json`](evidence/quiescence-integration/main-readback-20261008T170353091999Z.json) 与对应 `readback-fixtures-20261008T170353091999Z.tar.gz`：第一次 IPC 尝试。
- `retained-lease-failure-fixture.tar.gz`：lease 失败及停止前诊断留下的 partial S0 现场；不是成功结果。

## 5. 恢复接口另外两处未闭合问题

两项均经源码独立复查确认，不归咎于 macOS 启动失败，也不能用通过的单测抹平：

1. **新授权无法接续失败的恢复尝试。** `quiescence_recovery.rs` 在真正打开/核验 C 之前保存 `recovery-consumed.json`，之后按该文件是否存在一律拒绝。若随后遇到 BUSY/IO，即使有新 authorization ID/nonce 也仍是 REPLAY。需要按恢复授权区分尝试、保留原消费记录，并明确失败后新授权的合法路径；不能复活旧授权。
2. **成功记录可能领先最终失败。** `recovery-result.json` 先保存 `handoff_authorized` / `safe_terminal`，之后事件写入、lease/identity 检查或事务结束仍可能失败，且没有持久的失败覆盖关系。需要完成终态发布顺序和故障收尾。

目前没有据此放行业务：IPC 仅函数成功返回时设置交付授权，普通启动仍阻断持久切换记录。它们仍是本轮明确的集成缺口，不能声称 recovery/handoff 已完整完成。

## 6. Production 保全事实与未确认项

[`production-preservation.json`](evidence/quiescence-integration/production-preservation.json) 保存本轮前后 raw-file 观察。仅用原有字节读取方式，没有建立 Production SQLite 连接。

| 对象 | 前后 SHA-256 |
| --- | --- |
| Production database | `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`，一致 |
| 已安装 executable | `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`，一致 |
| 已安装 Info.plist | `4ffd536b7f152b97e2cccb94c7dc82aaa68918ffb2286bfeba7069fcbed4ea6a`，一致 |

数据库 raw header 的 user_version 前后均为 3；这不是 Production schema/integrity 的 SQLite 审计。没有启动已安装 Production，没有迁移、备份、替换、退役或恢复它，没有创建 Production permit/lease/state/receipt，也没有修改 `/Applications`。

**未确认项：** 第一次错误配置实际创建了 default-store WebView。观察到新 `org.pfc.quiescence.integration` WebKit/cache 目录，但没有完整前后 OS activity audit，不能严格声称已独立排除全部 Production WebView profile/cache 副作用。原失败报告自填的 `production_access.writes:0` 不是这种证明，后续诊断已明确撤销该解释。因此本报告不把三文件指纹一致扩大为“整个操作系统所有生产命名空间零副作用”。没有用删除缓存或恢复数据来掩盖这个限制。

Financial Model V1.0、业务语义、既有 TS migration 源和历史实验断言未改；未冻结 Production candidate，未开始 Stage 4–7 或 V0.2，未做延期 P2 清理。

## 7. 剩余工作、责任与停止点

后续实施方须在明确继续且有实际依赖变化后：

1. 正确构造自有的旧合成 runtime 与 readiness 证据；解决受支持的开发 bundle 封装/系统准入，不绕系统安全，不复用本轮假定成功的 -9 退出。
2. 修复第 5 节的恢复授权账本和终态发布问题。
3. 用最终源码完成全部 managed / actual native lease 场景、真实 Q11 全场景和一个受支持的正式 gate→native→IPC→durable result→guarded handoff 流程；逐项独立回读，不以 CLI/单元测试替代 Q11。
4. 补足 Production 保全证据边界，再核对所有 integration READY 条件。满足后才可进入另一个专门的 Experiment Closure 工作；不能直接请求独立复审。

当前 STOP：保存报告、证据和新提交后停止。不自动进入包装/重签方案、不再启动失败运行路径、不关闭 blocker、不归档聊天。

## 8. 短任务收据

- **能力：** 源码实现、静态测试、合成基础原语和准确失败诊断可执行；系统准入阻断真实工作流。
- **授权：** 仅本次隔离实现与合成验证；Production 权限没有扩大。
- **执行/保存：** 新代码、失败报告、回读 JSON、合成样本归档已落盘。历史报告未覆盖。
- **验收：** 安全范围回归通过；整体集成 BLOCKED；无业务/生产验收。
- **协作：** 三个边界清楚的子分包分别写 native、managed gate、真实 IPC；主任务独占普通 startup、回归编排、独立回读、报告和提交。子分包声明已与源码/保存证据核对。模型/推理参数调用均未覆盖，实际 backend、tokens/credits/金额未知。
- **连续性：** 项目记忆站与项目连续性技能用于定位边界、复用既有证据；没有写受管记忆或记忆站。项目 phase 仅追加本轮状态指针。
- **新提交：** 本文件随基线之上的新提交保存，准确 SHA 由最终交付提供，也可用 `git log -1 --format=%H -- V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_CLOSURE_REPORT.md` 查询。没有 amend 历史提交。
