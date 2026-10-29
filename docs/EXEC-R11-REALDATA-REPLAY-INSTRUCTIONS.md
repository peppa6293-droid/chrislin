# EXEC-R11 真数重播任务书（交执行者）

发布者：审核员 ｜ 发布日期：2026-10-22 ｜ 执行者：**执行员**（非审核员本人）
性质：把 2026-10-21 户主定案的真实财务基线**重播进生产库**。这是 R8–R10 之后欠的一步——R10 只做了 V3→V8 格式迁移（数据零丢失），没有把真数播回去。
**户主已于 2026-10-22 批准执行**（四项裁决第 3 项）。写生产库授权仅覆盖本任务书 §1 范围。

---

## 0. 背景（为什么有这一步）

2026-10-21 曾把真数直接写进临时升级的 v8 库，当晚该库触发启动门闸、App 打不开，经户主裁决**整体回滚隔离**（`personal-finance-console.sqlite3.v8-quarantined`）。此后 R8→R9→R10 走正规迁移把旧库升到 V8，但播进去的真数随回滚一起离开了生产库，一直没重播。

现状（2026-10-22 只读核查）：
- **债务**：已是真数（2026-11 期事实，合计 157,228.31 / 当月应还 8,851.03）——本任务**不动**。
- **收入 / 现金 / 资产 / 固定支出**：仍是 2026-10-04 首次录入的旧数——本任务把它们更新到 2026-10-21 基线。
- **消费流水**：另一任务（见 §6），本任务**不动**记账相关表。

数据源与基准：隔离库 `~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3.v8-quarantined`（含完整播种行，**只读参考，永不改写**）。

## 1. 目标终态（逐项核对）

口径：全部为 **2026-10-21** 户主定案基线（见项目记忆《户主债务与资产基线》）。

### 1.1 现金账户（`cash_accounts` + `cash_balance_snapshots` + `cash_account_lifecycle_revisions`）

| 账户 | 账户行 | 2026-10-21 快照余额 | include_in_safety | reserved_amount | 状态 |
|------|--------|--------------------|-------------------|-----------------|------|
| 余额宝 | 沿用现有行 `cd4f47d0-…` | **168.57** | 1 | 0.00 | active |
| 农业银行 | 沿用现有行 `3787daaa-…` | **5,097.04** | 1 | **3800.00** | active |
| 上海银行 | 沿用现有行 `c5e4626f-…` | **4.44** | 1 | 0.00 | active |
| 微信零钱 | **新增**（id 沿用隔离库 `seed-wechat-cash-20261021`） | **55.88** | 1 | 0.00 | active |
| 房租专用资金 | 沿用现有行 `a0c23914-…` | 不加新快照 | 0 | 0.00 | **停用**：写 lifecycle 修订 `active=0`，`as_of_date=2026-10-21`（id 沿用隔离库修订号语义即可） |

- 快照写入 `cash_balance_snapshots`，`as_of_date=2026-10-21`；2026-10-04 的旧快照**保留不删**（历史）。
- 农行的 `reserved_amount` 直接改账户行字段为 `3800.00`（房租专款并入农行预留）。

### 1.2 资产（`assets` + `asset_value_snapshots`）

| 资产 | 资产行 | 2026-10-21 快照值 | kind | include_in_safety | 状态 |
|------|--------|------------------|------|-------------------|------|
| 支付宝基金 | 沿用现有行 | **0.00** | LIQUID_INVESTMENT | 1 | active |
| 证券账户 | **新增**（id 沿用隔离库 seed 行） | **20,000.00** | LIQUID_INVESTMENT | 1 | active |
| 短期理财 1/2/3 | 沿用现有行 | 不加新快照 | LIQUID_INVESTMENT | 0 | active，**原样保留** |

### 1.3 收入（`income_entries`，V2 账本）

| id（沿用隔离库） | period_month | occurred_at | amount | label | one_time |
|------------------|--------------|-------------|--------|-------|----------|
| `seed-income-salary-202609` | 2026-09 | 2026-09-30 | **12,791.25** | 工资 | 0 |
| `seed-income-bonus-202609` | 2026-09 | 2026-09-30 | **1,000.00** | 进步奖 | 1 |

V1 `income_records` 的 13,000 计划行**原样保留**（播种时即如此）。

### 1.4 固定支出计划（`fixed_expense_plans`，V2）

| id（沿用隔离库） | name | monthly_amount | effective_from | note | active |
|------------------|------|----------------|----------------|------|--------|
| `seed-plan-rent-202609` | 房租 | 1,900.00 | 2026-09-01 | 季付节奏；另设专款预留 3800.00 | 1 |
| `seed-plan-battery-202609` | 电池租赁 | 728.00 | 2026-09-01 | （空） | 1 |
| `seed-plan-parking-202609` | 停车 | 300.00 | 2026-09-01 | （空） | 1 |
| `seed-plan-diet-202609` | 饮食规划 | 1,500.00 | 2026-09-01 | （空） | 1 |
| `seed-plan-insurance-202609` | 车险+无忧年度预提 | 648.31 | 2026-09-01 | （空） | 1 |

合计 **5,076.31**/月。

### 1.5 精确行 ID 附录（审核员 2026-10-22 补，只读核对所得；写入时直接引用，不要另造 id）

**沿用的生产现有行（勿改 id）**：
- 现金账户：余额宝 `cd4f47d0-f811-4c65-9188-bd51aa6b2d91`／农业银行 `3787daaa-35da-4ccd-a28c-954fda066bfe`／上海银行 `c5e4626f-137d-40c7-bbb5-1cd0c0c11846`／房租专用资金 `a0c23914-394e-444b-b8b9-de95ec931712`
- 资产：支付宝基金 `950288d5-4fd6-456e-a16b-a9245005d7c7`／短期理财 1 `36ae96f9-828d-43ca-b7f8-6736b52d80e1`／短期理财 2 `ea61e164-e064-4e35-8999-b0900881b5d1`／短期理财 3 `ac8b550c-20d4-45d9-8032-872c55d048a9`

**新增行 id（与隔离库一致）**：
- 现金账户行：`seed-wechat-cash-20261021`（微信零钱）
- 资产行：`seed-securities-asset-20261021`（证券账户）
- 收入：`seed-income-salary-202609`、`seed-income-bonus-202609`
- 固定计划：`seed-plan-rent-202609`、`seed-plan-battery-202609`、`seed-plan-parking-202609`、`seed-plan-diet-202609`、`seed-plan-insurance-202609`
- 现金快照 id（隔离库同款）：`seed-snap-yuebao-20261021`（余额宝 168.57）、`seed-snap-abc-20261021`（农行 5097.04）、`seed-snap-bosc-20261021`（上海 4.44）、`seed-snap-wechat-20261021`（微信 55.88）
- 资产快照 id：`seed-snap-fund-20261021`（支付宝基金 0.00）、`seed-snap-sec-20261021`（证券 20000.00）
- lifecycle 修订：`cash_account_lifecycle_revisions` 主键为 INTEGER `revision_id` 自增，新行不指定 id，写 `account_id=a0c23914-394e-444b-b8b9-de95ec931712, as_of_date=2026-10-21, active=0` 即可（隔离库对应行为 revision_id=1）。
- 快照表结构备忘：`cash_balance_snapshots(id, account_id, as_of_date, balance, created_at)`、`asset_value_snapshots(id, asset_id, as_of_date, value, created_at)`，余额/值为 TEXT。
- **写法备忘（照隔离库播种形态，别自创）**：①所有新行 `profile_id` 沿用生产库现有行的 profile_id（先只读查 `profiles` 与现有业务行）；②「房租专用资金」停用只写 lifecycle 修订行（`active=0`），**不要**改 `cash_accounts.active`（隔离库里该行本身仍是 active=1、include_in_safety_resources=0，口径以隔离库为准）；③农行预留直接改 `cash_accounts.reserved_amount='3800.00'`；④支付宝基金 0.00 是**新加一条 2026-10-21 快照**，不是改旧行。

## 2. 回读验收锚点（写完必须逐项对上）

只读 SQL + 应用读路径各核一遍：

1. V2 收支账本：收入 **13,791.25** ／ 经常性收入 **12,791.25** ／ **含一次性收入徽标**。
2. 账户现金 **5,325.93**（= 168.57 + 5,097.04 + 4.44 + 55.88）。
3. 安全资源 **25,325.93** ／ 预留 **3,800.00** ／ 自由现金 **21,525.93**。
4. 固定计划合计 **5,076.31**；2026-11 核心义务 **13,927.34**（= 5,076.31 + 债供 8,851.03）。
5. 债务读数不变：5 笔、2026-11 余额合计 **157,228.31**、当月应还 **8,851.03**。
6. 应用启动正常、无门闸报错（本任务不触碰 terminal/receipt/permit，但要确认写入未触发任何门闸异常）。

## 3. 程序

1. **按 bundle id 退出** App：`tell application id "com.personalfinance.console" to quit`（**禁止 kill**），确认无残留进程。
2. **双备份**当前生产库（主：gate 规范路径 `production-v8-backups/`；副：仓库外 `~/Documents/pfc-r11-replay-backup-20261022/`），记录双方 SHA-256。
3. **只读 preflight**：记录写入前各表计数、库哈希、§2 锚点的现值（预期不符——这正是要修的）。
4. **写入**：限 §1 列出的四组行，单事务；建议直接 SQL（与播种/迁移同模式）。新行 id 与隔离库一致。
5. **回读**：§2 逐项核对；SQL 只读 + 启动 App 界面读数各一遍。
6. **证据**：`evidence/r11-realdata-replay-20261022/`（preflight、备份哈希、写入 SQL 稿、回读日志、界面截图），附 `RECEIPT.md`。

## 4. 红线（违反即作废）

1. **不动债务**及其期事实（已是真数）。
2. **不动记账表**：`expense_records`、`expenses`、`import_batches`、`expense_categories`（消费流水是另一任务，见 §6）。
3. 不动 V1 `income_records`、`essential_expense_items`（播种时即未动）。
4. 不删、不改两份备份、`.v8-quarantined`、terminal/receipt/permit 文件。
5. 不改代码（`src/`、`src-tauri/`）、不重建生产包——候选身份保持冻结。
6. 发现与 §1 清单冲突的现状（如意外多出的行）：**保留现场，停止，先报告**。

## 5. 回执格式

```text
R11_PASS / R11_BLOCKED
写入前库哈希：  写入后库哈希：
备份 SHA-256（主/副）：
§2 锚点逐项对照（6 项，值 + 一致/不一致）：
界面读数截图路径：
异常/偏差：
```

回执交审核员独立复核后，**更新 EXEC-A01 的库哈希锚点**，才可交验收模型。

## 6. 范围外（本任务不做）

- **历史消费流水导入**（支付宝/微信 1,699 条解析稿在 `data/consumption-exports-20261021/`，原始账单在 `~/Desktop/林特/10.21导入账单/`）：导入路径与格式兼容问题待户主裁决后另立任务。
- 任何 V0.2 功能开发（图标、布局、分类映射等）。
