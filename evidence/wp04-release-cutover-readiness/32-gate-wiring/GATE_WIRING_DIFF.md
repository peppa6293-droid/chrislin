# Gate Wiring Diff

Implementation commit: `41d3c0d6e46dd870a1c8ee266f006099356f1ccb`
Starting source: `afef8b9d147f2ac4111136d9a5e4ac325756667b`

- `scripts/production_v4_release_gate.py`: restored distinct reachable `preflight` and `migrate`; added exact-byte authorization snapshots, fixed Production identity/path, persisted receipt binding, internally issued one-time permit, and canonical marker-bound synthetic adapter through the same gate core. Removed the CLI rehearsal bypass.
- `src-tauri/src/lib.rs`: wired the fixed internal Production role to the formal native authorization consumer and native Migration 4 owner. Added a consumer-only synthetic role that stops after durable permit claim and ledger write.
- `src-tauri/src/bin/quiescence_fixture.rs`: routed the synthetic integration role into that same Rust authorization consumer.
- Tests: added a real CLI-to-Rust synthetic integration proof and expanded refusal/boundary regressions.

No Production identity, application, database, receipt, authorization, permit, backup, or migration was used or created.
