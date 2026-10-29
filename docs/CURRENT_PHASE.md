# Current Phase

Project: Personal Finance Console

## 2026-10-27 生产恢复 + 首页文案入库（当前权威状态，下文各节均为历史记录）

- Current Phase: **PRODUCTION_ACTIVE_V8 / P0_RESTORE_DONE**（两轮授权重绑定后生产 App 恢复可用，自 11:44:46 持续运行；库零写入）。
- A 线（恢复）：`e21f1e5`（10-27 11:14，固定支出支付保留条目身份 + 补齐 `save_export_file`；身份测试复跑 2/2）→ 11:29 重建 → 11:38 REBIND-01（`owner-approval-ledger-payment-20261027-1`，`d407b7bf…`→`35c69ba5…`）→ 11:44:46 REBIND-02（`…-2`，卷设备号 `16777232`→`16777233`，inode/sha256 未变）→ 启动验收 PID 42838（14:48 实测 elapsed 3:03:37、状态 S、无崩溃报告）。
- 三件套：terminal `0f480aba…0ec7`（`V8_VERIFIED`）/ receipt `ebf02545…d996` / ledger `04439bf4…38a6`（1 条，指向新指纹）；轮换日志 4 条 subsequent + 1 条 volume；两份迁移许可均不存在。
- 生产库（只读）：V8、`integrity_check=ok`、迁移行 8、1,294,336 字节、mtime 2026-10-24 12:03、sha `a0bd66c6…20bc7`；本轮零写入。
- **锚点更正**：10-23 的「829 / 101,187.16、库 `53a45c28…`」已过期。现库 V2 831 / 101,250.26（当月 111 / 9,372.42）、V1 VARIABLE 832 / 101,263.36，差仍 1 笔 13.10；增量是户主自记 `deepseek` ¥50（10-23 21:55）与 `瑞幸` ¥13.10（10-24 12:03），非本轮造成。`expenses.kind` 仅 `CASH_DEBIT`，无 ESSENTIAL 支付行。
- **新发现（未闭合）**：安装包 `codesign --verify --strict` exit 1（adhoc/linker-signed、Info.plist 未绑定、Sealed Resources=none）；11:29 重建未做 bundle 签名，本机 Apple Development 身份仍在。不影响启动（门闸只认可执行指纹），但与既往「strict codesign PASS」口径不一致；补签会改哈希，需与重绑定同批、另出授权。
- B 线（UI）：`2bd9904`（10-27 11:03）首页两卡 16 条逐字文案（任务书 §11.2 实测 16/16=1、§11.3 13/13=0）+ 20 句轮换文案 `v2-month-copy.ts` + 加载/禁用三态已入库；固定支出页组件 `FixedExpensesPage.tsx`（372 行）已在库，结构/文案提案（单聊第 5–13 条）未定稿；债务页未开始；单聊第 1–4 条首页项已由任务书定稿。
- 回执与证据：`evidence/ledger-payment-rebind-20261027/RECEIPT.md`（实测值、只读库核对、锚点更正、codesign 发现、未做边界）。
- 仍未闭合：`RB-V4-CUTOVER-QUIESCENCE-01` 仍 OPEN（未建迁移许可）；卷设备号绑定存在同类重挂复现风险；工作区 8 个已跟踪改动 + 47 个未跟踪文件（含本回执目录）未提交。
- 下一步：户主 GUI 点验（导出备份、固定支出同类别两笔支付）→ 是否补签重建（另出授权）→ 固定支出页 9 条定稿 → V4 cutover 规划。

## 2026-10-23 EXEC-UX-ROUND2 合成轮（历史记录）

- Current Phase: **PRODUCTION_ACTIVE_V8 / UX_ROUND2_DELIVERED**（设计稿实现 + 流水翻月 + 5 新分类与词表 + 全量归类 + 4 缺陷修复，已装包；交户主试用验收）。
- 已装生产包：`/Applications/Personal Finance Console.app`（Bundle ID `com.personalfinance.console`），可执行 sha **`d407b7bf…c09c86c`**（EXEC-UX-ROUND2 最终包，含日历弹层修复）；两次字段级热修轮换均在同一授权 `owner-approval-ux-round2-20261023-1` 下完成：#1 `6f957ba0…`→`bb74f2aa…`，#2 `bb74f2aa…`→`d407b7bf…`（审计目录 `ux-round2-20261023` / `ux-round2-20261023-calendar-fix`）。
- 三件套现行哈希：terminal `d714aed7c9caa3c9fc387d5e6675f02a1303326315df025ef55ef227f2716fe9` / receipt `9b3e440cefd8281381e1594507df47a09bd5d18d2cbfc0bf46fe805a10737e81` / ledger `0d7db2bb369c9459c9845cd5a2ed82a2cc9e7a9a5430732b346d6ca324d285c1`；轮换日志 3 条（R13B 原始 + 本轮两次），迁移历史字段逐值未变。
- 生产库：Schema **V8**（`user_version=8`，本轮无迁移），哈希 **`53a45c28…29aee7`**；`integrity_check` ok；轮换前哈希 `d4931cbd…`（terminal）/ 库 `35f0b5ed…`，库推进系本轮界面删除 4 笔 ¥1.00 验证数据。
- 锚点（当月 / 全量）：V2 109 / 9,309.32 · 829 / 101,187.16；V1 VARIABLE 110 / 9,322.42 · 830 / 101,200.26；差 1 笔 13.10（`daea72ab…`，2026-10-05 历史行，非本轮造成）。0 元行 14、导入 12 批 / 100,450.11、火山 49.9 两笔（10-21、10-22）、债务 5 笔 172,579.53 / 应还 14,518.73、现金 5,325.93、安全垫 25,325.93 全部未动。
- 分类：新增 医疗/居住/水电/保险/教育（11 个启用分类），词表补齐商户关键词；只读模拟 93 笔 / 13,765.53，界面逐月「自动归类」实际改动 **87 笔 / 13,418.24**（差额 6 笔 / 347.29 未逐笔归因；按现行词表重放现库 0 笔待归类）。「其他」剩 103 笔 / 19,827.04（当月 10 笔 / 1,324.06）。
- 流水页真实翻月（独立月份状态，非 `__WP03_PREVIEW_BUILD__` 开关，该开关仍 false），任意月份可编辑/删除/导出，导出仍全量。
- 4 缺陷已修：我的财务 `min-height:100vh` 空白、固定支出英文枚举（3 条 name 经编辑界面存为中文，合计 3,528.00 不变）、隐私页挤压、导入控件未样式化。
- 验收中另发现并修复：日历弹层被记一笔面板 `overflow:auto` 裁切（只露 1–4 日），改 `position:fixed` + 视口锚定（宽高/圆角/阴影等稿定值不动），故有第 2 次热修轮换。
- 测试基线 **457 / 0 / 80**（与上轮完全一致，本轮无新增测试）；typecheck / lint 绿。
- 已知缺项（如实）：记完一天、首页正常/接近态、建立余地完成态未取截图（均为不造数）；庆祝与月度小结截图取自轮换 #1 的包（代码未变）。
- 证据与回执：`evidence/ux-round2-20261023/`（`RECEIPT.md` 含逐节勾验表、双口径锚点、覆盖率、4 缺陷前后、两次轮换哈希）。
- 下一步：户主试用验收；若认可，再议 V0.2（账户管理入口 F8、收入/固定计划/预留额无入口 F5–F7 等既有欠账）。

## 2026-10-23 自动归类执行（历史记录）

- Current Phase: **PRODUCTION_ACTIVE_V8 / RECATEGORIZE_DONE_WITH_SCOPE_FINDING**（户主授权的重归类已按界面执行；「824 笔」前提不成立，差额待户主裁决）。
- 已装生产包：**未变**——`/Applications/Personal Finance Console.app`，可执行 sha `6f957ba0…43bae4`（EXEC-UX-REVAMP 包）；本批零代码改动、未重建、未安装。
- 生产库：Schema **V8**，哈希 **`ed46bc2f…aa8c6`**（执行前 `980f1df5…ef51e`；推进即本批 17 行分类写入，界面合法写入）。`integrity_check` ok。
- 本批动作：我的财务 → 收支账本 → 「自动归类」→「就按这个改」，应用回话「改好 17 笔分类。总金额 ¥101,187.16 不变。」审计留痕 `app_metadata['ux.audit.v1']`（`RECATEGORIZE` / assignments 17 / updated 17）。
- 分类分布：餐饮 229→**246**（+620.34），娱乐 79→**64**（−387.84），其他 161→**159**（−232.50）；交通/购物/家居不动。合计 829 笔 / 101,187.16 **不变**。
- 两口径锚点：V2 全量 829 / 101,187.16（未变）；V2 当月 109 / 9,309.32（未变）；V1 VARIABLE 830 / 101,200.26（未变，D-01 镜像固定 `OTHER_VARIABLE`）；双账本差仍为 1 笔 / 13.10（`daea72ab…`，2026-10-05 历史行）。导入 12 批 / 100,450.11、0 元行 14（当月 3）、债务 5 笔 172,579.53/14,518.73 均未动。
- **范围发现**：「824 笔」系把 R12 导入行数误当待归类行数。规则引擎全库只认 **52 笔**，界面按会话月份只开 2026-10，故实际可执行 **17 笔**；余 **35 笔 / 2,491.89 元**在其他月份（需开月份导航才触达）；「其他」剩 159 笔 / 30,599.08 中 **146 笔 / 29,087.68 元现有规则完全不认**（医疗/居住/水电/保险/教育规则指向户主没有的分类，`resolveCategory` 返回 null；商户词表亦未覆盖闲鱼/中国移动等）。
- 户主更正已落实：「火山 49.9」两条（2026-10-21 `277113a9…`、2026-10-22 `6f67daf3…`）是两笔真实消费，**不是重复**、**未删除**；UX 改版回执 §9.4 已撤回原「可删」建议。
- 测试基线沿用 **457 / 0 / 80**（本批无代码改动，未重跑）。
- 证据：`evidence/recategorize-824-20261023/`（含 RECEIPT.md、改前后快照、界面原文、截图、库哈希）。
- 下一步（待户主裁决）：B 开流水页月份导航（需重建+重绑定+再装）可再吃到 35 笔；C 补「医疗/居住/水电/保险/教育」分类与商户词表，才能动「其他」里那 146 笔。**C 优先于 B**（B 只多 35 笔）。

## 2026-10-23 UX 体验改版交付（历史记录；包与测试基线仍现行）

- Current Phase: **PRODUCTION_ACTIVE_V8 / UX_REVAMP_DELIVERED**（体验改版已装包，交户主试用；V0.2 规划继续）。
- 已装生产包：`/Applications/Personal Finance Console.app`（Bundle ID `com.personalfinance.console`，可执行 sha `6f957ba0…43bae4`，EXEC-UX-REVAMP 包；2026-10-23 经热修重绑定 `owner-approval-ux-revamp-20261023-1` 接入生产授权链，前序指纹 `ea430fe9…f44baa`）。
- 三件套现行哈希：terminal `341ad187…852e6d` / receipt `9b0f622b…e60fab` / ledger `b975f1ff…cc9755`；台账仍恰 1 条，迁移历史字段逐值未变。
- 生产库：Schema **V8**，哈希 `980f1df5…ef51e`（R13B 后为 `857fda16…6d2a2f`，推进系户主 2026-10-23 自行在界面记 4 笔，本批交付过程零写入）；`integrity_check` ok。
- 消费锚点（当月 / 全量分列）：V2 `expenses` 829 笔 / 101,187.16（2026-10：109 笔 / 9,309.32）；V1 `expense_records` VARIABLE 830 笔 / 101,200.26（2026-10：110 笔 / 9,322.42）；差 1 笔 13.10 为 V2 上线前历史行（`daea72ab…`，2026-10-05），非本批造成。导入 12 批 / 100,450.11；0 元行 14（当月 3，照实留账不进模型）。
- 财务基线：5 笔债务，2026-10 余额 172,579.53 / 应还 14,518.73；现金 5,325.93；资产 40,000.00。
- 测试基线：**457 passed / 0 failed / 80 skipped（537）**，48 个测试文件；typecheck/lint 绿。
- 改版 14 项：**12 项功能落地**（首页拆卡、记账文字反馈、日历控件、路由修复、金额统一、固定支出页、债务还款、分类显示、删除/编辑、导出、导入智能化、账本去重、隐私内容），**第 13 项整体暂停**且 2.1/2.2/2.3/2.5 视觉样式同受 §0.1 设计稿门控（`docs/DESIGN-UX-REVAMP-20261023.md` 仍不存在），**第 8 项配套的 824 笔批量重归类功能就绪但未跑生产**（待户主点头）。
- 已登记 4 个用后缺陷（本轮只允许装一次包，留待下一轮）：我的财务页 `min-height:100vh` 把三个入口推到一屏外；固定支出显示原始枚举名；隐私页三栏排版挤压；导入控件未样式化（属设计门控）。
- 流程铁律不变：凡「改代码重建」任务书必须带热修发布授权段；小修同样要重建包，须先出授权段再装。
- 下一步：户主试用验收（看感受：不乱、有反馈感、看得懂）→ 设计稿到位后补审美项 → 824 重归类与 4 个缺陷随下一轮修。

## 2026-10-23 R13B 收官后现状（历史记录）

- Current Phase: **PRODUCTION_ACTIVE_V8 / POST_LANDING**（macOS 落地验收已收官，生产日常使用中；V0.2 规划阶段）。
- 已装生产包：`/Applications/Personal Finance Console.app`（Bundle ID `com.personalfinance.console`，可执行 sha `ea430fe9…f44baa`，R13 零元热修包；2026-10-23 经 R13B 授权热修重绑定 `owner-approval-r13b-20261022-1` 绑定进生产授权链，验收通过）。
- 生产库：Schema **V8**，哈希 `857fda16…6d2a2f`（R11B/R12/R13/R13B 全程核验未变）；12 批 824 笔真实消费 100,450.11 元已导入；0 元支出行 14（照实留账、不进月度模型，R13 口径）。
- 测试基线：**444 passed / 0 failed / 80 skipped**（R13 热修后，含 2 条 0 元回归）。
- 首页锚点口径：「已花」=**当月**支出（2026-10 实测 8,635.27）；全量累计 100,513.11 是库侧锚点——验收锚点必须区分「当月 / 全量累计」（EXEC-R13B §5 勘误）。
- 财务基线：5 笔债务合计 172,579.53（当月应还 14,518.73）；现金 5,325.93 / 安全资源 25,325.93（修订表口径）。
- 流程铁律：**凡「改代码重建」类任务书必须带热修发布授权段**（EXEC-R13B §2–§4 为模板），否则必被门闸拒启；门闸原生轮换链列为后续加固项（REMAINING-ISSUES A3）。
- 已闭环：落地验收（户主终审通过）→ R11B 真数重播 → R12 消费导入 → R13 零元热修 → R13B 授权重绑定与收尾验收。
- 下一步：V0.2 规划（编辑/删除优先级已上调；F5–F8 写入口补齐等见 `docs/REMAINING-ISSUES-20261022.md` 优先级表）。iOS/手机尺寸与 App Store 准备不在本次范围。

## 2026-10-22 落地冻结点（历史记录）

- Current Phase: **LANDING_FROZEN_PENDING_FINAL_ACCEPTANCE**（macOS 落地冻结，待独立验收模型复核 + 户主最终拍板）。
- 已装生产包：`/Applications/Personal Finance Console.app`（Bundle ID `com.personalfinance.console`，可执行 sha `44472945…ace4711b5c`，R10 经批准候选，2026-10-22 安装）。
- 生产库：Schema **V8**（user_version=8，migrations [1..8]，integrity ok）；`~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`。V3→V8 真实迁移已于 2026-10-22 完成并验收（R10_PASS，证据 `evidence/r10-production-migration-20261022/`），双备份在位。
- 冻结点源码提交：`e6aa8d5`；测试基线 442 passed / 80 skipped。
- 财务基线：5 笔债务，2026-11 合计 157,228.31，当月应还 8,851.03（户主 2026-10-21 五项对账裁决后口径）。
- 产品落地线（U-01…U-14 / build-41…50）与数据迁移线（R8/R9/R10）均已闭环；剩余问题见 `docs/REMAINING-ISSUES-20261022.md`。
- 下一步：按 `docs/EXEC-A01-LANDING-ACCEPTANCE-INSTRUCTIONS.md` 交独立验收模型做落地验收；最终验收权在户主。iOS/手机尺寸与 App Store 准备不在本次范围。

### 下文为历史记录（2026-10-09 起的治理与阶段档案，其中「Production V3 / NOT AUTHORIZED」等表述已被上文取代）

Current Phase: CURRENT_VERSION_TESTING

Parallel Preparation Stage: NATIVE_MIGRATION_PREPARATION (planning only)

PRODUCT_READY_FOR_NATIVE_MIGRATION: false

Installed Production historical baseline: PERSONAL_FINANCE_CONSOLE_V01_PRODUCTION_ACTIVE / Schema V3; not refreshed or changed in this preparation turn.

Financial Model: V1.0 APPROVED / FROZEN

Phase 1: APPROVED.
Phase 2: APPROVED.
Phase 3: APPROVED.

V0.1 Status: `PERSONAL_FINANCE_CONSOLE_V01_PRODUCTION_ACTIVE`.

## WP-03 Product Daily-Use Completion (2026-10-12)

- Execution report: `../WP03_PRODUCT_DAILY_USE_COMPLETION_REPORT.md`; final status `WP03_PRODUCT_DAILY_USE_REGRESSION_FAILED`.
- Product capabilities were added to ordinary UI and automatic tests pass, but build-03 strict macOS signature verification still fails on `com.apple.FinderInfo`. build-01 predates the last UI source correction and is not the final candidate. Full UI workflow and same-package restart remain unverified.
- WP-03 is not ready for Planning review as a completed product. Production, WP-02 data, installation, and migration were not touched. See `../evidence/wp03-product-daily-use/`.

## Current Workstream — Current Version Testing / Native Migration Preparation

- Latest Owner instruction (2026-10-09, user message01a1202b-499e-7f40-a827-ed37dbb83c4d): continue current-version testing/correction/product validation through acceptance, and add NATIVE_MIGRATION_PREPARATION in the SAME hierarchy. Future macOS+iPhone native direction is confirmed, but no formal Xcode project, Swift/SwiftUI rewrite, unconfirmed feature or parallel decision chain is authorized.
- All six specified gates must PASS before PRODUCT_READY_FOR_NATIVE_MIGRATION. Gate2 is PASS only for frozen financial rules; the other five are PENDING. Gate6 reuses prior Owner scope approval when reconciliation shows no unresolved change; no repeated signature is required merely because this stage is new. Live gate/issues record: NATIVE_MIGRATION_PREPARATION.md; report: ../XIAOQIANJIA_NATIVE_MIGRATION_READINESS_V0.1.md.
- WP-02 new-domain A preflight, implementation review and approved build-01 real UI scenario are complete. Stable income changed from 10,000.00 to 11,000.01; history, normal close and same-package reopen passed. Read-only post-close checks found schema v4 integrity `ok`, one planning-income revision, zero actual-income revisions, zero expenses/assets, no sidecars, and an unchanged database hash after restart. Scoped report: `evidence/acceptance/wp02-20261009/TAKEOVER_UI_ACCEPTANCE_20261012.md`. Owner acceptance remains pending. The original smoke database and Q process were left untouched; Production remains unauthorized.

### Historical — WP-01 handoff before the latest testing approval

- Latest progress (2026-10-09): WP-01 approved scope is COMPLETE through Execution→Audit→Acceptance intake→manager cross-evidence review. Exact commit92ec24136d732e05375760d736ef508c66dd2c0e/build-15; no remaining required correction. This is an unlaunched isolated package and technical evidence, not real runtime acceptance. WP-02's approved new identity/path guard, synthetic checks, unlaunched build-01 and exact new-domain metadata preflight are complete; independent review and new-synthetic-data UI save/history/normal-close/reopen remain pending. Unknown/old data or ambiguous routing stops runtime without overwrite/reset/migration. Production remains entirely unauthorized.
- 2026-10-09: `PLANNING_GOVERNANCE_READY`. Owner assigned sole Planning to `01a11f98-199c-7332-b6a1-1e9b30d57d2e`. Long-term Acceptance `01a11fa2-43f3-7c70-bf59-58bd6c2556e9` has been created. AC-001 read-only intake is complete; Audit classified AF-AC001-001 as EVIDENCE_GAP, Acceptance independently acknowledged it, and Planning completed this governance cross-review. Proof remains NOT_VERIFIED; real product acceptance has not run. NO_EXECUTION_PLAN; Execution action now is NONE.
- Commit `943fab08f6f45d7d7830246db6d28647c418de85` passed the latest independent A/B/C/D scoped technical audit. See [independent result](../V012_V4_CUTOVER_QUIESCENCE_ABCD_INDEPENDENT_ACCEPTANCE.md). This supersedes the older integration-blocked / re-audit-pending snapshot below only for the evidenced scope; it is not whole-project or Production acceptance.
- Governance and role routing: [PLANNING_GOVERNANCE.md](PLANNING_GOVERNANCE.md). Owner's latest final product definition and status matrix: [FINAL_DOD_MATRIX.md](FINAL_DOD_MATRIX.md). The goal is a daily-usable, local-first macOS App branded 小钱家 with unchanged Production identity and ledger paths, complete real UI workflows, preserved Owner data and frozen Model V1.0.
- A/B/C/D closed scope, prior Sandbox acceptance and prior old-runtime closure are preserved. Renderer-only termination remains NOT VERIFIED; historical Q01–Q18 gaps require evidence-specific technical classification, not blanket PASS or blanket re-testing.
- `RB-V4-CUTOVER-QUIESCENCE-01 = OPEN`. `RB-V4-CUTOVER-INVENTORY-01 = SUPERSEDED_BY_RB-V4-CUTOVER-QUIESCENCE-01`, not CLOSED. `RB-V4-OLD-RUNTIME-01 = CLOSED` remains historical Owner closure.
- Production remains historically recorded as V3; no fresh Production read was authorized or performed in this governance turn. Production V4 migration, runtime replacement/launch, backup, restore, permit, release receipt, candidate freeze and blocker closure remain NOT AUTHORIZED. Final DoD definition is not implementation permission.
- No `PROJECT_READY_FOR_FINAL_OWNER_ACCEPTANCE` is claimed. Only after all required evidence and preceding decisions are complete may Planning propose it; only explicit subsequent Owner final acceptance permits `XIAOQIANJIA_V01_LANDED`.

## Historical — V0.1.2 V4 Cutover Quiescence Initial Isolated Implementation

- 2026-10-09 integration closure: `PF_V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_BLOCKED`. New v2 native/managed/IPC/startup code and failure evidence are saved, but real Tauri Q11, final S1/native lease/formal end-to-end acceptance are incomplete. Exact synthetic old/native PIDs encountered AMFI/Gatekeeper rejection; actual launch retries stopped. Recovery failure ledger/terminal publication also remain incomplete. Executed safe regressions pass; required blocked coverage is not PASS. See [Integration Closure Report](../V012_V4_CUTOVER_QUIESCENCE_INTEGRATION_CLOSURE_REPORT.md).
- Production DB/executable/plist raw fingerprints are unchanged in this run; no Production SQLite connection, installed Production launch or migration was performed. First failed test created a default-store WebView before its setup guard; broader OS profile zero-side-effect proof remains unconfirmed, as disclosed in the new report. This is not a final Production candidate freeze or authorization. No Experiment Closure or independent re-audit readiness is declared.
- On 2026-10-08, Owner approved `V012_V4_CUTOVER_QUIESCENCE_CONTRACT_REDESIGN.md`, OD-01–OD-08, for isolated implementation and synthetic verification only. SQLite built-in recovery and mode-probe infrastructure effects are authorized only against synthetic fixtures in this task.
- `RB-V4-CUTOVER-INVENTORY-01 = SUPERSEDED_BY_RB-V4-CUTOVER-QUIESCENCE-01`. SUPERSEDED is not CLOSED. The historical capability failure below remains unchanged evidence.
- `RB-V4-CUTOVER-QUIESCENCE-01 = OPEN`. `RB-V4-OLD-RUNTIME-01 = CLOSED` remains the historical Owner closure.
- Production remains Schema V3; Production V4 migration is NOT AUTHORIZED. No candidate freeze, Production replacement/retirement/backup/launch/write/recovery/checkpoint, real permit or release receipt, Stage 4–7, V0.2, financial-model changes, or deferred P2 cleanup is authorized.
- Implementation and experiments must be independently re-audited; implementation reports do not close this blocker or authorize Production cutover.

## Historical — V0.1.2 V4 Cutover Inventory — Phase A Capability Blocked

- On 2026-10-08, Owner authorized ordinary-user isolated inventory capability proof and only conditionally full implementation. Result: `PF_V012_V4_CUTOVER_INVENTORY_CAPABILITY_BLOCKED`.
- At that time, `RB-V4-CUTOVER-INVENTORY-01 = OPEN`: the audited inventory contract was being changed for real macOS cutover compatibility; ordinary-user R/H capability was not proven. Its current supersession is recorded above. `RB-V4-OLD-RUNTIME-01 = CLOSED` remains the historical Owner decision below.
- R: `R_CAPABILITY_INSUFFICIENT`; H: `H_CAPABILITY_NOT_PROVABLE_WITH_CURRENT_APPROACH`; graph: `APP_GRAPH_CAPABILITY_PROVEN` only for isolated A–G graph behavior, not the complete App contract. Exact-current-path queries miss held old vnodes after rename/unlink; protected-PID visibility and snapshot/race protection remain unresolved.
- Full gate implementation / Phase B did not start. No production runtime, gate source, database, permit, migration authorization, or release receipt was changed or generated. No Production launch, backup, replacement, retirement or migration occurred.
- Preserve `PF_V012_V4_OWNER_SANDBOX_ACCEPTED`; only `OWNER_ACCEPTANCE_RECORD_NOT_PRESENT_IN_CURRENT_PROJECT_EVIDENCE` remains, not pending Owner acceptance. The ¥13.10 expense remains `OWNER_RECOGNIZED_NORMAL_USE_EXPENSE`.
- Evidence and next Owner decision: [Inventory Capability Report](../V012_V4_CUTOVER_INVENTORY_CAPABILITY_REPORT.md). Review missing image/lineage/permission/race mechanisms before any separately authorized continuation. No automatic sudo or weakened contract. Production V4 migration remains NOT AUTHORIZED; Stage 4–7 and V0.2 remain unstarted.

## Authoritative Owner Closure — Old-Runtime Protection

- On 2026-10-08, Owner closed `RB-V4-OLD-RUNTIME-01` based on the independent final re-audit `PF_V012_V4_OLD_RUNTIME_GATE_ENTRY_P1_REAUDIT_PASS_WITH_P2` of commit `06bd72291f148ed768f59ee06e3fe9398a75cb6e`.
- Final audit: P0 = 0; P1 = 0. `P1-OLD-GATE-ENTRY-01` is CLOSED. Previously closed old-runtime P1 findings remain CLOSED; old-runtime-related P2 findings are CLOSED. The six pre-existing non-blocking P2 items remain OPEN / DEFERRED.
- Owner closure record: [V012_V4_OLD_RUNTIME_PROTECTION_OWNER_CLOSURE.md](../V012_V4_OLD_RUNTIME_PROTECTION_OWNER_CLOSURE.md). Independent audit report reference: `V012_V4_OLD_RUNTIME_PROTECTION_GATE_ENTRY_P1_INDEPENDENT_REAUDIT.md` (preserved as independent evidence).
- This closure closes only the old-runtime protection release blocker. Production remains Schema V3 with migrations `[1,2,3]`; Production V4 migration remains NOT AUTHORIZED.
- This closure does not authorize Production App replacement, old App retirement, Production backup creation, Production runtime launch, Production data write, or V3→V4 migration. Each requires separate Owner authorization.

V0.1.2 Phase 1: `OWNER_PHASE1_APPROVED_AND_CLOSED` (Owner closure date: 2026-10-07).

Independent final audit: `PF_V012_PHASE1_F0_EXCEPTION_REAUDIT_PASS_WITH_P2` — P0 = 0; P1 = 0. P1-F0-01, P1-MONEY-01, P1-LANGUAGE-01, and P2-EVIDENCE-01 are CLOSED. Four accepted P2 items remain OPEN / DEFERRED: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, and P2-TEXT-01.

Accepted V0.1.2 Phase 1 scope: F0 single-domain save / persistence-truth foundation; A responsive monetary display; B consumer-language detail presentation. The accepted implementation is preserved as the Phase 1 baseline.

Protected baseline remains Financial Model V1.0, existing V3 data and semantics, debt precedence, Planning / Actual separation, Safety formulas, `cashFloorMet`, Gate logic, asset revision semantics, Stage 3 visual baseline, responsive money behavior, and consumer-language hierarchy. Production remains Schema V3 and RC2 remains unchanged. Owner has separately authorized only the V4 additive migration foundation; no UI stage is authorized by that work.

V0.1.2 V4 Additive Migration Foundation: `OWNER_V4_FOUNDATION_ACCEPTED` (Owner acceptance date: 2026-10-07). Independent final audit: `PF_V012_V4_ACTUAL02_REAUDIT_PASS_WITH_RELEASE_BLOCKER`. P0 = 0; P1 = 0. P1-V4-PLANNING-01, P1-V4-ACTUAL-01, P1-V4-ACTUAL-02, and P1-V4-PERSISTENCE-01 are CLOSED. Six P2 items remain OPEN / DEFERRED. **Historical at Foundation acceptance:** `RB-V4-OLD-RUNTIME-01` remained OPEN and Production V4 migration was NOT AUTHORIZED. The subsequent final gate-entry re-audit and Owner closure are recorded above. Evidence: [V012_V4_ACTUAL02_INDEPENDENT_FINAL_REAUDIT.md](../V012_V4_ACTUAL02_INDEPENDENT_FINAL_REAUDIT.md) and [V012_V4_ACTUAL02_FINAL_CORRECTION_REPORT.md](../V012_V4_ACTUAL02_FINAL_CORRECTION_REPORT.md).

V0.1 BASE FRAMEWORK FROZEN. Production Owner Bootstrap Final Audit: PASS. P0 = 0; P1 = 0; six accepted P2 items = DEFERRED. Owner Production data = ACTIVE. Production runtime = ACTIVE / authoritative. V0.2 = NOT STARTED. No bootstrap, import, or final-audit action remains pending.

## Authoritative Current State — Production Active

- The independent final audit report [OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT.md](../OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT.md) records `PF_OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT_PASS`, P0 = 0, P1 = 0; Owner accepts that result.
- The authoritative installed Production runtime is active. Audit-accepted Production DB SHA-256: `ec0da560df20030934a60d61bf83a5ee74bc402c55b8a064b9454f572d18f419`.
- Financial Model V1.0 remains approved and frozen. Six accepted P2 items remain deferred. V0.2 has not started.
- Owner bootstrap, import, and independent final audit are complete; no such action remains pending.
- Activation closure evidence: [V01_PRODUCTION_ACTIVATION_RECEIPT.md](../V01_PRODUCTION_ACTIVATION_RECEIPT.md).

## Historical — Owner Production Bootstrap Ready for Independent Final Audit

- Owner authorized the first Production Owner-data bootstrap on 2026-10-04 after accepting `PF_OWNER_BOOTSTRAP_DOCUMENTS_FINALIZED_READY_FOR_IMPORT_AUTHORIZATION`.
- Installed Production runtime identity matched the authorization: bundle `com.personalfinance.console`, version `0.1.0`, executable SHA-256 `3fe54d946dc8c8a13a167c4dd9f898b90b65499082d83c797867bfea5b184c3d`.
- A new byte-for-byte empty-V3 pre-bootstrap backup was created at `../artifacts/owner-bootstrap-pre-import-backups/production-v3-empty-pre-owner-bootstrap-20261004-225715+0800.sqlite3` and verified against the baseline hash.
- The approved candidate was submitted through installed Production onboarding. All Owner data read back through Application Services. The three locked assets were changed to `kind=OTHER` and retained `include_in_safety_resources=false` through the existing financial-maintenance Application Service.
- Production readback passed: V3, migrations `[1,2,3]`, integrity `ok`, foreign-key check empty, no sidecars, 1 profile, 0 Actual Income rows, 0 expense rows. The frozen full model matched the authorized outputs, including debt 172,579.53, mandatory service 14,518.73, safety resources 8,647.61, `STRUCTURAL_DEFICIT`, active cash gate, `RESTORE_CORE_BALANCE`, and `BASELINE_BUILDING`.
- The installed Production app was relaunched after import; onboarding did not reappear and Home loaded without crash. The app was closed after this check. Final DB SHA-256: `ec0da560df20030934a60d61bf83a5ee74bc402c55b8a064b9454f572d18f419`.
- Detailed execution evidence: [Owner Production Bootstrap Execution Receipt V2](../OWNER_PRODUCTION_BOOTSTRAP_EXECUTION_RECEIPT_V2.md). At that stage, the status was `PF_OWNER_PRODUCTION_BOOTSTRAP_READY_FOR_INDEPENDENT_FINAL_AUDIT`; the subsequent accepted final audit superseded it. V0.2 remains not started; all six P2 items remain deferred.

## V0.1.2 V4 Foundation — Owner Accepted

- Owner accepted the isolated Schema V4 Additive Foundation on 2026-10-07: `OWNER_V4_FOUNDATION_ACCEPTED`.
- Independent final audit: `PF_V012_V4_ACTUAL02_REAUDIT_PASS_WITH_RELEASE_BLOCKER`; V4 Foundation Technical Audit = PASS; P0 = 0; P1 = 0. All four V4 P1 findings are CLOSED.
- Six P2 findings remain OPEN / DEFERRED: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, P2-TEXT-01, P2-V4-ACTUAL-NOCHANGE-01, and P2-V4-TARGET-01.
- At the time of V4 Foundation acceptance, `RB-V4-OLD-RUNTIME-01` remained OPEN and mandatory before release / Production migration. This is a historical status superseded by the Owner closure recorded above. Production V4 migration remains NOT AUTHORIZED.
- Financial Model V1.0 remains frozen. No Planning UI, Stage 4–7, Production migration, old-runtime protection, or P2 cleanup is authorized by this acceptance.
- The earlier `PF_V012_V4_MIGRATION_READY_FOR_AUDIT` status was a completed prior stage and is superseded by Owner acceptance and the independent final audit.

## Historical — Owner Chinese Display-Name Normalization — Ready

- Owner approved Chinese Owner-visible `name` values for the existing cash accounts, assets, and debts. The candidate now uses the exact Chinese names; internal enums and identifiers remain unchanged.
- Essential expense import remains category-level: `HOUSING=1900`, `TRANSPORT=1028`, `UTILITIES_COMMUNICATIONS=600`. The five-part breakdown is retained as Owner context and is not expanded into unsupported onboarding rows.
- Isolated React onboarding and real Application Service tests confirm Chinese names pass validation and persist/read back exactly in UTF-8. English-name and Chinese-name candidates produce identical Home / Model Core outputs. No Production data was used for this validation.
- Stage status at that time: `PF_OWNER_CHINESE_DISPLAY_NAMES_READY_FOR_IMPORT`. It recorded preparation before the later import authorization; it is not the current Production state.
- Evidence and current mappings: [Owner Production Bootstrap Candidate](../OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md), [Model Preflight](../OWNER_BOOTSTRAP_MODEL_PREFLIGHT_V1.md), [Chinese display-name validation](../OWNER_CHINESE_DISPLAY_NAME_VALIDATION.md).


## Audited Runtime Re-Pin and No-Write Onboarding Dry Run — Completed

- Owner accepted `PF_ONBOARDING_FALSE_SELECTION_FIX_AUDIT_PASS` and authorized only exact runtime re-pin plus a no-write Production onboarding dry run.
- The old installed Production app (`com.personalfinance.console`, `0.1.0`, executable SHA-256 `c6cfcd8832a19a6df86d35085cfed9a791a10b8769d3206165a6977fc96b4dce`) was preserved and recursively verified at [runtime archive](../artifacts/production-runtime-archives/Personal%20Finance%20Console.app.pre-audited-repin-20261004-193841+0800).
- The independently audited executable (`3fe54d946dc8c8a13a167c4dd9f898b90b65499082d83c797867bfea5b184c3d`) was installed without rebuilding. Installed bundle ID/version and executable hash were read back before launch and again after close.
- Production precheck, pre-launch post-install check, and post-dry-run check retained empty V3 baseline SHA-256 `2bd2973cc7e2b04c86b0b3e8554ad3a1543786d6ed496cddcaf44eba04d07fb4`; schema V3, migrations [1,2,3], all 19 application/financial tables empty, profiles=0, integrity `ok`, no FK rows, and no sidecars.
- The approved Owner candidate was entered in the real installed onboarding UI. Restricted rent cash and all three locked assets retained explicit NO selections; the app advanced past the prior cash/assets/debts step to step 4/4 without a validation error. The final “完成设置” action was not pressed. The app was closed normally. Standard startup opened the DB and ran the migration check; the already-V3 DB remained byte-identical. The tested step transition invoked no service, and `completeOnboarding` was not invoked.
- Full evidence is recorded in [Audited Runtime Re-Pin and Onboarding Dry Run](../AUDITED_RUNTIME_REPIN_AND_ONBOARDING_DRYRUN.md). Status: `PF_AUDITED_RUNTIME_DRYRUN_READY_FOR_OWNER_REVIEW`.
- Smoke was not launched or modified. Owner data remains unimported; bootstrap is paused pending separate authorization. V0.2 remains not started; all six P2 items remain deferred.

## Historical Root-Cause Correction

The prior Production bootstrap was genuinely blocked in the then-installed runtime, as recorded in the original execution receipt; preserve that receipt unchanged. The earlier claim that explicit false validation caused the block is superseded as **UNCONFIRMED** because independent re-audit restored frozen onboarding source passed the same true / false / unselected controls. The audited runtime dry run now separately confirms the approved explicit NO selections pass through the real UI. Do not infer the old runtime's root cause from this result. See the [dry-run report](../AUDITED_RUNTIME_REPIN_AND_ONBOARDING_DRYRUN.md).

## Onboarding False-Selection Repair — Accepted

- The independent audit status `PF_ONBOARDING_FALSE_SELECTION_FIX_AUDIT_PASS` was accepted by Owner. The source maintains UNSELECTED distinct from explicit true and false.
- Independent test and UI/SQLite evidence is in [the re-audit report](../ONBOARDING_FALSE_SELECTION_FIX_REAUDIT.md). The restored frozen source passed the same controls; the prior installed-runtime root cause was not proven.
- No additional code, Financial Model, schema, or Data Contract change occurred in the runtime re-pin and UI dry-run phase.

## Historical — Owner Production Bootstrap Paused Before First Write

- The earlier Owner bootstrap execution stopped before the first Owner-data write. Its original [execution receipt](../OWNER_PRODUCTION_BOOTSTRAP_EXECUTION_RECEIPT_V1.md) remains preserved without edits.
- The then-installed-runtime behavior is documented there; root-cause attribution to false-selection validation is explicitly superseded as UNCONFIRMED by independent re-audit and the audited runtime dry run.
- This section describes the completed historical pause. The later Owner authorization and successful bootstrap are recorded below and supersede its stop state.

## Production V3 Migration Checkpoint — Historical

The following records the completed V3 schema migration preceding runtime pinning.

- Owner accepted `PF_V01_FINAL_AUDIT_PASS` on 2026-10-04: P0=0, P1=0, P2=6 deferred. V0.1 base framework and Financial Model V1.0 remain frozen.
- Owner approved [OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md](../OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md) and its full Model Core preflight for later import, but explicitly prohibited data import in the current decision.
- Authorized V2→V3 Production schema-migration-only checkpoint completed: `PF_PRODUCTION_V3_EMPTY_BASELINE_READY_FOR_OWNER_REVIEW`.
- Production identity/runtime: `com.personalfinance.console`; exact DB path: `/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`. Migration used the current project Production release and the normal startup migration path.
- Pre-migration V2 source SHA-256: `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`. Verified byte-for-byte clean backup: [V2 migration backup](../artifacts/production-v3-migration-checkpoints/production-v2-clean-backup-20261004-171915+0800.sqlite3); backup hash equals source hash.
- Post-migration Production schema and `user_version` are V3/3; migrations [1,2,3] are recorded. All 19 non-migration application/financial tables remain empty; integrity is `ok`; foreign-key check is empty; no WAL/SHM/journal sidecars remain.
- New `PRODUCTION_V3_EMPTY_BASELINE_SHA256`: `2bd2973cc7e2b04c86b0b3e8554ad3a1543786d6ed496cddcaf44eba04d07fb4`.
- Production displayed fresh onboarding at step 1/4; no fields were entered or submitted. No Owner profile or financial data has been imported. V0.2 remains not started.
- Full evidence is recorded in [PRODUCTION_V3_MIGRATION_CHECKPOINT.md](../PRODUCTION_V3_MIGRATION_CHECKPOINT.md). No Smoke runtime/database was launched, opened, or written.
- Historical next Owner decision at migration time: review the V3 empty-baseline checkpoint. It was accepted before the runtime pinning phase. Any Owner-data import still requires separate explicit authorization; do not import data or start V0.2.

## Final Targeted P1 Fix (Historical; superseded by final audit)

- Owner authorized a limited repair of NEW-P1-02 only: explicit NULL in an applicable debt metadata revision must override the master fixed-payment fallback.
- Repository reads now distinguish an absent applicable revision from a present revision whose fixed monthly payment is NULL. The explicit NULL is preserved through maintenance recovery and model inputs.
- Added repository as-of and master-fallback controls, mixed-debt recovery coverage, and an end-to-end React UI / application-service / SQLite / Model / Home regression.
- `npm run lint`, `npm run typecheck`, `npm test` (171 tests / 10 files), Rust tests (7), `npm run build`, Smoke Tauri dev, Smoke Tauri build, and Production Tauri build passed.
- Production was not launched. Immutable read-only DB verification returned schema 2, integrity `ok`, no foreign-key violations, all 19 application/financial tables empty, and the unchanged baseline SHA-256 `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Status means ready for independent targeted re-audit of NEW-P1-02; it is not self-approval or final audit pass. P2-02 through P2-07 remain open. No Phase 2 or V0.2 work was started.

## Phase 4 Recovery

Historical recovery record; the current audit status and phase above supersede the acceptance-ready status recorded at that time.

- Owner accepted forensic finding `STATE_A` and authorized A1 archive-and-reinitialize recovery.
- The incident database was moved, not deleted, from `/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3` to `artifacts/phase4-db-incident/production-archive-20261003-144142+0800/personal-finance-console.sqlite3`.
- Archive size: 225,280 bytes; SHA-256: `fea96cf138a1cec08be8926573a86c9271a294341aababee44c9f0be177dc9f9`; original mtime preserved at 2026-10-03 13:56:16.
- No production WAL or SHM sidecars existed at archive time. The preserved incident backup, audit report, and cleanup dry-run copies were verified before recovery and left unchanged.
- The packaged Production app created a clean database at its original path. Migrations 1 and 2 are present. All profile, settings, planning-income revision, income, essential-expense, expense, cash, cash-snapshot, asset, asset-snapshot, debt, and debt-fact counts are zero.
- Production `integrity_check` returned `ok`; `foreign_key_check` returned no rows. The built Production app displayed first-run onboarding on launch and after restart; no onboarding data was entered.

## Smoke Isolation and Visual Evidence

- Production identity: `com.personalfinance.console`, `Personal Finance Console`.
- Smoke identity: `com.personalfinance.console.smoke`, `Personal Finance Console Smoke`; its macOS app-data directory is separate from Production.
- Smoke startup rejects the Production app-data directory. Rust tests cover identity/path separation, rejection of a shared path, and the Production-path exception.
- Tauri dev Smoke created its database under `~/Library/Application Support/com.personalfinance.console.smoke/`; the Production database hash remained unchanged during Smoke flows.
- Smoke onboarding, expense entry, financial maintenance, and restart persistence were exercised in the packaged isolated Smoke app. The recaptured checkpoints 05, 07, 08, and 10 are distinct images with distinct hashes. See `PHASE4_OWNER_VISUAL_REVIEW.md`.

## Independent Audit Fix Implementation (Historical)

- Owner authorized correction of the verified 2 P0 and 6 P1 findings; no V0.2 work, Owner data import, or Production data modification is authorized.
- `PF_V01_AUDIT_FIXES_READY_FOR_REAUDIT`: all 2 P0 and 6 P1 findings have regression coverage and passed implementation review. Final acceptance authority remains the independent audit.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 156 tests across 10 files.
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS, 7 Rust tests.
- `npm run build`: PASS.
- `npm run tauri:dev:smoke`: PASS; isolated Smoke Tauri runtime launched, then stopped.
- `npm run tauri:build:smoke`: PASS; Smoke app and DMG generated.
- `npm run tauri:build`: PASS; Production app and DMG generated (build only; app not launched).
- Read-only Production DB check after verification: schema version 2, integrity `ok`, no FK issues, all user/financial table counts 0, SHA-256 unchanged at `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Read-only Smoke DB check after dev launch: schema version 3, integrity `ok`, no FK issues. Synthetic Smoke data only; no Owner data imported.

Remaining P2 follow-ups: incomplete maintenance income rows; investment-capacity semantics; path-alias hardening for Smoke isolation; full Tauri IPC/rollback/schema-version coverage; local-first command/CSP security hardening. Audit P2-01 future Actual Income as-of filtering was corrected with the temporal contract.


## Second Independent Audit P1 Fixes

- Owner authorized only the two P1 findings in `V01_INDEPENDENT_FINAL_REAUDIT.md`: unchanged new-month debt confirmation and user-input money rules incorrectly applied to aggregate/derived money. No V0.2 work or Owner-data import was performed.
- Debt maintenance marks `needsCurrentMonthFact`; unchanged missing-month debts are materialized when saved, while unchanged existing monthly facts are not duplicated. Blank current-month due remains null and previous-month facts remain unchanged.
- Money validation separates `USER_INPUT_MONEY`, `AGGREGATE_MONEY`, and `DERIVED_MONEY`. The original per-entry limit remains; valid aggregate totals above it and finite derived Decimal precision/exponent serialization remain usable.
- Added service, model, product rollover, and actual maintenance UI/database regressions.
- `npm run lint`, `npm run typecheck`, `npm test` (168 tests / 10 files), Rust tests (7), `npm run build`, Smoke Tauri dev, Smoke Tauri build, and Production Tauri build all passed.
- Production was not launched. Its database was read in immutable read-only mode after builds: version 2, integrity `ok`, no foreign-key violations, all application/financial tables empty, SHA-256 unchanged at `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Status means ready for independent targeted re-audit only; it is not self-approval or `PF_V01_FINAL_AUDIT_PASS`.

## Next Action

Continue current-version testing through the existing hierarchy under the approved WP-02 scope; independently review the new identity/path guard and exact A-preflight evidence, then have Acceptance perform the real UI save/history/normal-close/reopen flow only after that review. Keep old data and old Q untouched. Keep UI operation single-owned by Acceptance and fixes single-owned by Execution after independent classification. In parallel maintain NATIVE_MIGRATION_PREPARATION gates, stable/changed requirements and open issues. No native implementation before all six gates and later applicable planning/authority; no automatic Production action or blocker closure.
