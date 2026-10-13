# Regression scope

Executed for this implementation: TypeScript typecheck, lint, product test suite, WP03 preview packaging tests, release-gate tests, R2A Gate-to-Rust wiring, R2B1A Gate-owned C3, R2B1B native handoff, Rust default / quiescence-fixture / quiescence-Tauri bins, the forward Gate-to-native S0–S10 Migration 4 exactly-once scenario, and the prescribed 16-case recovery component matrix.

The R2B1B test initially ran without its documented `APPLE_SIGNING_IDENTITY` prerequisite and failed before fixture setup; it was rerun with the existing valid local Apple Development identity and passed. Both attempts are retained. The recovery component matrix uses its own legacy component contract and is reported as component-only regression. It does not bind to the canonical R2B Gate chain and is not full-chain Recovery Matrix / Q closure.

No final candidate build, new acceptance candidate, full-chain recovery scenarios, Q closure, renderer or Production action was performed.
