# WP-04R2C3A Intake

- Starting repository HEAD: `266c55d77ee4ca1cee5f6ef40300c9c637c83664`.
- Prior frozen runtime source reference: `c3da2f73c03b681957b4334751b7933d102caad1`.
- Prior candidate SHA `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf` is reclassified as `R2C_PRE_STARTUP_EXCLUSION_BASELINE`.
- Prior R2C2 state remains historical: `WP04R2C_BLOCKED_ARCHITECTURE_BOUNDARY_UNPROVEN`.
- Scope: add normal Production shared startup lock and formal native Migration 4 exclusive lock using the same canonical Production app-data namespace; add isolated synthetic validation only.
- Explicit exclusions: no Production app/DB access, install or package replacement, real authorization/backup/receipt/permit, final candidate freeze/build, final R2C acceptance, or audit.
- Existing untracked evidence and documents outside `51-r2c3a-startup-exclusion/` are preserved.
