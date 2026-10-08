# V0.1.2 V4 Old-Runtime Protection Report

Status: `PF_V012_V4_OLD_RUNTIME_PROTECTION_READY_FOR_AUDIT`

`RB-V4-OLD-RUNTIME-01` remains OPEN pending independent audit and any later separately authorized Production runtime replacement / migration. This report does not authorize or perform either action.

## 1. Scope and authority

Implemented only the Owner-authorized old-runtime guard, release/migration gate, isolated rehearsal, focused regression coverage, and this report. Financial Model V1.0, Schema V4 migration SQL, data semantics, Bundle ID, app-data identity, and SQLite basename were preserved.

## 2. Threat model

The protection addresses a V4 runtime opening unsupported or inconsistent schema state, direct schema mutation outside the authorized migration window, migration through an ungated supported entrypoint, an old/unknown Production app or process being present at the migration checkpoint, and release without a matching candidate, database hash, or verified backup.

## 3. Existing old-runtime evidence

Read-only inspection of `/Applications/Personal Finance Console.app` recorded Bundle ID `com.personalfinance.console`, executable `personal-finance-console`, and executable SHA-256 `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`. That known V3 app remains installed and unchanged. The gate rejects it as a migration candidate.

## 4. Layer A — forward schema guard

`migrateDatabase` reads `PRAGMA user_version` and `MAX(schema_migrations.version)` before enabling foreign keys or issuing DDL/DML. It rejects either version above V4, disagreement between the two version authorities, and a target lower than the existing schema. The native Production startup independently reads both version authorities through a read-only SQLite connection before opening the DB writable. A V3 Production DB requires a one-use gate authorization before writable open; an empty or unsupported Production DB is rejected.

## 5. Native write protection and business-read ordering

Production SQLite uses a native authorizer. Outside the authorized migration window it denies schema DDL, writes to `schema_migrations`, mutable PRAGMAs, ATTACH/DETACH, unknown authorizer actions, and business DML while the schema is not ready. Before migration, only the three schema-version preflight selects are available. The migration boundary is one-use and the DB becomes ready only after both schema-version authorities equal V4.

The Rust `DatabaseState::open` helper also refuses the Production DB path, so direct native open cannot bypass the gated Tauri startup path.

## 6. Layer A limitation

The new guard is not present in an already-built old V3 binary. Layer A does not retroactively stop that binary from opening a future V4 database and is not claimed to close the release blocker by itself.

## 7. Runtime compatibility manifest

New Production builds embed `Contents/Resources/runtime-compatibility.json`: manifest format 1, runtime generation 4, minimum supported schema 1, maximum supported schema 4, Bundle ID `com.personalfinance.console`, and the expected executable path. The native Production startup validates the manifest and requires the exact normal installed executable path. The release tooling independently reads and validates the built/installed app bundle and hashes its executable and manifest.

Isolated Production bundle built at `artifacts/v012-v4-old-runtime-protection/cargo-target/release/bundle/macos/Personal Finance Console.app`. Readback confirmed Bundle ID and manifest fields. Candidate executable SHA-256: `a2c4e13a9d20c30cc0aefb37fda1f54c67a04a6e2e5495ece010e9ae125a39c1`. Manifest SHA-256: `f60ebff85a28d67750cd4b77084cb7d549f24f8c833811ca4e16a9c41ec583e7`.

## 8. Production release and migration gate

`scripts/production_v4_release_gate.py` supplies `preflight`, `migrate`, and `retire` commands. Preflight fails closed on an unknown process/app inventory, any running Production process, anything other than exactly one Production-identity app at `/Applications/Personal Finance Console.app`, the known old hash, wrong Bundle ID, invalid/missing V4 manifest, a non-executable candidate, a candidate hash or manifest hash mismatch, a non-V3/inconsistent/invalid Production DB, absent or mismatched backup, or missing separate Owner candidate/migration approvals. A persistent release receipt is required; it records the candidate executable/manifest hashes, Production DB pre-migration hash/schema, backup path/hash, and app/process inventory.

The migration command first runs this same gate, persists its receipt, writes a short-lived Owner-only one-time authorization, and launches only the verified installed candidate. The native runtime consumes and verifies the authorization, DB hash/version, backup hash, candidate executable hash, manifest hash, app path, Owner authorization ID, and nonce before allowing Migration 4. Direct `migrateDatabase` calls in Production without this native authorization fail closed.

## 9. Old-app retirement procedure

The `retire` command requires a separate runtime-replacement authorization naming the exact old app path, candidate app path, target install path, old executable hash, candidate executable hash, and authorization ID. It rechecks running Production processes and `/Applications` plus `~/Applications` inventories. It copies the old bundle into a timestamped evidence archive, verifies its file inventory, disables execute permission on the archived executable, removes the old normal-path copy, installs the candidate through a staging path, then verifies installed executable hash and manifest. On candidate-install/verification failure it restores the archived old bundle and original executable mode. This procedure was tested only on temporary fixture directories and was not run on the installed app.

## 10. Installed-app inventory

The gate recursively inventories matching `com.personalfinance.console` bundles under `/Applications` and `~/Applications`, recording bundle path, Bundle ID, executable path, executable SHA-256, and manifest facts where available. Symlinks/aliases, unreadable metadata, unknown extra copies, and old runtimes block preflight.

## 11. Migration entrypoint enforcement

The supported Production runtime startup is gated before writable SQLite open. The TypeScript migration boundary maps to native begin/end commands. Direct DDL and metadata mutation outside the native migration window are denied by SQLite’s authorizer. The Rust direct-open helper rejects the Production identity path. Isolated Node SQLite and acceptance/Smoke migration paths remain usable without Production authorization.

## 12. Isolated rehearsal

Rehearsal used only synthetic app bundles and temporary SQLite data. The Python gate fixture exercises consistent V3 facts, an approved V4 manifest/executable, matching backup, receipt generation, old-running-process rejection, installed-old-app rejection, unknown executable hash rejection, wrong/acceptance Bundle ID rejection, missing compatibility evidence rejection, missing/mismatched backup rejection, and newer schema rejection. A safe synthetic fixture produces the pre-migration receipt. The retirement routine was exercised against a synthetic legacy bundle and candidate, including install-failure rollback.

## 13. Rehearsal outcomes

Release-gate suite: 11 passed. Rust suite: 15 passed. TypeScript schema-guard suite is included in the complete Vitest run. No fixture touches Production or RC2.

## 14. Production preservation

Read-only verification before and after the implementation/builds: Production SHA-256 `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`; `user_version=3`; migrations `[1,2,3]`; `integrity_check=ok`; foreign-key check clean; no WAL/SHM sidecars. No Production app was launched and no Production file or financial row was intentionally written.

## 15. RC2 preservation

Read-only RC2 executable SHA-256 remains `f55f412665fecdf51858b8437284635e8f746db54ce2ce425dfd772466d9c60c`. RC2 was not built, launched, or modified by this task.

## 16. Verification results

- `npm run lint`: PASS; 24 existing non-failing CSS specificity warnings remain (deferred `P2-CSS-01`).
- `npm run typecheck`: PASS.
- `npx vitest run tests`: PASS — 15 files, 281 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: PASS — 15 tests.
- `npm run test:release-gate`: PASS — 11 tests.
- `python3 -m py_compile scripts/production_v4_release_gate.py scripts/test_production_v4_release_gate.py`: PASS.
- `npm run build`: PASS.
- `CARGO_TARGET_DIR=<isolated artifacts path> npx tauri build --bundles app`: PASS; bundle and embedded manifest independently read back.

## 17. Residual risks and open gates

The existing V3 Production app remains installed. The real-machine preflight therefore remains blocked until a separately authorized, verified retirement/replacement checkpoint is completed. Production V4 migration remains NOT AUTHORIZED. macOS cannot prevent the Owner from manually restoring an archived binary later; protection is the deterministic supported operational state described in the Owner authorization, not an impossible-to-bypass claim. Six accepted P2 items remain deferred: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, P2-TEXT-01, P2-V4-ACTUAL-NOCHANGE-01, and P2-V4-TARGET-01.

## 18. Git state and changed files

Starting HEAD for this implementation continuation: `df64eecc9892a8d2b810e49a3cb16a597290f1c5`. The separate prior V4 sandbox reset correction remains committed as `df64eec`; this old-runtime work is a separate working-tree change set. No commit was created for this report/task.

Files changed for old-runtime protection:

- `src/persistence/migrations.ts`
- `src/persistence/database.ts`
- `src/persistence/tauri-database.ts`
- `tests/future-schema-guard.test.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `src-tauri/runtime-compatibility.json`
- `scripts/production_v4_release_gate.py`
- `scripts/test_production_v4_release_gate.py`
- `package.json`
- `V012_V4_OLD_RUNTIME_PROTECTION_REPORT.md`

## 19. Ready for independent audit

Both protection layers, isolated failure/safe-case rehearsal, retirement rollback proof, required test suites, and isolated Production bundle build are complete. The known old installed runtime and Production V3 database remain unchanged. `RB-V4-OLD-RUNTIME-01` is submitted for independent audit only; no audit pass, Owner closure, runtime replacement, or Production migration is claimed.
