# WP-04R2A Final Readback

- Starting HEAD: `afef8b9d147f2ac4111136d9a5e4ac325756667b`
- Gate integration commit: `41d3c0d6e46dd870a1c8ee266f006099356f1ccb`
- Current report commit: pending report commit.
- Formal Production CLI: `python3 scripts/production_v4_release_gate.py preflight|migrate --candidate-approval <file> --migration-authorization <file>`; paths for app, database, receipt, permit, and SQL are fixed by code.
- Missing authorization: both commands returned `BLOCKED` with `REFUSE_NO_AUTHORIZATION`; no receipt was created and no Production database facts were collected.
- Synthetic integration: actual Rust consumer claimed the gate-issued permit and persisted one ledger entry; fixture DB remained schema V3 and byte-unmigrated.
- Domain split: synthetic artifacts carry `syntheticOnly=true`; Production mode rejects those artifacts.
- Migration owner: native Production internal role/native runner only. R2A did not execute Migration 4.
- Source tree after gate commit: clean for tracked source.
- Production App/DB, real authorization/receipt/permit/backup, WP-03 product source, and WP-02 were untouched.
