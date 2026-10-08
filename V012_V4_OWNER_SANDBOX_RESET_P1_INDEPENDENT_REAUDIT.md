# V0.1.2 V4 Owner Sandbox Reset P1 — Independent Re-audit

审计日期：2026-10-08（Asia/Shanghai）  
最终状态：**PF_V012_V4_OWNER_SANDBOX_RESET_REAUDIT_PASS_WITH_P2**

**本次定向复审通过。P1-SANDBOX-RESET-01 = CLOSED；P2-SANDBOX-HISTORY-01 = CLOSED；P0 = 0；P1 = 0。** 原生确认可见，打开与取消均不写库，确认恢复得到规定的真实种子，正常重启后字节不变。六项既有延期 P2 保留；Owner acceptance 仍待 Owner 决定。

## 1. Scope

只复审重置 P1 和相邻历史中文标签 P2。依据 [本次 Owner 请求](/Users/linte/.codex/attachments/bf14f439-dc15-4317-afea-beeb6636dcf8/已粘贴的文本.txt)，已读取所引用 Codex task `01a0fd01-7944-75e1-8abb-c74e74e8d581` 的最新交付；其 READY_FOR_REAUDIT 只作为实施方声明。

复用了 [前次独立验收报告](/Users/linte/Documents/ChatGPT/个人财务模型app开发/evidence/V012_V4_OWNER_SANDBOX_INDEPENDENT_ACCEPTANCE_AUDIT.md) 的已通过业务结论。没有重跑整个原生 Planning / Actual / Cash 矩阵，没有改实现、安装 App、启动 Production、修改 RC2 或开始 Stage 4–7。

主任务负责原生实际操作、真实验收库与 Production 只读核对、最终验收；自动回归分包 R7K4 只使用独立 TMPDIR 和隔离构建目录。主任务回读原始日志、JSON、哈希和用例来源，不仅依赖分包声明。所有新证据保存在本次独立目录，未覆盖以前的报告、截图或测试证据。

## 2. Writable source / artifact identity

唯一实现来源：`/Users/linte/Documents/ChatGPT/个人财务模型app开发`。未使用旧 ChatGPT mirror 作为当前源码。

- Branch：`main`。
- HEAD：`38befdf473ea19741189793d4de0f24253242167`。
- 修复前基线：`d5b0380609815f4b6de6115b0f12b91473327a60`；到 HEAD 的提交只涉及 workspace bootstrap 文档、证据及 `.gitignore`。
- 审计开始与结束均已有两个修改文件：`src/ui/V4AcceptanceApp.tsx`、`src/ui/v4-acceptance.css`；两个未跟踪文件：修复报告与 `tests/v4-acceptance-ui.test.tsx`。审计未改这四个文件，也未提交代码。
- 当前实现差异为 React 应用内确认、提交期间防重复调用和中文标签映射，以及确认面板样式；Service、Repository、模型、迁移、原生隔离逻辑没有本次修复差异。`git diff --check` 通过。

直接执行的产物：

`/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-acceptance-sandbox-20261007/cargo-target/release/bundle/macos/小钱家 V4 验收版.app`

实际可执行文件为其 `Contents/MacOS/personal-finance-console`，SHA-256：

`0afebc1c571128cef1af32b2cb1cbbe3705b13a9aa7374ba834af6f7375f06d5`

实际 Info.plist 的 Bundle ID 为 `com.personalfinance.console.v4acceptance`，原生窗口为“小钱家 V4 验收版”。运行 PID 为 **90876**，重启后 **96780**；每次数据库核对同时保存 `lsof`，都指向上述确切 executable 和独立验收 DB。

独立 fresh 前端构建与该 checkout 的 artifact 构建输入 `web-dist` 逐文件字节相同；实际原生窗口运行了新版中文历史与确认面板。结合身份、路径、哈希、源码差异及 fresh 构建核对，当前验收对象与新 checkout 修复一致。本次没有重建或替换已交付 `.app`。

证据：[00-preflight.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/00-preflight.json)、[authorized-change.diff](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/authorized-change.diff)、[12-final-verification.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/12-final-verification.json)。

## 3. Production preservation

Production DB：

`/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`

前后均为：

| 项目 | 结果 |
|---|---|
| SHA-256 | `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35` |
| schema / migrations | V3 / `[1,2,3]` |
| integrity / foreign-key check | `ok` / 空结果 |
| size | 229376 bytes |
| mtime_ns / inode | `1791164404446788550` / `21120760`，不变 |
| WAL / SHM / journal | 均不存在，前后相同 |

只用 `file:…?mode=ro&immutable=1` 读取 Production 元数据，没有读取 Production 财务事实来准备测试，没有写、reset 或迁移 Production。原生验收进程各关键阶段 `lsof` 均只打开验收库，未发现 Production DB。未启动 `/Applications/Personal Finance Console.app`；包含该安装 App、RC2、验收产物及源码等的 161 个受保护文件前后哈希、大小、mtime 全部相同。

隔离结论依据路径 guard、实际各检查点文件句柄和最终 Production 文件保全共同成立；`lsof` 是离散观测，不声称连续系统调用追踪。本轮没有检测到安全越界。

## 4. Mutated pre-reset state

验收库唯一位置：

`/Users/linte/Library/Application Support/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3`

App 未运行时先保存 byte-verified 审计前备份，其 SHA 为 `eedd2a2a51b2c28e8359ae7516e89f7e4b2c5d5dcb58a20c5466d0aa03be2e82`。仅通过原生验收 UI 准备本次必要合成变更：平时收入 14000、十月 OVERRIDE 15500 后 INHERIT、Actual A 修改为 950/PENDING、现金账户追加 2026-10-15 停用修订。

| 重置前事实 | 实际读回 |
|---|---|
| Stable income | 14000；stable revision 1 条 |
| Planning month revisions | 2 条，依次 OVERRIDE / INHERIT |
| Actual V4 revisions | 1 条，950 / PENDING / business date 2026-10-02 |
| Cash lifecycle revisions | 1 条，effective 2026-10-15 / active 0 |
| DB SHA | `255334b6cfbc22a992808e05ec616d925eae801fcdf17bfb7eafbac902dae975` |

证据：[06-mutated-before-reset-db.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/06-mutated-before-reset-db.json)。这四种变更只用于证明 reset 能清除真实合成修订，不替代或扩张前次业务验收范围。

## 5. Confirmation appearance — Test A

点击“恢复初始测试数据”后，真实原生窗口内显示：

> 确定恢复初始测试数据吗？
>
> 这只会清空 V4 验收版里的测试记录，不会影响正式账本。

“取消”“确认恢复”均可见。截图确认这是应用页面内的确认面板，源码具有 `role="alertdialog"`；当前入口不再依赖 `window.confirm`。

仅打开确认后，DB SHA、全部表行内容和计数均与第 4 节完全相同。**A = PASS**。

证据：[原生截图](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/07-confirmation-open.png)、[AX](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/07-confirmation-open-ax.txt)、[实际 DB](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/07-confirmation-open-db.json)。

## 6. Cancel result — Test B

点击“取消”，确认面板关闭。未出现“测试数据已恢复”。实际 DB SHA 仍为 `255334…dae975`；主任务逐项比较全部业务表内容、全部计数及字节哈希，均未变化。**B = PASS / zero observable reset**。

新增 UI 测试同时验证取消不会调用 reset service；真实原生结果由数据库核对独立证明。

证据：[08-cancel-ax.txt](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/08-cancel-ax.txt)、[08-cancel-db.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/08-cancel-db.json)。

## 7. Confirmed reset result — Test C

再次打开应用内确认，点击一次“确认恢复”。面板关闭，原生显示 **“测试数据已恢复”**，平时收入更新为 13000，三张历史表均为暂无记录。不能仅凭成功文案判定通过：下面另行读取真实验收库确认种子。

DB SHA 变为 `ab93b695710525b3669b3fc3c916f63823f34b6ab6c9866c8562e62be537b809`。**C = PASS**。

证据：[09-confirmed-reset-full-ax.txt](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/09-confirmed-reset-full-ax.txt)、[原生成功截图](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/09-confirmed-reset.png)。重复提交和 service 失败的处理另由新增 UI 测试覆盖；未把 mock 用例称为额外原生操作。

## 8. Seed DB readback

[09-confirmed-reset-db.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/09-confirmed-reset-db.json) 的完整行读回及主任务断言结果：

| 必须满足的种子 | 实际结果 |
|---|---|
| Stable Planning Income | 13000 |
| Planning stable / month revisions | 0 / 0 |
| Actual base records | 4 条：a、future、void、legacy |
| 每条 Actual amount / status / date | 800 / RECEIVED / 2026-10-02 |
| Actual V4 revisions | 0 |
| Cash name / balance / active | 余额宝 / 4805.61 / 1 |
| Cash lifecycle revisions | 0 |
| Schema / migrations | V4 / `[1,2,3,4]` |
| Integrity / foreign-key check | `ok` / 空结果 |

`income_records` 总数为 5：1 条 Planning + 4 条 Actual，符合要求。新播种产生新的 profile/account UUID；SQLite 序号并非种子业务合同，不要求与上次播种字节相同。比较业务值和修订清空结果全部正确，未把不同 UUID 当成未恢复。

## 9. Restart persistence — Test D

正常 `⌘Q` 退出，核实 PID 已消失，保存确认恢复后的 DB 副本；重开完全相同的 `.app`。新 PID 96780 仍打开相同验收 DB 路径，SHA 与退出前同为 `ab93b6…7b809`，全部表内容逐项相同，schema/migrations 不变。原生重启显示 13000、800 已到账、余额宝使用中、暂无历史记录。**D = PASS**，没有自动播种或其他数据库变更。

证据：[10-normal-exit.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/10-normal-exit.json)、[11-restart-db.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/11-restart-db.json)、[11-restart-ax.txt](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/11-restart-ax.txt)、[截图](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/11-restart.png)。

完成并留存 D 的真实结果后，正常退出验收 App，恢复 byte-verified 的审计前验收库备份，最终 SHA 回到 `eedd2a…be2e82`。这是测试现场保全；审计前备份本身也是 13000 / 四条 800 Actual / active Cash / 零修订的干净种子。没有用备份恢复充当 UI reset 或重启通过证据。Owner 可随后自行打开验收 App；本轮未勾选 Owner 清单。

## 10. Fail-closed regression

| 情况 | 独立安全验证 |
|---|---|
| wrong identity | 显式 TS probe 拒绝 initialize/reset，开库、SQL、transaction、native reset 调用全部为 0 |
| correct identity / wrong app-data directory and corresponding DB path | 同上，拒绝且零写入 |
| correct identity / wrong DB basename | 同上，拒绝且零写入 |
| native exact identity + home/app-data path | 既有 Rust h；确认只接受独立身份及正确目录，错误身份和目录拒绝 |
| native reset guard | 既有 Rust j 保留 migration、清除仅测试行、错误身份拒绝；源代码继续校验 acceptance_runtime、exact expected_path、basename 和无活跃事务 |

[显式 probe](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/automated/failclosed.probe.ts) 为假路径与 mock，未指向或打开真实 Production。普通测试发现排除 `artifacts/**`，该 probe 只由独立 config 显式运行。

准确边界：TS guard 校验 identifier 和 DB 目录/文件后缀，没有单独校验返回的 appDataDir 字段；Rust 为 authoritative exact-home/app-data/path guard，且仍检查重定向目录。这里没有宣称 TS 单层完成全部绝对路径防护。当前修复没有削弱两层保护。

## 11. P2 history-label result

真实原生主要历史表显示：存储 OVERRIDE → **本月单独设置**，存储 INHERIT → **跟随平时收入**。重置前实际 DB 内两条 decision 仍为 `OVERRIDE`、`INHERIT`；没有写成中文或改变内部枚举。

[05-mutated-and-history-ax.txt](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/05-mutated-and-history-ax.txt)、[07-confirmation-open.png](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/07-confirmation-open.png) 显示原生两行中文，技术详情默认折叠。**P2-SANDBOX-HISTORY-01 = CLOSED**。

## 12. Automated regression

全部使用新目录内独立 TMPDIR；Rust 在 66 个字节相同输入文件的 crate 副本中测试，保留原 acceptance TAURI_CONFIG，单独 CARGO_HOME / CARGO_TARGET_DIR，避免 tauri-build 修改真实 checkout 的生成目录。没有使用 bare `npm test`。

| 实际执行 | 结果 |
|---|---|
| npm run typecheck | exit 0 |
| npm run lint | exit 0；24 条已有 src/style.css specificity warnings，未修复 |
| npx --no-install vitest run --exclude 'artifacts/**' --no-cache --configLoader runner | 14 个官方 tests 文件，276/276 |
| 同上指定 tests/v4-acceptance-sandbox.test.ts | 3/3 |
| 同上指定 tests/v4-acceptance-ui.test.tsx | 6/6 |
| 显式 failclosed.config.ts | 3/3 |
| cargo test --offline --locked --lib --features v4-acceptance | 11/11 |
| fresh vite build --config vite.v4acceptance.config.ts --outDir 本次隔离目录 | exit 0；与 artifact 前端构建输入字节相同 |
| git diff --check | exit 0 |

全套运行的实际命令未附 `tests` 位置过滤，但独立 JSON 核对证明全部 14 个发现文件都在官方 `tests/`，没有 artifacts 或历史副本，达到所要求的官方 tests 范围。UI 六项覆盖：默认隐藏/打开、取消零调用、确认成功且单次调用、pending 重复调用阻断、错误可见且无成功、历史中文标签。

主任务核验命令 exit codes、全部日志 SHA、Vitest JSON 的通过数与文件路径；读取 Rust 原始日志的 11 项具体通过结果。自动分包前后 5813 个输入文件哈希相同；主任务另核验 161 个受保护文件完全相同。

证据：[summary.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/automated/summary.json)、[commands.json](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/automated/commands.json)、[rust log](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/automated/rust-acceptance.log)、[最终独立断言](/Users/linte/Documents/ChatGPT/个人财务模型app开发/artifacts/v012-v4-owner-sandbox-reset-independent-reaudit-20261008/12-final-verification.json)。

原生截图工具一次 capture 错误发生在 fixture 保存后；先读真实 DB 确认保存已完成，再恢复 AX，没有重复提交。它没有改变本轮测试结果，也未被算作产品缺陷。

## 13. P0 / P1 / P2 disposition

| Finding | 最终状态 | 原因 |
|---|---|---|
| P1-SANDBOX-RESET-01 | **CLOSED** | 原生 A/B/C/D + 真实 DB + 隔离与 Production 保全均通过 |
| P2-SANDBOX-HISTORY-01 | **CLOSED** | 原生中文历史正确；原始 enums 不变 |
| P2-F0-02 | OPEN / DEFERRED | 本轮无权扩展或关闭 |
| P2-DISCOVERY-01 | OPEN / DEFERRED | 同上 |
| P2-CSS-01 | OPEN / DEFERRED | 同上；已有 lint warnings 保留 |
| P2-TEXT-01 | OPEN / DEFERRED | 不因相邻历史标签修复而整体关闭 |
| P2-V4-ACTUAL-NOCHANGE-01 | OPEN / DEFERRED | 本轮无新反证 |
| P2-V4-TARGET-01 | OPEN / DEFERRED | 本轮无新反证 |

**P0 = 0；P1 = 0；本轮新增 P2 = 0；既有六项 P2 继续延期。** 以前关闭的 Planning override、stable change、INHERIT、append-only、Actual ordinary/future no-resurrection/void/legacy、Cash lifecycle、restart 与 isolation 保持 PASS，没有发现需要重开的业务回归证据。

## 14. Release blocker status

**RB-V4-OLD-RUNTIME-01 = OPEN。PRODUCTION V4 MIGRATION = NOT AUTHORIZED。** 本次 sandbox reset 通过不能关闭旧 runtime 对正式 V4 数据的兼容风险，也不授予生产迁移或后续阶段实施权限。

冻结 Financial Model V1.0、Core Obligations、Safety/Cash Resources、coverage、债务优先级、资产 eligibility、Repository、schema/migrations、V4 application semantics 均未因本次修复或审计改变。未开始 Stage 4–7。

## 15. Final verdict / receipt

**PF_V012_V4_OWNER_SANDBOX_RESET_REAUDIT_PASS_WITH_P2**

- 已完成：本轮定向原生复审、实际种子读回、取消零写入、重启保全、拒绝性回归、源码/产物与 Production 保全、报告保存。
- 已关闭：P1-SANDBOX-RESET-01、P2-SANDBOX-HISTORY-01。P0 = 0，P1 = 0。
- 未确认：**Owner acceptance remains pending**，没有代 Owner 勾选或宣称 visual/business approval。
- 下一步由 Owner 决定是否接受该独立 sandbox。本轮审计已无待办；六项延期 P2 与 RB-V4-OLD-RUNTIME-01 留给后续另行授权的工作。
- 最终验收 App 已正常退出，测试库恢复审计前的干净种子；源码、RC2、已安装 Production App、Production DB 保持原状。

**STOP AFTER AUDIT REPORT。**
