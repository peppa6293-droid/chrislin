import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../src/application/product-service.js";
import {
  closeOrphanLock,
  markRecoveryComplete,
  resetRecoveryState,
} from "../src/application/recovery-service.js";
import { createLedgerTransfer } from "../src/application/ux-ledger-service.js";
import type { SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import type {
  RecoveryJournalChannel,
  RecoveryJournalDocument,
} from "../src/persistence/recovery-journal.js";
import { RecoveryJournal } from "../src/persistence/recovery-journal.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// C13 (T-47..T-49): closing an orphan outcome lock is a maintenance permission, not a user
// action. It writes no business row, never deletes the lock row, and retires the id forever.

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("expected at least one row");
  return item;
}

const NOW = "2026-11-06T00:00:00.000Z";
const TODAY = "2026-11-06";

class MemoryChannel implements RecoveryJournalChannel {
  document: RecoveryJournalDocument | null = null;

  async read(profileId: string): Promise<RecoveryJournalDocument | null> {
    const document = this.document;
    if (document === null || document.profileId !== profileId) return null;
    return JSON.parse(JSON.stringify(document)) as RecoveryJournalDocument;
  }

  async write(document: RecoveryJournalDocument): Promise<void> {
    this.document = JSON.parse(JSON.stringify(document)) as RecoveryJournalDocument;
  }
}

interface Env {
  root: string;
  db: NodeSqliteDatabase;
  journal: RecoveryJournal;
  channel: MemoryChannel;
  profileId: string;
  accountA: string;
  accountB: string;
}

const envs: Env[] = [];

afterEach(() => {
  for (const env of envs.splice(0)) {
    env.db.close();
    rmSync(env.root, { recursive: true, force: true });
  }
  resetRecoveryState();
});

async function setup(): Promise<Env> {
  const root = mkdtempSync(join(tmpdir(), "s2-b-orphan-"));
  const db = new NodeSqliteDatabase(new DatabaseSync(join(root, "ledger.sqlite3")));
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
  const channel = new MemoryChannel();
  const journal = new RecoveryJournal(channel);
  resetRecoveryState();
  markRecoveryComplete(profile.id);
  const env: Env = { root, db, journal, channel, profileId: profile.id, accountA, accountB };
  envs.push(env);
  return env;
}

async function insertOrphanLock(env: Env, transferId: string, reason = "TRANSFER_OUTCOME_UNKNOWN") {
  await env.db.execute(
    "INSERT INTO transfer_outcome_locks(transfer_id,profile_id,locked_at,reason,detail) VALUES(?,?,?,?,NULL)",
    [transferId, env.profileId, NOW, reason],
  );
}

async function count(db: SqlDatabase, sql: string): Promise<number> {
  const rows = await db.select(sql);
  return Number((rows[0] as { c: number }).c);
}

async function totalChanges(db: SqlDatabase): Promise<number> {
  const rows = await db.select("SELECT total_changes() AS c");
  return Number((rows[0] as { c: number }).c);
}

async function snapshot(db: SqlDatabase): Promise<Record<string, unknown[]>> {
  return {
    transfer_records: await db.select("SELECT * FROM transfer_records ORDER BY id"),
    transfer_legs: await db.select("SELECT * FROM transfer_legs ORDER BY id"),
    cash_account_revisions: await db.select(
      "SELECT * FROM cash_account_revisions ORDER BY revision_id",
    ),
  };
}

const REASON = "人工核对：该笔转账在提交后无业务行，确认无主锁";

describe("orphan outcome lock closure", () => {
  it("T-47 a user or owner role can never close a lock", async () => {
    const env = await setup();
    const transferId = "99999999-9999-4999-8999-999999999999";
    await insertOrphanLock(env, transferId);

    for (const role of ["USER", "OWNER"] as const) {
      await expect(
        closeOrphanLock(env.db, env.journal, {
          transferId,
          profileId: env.profileId,
          reason: REASON,
          operator: "app-user",
          role,
        }),
      ).rejects.toMatchObject({ code: "TRANSFER_LOCK_CLOSE_FORBIDDEN" });
    }

    const rows = await env.db.select(
      "SELECT closed_at, closed_reason, closed_by FROM transfer_outcome_locks WHERE transfer_id=?",
      [transferId],
    );
    expect(rows).toEqual([{ closed_at: null, closed_reason: null, closed_by: null }]);
  });

  it("T-48 maintenance closes the lock with a full audit trail and keeps the row", async () => {
    const env = await setup();
    const transferId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await insertOrphanLock(env, transferId);
    const entry = await env.journal.append(env.profileId, { transferId, operation: "CREATE" });
    await env.journal.setState(env.profileId, entry.journalId, "MANUAL_REVIEW");
    const before = await env.db.select(
      "SELECT locked_at, reason FROM transfer_outcome_locks WHERE transfer_id=?",
      [transferId],
    );

    const audit = await closeOrphanLock(env.db, env.journal, {
      transferId,
      profileId: env.profileId,
      reason: REASON,
      operator: "maintenance-01",
      role: "MAINTENANCE",
    });

    expect(audit).toMatchObject({
      transferId,
      profileId: env.profileId,
      reason: REASON,
      operator: "maintenance-01",
      action: "CLOSE_ORPHAN_LOCK",
    });
    expect(typeof audit.at).toBe("string");

    const rows = (await env.db.select(
      "SELECT locked_at, reason, closed_at, closed_reason, closed_by FROM transfer_outcome_locks WHERE transfer_id=?",
      [transferId],
    )) as {
      locked_at: string;
      reason: string;
      closed_at: string;
      closed_reason: string;
      closed_by: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(first(rows).closed_at).toBe(audit.at);
    expect(first(rows).closed_reason).toBe(REASON);
    expect(first(rows).closed_by).toBe("maintenance-01");
    expect([first(rows).locked_at, first(rows).reason]).toEqual([
      (first(before) as { locked_at: string }).locked_at,
      (first(before) as { reason: string }).reason,
    ]);

    const document = env.channel.document;
    expect(document?.entries).toEqual([]);
    expect(document?.archive.map((archived) => archived.transferId)).toEqual([transferId]);
  });

  it("T-49 closing writes no business row, retires the id, and refuses a live lock", async () => {
    const env = await setup();
    const orphanId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await insertOrphanLock(env, orphanId);
    const before = await snapshot(env.db);
    const changes = await totalChanges(env.db);

    await closeOrphanLock(env.db, env.journal, {
      transferId: orphanId,
      profileId: env.profileId,
      reason: REASON,
      operator: "maintenance-01",
      role: "MAINTENANCE",
    });

    expect(await snapshot(env.db)).toEqual(before);
    expect(await totalChanges(env.db)).toBe(changes + 1);

    await expect(
      createLedgerTransfer(
        env.db,
        env.journal,
        {
          id: orphanId,
          fromAccountId: env.accountA,
          toAccountId: env.accountB,
          amount: "300",
          occurredOn: TODAY,
        },
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "TRANSFER_ID_RETIRED" });

    // A lock that still has business data is not an orphan and cannot be closed.
    const liveId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await createLedgerTransfer(
      env.db,
      env.journal,
      {
        id: liveId,
        fromAccountId: env.accountA,
        toAccountId: env.accountB,
        amount: "300",
        occurredOn: TODAY,
      },
      TODAY,
    );
    await insertOrphanLock(env, liveId);
    await expect(
      closeOrphanLock(env.db, env.journal, {
        transferId: liveId,
        profileId: env.profileId,
        reason: REASON,
        operator: "maintenance-01",
        role: "MAINTENANCE",
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCK_NOT_ORPHAN" });
    expect(
      await count(
        env.db,
        "SELECT COUNT(*) AS c FROM transfer_outcome_locks WHERE closed_at IS NOT NULL",
      ),
    ).toBe(1);
  });
});
