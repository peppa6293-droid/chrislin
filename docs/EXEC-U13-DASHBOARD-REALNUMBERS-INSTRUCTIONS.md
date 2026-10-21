# U-13 执行任务书（build-49）：仪表盘真数与裁决口径落地

发布者：审核员（本会话，审核/验收职责）。执行者：按本任务书实现并自测，完成后提交审核复验。
口径基线：2026-10-21 户主五项裁决（见审核员记忆 owner-debt-asset-baseline、reconciliation-verdict-20261021）。
前置事实：2026-11 期债务事实已由审核员写入生产库（合计 8,851.03），本任务书不得改动债务数据。

## 0. 红线

- 禁止创建或写入：spike-01/T2_REPORT.md、evidence/T2_FLOW_EVIDENCE.md、T2_TEST_RESULTS.md、evidence/T2_SHA256.txt（他会话所有权）。
- 禁止向生产库（$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3）写任何真实户主数据；真实数据播种由审核员负责。执行者只用内存/临时库自测。
- 不得改动 V2→V1 镜像规则：CASH_DEBIT 经 createV2ExpenseWithLegacyMirror 双写；CREDIT_* 不镜像（既有测试锁定）。
- 提交前 preflight：`npm run lint`、`npm run typecheck`、`npm test` 全绿。

## U-13-A 仪表盘收入/现金去硬编码（必改项）

现状：src/application/v2-expense-service.ts:306-320 `getDashboardProps` 返回字面量 `income: "0.00"`、`accountCash: "0.00"`。

1. 新增迁移：`income_entries(id TEXT PK, profile_id TEXT NOT NULL, period_month TEXT NOT NULL, occurred_at TEXT NOT NULL, amount TEXT NOT NULL, label TEXT, one_time INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(profile_id, occurred_at, label, amount))`；按 src/persistence/migrations.ts 既有版本递增进位。
2. Repositories 新增 `createIncomeEntry` / `listIncomeEntries(profileId, month)`；金额校验复用 requireStoredUserInputMoney 同级别断言（两位小数、非负）。
3. Service 新增 `recordIncomeEntry` 命令；`getDashboardProps.income` = 当月 income_entries 合计（Decimal 求和，ROUND_HALF_UP 两位）。无数据时返回 "0.00"，但必须来自聚合查询，禁止字面量。
4. `getDashboardProps.accountCash` = 现金类账户"每账户最新一笔 cash_balance_snapshots 余额"之和。最新余额查询已存在（src/persistence/repositories.ts:987-1009，saveCashBalanceSnapshot 与 latest 查询），复用不得另写一套。投资类账户（type=INVESTMENT）不计入 accountCash，但计入安全资源（include_in_safety_resources=1）。
5. 现金账户新增 `reserved_amount TEXT NOT NULL DEFAULT '0.00'`（放 cash_accounts 或 revisions 表由执行者定，但必须与快照口径一致、可回读）；安全目标"自由流动" = Σ安全资源 − Σreserved。
6. UI（src/ui/v2-dashboard.tsx）：当月 income 含 one_time=1 条目时显示标签"含一次性收入"；金额格式化与截断规则继承 U-12，不得回退。
7. 测试：更新 tests/v2-ledger/v2-expense-service.test.ts:243 的旧断言；新增用例：
   - 收入按月聚合，one_time 含/不含两个口径；
   - accountCash 取每账户最新快照（同账户写两个 as_of_date，只取较新）；
   - reserved 扣减后自由流动正确；
   - INVESTMENT 账户不进 accountCash、进安全资源。

## U-13-B 固定支出计划口径（预算侧）

1. 固定支出计划项：若已有可复用实体则复用，否则新建 `fixed_expense_plan(id, profile_id, name, monthly_amount, effective_from, note)` 及 CRUD API。种子值由审核员播种，执行者只交机制：
   房租 1900.00（note：季付节奏；户主口径另设专款预留 3800.00，不自动推导 5700）／电池租赁 728.00／停车 300.00／饮食规划 1500.00／车险+无忧年度预提 648.31；合计 5076.31。
2. 水电：不得设固定预算项（户主裁决：实缴口径，发生即记账）。代码中如有 500 硬编码预算，移除。
3. 安全目标月必要支出 = Σ固定计划 + 当月债供（debt_period_facts.current_month_due，既有机制）；两者不得重复计入同一笔。

## U-13-C 一次性收入口径

one_time=1（如进步奖）计入当月实发收入，但排除于"经常性收入"基准；提供 `recurring` 聚合 = SUM(amount) WHERE one_time=0。
锚点（审核员播种后复验）：2026-09 实发 13791.25、经常口径 12791.25。

## U-13-D 打包与证据

1. 重打包：`npm run build` 后走与 build-46/48 相同通道出 DMG（smoke 配置亦可），产物必须包含本次修复。
2. 证据目录 evidence/u13-realnumbers-20261021/：preflight 三项日志、build 日志、临时库演示种子（收入 13791.25、accountCash 5325.93）下的仪表盘截图、RECEIPT.md。
3. 提交信息格式：`build-49: U-13 — dashboard real numbers, reserved cash, one-time income flag`。

## 验收锚点（审核员播种真实数据后逐项复验）

- 2026-09 income = 13791.25（含一次性 1000）；recurring = 12791.25。
- accountCash = 5325.93（农行 5097.04 + 上海 4.44 + 余额宝 168.57 + 微信 55.88）。
- 安全资源 = 25325.93（含证券 20000）；自由流动 = 21525.93（扣 reserved 3800）。
- 固定计划合计 = 5076.31；2026-11 债供 8851.03（既有，不得变动）。

## 提交格式

按 U-13-A/B/C/D 逐项回复完成状态、测试数量变化（旧值→新值）、证据目录路径；审核员复验通过方可合并与重打包交付验收模型。