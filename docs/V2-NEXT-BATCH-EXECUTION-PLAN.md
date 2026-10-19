# V2 下一批次执行方案（build-22 之后）

**状态：** READY_FOR_EXECUTION
**前置依赖：** build-22 已提交且审核通过
**日期：** 2026-10-19

---

## 一、批次目标

从 V2 隔离基础推进到**第一笔真实记账能力链**：

```
Schema V6（expenses + import_batches 表）
  → V2 记账应用服务（repositories + model 接线）
    → 官方 CSV 导入解析与预览（11 步流程前 7 步）
```

**不改变：** Financial Model V1.0 冻结、Production App/DB 不触碰、V2 模块仍通过隔离入口验证。

---

## 二、任务拆分

### EXEC-P-01：Schema V6 — expenses 与 import_batches 表

**产出文件：**
- 修改 `src/persistence/migrations.ts`：`CURRENT_SCHEMA_VERSION` 5→6，新增 `migrationV6`
- 修改 `src/persistence/repositories.ts`：新增 expense 与 import batch 仓储方法
- 修改 4 个已有测试的 schema 断言（5→6）
- 新增 `tests/v2-ledger/expense-persistence.test.ts`

**expenses 表设计（必须与 `src/model/v2-expense.ts` 类型对齐）：**

```sql
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('CASH_DEBIT','CREDIT_ONE_TIME','CREDIT_INSTALLMENT')),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_card_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  total_amount TEXT,
  periods INTEGER,
  fee TEXT,
  first_installment_month TEXT,
  installment_amount TEXT,
  import_batch_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_profile_month_lookup ON expenses(profile_id, occurred_on);
CREATE INDEX IF NOT EXISTS expenses_category_lookup ON expenses(category_id);
CREATE INDEX IF NOT EXISTS expenses_import_lookup ON expenses(import_batch_id);
```

**约束：**
- `CASH_DEBIT` 必须有 `account_id`；`CREDIT_ONE_TIME` / `CREDIT_INSTALLMENT` 必须有 `credit_card_id`。此约束在 repository 层校验（不用 CHECK 跨列），违规抛 `ApplicationDataError("INVALID_EXPENSE_ACCOUNT")`。
- `CREDIT_INSTALLMENT` 必须填写 `total_amount`、`periods`、`installment_amount`、`first_installment_month`；`fee` 可为 `"0.00"` 但不可为 null。
- 分期还款明细（`repaymentSchedule`）不单独建表，由服务层根据 `v2-expense.ts` 的 `buildInstallmentSchedule` 纯函数实时计算。

**import_batches 表设计（与 `docs/WP-IMPORT-ARCHITECTURE.md` 数据契约对齐）：**

```sql
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('ALIPAY_CSV','WECHAT_CSV','FUTURE_PROVIDER')),
  source_file_sha256 TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  valid_rows INTEGER NOT NULL,
  written_rows INTEGER NOT NULL,
  skipped_rows INTEGER NOT NULL,
  error_rows INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

**仓储方法（Repositories 类）：**

```
createExpense / getExpenseById / listExpenses(profileId, month?) / deleteExpense
createImportBatch / getImportBatchById / listImportBatches(profileId)
```

**验收标准：**
- [ ] `migrateDatabase` 从 V0 全新库迁移到 V6 通过，`schema_migrations` 含 1–6
- [ ] `migrateDatabase` 从 V5 库迁移到 V6 通过（增量路径）
- [ ] future-schema-guard 测试更新为拒绝 version 7
- [ ] expense CRUD 测试覆盖三种 kind、缺失账户校验、月份过滤
- [ ] 全量测试 0 failed

---

### EXEC-L-07：V2 记账应用服务

**产出文件：**
- 新增 `src/application/v2-expense-service.ts`
- 新增 `tests/v2-ledger/v2-expense-service.test.ts`

**职责：**

将 build-22 已就绪的模型层与 P-01 的仓储层连接为可被 UI 调用的应用服务：

1. `recordCashDebitExpense(draft)` — 校验金额/日期/分类 → 调用 `v2-reconciliation.ts` 的 `reconcileCashExpense` 确认口径 → 写入 → 回读验证
2. `recordCreditExpense(draft)` — 同上，区分一次性与分期；分期时校验 `buildInstallmentSchedule` 输出各期金额之和等于 `totalAmount`
3. `recordCreditCardPayment(paymentDraft)` — 调用 `reconcileCreditCardPayment`，确认还款不重复计入日常支出
4. `getMonthSummary(profileId, month)` — 聚合当月支出（仅 `countsAsDailyExpense: true` 的记录）、待还账单压力（委托 `v2-cashflow.ts` 的 `calculateBillStatus`）
5. `getDashboardProps(profileId, month)` — 组装 `v2-dashboard.tsx` 所需的全部 props，替代当前 mock props

**接线边界：**
- 服务构造函数接收 `Repositories` 实例（依赖注入，与 `product-service.ts` 模式一致）
- 不直接导入 UI 组件；UI 通过 props 接收服务输出
- `v2-dashboard.tsx` 本批次**不修改**；接线到真实渲染留给 U 系列任务
- 所有金额计算走 `decimal.js`，禁止浮点运算

**验收标准：**
- [ ] 现金支出记录后，回读金额、日期、分类与输入一致
- [ ] 信用卡还款后，`getMonthSummary` 的日常支出不包含还款金额
- [ ] 分期消费各期金额之和校验通过，不等时抛出明确错误
- [ ] `getDashboardProps` 输出类型与 `v2-dashboard.tsx` 的 props 接口完全匹配（类型检查通过）
- [ ] 零金额、超大金额、非法日期均有测试
- [ ] 不修改 `src/model/v2-*.ts` 任何文件（只读引用）

---

### EXEC-I-03：官方 CSV 导入 — 解析、预览与去重（11 步流程步骤 1–7）

**产出文件：**
- 新增 `src/model/v2-import.ts`（解析与去重纯函数）
- 新增 `tests/v2-ledger/import-parse.test.ts`
- 使用已有 `tests/fixtures/v2-import/sample-alipay-export.csv` 和 `sample-wechat-export.csv`

**实现范围（对应 11 步流程）：**

| 步骤 | 实现 |
|---|---|
| 1 授权 | 函数接收文件内容字符串（文件选择由 UI/Tauri 层后续处理） |
| 2 获取 | `parseImportFile(content, provider)` 返回结构化候选 |
| 3 解析 | 识别支付宝/微信 CSV 表头、金额（带 ¥ 或纯数字）、日期（含时区） |
| 4 预览 | 返回 `ImportedExpenseCandidate[]` 供 UI 展示（本批次不含 UI） |
| 5 去重 | `dedupeImportCandidates(candidates, existingKeys)` — 基于 `provider + sourceRowKey + amount + businessDate` 的哈希 |
| 6 用户修改 | 纯函数 `applyCandidateEdits(candidate, edits)` 返回新对象 |
| 7 确认 | 纯函数 `confirmImportBatch(candidates)` 返回 CONFIRMED / SKIPPED 分组 |

**不做（留给 EXEC-I-04）：**
- 步骤 8 写入（需要 P-01 的 `import_batch_id` 关联，本批次只到确认）
- 步骤 9–11 回读、校验、反馈

**验收标准：**
- [ ] 支付宝样例 CSV 解析出 2 条支出候选，金额 `"35.00"` / `"12.50"` 精确匹配
- [ ] 微信样例 CSV 解析出正确条数与金额
- [ ] 收入行（收支=收入）标记为 `direction: "INCOME"`，不进入支出候选
- [ ] 重复导入同一文件，第二次全部命中去重
- [ ] 编辑候选后原对象不变（不可变）
- [ ] 未知列、空行、乱码行产生 `validationErrors` 而非崩溃
- [ ] 金额使用 `decimal.js`，无浮点误差

---

### EXEC-I-04：官方 CSV 导入 — 写入、回读与反馈（11 步流程步骤 8–11）

**前置：** EXEC-P-01 和 EXEC-I-03 均已完成
**产出文件：**
- 新增 `src/application/v2-import-service.ts`
- 新增 `tests/v2-ledger/import-write.test.ts`

**实现范围：**

| 步骤 | 实现 |
|---|---|
| 8 写入 | 事务内写入确认的候选为 expenses 行，关联 `import_batch_id` |
| 9 回读 | 逐条回读写入结果 |
| 10 校验 | 比对金额、日期、数量与确认时一致 |
| 11 反馈 | 返回 `ImportBatchResult`（含 auditEvents 列表） |

**验收标准：**
- [ ] 写入失败时事务回滚，无部分写入
- [ ] 回读金额与确认时逐条一致
- [ ] 部分成功场景（部分行写入、部分跳过）正确报告各计数
- [ ] `ImportBatchResult` 持久化到 `import_batches` 表
- [ ] 不连接任何网络、不上传文件

---

## 三、批次边界（全批次共同约束）

- **不触碰** Production App、Production DB、已安装的 V0.1 运行时
- **不修改** `src/model/v2-cashflow.ts`、`v2-savings-goal.ts`、`v2-trends.ts`、`v2-quick-entry.ts`（只读引用）
- **不修改** Financial Model V1.0 相关代码（`src/model/money.ts`、`financial-model.ts` 等）
- **不注册** 真实全局快捷键、不访问真实 Tauri 窗口
- **不实现** PDF 解析、API 直连、平台登录
- 所有新测试在 `NODE_ENV=test` 下通过
- 每个任务完成后提交独立回执，由审核员验收后方可进入下一任务

## 四、执行顺序

```
EXEC-P-01 → EXEC-L-07 → EXEC-I-03 → EXEC-I-04
   （P-01 是 L-07 和 I-04 的前置；I-03 与 L-07 可并行）
```

## 五、风险与注意事项

| 风险 | 缓解 |
|---|---|
| Schema V6 迁移破坏 V5 库 | 增量迁移测试覆盖 0→6 和 5→6 两条路径 |
| expense 表 nullable 列过多导致查询复杂 | repository 层封装映射，UI 层只见类型化对象 |
| CSV 格式随平台更新变化 | 解析函数按 provider 隔离，未知格式返回明确错误而非猜测 |
| 分期金额精度 | 全部走 `decimal.js`，`buildInstallmentSchedule` 已有测试覆盖尾差分配 |

</content>