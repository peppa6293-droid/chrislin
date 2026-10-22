# R9-04 迁移后对账规格（仅规格，未执行真实迁移）

状态：**SPEC_ONLY**。本文件不表示生产已迁移、已恢复或可启动。
所有 SQL 已在合成 V8 库上验证语法、表名、列名与判定语义（见
`41-synthetic-sql-verification.log`，`RESULT=PASS`）。真实数值比对必须在
审核员另行批准的 R8 迁移执行后，用本文件对真实 V8 库执行。

执行前提：迁移流程已完成，数据库 `user_version=8`，且无进程持有该库。
下文 `P="$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3"`。

金额列均为 TEXT，聚合一律 `cast(... as real)`。

---

## C1 债务 ID 不丢失、不重复

```bash
sqlite3 "$P" "SELECT count(*) AS debt_rows, count(DISTINCT id) AS distinct_ids FROM debts;"
sqlite3 "$P" "SELECT id, name FROM debts ORDER BY id;"
```

期望：5 / 5；ID 集合精确等于（顺序不限）：

| debt_id | name |
|---|---|
| `5f50bd18-7b79-49aa-a0da-fa8a19555a69` | 浦发车贷 |
| `6ab6256a-fe7b-450b-9853-f55c8402f92b` | 招商分期 |
| `a1ff0b1a-2a5f-4980-a058-9af7bf79249b` | 京东白条 |
| `c7fa0eae-c78a-4d0d-8031-bbf80c523d23` | 花呗 |
| `2a6a027d-806d-44f8-92e0-131f78c6d14b` | 美团月付 |

判定：任一 ID 缺失、重复、或出现额外债务 → 失败。

---

## C2 债务月度合计

```bash
sqlite3 "$P" "SELECT period_month,
       round(sum(cast(current_balance as real)),2) AS total_balance,
       round(sum(cast(coalesce(current_month_due,'0') as real)),2) AS total_due,
       count(*) AS debt_count
FROM debt_period_facts
WHERE period_month IN ('2026-10','2026-11')
GROUP BY period_month ORDER BY 1;"
```

期望：

| period_month | total_balance | total_due | debt_count |
|---|---|---|---|
| 2026-10 | 172579.53 | 14518.73 | 5 |
| 2026-11 | 157228.31 | 8851.03 | 5 |

逐笔核对（仍在债务 ID 允许范围内）：

```bash
sqlite3 "$P" "SELECT f.period_month, f.debt_id, d.name,
       cast(f.current_balance as real) AS current_balance,
       cast(coalesce(f.current_month_due,'0') as real) AS current_month_due
FROM debt_period_facts f JOIN debts d ON d.id=f.debt_id
WHERE f.period_month IN ('2026-10','2026-11')
ORDER BY f.period_month, d.name;"
```

期望输出 10 行（两期各 5 笔），无缺失、无重复 `(debt_id, period_month)`。

---

## C3 逐表行数迁移前后一致

### C3-1 固定期望（迁移后）

```bash
sqlite3 "$P" "select 'debts',count(*) from debts
union all select 'profiles',count(*) from profiles
union all select 'assets',count(*) from assets
union all select 'cash_accounts',count(*) from cash_accounts
union all select 'income_records',count(*) from income_records
union all select 'expense_records',count(*) from expense_records
union all select 'debt_period_facts',count(*) from debt_period_facts
union all select 'debt_revisions',count(*) from debt_revisions;"
```

期望：`debts 5`、`profiles 1`、`assets 4`、`cash_accounts 4`、
`income_records 1`、`expense_records 1`、`debt_period_facts 10`、`debt_revisions 0`。

### C3-2 其余 V3 既有表（迁移前后必须相等）

在迁移开始前、以及迁移完成后，各执行一次下列查询并保存为
`pre-counts.txt` / `post-counts.txt`，`diff` 必须为空：

```bash
sqlite3 "$P" "select 'app_metadata',count(*) from app_metadata
union all select 'asset_revisions',count(*) from asset_revisions
union all select 'asset_value_snapshots',count(*) from asset_value_snapshots
union all select 'cash_account_revisions',count(*) from cash_account_revisions
union all select 'cash_balance_snapshots',count(*) from cash_balance_snapshots
union all select 'essential_expense_items',count(*) from essential_expense_items
union all select 'essential_expense_revisions',count(*) from essential_expense_revisions
union all select 'essential_expense_snapshots',count(*) from essential_expense_snapshots
union all select 'financial_settings',count(*) from financial_settings
union all select 'planning_income_revisions',count(*) from planning_income_revisions
union all select 'schema_migrations',count(*) from schema_migrations
union all select 'settings_revisions',count(*) from settings_revisions
order by 1;"
```

说明：`schema_migrations` 由 3 行变为 8 行是唯一允许的变化，比较时应排除，
或单独按 C4 判定。

### C3-3 V4–V8 新增表（不参与相等性）

真实 V3 中不存在、由 V3→V8 迁移以 DDL 新建、无播种数据：
`planning_income_month_revisions`、`actual_income_revisions`（004）；
`accounts`、`expense_categories`（005）；`expenses`、`import_batches`（006/007）；
`income_entries`、`fixed_expense_plans`（008）。
仅确认存在且 `count(*) = 0`（迁移不播种）：

```bash
sqlite3 "$P" "select 'accounts',count(*) from accounts
union all select 'expense_categories',count(*) from expense_categories
union all select 'expenses',count(*) from expenses
union all select 'import_batches',count(*) from import_batches
union all select 'income_entries',count(*) from income_entries
union all select 'fixed_expense_plans',count(*) from fixed_expense_plans
union all select 'planning_income_month_revisions',count(*) from planning_income_month_revisions
union all select 'actual_income_revisions',count(*) from actual_income_revisions;"
```

期望：全部为 0。

---

## C4 V8 结构与静默状态

```bash
sqlite3 "$P" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check;"
sqlite3 "$P" "SELECT version FROM schema_migrations ORDER BY 1;"
ls -la "$HOME/Library/Application Support/com.personalfinance.console"
```

期望：
- `user_version` = 8
- `integrity_check` = `ok`
- `foreign_key_check` 无输出
- `schema_migrations` 恰为 1,2,3,4,5,6,7,8
- 目录内无 `*-wal`、`*-shm`、`*-journal`；无残留 permit/terminal/ledger
  （真实迁移由审核员单独的授权流程管理，本规格不创建、不消费）

---

## C5 V2/V1 双账本同步（按已核实源码）

唯一实际实现的同步是 **CASH_DEBIT 单向双写**：
`src/persistence/repositories.ts:1807`（单笔）与 `:1948`（CSV 导入，同一事务）。
信用卡支出按设计不镜像。以下 SQL 返回 0 行即一致。

```sql
-- C5-1 每笔 V2 现金支出必须有字段一致的 V1 镜像（期望 0 行）
SELECT e.id
FROM expenses e
LEFT JOIN expense_records r ON r.id = e.id
WHERE e.kind = 'CASH_DEBIT'
  AND (r.id IS NULL
    OR cast(r.amount as real) <> cast(e.amount as real)
    OR r.occurred_at <> e.occurred_on || 'T00:00:00.000Z'
    OR r.business_date <> e.occurred_on
    OR r.kind <> 'VARIABLE'
    OR r.category <> 'OTHER_VARIABLE'
    OR coalesce(r.note, '') <> e.description);

-- C5-2 V2 信用卡支出不得产生 V1 镜像（期望 0 行）
SELECT e.id
FROM expenses e
JOIN expense_records r ON r.id = e.id
WHERE e.kind IN ('CREDIT_ONE_TIME','CREDIT_INSTALLMENT');
```

```bash
sqlite3 "$P" "<C5-1 SQL>"
sqlite3 "$P" "<C5-2 SQL>"
```

反向相等检查（V1 每一行都要在 V2 找到对应）**禁止**执行：V2 之前的 V1 历史
记录没有 V2 对应行，属于正常状态。

合成验证（`41-synthetic-sql-verification.log`）：
- C5-1 精确命中「缺失镜像」「note 篡改」「business_date 篡改」三行（e2/e3/e4），
  合法镜像（e1）、空串→NULL 镜像（e7）与 V1 历史行（h1）均不误报。
- C5-2 精确命中「信用卡支出产生镜像」（e5）。

### OPEN（既有设计缺口，非迁移引入；只记录，不修复）

```sql
-- OPEN 1 信息性数字；不得据此判定迁移失败
SELECT (SELECT count(*) FROM income_entries) AS v2_income_rows,
       (SELECT count(*) FROM income_records) AS v1_income_rows,
       (SELECT count(*) FROM income_entries i JOIN income_records r ON r.id = i.id) AS shared_ids;
```

- **OPEN 1**：V2 `income_entries` → V1 `income_records` 无任何镜像实现
  （`recordIncomeEntry()` 只写 `income_entries`）。不存在「两侧收入逐笔相等」的
  可校验项；上面的数字仅供记录。
- **OPEN 2**：`deleteV2Expense()`（`repositories.ts:1934`）只删 `expenses`，
  不删 `expense_records` 镜像。迁移不改变该行为，不做补偿。
- **OPEN 3**：`accounts`、`expense_categories`、`import_batches`、`income_entries`、
  `fixed_expense_plans` 在 V1 无对应表，不设跨账本一致性要求。

禁止为消除 OPEN 项新增镜像、触发器、迁移语句，或修改
`src/`、`migrations/`、`tests/`。

---

## 通过标准

C1、C2、C3、C4 全部符合期望，C5-1/C5-2 均返回 0 行，OPEN 数字仅记录，
即视为迁移后对账通过。任一不符须停止并交审核员裁决。
