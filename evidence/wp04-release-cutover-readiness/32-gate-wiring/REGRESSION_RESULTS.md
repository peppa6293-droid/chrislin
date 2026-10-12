# WP-04R2A Regression Results

All commands completed with exit code 0.

| Scope | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS (existing style warnings only) |
| Product tests | `npm run test:product` | PASS |
| WP03 isolation/packaging | `npm run test:wp03-preview` | PASS |
| Release gate | `npm run test:release-gate` | PASS, 40 tests |
| Gate entry boundary | `python3 -m unittest scripts.test_quiescence_entry_boundary -v` | PASS, 2 tests |
| Gate + entry + native integration | `python3 -m unittest scripts.test_production_v4_release_gate scripts.test_quiescence_entry_boundary scripts.test_production_gate_wiring_integration -v` | PASS, 47 tests |
| Rust default | `cargo test --manifest-path src-tauri/Cargo.toml` | PASS, 37 tests |
| Rust WP03 preview | `cargo test --manifest-path src-tauri/Cargo.toml --features wp03-preview` | PASS, 40 tests |
| Native/quiescence targeted | `cargo test --manifest-path src-tauri/Cargo.toml --features quiescence-fixture --bin quiescence-fixture --bin quiescence-old-runtime` | PASS, 33 fixture tests |
| Build | `npm run build` | PASS |
| Integration | `scripts.test_production_gate_wiring_integration` | PASS, 5 tests; reached actual Rust consumer and stopped before Migration 4 |

The lint command emitted existing CSS descending-specificity warnings. Rust builds emitted existing unused-import/dead-code/function-cast warnings. Neither caused a failing command. No full renderer, C0-C10/S0-S10, final candidate build, or Production operation was run.
