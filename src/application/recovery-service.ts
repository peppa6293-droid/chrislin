import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import type { RecoveryJournal, RecoveryJournalEntry } from "../persistence/recovery-journal.js";
import { Repositories } from "../persistence/repositories.js";

/**
 * Startup recovery and maintenance-only lock closure (design §5.1.4 恢复侧, §5.3.4, C12/C13).
 *
 * Recovery never repairs business data: step 3 may only write the lock table, step 4 is
 * read-only, step 5 only deletes a lock row and rewrites the journal. Legs, transfers and
 * cash revisions are never touched here (§5.1.4 恢复流程零写入业务数据).
 */

export type MaintenanceRole = "USER" | "OWNER" | "MAINTENANCE";

export type RecoveryOutcome = "RESOLVED" | "MANUAL_REVIEW_NO_RECORD" | "MANUAL_REVIEW_INCOMPLETE";

export interface RecoveryEntryReport {
  journalId: string;
  transferId: string;
  operation: RecoveryJournalEntry["operation"];
  outcome: RecoveryOutcome | "SKIPPED_ALREADY_REVIEWED";
}

export interface RecoveryReport {
  profileId: string;
  scanned: number;
  /** False when a journal rewrite failed; the write gate then stays closed. */
  complete: boolean;
  entries: RecoveryEntryReport[];
}

/** Process-local gate: it can only ever close the transfer write entry points. */
const recoveryComplete = new Set<string>();

export function markRecoveryComplete(profileId: string): void {
  recoveryComplete.add(profileId);
}

export function isRecoveryComplete(profileId: string): boolean {
  return recoveryComplete.has(profileId);
}

/** Test hook only. */
export function resetRecoveryState(): void {
  recoveryComplete.clear();
}

/**
 * Write gate for edit/delete/restore (§5.1.4.6). A new transfer is not gated: its id is fresh
 * and unrelated to any pending entry, but it still must never reuse a retired id.
 */
export function assertRecoveryComplete(profileId: string): void {
  if (recoveryComplete.has(profileId)) return;
  throw new ApplicationDataError(
    "RECOVERY_INCOMPLETE",
    "Transfer recovery has not finished for this profile; transfers stay closed.",
  );
}

/** Step 2: the transfer schema must already be readable before anything is judged. */
async function assertTransferSchemaUsable(db: SqlDatabase): Promise<void> {
  const version = (await db.select<{ user_version: number }>("PRAGMA user_version"))[0];
  const current = version === undefined ? null : Number(version.user_version);
  if (current === null || !Number.isFinite(current) || current < 11)
    throw new ApplicationDataError(
      "RECOVERY_JOURNAL_UNREADABLE",
      `Transfer recovery needs schema 11 or newer (found ${String(current)}); the journal is kept as is.`,
    );
  const tables = await db.select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table'
       AND name IN ('transfer_records','transfer_legs','transfer_outcome_locks')`,
  );
  if (tables.length !== 3)
    throw new ApplicationDataError(
      "RECOVERY_JOURNAL_UNREADABLE",
      "Transfer tables are not readable; the journal is kept as is.",
    );
}

async function transferRecordExists(
  db: SqlDatabase,
  profileId: string,
  transferId: string,
): Promise<boolean> {
  return (
    (
      await db.select("SELECT 1 AS found FROM transfer_records WHERE id=? AND profile_id=?", [
        transferId,
        profileId,
      ])
    ).length > 0
  );
}

/**
 * The seven startup steps (§5.1.4). Order is part of the contract: lock first, judge second.
 * A failure in step 1/2 throws and leaves the profile closed; a failure in step 5 leaves the
 * journal and the lock rows exactly where they were.
 */
export async function recoverFromJournal(
  db: SqlDatabase,
  journal: RecoveryJournal,
  profileId: string,
): Promise<RecoveryReport> {
  // Step 1: read and validate. Unreadable journals are never rebuilt (§5.1.4.6).
  const document = await journal.load(profileId);
  // Step 2: the schema must be usable, otherwise nothing may be judged.
  await assertTransferSchemaUsable(db);
  const repositories = new Repositories(db);
  const report: RecoveryReport = {
    profileId,
    scanned: document.entries.length,
    complete: true,
    entries: [],
  };
  for (const entry of document.entries) {
    if (entry.state === "MANUAL_REVIEW") {
      // Already parked for a human: idempotent, never re-judged, never repaired.
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "SKIPPED_ALREADY_REVIEWED",
      });
      continue;
    }
    // Step 3: an idempotent lock first, so a crash right here cannot open the transfer.
    const locked = await repositories.lockTransferOutcomeSafely(entry.transferId, profileId, null);
    if (!locked) {
      // A lock that could not be written is a failed recovery, not a completed one: keep the
      // journal entry in its conservative state and leave the write gate closed. The entry is
      // re-examined on the next startup; nothing is repaired or replayed here.
      report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_INCOMPLETE",
      });
      continue;
    }
    if (!(await markLocked(journal, profileId, entry.journalId))) {
      report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_INCOMPLETE",
      });
      continue;
    }
    // Step 4: read-only judgement. A query error parks the entry, it never resolves it.
    let exists: boolean;
    let resolved: boolean;
    try {
      exists = await transferRecordExists(db, profileId, entry.transferId);
      resolved = exists
        ? await repositories.resolveTransferOutcome(entry.transferId, profileId, entry.operation)
        : false;
    } catch {
      if (!(await markForReview(journal, profileId, entry.journalId))) report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_INCOMPLETE",
      });
      continue;
    }
    if (!exists) {
      // The transaction never committed: park it, do not delete the fact (§5.1.4.5).
      if (!(await markForReview(journal, profileId, entry.journalId))) report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_NO_RECORD",
      });
      continue;
    }
    if (!resolved) {
      if (!(await markForReview(journal, profileId, entry.journalId))) report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_INCOMPLETE",
      });
      continue;
    }
    // Step 5: complete facts -> archive. A failed rewrite keeps everything as it was.
    try {
      await journal.archive(profileId, entry.journalId, { state: "RESOLVED" });
    } catch {
      report.complete = false;
      report.entries.push({
        journalId: entry.journalId,
        transferId: entry.transferId,
        operation: entry.operation,
        outcome: "MANUAL_REVIEW_INCOMPLETE",
      });
      continue;
    }
    report.entries.push({
      journalId: entry.journalId,
      transferId: entry.transferId,
      operation: entry.operation,
      outcome: "RESOLVED",
    });
  }
  // Step 7: only a fully processed scan opens the write gate.
  if (report.complete) markRecoveryComplete(profileId);
  return report;
}

async function markLocked(
  journal: RecoveryJournal,
  profileId: string,
  journalId: string,
): Promise<boolean> {
  try {
    await journal.setState(profileId, journalId, "LOCKED");
    return true;
  } catch {
    return false;
  }
}

async function markForReview(
  journal: RecoveryJournal,
  profileId: string,
  journalId: string,
): Promise<boolean> {
  try {
    await journal.setState(profileId, journalId, "MANUAL_REVIEW");
    return true;
  } catch {
    return false;
  }
}

export interface CloseOrphanLockInput {
  transferId: string;
  profileId: string;
  reason: string;
  operator: string;
  role: MaintenanceRole;
}

export interface OrphanLockAudit {
  transferId: string;
  profileId: string;
  reason: string;
  operator: string;
  at: string;
  action: "CLOSE_ORPHAN_LOCK";
}

const CLOSE_REASON_LIMIT = 500;

/**
 * Closing an orphan outcome lock is a permission action, not a user action (§5.3.4): only
 * MAINTENANCE may call it, the reason is mandatory, the lock row is updated and never
 * deleted, the id stays retired forever, and no business row is written.
 */
export async function closeOrphanLock(
  db: SqlDatabase,
  journal: RecoveryJournal,
  input: CloseOrphanLockInput,
): Promise<OrphanLockAudit> {
  if (input.role !== "MAINTENANCE" || input.operator.trim() === "")
    throw new ApplicationDataError(
      "TRANSFER_LOCK_CLOSE_FORBIDDEN",
      "Only a maintenance operator can close an outcome lock.",
    );
  const reason = input.reason.trim();
  if (reason === "" || reason.length > CLOSE_REASON_LIMIT)
    throw new ApplicationDataError(
      "TRANSFER_LOCK_CLOSE_REASON_REQUIRED",
      `A closure reason of 1-${CLOSE_REASON_LIMIT} characters is required.`,
    );
  const lock = (
    await db.select("SELECT closed_at FROM transfer_outcome_locks WHERE transfer_id=?", [
      input.transferId,
    ])
  )[0];
  if (!lock)
    throw new ApplicationDataError(
      "TRANSFER_LOCK_NOT_FOUND",
      `Transfer ${input.transferId} has no outcome lock.`,
    );
  if (lock.closed_at !== null && lock.closed_at !== undefined)
    throw new ApplicationDataError(
      "TRANSFER_LOCK_ALREADY_CLOSED",
      `Transfer ${input.transferId} is already closed.`,
    );
  if (await transferRecordExists(db, input.profileId, input.transferId))
    throw new ApplicationDataError(
      "TRANSFER_LOCK_NOT_ORPHAN",
      `Transfer ${input.transferId} still has business data and cannot be closed.`,
    );
  const at = new Date().toISOString();
  const updated = await db.execute(
    `UPDATE transfer_outcome_locks SET closed_at=?,closed_reason=?,closed_by=?
       WHERE transfer_id=? AND closed_at IS NULL`,
    [at, reason, input.operator, input.transferId],
  );
  if (updated.rowsAffected !== 1)
    throw new ApplicationDataError(
      "TRANSFER_LOCK_ALREADY_CLOSED",
      `Transfer ${input.transferId} is already closed.`,
    );
  // The journal entry for a retired id is archived in the same step, never left dangling.
  const entry = await journal.findByTransferId(input.profileId, input.transferId);
  if (entry) await journal.archive(input.profileId, entry.journalId, { state: "RESOLVED" });
  return {
    transferId: input.transferId,
    profileId: input.profileId,
    reason,
    operator: input.operator.trim(),
    at,
    action: "CLOSE_ORPHAN_LOCK",
  };
}
