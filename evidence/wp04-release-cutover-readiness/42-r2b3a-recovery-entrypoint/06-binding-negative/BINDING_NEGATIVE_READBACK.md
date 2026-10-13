# Binding-negative readback

`PYTHONPATH=scripts python3 -m unittest test_unified_r2b_recovery -v` passed after implementation changes. The test cases reject wrong receipt, claimed permit, consumed ledger, candidate, manifest, DB identity/hash, backup, migration authorization, recovery authorization bytes/scope/expiry and domain. A JSON-semantics-equivalent but byte-different receipt and recovery authorization are separately refused. Production domain refusal occurs before root inspection.

The canonical success root was not mutated. Negative disposition states use in-memory controlled snapshots or an intentionally malformed temporary JSON fixture; they do not alter the canonical success root.
