import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../src/application/product-service.js";
import {
  isRecoveryComplete,
  markRecoveryComplete,
  recoverFromJournal,
  resetRecoveryState,
} from "../src/application/recovery-service.js";
import {
  createLedgerTransfer,
  deleteLedgerTransfer,
  editLedgerTransfer,
  restoreLedgerTransfer,
} from "../src/application/ux-ledger-service.js";
import type { SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import type {
  RecoveryJournalChannel,
  RecoveryJournalDocument,
} from "../src/persistence/recovery-journal.js";
import {
  RECOVERY_JOURNAL_FORMAT_VERSION,
  RecoveryJournal,
} from "../src/persistence/recovery-journal.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// C12 (T-39..T-46): the recovery journal must survive a real process death and a faulted
// SQLite connection. Every test here uses real files and real SQLite; the ones that claim
// "across a restart" really spawn another OS process.

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const NOW = "2026-11-06T00:00:00.000Z";
const TODAY = "2026-11-06";

interface Env {
  root: string;
  dbPath: string;
  journalDir: string;
  db: NodeSqliteDatabase;
  profileId: string;
  accountA: string;
  accountB: string;
  journal: RecoveryJournal;
  channel: FileJournalChannel;
}

const envs: Env[] = [];

afterEach(() => {
  for (const env of envs.splice(0)) {
    env.db.close();
    rmSync(env.root, { recursive: true, force: true });
  }
  resetRecoveryState();
});

/**
 * File channel mirroring the Rust contract (recovery_journal_read / _write): 0700
 * directory, 0600 file, whole-document atomic rewrite, profileId as the file name.
 */
class FileJournalChannel implements RecoveryJournalChannel {
  failWrite = false;

  constructor(readonly directory: string) {}

  private path(profileId: string): string {
    return join(this.directory, `${profileId}.json`);
  }

  async read(profileId: string): Promise<RecoveryJournalDocument | null> {
    const file = this.path(profileId);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as RecoveryJournalDocument;
  }

  async write(document: RecoveryJournalDocument): Promise<void> {
    if (this.failWrite) throw new Error("RECOVERY_JOURNAL_UNAVAILABLE");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.path(document.profileId);
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(document, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  }

  document(profileId: string): RecoveryJournalDocument | null {
    const file = this.path(profileId);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as RecoveryJournalDocument;
  }
}

async function setup(): Promise<Env> {
  const root = mkdtempSync(join(tmpdir(), "s2-b-journal-"));
  const dbPath = join(root, "ledger.sqlite3");
  const journalDir = join(root, "app-data", "transfer-recovery");
  const db = new NodeSqliteDatabase(new DatabaseSync(dbPath));
  await migrateDatabase(db, NOW);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [
        { name: "A", balance: "1000", includeInSafetyResources: true },
        { name: "B", balance: "700", includeInSafetyResources: true },
      ],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    TODAY,
  );
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new Error("onboarding did not create a profile");
  const accounts = await repositories.cashAccountsAt(TODAY, profile.id);
  const accountA = accounts.find((account) => account.name === "A")?.id;
  const accountB = accounts.find((account) => account.name === "B")?.id;
  if (!accountA || !accountB) throw new Error("cash accounts missing");
  const channel = new FileJournalChannel(journalDir);
  const journal = new RecoveryJournal(channel);
  resetRecoveryState();
  markRecoveryComplete(profile.id);
  const env: Env = {
    root,
    dbPath,
    journalDir,
    db,
    journal,
    channel,
    profileId: profile.id,
    accountA,
    accountB,
  };
  envs.push(env);
  return env;
}

async function count(db: SqlDatabase, sql: string): Promise<number> {
  const rows = await db.select(sql);
  return Number((rows[0] as { c: number }).c);
}

async function balances(db: SqlDatabase): Promise<Record<string, string>> {
  const rows = await db.select(
    "SELECT account_id, balance FROM cash_account_revisions ORDER BY account_id, as_of_date DESC, revision_id DESC",
  );
  const latest: Record<string, string> = {};
  for (const row of rows as { account_id: string; balance: string }[]) {
    if (!(row.account_id in latest)) latest[row.account_id] = row.balance;
  }
  return latest;
}

function transferInput(accountA: string, accountB: string, id: string, amount = "300") {
  return { id, fromAccountId: accountA, toAccountId: accountB, amount, occurredOn: TODAY };
}

/**
 * The child process is plain ESM over the compiled output: it proves that the journal
 * file and the committed rows outlive the process that wrote them.
 */
function childScript(): string {
  const lines = [
    'import { DatabaseSync } from "node:sqlite";',
    'import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "import { migrateDatabase } from " +
      JSON.stringify(join(process.cwd(), "dist/persistence/migrations.js")) +
      ";",
    "import { Repositories } from " +
      JSON.stringify(join(process.cwd(), "dist/persistence/repositories.js")) +
      ";",
    "import { RecoveryJournal } from " +
      JSON.stringify(join(process.cwd(), "dist/persistence/recovery-journal.js")) +
      ";",
    "",
    "const [dbPath, journalDir, profileId, transferId, mode, accountA, accountB] = process.argv.slice(2);",
    "",
    "class Db {",
    "  constructor(path) {",
    "    this.connection = new DatabaseSync(path);",
    '    this.connection.exec("PRAGMA foreign_keys = ON");',
    "  }",
    "  async open() {}",
    "  async execute(sql, bindValues = []) {",
    "    const result = this.connection.prepare(sql).run(...bindValues);",
    "    return { rowsAffected: Number(result.changes) };",
    "  }",
    "  async select(sql, bindValues = []) {",
    "    return this.connection.prepare(sql).all(...bindValues);",
    "  }",
    "  async transaction(work) {",
    '    this.connection.exec("BEGIN IMMEDIATE");',
    "    try {",
    "      const result = await work(this);",
    '      this.connection.exec("COMMIT");',
    "      return result;",
    "    } catch (error) {",
    '      this.connection.exec("ROLLBACK");',
    "      throw error;",
    "    }",
    "  }",
    "  close() { this.connection.close(); }",
    "}",
    "",
    "const channel = {",
    "  async read(profile) {",
    "    try {",
    "      return JSON.parse(readFileSync(join(journalDir, profile + '.json'), 'utf8'));",
    "    } catch (error) {",
    "      return null;",
    "    }",
    "  },",
    "  async write(document) {",
    "    mkdirSync(journalDir, { recursive: true, mode: 0o700 });",
    "    const file = join(journalDir, document.profileId + '.json');",
    "    const temporary = file + '.tmp';",
    "    writeFileSync(temporary, JSON.stringify(document, null, 2), { mode: 0o600 });",
    "    renameSync(temporary, file);",
    "  },",
    "};",
    "",
    "const db = new Db(dbPath);",
    'await migrateDatabase(db, "2026-11-06T00:00:00.000Z");',
    "const journal = new RecoveryJournal(channel);",
    'const entry = await journal.append(profileId, { transferId, operation: "CREATE" });',
    "",
    'if (mode === "commit") {',
    "  const repositories = new Repositories(db);",
    "  await db.transaction(async (tx) => {",
    "    await repositories.recordTransferInTransaction(",
    "      {",
    "        id: transferId,",
    "        fromAccountId: accountA,",
    "        toAccountId: accountB,",
    '        amount: "300",',
    '        occurredOn: "2026-11-06",',
    '        note: "",',
    "      },",
    "      profileId,",
    '      "2026-11-06",',
    '      "2026-11-06T00:00:00.000Z",',
    "    );",
    "  });",
    "  console.log(JSON.stringify({ journalId: entry.journalId, committed: true }));",
    "  db.close();",
    "  process.exit(0);",
    "}",
    "",
    "db.close();",
    "process.exit(7);",
  ];
  return lines.join("\n");
}

function runChild(env: Env, transferId: string, mode: "commit" | "crash-after-journal") {
  const scriptPath = join(env.root, `child-${mode}.mjs`);
  writeFileSync(scriptPath, childScript(), "utf8");
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      env.dbPath,
      env.journalDir,
      env.profileId,
      transferId,
      mode,
      env.accountA,
      env.accountB,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
}

describe("recovery journal", () => {
  it("T-39 the entry is durable on disk before the transaction starts and gone after it commits", async () => {
    const env = await setup();
    const transferId = "11111111-1111-4111-8111-111111111111";
    let seenDuringTransaction: RecoveryJournalDocument | null = null;

    env.db.hooks = {
      afterBegin: () => {
        seenDuringTransaction = env.channel.document(env.profileId);
      },
    };

    await createLedgerTransfer(
      env.db,
      env.journal,
      transferInput(env.accountA, env.accountB, transferId),
      TODAY,
    );

    const entriesDuring = seenDuringTransaction as RecoveryJournalDocument | null;
    expect(entriesDuring).not.toBeNull();
    expect(entriesDuring?.entries.map((entry) => [entry.transferId, entry.state])).toEqual([
      [transferId, "PENDING"],
    ]);
    expect(env.channel.document(env.profileId)?.entries).toEqual([]);
    expect(await balances(env.db)).toEqual({ [env.accountA]: "700", [env.accountB]: "1000" });
  });

  it("T-40 a journal that cannot be written refuses the transfer before any transaction starts", async () => {
    const env = await setup();
    const before = {
      records: await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records"),
      legs: await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs"),
      revisions: await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions"),
      balances: await balances(env.db),
    };
    let transactions = 0;
    const original = env.db.transaction.bind(env.db);
    env.db.transaction = async (work) => {
      transactions += 1;
      return original(work);
    };
    env.channel.failWrite = true;

    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, "22222222-2222-4222-8222-222222222222"),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_JOURNAL_UNAVAILABLE" });

    expect(transactions).toBe(0);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(before.records);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(before.legs);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(
      before.revisions,
    );
    expect(await balances(env.db)).toEqual(before.balances);
  });

  it("T-41 a faulted connection writes no lock but the journal keeps the fact", async () => {
    const env = await setup();
    const transferId = "33333333-3333-4333-8333-333333333333";
    env.db.transactionErrors = true;
    env.db.hooks = {
      afterCommit: () => {
        throw new Error("database connection is faulted");
      },
    };
    const execute = env.db.execute.bind(env.db);
    env.db.execute = async (sql: string, bindValues: unknown[] = []) => {
      if (sql.includes("transfer_outcome_locks")) throw new Error("database connection is faulted");
      return execute(sql, bindValues);
    };

    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, transferId),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_OUTCOME_UNKNOWN" });

    env.db.execute = execute;
    env.db.hooks = null;
    env.db.transactionErrors = false;

    expect(await env.db.select("SELECT transfer_id FROM transfer_outcome_locks")).toEqual([]);
    expect(
      env.channel.document(env.profileId)?.entries.map((entry) => [entry.transferId, entry.state]),
    ).toEqual([[transferId, "PENDING"]]);
    await expect(
      editLedgerTransfer(env.db, env.journal, { id: transferId, amount: "310" }, TODAY),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
  });

  it("T-42 a real child process commits, dies, and the next process recovers it", async () => {
    const env = await setup();
    const transferId = "44444444-4444-4444-8444-444444444444";
    const child = runChild(env, transferId, "commit");
    expect(child.status, child.stderr).toBe(0);

    expect(env.channel.document(env.profileId)?.entries.map((entry) => entry.state)).toEqual([
      "PENDING",
    ]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);
    const before = await balances(env.db);
    const legsBefore = await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs");

    const report = await recoverFromJournal(env.db, env.journal, env.profileId);

    expect(report.complete).toBe(true);
    expect(report.entries.map((entry) => entry.outcome)).toEqual(["RESOLVED"]);
    const document = env.channel.document(env.profileId);
    expect(document?.entries).toEqual([]);
    expect(document?.archive.map((entry) => [entry.transferId, entry.state])).toEqual([
      [transferId, "RESOLVED"],
    ]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);
    expect(await balances(env.db)).toEqual(before);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(legsBefore);
  });

  it("T-43 a rolled-back commit with no business row is parked for review, never repaired", async () => {
    const env = await setup();
    const transferId = "55555555-5555-4555-8555-555555555555";
    env.db.transactionErrors = true;
    env.db.hooks = {
      beforeCommit: () => {
        throw new Error("COMMIT failed");
      },
      beforeRollback: () => {
        throw new Error("database connection is faulted");
      },
    };

    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, transferId),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_OUTCOME_UNKNOWN" });
    env.db.hooks = null;
    env.db.transactionErrors = false;
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);

    const report = await recoverFromJournal(env.db, env.journal, env.profileId);

    expect(report.entries.map((entry) => entry.outcome)).toEqual(["MANUAL_REVIEW_NO_RECORD"]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(env.channel.document(env.profileId)?.entries.map((entry) => entry.state)).toEqual([
      "MANUAL_REVIEW",
    ]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(0);
  });

  it("T-44 a child that dies right after the journal write leaves the id locked", async () => {
    const env = await setup();
    const transferId = "66666666-6666-4666-8666-666666666666";
    const child = runChild(env, transferId, "crash-after-journal");
    expect(child.status).toBe(7);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);

    const report = await recoverFromJournal(env.db, env.journal, env.profileId);

    expect(report.entries.map((entry) => entry.outcome)).toEqual(["MANUAL_REVIEW_NO_RECORD"]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, transferId),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
  });

  it("T-45 repeated startup scans are idempotent", async () => {
    const env = await setup();
    const transferId = "77777777-7777-4777-8777-777777777777";
    env.db.transactionErrors = true;
    env.db.hooks = {
      beforeCommit: () => {
        throw new Error("COMMIT failed");
      },
      beforeRollback: () => {
        throw new Error("database connection is faulted");
      },
    };
    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, transferId),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_OUTCOME_UNKNOWN" });
    env.db.hooks = null;
    env.db.transactionErrors = false;

    const first = await recoverFromJournal(env.db, env.journal, env.profileId);
    const revisions = await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions");
    const legs = await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs");
    const second = await recoverFromJournal(env.db, env.journal, env.profileId);
    const third = await recoverFromJournal(env.db, env.journal, env.profileId);

    expect(first.entries.map((entry) => entry.outcome)).toEqual(["MANUAL_REVIEW_NO_RECORD"]);
    for (const report of [second, third]) {
      expect(report.entries.map((entry) => entry.outcome)).toEqual(["SKIPPED_ALREADY_REVIEWED"]);
    }
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisions);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(legs);
  });

  it("T-46 a corrupt journal and a foreign profileId both fail closed without being rewritten", async () => {
    const env = await setup();
    mkdirSync(env.journalDir, { recursive: true, mode: 0o700 });
    const journalPath = join(env.journalDir, `${env.profileId}.json`);
    writeFileSync(journalPath, "{ not json", { mode: 0o600 });
    const corruptBefore = readFileSync(journalPath, "utf8");

    await expect(recoverFromJournal(env.db, env.journal, env.profileId)).rejects.toMatchObject({
      code: "RECOVERY_JOURNAL_UNREADABLE",
    });
    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        transferInput(env.accountA, env.accountB, "88888888-8888-4888-8888-888888888888"),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_JOURNAL_UNREADABLE" });
    expect(readFileSync(journalPath, "utf8")).toBe(corruptBefore);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);

    const foreign = {
      journalFormatVersion: RECOVERY_JOURNAL_FORMAT_VERSION,
      profileId: "someone-else",
      entries: [],
      archive: [],
    };
    writeFileSync(journalPath, JSON.stringify(foreign), { mode: 0o600 });
    const foreignBefore = readFileSync(journalPath, "utf8");

    await expect(recoverFromJournal(env.db, env.journal, env.profileId)).rejects.toMatchObject({
      code: "RECOVERY_JOURNAL_UNREADABLE",
    });
    expect(readFileSync(journalPath, "utf8")).toBe(foreignBefore);
  });

  it("T-51 a recovery lock write failure keeps the gate closed and the journal intact (F2)", async () => {
    const env = await setup();
    // setup() opens the gate for the transfer tests; recovery must close it again.
    resetRecoveryState();
    const pendingId = "99999999-9999-4999-8999-999999999991";
    const lockedId = "99999999-9999-4999-8999-999999999992";
    const reviewId = "99999999-9999-4999-8999-999999999993";
    await env.journal.append(env.profileId, { transferId: pendingId, operation: "CREATE" });
    const locked = await env.journal.append(env.profileId, {
      transferId: lockedId,
      operation: "EDIT",
    });
    await env.journal.setState(env.profileId, locked.journalId, "LOCKED");
    const review = await env.journal.append(env.profileId, {
      transferId: reviewId,
      operation: "DELETE",
    });
    await env.journal.setState(env.profileId, review.journalId, "MANUAL_REVIEW");

    const before = {
      records: await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records"),
      legs: await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs"),
      revisions: await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions"),
      balances: await balances(env.db),
    };

    // Real SQLite failure at the lock table, not a mocked return value.
    await env.db.execute(
      "CREATE TRIGGER fail_outcome_lock BEFORE INSERT ON transfer_outcome_locks " +
        "BEGIN SELECT RAISE(ABORT, 'lock table write failed'); END",
    );

    const first = await recoverFromJournal(env.db, env.journal, env.profileId);
    expect(first.complete).toBe(false);
    expect(first.entries.map((entry) => entry.outcome)).toEqual([
      "MANUAL_REVIEW_INCOMPLETE",
      "MANUAL_REVIEW_INCOMPLETE",
      "SKIPPED_ALREADY_REVIEWED",
    ]);
    expect(isRecoveryComplete(env.profileId)).toBe(false);

    // The journal is retained exactly as it was: nothing was advanced or removed.
    expect(
      env.channel.document(env.profileId)?.entries.map((entry) => [entry.transferId, entry.state]),
    ).toEqual([
      [pendingId, "PENDING"],
      [lockedId, "LOCKED"],
      [reviewId, "MANUAL_REVIEW"],
    ]);
    expect(env.channel.document(env.profileId)?.archive).toEqual([]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);

    // Every write entry point stays behind RECOVERY_INCOMPLETE; none is repaired or replayed.
    await expect(
      editLedgerTransfer(env.db, env.journal, { id: pendingId, amount: "310" }, TODAY),
    ).rejects.toMatchObject({ code: "RECOVERY_INCOMPLETE" });
    await expect(deleteLedgerTransfer(env.db, env.journal, pendingId, TODAY)).rejects.toMatchObject(
      { code: "RECOVERY_INCOMPLETE" },
    );
    await expect(
      restoreLedgerTransfer(env.db, env.journal, pendingId, TODAY),
    ).rejects.toMatchObject({ code: "RECOVERY_INCOMPLETE" });

    // A second startup is still pending review, with the same fail-closed verdict.
    const second = await recoverFromJournal(env.db, env.journal, env.profileId);
    expect(second.complete).toBe(false);
    expect(second.entries.map((entry) => entry.outcome)).toEqual([
      "MANUAL_REVIEW_INCOMPLETE",
      "MANUAL_REVIEW_INCOMPLETE",
      "SKIPPED_ALREADY_REVIEWED",
    ]);
    expect(isRecoveryComplete(env.profileId)).toBe(false);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(before.records);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(before.legs);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(
      before.revisions,
    );
    expect(await balances(env.db)).toEqual(before.balances);

    // Only once the lock is durable may recovery judge the entries read-only and complete.
    await env.db.execute("DROP TRIGGER fail_outcome_lock");
    const third = await recoverFromJournal(env.db, env.journal, env.profileId);
    expect(third.complete).toBe(true);
    expect(third.entries.map((entry) => entry.outcome)).toEqual([
      "MANUAL_REVIEW_NO_RECORD",
      "MANUAL_REVIEW_NO_RECORD",
      "SKIPPED_ALREADY_REVIEWED",
    ]);
    expect(isRecoveryComplete(env.profileId)).toBe(true);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(2);
    expect(
      env.channel.document(env.profileId)?.entries.map((entry) => [entry.transferId, entry.state]),
    ).toEqual([
      [pendingId, "MANUAL_REVIEW"],
      [lockedId, "MANUAL_REVIEW"],
      [reviewId, "MANUAL_REVIEW"],
    ]);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_records")).toBe(before.records);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM transfer_legs")).toBe(before.legs);
    expect(await count(env.db, "SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(
      before.revisions,
    );
    expect(await balances(env.db)).toEqual(before.balances);
  });
});
