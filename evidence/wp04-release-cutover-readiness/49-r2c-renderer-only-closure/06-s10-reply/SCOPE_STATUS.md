# S10 / reply-loss comparison

Reused current-source R2B evidence at `evidence/wp04-release-cutover-readiness/47-r2b3c3-full-chain-recovery-final/07-guard-reply/REPLY_LOST_AFTER_DURABLE_TERMINAL/SCENARIO_RESULT.json`: after `AFTER_S10_BEFORE_CALLER_REPLY`, durable state was `V4_VERIFIED`, M4 row count was 1, read-only diagnostic reported `migrationMayRerun=false`, `permitReusable=false`, `restoreAllowed=false`, and diagnostic mutation count 0. This proves native reply-loss behavior. A renderer-only death versus reply/navigation-loss differential was not run in the current candidate.
