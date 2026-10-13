# Read-only guarantees

- Synthetic root marker and fixed in-root object paths are required; Production domain exits REFUSE before root access.
- File reads reject symlinks, hard-linked files, unstable identity, and over-limit inputs; exact bytes are hashed.
- SQLite is opened only after synthetic-root validation with `mode=ro&immutable=1`.
- Candidate executables, manifests, database, backup, receipt, permit, ledger, authorization and lineage objects are hashed and identity-checked again after disposition.
- No permit claim/creation, Migration 4, restore, V4→V3, ledger deletion, terminal replacement, ACTIVE overwrite, DB repair or authorization mutation exists in this entrypoint.
- Canonical success evidence contains a before/after object map and a `diagnosticMutationCount` of zero.
