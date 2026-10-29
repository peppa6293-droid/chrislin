# 回读日志说明

- `41-readback.log`：探索期日志。最初误用 `cash_balance_snapshots` / `asset_value_snapshots` 取数，并有两处 SQL 语法错误（`no such column: lc.eff_active`）。**该文件数值已过时，不作为验收依据，仅留档不删。**
- `42-readback-final.log`：权威回读。按应用实际读取的修订表（`cash_account_revisions`、`asset_revisions`、`cash_account_lifecycle_revisions`）计算，全部锚点一致。
- `43-backups-and-evidence.log`：备份 / 留档副本 / 隔离库哈希复核。
- `44-final-state.log`：干净退出后的进程、库哈希、sidecar、代码与包状态。

只读方式：`sqlite3 "file:$DB?mode=ro&immutable=1"`。全程未执行任何写 SQL。
