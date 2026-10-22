# R8 — Production Schema V8 authority upgrade: execution receipt

Date: 2026-10-22
Scope of this batch: code, tests, isolated fixtures, temporary directories, candidate build.
No real Production database, identity, permit, terminal, app-data, or installed bundle was opened,
created, consumed, replaced, or launched. No commit, push, or merge was performed.

**Batch status: `R8_CODE_BATCH_BLOCKED` — sole blocker is the literal §3.1 command form
`python3 -I -m unittest scripts/test_production_v8_release_gate.py`, which cannot import the
local `scripts` package under Python 3.9.6 isolated mode. The equivalent direct invocation
(`python3 -I scripts/test_production_v8_release_gate.py -v`) runs 25/25 tests and passes.
All six substantive R8 sections below are PASS; no code or test failure blocks the batch.**

---

## 1. R8-01 contract inventory — PASS

Evidence: `contract-inventory.md` (TS authority, Rust authority, TS/Rust boundary, manifest,
fixtures, Python gates, startup plumbing; change-vs-historical matrix; BLOCKED check).

Remaining V4 references were audited and classified; none is a current V8 authority:

| Reference | Classification |
|---|---|
| `production-v4-cutover-terminal.json`, V4 permit/ledger/receipt names | historical names, accepted only as block-only legacy records |
| `LEGACY_PRODUCTION_MIGRATION_AUTHORIZATION`, `LEGACY_CLAIMED_AUTHORIZATION_PREFIX`, `LEGACY_TEMP_PREFIX` | historical detection only |
| `cutover_startup.rs` `V4_VERIFIED`, `V4_COMMITTED_PENDING_VERIFICATION` | historical outcome recognition; yields `LEGACY_V4_STATE_BLOCKS_V8_STARTUP` |
| `consume_legacy_v4_synthetic_authorization` | compiled only under `feature = "quiescence-fixture"`; historical V4 gate-wiring test |
| `com.personalfinance.console.v4acceptance` | isolated acceptance identity, TS-managed; not Production |
| `V4FoundationService`, `V4MutationResult` | business-service names unrelated to schema authority |
| V4 payloads inside tests (`V4_VERIFIED`, `ONE_TIME_PRODUCTION_V4_...`) | negative fixtures proving refusal |

No unexplained current V4 authority reference.

## 2. R8-02 Native V3→V8 migration — PASS

Implementation: `src-tauri/src/lib.rs` (`NATIVE_MIGRATIONS` = `004.sql`…`008.sql`),
new `migrations/005.sql`…`008.sql`, snapshots `migrations/v5-schema.json`…`v8-schema.json`.

Per-version contract: each SQL file carries its own `PRAGMA user_version = N;`; Rust inserts
exactly one `schema_migrations` row per version and asserts `user_version == max(version) == N`
before continuing. Chain runs inside one `BEGIN EXCLUSIVE` transaction with
`foreign_keys=ON`, `journal_mode=DELETE`, `locking_mode=EXCLUSIVE`, `synchronous=FULL`,
`fullfsync=ON`, `wal_autocheckpoint=0`, `busy_timeout=0`, `NO_CKPT_ON_CLOSE`; any DDL,
row-insert, authority-mismatch, commit, or readback failure rolls back.

Isolated fixture readback (`30-rust/native-v3-to-v8-fixture.log`):

```text
source schema        3/3
source SHA-256       b44f9bd04a20bd5a80be5c2a90ed99d21b72f55bba28d58d961f9cbb01e7074b
target schema        8/8
migration rows       [1,2,3,4,5,6,7,8]
migration row count  8
integrity_check      ok
foreign-key count    0
sidecars             absent
post DB SHA-256      a61b21dbe182d32745ee5bb1c99144121e3f3f90dad66a52d95093ce3c6bd021
fixture root         /private/var/.../T/pfc-r8-native-v3-v8-16593-0 (synthetic, not /Applications)
```

Tests:
- `native_v3_to_v8_full_schema_fixture_migration_is_isolated` — full chain + readback.
- `intermediate_v4_to_v7_schemas_are_neither_startable_nor_migratable` — V4/V5/V6/V7 are neither
  startable nor natively migratable; schema unchanged; zero V8 rows.
- `ddl_failure_rolls_back_to_v3_without_a_half_migrated_state` — returns to 3/3, rows `[1,2,3]`,
  no V5+ tables, no sidecars.
- `verified_v8_restart_does_not_replay_migration_and_reply_loss_keeps_terminal` — restart passes,
  re-migration fails, exactly one V8 row.
- `tests/r8-native-migration-sql-parity.test.ts` — 8 tests: `migrations/005..008.sql` byte-equal
  to `MIGRATION_SQL` after newline normalization; applying `003-bootstrap.sql` + `004..00N`
  reproduces `vN-schema.json` exactly with `PRAGMA user_version=N`.
- `native_schema_artifacts_match_accepted_migration_source` — native `004..008` match the
  accepted TS migration source.

## 3. R8-03 TypeScript / Rust boundary — PASS

`src/runtime/tauri-bootstrap.ts`:
- `resolveRuntimeSchemaAuthority(identifier)` returns `NATIVE_V8_GATE` only for
  `com.personalfinance.console`; `TYPESCRIPT_MIGRATION` only for the five isolated identities
  (smoke, v4acceptance, wp02preview, wp03preview, quiescence.integration); any other/empty
  identifier throws `RUNTIME_IDENTITY_NOT_ISOLATED`.
- `openRuntimeDatabase` resolves identity **before** opening; Production never calls
  `migrateDatabase`; it calls read-only `requireNativeV8Schema()` requiring 8/8.
- Production V3 fixture stays at V3; services reject; no business I/O.
- Production V8 fixture is accepted read-only with identical serialized bytes.
- If native identity is unavailable or unknown, `openDatabase` is never called.

Evidence: `tests/r8-production-schema-authority.test.ts` (19 tests, all passing) and
`10-tests/r8-runtime-boundary-and-parity-verbose.log`.

Defense-in-depth ordering note: the authoritative gate is the Rust startup gate in `run()`,
which executes before the Tauri Builder and therefore before any TS composition root. The TS
`requireNativeV8Schema()` check is read-only and does not itself read the terminal.

## 4. R8-04 Manifest — PASS

`src-tauri/runtime-compatibility.json`:

```json
{
  "manifestFormatVersion": 2,
  "runtimeGeneration": 8,
  "minSupportedSchemaVersion": 8,
  "maxSupportedSchemaVersion": 8,
  "migrationSourceSchemaVersion": 3,
  "bundleId": "com.personalfinance.console",
  "executable": "Contents/MacOS/personal-finance-console"
}
```

SHA-256: `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`
Source and bundled copy are byte-identical (same hash, verified against
`.../小钱家.app/Contents/Resources/runtime-compatibility.json`). The same values are asserted by
the Rust startup validator and the Python V8 gate constraint checks.

## 5. R8-05 V8 permit / terminal / startup — PASS

Names: `production-v8-migration-authorization.json`, `production-v8-release-receipt.json`,
`production-v8-consumed-authorizations.json`, `production-v8-cutover-terminal.json`,
`.production-v8-migration-authorization.json.claimed-*`.

Durable terminal (`src-tauri/src/production_cutover_state.rs`): owner-only directory, non-symlink,
single-link, Owner-only mode, `O_NOFOLLOW|O_CLOEXEC`, create-only temp, file fsync, hard-link
publish, directory fsync, exact-byte readback, cleanup before durable readback, refuse overwrite,
terminal retained after durable readback.

Terminal state `V8_VERIFIED` binds source 3/3, target 8/8, rows `[1..8]`, count 8, integrity
`ok`, FK 0, sidecars absent, permit/receipt/ledger/candidate/manifest/backup/database
path/hash/device/inode, and pre/post database SHA-256.

Startup refuses: unresolved claim; legacy V4 terminal/permit; terminal without ledger or with a
resurrected permit; ledger without terminal; V8/unknown database without terminal; any binding,
schema, readback, backup, manifest, executable, or identity mismatch.

Failure injection (all fail closed; no success-like terminal; permit not repeat-consumable;
startup blocked; no fallback to TS migration or business I/O):

| Failure point | Injection / test | Observed state |
|---|---|---|
| before terminal write | `BeforeTerminalWrite` | DB 8/8, no terminal, startup blocked |
| before terminal file fsync | `BeforeTerminalFileSync` | DB 8/8, no terminal, startup blocked |
| after publish / before directory fsync | `BeforeTerminalDirectorySync` | DB 8/8, no terminal, startup blocked |
| after directory fsync / before readback | `BeforeTerminalDurableReadback` | DB 8/8, terminal removed, startup blocked |
| after exact durable readback | `AfterTerminalDurableReadback` (lost caller reply) | terminal retained, restart passes, one V8 row |
| after post-readback / before terminal publish | `AfterPostReadbackBeforeTerminal` (+ child exit 86) | DB 8/8, ledger present, no terminal, startup blocked |
| after permit claim / before native migration | `AfterAuthorizationClaimBeforeNativeMigration` | DB 3/3, permit gone, ledger present, no terminal, startup blocked, retry refused |
| consumed-ledger write failure | ledger temp path pre-occupied | DB 3/3, claimed file retained, no ledger/terminal, startup blocked, retry refused |
| release-receipt readback failure | receipt mode `000` after claim | DB 3/3, claimed file retained, no ledger/terminal, startup blocked, retry refused |
| backup / hash binding failure | stale backup, receipt/ledger/database binding mutation matrix | startup blocked |
| pending terminal temp file / unresolved claim | `WRITE_UNRESOLVED` / claim discovery | blocked before database read/write; DB remains V3 |

A failed permit claim now deliberately retains the claimed file (changed this batch): deleting it
would erase the only evidence that the one-time permit was taken, and a V3 database with no ledger
would be indistinguishable from a never-started database. The historical fixture-only V4 consumer
retains its original behavior.

Tests (Rust, 16 in `production_terminal_tests` + contract tests): normal success, restart,
reply loss, child-process exit, corrupt/stale terminal, missing terminal, missing ledger,
resurrecting permit, V8→V7, changed candidate, incomplete/tampered terminal, binding mismatch
matrix, legacy V4 block-only, pending write, intermediate schemas, DDL rollback, isolated full
chain, claim/ledger/receipt failure injection.

## 6. R8-06 V8 release gate — PASS (test suite) with §3.1 command-form blocker

New files: `scripts/production_v8_release_gate.py`, `scripts/test_production_v8_release_gate.py`.
`scripts/test_production_v8_release_gate.py` — 25 tests, all passing (direct invocation).

Refusal matrix covered: future schema; authority mismatch; V4 manifest cannot authorize V8;
wrong bundle; legacy V4 executable; missing manifest; sidecar; backup hash/path/alias/device/inode;
V4 permit/terminal block-only; permit create-only/one-time/receipt-bound; expired/future-dated
permit; old unconsumed permit; permit resurrection; duplicate authorization/nonce; missing/tampered
ledger; missing/tampered terminal; incomplete/unknown process inventory; synthetic root escape;
completed migration requires terminal+ledger+exact restart readback.

The historical V4 gate (`scripts/production_v4_release_gate.py`, 40 tests) and wiring integration
(5 tests) remain separate and unmodified in contract; the fixture-only V4 branch still passes.

## 7. Test counts old → new, full commands, failures

| Suite | Baseline HEAD | R8 working tree | Delta |
|---|---|---|---|
| Vitest | 415 passed, 80 skipped (495); 42 passed + 1 skipped files | 442 passed, 80 skipped (522); 44 passed + 1 skipped files | +27 tests, +2 files |
| Cargo | 46 passed, 0 failed | 57 passed, 0 failed | +11 |
| Python V8 gate | (new) | 25 passed | +25 |
| Python V4 gate | 40 passed | 40 passed | 0 |
| Gate wiring integration | 5 passed | 5 passed | 0 |
| Unified synthetic contract | 5 passed | 5 passed | 0 |
| Unified R2B recovery | setup error (pre-existing) | setup error, 0 run | 0 |

Commands and results:

```text
env NODE_ENV=test npx vitest run --reporter=dot
  PASS — 442 passed | 80 skipped (522), exit 0
npm run typecheck
  PASS — exit 0
npm run lint
  PASS — 125 files checked, exit 0
cargo test --manifest-path src-tauri/Cargo.toml
  PASS — 57 passed, 0 failed, exit 0
python3 -I -m unittest scripts/test_production_v8_release_gate.py
  FAIL — exit 1, ModuleNotFoundError: No module named 'scripts'
python3 -I scripts/test_production_v8_release_gate.py -v
  PASS — 25 tests, OK
python3 -I scripts/test_production_v4_release_gate.py -v
  PASS — 40 tests, OK
python3 -I scripts/test_production_gate_wiring_integration.py -v
  PASS — 5 tests, OK
python3 scripts/test_unified_synthetic_contract.py -v
  PASS — 5 tests, OK
python3 scripts/test_unified_r2b_recovery.py -v
  SETUP ERROR — 0 tests; retained historical root lacks SYNTHETIC_ONLY
```

Failure items:

1. **RETURN-R8-TOOLING-01 (blocking by the literal task book):** Python 3.9.6 `-I` removes the
   current directory from `sys.path`, so `-m unittest scripts/...` cannot import the local
   `scripts` package. This is an invocation-form defect in §3.1, not a test failure. The direct
   invocation passes 25/25. Resolution options: amend §3.1 to the direct invocation, or authorize
   an explicit site-path bootstrap (out of R8 scope).
2. **PRE-EXISTING-ENV-01 (not an R8 regression):** `test_unified_r2b_recovery.py` reads a retained
   historical acceptance root whose `SYNTHETIC_ONLY` marker is missing; `setUpClass` aborts.
   Documented, not counted as a pass.
3. Pre-existing Rust warning: unused `PathBuf` import in `src/wp02_preview_isolation.rs`; unrelated.

## 8. Isolated candidate package — built, never launched

`20-builds/BUILD_IDENTITY.json` (marker `ISOLATED_CANDIDATE`, `syntheticOnly: true`):

| Artifact | Path | SHA-256 |
|---|---|---|
| Production candidate app | `src-tauri/target/release/bundle/macos/小钱家.app` | file-list hash `9ccb87c6482f68f68c451d92562a14b043a5a80156cb2db41d8f058226872a20` |
| Candidate executable | `.../Contents/MacOS/personal-finance-console` | `8e596b6bb6ea2edad46a051c5e381da8f7b89e109ca48a5ef7abe276ec28661b` |
| Candidate DMG | `src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg` | `a9972b728339eb654990146f3aac3f2460a28e1103899cec45f54a0087ab7b33` |
| Manifest (source and bundled) | `src-tauri/runtime-compatibility.json` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` |
| Smoke executable | smoke candidate | `2a385430a744f0da3e52fd82236fbd6682b0f20ad9847d75d8dc470579b209bd` |
| Smoke DMG | smoke candidate | `06530b9eb7f6a435f38e27eac278561c79af8e39c4ef4f00c5ff6b54794a427a` |

The Production candidate was built but not launched; nothing was copied to `/Applications`.
The smoke build temporarily overwrote the shared bundle directory; the Production candidate was
rebuilt afterwards and its hashes recaptured.

## 9. Evidence directory and file list

```text
evidence/r8-production-v8-20261022/
  RECEIPT.md
  SCENARIO_MATRIX.md
  contract-inventory.md
  git-status-short.txt
  10-tests/  vitest.log, typecheck.log, lint.log, r8-runtime-boundary-and-parity-verbose.log,
             baseline-HEAD/{vitest,typecheck,lint}.log
  20-builds/ tauri-build-production.log, tauri-build-smoke.log, tauri-build-production-final.log,
             BUILD_IDENTITY.json, app-bundle-files.sha256
  30-rust/   cargo-test.log, native-v3-to-v8-fixture.log, failure-injection-and-restart.log,
             baseline-HEAD-cargo-test.log
  40-gates/  v8-gate-tests.log, v8-gate-tests-required-command-failure.log, v4-gate-tests.log,
             gate-wiring-integration-tests.log, unified-synthetic-contract-tests.log,
             unified-r2b-recovery-tests.log, runtime-compatibility.json
  logs/      mirror of the latest required-run logs
```

## 10. Changed files and R8 rationale

| File | Change | R8 requirement |
|---|---|---|
| `src-tauri/src/production_cutover_state.rs` | V8 terminal/claimed/temp names; create-only durable terminal write and discovery | R8-05 |
| `src-tauri/src/lib.rs` | V8 constants; native `004..008` chain; V8 permit/receipt/ledger/terminal validation; startup gate; new claim checkpoint and fail-closed claim retention; production terminal tests | R8-02, R8-03, R8-05 |
| `src-tauri/src/cutover_startup.rs` | V4 legacy states block-only; V8 records never self-authorize startup | R8-05 |
| `src-tauri/runtime-compatibility.json` | manifest format 2, generation 8, schema 8/8, source 3 | R8-04 |
| `src/persistence/migrations.ts` | export `MIGRATION_SQL`; V1–V3 `targetVersion` guards; V4–V8 SQL unchanged | R8-02 parity source |
| `src/runtime/tauri-bootstrap.ts` | runtime schema-authority boundary; read-only Production V8 check | R8-03 |
| `migrations/005.sql`–`008.sql` | native SQL byte-equal to TS source | R8-02 |
| `migrations/v5-schema.json`–`v8-schema.json` | accepted schema snapshots for parity tests | R8-02 |
| `tests/r8-native-migration-sql-parity.test.ts` | SQL/snapshot parity | R8-02 |
| `tests/r8-production-schema-authority.test.ts` | Production/isolated/unknown identity boundary | R8-03 |
| `scripts/production_v8_release_gate.py` | independent V8 release gate | R8-06 |
| `scripts/test_production_v8_release_gate.py` | V8 refusal matrix, 25 tests | R8-06 |
| `evidence/r8-production-v8-20261022/` | this evidence package | §4.2 |

Untouched by design: V2→V1 `CASH_DEBIT` double-write, financial model, amount formulas, UI business
scope, existing data semantics, historical V4 evidence (two test-generated historical JSON files
were restored to HEAD after runs), `/Applications`, real Production app-data and database.
Untracked `.claude/`, `WORKLOG.md`, and `pelican-*.html` are pre-existing and unrelated.

## 11. `git status --short` (captured after all runs)

```text
 M src-tauri/runtime-compatibility.json
 M src-tauri/src/cutover_startup.rs
 M src-tauri/src/lib.rs
 M src-tauri/src/production_cutover_state.rs
 M src/persistence/migrations.ts
 M src/runtime/tauri-bootstrap.ts
?? .claude/
?? WORKLOG.md
?? docs/EXEC-R8-PRODUCTION-SCHEMA-V8-MIGRATION-INSTRUCTIONS.md
?? evidence/r8-production-v8-20261022/
?? migrations/005.sql
?? migrations/006.sql
?? migrations/007.sql
?? migrations/008.sql
?? migrations/v5-schema.json
?? migrations/v6-schema.json
?? migrations/v7-schema.json
?? migrations/v8-schema.json
?? pelican-bicycle-animation.html
?? pelican-bicycle.html
?? pelican-bike-ride.html
?? pelican-bike.html
?? pelican-cycling.html
?? scripts/production_v8_release_gate.py
?? scripts/test_production_v8_release_gate.py
?? tests/r8-native-migration-sql-parity.test.ts
?? tests/r8-production-schema-authority.test.ts
```

No commit, push, or merge was performed. No `git add -A` was used.

## 12. Real Production touch declarations

```text
REAL_PRODUCTION_DATABASE_TOUCHED = false
REAL_PRODUCTION_IDENTITY_LAUNCHED = false
REAL_PRODUCTION_PERMIT_CREATED_OR_CONSUMED = false
REAL_PRODUCTION_TERMINAL_CREATED = false
```

Basis: all terminal/permit/ledger/receipt operations used `temp_dir()` fixtures with
`SYNTHETIC_ONLY` markers; the Production candidate was only built, never launched; the Production
path is only constructed in a refusal test that rejects it before opening.

## 13. Residual risks, RETURN items, next independent approval

Residual risks:

1. The TS `requireNativeV8Schema()` is read-only and does not read the terminal; the enforcing
   authority is the Rust pre-Builder startup gate. Any future entry point that bypasses `run()`
   would bypass terminal validation.
2. A failure between permit claim and ledger persistence deliberately leaves a claimed file. It
   blocks startup and retry, but recovery requires an explicit operator diagnostic/cleanup step
   (not automated in R8).
3. Intermediate V4–V7 databases are rejected, not migrated; there is no resumable path from a
   partially migrated historical state.
4. `scripts/test_unified_r2b_recovery.py` remains un-runnable because its retained historical root
   lacks `SYNTHETIC_ONLY`; this is pre-existing and does not exercise V8.
5. Real Production V3 read-only preflight, backup creation, downtime plan, operator, and rollback
   have not been performed or authorized.

RETURN items:

- **RETURN-R8-TOOLING-01:** the literal §3.1 Python command cannot run under `-I`; decide whether
  to amend the command or accept the direct invocation. Until resolved, this batch is reported as
  `R8_CODE_BATCH_BLOCKED`.
- **RETURN-R8-AUDIT-01:** independent code review of the V8 native migration, startup gate, and
  durable terminal protocol has not yet occurred.

Next step: after RETURN-R8-TOOLING-01 is resolved and this batch is accepted, a **separate**
approval request is required for the real V3→V8 Production migration. It must attach the
independent review conclusion, V8 candidate executable/manifest hashes, the full V8 gate evidence,
isolated V3→V8 readback, a real Production V3 read-only preflight and hash, the backup path/hash/
device/inode and recovery plan, explicit downtime/operator/abort/rollback conditions, and separate
Owner authorization for migration, Production replacement, launch, and terminal publication.

This receipt does not claim that Production was migrated, recovered, or is launchable, and does not
authorize a real migration.
