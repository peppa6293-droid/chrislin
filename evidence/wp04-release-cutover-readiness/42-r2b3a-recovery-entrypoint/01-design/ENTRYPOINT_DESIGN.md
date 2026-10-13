# Unified R2B Recovery Diagnostic

The existing `scripts/production_v4_release_gate.py` CLI now owns `recover-diagnostic`, dispatching into `scripts/unified_r2b_recovery.py`. The implementation validates the already-consumed unified R2B chain without creating a second Gate or invoking the older component `recover-integrated` contract.

The diagnostic admits only an explicitly marked canonical unified synthetic root. Production is refused before its root is read. Receipt, claimed permit, consumed ledger, original migration authorization, candidate executable/manifest, DB, backup, C3 managed receipt, S0/S1 exact-byte chain, S4-S9 stream, native lease and terminal are bound by exact bytes plus filesystem identity. The database is inspected only with read-only/immutable SQLite options after the synthetic marker and root contract pass.

The supplied unified recovery authorization is an external, ephemeral or separately managed synthetic object. Its exact bytes require an independently supplied SHA-256 pin and it binds the original migration authorization, receipt, permit, ledger, candidate, manifest, DB/backup identities and hashes, terminal/S-state lineage, scope, expiry, ID, and synthetic domain. This diagnostic neither creates a Production recovery authorization nor changes chain objects.

Command:

```text
python3 scripts/production_v4_release_gate.py recover-diagnostic --domain UNIFIED_R2B_SYNTHETIC --root <canonical-synthetic-root> --recovery-authorization <external-auth.json> --authorization-sha256 <exact-auth-sha256>
```

Every disposition is non-mutating. Consumed permits are never reusable; automatic Migration 4 rerun and restore are disabled. A `FAILED_V3_CONFIRMED` state only permits a future rerun/restore after separate fresh authorization; this command never performs either action.
