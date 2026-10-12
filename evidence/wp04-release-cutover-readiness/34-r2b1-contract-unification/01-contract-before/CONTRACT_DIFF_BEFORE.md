# Contract Difference Before WP-04R2B1

Baseline HEAD: `164cd813e466e73db87acb556312d7543f6c25b1` (the commits after R2B are documentation/readback only; runtime source matches `d12d09f0e0eadad3b2192fcbf9b54437b09bd18a`).

| Contract | Formal R2A Gate synthetic mode | Managed/quiescence mode | Conflict |
|---|---|---|---|
| Root marker | `PFC_WP04R2A_GATE_SYNTHETIC_V1\n` | Python and Rust expect `PFC_QUIESCENCE_SYNTHETIC_V1\n` | Same `SYNTHETIC_ONLY` file cannot satisfy both. |
| Candidate identity | Production bundle ID `com.personalfinance.console`; app path `<root>/Applications/Personal Finance Console.app`; executable parser fixes `personal-finance-console`. | `org.pfc.quiescence.integration`; C3 installs at `<root>/managed/install/Installed.app`; executable/manifest identity is read from that bundle. | Gate cannot bind the managed installed candidate. |
| DB identity | `<root>/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`. | `<root>/personal-finance-console.sqlite3` (official bootstrap V3 fixture). | Different canonical DB object/path. |
| C3 authorization owner | Formal Gate expects a separate migration authorization input during preflight. | `prepare_managed()` writes `authorization.json` at the end of C3. | C3 creates migration authority before C4/C6. |
| C3 permit owner | Gate `migrate` issues a permit after receipt verification. | `prepare_managed()` also writes `permit.json` (V2 quiescence contract). | Two permits and two authority formats. |
| C6 receipt owner | `production_v4_release_gate.py preflight` persists the formal receipt. | Quiescence runner reads managed/permit receipts but does not consume the Gate receipt. | No shared exact receipt binding at native runner. |
| C7 permit owner | `production_v4_release_gate.py migrate` writes its permit and launches the native consumer. | Standalone `run_integrated()` loads/claims `permit.json` and writes `consumed.json`. | Gate permit is not accepted by runner; standalone permit creates a second authority record. |
| Native consumer input | Formal gate permit JSON (receipt fields plus one-time nonce/timestamps). Synthetic consumer only consumes and records a ledger, then reports `AUTHORIZATION_CONSUMED_NATIVE_MIGRATION_PENDING`. | Strict V2 `Permit` JSON includes session, DB/backup hashes, executable/manifest, recovery and lease bindings. | Incompatible JSON contracts; the Gate consumer does not enter S4. |
| Migration runner | R2A native consumer stops before SQLite migration. | `quiescence::run_integrated()` owns the DB connection and S0–S10; it requires its own V2 permit and advances past S4. | No in-memory validated Gate authority entry point with an S4-only stop. |
| Ledger owner | Rust formal native consumer writes the consumed authorization ledger. | Quiescence runner writes a separate consumed permit/state chain. | Unified mode must retain only the formal Gate authority ledger. |

## Intended R2B1 change boundary

Add an explicit `UNIFIED_R2B_GATE_OWNED` managed mode. It uses one new exact marker, one fixed synthetic Bundle ID and root DB path. C3 records managed isolation and stops without migration authorization or permit. Gate preflight/migrate remains the sole receipt and permit owner. Rust consumes the exact Gate permit bytes once, writes the existing formal ledger once, then passes a typed in-memory validated authority to a native runner entry point that opens one read/write/no-create SQLite connection and stops at `CONNECTION_PREPARED` before `BEGIN EXCLUSIVE`.

Legacy standalone quiescence mode and the Production path remain separate and fail closed. No arbitrary bundle ID or DB path option is introduced.
