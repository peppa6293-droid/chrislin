import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../src/application/product-service.js";
import {
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
import {
  ApplicationDataError,
  type ExecuteResult,
  type SqlDatabase,
} from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  RecoveryJournal,
  type RecoveryJournalChannel,
  type RecoveryJournalDocument,
} from "../src/persistence/recovery-journal.js";
import {
  Repositories,
  readCurrentTransferLegs,
  transferToken,
} from "../src/persistence/repositories.js";
import { outcomeOf, TransactionError } from "../src/persistence/transaction-errors.js";
import { localDate } from "../src/ui/date.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// B-xfer 实施批 T-1..T-32（PRE-EXEC §4）。每条都跑真实 SQLite；驱动边界注入只落在
// 夹具（tests/helpers/node-sqlite.ts 的 hooks），业务代码里没有任何 `if (fault)` 开关。

const today = localDate(new Date());

function dayOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** In-memory journal channel: the file-level contract is covered by s2-b-recovery-journal. */
class MemoryJournalChannel implements RecoveryJournalChannel {
  document: RecoveryJournalDocument | null = null;
  writes = 0;
  attempts = 0;
  failWrite: string | null = null;
  /** Fail exactly attempt N (append is attempt 1, remove is attempt 2). */
  failWriteAt: number | null = null;

  async read(profileId: string): Promise<RecoveryJournalDocument | null> {
    void profileId;
    return this.document;
  }

  async write(document: RecoveryJournalDocument): Promise<void> {
    this.attempts += 1;
    if (this.failWrite !== null) throw new Error(this.failWrite);
    if (this.failWriteAt !== null && this.attempts === this.failWriteAt) {
      this.failWriteAt = null;
      throw new Error("journal write failed");
    }
    this.writes += 1;
    this.document = JSON.parse(JSON.stringify(document)) as RecoveryJournalDocument;
  }
}

/**
 * Test-only decorator: fails one `select` after the transaction committed, which is the only
 * way to reach the post-commit readback branch (T-31) without touching business code.
 */
class FaultyDatabase implements SqlDatabase {
  failSelectPattern: RegExp | null = null;
  private readbackFailureAfterCommit: RegExp | null = null;

  constructor(readonly inner: NodeSqliteDatabase) {}

  /** Arms a one-shot select failure for the first readback after the next successful COMMIT. */
  armReadbackFailure(pattern: RegExp): void {
    this.readbackFailureAfterCommit = pattern;
  }

  async open(): Promise<void> {
    return await this.inner.open();
  }

  async execute(sql: string, bindValues: unknown[] = []): Promise<ExecuteResult> {
    return await this.inner.execute(sql, bindValues);
  }

  async select<T extends Record<string, unknown>>(
    sql: string,
    bindValues: unknown[] = [],
  ): Promise<T[]> {
    if (this.failSelectPattern?.test(sql)) {
      this.failSelectPattern = null;
      throw new Error("database connection closed");
    }
    return await this.inner.select<T>(sql, bindValues);
  }

  async transaction<T>(work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T> {
    const result = await this.inner.transaction(work);
    if (this.readbackFailureAfterCommit !== null) {
      this.failSelectPattern = this.readbackFailureAfterCommit;
      this.readbackFailureAfterCommit = null;
    }
    return result;
  }
}

interface Seed {
  db: FaultyDatabase;
  sqlite: NodeSqliteDatabase;
  repositories: Repositories;
  journal: RecoveryJournal;
  channel: MemoryJournalChannel;
  profileId: string;
  cashA: string;
  cashB: string;
  cashC: string;
}

let seed: Seed;

async function seedDatabase(): Promise<Seed> {
  const sqlite = new NodeSqliteDatabase();
  const db = new FaultyDatabase(sqlite);
  const repositories = new Repositories(db);
  await migrateDatabase(db, `${today}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [
        { name: "A", balance: "1000", includeInSafetyResources: true },
        { name: "B", balance: "1000", includeInSafetyResources: true },
        { name: "C", balance: "1000", includeInSafetyResources: true },
      ],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    today,
  );
  const profile = await repositories.getProfile();
  if (!profile) throw new Error("onboarding did not create a profile");
  const accounts = await repositories.cashAccountsAt(today, profile.id);
  const pick = (name: string): string => {
    const found = accounts.find((account) => account.name === name)?.id;
    if (!found) throw new Error(`cash account ${name} missing`);
    return found;
  };
  const cashA = pick("A");
  const cashB = pick("B");
  const cashC = pick("C");
  for (const [id, name] of [
    [cashA, "A"],
    [cashB, "B"],
    [cashC, "C"],
  ] as const)
    await repositories.createAccount({
      id,
      profileId: profile.id,
      name,
      type: "CASH",
      currency: "CNY",
    });
  // One snapshot per account, 30 days back: past-dated legs stay readable, and an earlier
  // operation date yields BALANCE_FACT_MISSING (used by T-29/T-32).
  for (const accountId of [cashA, cashB, cashC]) {
    await db.execute("DELETE FROM cash_balance_snapshots WHERE account_id=?", [accountId]);
    await repositories.saveCashSnapshot(
      { id: `${accountId}-start`, accountId, asOfDate: dayOffset(-30), balance: "1000" },
      `${today}T00:00:00.000Z`,
    );
  }
  const channel = new MemoryJournalChannel();
  return {
    db,
    sqlite,
    repositories,
    journal: new RecoveryJournal(channel),
    channel,
    profileId: profile.id,
    cashA,
    cashB,
    cashC,
  };
}

async function balanceOf(accountId: string, asOfDate = today): Promise<number> {
  const accounts = await seed.repositories.cashAccountsAt(asOfDate, seed.profileId);
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error(`account ${accountId} missing at ${asOfDate}`);
  return Number(account.balance);
}

async function count(sql: string, bindValues: unknown[] = []): Promise<number> {
  const row = (await seed.db.select<{ c: number }>(sql, bindValues))[0];
  return Number(row?.c ?? 0);
}

async function rows(sql: string, bindValues: unknown[] = []): Promise<Record<string, unknown>[]> {
  return await seed.db.select(sql, bindValues);
}

function codeOf(error: unknown): string {
  return error instanceof ApplicationDataError
    ? error.code
    : `NOT_APPLICATION_DATA_ERROR:${String(error)}`;
}

beforeEach(async () => {
  resetRecoveryState();
  seed = await seedDatabase();
  markRecoveryComplete(seed.profileId);
});

afterEach(() => {
  seed.sqlite.close();
});

describe("B-xfer transfer legs (T-1..T-20)", () => {
  it("T-1 records one revision per leg and conserves the total", async () => {
    const before = (await balanceOf(seed.cashA)) + (await balanceOf(seed.cashB));
    const { transferId } = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, transferId);
    expect(legs.map((leg) => leg.side)).toEqual(["IN", "OUT"]);
    expect(legs.every((leg) => leg.state === "APPLIED")).toBe(true);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);
    expect((await balanceOf(seed.cashA)) + (await balanceOf(seed.cashB))).toBe(before);
    expect(
      await count("SELECT COUNT(*) AS c FROM cash_account_revisions WHERE source_payment_id=?", [
        transferToken(transferId, "OUT", "deduct"),
      ]),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS c FROM cash_account_revisions WHERE source_payment_id=?", [
        transferToken(transferId, "IN", "deduct"),
      ]),
    ).toBe(1);
  });

  it("T-2 editing the amount reverses both legs and advances applied_on", async () => {
    const first = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-5),
      },
      today,
    );
    const before = await readCurrentTransferLegs(seed.db, seed.profileId, first.transferId);
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: first.transferId, amount: "500", occurredOn: today },
      today,
    );
    const after = await readCurrentTransferLegs(seed.db, seed.profileId, first.transferId);
    expect(after.every((leg) => leg.appliedOn === today)).toBe(true);
    expect(before.every((leg) => leg.appliedOn === dayOffset(-5))).toBe(true);
    for (const side of ["OUT", "IN"] as const) {
      expect(
        await count("SELECT COUNT(*) AS c FROM cash_account_revisions WHERE source_payment_id=?", [
          transferToken(first.transferId, side, "reverse"),
        ]),
      ).toBe(1);
    }
    expect(await balanceOf(seed.cashA)).toBe(500);
    expect(await balanceOf(seed.cashB)).toBe(1500);
  });

  it("T-3 a transfer never enters income/expense statistics", async () => {
    const sumBefore = await count("SELECT COALESCE(SUM(amount),0) AS c FROM expenses");
    await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    expect(await count("SELECT COALESCE(SUM(amount),0) AS c FROM expenses")).toBe(sumBefore);
    expect(await count("SELECT COUNT(*) AS c FROM expenses")).toBe(0);
  });

  it("T-4 switching the incoming account keeps the OUT leg applied_on untouched", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-10),
      },
      today,
    );
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, toAccountId: seed.cashC },
      today,
    );
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    const out = legs.find((leg) => leg.side === "OUT");
    const incoming = legs.find((leg) => leg.side === "IN");
    expect(out?.appliedOn).toBe(dayOffset(-10));
    expect(incoming?.accountId).toBe(seed.cashC);
    expect(incoming?.appliedOn).toBe(today);
    expect(await balanceOf(seed.cashB)).toBe(1000);
    expect(await balanceOf(seed.cashC)).toBe(1300);
    const ended = await rows(
      "SELECT side,end_reason FROM transfer_legs WHERE transfer_id=? AND ended_on IS NOT NULL",
      [created.transferId],
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]?.end_reason).toBe("REVERSED");
  });

  it("T-5 deleting reverses both legs and marks the record", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    expect(await balanceOf(seed.cashA)).toBe(1000);
    expect(await balanceOf(seed.cashB)).toBe(1000);
    const record = (
      await rows("SELECT deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(record?.deleted_at).not.toBeNull();
  });

  it("T-6 restoring rewrites both legs with today's applied_on", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-7),
      },
      today,
    );
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    await restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    expect(legs.every((leg) => leg.state === "APPLIED")).toBe(true);
    expect(legs.every((leg) => leg.appliedOn === today)).toBe(true);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);
  });

  it("T-11 from == to is refused with zero writes", async () => {
    await expect(
      createLedgerTransfer(
        seed.db,
        seed.journal,
        { fromAccountId: seed.cashA, toAccountId: seed.cashA, amount: "300", occurredOn: today },
        today,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_SAME" });
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);
    expect(seed.channel.writes).toBe(0);
  });

  it("T-12 rejects zero, negative and three-decimal amounts", async () => {
    for (const amount of ["0", "-100", "10.001"]) {
      await expect(
        createLedgerTransfer(
          seed.db,
          seed.journal,
          { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount, occurredOn: today },
          today,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TRANSFER_AMOUNT" });
    }
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);
  });

  it("T-13 delete twice / restore an undeleted transfer are refused", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await expect(
      restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_DELETED" });
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    await expect(
      deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_DELETED" });
  });

  it("T-15/T-17 another profile's transfer is invisible and stays untouched", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    const snapshot = JSON.stringify([
      await rows("SELECT * FROM transfer_records ORDER BY id"),
      await rows("SELECT * FROM transfer_legs ORDER BY id"),
      await rows("SELECT * FROM cash_account_revisions ORDER BY revision_id"),
    ]);
    const foreign = "00000000-0000-4000-8000-000000000000";
    const repositories = new Repositories(seed.db);
    await expect(
      repositories.deleteTransferInTransaction(
        created.transferId,
        foreign,
        today,
        new Date().toISOString(),
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });
    await expect(
      repositories.changeTransferInTransaction(
        created.transferId,
        { amount: "400" },
        foreign,
        today,
        new Date().toISOString(),
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });
    await expect(
      repositories.restoreTransferInTransaction(
        created.transferId,
        foreign,
        today,
        new Date().toISOString(),
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });
    const after = JSON.stringify([
      await rows("SELECT * FROM transfer_records ORDER BY id"),
      await rows("SELECT * FROM transfer_legs ORDER BY id"),
      await rows("SELECT * FROM cash_account_revisions ORDER BY revision_id"),
    ]);
    expect(after).toBe(snapshot);
  });

  it("T-19 each leg keeps its own applied_on date", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-10),
      },
      today,
    );
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, toAccountId: seed.cashC },
      today,
    );
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    const applied = legs.map((leg) => [leg.side, leg.appliedOn] as const);
    expect(applied).toEqual([
      ["IN", today],
      ["OUT", dayOffset(-10)],
    ]);
  });

  it("T-20 editing a SUPPRESSED leg never writes a compensating revision", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    // Manual fact on A after the leg: the leg must be suppressed, not reversed over the barrier.
    await seed.db.execute(
      `INSERT INTO cash_account_revisions(account_id,name,include_in_safety_resources,as_of_date,balance,revision_id,source_payment_id,created_at)
       VALUES(?,?,?,?,?,?,NULL,?)`,
      [seed.cashA, "A", 1, dayOffset(1), "250", 9001, today],
    );
    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "400" },
      today,
    );
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    const out = legs.find((leg) => leg.side === "OUT");
    expect(out?.state).toBe("SUPPRESSED");
    expect(await balanceOf(seed.cashA, dayOffset(1))).toBe(250);
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBeGreaterThanOrEqual(
      revisionsBefore,
    );
  });

  it("T-22 a missing leg locks the transfer and blocks every later write", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await seed.db.execute("DELETE FROM transfer_legs WHERE transfer_id=? AND side='IN'", [
      created.transferId,
    ]);
    const legsBefore = await count("SELECT COUNT(*) AS c FROM transfer_legs");
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "350" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LEG_MISSING" });
    const lock = (
      await rows("SELECT reason FROM transfer_outcome_locks WHERE transfer_id=?", [
        created.transferId,
      ])
    )[0];
    expect(lock?.reason).toBe("TRANSFER_LEG_MISSING");
    expect(await count("SELECT COUNT(*) AS c FROM transfer_legs")).toBe(legsBefore);
    for (const attempt of [
      () =>
        editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "360" }, today),
      () => deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today),
      () => restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
  });

  it("T-23 each mutation opens exactly one transaction", async () => {
    let transactions = 0;
    const original = seed.sqlite.transaction.bind(seed.sqlite);
    seed.sqlite.transaction = async <T>(work: (db: SqlDatabase) => Promise<T>): Promise<T> => {
      transactions += 1;
      return await original(work);
    };
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    expect(transactions).toBe(1);
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "310" },
      today,
    );
    expect(transactions).toBe(2);
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    expect(transactions).toBe(3);
    await restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    expect(transactions).toBe(4);
  });

  it("T-25 an in-transaction readback mismatch rolls back without a lock", async () => {
    const transferId = "11111111-1111-4111-8111-111111111111";
    // A stale token row with the wrong balance at a later date makes the in-transaction readback
    // pick the wrong row: this is the "readback says no" branch, not "commit says maybe".
    await seed.db.execute(
      `INSERT INTO cash_account_revisions(account_id,name,include_in_safety_resources,as_of_date,balance,revision_id,source_payment_id,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        seed.cashA,
        "A",
        1,
        dayOffset(5),
        "999999",
        999,
        transferToken(transferId, "OUT", "deduct"),
        today,
      ],
    );
    await expect(
      createLedgerTransfer(
        seed.db,
        seed.journal,
        {
          id: transferId,
          fromAccountId: seed.cashA,
          toAccountId: seed.cashB,
          amount: "300",
          occurredOn: today,
        },
        today,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_READBACK_FAILED" });
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records WHERE id=?", [transferId])).toBe(
      0,
    );
    expect(
      await count("SELECT COUNT(*) AS c FROM transfer_legs WHERE transfer_id=?", [transferId]),
    ).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);
    expect(await seed.journal.entries(seed.profileId)).toHaveLength(0);
  });

  it("T-26 a locked transfer is unlocked only by a complete readback", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await seed.repositories.lockTransferOutcomeSafely(
      created.transferId,
      seed.profileId,
      "test/lock",
    );
    expect(await seed.repositories.isOutcomeLocked(created.transferId)).toBe(true);
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "320" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(
      await seed.repositories.resolveTransferOutcome(created.transferId, seed.profileId, "CREATE"),
    ).toBe(true);
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "320" },
      today,
    );
    expect(await balanceOf(seed.cashA)).toBe(680);
  });

  it("T-27 readback reads the latest token row and binds the account", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "200" },
      today,
    );
    await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "250" },
      today,
    );
    // A newer row under the same token wins the "latest token row" lookup and no longer
    // matches the leg amount, so the in-transaction readback must refuse the write.
    await seed.db.execute(
      `INSERT INTO cash_account_revisions(account_id,name,include_in_safety_resources,as_of_date,balance,revision_id,source_payment_id,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        seed.cashA,
        "A",
        1,
        dayOffset(1),
        "999999",
        999999,
        transferToken(created.transferId, "OUT", "deduct"),
        today,
      ],
    );
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "260" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_READBACK_FAILED" });
  });

  it("T-29 a deterministic callback failure is reported per-phase, with no lock", async () => {
    seed.sqlite.transactionErrors = true;
    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-90),
      },
      today,
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TransactionError);
    const failure = error as TransactionError;
    expect(failure.phase).toBe("callback");
    expect(failure.rollbackFailed).toBe(false);
    expect(outcomeOf(failure)).toBe("DETERMINISTIC");
    expect((failure.cause as { code?: string }).code).toBe("BALANCE_FACT_MISSING");
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);
  });

  it("T-30/T-28 a commit-phase reply loss is UNKNOWN, pre-generates the id and locks it", async () => {
    const transferId = "22222222-2222-4222-8222-222222222222";
    seed.sqlite.transactionErrors = true;
    seed.sqlite.hooks = {
      afterCommit: () => {
        throw new Error("invoke(database_commit) failed");
      },
    };
    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        id: transferId,
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: today,
      },
      today,
    ).catch((cause: unknown) => cause);
    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("commit");
    const lock = (await rows("SELECT transfer_id,detail FROM transfer_outcome_locks"))[0];
    expect(lock?.transfer_id).toBe(transferId);
    expect(String(lock?.detail).startsWith("commit/")).toBe(true);
    // The COMMIT really happened: the rows are there, which is why the verdict must be UNKNOWN.
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records WHERE id=?", [transferId])).toBe(
      1,
    );
    seed.sqlite.hooks = null;
    seed.sqlite.transactionErrors = false;
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: transferId, amount: "310" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
  });

  it("T-31 a post-commit readback failure locks the committed transfer", async () => {
    seed.db.failSelectPattern = /FROM transfer_records WHERE id=\? AND profile_id=\?/;
    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    ).catch((cause: unknown) => cause);
    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);
  });

  it("T-32 a failing ROLLBACK keeps the original cause and turns UNKNOWN", async () => {
    seed.sqlite.transactionErrors = true;
    seed.sqlite.hooks = {
      beforeRollback: () => {
        throw new Error("cannot rollback - not authorized");
      },
    };
    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-90),
      },
      today,
    ).catch((cause: unknown) => cause);
    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    const failure = (error as Error).cause as TransactionError;
    expect(failure.phase).toBe("callback");
    expect(failure.rollbackFailed).toBe(true);
    expect((failure.cause as { code?: string }).code).toBe("BALANCE_FACT_MISSING");
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(0);
  });

  it("reverse: an input validation error never becomes a TransactionError", async () => {
    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "0", occurredOn: today },
      today,
    ).catch((cause: unknown) => cause);
    expect(error).not.toBeInstanceOf(TransactionError);
    expect(codeOf(error)).toBe("INVALID_TRANSFER_AMOUNT");
  });
});

describe("B-xfer journal finalization (T-47..T-50, F1)", () => {
  function failFinalization(): void {
    // append is write attempt 1, journal.remove is attempt 2: fail only the finalization.
    seed.channel.attempts = 0;
    seed.channel.failWriteAt = 2;
  }

  async function revisionCount(
    transferId: string,
    side: "IN" | "OUT",
    mode: "deduct" | "reverse",
  ): Promise<number> {
    return await count(
      "SELECT COUNT(*) AS c FROM cash_account_revisions WHERE source_payment_id=?",
      [transferToken(transferId, side, mode)],
    );
  }

  function retainedEntries(): RecoveryJournalDocument["entries"] {
    return seed.channel.document?.entries ?? [];
  }

  it("T-47 create: a failed journal finalization after COMMIT is UNKNOWN, not a failure", async () => {
    const transferId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    failFinalization();

    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        id: transferId,
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: today,
      },
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    const failure = (error as Error).cause;
    expect(failure).toBeInstanceOf(TransactionError);
    expect((failure as TransactionError).phase).toBe("post_commit");

    // The business write happened exactly once and stays.
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records WHERE id=?", [transferId])).toBe(
      1,
    );
    expect(
      await count("SELECT COUNT(*) AS c FROM transfer_legs WHERE transfer_id=?", [transferId]),
    ).toBe(2);
    expect(await revisionCount(transferId, "OUT", "deduct")).toBe(1);
    expect(await revisionCount(transferId, "IN", "deduct")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);

    // The journal entry is retained in a conservative state and is not archived.
    const retained = retainedEntries();
    expect(retained).toHaveLength(1);
    expect(retained[0]?.transferId).toBe(transferId);
    expect(retained[0]?.state).not.toBe("RESOLVED");
    expect(seed.channel.document?.archive).toEqual([]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      createLedgerTransfer(
        seed.db,
        seed.journal,
        {
          id: transferId,
          fromAccountId: seed.cashA,
          toAccountId: seed.cashB,
          amount: "300",
          occurredOn: today,
        },
        today,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });

    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
  });

  it("T-48 edit: a failed journal finalization after COMMIT is UNKNOWN and blocks a second edit", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-5),
      },
      today,
    );
    failFinalization();

    const error = await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "500", occurredOn: today },
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");

    const record = (
      await rows("SELECT amount, deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(String(record?.amount)).toBe("500");
    expect(record?.deleted_at ?? null).toBeNull();
    expect(await revisionCount(created.transferId, "OUT", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "IN", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(500);
    expect(await balanceOf(seed.cashB)).toBe(1500);

    const retained = retainedEntries();
    expect(retained).toHaveLength(1);
    expect(retained[0]?.transferId).toBe(created.transferId);
    expect(retained[0]?.state).not.toBe("RESOLVED");
    expect(seed.channel.document?.archive).toEqual([]);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "600" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });

    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    const after = (
      await rows("SELECT amount FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(String(after?.amount)).toBe("500");
  });

  it("T-49 delete: a failed journal finalization after COMMIT is UNKNOWN and blocks a second delete", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    failFinalization();

    const error = await deleteLedgerTransfer(
      seed.db,
      seed.journal,
      created.transferId,
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");

    const record = (
      await rows("SELECT deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(record?.deleted_at ?? null).not.toBeNull();
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    expect(legs.every((leg) => leg.state === "REVERSED")).toBe(true);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(1000);
    expect(await balanceOf(seed.cashB)).toBe(1000);

    const retained = retainedEntries();
    expect(retained).toHaveLength(1);
    expect(retained[0]?.transferId).toBe(created.transferId);
    expect(retained[0]?.state).not.toBe("RESOLVED");

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await balanceOf(seed.cashA)).toBe(1000);
    expect(await balanceOf(seed.cashB)).toBe(1000);
  });

  it("T-50 restore: a failed journal finalization after COMMIT is UNKNOWN and blocks a second restore", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    failFinalization();

    const error = await restoreLedgerTransfer(
      seed.db,
      seed.journal,
      created.transferId,
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");

    const record = (
      await rows("SELECT deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(record?.deleted_at ?? null).toBeNull();
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    expect(legs.every((leg) => leg.state === "APPLIED")).toBe(true);
    expect(await revisionCount(created.transferId, "OUT", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "IN", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);

    const retained = retainedEntries();
    expect(retained).toHaveLength(1);
    expect(retained[0]?.transferId).toBe(created.transferId);
    expect(retained[0]?.state).not.toBe("RESOLVED");

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);
  });
});

describe("B-xfer post-commit readback ordering (T-52..T-56, F3)", () => {
  const readbackPattern = /FROM transfer_records WHERE id=\? AND profile_id=\?/;

  function entries(): RecoveryJournalDocument["entries"] {
    return seed.channel.document?.entries ?? [];
  }

  function revisionCount(
    transferId: string,
    side: "IN" | "OUT",
    mode: "deduct" | "reverse",
  ): Promise<number> {
    return count("SELECT COUNT(*) AS c FROM cash_account_revisions WHERE source_payment_id=?", [
      transferToken(transferId, side, mode),
    ]);
  }

  function trackJournalRemoves(): () => number {
    let calls = 0;
    const original = seed.journal.remove.bind(seed.journal);
    seed.journal.remove = async (profileId: string, journalId: string) => {
      calls += 1;
      await original(profileId, journalId);
    };
    return () => calls;
  }

  it("T-52 create: a readback failure after COMMIT keeps the journal entry", async () => {
    const transferId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    const removes = trackJournalRemoves();
    seed.db.armReadbackFailure(readbackPattern);

    const error = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        id: transferId,
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: today,
      },
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records WHERE id=?", [transferId])).toBe(
      1,
    );
    expect(
      await count("SELECT COUNT(*) AS c FROM transfer_legs WHERE transfer_id=?", [transferId]),
    ).toBe(2);
    expect(await revisionCount(transferId, "OUT", "deduct")).toBe(1);
    expect(await revisionCount(transferId, "IN", "deduct")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);

    // The readback runs before finalization, so the journal entry was never removed.
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.transferId).toBe(transferId);
    expect(["PENDING", "LOCKED"]).toContain(entries()[0]?.state);
    expect(seed.channel.document?.archive).toEqual([]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(removes()).toBe(0);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      createLedgerTransfer(
        seed.db,
        seed.journal,
        {
          id: transferId,
          fromAccountId: seed.cashA,
          toAccountId: seed.cashB,
          amount: "300",
          occurredOn: today,
        },
        today,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_records")).toBe(1);
  });

  it("T-53 edit: a readback failure after COMMIT keeps the journal entry and blocks a second edit", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-5),
      },
      today,
    );
    const removes = trackJournalRemoves();
    seed.db.armReadbackFailure(readbackPattern);

    const error = await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "500", occurredOn: today },
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");
    const record = (
      await rows("SELECT amount FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(String(record?.amount)).toBe("500");
    expect(await revisionCount(created.transferId, "OUT", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "IN", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(500);
    expect(await balanceOf(seed.cashB)).toBe(1500);

    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.state).not.toBe("RESOLVED");
    expect(seed.channel.document?.archive).toEqual([]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(removes()).toBe(0);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      editLedgerTransfer(seed.db, seed.journal, { id: created.transferId, amount: "600" }, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    const after = (
      await rows("SELECT amount FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(String(after?.amount)).toBe("500");
  });

  it("T-54 delete: a readback failure after COMMIT keeps the journal entry and blocks a second delete", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    const removes = trackJournalRemoves();
    seed.db.armReadbackFailure(readbackPattern);

    const error = await deleteLedgerTransfer(
      seed.db,
      seed.journal,
      created.transferId,
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");
    const record = (
      await rows("SELECT deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(record?.deleted_at ?? null).not.toBeNull();
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    expect(legs.every((leg) => leg.state === "REVERSED")).toBe(true);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(1000);
    expect(await balanceOf(seed.cashB)).toBe(1000);

    expect(entries()).toHaveLength(1);
    expect(seed.channel.document?.archive).toEqual([]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(removes()).toBe(0);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await balanceOf(seed.cashA)).toBe(1000);
  });

  it("T-55 restore: a readback failure after COMMIT keeps the journal entry and blocks a second restore", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      { fromAccountId: seed.cashA, toAccountId: seed.cashB, amount: "300", occurredOn: today },
      today,
    );
    await deleteLedgerTransfer(seed.db, seed.journal, created.transferId, today);
    const removes = trackJournalRemoves();
    seed.db.armReadbackFailure(readbackPattern);

    const error = await restoreLedgerTransfer(
      seed.db,
      seed.journal,
      created.transferId,
      today,
    ).catch((cause: unknown) => cause);

    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(((error as Error).cause as TransactionError).phase).toBe("post_commit");
    const record = (
      await rows("SELECT deleted_at FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(record?.deleted_at ?? null).toBeNull();
    const legs = await readCurrentTransferLegs(seed.db, seed.profileId, created.transferId);
    expect(legs.every((leg) => leg.state === "APPLIED")).toBe(true);
    expect(await revisionCount(created.transferId, "OUT", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "IN", "deduct")).toBe(2);
    expect(await revisionCount(created.transferId, "OUT", "reverse")).toBe(1);
    expect(await revisionCount(created.transferId, "IN", "reverse")).toBe(1);
    expect(await balanceOf(seed.cashA)).toBe(700);
    expect(await balanceOf(seed.cashB)).toBe(1300);

    expect(entries()).toHaveLength(1);
    expect(seed.channel.document?.archive).toEqual([]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(removes()).toBe(0);

    const revisionsBefore = await count("SELECT COUNT(*) AS c FROM cash_account_revisions");
    await expect(
      restoreLedgerTransfer(seed.db, seed.journal, created.transferId, today),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
    expect(await count("SELECT COUNT(*) AS c FROM cash_account_revisions")).toBe(revisionsBefore);
    expect(await balanceOf(seed.cashA)).toBe(700);
  });

  it("T-56 an UNKNOWN readback failure survives a restart and recovery archives it", async () => {
    const created = await createLedgerTransfer(
      seed.db,
      seed.journal,
      {
        fromAccountId: seed.cashA,
        toAccountId: seed.cashB,
        amount: "300",
        occurredOn: dayOffset(-5),
      },
      today,
    );
    const removes = trackJournalRemoves();
    seed.db.armReadbackFailure(readbackPattern);

    const error = await editLedgerTransfer(
      seed.db,
      seed.journal,
      { id: created.transferId, amount: "500", occurredOn: today },
      today,
    ).catch((cause: unknown) => cause);
    expect(codeOf(error)).toBe("TRANSFER_OUTCOME_UNKNOWN");
    expect(entries()).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(1);
    expect(removes()).toBe(0);

    // Restart: a fresh channel over the persisted document and a fresh journal instance.
    resetRecoveryState();
    const restartedChannel = new MemoryJournalChannel();
    restartedChannel.document = JSON.parse(
      JSON.stringify(seed.channel.document),
    ) as RecoveryJournalDocument;
    const restartedJournal = new RecoveryJournal(restartedChannel);
    const report = await recoverFromJournal(seed.db, restartedJournal, seed.profileId);

    expect(report.complete).toBe(true);
    expect(report.entries.map((entry) => entry.outcome)).toEqual(["RESOLVED"]);
    expect(restartedChannel.document?.entries).toEqual([]);
    expect(
      restartedChannel.document?.archive.map((entry) => [entry.transferId, entry.state]),
    ).toEqual([[created.transferId, "RESOLVED"]]);
    expect(await count("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toBe(0);

    // Recovery released the lock and the next edit proceeds on the recovered journal.
    await editLedgerTransfer(
      seed.db,
      restartedJournal,
      { id: created.transferId, amount: "600" },
      today,
    );
    const after = (
      await rows("SELECT amount FROM transfer_records WHERE id=?", [created.transferId])
    )[0];
    expect(String(after?.amount)).toBe("600");
  });
});
