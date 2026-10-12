# WP-04R2B1B Native Authority Call Graph — Starting HEAD Reconstruction

**Starting HEAD:** `4606607613f01d053abbb1108d93fccba4fb372c`
**Evidence timing:** This graph was reconstructed after implementation from the exact starting-HEAD source and the earlier WP-04 Gate call graph. It was not saved before this turn's edits; the required chronology is therefore not established.
**Scope:** Synthetic authority handoff only. No Production app or database was opened.

```text
scripts/production_v4_release_gate.py::main
  → run_gate("migrate", ...)
  → write_migration_permit(..., unified_r2b=True)
  → fixed synthetic root/gate-permit.json
  → installed fixture executable --pfc-r2b1-unified-synthetic <root>
  → [MISSING_EDGE] quiescence_fixture.rs had no unified argument dispatch
  → [MISSING_EDGE] no Rust consumer accepted the formal Gate permit for this mode
  → [SECOND_AUTHORITY] R2B1A C3 producer remained a separate authority chain
  → [DISK_REWRITE] standalone quiescence run_integrated parsed legacy permit.json,
                  claimed permit.claimed.json and wrote consumed.json
  → [TEST_ONLY] run_integrated(...) / run_consumed(...) owned its own permit contract;
                no validated Gate authority was handed to the S4 runner
```

## Node classification at starting HEAD

| Edge / node | Classification | Starting-source evidence |
|---|---|---|
| Formal Gate `main` → `run_gate("migrate")` | CONNECTED | `scripts/production_v4_release_gate.py::main`, `run_gate` |
| Gate → fixed synthetic `gate-permit.json` | CONNECTED | `write_migration_permit(..., unified_r2b=True)` |
| Gate → fixture argument `--pfc-r2b1-unified-synthetic` | CONNECTED | `run_gate` child command construction |
| Fixture entry → unified Rust consumer | MISSING_EDGE | `src-tauri/src/bin/quiescence_fixture.rs::main` had no dispatch for that argument |
| Gate permit → single native authority consumer | MISSING_EDGE | no unified consumer call/contract existed |
| C3 and formal Gate use one authorization chain | SECOND_AUTHORITY | C3 Gate-owned permit mode and formal Gate permit remained separate |
| Legacy standalone permit claim/consumed record | DISK_REWRITE | `quiescence.rs::run` / `run_integrated` rename and persist legacy permit records |
| Validated authority → native S4 runner | MISSING_EDGE | no typed in-memory Gate authority or S4 handoff existed |
| Legacy quiescence runner | TEST_ONLY | synthetic-root and marker checks in `run_integrated` |
| Production-supported unified chain | MISSING_EDGE | no production setup consumer-to-runner path existed |

Historical cross-check: `evidence/wp04-release-cutover-readiness/32-gate-wiring/CURRENT_GATE_CALL_GRAPH.md` describes an earlier source snapshot; it is supporting history, not a substitute for the exact starting-HEAD inspection above.
