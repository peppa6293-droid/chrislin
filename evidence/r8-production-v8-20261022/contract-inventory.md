# R8-01 Production Schema V8 contract inventory

Date: 2026-10-22
Scope: read-only inventory before code changes. No Production database, identity,
app bundle, or app-data directory was opened or modified.

Legend:
- **Change**: `yes` = R8 must change the contract; `no` = unchanged; `historical` = old V4
  content intentionally kept as a blocked/historical state and never treated as V8 authority.
- `TS` = TypeScript runtime, `RS` = Rust Production runtime, `PY` = Python release gate.

## 1. TypeScript schema authority

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `src/persistence/migrations.ts` | `CURRENT_SCHEMA_VERSION` | `8` | no | n/a |
| `src/persistence/migrations.ts` | `migrationV1`..`migrationV8` | Full TS schema, V8 is authoritative | no (V5–V8 SQL copied verbatim into `migrations/005.sql`..`008.sql`) | no |
| `src/persistence/migrations.ts` | `migrateDatabase(db, now, targetVersion)` | Applies `< target`, supports `SchemaMigrationBoundary`, rejects forward/differing authorities | **yes** — V1–V3 must honor `targetVersion`; default stays 8 | no |
| `migrations/003-bootstrap.sql`, `004.sql` | SQL fixtures | V3 bootstrap and V4 revision tables used by native migration | no | no |
| `migrations/005.sql`..`008.sql` | new SQL | V5–V8 native migration source, byte-for-byte semantics matching TS | **new** | no |

## 2. Rust Production schema authority

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `src-tauri/src/lib.rs` | `CURRENT_SCHEMA_VERSION` | `4` | **yes** → `8` | no |
| `src-tauri/src/lib.rs` | `native_migration4` | Exclusive single-step V3→V4 | **yes** → `native_migration8`, runs 004..008 in order | old name removed; old string remains only in historical docs/tests if any |
| `src-tauri/src/lib.rs` | `read_production_v4_readback` | Requires 4/4, rows `[1,2,3,4]`, one migration-4 row | **yes** → `read_production_v8_readback`, requires 8/8, rows `[1..8]`, no duplicate rows | no |
| `src-tauri/src/lib.rs` | `ProductionMigrationReadback.migration4_row_count` | Count of version 4 rows | **yes** → generic migration row uniqueness/readback | no |
| `src-tauri/src/lib.rs` | `ProductionCutoverTerminal.migration4_row_count` | V4-specific field | **yes** → generic `migration_row_count` + rows `[1..8]` | no |
| `src-tauri/src/lib.rs` | `make_production_terminal` / `validate_production_terminal` | `state=V4_VERIFIED`, target 4/4 | **yes** → `state=V8_VERIFIED`, target 8/8, source 3/3 | no |
| `src-tauri/src/lib.rs` | `run_production_migration_at` | Returns `V4_MIGRATION_VERIFIED_NATIVE` | **yes** → `V8_MIGRATION_VERIFIED_NATIVE` | no |
| `src-tauri/src/lib.rs` | `run_production_migration_command` | Accepts only `--pfc-internal-v4-migrate` | **yes** → `--pfc-internal-v8-migrate` | no |
| `src-tauri/src/lib.rs` | `run()` | Production startup gate; rejects schema `< CURRENT` and uninitialized DB | **yes** — V8 terminal required before business I/O; reject every schema except 8 for ordinary startup | no |
| `src-tauri/src/lib.rs` | `DatabaseState::begin_schema_migration` / `end_schema_migration` | Legacy TS boundary only allows V3→4 | **yes** → no TS production DDL path; boundary can only be used by isolated runtimes | no |
| `src-tauri/src/lib.rs` | `ensure_supported_schema` | Rejects `> CURRENT`, mismatched authorities | no (CURRENT becomes 8) | no |
| `src-tauri/src/lib.rs` | `validate_runtime_compatibility_manifest` | Format 1, generation 4, min 1..3, max 4 | **yes** → format 2, generation 8, min=max=8, migration source 3 | no |
| `src-tauri/src/lib.rs` | `consume_production_migration_authorization_at` | V4 permit semantics | **yes** → V8 permit names/status/bindings | no |
| `src-tauri/src/production_cutover_state.rs` | `TERMINAL_NAME`, `CLAIMED_AUTHORIZATION_PREFIX`, `TEMP_PREFIX` | `production-v4-*` | **yes** → `production-v8-*`; V4 names recognized only as blockers | **yes** (block-only recognition) |
| `src-tauri/src/cutover_startup.rs` | terminal/claimed file detection | Any V4 terminal or claimed permit blocks | **yes** — recognize V4 and V8; V4 never authorizes | **yes** |

## 3. TypeScript Production boundary

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `src/runtime/tauri-bootstrap.ts` | `bootstrapTauriApplication()` | Opens DB and calls `migrateDatabase` unconditionally | **yes** — never migrates under Production identity | no |
| `src/runtime/tauri-bootstrap.ts` | `createTauriApplicationServices()` | Same unconditional TS migration | **yes** — identity-aware; Production must not run TS DDL | no |
| `src/persistence/tauri-database.ts` | `TauriSqlDatabase` | SQL bridge and schema-migration boundary invokes | **yes** — add runtime identity query; boundary remains for Smoke/Acceptance only | no |
| `src/application/v4-acceptance-sandbox-service.ts` | `migrateDatabase` calls | Isolated acceptance sandbox | no (isolated identity only) | no |

## 4. Manifest and fixtures

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `src-tauri/runtime-compatibility.json` | whole file | Format 1/generation 4/min 1/max 4 | **yes** → format 2/generation 8/min 8/max 8/migrationSource 3 | no |
| `src-tauri/tauri.conf.json` | identifier/resources | Production identity | no | no |
| `src-tauri/tauri.smoke.conf.json` | identifier | Smoke identity | no | no |
| `src-tauri/tauri.v4acceptance.conf.json` | identifier | Acceptance identity | no | no |
| `src-tauri/quiescence-runtime-compatibility.json` | manifest | Synthetic quiescence fixture, not Production authority | no (historical synthetic) | **yes** (fixture only) |
| Rust `production_terminal_tests::Fixture` | V4 manifest/terminal fixtures | V4 synthetic cutover | **yes** → V8 fixtures; V4 state cases retained as block-only tests | **yes** |

## 5. Python release gates

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `scripts/production_v4_release_gate.py` | whole module | Historical V4 gate | no (kept as historical gate) | **yes** |
| `scripts/test_production_v4_release_gate.py` | whole module | Historical V4 gate tests | no | **yes** |
| `scripts/production_v8_release_gate.py` | new module | V8 preflight/migrate gate, 37 checks, synthetic-only | **new** | no |
| `scripts/test_production_v8_release_gate.py` | new module | V8 gate refusal matrix and isolated fixtures | **new** | no |
| `scripts/unified_r2b_recovery.py`, `scripts/test_unified_r2b_recovery.py` | V4 synthetic recovery | Historical quiescence recovery | no | **yes** |
| `scripts/test_production_gate_wiring_integration.py` | wiring | V4 gate wiring | no | **yes** |

## 6. Startup / state plumbing

| File | Symbol | Current meaning | R8 change | V4 historical |
|---|---|---|---|---|
| `src-tauri/src/cutover_startup.rs` | `RECORDS`, `StartupDecision` | Blocks any pending/terminal record | **yes** — V8 terminal accepted only when fully valid; V4 record blocks | **yes** |
| `src-tauri/src/production_cutover_state.rs` | `write_terminal` | Durable create-only terminal protocol | no protocol change; names become V8 | no |
| `src-tauri/src/startup_exclusion.rs` | lock/symlink safety | Migration/startup exclusion | no | no |
| `src-tauri/src/quiescence.rs` | synthetic V4 flows | Historical isolated verification | no | **yes** |

## 7. Tests that must keep passing

- `tests/future-schema-guard.test.ts` (V8 authority, V3→V8, forward guard)
- `tests/smoke-identity.test.ts` (identity isolation)
- `tests/v4-foundation.test.ts`, `tests/v4-acceptance-sandbox.test.ts` (isolated V4 foundation, TS migrations)
- Rust `production_cutover_state` / `cutover_startup` tests (V4 historical block recognition)
- `scripts/test_production_v4_release_gate.py`, `scripts/test_unified_r2b_recovery.py`
- New R8 tests listed in the order.

## 8. BLOCKED check

No item requires modifying a real Production path, the real Production database, the
installed `/Applications/Personal Finance Console.app`, or real Production app-data.
All schema/terminal/permit work is confined to code, tests, isolated fixtures, and
temporary directories. **R8-01 completed without BLOCKED.**
