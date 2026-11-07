import { ApplicationDataError } from "./database.js";

/**
 * Cross-restart recovery journal (design §5.1.4, C12).
 *
 * This module is the ONLY persistence channel for "a transfer outcome became
 * unknown". It deliberately does not depend on `SqlDatabase`: when the SQLite
 * connection is faulted (COMMIT and ROLLBACK both failed) the journal still has
 * to be writable, otherwise the fact is lost at exactly the moment it matters.
 *
 * The file IO itself lives in Rust (`recovery_journal_read` /
 * `recovery_journal_write`, design §5.1.4.1/§5.1.4.3): atomic whole-file
 * rewrite, 0700 directory, 0600 file, strict profileId validation before the
 * profileId is ever used as a path segment, `deny_unknown_fields` on every
 * record. This module only owns the state machine on top of that channel.
 */

export const RECOVERY_JOURNAL_FORMAT_VERSION = 1;

export type RecoveryJournalOperation = "CREATE" | "EDIT" | "DELETE" | "RESTORE";

export type RecoveryJournalState = "PENDING" | "LOCKED" | "RESOLVED" | "MANUAL_REVIEW";

/**
 * Exactly six fields (design §5.1.4.2). No amount, account name, balance,
 * read-back token, transaction id, raw error text or device identifier ever
 * enters this record — the Rust side rejects a seventh key outright.
 */
export interface RecoveryJournalEntry {
  journalId: string;
  profileId: string;
  transferId: string;
  operation: RecoveryJournalOperation;
  createdAt: string;
  state: RecoveryJournalState;
}

export interface RecoveryJournalArchiveEntry extends RecoveryJournalEntry {
  resolvedAt: string;
}

export interface RecoveryJournalDocument {
  journalFormatVersion: number;
  profileId: string;
  entries: RecoveryJournalEntry[];
  archive: RecoveryJournalArchiveEntry[];
}

/** The only thing this module needs from the outside world. */
export interface RecoveryJournalChannel {
  read(profileId: string): Promise<RecoveryJournalDocument | null>;
  write(document: RecoveryJournalDocument): Promise<void>;
}

export interface RecoveryJournalClock {
  now(): string;
  createId(): string;
}

const defaultClock: RecoveryJournalClock = {
  now: () => new Date().toISOString(),
  createId: () => globalThis.crypto.randomUUID(),
};

const JOURNAL_CODES: ReadonlySet<string> = new Set([
  "RECOVERY_JOURNAL_BUSY",
  "RECOVERY_JOURNAL_UNAVAILABLE",
  "RECOVERY_JOURNAL_UNREADABLE",
]);

/** Rust returns the code verbatim as the command error string. */
function journalCodeOf(error: unknown): string | null {
  if (error instanceof ApplicationDataError && JOURNAL_CODES.has(error.code)) return error.code;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  for (const code of JOURNAL_CODES) if (message.includes(code)) return code;
  return null;
}

/**
 * A write that cannot be made durable must fail closed: the caller refuses the
 * transfer instead of performing it without a journal entry (§5.1.4.6).
 */
function writeFailure(error: unknown): ApplicationDataError {
  const code = journalCodeOf(error);
  return new ApplicationDataError(
    code === "RECOVERY_JOURNAL_BUSY" ? "RECOVERY_JOURNAL_BUSY" : "RECOVERY_JOURNAL_UNAVAILABLE",
    "The recovery journal could not be written; the transfer was not attempted.",
    { cause: error },
  );
}

/** A journal that cannot be read is never rebuilt or overwritten (§5.1.4.6). */
function readFailure(error: unknown): ApplicationDataError {
  return new ApplicationDataError(
    journalCodeOf(error) ?? "RECOVERY_JOURNAL_UNREADABLE",
    "The recovery journal is unreadable; transfers stay closed until it is repaired by hand.",
    { cause: error },
  );
}

function emptyDocument(profileId: string): RecoveryJournalDocument {
  return {
    journalFormatVersion: RECOVERY_JOURNAL_FORMAT_VERSION,
    profileId,
    entries: [],
    archive: [],
  };
}

export class RecoveryJournal {
  constructor(
    private readonly channel: RecoveryJournalChannel,
    private readonly clock: RecoveryJournalClock = defaultClock,
  ) {}

  /** Whole document, or an empty one when the profile has no journal file yet. */
  async load(profileId: string): Promise<RecoveryJournalDocument> {
    let document: RecoveryJournalDocument | null;
    try {
      document = await this.channel.read(profileId);
    } catch (error) {
      throw readFailure(error);
    }
    if (document === null) return emptyDocument(profileId);
    if (document.profileId !== profileId) throw readFailure(new Error("profileId mismatch"));
    return document;
  }

  async entries(profileId: string): Promise<RecoveryJournalEntry[]> {
    return (await this.load(profileId)).entries;
  }

  async findByTransferId(
    profileId: string,
    transferId: string,
  ): Promise<RecoveryJournalEntry | null> {
    const entries = await this.entries(profileId);
    return entries.find((entry) => entry.transferId === transferId) ?? null;
  }

  /**
   * Step 1 of every write: the entry must be durable BEFORE `db.transaction`
   * is called. A failure here propagates and the transaction never starts.
   */
  async append(
    profileId: string,
    input: { transferId: string; operation: RecoveryJournalOperation },
  ): Promise<RecoveryJournalEntry> {
    const document = await this.load(profileId);
    const entry: RecoveryJournalEntry = {
      journalId: this.clock.createId(),
      profileId,
      transferId: input.transferId,
      operation: input.operation,
      createdAt: this.clock.now(),
      state: "PENDING",
    };
    await this.write(profileId, {
      ...document,
      entries: [...document.entries, entry],
    });
    return entry;
  }

  async setState(profileId: string, journalId: string, state: RecoveryJournalState): Promise<void> {
    const document = await this.load(profileId);
    const entries = document.entries.map((entry) =>
      entry.journalId === journalId ? { ...entry, state } : entry,
    );
    await this.write(profileId, { ...document, entries });
  }

  /**
   * Removes an entry WITHOUT archiving. Only two paths may call this: "the
   * transaction deterministically failed and rolled back" and "the commit was
   * read back complete". Any other removal would loosen the journal.
   */
  async remove(profileId: string, journalId: string): Promise<void> {
    const document = await this.load(profileId);
    await this.write(profileId, {
      ...document,
      entries: document.entries.filter((entry) => entry.journalId !== journalId),
    });
  }

  /**
   * Removes an entry and keeps it in `archive` in the SAME atomic write, so a
   * crash can never leave a record both gone and unarchived.
   */
  async archive(
    profileId: string,
    journalId: string,
    options: { resolvedAt?: string; state?: RecoveryJournalState } = {},
  ): Promise<void> {
    const document = await this.load(profileId);
    const entry = document.entries.find((candidate) => candidate.journalId === journalId);
    if (!entry) return;
    const archived: RecoveryJournalArchiveEntry = {
      ...entry,
      ...(options.state === undefined ? {} : { state: options.state }),
      resolvedAt: options.resolvedAt ?? this.clock.now(),
    };
    await this.write(profileId, {
      ...document,
      entries: document.entries.filter((candidate) => candidate.journalId !== journalId),
      archive: [...document.archive, archived],
    });
  }

  private async write(profileId: string, document: RecoveryJournalDocument): Promise<void> {
    try {
      await this.channel.write({ ...document, profileId });
    } catch (error) {
      throw writeFailure(error);
    }
  }
}
