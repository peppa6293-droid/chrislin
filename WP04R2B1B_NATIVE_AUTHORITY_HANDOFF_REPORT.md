# WP-04R2B1B — Native Authority Handoff

**Final Status:** `WP04R2B1B_NATIVE_AUTHORITY_HANDOFF_READY`
**Scope:** Synthetic-only formal Gate → Rust consumer → validated native S4 runner. Stopped at S4.
**Starting HEAD:** `4606607613f01d053abbb1108d93fccba4fb372c`
**Implementation commit:** `24ff2365e36d4471873b2090128b11725244825a`
**Production:** Not accessed or changed. Full WP04R2B remains not PASS and must be rerun separately.

## Result

The formal `migrate` CLI issued one permit, the compiled Rust fixture consumed the exact persisted bytes, atomically claimed them, durably wrote one consumed-authority ledger, and handed a private validated authority value to the native runner. The runner opened the synthetic V3 database without CREATE, prepared the S4 connection, closed it without beginning an exclusive transaction, and persisted the stop receipt.

The sole permit hash remained `1d6d5e494d2f562507dc455627671cf11266975ea2843dc03dd21d744ec98125` through Gate, consumer input, claimed artifact, ledger, and runner. Release receipt hash remained `83bb49a75a6e23a99207281c54eb329201215a079fb2ec58f3bceb78a7e87302`; migration authorization hash remained `32ecd3363c41a3db248ad9164cb95274b71247737d73c93e4f70c83a2c90cb05`. The synthetic DB remained byte-identical at SHA-256 `5198b678dc31581978b82a35ba271d202fb6c40d9e841740bdd9902983de1f0b`, schema version 3, migration rows `[1,2,3]`.

## Acceptance fields

| Requirement | Result | Evidence |
|---|---|---|
| Formal Gate is the sole permit issuer; C3 permit count 0; formal permit count 1 | PASS | `05-positive-s4/gate-to-s4-result.json`, `03-ledger/consumed-ledger.json` |
| Exact permit bytes; no translation/rewrite; hashes continuous | PASS | `06-continuity/permit-continuity.json` |
| Atomic claim and exactly one durable consumed ledger | PASS | `07-replay/results.json`, `03-ledger/consumed-ledger.json` |
| Validated native authority; runner bound to it; raw permit bypass refused | PASS | `02-consumer/native-consumer-result.json`, `04-runner-authority/s4-stop-receipt.json`, negative tests |
| Formal CLI → compiled Rust consumer → native runner | PASS | `05-positive-s4/gate-to-s4-result.json` |
| Highest state S4; no `BEGIN EXCLUSIVE`; no Migration 4 | PASS | `05-positive-s4/s4-stop.json` |
| Replay, two-consumer race, exact-byte mutation, receipt/auth/candidate/manifest/DB/backup drift | PASS | `07-replay/results.json`, `08-drift-negative/results.json` |
| Domain separation, expiry, identity, marker and arbitrary-root rejection | PASS | `09-domain-negative/results.json`, `08-drift-negative/results.json` |
| Product, Gate, native and recovery regressions | PASS | `10-regression/summary.json`; recovery component matrix 16/16 |

Regression evidence records passing typecheck, lint, product tests, WP-03 preview tests, release-gate tests, build, Python Gate/C3/R2A/quiescence suites, native handoff tests (16), and complete Rust test suites under default, fixture, and Tauri features. Recovery component matrix passed 16/16. The source implementation commit contains only the five scoped implementation/test files.

## Evidence and limits

Evidence root: `evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff/`.

The required pre-edit call graph file was not saved before implementation. `01-before/NATIVE_AUTHORITY_CALL_GRAPH_BEFORE.md` reconstructs the starting graph from the exact intake commit and the prior Gate graph, and explicitly records this chronology gap. It is not contemporaneous pre-edit evidence.

This pass does not establish the full WP04R2B cutover, Production support/readiness, Product acceptance, renderer behavior, S5, or migration correctness. No Production application/database, real authorization, receipt, permit, or backup was touched or created. WP-02 and Financial Model V1.0 were not touched. WP-03 acceptance history remains preserved.

## Next action and stop

`WP04R2B1` is now `WP04R2B1_SYNTHETIC_CONTRACT_UNIFIED_READY`. The full `WP04R2B` remains not PASS. Stop here; Planning may issue a separate full synthetic cutover rerun. Do not continue to S5, Migration 4, renderer/final candidate, Production, or audit under this work item.
