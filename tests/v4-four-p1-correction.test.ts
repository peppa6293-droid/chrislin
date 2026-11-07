import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import { completeOnboarding, getHomeApplicationState } from "../src/application/product-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import type { ExecuteResult, SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const opened: NodeSqliteDatabase[] = [];
const directories: string[] = [];
function fresh(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  opened.push(db);
  return db;
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const onboarding = {
  displayName: "V4 test",
  stableMonthlyIncome: "13000",
  essentialExpenses: [{ category: "HOUSING" as const, monthlyAmount: "1900" }],
  cashAccounts: [{ name: "Cash", balance: "5000", includeInSafetyResources: true }],
  assets: [{ name: "Fund", currentValue: "3000", includeInSafetyResources: true }],
  debts: [{ name: "Debt", currentBalance: "10000", currentMonthDue: "500" }],
  safetyCoverageTargetMonths: 6,
  minimumCashCoverageMonths: 2,
  safetyRecoveryHorizonMonths: 12,
  desiredMonthlyDiscretionarySpending: "1600",
};

class MutationProbeDatabase implements SqlDatabase {
  observedCommittedRow: Record<string, unknown> | null = null;
  private insertedId: number | null = null;
  private insertedTable: string | null = null;

  constructor(
    private readonly root: NodeSqliteDatabase,
    private readonly observer: NodeSqliteDatabase,
    private readonly targetTable: string,
    private readonly readbackFragment: string,
    private readonly mode: "READBACK_FAILURE" | "DROP_RECEIPT",
  ) {}

  async execute(sql: string, bindValues: unknown[] = []): Promise<ExecuteResult> {
    const result = await this.root.execute(sql, bindValues);
    if (sql.includes(`INSERT INTO ${this.targetTable}`)) {
      this.insertedId = result.lastInsertId ?? null;
      this.insertedTable = this.targetTable;
      if (this.insertedId !== null) {
        this.observedCommittedRow =
          (
            await this.observer.select(`SELECT * FROM ${this.targetTable} WHERE revision_id=?`, [
              this.insertedId,
            ])
          )[0] ?? null;
      }
      if (this.mode === "DROP_RECEIPT") return { rowsAffected: result.rowsAffected };
    }
    return result;
  }

  async select<T extends Record<string, unknown>>(
    sql: string,
    bindValues: unknown[] = [],
  ): Promise<T[]> {
    if (
      this.mode === "READBACK_FAILURE" &&
      this.insertedTable === this.targetTable &&
      sql.includes(this.readbackFragment)
    )
      throw new Error("injected exact readback failure");
    return this.root.select<T>(sql, bindValues);
  }

  transaction<T>(work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T> {
    return this.root.transaction(() => work(this));
  }
}

async function runMutation(
  domain: "planning" | "actual" | "cash",
  mode: "READBACK_FAILURE" | "DROP_RECEIPT",
) {
  const directory = mkdtempSync(join(tmpdir(), "pf-v4-persistence-truth-"));
  directories.push(directory);
  const dbPath = join(directory, "isolated.sqlite3");
  const root = new NodeSqliteDatabase(new DatabaseSync(dbPath));
  opened.push(root);
  const observer = new NodeSqliteDatabase(new DatabaseSync(dbPath));
  opened.push(observer);
  await migrateDatabase(root, "2026-10-01T00:00:00.000Z");
  await completeOnboarding(root, onboarding, "2026-10-01");

  let table: string;
  let readbackFragment: string;
  let mutate: (service: V4FoundationService) => Promise<unknown>;
  if (domain === "planning") {
    table = "planning_income_month_revisions";
    readbackFragment = "FROM planning_income_month_revisions WHERE revision_id=?";
    mutate = (service) =>
      service.savePlanningMonthDecision("2026-10", "2026-10-02", {
        decision: "OVERRIDE",
        amount: "14000",
      });
  } else if (domain === "actual") {
    table = "actual_income_revisions";
    readbackFragment = "FROM actual_income_revisions WHERE revision_id=?";
    const repo = new Repositories(root);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "actual-persist",
        kind: "ACTUAL",
        status: "EXPECTED",
        amount: "100",
        date: "2026-10-01",
      },
      profile.id,
      "2026-10",
      "2026-10-01T01:00:00.000Z",
    );
    mutate = (service) =>
      service.reviseActualIncome({
        incomeId: "actual-persist",
        periodMonth: "2026-10",
        asOfDate: "2026-10-02",
        amount: "120",
        status: "PENDING",
        date: "2026-10-02",
      });
  } else {
    table = "cash_account_lifecycle_revisions";
    readbackFragment = "FROM cash_account_lifecycle_revisions WHERE revision_id=?";
    const cash = await new Repositories(root).cashAccountsAt("2026-10-01");
    const account = cash[0];
    if (!account) throw new Error("cash account missing");
    mutate = (service) => service.deactivateCashAccount(account.id, "2026-10-02");
  }
  const probe = new MutationProbeDatabase(root, observer, table, readbackFragment, mode);
  const result = await mutate(new V4FoundationService(probe));
  return { result, probe, root, table };
}

describe("four V4 foundation P1 corrections", () => {
  it("preserves stable-income history across an idempotent migration for complete Home outputs", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-09-01T00:00:00.000Z");
    await completeOnboarding(
      db,
      { ...onboarding, stableMonthlyIncome: "1800", debts: [] },
      "2026-09-01",
    );
    await updateFinancialDataAndRecalculate(db, { stableMonthlyIncome: "15500" }, "2026-09-05");
    const stable = new Repositories(db);
    expect(await stable.stablePlanningIncomeAt("2026-10", "2026-09-04")).toMatchObject({
      amount: "1800",
    });
    expect(await stable.stablePlanningIncomeAt("2026-10", "2026-09-05")).toMatchObject({
      amount: "15500",
    });

    const dates = ["2026-10-07", "2026-11-07", "2026-12-07", "2027-01-07"];
    const before = await Promise.all(dates.map((date) => getHomeApplicationState(db, date)));
    await migrateDatabase(db, "2026-10-07T00:00:00.000Z");
    const after = await Promise.all(dates.map((date) => getHomeApplicationState(db, date)));
    expect(after).toEqual(before);
    expect(after.map((home) => home.planningIncome)).toEqual(["15500", "15500", "15500", "15500"]);
  });

  it("keeps month override independent from stable history and INHERIT resolves the historical stable value", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");
    const v4 = new V4FoundationService(db);
    expect(
      await v4.savePlanningMonthDecision("2026-10", "2026-10-02", {
        decision: "OVERRIDE",
        amount: "15500",
      }),
    ).toMatchObject({ status: "SAVED" });
    await updateFinancialDataAndRecalculate(db, { stableMonthlyIncome: "12000" }, "2026-10-10");
    expect((await getFinancialMaintenanceState(db, "2026-10-10")).stableMonthlyIncome).toBe(
      "12000",
    );
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-10")).planningIncome.amount,
    ).toBe("15500");
    expect(
      (await new V4FoundationService(db).read("2026-11", "2026-10-10")).planningIncome.amount,
    ).toBe("12000");
    expect(
      await v4.savePlanningMonthDecision("2026-10", "2026-10-11", {
        decision: "INHERIT",
        amount: null,
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-10")).planningIncome,
    ).toMatchObject({
      amount: "15500",
      source: "MONTH_OVERRIDE",
    });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-11")).planningIncome,
    ).toMatchObject({
      amount: "12000",
      source: "MONTH_INHERIT",
    });
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-11")).planningIncome.revisionId,
    ).toBeTruthy();
    expect(
      await db.select(
        "SELECT decision,amount FROM planning_income_month_revisions ORDER BY revision_id",
      ),
    ).toEqual([
      { decision: "OVERRIDE", amount: "15500" },
      { decision: "INHERIT", amount: null },
    ]);
  });

  it("retains only the approved compatibility bridge for legacy month-scoped Planning facts", async () => {
    const db = fresh();
    // The bridge is gated on the month V4 was applied, so this fixture is migrated at the scenario month.
    await migrateDatabase(db, "2026-10-07T00:00:00.000Z");
    await completeOnboarding(db, { ...onboarding, debts: [] }, "2026-08-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "legacy-september-plan",
        kind: "PLANNING",
        status: "EXPECTED",
        amount: "14000",
        date: "2026-09-01",
      },
      profile.id,
      "2026-09",
      "2026-09-01T00:00:00.000Z",
    );
    await repo.saveIncome(
      {
        id: "legacy-november-plan",
        kind: "PLANNING",
        status: "EXPECTED",
        amount: "16000",
        date: "2026-11-01",
      },
      profile.id,
      "2026-11",
      "2026-11-01T00:00:00.000Z",
    );
    await migrateDatabase(db, "2026-10-07T00:00:00.000Z");
    const v4 = new V4FoundationService(db);
    expect((await v4.read("2026-10", "2026-10-07")).planningIncome).toMatchObject({
      amount: "14000",
      source: "LEGACY_V3_COMPATIBILITY",
    });
    expect((await v4.read("2026-11", "2026-10-31")).planningIncome).toMatchObject({
      amount: "13000",
      source: "STABLE_BASELINE",
    });
    expect((await v4.read("2026-11", "2026-11-02")).planningIncome).toMatchObject({
      amount: "16000",
      source: "LEGACY_V3_COMPATIBILITY",
    });
    expect((await v4.read("2026-12", "2026-12-01")).planningIncome).toMatchObject({
      amount: "13000",
      source: "STABLE_BASELINE",
    });
  });

  it("selects Actual version by effective history before filtering business date", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "actual-future-edit",
        kind: "ACTUAL",
        status: "RECEIVED",
        amount: "800",
        date: "2026-10-02",
      },
      profile.id,
      "2026-10",
      "2026-10-02T01:00:00.000Z",
    );
    const v4 = new V4FoundationService(db);
    expect(
      await v4.reviseActualIncome({
        incomeId: "actual-future-edit",
        periodMonth: "2026-10",
        asOfDate: "2026-10-04",
        amount: "950",
        status: "PENDING",
        date: "2026-10-20",
      }),
    ).toMatchObject({ status: "SAVED" });
    expect(await v4.read("2026-10", "2026-10-03")).toMatchObject({
      actualIncome: [{ amount: "800" }],
    });
    expect((await v4.read("2026-10", "2026-10-05")).actualIncome).toEqual([]);
    expect((await v4.read("2026-10", "2026-10-20")).actualIncome).toMatchObject([
      { amount: "950", status: "PENDING" },
    ]);
    expect(
      await v4.reviseActualIncome({
        incomeId: "actual-future-edit",
        periodMonth: "2026-10",
        asOfDate: "2026-10-06",
        amount: "950",
        status: "PENDING",
        date: "2026-10-20",
        void: true,
      }),
    ).toMatchObject({ status: "SAVED" });
    expect((await v4.read("2026-10", "2026-10-07")).actualIncome).toEqual([]);
  });

  it("preserves a legitimate Actual backfill across an idempotent migration and never lets base reassert after a V4 revision", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-v4-actual02-backfill-"));
    directories.push(directory);
    const dbPath = join(directory, "actual-backfill.sqlite3");
    let db = new NodeSqliteDatabase(new DatabaseSync(dbPath));
    const dbIndex = opened.push(db) - 1;
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");

    // The real V3 maintenance path creates this row on Oct 7 for Oct 2.
    await updateFinancialDataAndRecalculate(
      db,
      {
        actualIncomeEntries: [{ date: "2026-10-02", status: "RECEIVED", amount: "800" }],
      },
      "2026-10-07",
    );
    const base = await db.select<{
      id: string;
      date: string;
      amount: string;
      status: string;
      created_at: string;
    }>("SELECT id,date,amount,status,created_at FROM income_records WHERE kind='ACTUAL'");
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({
      date: "2026-10-02",
      amount: "800",
      status: "RECEIVED",
      created_at: "2026-10-07T00:00:00.000Z",
    });

    const oldV3Home = await getHomeApplicationState(db, "2026-10-03");
    expect(oldV3Home.actualIncomeRecordCount).toBe(1);

    await migrateDatabase(db, "2026-10-07T00:00:00.000Z");
    const migratedHome = await getHomeApplicationState(db, "2026-10-03");
    expect(migratedHome).toEqual(oldV3Home);
    expect(migratedHome.actualIncomeRecordCount).toBe(1);
    expect(
      (await new V4FoundationService(db).read("2026-10", "2026-10-03")).actualIncome,
    ).toMatchObject([{ amount: "800", status: "RECEIVED", date: "2026-10-02" }]);

    const v4 = new V4FoundationService(db);
    expect(
      await v4.reviseActualIncome({
        incomeId: base[0]?.id ?? "missing",
        periodMonth: "2026-10",
        asOfDate: "2026-10-04",
        amount: "950",
        status: "RECEIVED",
        date: "2026-10-02",
      }),
    ).toMatchObject({ status: "SAVED", persistenceOutcome: "CONFIRMED_PERSISTED" });
    expect((await v4.read("2026-10", "2026-10-03")).actualIncome).toMatchObject([
      { amount: "800", status: "RECEIVED" },
    ]);
    expect((await v4.read("2026-10", "2026-10-05")).actualIncome).toMatchObject([
      { amount: "950", status: "RECEIVED" },
    ]);
    expect((await v4.read("2026-10", "2026-10-25")).actualIncome).toMatchObject([
      { amount: "950", status: "RECEIVED" },
    ]);
    db.close();
    db = new NodeSqliteDatabase(new DatabaseSync(dbPath));
    opened[dbIndex] = db;
    await migrateDatabase(db, "2026-10-26T00:00:00.000Z");
    const reopenedService = new V4FoundationService(db);
    expect((await reopenedService.read("2026-10", "2026-10-03")).actualIncome).toMatchObject([
      { amount: "800", status: "RECEIVED" },
    ]);
    expect((await reopenedService.read("2026-10", "2026-10-05")).actualIncome).toMatchObject([
      { amount: "950", status: "RECEIVED" },
    ]);
    expect((await reopenedService.read("2026-10", "2026-10-25")).actualIncome).toMatchObject([
      { amount: "950", status: "RECEIVED" },
    ]);
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
    ]);
    expect(await db.select("SELECT COUNT(*) AS count FROM actual_income_revisions")).toEqual([
      { count: 1 },
    ]);
  });

  it("preserves Actual zero/status values and rejects cross-month revisions", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "actual-zero-expected",
        kind: "ACTUAL",
        status: "EXPECTED",
        amount: "0",
        date: "2026-10-02",
      },
      profile.id,
      "2026-10",
      "2026-10-02T00:00:00.000Z",
    );
    const v4 = new V4FoundationService(db);
    expect((await v4.read("2026-10", "2026-10-03")).actualIncome).toMatchObject([
      { amount: "0", status: "EXPECTED" },
    ]);
    expect(
      await v4.reviseActualIncome({
        incomeId: "actual-zero-expected",
        periodMonth: "2026-10",
        asOfDate: "2026-10-03",
        amount: "5",
        status: "RECEIVED",
        date: "2026-11-01",
      }),
    ).toMatchObject({ status: "VALIDATION_FAILED", persistenceOutcome: "NOT_ATTEMPTED" });
    expect(await db.select("SELECT * FROM actual_income_revisions")).toEqual([]);
  });

  it("orders multiple V4 Actual revisions on the same as-of date by revision ID", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "actual-same-date-revisions",
        kind: "ACTUAL",
        status: "RECEIVED",
        amount: "800",
        date: "2026-10-02",
      },
      profile.id,
      "2026-10",
      "2026-10-02T00:00:00.000Z",
    );
    const v4 = new V4FoundationService(db);
    for (const amount of ["950", "975"])
      expect(
        await v4.reviseActualIncome({
          incomeId: "actual-same-date-revisions",
          periodMonth: "2026-10",
          asOfDate: "2026-10-04",
          amount,
          status: "RECEIVED",
          date: "2026-10-02",
        }),
      ).toMatchObject({ status: "SAVED" });
    expect((await v4.read("2026-10", "2026-10-04")).actualIncome).toMatchObject([
      { amount: "975", status: "RECEIVED" },
    ]);
  });

  it("preserves corrected Planning, Actual, and Cash history after close, reopen, and idempotent migration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-v4-history-restart-"));
    directories.push(directory);
    const path = join(directory, "history.sqlite3");
    const first = new NodeSqliteDatabase(new DatabaseSync(path));
    const index = opened.push(first) - 1;
    await migrateDatabase(first, "2026-09-01T00:00:00.000Z");
    await completeOnboarding(first, { ...onboarding, debts: [] }, "2026-09-01");
    await updateFinancialDataAndRecalculate(first, { stableMonthlyIncome: "14000" }, "2026-09-05");
    await migrateDatabase(first, "2026-10-07T00:00:00.000Z");
    const repos = new Repositories(first);
    const profile = await repos.getProfile();
    const cash = await repos.cashAccountsAt("2026-10-07");
    if (!profile || !cash[0]) throw new Error("bootstrap facts missing");
    await repos.saveIncome(
      {
        id: "restart-actual",
        kind: "ACTUAL",
        status: "RECEIVED",
        amount: "800",
        date: "2026-10-02",
      },
      profile.id,
      "2026-10",
      "2026-10-02T00:00:00.000Z",
    );
    const v4 = new V4FoundationService(first);
    await v4.reviseActualIncome({
      incomeId: "restart-actual",
      periodMonth: "2026-10",
      asOfDate: "2026-10-04",
      amount: "950",
      status: "PENDING",
      date: "2026-10-20",
    });
    await v4.deactivateCashAccount(cash[0].id, "2026-10-11");
    await v4.savePlanningMonthDecision("2026-10", "2026-10-10", {
      decision: "OVERRIDE",
      amount: "15500",
    });
    const before = {
      planningPrior: (await v4.read("2026-10", "2026-10-09")).planningIncome,
      planningOverride: (await v4.read("2026-10", "2026-10-10")).planningIncome,
      planningStableLater: (await v4.read("2026-11", "2026-10-10")).planningIncome,
      actualPrior: (await v4.read("2026-10", "2026-10-03")).actualIncome,
      actualFutureDateHidden: (await v4.read("2026-10", "2026-10-05")).actualIncome,
      actualVisible: (await v4.read("2026-10", "2026-10-20")).actualIncome,
      cashPrior: (await v4.read("2026-10", "2026-10-10")).cashAccounts,
      cashInactive: (await v4.read("2026-10", "2026-10-11")).cashAccounts,
    };
    first.close();
    const reopened = new NodeSqliteDatabase(new DatabaseSync(path));
    opened[index] = reopened;
    await migrateDatabase(reopened, "2026-10-12T00:00:00.000Z");
    const again = new V4FoundationService(reopened);
    expect({
      planningPrior: (await again.read("2026-10", "2026-10-09")).planningIncome,
      planningOverride: (await again.read("2026-10", "2026-10-10")).planningIncome,
      planningStableLater: (await again.read("2026-11", "2026-10-10")).planningIncome,
      actualPrior: (await again.read("2026-10", "2026-10-03")).actualIncome,
      actualFutureDateHidden: (await again.read("2026-10", "2026-10-05")).actualIncome,
      actualVisible: (await again.read("2026-10", "2026-10-20")).actualIncome,
      cashPrior: (await again.read("2026-10", "2026-10-10")).cashAccounts,
      cashInactive: (await again.read("2026-10", "2026-10-11")).cashAccounts,
    }).toEqual(before);
    expect(await reopened.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual(
      [
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
        { version: 9 },
        { version: 10 },
        { version: 11 },
      ],
    );
    expect(
      await reopened.select("SELECT COUNT(*) AS count FROM planning_income_month_revisions"),
    ).toEqual([{ count: 1 }]);
    expect(await reopened.select("SELECT COUNT(*) AS count FROM actual_income_revisions")).toEqual([
      { count: 1 },
    ]);
    expect(
      await reopened.select("SELECT COUNT(*) AS count FROM cash_account_lifecycle_revisions"),
    ).toEqual([{ count: 1 }]);
  });

  it("uses base created_at as version time so a future-dated base cannot override a later revision", async () => {
    const db = fresh();
    await migrateDatabase(db, "2026-10-01T00:00:00.000Z");
    await completeOnboarding(db, onboarding, "2026-10-01");
    const repo = new Repositories(db);
    const profile = await repo.getProfile();
    if (!profile) throw new Error("profile missing");
    await repo.saveIncome(
      {
        id: "actual-future-base",
        kind: "ACTUAL",
        status: "RECEIVED",
        amount: "800",
        date: "2026-10-20",
      },
      profile.id,
      "2026-10",
      "2026-10-01T01:00:00.000Z",
    );
    const v4 = new V4FoundationService(db);
    expect(
      await v4.reviseActualIncome({
        incomeId: "actual-future-base",
        periodMonth: "2026-10",
        asOfDate: "2026-10-04",
        amount: "950",
        status: "RECEIVED",
        date: "2026-10-02",
      }),
    ).toMatchObject({ status: "SAVED" });
    expect((await v4.read("2026-10", "2026-10-05")).actualIncome).toMatchObject([
      { amount: "950", date: "2026-10-02" },
    ]);
    expect((await v4.read("2026-10", "2026-10-25")).actualIncome).toMatchObject([
      { amount: "950", date: "2026-10-02" },
    ]);
  });

  it.each(["planning", "actual", "cash"] as const)(
    "%s preserves positive commit evidence when the exact service readback fails",
    async (domain) => {
      const { result, probe, root, table } = await runMutation(domain, "READBACK_FAILURE");
      expect(result).toMatchObject({
        status: "SAVE_FAILED",
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      });
      expect(probe.observedCommittedRow).not.toBeNull();
      expect(await root.select(`SELECT * FROM ${table}`)).toHaveLength(1);
    },
  );

  it.each(["planning", "actual", "cash"] as const)(
    "%s reports unknown outcome when the valid revision receipt is unavailable",
    async (domain) => {
      const { result, probe, root, table } = await runMutation(domain, "DROP_RECEIPT");
      expect(result).toMatchObject({
        status: "SAVE_FAILED",
        code: "MISSING_REVISION_ID",
        persistenceConfirmed: false,
        persistenceOutcome: "OUTCOME_UNKNOWN",
      });
      expect(probe.observedCommittedRow).not.toBeNull();
      expect(await root.select(`SELECT * FROM ${table}`)).toHaveLength(1);
    },
  );
});
