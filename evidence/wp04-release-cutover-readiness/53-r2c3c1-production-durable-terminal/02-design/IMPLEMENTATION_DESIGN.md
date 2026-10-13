# WP-04R2C3C1 Implementation Design

1. Keep the existing one-time authorization and consumed-ledger JSON contracts unchanged. The consumed ledger is durably persisted before the database is opened; a claimed authorization artifact covers the prior claim-to-ledger interval. Startup must inspect both.
2. Add exactly one fixed-name `production-v4-cutover-terminal.json` in the existing canonical Production authority directory. It is a Production-only terminal, never a synthetic S-state.
3. Bind the terminal to the exact consumed authorization ID/nonce and ledger digest; authorization bytes and authorization hash; release receipt; candidate executable and compatibility manifest; V3/V4 schema evidence; database canonical path/device/inode/post-migration digest; and validated backup path/digest.
4. Success terminal creation is create-only, owner-only, no-follow, single-link, file-fsynced, parent-directory-fsynced, and exact-byte read back. It happens after COMMIT, integrity/FK/schema/sidecar verification, while the existing exclusive `maintenance.lock` guard remains in scope.
5. Before Builder, distinguish:
   - no claim/ledger/terminal plus a consistent schema <= V3: existing never-started path remains eligible for the existing Production V3 gate;
   - any claim, consumed ledger without terminal, malformed/stale/corrupt terminal, or V4 without a valid terminal: refuse;
   - valid bound V4 terminal plus exact V4 DB/readback: allow.
6. Do not run recovery, restore, retry M4, change Migration 4 SQL, alter permit/ledger contracts, or touch product/model behavior.
7. Use private test callbacks at terminal persistence boundaries for deterministic synthetic tests. The Production entrypoint passes no externally controlled failpoint.
