import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../src/application/product-service.js";
import { markRecoveryComplete, resetRecoveryState } from "../src/application/recovery-service.js";
import {
  listOrphanLegs,
  listTransfersWithIntegrity,
} from "../src/application/transfer-read-model.js";
import {
  createLedgerTransfer,
  deleteLedgerTransfer,
} from "../src/application/ux-ledger-service.js";
import type { SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import type {
  RecoveryJournalChannel,
  RecoveryJournalDocument,
} from "../src/persistence/recovery-journal.js";
import { RecoveryJournal } from "../src/persistence/recovery-journal.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// C11 read model (T-33/T-38): one read-only verdict per transfer row, no repair, no N+1,
// and capability bits that a records page can trust without re-querying legs.

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("expected at least one row");
  return item;
}

const NOW = "2026-11-06T00:00:00.000Z";
const TODAY = "2026-11-06";
const MONTH = "2026-11";

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
  const root = mkdtempSync(join(tmpdir(), "s2-b-records-"));
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

async function transfer(env: Env, id: string, amount = "300"): Promise<string> {
  const result = await createLedgerTransfer(
    env.db,
    env.journal,
    { id, fromAccountId: env.accountA, toAccountId: env.accountB, amount, occurredOn: TODAY },
    TODAY,
  );
  return result.transferId;
}

async function totalChanges(db: SqlDatabase): Promise<number> {
  const rows = await db.select("SELECT total_changes() AS c");
  return Number((rows[0] as { c: number }).c);
}

const COMPLETE_ID = "11111111-1111-4111-8111-111111111111";

describe("transfer records read model", () => {
  it("T-33 reports a complete transfer with capability bits and stays read-only", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID, "300");
    const changes = await totalChanges(env.db);

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, false);

    expect(items).toHaveLength(1);
    expect(first(items)).toMatchObject({
      id: COMPLETE_ID,
      type: "TRANSFER",
      occurredOn: TODAY,
      amount: 300,
      deleted: false,
      editable: true,
      deletable: true,
      restorable: false,
      affectsNet: true,
    });
    expect(first(items).incomplete).toBeUndefined();

    // Read-only: the probe must not write a lock, a journal entry, or any business row.
    expect(await totalChanges(env.db)).toBe(changes);
    expect(env.channel.document?.entries ?? []).toEqual([]);
    expect(await env.db.select("SELECT COUNT(*) AS c FROM transfer_outcome_locks")).toEqual([
      { c: 0 },
    ]);
  });

  it("T-33 flags a transfer whose current leg went missing without throwing", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);
    await env.db.execute("DELETE FROM transfer_legs WHERE transfer_id=? AND side='IN'", [
      COMPLETE_ID,
    ]);

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, false);

    expect(items).toHaveLength(1);
    expect(first(items).incomplete).toEqual({ code: "MISSING_LEG", reason: "sides=[OUT]" });
    expect(first(items)).toMatchObject({
      editable: false,
      deletable: false,
      restorable: false,
      affectsNet: false,
    });
    // The verdict is a report, not a repair.
    expect(
      await env.db.select("SELECT COUNT(*) AS c FROM transfer_legs WHERE transfer_id=?", [
        COMPLETE_ID,
      ]),
    ).toEqual([{ c: 1 }]);
  });

  it("T-33 flags a transfer whose legs belong to another profile", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);
    // profiles is a singleton table, so a foreign profile id can only be simulated with FKs off.
    await env.db.execute("PRAGMA foreign_keys = OFF");
    await env.db.execute(
      "UPDATE transfer_legs SET profile_id='foreign-profile' WHERE transfer_id=?",
      [COMPLETE_ID],
    );
    await env.db.execute("PRAGMA foreign_keys = ON");

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, false);

    expect(first(items).incomplete).toEqual({ code: "MISSING_LEG", reason: "sides=[]" });
  });

  it("T-33 flags a deleted transfer that still has applied legs", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);
    await deleteLedgerTransfer(env.db, env.journal, COMPLETE_ID, TODAY);
    await env.db.execute("UPDATE transfer_legs SET state='APPLIED' WHERE transfer_id=?", [
      COMPLETE_ID,
    ]);

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, true);

    expect(first(items)).toMatchObject({ deleted: true, restorable: false, affectsNet: false });
    expect(first(items).incomplete).toEqual({
      code: "MISSING_LEG",
      reason: "state-applied-but-deleted",
    });
  });

  it("T-33 removes deleted transfers unless includeDeleted is requested", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);
    await deleteLedgerTransfer(env.db, env.journal, COMPLETE_ID, TODAY);

    expect(await listTransfersWithIntegrity(env.db, env.profileId, MONTH, false)).toEqual([]);

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, true);
    expect(first(items)).toMatchObject({
      deleted: true,
      editable: false,
      deletable: false,
      restorable: true,
      affectsNet: false,
    });
    expect(first(items).incomplete).toBeUndefined();
  });

  it("T-33 isolates profiles and validates the month", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);

    expect(await listTransfersWithIntegrity(env.db, "another-profile", MONTH, true)).toEqual([]);
    await expect(
      listTransfersWithIntegrity(env.db, env.profileId, "2026-11-06", false),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("T-33 fails closed when the probe itself cannot run", async () => {
    const env = await setup();
    const broken = {
      ...env.db,
      select: async (sql: string) => {
        if (sql.includes("FROM transfer_records")) throw new Error("database connection closed");
        return env.db.select(sql);
      },
    } as unknown as SqlDatabase;

    await expect(
      listTransfersWithIntegrity(broken, env.profileId, MONTH, false),
    ).rejects.toMatchObject({ code: "TRANSFER_INTEGRITY_PROBE_FAILED" });
  });

  it("T-38 refuses to mark a locked transfer as editable", async () => {
    const env = await setup();
    await transfer(env, COMPLETE_ID);
    await env.db.execute(
      "INSERT INTO transfer_outcome_locks(transfer_id,profile_id,locked_at,reason,detail) VALUES(?,?,?,?,NULL)",
      [COMPLETE_ID, env.profileId, NOW, "TRANSFER_OUTCOME_UNKNOWN"],
    );

    const items = await listTransfersWithIntegrity(env.db, env.profileId, MONTH, false);

    expect(first(items).incomplete).toBeUndefined();
    await expect(
      deleteLedgerTransfer(env.db, env.journal, COMPLETE_ID, TODAY),
    ).rejects.toMatchObject({ code: "TRANSFER_LOCKED" });
  });

  it("T-38 lists orphan legs for manual review without touching them", async () => {
    const env = await setup();
    expect(await listOrphanLegs(env.db, env.profileId)).toEqual([]);

    await transfer(env, COMPLETE_ID);
    // Orphan legs are exactly the state where the parent row is gone, which FKs normally forbid.
    await env.db.execute("PRAGMA foreign_keys = OFF");
    await env.db.execute("DELETE FROM transfer_records WHERE id=?", [COMPLETE_ID]);
    await env.db.execute("PRAGMA foreign_keys = ON");

    const orphans = await listOrphanLegs(env.db, env.profileId);
    expect(orphans.map((leg) => leg.side).sort()).toEqual(["IN", "OUT"]);
    expect(new Set(orphans.map((leg) => leg.transferId))).toEqual(new Set([COMPLETE_ID]));
    expect(
      await env.db.select("SELECT COUNT(*) AS c FROM transfer_legs WHERE transfer_id=?", [
        COMPLETE_ID,
      ]),
    ).toEqual([{ c: 2 }]);
  });
});
