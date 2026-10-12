# R5 closed-state DB readback — partial

- DB：`~/Library/Application Support/com.personalfinance.console.wp03preview/personal-finance-console.sqlite3`
- Closed-state check after normal quit: no R5 process and no open DB handle.
- `user_version=4`; `schema_migrations=[1,2,3,4]`; `integrity_check=ok`; `foreign_key_check=[]`.
- No `-wal`, `-shm`, or journal sidecars.
- SHA-256 before restart and after second quit: `e0b0b1a74ac51051077ad1a2060832f17fa0b9fce9f88dbbc431a98834bf2526` (unchanged).
- File metadata after second quit: inode 25160666; size 258048; mtime 2026-10-12T15:15:24+0800.
- Selected row counts: profiles 1; income_records 1; expense_records 1; debts 2; debt_period_facts 2; debt_revisions 2; planning_income_revisions 1; planning_income_month_revisions 0.
- This is a partial readback only. A–I full table-by-table values, revision lineage, snapshots, lifecycle records and business-key comparisons are not yet audited.
