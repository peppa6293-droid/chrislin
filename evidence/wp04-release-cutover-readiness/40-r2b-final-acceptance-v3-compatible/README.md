# WP-04R2B V3-Compatible Final Acceptance Evidence

- Evidence directories at this root are the first fresh-root attempt. It reached C6 but C7 stopped before M4 because its C5 backup path did not match the frozen native contract (`<synthetic-root>/backup.sqlite3`). The attempt and its unconsumed Gate permit are preserved as history and are not resumed.
- `attempt-02/` is a second fresh-root rerun after that evidence. It completed C0–C10 and S0–S10, Migration 4 exactly once, C9 readback, business preservation, V4 Planning compatibility, and regressions. The final overall status remains blocked only because the current-source recovery cases have not been bound to this full Gate-chain artifact; the 16-case standalone recovery matrix is retained as component evidence and is not promoted to full-chain recovery acceptance.
- Both roots are synthetic temporary roots. Production app/database and real authorization/backup/permit were not touched.
