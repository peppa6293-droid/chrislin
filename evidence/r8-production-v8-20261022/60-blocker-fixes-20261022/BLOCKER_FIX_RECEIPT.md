# R8 independent-audit blocker fixes — B01/B02/B03

Date: 2026-10-22
Status: **`R8_BLOCKER_BATCH_PASS`** (code and disposable synthetic tests only)

This is an addendum to the preserved receipts at
`evidence/r8-production-v8-20261022/RECEIPT.md` and
`evidence/r8-production-v8-20261022/50-followup-fixes-20261022/FOLLOWUP_RECEIPT.md`.
Neither file, and no log under `10-tests/`, `20-builds/`, `30-rust/`, `40-gates/`, or
`50-followup-fixes-20261022/logs/`, was modified or overwritten by this batch.

`R8_BLOCKER_BATCH_PASS` means only that the code and test changes described below pass. It does
**not** mean Production was migrated, recovered, launched, or authorized to migrate. Real
Production migration remains a separate Owner decision requiring a separately authorized run.

## 1. Blocker B01 — post-native backup path and parent canonicality

File: `scripts/production_v8_release_gate.py` (`verify_completed_migration()`).

`verify_completed_migration()` no longer reads backup facts from any cached value. After the native
runner returns, and immediately before `_backup_facts()`, it:

1. Recomputes the single legal backup path with `fixed_backup_path(expected_app_data)`.
2. Re-runs `validate_fixed_backup_path(...)` on that path, which compares the raw path
   component-by-component against the fixed file, requires
   `expected_data.resolve(strict=True) == expected_data`, and requires
   `expected.parent.resolve(strict=True) == expected.parent`.
3. Only if the revalidation returns no errors does it call `_backup_facts(expected_backup)`.
4. Collects every `GateBlocked` reason into `errors`, so the run stays fail-closed and cannot
   reach `V8_RELEASE_GATE_VERIFIED`.

Implementation excerpt:

```python
try:
    expected_backup = fixed_backup_path(expected_app_data)
    path_errors = validate_fixed_backup_path(str(expected_backup), expected_app_data)
    if path_errors:
        errors.extend(path_errors)
    else:
        fresh_backup = _backup_facts(expected_backup)
except GateBlocked as error:
    errors.extend(error.reasons)
except OSError as error:
    errors.append(f"Post-migration backup cannot be re-read: {error}")
```

Regression test (synthetic, disposable root only):

- `test_post_migration_backup_parent_symlink_is_rejected_even_when_it_points_back`
  (`scripts/test_production_v8_release_gate.py`)

  After acceptance starts, the test renames `production-v8-backups` to
  `production-v8-backups-displaced` and creates a symlink with the original name pointing back at
  the displaced directory. The symlink therefore resolves to the same real files and the same
  file bytes. The gate is still blocked with an `alias` / `canonical` reason, no release receipt is
  written, and no permit is issued. The test restores the layout and then confirms a clean
  verification still yields `V8_RELEASE_GATE_VERIFIED`, so the rejection is specifically caused by
  the post-native path revalidation and not by an unrelated failure.

## 2. Blocker B02 — stable-descriptor reads for bundle artifacts

### 2.1 Python `read_bundle()`

File: `scripts/production_v8_release_gate.py`.

- New `_read_stable_regular_file(path, label, limit)`:
  - `lstat` the path and reject non-regular files, symlinks, and `st_nlink != 1`;
  - open with `O_RDONLY | O_NOFOLLOW | O_CLOEXEC`;
  - `fstat` the opened descriptor and reject unless it is a regular single-link file;
  - compare the opened `(dev, ino, size, nlink, mtime_ns)` with the pre-open path identity;
  - read at most `limit + 1` bytes from that same descriptor;
  - compare the post-read descriptor identity and the current path `lstat` identity with the
    original identity; any change fails with "changed while being read";
  - return the exact bytes read.
- `read_bundle()` uses it for `Contents/Info.plist` and for the executable.
- The Info.plist is parsed from exactly those bytes (`plistlib.loads`), and the SHA-256 is computed
  over exactly those bytes. The executable SHA-256 and mode are likewise derived from the same
  descriptor read. There is no second path-based open between check, read, parse, and hash.
- `MAX_EXECUTABLE_BYTES = 536_870_912` bounds the executable read.

Regression tests:

- `test_info_plist_replacement_after_open_is_rejected_by_the_same_descriptor_read` — patches
  `gate.os.fstat` so that the second identity check replaces the file behind the open descriptor;
  the gate blocks with "changed while being read".
- `test_info_plist_symlink_is_rejected`
- `test_info_plist_hard_link_is_rejected`

### 2.2 Rust `read_production_info_plist()`

File: `src-tauri/src/lib.rs`.

- New `read_stable_regular_file_with_checkpoint(path, label, limit, checkpoint)` performs the same
  sequence natively: `lstat` regular/single-link/symlink rejection, `open` with
  `O_NOFOLLOW | O_CLOEXEC`, opened-vs-path identity comparison, bounded read from the same
  `File`, caller checkpoint, then re-checks identity, length, symlink status, and link count.
- `read_production_info_plist()` now derives the fixed `Contents/Info.plist` from the authorized
  executable and reads it through the stable helper. It parses `plist::Value` from those exact
  bytes, requires a dictionary, and hashes those exact bytes.

Regression tests:

- `info_plist_stable_read_rejects_replacement_after_open` — checkpoint replaces the file while the
  descriptor is open; the read is rejected.
- `info_plist_stable_read_rejects_symlink_and_hard_link` — both alias forms are rejected.

## 3. Blocker B03 — authenticated transactional integrity state replacing the F07 exact-hash check

The previous F07 check compared the startup database file SHA-256 with
`terminal.database_post_migration_sha256`. Any legal business DML legitimately changes the file
bytes, so that check caused false blocks on restart. Simply deleting the check would have removed
tamper detection, so it was replaced with an authenticated head maintained inside the database.

### 3.1 Stored state

Internal table created during the native V8 migration, inside the same exclusive transaction that
creates the V8 schema:

```sql
CREATE TABLE production_integrity_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  previous_digest TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  tag TEXT NOT NULL
) STRICT
```

Initial row: `(1, 1, "0" * 64, content_digest, tag)`.

The table is excluded from the content digest enumeration and from the migration parity snapshots
(`migrations/v5..v8-schema.json` and `MIGRATION_SQL`), because it is created only by the native
migration, not by the TypeScript migration source.

### 3.2 Authentication

- A random 32-byte key is read from `/dev/urandom` during the native migration and stored as
  lowercase hex in the terminal as `integrityKey`.
- `content_digest` is a SHA-256 over a canonical, deterministic serialization of every
  non-internal table. It includes each table name and `sqlite_master.sql`, each column name, and
  type-tagged, length-prefixed values (`N`, `I` + i64 big-endian, `F` + f64 bits big-endian,
  `S` + length + bytes, `B` + length + bytes), with rows in rowid order. `schema_migrations` is
  included.
- `tag = HMAC-SHA256(key, DOMAIN || sequence_be || previous_digest_raw || content_digest_raw)`,
  hand-implemented on top of the existing `sha2` dependency. No new crate was added.
- On startup, `validate_production_terminal()` requires `integrityKey` to be valid lowercase
  64-hex, then opens the database read-only with `SQLITE_OPEN_NOFOLLOW`, reads the singleton row,
  verifies the tag, and recomputes the content digest. Failures map to
  `PRODUCTION_TERMINAL_INTEGRITY_INVALID` and `PRODUCTION_INTEGRITY_STATE_*` codes, all fail-closed.
- The historical `database_post_migration_sha256` remains in the terminal and is still required and
  verified by the Python gate at migration time; it is no longer used as a startup acceptance test.

### 3.3 Lifecycle and crash recovery

- Autocommit DML in `DatabaseState::execute()` is wrapped in `BEGIN IMMEDIATE`, executed, and the
  head is advanced **before** `COMMIT`. Any failure rolls back both the business row and the head.
- Explicit transactions: DML sets `transaction_dirty`; `finish_transaction()` on `COMMIT` advances
  the head first and rolls the whole transaction back if that advance fails, then commits and
  resets the transaction id and dirty flag. `ROLLBACK` leaves the head untouched.
- Because the head and the business data change in one SQLite transaction, the recovery protocol
  is SQLite's own atomic commit/rollback: a crash before commit leaves neither, a crash after
  commit leaves both. There is no multi-file window.
- The SQLite authorizer additionally permits writes to `production_integrity_state` only from the
  internal `with_integrity_write` path (guarded by an atomic flag), so application SQL cannot
  advance or forge the head directly.

### 3.4 Regression tests (synthetic fixtures only)

- `terminal_integrity_state_accepts_legal_dml_and_rejects_out_of_band_changes` — legal DML through
  the runtime then restart passes; a raw out-of-band insert then restart fails with
  `PRODUCTION_TERMINAL_INTEGRITY_INVALID` and `PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH`.
- `terminal_integrity_state_rejects_a_tampered_tag` — zeroed tag yields
  `PRODUCTION_INTEGRITY_STATE_TAG_MISMATCH`.
- `terminal_integrity_state_covers_transaction_commit_and_rollback` — rollback leaves no row and
  no head change; commit persists and restart passes.
- `native_migration_initializes_the_authenticated_integrity_head` — the key is 64 lowercase hex,
  sequence is 1, the previous digest is 64 zeros, and verification passes.

The former `terminal_post_migration_database_hash_blocks_legal_data_changes_on_restart` test was
**replaced** by the four tests above. It was not left in place asserting the superseded semantics,
and no other test was deleted, skipped, or loosened. The four replacements are strictly additive in
coverage (legal-DML acceptance plus three tamper/rollback cases).

## 4. Verification commands and results

All commands were run from the repository root. Raw stdout/stderr and `.exit` files are in `logs/`.

| # | Command | Exit | Result | Raw log |
|---|---|---|---|---|
| 1 | `cargo test --manifest-path src-tauri/Cargo.toml` | 0 | 66 passed, 0 failed, 0 ignored | `logs/01-cargo-test.log` |
| 2 | `python3 -I scripts/test_production_v8_release_gate.py -v` | 0 | 47 tests, OK | `logs/02-v8-gate-tests.log` |
| 3 | `python3 -I scripts/test_production_v4_release_gate.py -v` | 0 | 40 tests, OK | `logs/03-v4-gate-tests.log` |
| 4 | `python3 -I scripts/test_production_gate_wiring_integration.py -v` | 0 | 5 tests, OK | `logs/04-gate-wiring-integration.log` |
| 5 | `python3 scripts/test_unified_synthetic_contract.py -v` | 0 | 5 tests, OK | `logs/05-unified-synthetic-contract.log` |
| 6 | `env NODE_ENV=test npx vitest run tests/r8-native-migration-sql-parity.test.ts tests/r8-production-schema-authority.test.ts --reporter=dot` | 0 | 2 files passed, 27 tests passed | `logs/06-r8-vitest.log` |
| 7 | `npm run typecheck` | 0 | `tsc --noEmit` clean | `logs/07-typecheck.log` |
| 8 | `npm run lint` | 0 | 125 files checked, no fixes applied | `logs/08-lint.log` |
| 9 | `git diff --check` | 0 | no whitespace errors | `logs/09-git-diff-check.log` |
| 10 | `python3 scripts/test_unified_r2b_recovery.py -v` | 1 | setup error, `Ran 0 tests` — see §6; not a pass | `logs/10-unified-r2b-recovery.log` |

Log SHA-256 values are recorded in `LOG_SHA256.txt` in this directory.

Comparison against the prior follow-up batch
(`50-followup-fixes-20261022/FOLLOWUP_RECEIPT.md`):

| Suite | Prior follow-up (50) | This batch (60) | Change |
|---|---|---|---|
| Cargo | 61 passed | 66 passed | +5 (2 stable-fd Info.plist tests, 4 integrity tests, 1 superseded test replaced) |
| Python V8 gate | 43 passed | 47 passed | +4 (backup-parent symlink, Info.plist replacement/symlink/hard-link) |
| Python V4 gate | 40 passed | 40 passed | 0 |
| Gate wiring | 5 passed | 5 passed | 0 |
| Unified synthetic contract | 5 passed | 5 passed | 0 |
| R8 Vitest parity + authority | not separately recorded (full suite: 442 passed, 80 skipped) | 2 files, 27 passed | subset re-run only |
| Typecheck / lint | clean | clean | 0 |
| Unified R2B recovery | setup error, 0 run | setup error, 0 run | 0 |

Note: the two R8 Vitest files are the contract tests affected by this work; the full Vitest suite was
not re-run in this batch. The prior full-suite figure (44 files, 442 passed, 80 skipped) is not
restated here as a result of this batch.

## 5. Scope declaration

- All runtime tests, migration simulations, tamper tests, and fixture manipulations ran only in
  disposable synthetic fixtures or temporary directories, removed on teardown.
- No real Production SQLite database was opened, read, written, migrated, backed up, replaced, or
  deleted.
- Production identity `com.personalfinance.console` was not started; the app was not launched.
- No real Production permit, receipt, consumed ledger, terminal, integrity key, or sidecar was
  created, consumed, replaced, or modified.
- Nothing was copied to `/Applications`.
- No Owner approval, migration authorization, or V8 terminal was fabricated.
- No startup gate was lowered and no authorizer, permit path, or path/hash/inode/identity binding
  was removed or bypassed.
- The only superseded check is the F07 startup file-hash equality, which was replaced by the
  authenticated transactional state described in §3, not removed.
- No business data semantics, V2→V1 `CASH_DEBIT` dual-write, financial formulas, or UI business
  scope were changed.
- No dependency, network request, `sudo`, or permission relaxation was added; no new crate was
  introduced.
- No old R8/V4 evidence was deleted, overwritten, or renamed.
- No `git add -A`, commit, push, merge, or copy to `/Applications` was performed.

## 6. Residual issues

1. **F07 rollback-to-older-snapshot residual.** The authenticated head detects out-of-band
   modification, tag tampering, and content drift. It does not, by itself, detect restoring an
   older internally consistent copy of the database (both the data and the head revert together)
   because no external monotonic head file outside the database was implemented. The terminal's
   `database_post_migration_sha256` still records the migration-time state, but startup no longer
   compares file bytes, precisely to stop false blocks on legal DML. Closing this residual requires
   an externally stored sequence/head, which is a separate design change and was not authorized in
   this batch.
2. `python3 scripts/test_unified_r2b_recovery.py -v` still aborts in `setUpClass` on a retained
   fixture whose `SYNTHETIC_ONLY` marker is missing
   (`FileNotFoundError`, `Ran 0 tests`, exit 1). This is pre-existing, identical to the baseline
   and the prior batch, reported raw in `logs/10-unified-r2b-recovery.log`, and is **not** claimed
   as a pass.
3. Pre-existing unused `PathBuf` import warning in `src-tauri/src/wp02_preview_isolation.rs:2`.
   It does not affect test results and was not changed.
4. This batch did not build or launch a candidate package, and did not perform a real Production
   migration.

## 7. Git worktree

No commit, push, or merge was performed. The code changes remain in the working tree. Worktree
status and `git diff --stat` are recorded in `git-status-short.txt`.
