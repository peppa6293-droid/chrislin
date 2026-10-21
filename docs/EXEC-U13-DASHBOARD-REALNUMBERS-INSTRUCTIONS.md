# U-13 执行任务书（build-49）：仪表盘真数与裁决口径落地

发布者：审核员（本会话，审核/验收职责）。执行者：按本任务书实现并自测，完成后提交审核复验。
日期：2026-10-21
代码基线：HEAD `b1a057b`（plan）/ 代码 `4442c39`（build-48 已验收）
测试基线：**403 passed / 0 failed / 80 skipped**（2026-10-21 审核员实测）
口径基线：2026-10-21 户主五项裁决（见审核员记忆 `owner-debt-asset-baseline`、`reconciliation-verdict-20261021`）。
前置事实：2026-11 期债务事实已由审核员写入生产库（合计 8,851.03），本任务书不得改动债务数据。

## 0. 红线（违反即 RETURN）

1. 禁止创建或写入：`spike-01/T2_REPORT.md`、`evidence/T2_FLOW_EVIDENCE.md`、`T2_TEST_RESULTS.md`、`evidence/T2_SHA256.txt`（他会话所有权）。
2. 禁止向生产库（`$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`）写任何真实户主数据；真实数据播种由审核员负责。执行者只用内存/临时库自测，且不得以 production 身份启动 app。
3. 不得改动 V2→V1 镜像规则：`CASH_DEBIT` 经 `createV2ExpenseWithLegacyMirror` 双写；`CREDIT_*` 不镜像（既有测试锁定）。
4. 不得改动 `src-tauri/` 源码；不得新增依赖、不得发起网络请求；schema 变更仅限本任务书第 2 节规定的 v8。
5. 提交前 preflight（必须带 `env NODE_ENV=test`）：

```bash
env NODE_ENV=test npx vitest run --reporter=dot
npm run typecheck
npm run lint
```

6. 禁止 `git add -A`；按显式路径提交；不得提交未跟踪的截图/临时文件以外的产物。

## 1. 已核实基线（不要重复探索，直接按此实现）

- 当前 `CURRENT_SCHEMA_VERSION = 7`（`src/persistence/migrations.ts:3`）；生产库目前停在 v3，app 首次启动会沿 4→8 自动迁移。执行者测试必须覆盖 **v7→v8** 与**全新库→v8**。
- `src/application/v2-expense-service.ts:306-320` 的 `getDashboardProps` 仍返回字面量 `income: "0.00"`、`accountCash: "0.00"`。
- 最新余额/资产查询已存在，直接复用，禁止另写一套：
  - `Repositories.cashAccountsAt(asOfDate)`（`src/persistence/repositories.ts:1002`）：按账户取 `as_of_date <= 截止日` 的最新快照，含 `include_in_safety_resources`；无快照会抛 `MISSING_CASH_SNAPSHOT`。
  - `Repositories.assetsAt(asOfDate)`（`src/persistence/repositories.ts:1089`）：同口径取资产最新估值。
- **投资资产的真实模型是 `assets.kind = 'LIQUID_INVESTMENT'`**；`cash_accounts` 表和 `accounts` 表都没有 `type=INVESTMENT`。原文中“投资类账户（type=INVESTMENT）”一律按本条更正。
- 旧断言位置：`tests/v2-ledger/v2-expense-service.test.ts:238-253`（整个 `toEqual` 需扩展）；仪表盘 UI 测试在 `tests/v2-ui/dashboard.test.tsx`，其中 5 处 `ledger: { income, dailyExpense, accountCash }` 需补新字段。
- `tests/v4-foundation.test.ts:70` 断言 `CURRENT_SCHEMA_VERSION === 7`，本批必须改为 8。
- 生产库 2026-11 债供已核验为 **8,851.03**；2026-10 为 14,518.73。执行者不得写入、不得“修正”。

## 2. U-13-A 仪表盘收入/现金去硬编码（必改项）

### A1. 迁移 v8（一次加齐，禁止拆成多个版本）

在 `src/persistence/migrations.ts` 中：

1. `CURRENT_SCHEMA_VERSION` 改为 `8`。
2. 在 `migrationV7` 之后新增 `migrationV8`，内容如下（SQLite 方言，按现有 `split(";")` 机制逐条执行）：

```sql
CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  period_month TEXT NOT NULL CHECK (
    length(period_month)=7 AND substr(period_month,5,1)='-'
    AND substr(period_month,6,2) BETWEEN '01' AND '12'
    AND substr(period_month,1,4) NOT GLOB '*[^0-9]*'
  ),
  occurred_at TEXT NOT NULL,
  amount TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(profile_id, occurred_at, label, amount)
);
CREATE INDEX IF NOT EXISTS income_entries_profile_month
  ON income_entries(profile_id, period_month);

ALTER TABLE cash_accounts ADD COLUMN reserved_amount TEXT NOT NULL DEFAULT '0.00';

CREATE TABLE IF NOT EXISTS fixed_expense_plans (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  monthly_amount TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fixed_expense_plans_profile_lookup
  ON fixed_expense_plans(profile_id, active, effective_from);

PRAGMA user_version = 8;
```

3. 在 `migrateDatabase` 的 apply 链中加入 `if (applied < 8 && targetVersion >= 8)` 事务块，执行 `migrationV8` 并写入 `INSERT INTO schema_migrations(version, applied_at) VALUES(8, ?)`。其它版本块不得改动。

注意：`income_entries` 是 V2 新增表，**不得**复用或改写 V1 的 `income_records`；两张表互不镜像。

### A2. Repositories

新增/扩展（金额出入一律过 `assertUserInputMoney` / `requireStoredUserInputMoney`）：

- `createIncomeEntry(input: { id, profileId, periodMonth, occurredAt, amount, label, oneTime }, createdAt?)`
- `listIncomeEntries(profileId, periodMonth): Promise<IncomeEntryRecord[]>`
- `setCashAccountReservedAmount(accountId, profileId, amount)`：只允许更新本 profile 的账户；金额两位小数、非负。
- `CashAccountRecord` 增加 `reservedAmount: string`；`cashAccountsAt` 的 SELECT 增加 `a.reserved_amount`（v8 之前的库不会调用该字段，迁移保证列存在）。
- 新增的聚合查询必须按 `profileId` 过滤。`cashAccountsAt` / `assetsAt` 可增加**可选** `profileId` 参数（不传时保持既有行为），避免跨 profile 汇总；不得破坏现有 V1 调用。

### A3. Service

1. 新增命令 `recordIncomeEntry(draft)`：
   - `periodMonth` 匹配 `MONTH_PATTERN`；`occurredAt` 匹配 `DATE_PATTERN`；`amount` 用 `assertUserInputMoney` 且必须 > 0；`oneTime` 布尔；`label` 去空白后允许空串。
   - 写入后回读校验，失败抛 `ApplicationDataError`（沿用本文件既有模式）。
2. `getDashboardProps(profileId, month)` 改为：

```ts
const monthEnd = lastDayOfMonth(month); // "2026-10-31"
const entries = await this.repositories.listIncomeEntries(profileId, month);
const income = entries.reduce((sum, e) => sum.plus(money(e.amount)), zeroMoney());
const recurringIncome = entries
  .filter((e) => !e.oneTime)
  .reduce((sum, e) => sum.plus(money(e.amount)), zeroMoney());
const cash = await this.repositories.cashAccountsAt(monthEnd, profileId);
const accountCash = cash.reduce((sum, a) => sum.plus(money(a.balance)), zeroMoney());

return {
  ledger: {
    income: moneyString(income.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
    dailyExpense: summary.dailyExpenseTotal,
    accountCash: moneyString(accountCash.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
    recurringIncome: moneyString(recurringIncome.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
    incomeIncludesOneTime: entries.some((e) => e.oneTime),
  },
  ...
};
```

   - 无数据时必须返回聚合结果 `"0.00"`，不得回退字面量。
   - `accountCash` 包含所有 active 现金账户（含预留房租），**不包含** `assets` 中的证券/投资资产。
3. 新增 `getSafetySnapshot(profileId, asOfDate)`（供 U-13-B/验收使用）：

```ts
const cash = await this.repositories.cashAccountsAt(asOfDate, profileId);
const assets = await this.repositories.assetsAt(asOfDate, profileId);
const eligibleCash = cash.filter((a) => a.includeInSafetyResources);
const eligibleAssets = assets.filter(
  (a) => a.kind === "LIQUID_INVESTMENT" && a.includeInSafetyResources,
);
const safetyResources = sum(eligibleCash.balance) + sum(eligibleAssets.currentValue);
const reserved = sum(cash.reservedAmount); // active 账户，含 include_in_safety_resources=0 的预留账户
const freeCash = safetyResources.minus(reserved); // 不 clamp，负值原样返回
```

   返回 `{ safetyResources, reserved, freeCash }`，均为两位小数字符串，`ROUND_HALF_UP`。
4. 不得吞掉 `MISSING_CASH_SNAPSHOT` / `MISSING_ASSET_SNAPSHOT`；缺快照是数据完整性问题，保持既有抛错语义。

### A4. UI

`src/ui/v2-dashboard.tsx`：

- `DashboardLedgerSummary` 增加必填字段：`recurringIncome: string`、`incomeIncludesOneTime: boolean`。
- 收入卡片金额下方，当 `incomeIncludesOneTime === true` 时渲染标签，文本必须精确为 **含一次性收入**：

```tsx
<span className="v2-dashboard__label" data-testid="income-one-time-badge">
  含一次性收入
</span>
```

- 不新增图标，不改底部导航；金额格式化与 U-12 截断规则继承，不得回退。

### A5. 测试

- 更新 `tests/v2-ledger/v2-expense-service.test.ts:238-253` 的旧断言（补 `recurringIncome`、`incomeIncludesOneTime`）。
- 更新 `tests/v2-ui/dashboard.test.tsx` 中全部 `ledger` fixture（5 处），并新增标签断言：
  - `incomeIncludesOneTime: true` → 文本“含一次性收入”出现；
  - `false` → 不出现。
- 新增用例（放在既有 V2 service 测试文件内，不新建大文件）：
  1. 收入按月聚合：同月两笔 + 邻月一笔，只汇总当月；`one_time` 含/不含两个口径正确。
  2. `accountCash` 取每账户最新快照：同账户 `as_of_date` 写两笔，只取较新；不同账户相加。
  3. `reserved` 扣减：`reserved_amount` 两笔求和，`freeCash = safetyResources - reserved`。
  4. `LIQUID_INVESTMENT` 资产不进 `accountCash`、进 `safetyResources`；`include_in_safety_resources=0` 的资产不进。
  5. 迁移：全新库到 v8；v7 库升 v8 后 `income_entries`、`reserved_amount`、`fixed_expense_plans` 可读写。
- 更新 `tests/v4-foundation.test.ts:70` 为 8。
- 测试总数只增不减；回执写“旧值→新值”（基线 403 passed / 80 skipped）。

## 3. U-13-B 固定支出计划口径（预算侧）

1. 使用 A1 的 `fixed_expense_plans` 表，新增 Repositories CRUD：
   - `createFixedExpensePlan(input, createdAt?)`
   - `listFixedExpensePlans(profileId, effectiveFrom?)`（只返回 `active=1` 且 `effective_from <= effectiveFrom` 的行）
   - `updateFixedExpensePlan(profileId, id, patch)`（金额/名称/生效月/备注；金额过 `assertUserInputMoney`）
   - `deactivateFixedExpensePlan(profileId, id)`（软删除，置 `active=0`）
2. **种子值由审核员播种，执行者只交机制，不得写死任何户主金额。** 验收时审核员会播种：房租 1900.00（备注：季付节奏；另设专款预留 3800.00，不自动推导 5700）／电池租赁 728.00／停车 300.00／饮食规划 1500.00／车险+无忧年度预提 648.31；合计 5076.31。
3. 水电：**不得**建固定预算项，也不得在代码里出现 500 元水电硬编码。审核员已检索确认当前无此硬编码；执行者若发现新增，移除并说明。
4. 新增 `getMonthlyCoreObligations(profileId, month)`：
   - `Σ active fixed_expense_plans.monthly_amount（effective_from <= 月末）`
   - `+ Σ debtsAt(month, 月末).currentMonthDue`（`currentMonthDue` 缺省按 0；已知 2026-11 合计 8,851.03）。
   - 两者不得重复计入同一笔；返回两位小数字符串。

## 4. U-13-C 一次性收入口径

- `one_time=1`（如进步奖）计入当月实发收入 `income`，但排除于经常性收入 `recurringIncome`。
- 仪表盘标签按 A4 执行。
- 审核员播种后复验锚点：2026-09 `income = 13791.25`、`recurringIncome = 12791.25`、`incomeIncludesOneTime = true`。

## 5. U-13-D 打包与证据

1. 重打包（smoke 身份，不得使用 production 身份）：

```bash
npm run build
npm run tauri:build:smoke
```

   产物路径：
   - `src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg`
   - `src-tauri/target/release/bundle/macos/小钱家.app`

2. 证据目录 `evidence/u13-realnumbers-20261021/`，至少包含：
   - `preflight-test.log`、`preflight-typecheck.log`、`preflight-lint.log`
   - `build-smoke.log`（含 DMG 产物路径）
   - `dashboard-income-cash.png`（临时库种子：2026-09 income 13791.25、recurring 12791.25、accountCash 5325.93、标签可见）
   - `RECEIPT.md`（改动文件、测试数量旧→新、迁移验证方式、DMG 路径、SHA256）
3. 提交信息：`build-49: U-13 — dashboard real numbers, reserved cash, one-time income flag`

## 6. 验收锚点（审核员播种真实数据后逐项复验）

| 锚点 | 期望值 | 复验方式 |
|---|---|---|
| 2026-09 实发收入 | 13,791.25 | `getDashboardProps` / 仪表盘 |
| 2026-09 经常收入 | 12,791.25 | `recurringIncome` |
| 一次性标签 | 可见 | 仪表盘截图 + UI 测试 |
| 账户现金 | 5,325.93（农行 5,097.04 + 上海 4.44 + 余额宝 168.57 + 微信 55.88） | `accountCash` |
| 安全资源 | 25,325.93（含证券 20,000） | `getSafetySnapshot` |
| 自由活钱 | 21,525.93（安全资源 − 房租预留 3,800） | `getSafetySnapshot` |
| 固定计划合计 | 5,076.31 | `Σ fixed_expense_plans` |
| 2026-11 债供 | 8,851.03（既有，不得变动） | 生产库只读复核 |
| 生产库 | 执行者零写入 | 审核员比对 |

播种说明（审核员执行，不属执行者任务）：现有生产库的 `房租专用资金` 账户（3,800、`include_in_safety_resources=0`）会并入农业银行，并在农业银行上置 `reserved_amount = 3800.00`，避免 3,800 在 `accountCash` 与 `reserved` 中重复计算；证券 20,000 走 `assets.kind='LIQUID_INVESTMENT'`。

## 7. 提交格式

按 U-13-A/B/C/D 逐项回复完成状态、测试数量变化（旧值→新值）、证据目录路径、DMG 路径与 SHA256；审核员复验通过方可合并与交付验收模型。
