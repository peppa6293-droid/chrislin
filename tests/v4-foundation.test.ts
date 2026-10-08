import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  completeOnboarding,
  getHomeApplicationState,
  type OnboardingSubmission,
} from "../src/application/product-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const dbs: NodeSqliteDatabase[] = [];
const directories: string[] = [];
function fresh(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const candidate: OnboardingSubmission = {
  displayName: "Test",
  stableMonthlyIncome: "13000",
  essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1900" }],
  cashAccounts: [{ name: "Cash", balance: "5000", includeInSafetyResources: true }],
  assets: [{ name: "Fund", currentValue: "3000", includeInSafetyResources: true }],
  debts: [{ name: "Debt", currentBalance: "10000", currentMonthDue: "500" }],
  safetyCoverageTargetMonths: 6,
  minimumCashCoverageMonths: 2,
  safetyRecoveryHorizonMonths: 12,
  desiredMonthlyDiscretionarySpending: "1600",
};

describe("V4 additive schema and resolvers", () => {
  it("migrates a fresh database 1→4 and safely reruns without duplicate migrations or revisions", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await migrateDatabase(db, "2026-10-02T00:00:00.000Z");
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 4 }]);
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);
    for (const table of [
      "planning_income_month_revisions",
      "actual_income_revisions",
      "cash_account_lifecycle_revisions",
    ])
      expect(await db.select(`SELECT * FROM ${table}`)).toEqual([]);
  });

  it("resolves exact-month override, explicit zero, inherit, no carryforward, as-of and restart", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, candidate, "2026-10-01");
    const service = new V4FoundationService(db, () => "2026-10-02T12:00:00.000Z");
    expect((await service.read("2026-10", "2026-10-01")).planningIncome).toMatchObject({
      amount: "13000",
      source: "STABLE_BASELINE",
    });
    expect(
      await service.savePlanningMonthDecision("2026-10", "2026-10-02", {
        decision: "OVERRIDE",
        amount: "15500.00",
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-01")).planningIncome.amount,
    ).toBe("13000");
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-02")).planningIncome,
    ).toMatchObject({ amount: "15500.00", source: "MONTH_OVERRIDE" });
    expect(
      (await new V4FoundationService(db).read("2026-11", "2026-11-01")).planningIncome,
    ).toMatchObject({ amount: "13000", source: "STABLE_BASELINE" });
    expect(
      await service.savePlanningMonthDecision("2026-10", "2026-10-03", {
        decision: "OVERRIDE",
        amount: "0",
      }),
    ).toMatchObject({ status: "SAVED" });
    expect((await service.read("2026-10", "2026-10-03")).planningIncome).toMatchObject({
      amount: "0",
      source: "MONTH_OVERRIDE",
    });
    expect(
      await service.savePlanningMonthDecision("2026-10", "2026-10-04", {
        decision: "INHERIT",
        amount: null,
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-04")).planningIncome,
    ).toMatchObject({ amount: "13000", source: "MONTH_INHERIT" });
    expect(
      await db.select(
        "SELECT decision,amount FROM planning_income_month_revisions ORDER BY revision_id",
      ),
    ).toEqual([
      { decision: "OVERRIDE", amount: "15500.00" },
      { decision: "OVERRIDE", amount: "0" },
      { decision: "INHERIT", amount: null },
    ]);
  });

  it("reopens a file-backed V4 database with the same resolved month decision", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-v4-restart-"));
    directories.push(directory);
    const path = join(directory, "restart.sqlite3");
    const first = new NodeSqliteDatabase(new DatabaseSync(path));
    const index = dbs.push(first) - 1;
    await migrateDatabase(first, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(first, candidate, "2026-10-01");
    await new V4FoundationService(first).savePlanningMonthDecision("2026-10", "2026-10-02", {
      decision: "OVERRIDE",
      amount: "15500",
    });
    first.close();
    const reopened = new NodeSqliteDatabase(new DatabaseSync(path));
    dbs[index] = reopened;
    await migrateDatabase(reopened, "2026-10-03T00:00:00.000Z");
    expect(
      (await new V4FoundationService(reopened).read("2026-10", "2026-10-02")).planningIncome,
    ).toMatchObject({ amount: "15500", source: "MONTH_OVERRIDE" });
  });

  it("revises and voids Actual income append-only with historical readback", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, candidate, "2026-10-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      { id: "actual-1", kind: "ACTUAL", status: "RECEIVED", amount: "800", date: "2026-10-02" },
      profile.id,
      "2026-10",
      "2026-10-02T00:00:00.000Z",
    );
    const service = new V4FoundationService(db, () => "2026-10-04T00:00:00.000Z");
    expect((await service.read("2026-10", "2026-10-03")).actualIncome[0]).toMatchObject({
      id: "actual-1",
      amount: "800",
      active: true,
    });
    expect(
      await service.reviseActualIncome({
        incomeId: "actual-1",
        periodMonth: "2026-10",
        asOfDate: "2026-10-04",
        amount: "950",
        status: "RECEIVED",
        date: "2026-10-02",
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-03")).actualIncome[0]?.amount,
    ).toBe("800");
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-04")).actualIncome[0]?.amount,
    ).toBe("950");
    expect(
      await service.reviseActualIncome({
        incomeId: "actual-1",
        periodMonth: "2026-10",
        asOfDate: "2026-10-05",
        amount: "950",
        status: "RECEIVED",
        date: "2026-10-02",
        void: true,
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-04")).actualIncome,
    ).toHaveLength(1);
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-05")).actualIncome,
    ).toHaveLength(0);
    expect(await db.select("SELECT id FROM income_records WHERE id='actual-1'")).toHaveLength(1);
    expect(await db.select("SELECT revision_id FROM actual_income_revisions")).toHaveLength(2);
  });

  it("deactivates Cash as-of without changing prior lifecycle reads", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, candidate, "2026-10-01");
    const repo = new Repositories(db);
    const cash = await repo.cashAccountsAt("2026-10-01");
    const account = cash[0];
    if (!account) throw new Error("cash account missing");
    const service = new V4FoundationService(db, () => "2026-10-02T00:00:00.000Z");
    expect(await service.deactivateCashAccount(account.id, "2026-10-02")).toMatchObject({
      status: "SAVED",
    });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-01")).cashAccounts,
    ).toHaveLength(1);
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-02")).cashAccounts,
    ).toHaveLength(0);
    expect(await db.select("SELECT active FROM cash_accounts WHERE id=?", [account.id])).toEqual([
      { active: 1 },
    ]);
  });

  it("preserves populated V3 Home/model output and all V3 rows across migration", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z", 3);
    const beforeOnboarding = await completeOnboarding(db, candidate, "2026-10-01");
    const repos = new Repositories(db);
    const profile = await repos.getProfile();
    if (!profile) throw new Error("profile missing");
    await repos.saveIncome(
      { id: "legacy-actual", kind: "ACTUAL", status: "PENDING", amount: "725", date: "2026-10-01" },
      profile.id,
      "2026-10",
      "2026-10-01T00:00:00.000Z",
    );
    const businessTables = (
      await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations') AND name NOT IN ('planning_income_month_revisions','actual_income_revisions','cash_account_lifecycle_revisions') ORDER BY name",
      )
    ).map((row) => row.name);
    const beforeRows = Object.fromEntries(
      await Promise.all(
        businessTables.map(
          async (name) => [name, await db.select(`SELECT * FROM ${name} ORDER BY rowid`)] as const,
        ),
      ),
    );
    const beforeHome = await getHomeApplicationState(db, "2026-10-01");
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    const afterHome = await getHomeApplicationState(db, "2026-10-01");
    expect(afterHome).toEqual(beforeHome);
    const afterRows = Object.fromEntries(
      await Promise.all(
        businessTables.map(
          async (name) => [name, await db.select(`SELECT * FROM ${name} ORDER BY rowid`)] as const,
        ),
      ),
    );
    expect(afterRows).toEqual(beforeRows);
    expect(await db.select("SELECT * FROM planning_income_month_revisions")).toEqual([]);
    expect(await db.select("SELECT * FROM actual_income_revisions")).toEqual([]);
    expect(await db.select("SELECT * FROM cash_account_lifecycle_revisions")).toEqual([]);
    expect(beforeOnboarding.status).toBe("READY");
  });
});
