# WP-04R2A Target Gate Call Graph

**Starting source:** `afef8b9d147f2ac4111136d9a5e4ac325756667b`
**Mode split:** Production paths use only fixed identity/path constants. A synthetic adapter changes the namespace only after validating an exact marker and canonical temporary root.

```text
Production CLI: scripts/production_v4_release_gate.py
  ├─ preflight (separate command)
  │   ├─ read exact candidate-approval + migration-authorization byte snapshots
  │   ├─ refuse missing / synthetic / wrong-domain authority before Production DB inspection
  │   ├─ inspect only fixed app, candidate, DB, backup and inventories
  │   ├─ validate fixed Bundle ID, executable, DB basename, V3→V4 contract
  │   └─ persist fixed-path release receipt; cannot issue permit or invoke native runner
  └─ migrate (separate command)
      ├─ reload exact authorization bytes and persisted release-receipt bytes
      ├─ revalidate current fixed-path candidate / DB / backup / inventory bindings
      ├─ refuse receipt/auth drift; no caller-supplied DB, SQL, or permit path
      ├─ gate internally issues one-time permit bound to receipt + authority byte hashes
      └─ launch only installed executable with a fixed internal migration role
          → native main dispatch
              → native authorization consumer claims fixed permit
              → validates exact receipt hash + Production domain + fixed object bindings
              → durably appends consumed authorization ledger
              → native-owned Migration 4 runner only

Synthetic adapter:
  preflight / migrate --synthetic-root <canonical temp root>
    → validate SYNTHETIC_ONLY marker and reject Production paths/artifacts
    → same authorization parser / receipt validation / permit issuer / consumer core
    → test candidate invokes consumer-only native role
    → stop after durable consumer claim (no Migration 4 in R2A)
```

## Invariants to prove

- Command names remain reachable while missing/wrong-domain authorization safely refuses.
- `preflight` never issues a permit or starts the native executable.
- `migrate` cannot proceed without a previously persisted, untampered receipt and fresh matching authority/object bindings.
- Permit output has one fixed internally selected path; no CLI accepts a permit or SQL path.
- Production mode derives identity and DB paths from constants; synthetic roots must be canonical children of the OS temporary directory and have an exact marker.
- Synthetic authorization, receipt, permit and consumer records carry `syntheticOnly=true`; Production consumer rejects that domain.
- Only the internal native executable role owns Migration 4. R2A's synthetic integration stops at actual permit consumption.
