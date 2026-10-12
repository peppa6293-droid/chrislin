# R5 same-bundle restart — partial

- Normal Quit, then relaunch by exact same absolute R5 app path.
- Same Bundle ID `com.personalfinance.console.wp03preview` and executable SHA-256 `ecc46453d2aea39cd2f6232a38685827316f6c09e9b1f45e6fb6366cae182313`.
- After restart Home returned to system date October 2026 (2026-10-12), not the session-only November preview date.
- Home retained the saved variable expense `68.50` and displayed October plan / due 800.
- Normal Quit again. Closed DB hash matches the pre-restart hash exactly; no business DB bytes changed across restart.
- Partial only: Stable, Planning, Actual, Cash, Assets, Debts, Safety and History pages were not all reread after restart; this does not satisfy M in full.
