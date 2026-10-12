# WP-04R2A Formal Gate Wiring Report

## Result

**`WP04R2A_GATE_WIRING_READY`** — The formal Production V3→V4 entry path is implemented and remains fail-closed by default. This report covers gate wiring only; it does not claim overall WP04 readiness or Production cutover acceptance.

- Starting HEAD: `afef8b9d147f2ac4111136d9a5e4ac325756667b`
- Gate integration commit: `41d3c0d6e46dd870a1c8ee266f006099356f1ccb`
- Final report commit: see `FINAL_READBACK.md` after report commit.

## Supported entrypoints

**Preflight:**

```text
python3 scripts/production_v4_release_gate.py preflight \
  --candidate-approval <candidate-approval.json> \
  --migration-authorization <migration-authorization.json>
```

Preflight checks exact source bytes and status for both authorization artifacts, then validates the fixed Production candidate/install identity, inventory, V3 database, and backup. It creates the fixed-path release receipt. It cannot issue a permit or launch a native consumer.

**Migrate:**

```text
python3 scripts/production_v4_release_gate.py migrate \
  --candidate-approval <candidate-approval.json> \
  --migration-authorization <migration-authorization.json>
```

Migrate reloads authorization and the persisted receipt, revalidates current candidate/database/backup bindings, refuses any drift, creates the one-time permit internally at the fixed Production app-data path, and launches only the bound candidate's fixed internal native role. No database, SQL, bundle identity, target schema, receipt override, or permit injection can redirect the Production target.

## Bound native path

`src-tauri/src/lib.rs::run_production_migration_command` is the only Production migration command owner. It validates fixed paths and runtime manifest, calls `consume_production_migration_authorization`, checks the permit against the exact persisted receipt hash and Production domain, atomically claims the permit, and persists the consumed authorization ledger. The native runner then owns Migration 4. The regular Tauri setup remains fail-closed and does not allow business access to V3.

The synthetic adapter requires an exact `SYNTHETIC_ONLY` marker under a canonical OS temporary child and `syntheticOnly=true` authorization artifacts. It reuses the same formal gate core, receipt and permit bindings, and native consumer. The integration test stops after consumer claim and durable ledger write; Migration 4 is not run.

## Verification

- Production `preflight` and `migrate` with absent authorization both returned `REFUSE_NO_AUTHORIZATION` before candidate, app, or database inspection.
- Five CLI-to-Rust integration tests passed. The positive synthetic path consumed one permit and wrote one ledger entry; the fixture remained schema V3.
- 47 gate, entry-boundary, and native integration tests passed.
- `npm run typecheck`, `npm run lint`, `npm run test:product`, `npm run test:wp03-preview`, `npm run test:release-gate`, `npm run build`, Rust default tests (37), WP03 preview tests (40), and quiescence/native targeted tests (33) passed.
- Lint emitted existing CSS style warnings; Rust emitted existing non-failing warnings.

## Boundaries and remaining work

No Production app or database was opened, read, launched, installed, or modified. No real authorization, release receipt, backup, or permit was created. No Migration 4, restore, or blocker closure occurred. WP-03 acceptance and Financial Model source were preserved; WP-02 was untouched.

This closes the WP-04R2A wiring target only. Renderer attribution and complete R2B synthetic cutover/migration rehearsal remain outside this task. Stop here; Planning owns the next separately scoped task.

## Evidence

- Evidence root: `evidence/wp04-release-cutover-readiness/32-gate-wiring/`
- Supported entrypoint map: `evidence/wp04-release-cutover-readiness/03-entrypoint-map/CURRENT_SUPPORTED_ENTRYPOINT_MAP.md`
- Current project progress: `WP04_PROGRESS.md`
- Main report append: `WP04_PRODUCTION_RELEASE_CUTOVER_READINESS_REPORT.md`
