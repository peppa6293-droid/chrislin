# Read-only disposition policy

| Current state | Disposition | Business access | Migration 4 may rerun | Restore | Consumed permit |
|---|---|---:|---:|---|---:|
| V4_VERIFIED | READONLY_CONFIRMATION_ONLY | no | no | false | not reusable |
| V4_COMMITTED_BUT_REPLY_LOST | READONLY_CONFIRMATION_ONLY | no | no | false | not reusable |
| FAILED_V3_CONFIRMED | MANUAL_DECISION_REQUIRED | no | only after fresh authorization | AUTHORIZATION_REQUIRED | not reusable |
| QUIESCENCE_ACQUIRED / M4_IN_TRANSACTION / COMMIT_OUTCOME_UNKNOWN | MANUAL_DECISION_REQUIRED | no | no | false | not reusable |
| GUARD_LOST_OR_UNPROVEN / ORPHAN_ACTIVE / CORRUPT_STATE | REFUSE | no | no | false | not reusable |
| MISSING_TERMINAL / PERMIT_CONSUMED | MANUAL_DECISION_REQUIRED | no | no | false | not reusable |

`diagnosticMutationCount=0` on both successful dispositions and structured refusals. None of these values performs a recovery action.
