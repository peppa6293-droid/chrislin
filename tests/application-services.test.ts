import { afterEach, describe, expect, it } from "vitest";
import {
  completeOnboarding,
  getHomeApplicationState,
  getOnboardingRequirement,
  type OnboardingSubmission,
  recordExpenseAndRecalculate,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const databases: NodeSqliteDatabase[] = [];
async function database(): Promise<NodeSqliteDatabase> {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await migrateDatabase(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function submission(overrides: Partial<OnboardingSubmission> = {}): OnboardingSubmission {
  return {
    displayName: "Test profile",
    stableMonthlyIncome: "10000",
    essentialExpenses: [
      { category: "HOUSING", monthlyAmount: "1000" },
      { category: "BASIC_FOOD", monthlyAmount: "500" },
    ],
    cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
    assets: [{ name: "Fund", currentValue: "1000", includeInSafetyResources: true }],
    debts: [
      { name: "Loan", currentBalance: "2000", currentMonthDue: "500", fixedMonthlyPayment: "500" },
    ],
    safetyCoverageTargetMonths: 3,
    minimumCashCoverageMonths: 1,
    desiredMonthlyDiscretionarySpending: "2000",
    ...overrides,
  };
}

describe("product application services", () => {
  it("validates whether the frozen model requires a safety recovery horizon", () => {
    expect(getOnboardingRequirement(submission(), "2026-10-03")).toEqual({
      requiresSafetyRecoveryHorizon: false,
    });
    const gap = submission({
      cashAccounts: [{ name: "Checking", balance: "0", includeInSafetyResources: true }],
      assets: [],
    });
    expect(getOnboardingRequirement(gap, "2026-10-03")).toEqual({
      requiresSafetyRecoveryHorizon: true,
    });
    expect(() =>
      getOnboardingRequirement(submission({ stableMonthlyIncome: "bad" }), "2026-10-03"),
    ).toThrow();
  });

  it("saves onboarding atomically and returns a full database-backed baseline home state", async () => {
    const db = await database();
    const home = await completeOnboarding(db, submission(), "2026-10-03");
    expect(home).toMatchObject({
      status: "READY",
      currentMonth: "2026-10",
      asOfDate: "2026-10-03",
      trendState: "BASELINE_BUILDING",
      profileDisplayName: "Test profile",
      actualIncomeRecordCount: 0,
      currentCash: "5000",
      currentMonthSpending: "0",
      totalDebt: "2000",
      liquidAssets: "1000",
      desiredMonthlyDiscretionarySpending: "2000",
      planningIncome: "10000",
      essentialExpenses: "1500",
      mandatoryDebtService: "500",
      monthlyCoreObligations: "2000",
      baseSurplus: "8000",
      eligibleCash: "5000",
      eligibleLiquidInvestmentAssets: "1000",
      safetyResources: "6000",
      safetyTargetResources: "6000",
      safetyCoverageMonths: "3",
      safetyCoverageTargetMonths: 3,
      minimumCashCoverageMonths: 1,
      safetyGap: "0",
      debts: [
        expect.objectContaining({
          name: "Loan",
          currentBalance: "2000",
          currentMonthDue: "500",
          fixedMonthlyPayment: "500",
          countedMonthlyPayment: "500",
          paymentSource: "CURRENT_MONTH_DUE",
        }),
      ],
      consumptionUtilization: { status: "CALCULATED" },
    });
    expect(home).toHaveProperty("recommendedMonthlySpending");
    expect(home).toHaveProperty("remainingSpendingCapacity");
    expect(home).toHaveProperty("amountAboveRecommendation");
    expect(home).toHaveProperty("cashCoverageMonths");
    expect(home).toHaveProperty("spendingStatus");
    expect(home).toHaveProperty("cashSafetyGateStatus");
    expect(home).toHaveProperty("cashFloorMet", true);
    expect(home).toHaveProperty("primaryImprovement");
    expect(home).toHaveProperty("primaryDrag");
    expect(home).toHaveProperty("priorityAction.action_code");
    expect((await db.select("SELECT kind,period_month FROM income_records"))[0]).toMatchObject({
      kind: "PLANNING",
      period_month: null,
    });
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(0);
    expect(await getHomeApplicationState(db, "2026-10-03")).toEqual(home);
  });

  it("requires a horizon only when Model Core says it is required", async () => {
    const db = await database();
    await expect(
      completeOnboarding(
        db,
        submission({
          cashAccounts: [{ name: "Checking", balance: "0", includeInSafetyResources: true }],
          assets: [],
        }),
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "SAFETY_RECOVERY_HORIZON_REQUIRED" });
    expect(await db.select("SELECT * FROM profiles")).toHaveLength(0);
    const home = await completeOnboarding(
      db,
      submission({
        cashAccounts: [{ name: "Checking", balance: "0", includeInSafetyResources: true }],
        assets: [],
        safetyRecoveryHorizonMonths: 12,
      }),
      "2026-10-03",
    );
    expect(home.status).toBe("READY");
  });

  it("rolls back empty or invalid onboarding without a partial profile", async () => {
    const db = await database();
    await expect(
      completeOnboarding(db, {} as OnboardingSubmission, "2026-10-03"),
    ).rejects.toThrow();
    await expect(
      completeOnboarding(db, submission({ stableMonthlyIncome: "invalid" }), "2026-10-03"),
    ).rejects.toThrow();
    await expect(
      completeOnboarding(
        db,
        submission({ essentialExpenses: [{ category: "BOGUS" as never, monthlyAmount: "1" }] }),
        "2026-10-03",
      ),
    ).rejects.toThrow();
    expect(await db.select("SELECT * FROM profiles")).toHaveLength(0);
    expect(await db.select("SELECT * FROM financial_settings")).toHaveLength(0);
  });

  it("saves an expense and recalculates spend, trend, and action in the same transaction", async () => {
    const db = await database();
    await completeOnboarding(db, submission({ safetyCoverageTargetMonths: 0 }), "2026-10-03");
    const cash = (await db.select("SELECT id FROM cash_accounts"))[0]?.id as string;
    const asset = (await db.select("SELECT id FROM assets"))[0]?.id as string;
    const debt = (await db.select("SELECT id FROM debts"))[0]?.id as string;
    const essentialItems = await db.select("SELECT id,monthly_amount FROM essential_expense_items");
    await db.execute(
      "INSERT INTO cash_balance_snapshots(id,account_id,as_of_date,balance,created_at) VALUES(?,?,?,?,?)",
      ["prior-cash", cash, "2026-09-03", "5000", "2026-09-03T00:00:00.000Z"],
    );
    await db.execute(
      "INSERT INTO asset_value_snapshots(id,asset_id,as_of_date,value,created_at) VALUES(?,?,?,?,?)",
      ["prior-asset", asset, "2026-09-03", "1000", "2026-09-03T00:00:00.000Z"],
    );
    for (const item of essentialItems) {
      await db.execute(
        "INSERT INTO essential_expense_snapshots(id,item_id,as_of_date,monthly_amount,created_at) VALUES(?,?,?,?,?)",
        [
          `prior-${item.id as string}`,
          item.id,
          "2026-09-03",
          item.monthly_amount,
          "2026-09-03T00:00:00.000Z",
        ],
      );
    }
    await db.execute(
      "INSERT INTO debt_period_facts(id,debt_id,period_month,as_of_date,current_balance,current_month_due,created_at) VALUES(?,?,?,?,?,?,?)",
      ["prior-debt", debt, "2026-09", "2026-09-03", "2000", "500", "2026-09-03T00:00:00.000Z"],
    );
    const before = await getHomeApplicationState(db, "2026-10-03");
    const after = await recordExpenseAndRecalculate(
      db,
      {
        amount: "2500",
        dateTime: "2026-10-03T12:00:00.000Z",
        businessDate: "2026-10-03",
        category: "FOOD",
      },
      "2026-10-03",
    );
    expect(after.currentMonthSpending).toBe("2500");
    expect(after.recommendedMonthlySpending).toBe(before.recommendedMonthlySpending);
    expect(after.remainingSpendingCapacity).toBe("0");
    expect(after.amountAboveRecommendation).toBe("500");
    expect(after.consumptionUtilization.value).not.toBe(before.consumptionUtilization.value);
    expect(before.priorityAction.action_code).toBe("NO_ACTION");
    expect(after.trendState).toBe("UNDER_PRESSURE");
    expect(after.primaryDrag).toBe("CONSUMPTION");
    expect(after.priorityAction.action_code).toBe("ADDRESS_PRIMARY_DRAG");
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(1);
    await expect(
      recordExpenseAndRecalculate(
        db,
        { amount: "0", dateTime: "2026-10-03T12:00:00.000Z", businessDate: "2026-10-03" },
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_AMOUNT" });
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(1);
    await expect(
      recordExpenseAndRecalculate(
        db,
        { amount: "10", dateTime: "2026-10-03T12:00:00.000Z", businessDate: "2026-10-03" },
        "2026-10-03x",
      ),
    ).rejects.toThrow();
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(1);
  });
});
