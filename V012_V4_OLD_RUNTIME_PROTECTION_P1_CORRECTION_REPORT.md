# V0.1.2 V4 Old-Runtime Protection — P1 Correction Report

Status: `PF_V012_V4_OLD_RUNTIME_PROTECTION_P1_CORRECTION_READY_FOR_REAUDIT`

`RB-V4-OLD-RUNTIME-01` remains OPEN pending independent re-audit and later Owner decision. This correction does not authorize Production App replacement or Production V4 migration.

## 1. Baseline and scope

Correction baseline: `ade90ce387c354f779a64a352a309852c4faa104`. Independent source report preserved unchanged: [V012_V4_OLD_RUNTIME_PROTECTION_INDEPENDENT_AUDIT.md](V012_V4_OLD_RUNTIME_PROTECTION_INDEPENDENT_AUDIT.md). Its six P1 findings were tied to direct repros in that report and its evidence: unreadable subtree omitted; `lsof` failure and renamed process omitted; invalid installed candidate not rolled back; WAL-only committed row accepted against stale main-file copy; manifest bytes not bound; restored consumed permit replayed.

Only the six authorized P1 findings and four directly related P2 paths were changed. Financial Model semantics, Migration 4 SQL, app identity, database basename, Production financial rows, installed app and RC2 were preserved.

## 2. P1-OLD-GATE-01 — app inventory fails closed

`inventory_production_apps` now reports traversal callback failures, missing required scan roots, symlink scan roots/directories, unreadable/malformed app metadata and iteration failures as structured `GateBlocked` diagnostics. A missing standard `~/Applications` directory remains a known absence. It no longer silently treats an incomplete scan as an empty list. A readable clean fixture continues through normal validation.

Tests inject an unreadable subtree containing a synthetic old Production bundle, a traversal `PermissionError`, malformed `Info.plist`, and a clean inventory. No test relies on `chmod` behavior.

## 3. P1-OLD-GATE-02 — process inventory fails closed

The gate takes a complete `ps` snapshot, then reads each PID's actual text-executable path and open-file paths with `lsof`; it does not use display/command name as the identity decision. It correlates executable paths with the app inventory, reads containing bundle identity where present, and checks Production DB/sidecar handles. `ps`/`lsof` errors, permission failures, malformed process rows, missing executable paths and ambiguous executable paths block preflight.

Isolated cases cover a known Production executable, a renamed executable in a Production bundle, `lsof` permission denial/nonzero exit, and a clean complete process inventory. No real app was launched for these cases.

## 4. P1-OLD-RETIRE-01 — post-removal failures roll back

After archiving and verifying the old bundle, the procedure persists an intermediate receipt before removing the normal-path app. Any subsequent failure removes the candidate/staging path, restores the archived bundle and original executable mode, then re-reads and verifies the old executable hash, Bundle ID, executable identity and mode. Success is reported only after the new executable and manifest are verified. Rollback failure becomes a hard `GateBlocked` result with archive/recovery path and persisted `ROLLBACK_FAILED` receipt.

Synthetic tests inject candidate copy failure, staged executable mismatch, installed executable mismatch, installed manifest semantic failure, and installed manifest byte-hash mismatch. Each restores the old fixture at the normal path. A separate rollback-copy failure remains BLOCKED with archive evidence.

## 5. P1-OLD-BACKUP-01 — WAL and sidecar state is bound

Python preflight refuses a database with any `-wal`, `-shm`, or `-journal` file, regardless of size. The receipt and permit bind `sidecarsAbsent=true`. Native permit consumption rechecks absence and verifies the source/backup main-file hashes and paths; native migration begin checks sidecars and V3 schema again before DDL. No checkpoint or sidecar cleanup is performed.

The synthetic WAL case commits a row visible through the live WAL while the copied main-file backup has the same SHA-256 but lacks that row. Preflight refuses receipt creation. A sidecar inserted after Python preflight is refused by native permit consumption and the fixture remains V3.

## 6. P1-OLD-RETIRE-02 — manifest bytes are authorized end to end

Replacement authorization must include `candidateManifestSha256`. Retirement compares exact bytes for the approved source, copied staging bundle and installed bundle, in addition to semantic manifest validation and executable hash. A source mismatch is rejected before old-app removal; a staged/installed mismatch triggers rollback.

Tests use whitespace-only changes (same JSON meaning, different bytes) and semantic changes to show rejection and restoration.

## 7. P1-OLD-AUTH-01 — authorization consumption is durable and one-time

The environment-variable nonce bypass was removed. The native consumer atomically claims the permit, validates the full runtime/database/backup/manifest/sidecar/Owner facts, checks an Owner-only consumed-authorization ledger, then appends authorization ID, nonce, consumed timestamp, executable hash and manifest hash. The ledger uses an exclusive lock, Owner-only temporary file, file sync, atomic rename and parent-directory sync. Permission is returned only after the durable write succeeds; corrupt, duplicate, replayed or unwritable ledger state fails closed.

The test restores the exact consumed permit bytes and invokes the native consumer in a fresh child process; replay is rejected while the DB remains V3. Ledger tests reject reused ID or nonce and accept a separately authorized new ID plus nonce. A missing ledger parent simulates durable-write failure and confirms rejection.

## 8. Directly related P2 corrections

- **P2-OLD-GUARD-01:** Production authorizer uses a positive read-only PRAGMA allowlist. `PRAGMA incremental_vacuum` is denied without arguments; `user_version` preflight reads still work. Mutable PRAGMA operations require the active migration window.
- **P2-OLD-RECEIPT-01:** Retirement receipts persist `PRECHECK_BLOCKED`, `LEGACY_RUNTIME_ARCHIVED_AND_DISABLED`, `CANDIDATE_INSTALLED_AND_VERIFIED`, `ROLLBACK_COMPLETED`, or `ROLLBACK_FAILED`, with app/process inventory, executable/manifest hashes and recovery details. Receipts use unique paths and do not silently overwrite old evidence.
- **P2-OLD-CONTRACT-01:** Python now requires candidate and migration authorization IDs, the exact executable name/path, correct DB basename, and a backup in the native-approved `production-v4-backups` directory that differs from the source DB. It rejects any candidate semantics the native startup rejects.
- **P2-OLD-DIAGNOSTIC-01:** App metadata, plist, traversal, process and manifest failures become structured BLOCKED diagnostics rather than uncaught parser exceptions or empty inventories.

The only environment variable used by the correction is `PF_TEST_SYNTHETIC_REPLAY_ROOT` inside a `#[cfg(test)]` child-process replay test. It is absent from production code and does not bypass runtime path or authorization checks.

## 9. Synthetic rejection matrix

| Scenario | Result |
|---|---|
| Hidden old app under an uninspectable subtree / traversal callback error | BLOCKED |
| Malformed app metadata | Structured BLOCKED |
| Running or renamed Production executable | BLOCKED |
| `lsof` permission denial / incomplete process facts | BLOCKED |
| Missing compatibility manifest, wrong or acceptance Bundle ID, changed executable identity | BLOCKED |
| Missing/incorrect backup, backup equals source, missing approval ID | BLOCKED |
| WAL, SHM, or journal state | BLOCKED; no receipt/permit |
| Newer or mismatched schema authorities | BLOCKED |
| Exact same permit/authorization replay | BLOCKED |
| Complete clean synthetic V3 facts with exact backup and approvals | Continues to a receipt and permit |

## 10. Complete synthetic chain result

The test-only harness creates a synthetic V3 database and exact byte backup, a synthetic Production-identity app with embedded compatibility manifest, clean inventory facts, and fixture approvals. The Python gate validation writes a persistent receipt and one-time permit. The real native permit consumer validates and durably consumes it. The test restores the permit and a fresh native consumer process rejects replay. The real TypeScript `migrateDatabase` function then applies Migration 4 to the isolated fixture. Final readback: `user_version=4`, maximum migration version `4`, `integrity_check=ok`, and clean foreign-key check.

The harness is a Rust unit-test-only path injection plus an explicit `rehearse-synthetic` fixture command. It rejects fixture roots that overlap `/Applications` or the real Production app-data directory. There is no Production path override in runtime code.

## 11. Rollback evidence

Four post-install fault classes plus stage hash mismatch left the supported synthetic install path containing the original old fixture App. The restored executable SHA-256, Bundle ID, executable identity and mode were read back. A deliberately failed rollback produced a hard BLOCKED result, persisted `ROLLBACK_FAILED`, and retained the verified archive path.

## 12. Replay evidence

Native ledger readback contained exactly one consumed record with the same authorization ID, nonce, candidate executable hash and manifest hash as the consumed permit. Restoring byte-identical permit JSON after consumption and starting a new test process was rejected from persisted state. Reusing only the ID or only the nonce is independently rejected.

## 13. WAL evidence

The WAL fixture kept a committed business row only in the WAL while the main database bytes exactly matched the stale backup. The Python gate detected sidecars and refused receipt creation. A second native check detected a sidecar added after permit generation, refused consumption, and preserved schema V3. Real Production was not checkpointed or altered.

## 14. Production preservation

Read-only immutable verification before and after correction: Production SHA-256 `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`; Schema V3; migrations `[1,2,3]`; integrity `ok`; foreign-key check clean. No Production launch, write, backup creation, checkpoint, or migration was performed.

## 15. Installed old App preservation

`/Applications/Personal Finance Console.app` remains installed and untouched. Bundle ID remains `com.personalfinance.console`; executable SHA-256 remains `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`. No launch, move, chmod, archive or replacement was performed.

## 16. RC2 preservation

RC2 remains untouched. Its executable SHA-256 remains `f55f412665fecdf51858b8437284635e8f746db54ce2ce425dfd772466d9c60c`. It was not launched, rebuilt, installed or modified.

## 17. Tests and verification

- `npm run typecheck`: PASS.
- `npm run lint`: PASS; 24 existing non-failing CSS specificity warnings (`P2-CSS-01`), no files fixed by lint.
- `npx vitest run tests`: PASS — 15 files, 281 tests.
- `npm run test:release-gate`: PASS — 22 isolated tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: PASS — 20 tests, including Python-gate/native-consume/real-Migration-4 chain and child-process replay.
- `python3 -m py_compile scripts/production_v4_release_gate.py scripts/test_production_v4_release_gate.py`: PASS.
- Read-only real-machine preflight: BLOCKED as required. The known old Production App is still installed. Complete app inventory is additionally unknown because several `.app` bundles have missing metadata and one plist is malformed; process inspection returned a nonzero `lsof` result for PID 1, so process identity is unknown. These are structured blocking conditions, never treated as empty inventories. No permit was issued.

## 18. Residual risk

Production migration remains NOT AUTHORIZED. The old V3 app remains installed; the actual real-machine gate correctly remains blocked. The system does not claim macOS can prevent an Owner from manually restoring an archived binary. Six pre-existing accepted P2 items remain deferred: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, P2-TEXT-01, P2-V4-ACTUAL-NOCHANGE-01, P2-V4-TARGET-01.

## 19. Changed files and Git

Correction commit is separate from baseline commit `ade90ce387c354f779a64a352a309852c4faa104`; the baseline was not amended. Changed files are:

- `src-tauri/src/lib.rs`
- `scripts/production_v4_release_gate.py`
- `scripts/test_production_v4_release_gate.py`
- `V012_V4_OLD_RUNTIME_PROTECTION_P1_CORRECTION_REPORT.md`

The independent audit report and its artifacts were preserved and are not part of the correction implementation commit.

## 20. Ready for independent re-audit

All six P1 corrections and the four directly related P2 corrections have focused coverage. The synthetic complete chain and rejection cases pass; the real machine remains BLOCKED; Production, the installed old app and RC2 remain unchanged. This is a correction-ready status only: it does not close `RB-V4-OLD-RUNTIME-01`, authorize app replacement, or authorize Production V4 migration.
