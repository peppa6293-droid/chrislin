# Q10 authoritative definition and prior scope

Authoritative source: `evidence/wp04-release-cutover-readiness/07-experiment-closure/Q01_Q18_CLOSURE.md`, Q10 row: “BUSY/timeout 处理存在；SQLITE_LOCKED 专项注入缺失。”

Historical current-source experiment map: `scripts/quiescence_experiments.py`, `reconcile()` marks Q10 as “native peer BUSY at 0/100/5000ms, actual errors and elapsed microseconds”; the missing subitem is “SQLITE_LOCKED injection not executed”.

This run therefore adds only an actual SQLite `SQLITE_LOCKED` injection and its error/timing/fail-closed semantics. It does not claim a normal Production writer race naturally generates `SQLITE_LOCKED`.
