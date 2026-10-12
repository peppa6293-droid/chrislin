# Current WP-04 Formal Gate Call Graph

**Static source snapshot:** `afef8b9d147f2ac4111136d9a5e4ac325756667b`
**Scope:** source inspection only. No Production app or SQLite database was opened or queried.

## Current call graph

```text
Operator
  → scripts/production_v4_release_gate.py::main (argparse commands)
      ├─ preflight
      │   → run_gate("preflight", candidate_approval, migration_authorization, receipt)
      │       → _load_json(migration_authorization) and status check
      │       → collect_real_facts(...)
      │           → _load_json(candidate_approval)
      │           → inventory_production_apps / inventory_production_processes
      │           → read_bundle(APP_PATH) / inspect_database(DATABASE_PATH)
      │           → inspect authorization-bound backup
      │       → make_release_receipt → validate_preflight
      │       → _persist_receipt(create=True)
      │       → [CONNECTED; fixed Production facts are read after auth status check]
      ├─ migrate
      │   → main raises GateBlocked("...legacy migration/retirement entry is disabled...")
      │   → [DISABLED; does not call run_gate("migrate")]
      ├─ retire
      │   → same unconditional GateBlocked in main
      │   → [DISABLED]
      └─ rehearse-synthetic
          → create_synthetic_rehearsal(fixture_root)
              → constructs synthetic app/DB/backup and in-memory facts
              → make_release_receipt(synthetic_fixture_root=root)
              → _persist_receipt
              → write_migration_permit
              → [TEST_ONLY / HELPER_ONLY; bypasses formal command core and does not run native consumer]

Low-level legacy helper path (not reachable from supported CLI migrate):
  run_gate("migrate", ...)
    → _require_legacy_fixture_path(APP_DATA)
    → [REFUSES canonical Production app-data; legacy fixture-only guard]
    → collect_real_facts → make_release_receipt → permit → ordinary executable launch
    → [not a supported native migration route; no internal migrate argument or native consumer handoff]

Formal native app path:
  src-tauri/src/main.rs::main → personal_finance_console_lib::run
    → tauri::Builder::setup
        → production identity / fixed installed app / manifest checks
        → production_schema_version_from_path (read-only schema inspection)
        → V3 refusal before ordinary Connection::open
        → migration_permitted = false
        → [does not call consume_production_migration_authorization]
    → invoke_handler(database_schema_migration_begin/end, database_execute, ...)
        → TS bootstrap can request the migration window only after startup
        → [V3 never reaches this route; begin/end is not the gate's native owner]

Existing authorization consumer:
  src-tauri/src/lib.rs::consume_production_migration_authorization
    → consume_production_migration_authorization_at
        → atomically claims the fixed authorization pathname
        → validates candidate / manifest / DB / backup / schema bindings
        → persist_consumed_authorization
        → [HELPER_ONLY; production setup has no caller; invoked by Rust tests only]

Existing native Migration 4 implementation:
  src-tauri/src/quiescence.rs::run_integrated / run_consumed
    → validates its synthetic permit / lease / namespace contract
    → owns rusqlite Migration 4 transaction and durable outcomes
    → [TEST_ONLY; root_checked requires canonical temp root + synthetic marker;
       exposed through fixture binaries, not production lib.rs]
```

## Node status

| Node | Status | Source evidence |
|---|---|---|
| Production `preflight` command | CONNECTED, but performs real inventory/DB inspection after its authorization status check | `scripts/production_v4_release_gate.py::main`, `run_gate`, `collect_real_facts` |
| Production `migrate` command | DISABLED | `main` rejects `migrate` before `run_gate` |
| Authorization bytes/parser | CONNECTED only to the existing JSON loader; exact-byte lifecycle is not propagated through formal gate receipt to consumer | `_load_json`, `run_gate`; Rust consumer claims/parses a file but has no command caller |
| Persistent release receipt | CONNECTED for preflight; migrate does not reload or validate it | `_persist_receipt`, `make_release_receipt` |
| Gate permit issuer | HELPER_ONLY; fixture-path restricted; synthetic rehearsal can call it directly | `write_migration_permit`, `create_synthetic_rehearsal` |
| Native authorization consumer | HELPER_ONLY; no supported production setup/invoke caller | `consume_production_migration_authorization[_at]`, Rust tests |
| Native Migration 4 owner | TEST_ONLY synthetic runner | `quiescence.rs::run_integrated` / `run_consumed`; synthetic root marker required |
| Receipt/permit → consumer binding | MISSING_EDGE | No formal migrate command reaches permit issuer, native claim, and native migration runner as one validated chain |

## Actual missing edge

The primary missing edge is `scripts/production_v4_release_gate.py::main(migrate)` → persisted receipt revalidation → gate-owned one-time permit → an internal native migration command that claims the permit through a wired consumer and owns Migration 4. A second missing edge is sharing the same validated gate core with a strictly isolated synthetic namespace; `rehearse-synthetic` currently manufactures fixture facts and permit directly rather than exercising `preflight` and `migrate` core operations.

This graph records current behavior only. Target design and implementation evidence are separate files in this directory.
