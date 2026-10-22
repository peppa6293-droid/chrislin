# R9-03 schema 差异比对（只读）

范围：仅结构（表/列/类型/约束/索引/外键）；未读取、未复制任何真实数据行。
真实侧来源：`33-schema.log`（`sqlite3 "file:...?mode=ro&immutable=1" ".schema"` 的捕获文本）。
参照侧：`migrations/003-bootstrap.sql` 与 `migrations/v3-schema.json`（accepted V3 sqlite_master 快照）。

方法：把三份 DDL 分别在内存 SQLite 中执行，逐项比较
`PRAGMA table_info`、`PRAGMA foreign_key_list`、`PRAGMA index_list/index_info`
以及规范化后的 `CREATE TABLE/INDEX` SQL（忽略 `IF NOT EXISTS` 与空白差异）。
报告：`33-schema-diff.json`；命令日志：`33-schema-diff-command.log`。

## 结论

| 对比 | 表 | 索引 | 差异条数 |
|---|---|---|---|
| 真实库 vs `003-bootstrap.sql` | 20 | 13 | **0** |
| 真实库 vs `migrations/v3-schema.json` | 20 | 13 | **0** |

**未发现任何表、列、类型、NOT NULL/DEFAULT、CHECK、UNIQUE、外键或索引差异。**
因此不存在需要分类为「可能导致迁移失败」或「未知」的差异。

## 逐对象核对（全部为「不影响 V3→V8」）

| # | 对象 | 类型 | 分类 | 依据 |
|---|---|---|---|---|
| 1 | schema_migrations | table | 不影响 V3→V8 | 与 003 一致；1..3 行已由 32 号日志确认 |
| 2 | profiles | table | 不影响 V3→V8 | 与 003 一致（含 singleton_id UNIQUE/CHECK） |
| 3 | financial_settings | table | 不影响 V3→V8 | 与 003 一致（FK profiles） |
| 4 | essential_expense_items | table | 不影响 V3→V8 | 与 003 一致（category CHECK） |
| 5 | essential_expense_snapshots | table | 不影响 V3→V8 | 与 003 一致（UNIQUE(item_id,as_of_date)） |
| 6 | income_records | table | 不影响 V3→V8 | 与 003 一致（kind/status/period_month 约束） |
| 7 | expense_records | table | 不影响 V3→V8 | 与 003 一致（含 V2 追加的 business_date） |
| 8 | cash_accounts | table | 不影响 V3→V8 | 与 003 一致 |
| 9 | cash_balance_snapshots | table | 不影响 V3→V8 | 与 003 一致（UNIQUE(account_id,as_of_date)） |
| 10 | assets | table | 不影响 V3→V8 | 与 003 一致（kind CHECK） |
| 11 | asset_value_snapshots | table | 不影响 V3→V8 | 与 003 一致（UNIQUE(asset_id,as_of_date)） |
| 12 | debts | table | 不影响 V3→V8 | 与 003 一致；R9-04 C1 列名依据成立 |
| 13 | debt_period_facts | table | 不影响 V3→V8 | 与 003 一致；UNIQUE(debt_id,period_month) 与 C2 依据成立 |
| 14 | app_metadata | table | 不影响 V3→V8 | 与 003 一致 |
| 15 | essential_expense_revisions | table | 不影响 V3→V8 | 与 003 一致 |
| 16 | cash_account_revisions | table | 不影响 V3→V8 | 与 003 一致 |
| 17 | asset_revisions | table | 不影响 V3→V8 | 与 003 一致 |
| 18 | debt_revisions | table | 不影响 V3→V8 | 与 003 一致（当前 0 行） |
| 19 | planning_income_revisions | table | 不影响 V3→V8 | 与 003 一致；真实库无 V4 新增的 planning_income_month_revisions |
| 20 | settings_revisions | table | 不影响 V3→V8 | 与 003 一致 |
| 21–33 | 13 个业务索引 | index | 不影响 V3→V8 | 名称、所属表、列顺序、唯一性均与 003 及 v3-schema.json 一致 |

## 对 V3→V8 迁移的含义

- 真实库是标准 V3：`user_version=3`、`schema_migrations=[1,2,3]`、`integrity_check=ok`、无外键违规。
- V5–V8 所需对象（`accounts`、`expense_categories`、`expenses`、`import_batches`、`income_entries`、`fixed_expense_plans`）在真实 V3 中均不存在，符合 `005.sql`–`008.sql` 的纯 DDL 新建预期，不构成冲突。
- 本步骤**未**把真实库作为迁移程序输入，**未**复制真实库到任何位置；仅用只读 `.schema` 文本做结构比较。
