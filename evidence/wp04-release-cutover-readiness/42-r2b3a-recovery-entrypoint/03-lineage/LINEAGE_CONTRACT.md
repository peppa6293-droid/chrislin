# Bound unified R2B lineage

`SYNTHETIC_ONLY` → `release-receipt.json` → `gate-permit.claimed/permit.json` → `consumed-ledger.json` → migration authorization / candidate approval → candidate executable and runtime manifest → DB and backup → maintenance lease / C3 managed receipt → S0 candidate state and S1–S8 hash-linked managed states → S4–S9 event stream → `verified-handoff.json` or a typed, exact-chain-bound unresolved recovery state/terminal.

The authorization pin binds a canonical digest of terminal plus managed S-state / event lineage. Each listed file is reopened and hashed after classification; object identity and byte hash must remain unchanged. No entrypoint action consumes, repairs, removes or overwrites a chain object.
