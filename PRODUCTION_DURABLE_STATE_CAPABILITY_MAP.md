# Production Durable State Capability Map — WP-04R2C3C1

- Read before implementation decision: 2026-10-13 (Asia/Shanghai)
- Runtime source baseline: `7b4a9c16bbbfc6ad1cd602af479d8aaa9a11f756`
- Starting report HEAD: `af717492b127aa3ef2360391d7cce867323a0ba3`
- Scope: read-only map of current source contracts; no Production state was opened.

## A. What Builder-preflight currently checks

`ensure_no_unresolved_cutover` delegates to `cutover_startup::inspect`. That reader scans its fixed generic integration/recovery `RECORDS` and known phase receipt prefixes, rejects unsafe/corrupt/pending files, and does not open SQLite. The list does not include the Production-specific release receipt, migration authorization, claimed authorization files, consumed authorization ledger, or a Production terminal. The ordinary Production path invokes this before `tauri::Builder`, and invokes the generic check again in setup.

Sources: `src-tauri/src/lib.rs:34-38,1140-1149`; `src-tauri/src/cutover_startup.rs:9-24,54-87`.

## B. Consumed authorization ledger

`production-v4-consumed-authorizations.json` is already persisted after full authorization/receipt/backup/runtime/database validation and before `run_production_migration_command` opens the database for Migration 4. Each existing ledger row contains `authorizationId`, `nonce`, `consumedAtUnix`, `candidateExecutableSha256`, and `compatibilityManifestSha256`. Persistence uses a temporary owner-only file, file `sync_all`, atomic rename, then parent-directory `sync_all`. This is the strongest existing durable unresolved authority and the permit/ledger contract can remain unchanged. Current startup does not read it.

Sources: `src-tauri/src/lib.rs:30,71-79,209-254,294-313,331-375`.

## C. Existing Production durable objects and state vocabulary

Existing objects are:

- `production-v4-release-receipt.json`: preflight receipt bound to candidate approval, migration authorization, pre-migration DB hash, executable, and compatibility manifest.
- `production-v4-migration-authorization.json`: one-time authorization; includes nonce, validity window, app/candidate paths and hashes, manifest hash, DB path/pre-migration hash/schema, backup path/hash, release-receipt path/hash, approval/authorization hashes, and optional Owner authorization ID.
- A temporary claimed authorization file named `.production-v4-migration-authorization.json.claimed-<pid>-<nonce>` during consumption.
- `production-v4-consumed-authorizations.json`: append-only consumed rows described above.
- SQLite `schema_migrations` / `PRAGMA user_version` and backup file.

There is no Production `ACTIVE`, `PENDING`, `UNKNOWN`, session, or terminal record. The current native result is an in-memory/stdout `V4_MIGRATION_VERIFIED_NATIVE` event, which is not durable. The only `VERIFIED_HANDOFF` persistence found is in the explicitly synthetic unified-quiescence path and is not a Production contract.

Sources: `src-tauri/src/lib.rs:21-32,43-79,256-383,414-501`; `src-tauri/src/quiescence.rs:745-760`.

## D. Crash boundary: current persisted state

- Before authorization claim: authorization remains at its fixed permit path; no consumed ledger row exists; migration has not opened the DB.
- After claim rename but before consumed-ledger durability: the claimed authorization path is the only on-disk indication; abrupt process exit can leave it. Ordinary startup currently does not scan it. No DB open has occurred yet.
- After consumed-ledger durability and before/during M4: the ledger row exists before DB open. A crash leaves the consumed row, and the DB may remain V3 or be in an uncertain/committed state. Current startup ignores the Production ledger.
- After COMMIT/readback but before command return: the consumed ledger remains and the DB is V4; no final Production terminal exists. Current startup ignores both as cutover authority and has no binding check.
- After command return: the local migration guard drops before the outer function prints the result and exits; stdout and exit code are the only success indication beyond DB/ledger facts.

Sources: `src-tauri/src/lib.rs:281-284,331-375,414-501,1131-1137`.

## E. Existing objects to reuse

Reuse the canonical Production authority directory and existing authorization, release receipt, consumed ledger row, executable/manifest identity, database identity, and backup identity as the terminal's binding inputs. Treat a claimed authorization artifact as unresolved while present. Keep the existing generic synthetic `outcome.json` contract separate. Add one fixed-name Production terminal artifact in the same canonical authority directory; do not change permit or consumed-ledger schemas, add a second permit/ledger, or reuse synthetic S-state records.

## Implementation decision after map

The consumed ledger is already a durable unresolved record before any database mutation and may remain unchanged. The claim filename covers the earlier rename-before-ledger interval. Extend Production startup preflight to recognize claimed files, consumed-ledger-without-terminal, and any terminal; accept a terminal only after exact authority binding and post-migration database verification. Add a single Production terminal file and make its durable write plus exact readback occur before the migration function returns while the existing exclusive RAII guard remains alive. On pre-terminal failure, leave the durable consumed ledger or claim artifact in place and fail closed; do not retry or restore.
