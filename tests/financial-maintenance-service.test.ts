import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  recordExpenseAndRecalculate,
} from "../src/application/product-service.js";
import type { ExecuteResult, SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const openDatabases: NodeSqliteDatabase[] = [];
const tempDirs: string[] = [];
class ReadOnlyStableIncomeHistoryProbe implements SqlDatabase {
  readonly queries: Array<{ sql: string; bindValues: unknown[] }> = [];
  writes = 0;

  async execute(_sql: string, _bindValues: unknown[] = []): Promise<ExecuteResult> {
    this.writes += 1;
    throw new Error("Stable-income history must use a read-only query.");
  }

  async select<T extends Record<string, unknown>>(
    sql: string,
    bindValues: unknown[] = [],
  ): Promise<T[]> {
    this.queries.push({ sql, bindValues });
    if (bindValues[0] !== "selected-profile") return [];
    return [
      {
        revision_id: 19,
        effective_month: "2026-10",
        as_of_date: "2026-10-03",
        amount: "12345.67",
        created_at: "2026-10-03T00:00:00.000Z",
      },
    ] as unknown as T[];
  }

  async transaction<T>(_work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T> {
    throw new Error("Stable-income history must not open a transaction.");
  }
}
function first<T>(items: T[]): T {
  const item = items[0];
  if (!item) throw new Error("Expected an item in test fixture.");
  return item;
}
async function memoryDatabase(): Promise<NodeSqliteDatabase> {
  const db = new NodeSqliteDatabase();
  openDatabases.push(db);
  await migrateDatabase(db);
  return db;
}
function fileDatabase(path: string): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  openDatabases.push(db);
  return db;
}
afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function onboard(db: NodeSqliteDatabase): Promise<void> {
  await completeOnboarding(
    db,
    {
      displayName: "Test",
      stableMonthlyIncome: "10000",
      essentialExpenses: [
        { category: "HOUSING", monthlyAmount: "1000" },
        { category: "BASIC_FOOD", monthlyAmount: "500" },
      ],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [{ name: "Fund", currentValue: "1000", includeInSafetyResources: true }],
      debts: [
        {
          name: "Loan",
          currentBalance: "2000",
          currentMonthDue: "500",
          fixedMonthlyPayment: "500",
        },
      ],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    "2026-10-03",
  );
}

describe("financial maintenance service", () => {
  it("binds stable-income history to the selected profile and performs no writes", async () => {
    const db = new ReadOnlyStableIncomeHistoryProbe();
    const revisions = await new Repositories(db).listStablePlanningIncomeRevisions(
      "selected-profile",
    );

    expect(revisions).toEqual([
      {
        revisionId: 19,
        effectiveMonth: "2026-10",
        asOfDate: "2026-10-03",
        amount: "12345.67",
        createdAt: "2026-10-03T00:00:00.000Z",
      },
    ]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]?.sql).toContain("FROM planning_income_revisions WHERE profile_id=?");
    expect(db.queries[0]?.sql).toContain(
      "ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC",
    );
    expect(db.queries[0]?.bindValues).toEqual(["selected-profile"]);
    expect(db.writes).toBe(0);
  });
  it("rejects Actual Income outside the maintenance month without partial writes", async () => {
    const db = await memoryDatabase();
    await onboard(db);

    await expect(
      updateFinancialDataAndRecalculate(
        db,
        {
          stableMonthlyIncome: "11000",
          actualIncomeEntries: [{ amount: "123", date: "2026-09-30", status: "RECEIVED" }],
        },
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "ACTUAL_INCOME_MONTH_MISMATCH" });

    expect(await db.select("SELECT * FROM income_records WHERE kind='ACTUAL'")).toHaveLength(0);
    expect(await db.select("SELECT * FROM planning_income_revisions")).toHaveLength(0);
  });

  it("accepts same-month Actual Income statuses and stores the same period month", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const beforeHome = await getHomeApplicationState(db, "2026-10-03");

    const result = await updateFinancialDataAndRecalculate(
      db,
      {
        actualIncomeEntries: [
          { amount: "100", date: "2026-10-01", status: "EXPECTED" },
          { amount: "200", date: "2026-10-02", status: "PENDING" },
          { amount: "300", date: "2026-10-03", status: "RECEIVED" },
        ],
      },
      "2026-10-03",
    );

    expect(result.state.actualIncomeRecords.map(({ status }) => status)).toEqual([
      "EXPECTED",
      "PENDING",
      "RECEIVED",
    ]);
    expect(result.state.stableMonthlyIncome).toBe("10000");
    expect(result.home.currentCash).toBe(beforeHome.currentCash);
    expect(result.home.recommendedMonthlySpending).toBe(beforeHome.recommendedMonthlySpending);
    expect(
      await db.select(
        "SELECT substr(date,1,7) AS date_month,period_month FROM income_records WHERE kind='ACTUAL' ORDER BY date",
      ),
    ).toEqual([
      { date_month: "2026-10", period_month: "2026-10" },
      { date_month: "2026-10", period_month: "2026-10" },
      { date_month: "2026-10", period_month: "2026-10" },
    ]);
  });

  it("rejects Actual Income later than the frozen maintenance as-of date", async () => {
    const db = await memoryDatabase();
    await onboard(db);

    await expect(
      updateFinancialDataAndRecalculate(
        db,
        { actualIncomeEntries: [{ amount: "123", date: "2026-10-04", status: "EXPECTED" }] },
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "ACTUAL_INCOME_AFTER_AS_OF_DATE" });
    expect(await db.select("SELECT * FROM income_records WHERE kind='ACTUAL'")).toHaveLength(0);
  });

  it("keeps mixed explicit-null and revised debt metadata separate during recovery", async () => {
    const db = await memoryDatabase();
    await completeOnboarding(
      db,
      {
        stableMonthlyIncome: "10000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
        cashAccounts: [{ name: "Cash", balance: "5000", includeInSafetyResources: true }],
        assets: [],
        debts: [
          {
            name: "Loan A",
            currentBalance: "2000",
            currentMonthDue: "500",
            fixedMonthlyPayment: "400",
          },
          {
            name: "Loan B",
            currentBalance: "3000",
            currentMonthDue: "700",
            fixedMonthlyPayment: "600",
          },
        ],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "2000",
      },
      "2026-09-01",
    );
    const debts = await db.select("SELECT id,name FROM debts ORDER BY name");
    const debtA = debts[0];
    const debtB = debts[1];
    if (!debtA || !debtB) throw new Error("Expected two debt fixtures.");
    await updateFinancialDataAndRecalculate(
      db,
      {
        debts: [
          {
            id: String(debtA.id),
            name: "Loan A",
            currentBalance: "2000",
            currentMonthDue: "500",
            fixedMonthlyPayment: null,
          },
          {
            id: String(debtB.id),
            name: "Loan B",
            currentBalance: "3000",
            currentMonthDue: "700",
            fixedMonthlyPayment: "600",
          },
        ],
      },
      "2026-09-20",
    );

    const recovery = await getFinancialMaintenanceState(db, "2026-10-01");
    expect(
      recovery.debts
        .map((debt) => [debt.name, debt.fixedMonthlyPayment])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["Loan A", null],
      ["Loan B", "600"],
    ]);
    expect(recovery.debts.map((debt) => debt.needsCurrentMonthFact)).toEqual([true, true]);
    await updateFinancialDataAndRecalculate(
      db,
      {
        debts: recovery.debts.map(
          ({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
            id,
            name,
            currentBalance,
            currentMonthDue,
            fixedMonthlyPayment,
          }),
        ),
      },
      "2026-10-01",
    );
    expect(
      await db.select(
        "SELECT name,current_balance,current_month_due,fixed_monthly_payment FROM debt_revisions WHERE period_month='2026-10' ORDER BY name",
      ),
    ).toEqual([
      {
        name: "Loan A",
        current_balance: "2000",
        current_month_due: null,
        fixed_monthly_payment: null,
      },
      {
        name: "Loan B",
        current_balance: "3000",
        current_month_due: null,
        fixed_monthly_payment: "600",
      },
    ]);
  });

  it("materializes every unchanged debt missing this month and avoids later duplicate writes", async () => {
    const db = await memoryDatabase();
    await completeOnboarding(
      db,
      {
        stableMonthlyIncome: "10000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
        cashAccounts: [{ name: "Cash", balance: "5000", includeInSafetyResources: true }],
        assets: [],
        debts: [
          {
            name: "Loan A",
            currentBalance: "2000",
            currentMonthDue: "500",
            fixedMonthlyPayment: "400",
          },
          {
            name: "Loan B",
            currentBalance: "3000",
            currentMonthDue: "700",
            fixedMonthlyPayment: "600",
          },
        ],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "1000",
      },
      "2026-09-30",
    );
    const state = await getFinancialMaintenanceState(db, "2026-10-01");
    expect(state.debts).toHaveLength(2);
    expect(state.debts.every((debt) => debt.needsCurrentMonthFact)).toBe(true);
    expect(state.debts.map((debt) => debt.currentMonthDue)).toEqual([null, null]);

    const result = await updateFinancialDataAndRecalculate(
      db,
      {
        debts: state.debts.map(
          ({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
            id,
            name,
            currentBalance,
            currentMonthDue,
            fixedMonthlyPayment,
          }),
        ),
      },
      "2026-10-01",
    );
    expect(result.home.status).toBe("READY");
    expect(result.state.debts.every((debt) => !debt.needsCurrentMonthFact)).toBe(true);
    expect(
      await db.select(
        "SELECT period_month,current_balance,current_month_due FROM debt_revisions ORDER BY current_balance",
      ),
    ).toEqual([
      { period_month: "2026-10", current_balance: "2000", current_month_due: null },
      { period_month: "2026-10", current_balance: "3000", current_month_due: null },
    ]);
    const countBefore = await db.select(
      "SELECT COUNT(*) AS count FROM debt_revisions WHERE period_month='2026-10'",
    );
    await updateFinancialDataAndRecalculate(db, { stableMonthlyIncome: "10001" }, "2026-10-02");
    expect(
      await db.select("SELECT COUNT(*) AS count FROM debt_revisions WHERE period_month='2026-10'"),
    ).toEqual(countBefore);
    expect(
      await db.select(
        "SELECT current_month_due FROM debt_period_facts WHERE period_month='2026-09' ORDER BY current_month_due",
      ),
    ).toEqual([{ current_month_due: "500" }, { current_month_due: "700" }]);
  });

  it("recovers a missing new-month debt fact without carrying its prior due or changing history", async () => {
    const db = await memoryDatabase();
    await completeOnboarding(
      db,
      {
        stableMonthlyIncome: "10000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
        cashAccounts: [{ name: "Cash", balance: "5000", includeInSafetyResources: true }],
        assets: [],
        debts: [
          {
            name: "Loan",
            currentBalance: "2000",
            currentMonthDue: "500",
            fixedMonthlyPayment: "400",
          },
        ],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "2000",
      },
      "2026-09-30",
    );
    const debtId = String((await db.select("SELECT id FROM debts"))[0]?.id);
    const septemberBefore = await db.select(
      "SELECT period_month,current_balance,current_month_due FROM debt_period_facts WHERE debt_id=?",
      [debtId],
    );
    await expect(
      import("../src/application/product-service.js").then(({ getHomeApplicationState }) =>
        getHomeApplicationState(db, "2026-10-01"),
      ),
    ).rejects.toMatchObject({ code: "MISSING_DEBT_SNAPSHOT" });
    const state = await getFinancialMaintenanceState(db, "2026-10-01");
    expect(state.debts).toEqual([
      expect.objectContaining({
        id: debtId,
        currentBalance: "2000",
        currentMonthDue: null,
        fixedMonthlyPayment: "400",
      }),
    ]);
    const result = await updateFinancialDataAndRecalculate(
      db,
      {
        debts: [
          { id: debtId, currentBalance: "1900", currentMonthDue: null, fixedMonthlyPayment: "400" },
        ],
      },
      "2026-10-01",
    );
    expect(result.home.status).toBe("READY");
    expect(result.state.debts[0]).toMatchObject({ currentBalance: "1900", currentMonthDue: null });
    expect(
      await db.select(
        "SELECT period_month,current_balance,current_month_due FROM debt_period_facts WHERE debt_id=?",
        [debtId],
      ),
    ).toEqual(septemberBefore);
  });

  it("reconstructs the prior recommendation from historical facts for trend utilization", async () => {
    const db = await memoryDatabase();
    await completeOnboarding(
      db,
      {
        stableMonthlyIncome: "10000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
        cashAccounts: [{ name: "Cash", balance: "10000", includeInSafetyResources: true }],
        assets: [],
        debts: [],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "2000",
      },
      "2026-09-01",
    );
    await recordExpenseAndRecalculate(
      db,
      { amount: "200", dateTime: "2026-09-04T18:00:00Z", businessDate: "2026-09-04" },
      "2026-09-04",
    );
    const repo = new (await import("../src/persistence/repositories.js")).Repositories(db);
    const profileId = String((await db.select("SELECT id FROM profiles"))[0]?.id);
    await repo.appendSettingsRevision(
      profileId,
      "2026-10",
      "2026-10-01",
      {
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "3000",
      },
      "2026-10-01T00:00:00Z",
    );
    await recordExpenseAndRecalculate(
      db,
      { amount: "280", dateTime: "2026-10-04T18:00:00Z", businessDate: "2026-10-04" },
      "2026-10-04",
    );
    const input = await buildMonthlyModelInput(db, "2026-10", "2026-10-04");
    expect(input.status).toBe("READY");
    if (input.status !== "READY") throw new Error("Expected model input");
    expect(input.input.facts.previousSnapshot?.samePeriodVariableSpending).toBe("200");
    expect(input.input.facts.previousSnapshot?.recommendedMonthlySpending).toBe("2000");
    const { calculateMonthlyModel } = await import("../src/model/monthly-model.js");
    const model = calculateMonthlyModel(input.input);
    expect(Number(model.consumptionUtilization.previous?.value?.toString())).toBeCloseTo(0.75, 10);
    expect(Number(model.consumptionUtilization.current.value?.toString())).toBeCloseTo(
      0.7233333333,
      10,
    );
    expect(
      model.trend.status === "COMPLETE" && model.trend.result.dimensions.CONSUMPTION.direction,
    ).toBe("IMPROVING");
  });
  it("creates new monthly facts and returns them with Model Core home state", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const result = await updateFinancialDataAndRecalculate(
      db,
      {
        essentialExpenses: [{ category: "TRANSPORT", name: "Commute", monthlyAmount: "200" }],
        cashAccounts: [{ name: "Savings", balance: "700", includeInSafetyResources: false }],
        assets: [
          {
            name: "Bond fund",
            kind: "LIQUID_INVESTMENT",
            currentValue: "800",
            includeInSafetyResources: true,
          },
        ],
        debts: [
          {
            name: "Card",
            currentBalance: "400",
            currentMonthDue: null,
            fixedMonthlyPayment: "100",
          },
        ],
      },
      "2026-10-03",
    );
    expect(result.state.essentialExpenses).toContainEqual(
      expect.objectContaining({ name: "Commute", monthlyAmount: "200" }),
    );
    expect(result.state.cashAccounts).toContainEqual(
      expect.objectContaining({ name: "Savings", balance: "700", includeInSafetyResources: false }),
    );
    expect(result.state.assets).toContainEqual(
      expect.objectContaining({ name: "Bond fund", currentValue: "800" }),
    );
    expect(result.state.debts).toContainEqual(
      expect.objectContaining({
        name: "Card",
        currentBalance: "400",
        currentMonthDue: null,
        fixedMonthlyPayment: "100",
      }),
    );
    expect(result.home).toMatchObject({ status: "READY", currentMonthSpending: "0" });
  });

  it("rejects a negative essential line even when another line offsets the total", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const before = await getFinancialMaintenanceState(db, "2026-10-03");
    const housing = first(before.essentialExpenses);
    await expect(
      updateFinancialDataAndRecalculate(
        db,
        {
          essentialExpenses: [
            { id: housing.id, monthlyAmount: "-100" },
            { category: "BASIC_FOOD", name: "Offset", monthlyAmount: "1100" },
          ],
        },
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "INVALID_ESSENTIAL_EXPENSE" });
    expect(await db.select("SELECT * FROM essential_expense_revisions")).toHaveLength(0);
  });

  it("exposes current maintenance state and appends all fact types and actual income statuses", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const original = await getFinancialMaintenanceState(db, "2026-10-03");
    expect(original.stableMonthlyIncome).toBe("10000");
    expect(original.actualIncomeRecords).toEqual([]);
    expect(original.essentialExpenses).toHaveLength(2);
    expect(original.cashAccounts[0]?.balance).toBe("5000");
    expect(original.assets[0]?.currentValue).toBe("1000");
    expect(original.debts[0]).toMatchObject({ currentMonthDue: "500", fixedMonthlyPayment: "500" });

    const essential = first(original.essentialExpenses);
    const cash = first(original.cashAccounts);
    const asset = first(original.assets);
    const debt = first(original.debts);
    const result = await updateFinancialDataAndRecalculate(
      db,
      {
        stableMonthlyIncome: "11000",
        actualIncomeEntries: [
          { amount: "1000", date: "2026-10-01", status: "EXPECTED" },
          { amount: "2000", date: "2026-10-02", status: "PENDING" },
          { amount: "3000", date: "2026-10-03", status: "RECEIVED" },
        ],
        essentialExpenses: [{ id: essential.id, monthlyAmount: "1600" }],
        cashAccounts: [{ id: cash.id, balance: "5500" }],
        assets: [{ id: asset.id, currentValue: "1200" }],
        debts: [
          {
            id: debt.id,
            currentBalance: "1800",
            currentMonthDue: "600",
            fixedMonthlyPayment: "700",
          },
        ],
        settings: {
          desiredMonthlyDiscretionarySpending: "2500",
          safetyCoverageTargetMonths: 2,
          minimumCashCoverageMonths: 2,
          safetyRecoveryHorizonMonths: 12,
        },
      },
      "2026-10-03",
    );
    expect(result.state.stableMonthlyIncome).toBe("11000");
    expect(result.state.actualIncomeRecords.map((item) => item.status)).toEqual([
      "EXPECTED",
      "PENDING",
      "RECEIVED",
    ]);
    expect(
      result.state.essentialExpenses.find((item) => item.id === essential.id)?.monthlyAmount,
    ).toBe("1600");
    expect(result.state.cashAccounts[0]?.balance).toBe("5500");
    expect(result.state.assets[0]?.currentValue).toBe("1200");
    expect(result.state.debts[0]).toMatchObject({
      currentBalance: "1800",
      currentMonthDue: "600",
      fixedMonthlyPayment: "700",
    });
    expect(result.state.settings).toMatchObject({
      desiredMonthlyDiscretionarySpending: "2500",
      safetyCoverageTargetMonths: 2,
      minimumCashCoverageMonths: 2,
      safetyRecoveryHorizonMonths: 12,
    });
    expect(result.home.status).toBe("READY");
    expect(result.home.recommendedMonthlySpending).toBe("2500");
    const partial = await updateFinancialDataAndRecalculate(
      db,
      { settings: { desiredMonthlyDiscretionarySpending: "2600" } },
      "2026-10-03",
    );
    expect(partial.state.stableMonthlyIncome).toBe("11000");
    expect(partial.state.actualIncomeRecords).toHaveLength(3);
    expect(
      partial.state.essentialExpenses.find((item) => item.id === essential.id)?.monthlyAmount,
    ).toBe("1600");
    expect(partial.state.cashAccounts.find((item) => item.id === cash.id)?.balance).toBe("5500");
    expect(partial.state.debts.find((item) => item.id === debt.id)?.currentMonthDue).toBe("600");
  });

  it("reads stable-income revisions by effective month, as-of date, and revision id without writes", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const profile = await new Repositories(db).getProfile();
    if (!profile) throw new Error("Expected the fixture profile.");
    const firstSave = await updateFinancialDataAndRecalculate(
      db,
      { stableMonthlyIncome: "11000.01" },
      "2026-10-03",
    );
    expect(firstSave.state.stableIncomeRevisions.map((revision) => revision.amount)).toContain(
      "11000.01",
    );
    await updateFinancialDataAndRecalculate(db, { stableMonthlyIncome: "11000.02" }, "2026-10-03");
    await db.execute(
      "INSERT INTO planning_income_revisions(profile_id,effective_month,as_of_date,amount,created_at) VALUES(?,?,?,?,?)",
      [profile.id, "2026-11", "2026-09-03", "12000.03", "2026-09-03T00:00:00.000Z"],
    );

    const revisionsBefore = await db.select<{ revision_id: number }>(
      "SELECT revision_id FROM planning_income_revisions ORDER BY revision_id",
    );
    const otherPlanningRowsBefore = await db.select(
      "SELECT id,amount,date,status FROM income_records WHERE kind='PLANNING' ORDER BY id",
    );
    const overridesBefore = await db.select(
      "SELECT revision_id,period_month,decision,amount FROM planning_income_month_revisions ORDER BY revision_id",
    );
    const state = await getFinancialMaintenanceState(db, "2026-10-03");

    expect(state.stableMonthlyIncome).toBe("11000.02");
    expect(state.stableIncomeRevisions.every((revision) => revision.revisionId > 0)).toBe(true);
    expect(
      state.stableIncomeRevisions.map(({ revisionId, effectiveMonth, asOfDate, amount }) => ({
        revisionId,
        effectiveMonth,
        asOfDate,
        amount,
      })),
    ).toEqual([
      {
        revisionId: revisionsBefore[2]?.revision_id,
        effectiveMonth: "2026-11",
        asOfDate: "2026-09-03",
        amount: "12000.03",
      },
      {
        revisionId: revisionsBefore[1]?.revision_id,
        effectiveMonth: "2026-10",
        asOfDate: "2026-10-03",
        amount: "11000.02",
      },
      {
        revisionId: revisionsBefore[0]?.revision_id,
        effectiveMonth: "2026-10",
        asOfDate: "2026-10-03",
        amount: "11000.01",
      },
    ]);
    expect(state.stableIncomeRevisions.map((revision) => revision.createdAt)).toEqual([
      "2026-09-03T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
    expect(
      await db.select("SELECT revision_id FROM planning_income_revisions ORDER BY revision_id"),
    ).toEqual(revisionsBefore);
    expect(
      await db.select(
        "SELECT id,amount,date,status FROM income_records WHERE kind='PLANNING' ORDER BY id",
      ),
    ).toEqual(otherPlanningRowsBefore);
    expect(
      await db.select(
        "SELECT revision_id,period_month,decision,amount FROM planning_income_month_revisions ORDER BY revision_id",
      ),
    ).toEqual(overridesBefore);
    expect(
      await db.select("SELECT kind,amount,date,status FROM income_records WHERE kind='ACTUAL'"),
    ).toEqual([]);
  });

  it("fails the maintenance read when a stable-income history row is malformed", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const profile = await new Repositories(db).getProfile();
    if (!profile) throw new Error("Expected the fixture profile.");
    await db.execute(
      "INSERT INTO planning_income_revisions(profile_id,effective_month,as_of_date,amount,created_at) VALUES(?,?,?,?,?)",
      [profile.id, "2026-10", "2026-10-03", "10000", ""],
    );

    await expect(getFinancialMaintenanceState(db, "2026-10-03")).rejects.toMatchObject({
      code: "INVALID_STORED_DATA",
    });
  });

  it("keeps V1 rows and appends same-day/month revisions; prior months and file reopen retain correct values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "finance-maintenance-"));
    tempDirs.push(directory);
    const path = join(directory, "maintenance.sqlite");
    const db = fileDatabase(path);
    await migrateDatabase(db);
    await onboard(db);
    const before = await getFinancialMaintenanceState(db, "2026-10-03");
    const originalCash = first(before.cashAccounts);
    const originalAsset = first(before.assets);
    const originalDebt = first(before.debts);
    const originalEssential = first(before.essentialExpenses);
    const [oldCashRow] = await db.select("SELECT id,balance FROM cash_balance_snapshots");
    const [oldAssetRow] = await db.select("SELECT id,value FROM asset_value_snapshots");
    const [oldDebtRow] = await db.select(
      "SELECT id,current_balance,current_month_due FROM debt_period_facts",
    );
    await updateFinancialDataAndRecalculate(
      db,
      {
        stableMonthlyIncome: "11000",
        essentialExpenses: [{ id: originalEssential.id, monthlyAmount: "1500" }],
        cashAccounts: [{ id: originalCash.id, balance: "5200" }],
        assets: [{ id: originalAsset.id, currentValue: "1100" }],
        debts: [
          {
            id: originalDebt.id,
            currentBalance: "1900",
            currentMonthDue: "600",
            fixedMonthlyPayment: "700",
          },
        ],
      },
      "2026-10-03",
    );
    await updateFinancialDataAndRecalculate(
      db,
      {
        essentialExpenses: [{ id: originalEssential.id, monthlyAmount: "1600" }],
        cashAccounts: [{ id: originalCash.id, balance: "5300" }],
        assets: [{ id: originalAsset.id, currentValue: "1200" }],
        debts: [
          {
            id: originalDebt.id,
            currentBalance: "1800",
            currentMonthDue: "650",
            fixedMonthlyPayment: "750",
          },
        ],
      },
      "2026-10-03",
    );
    await updateFinancialDataAndRecalculate(
      db,
      {
        debts: [
          {
            id: originalDebt.id,
            currentBalance: "1700",
            currentMonthDue: "800",
            fixedMonthlyPayment: "900",
          },
        ],
        stableMonthlyIncome: "12000",
      },
      "2026-11-03",
    );

    const october = await buildMonthlyModelInput(db, "2026-10", "2026-10-03");
    const november = await buildMonthlyModelInput(db, "2026-11", "2026-11-03");
    expect(october.status).toBe("READY");
    expect(november.status).toBe("READY");
    if (october.status !== "READY" || november.status !== "READY")
      throw new Error("Expected model inputs.");
    expect(october.input.facts.planningIncome).toBe("11000");
    expect(october.input.facts.debts[0]).toMatchObject({
      currentBalance: "1800",
      currentMonthDue: "650",
      fixedMonthlyPayment: "750",
    });
    expect(november.input.facts.planningIncome).toBe("12000");
    expect(november.input.facts.debts[0]).toMatchObject({
      currentBalance: "1700",
      currentMonthDue: "800",
      fixedMonthlyPayment: "900",
    });
    expect(await db.select("SELECT id,balance FROM cash_balance_snapshots")).toEqual([oldCashRow]);
    expect(await db.select("SELECT id,value FROM asset_value_snapshots")).toEqual([oldAssetRow]);
    expect(
      await db.select("SELECT id,current_balance,current_month_due FROM debt_period_facts"),
    ).toEqual([oldDebtRow]);
    expect(
      await db.select(
        "SELECT balance FROM cash_account_revisions WHERE account_id=? ORDER BY revision_id",
        [originalCash.id],
      ),
    ).toEqual([{ balance: "5200" }, { balance: "5300" }]);
    expect(
      await db.select(
        "SELECT current_value FROM asset_revisions WHERE asset_id=? ORDER BY revision_id",
        [originalAsset.id],
      ),
    ).toEqual([{ current_value: "1100" }, { current_value: "1200" }]);
    expect(
      await db.select(
        "SELECT monthly_amount FROM essential_expense_revisions WHERE item_id=? ORDER BY revision_id",
        [originalEssential.id],
      ),
    ).toEqual([{ monthly_amount: "1500" }, { monthly_amount: "1600" }]);
    expect(
      await db.select(
        "SELECT current_month_due FROM debt_revisions WHERE debt_id=? ORDER BY revision_id",
        [originalDebt.id],
      ),
    ).toEqual([
      { current_month_due: "600" },
      { current_month_due: "650" },
      { current_month_due: "800" },
    ]);
    db.close();
    openDatabases.splice(openDatabases.indexOf(db), 1);
    const reopened = fileDatabase(path);
    const readback = await getFinancialMaintenanceState(reopened, "2026-11-03");
    expect(readback.stableMonthlyIncome).toBe("12000");
    expect(readback.cashAccounts[0]?.balance).toBe("5300");
    expect(readback.assets[0]?.currentValue).toBe("1200");
    expect(readback.essentialExpenses[0]?.monthlyAmount).toBe("1600");
    expect(readback.debts[0]).toMatchObject({
      currentBalance: "1700",
      currentMonthDue: "800",
      fixedMonthlyPayment: "900",
    });
  });

  it("rolls back invalid facts and validates horizon need without losing prior settings", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    const before = await getFinancialMaintenanceState(db, "2026-10-03");
    await expect(
      updateFinancialDataAndRecalculate(
        db,
        {
          stableMonthlyIncome: "NaN",
          cashAccounts: [{ id: first(before.cashAccounts).id, balance: "9999" }],
        },
        "2026-10-03",
      ),
    ).rejects.toThrow();
    const after = await getFinancialMaintenanceState(db, "2026-10-03");
    expect(after.stableMonthlyIncome).toBe(before.stableMonthlyIncome);
    expect(after.cashAccounts[0]?.balance).toBe(before.cashAccounts[0]?.balance);
    const requirement = await import("../src/application/financial-maintenance-service.js").then(
      ({ getFinancialMaintenanceRequirement }) =>
        getFinancialMaintenanceRequirement(
          db,
          {
            cashAccounts: [{ id: first(before.cashAccounts).id, balance: "0" }],
            settings: { safetyCoverageTargetMonths: 10 },
          },
          "2026-10-03",
        ),
    );
    expect(requirement.requiresSafetyRecoveryHorizon).toBe(true);
  });

  it("does not create an unnecessary settings revision for identical safety targets", async () => {
    const db = await memoryDatabase();
    await onboard(db);
    await updateFinancialDataAndRecalculate(
      db,
      { settings: { safetyCoverageTargetMonths: 1, minimumCashCoverageMonths: 1 } },
      "2026-10-03",
    );
    expect(await db.select("SELECT revision_id FROM settings_revisions")).toEqual([]);
  });
});
