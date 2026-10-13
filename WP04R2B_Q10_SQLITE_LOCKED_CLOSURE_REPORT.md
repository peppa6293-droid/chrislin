# WP-04R2B3D — Q10 SQLITE_LOCKED Evidence Closure

**Final Status: `WP04R2B_SYNTHETIC_CUTOVER_READY`**

Q10 is closed with a real `SQLITE_LOCKED` error produced by the frozen rusqlite/bundled SQLite stack on disposable synthetic V3 databases. The native SQLite error converter from the exact frozen source module consumed that error. Timeout behavior, V3 readback, database bytes, integrity, and source/candidate identity all passed.

## Frozen objects

- Source: `c3da2f73c03b681957b4334751b7933d102caad1`; source archive SHA-256 `e2f06d023eca661079406821cac23373b874a81867c95dccb6f1e503ecef6ce3`, 1,323 files. Runtime tracked diff from the frozen commit: none.
- Candidate: `/Users/linte/Library/Caches/pfc-wp04r2b3c2-c3da2f7/candidate-build-02/cargo-target/release/bundle/macos/小钱家.app`; executable SHA-256 `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`; manifest SHA-256 `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`; Bundle ID `org.pfc.quiescence.integration`; Team ID `SSRKA7A4TN`; strict codesign PASS.

## Q10 evidence

The authoritative Q10 row is `evidence/wp04-release-cutover-readiness/07-experiment-closure/Q01_Q18_CLOSURE.md`. Historical native-peer evidence already records real `SQLITE_BUSY` at busy_timeout 0 / 100 / 5000 ms: primary/extended code 5, with observed elapsed times 8 μs / 110,417 μs / 5,211,290 μs. The raw event records are preserved in `evidence/quiescence/authoritative-final.json` and summarized in `04-timeout-semantics/PREVIOUS_SQLITE_BUSY_EVIDENCE.json`.

This run used `rusqlite 0.37.0`, `libsqlite3-sys 0.35.0`, bundled SQLite `3.50.2`, matching the frozen runtime dependency lock and bundled implementation. It opened two connections to each fresh on-disk synthetic V3 fixture with SQLite URI shared-cache enabled. A reader held a read transaction on a table while a second connection attempted an INSERT to that same table. Shared-cache is a deliberate isolated injection mechanism for SQLite's table-lock conflict; this does not claim the native runner's `PRIVATE_CACHE` configuration naturally produces the same conflict.

| Writer busy_timeout | Primary | Extended | SQLite result | Message | Elapsed |
|---:|---:|---:|---|---|---:|
| 0 ms | 6 | 262 | `SQLITE_LOCKED_SHAREDCACHE` | `database table is locked: business_probe` | 15,709 ns |
| 5,000 ms | 6 | 262 | `SQLITE_LOCKED_SHAREDCACHE` | `database table is locked: business_probe` | 16,334 ns |

The error returned immediately in both cases; the nonzero busy timeout did not convert it into a wait or `SQLITE_BUSY`. Raw rusqlite variant: `DatabaseLocked`, extended code 262. The frozen native `Failure::from(rusqlite::Error)` mapped it to generic `SQLITE_ERROR` while preserving `sqlite_primary=6` and `sqlite_extended=262`, so it was not mistaken for BUSY or success.

## Fail-closed and database readback

Both disposable DBs were prepared as V3 before their before-hash. The attempted INSERT returned an error, reported zero successful changes, and left the writer in autocommit; the reader transaction remained open until explicitly rolled back. After closing both connections, each DB hash exactly matched its before-hash. `user_version` remained 3, migration rows remained `[1,2,3]`, M4 row count was 0, business sentinel row was unchanged, `integrity_check=ok`, foreign-key violations were empty, and no WAL/SHM/journal sidecars remained. No migration statement, authorization, permit, backup, or recovery action was created in this experiment.

The error conversion was exercised directly through the frozen native `Failure::from` implementation using the live SQLite error object. The formal Gate migration runner was not given a fake or synthetic error. Its regular native connection uses `PRIVATE_CACHE`; therefore this test is explicitly an engine error-semantics injection, not a full Gate-runner injection. The source failure path returns SQLite errors, the pre-commit component path rolls back and verifies V3, permit claim/consumed markers prevent replay, and recovery diagnosis does not restore automatically. This classification is limited to the source path and evidence cited; it does not claim a production runtime test.

## Q01–Q18 closure and carried-forward acceptance

`07-q-closure/Q01_Q18_FINAL_CLOSURE.json` carries forward the accepted WP04R2B3C3 classifications, changes only Q10 to `PASS_CURRENT`, and sets overall closure to `PASS_FOR_R2B`. Q11 renderer-only remains `DEFERRED_TO_WP04R2C`; Q09 and Q18 remain intentionally unsupported.

Canonical C0–C10, S0–S10, Migration 4 exactly once, business preservation, PRE/POST model, 17/17 full-chain recovery, and final regression are reused from WP04R2B3C3 under the same frozen source and candidate. This work order did not rerun those scenarios, rebuild/resign/launch the candidate, run Renderer, or access Production.

Production App/DB untouched; WP02 and Financial Model unchanged; WP03 acceptance preserved. No real authorization, permit, receipt, backup, or recovery authorization was created.

Evidence root: `evidence/wp04-release-cutover-readiness/48-r2b-q10-sqlite-locked/`. The machine-readable acceptance readback is `08-final-readback/WP04R2B3D_FINAL_READBACK.json`.

**Next:** stop at `WP04R2B_SYNTHETIC_CUTOVER_READY`. This does not close `RB-V4-CUTOVER-QUIESCENCE-01`, authorize Production, or constitute Owner final acceptance. Renderer-only work remains a separate WP04R2C scope.
