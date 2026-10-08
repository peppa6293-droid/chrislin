import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  type OnboardingSubmission,
  recordExpenseAndRecalculate,
} from "../src/application/product-service.js";
import type { SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const asOfDate = "2026-10-03";

function onboarding(overrides: Partial<OnboardingSubmission> = {}): OnboardingSubmission {
  return {
    displayName: "Riley",
    stableMonthlyIncome: "10000",
    essentialExpenses: [{ category: "HOUSING", monthlyAmount: "2000" }],
    cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
    assets: [{ name: "Fund", currentValue: "400", includeInSafetyResources: true }],
    debts: [{ name: "Loan", currentBalance: "1000", currentMonthDue: "100" }],
    safetyCoverageTargetMonths: 1,
    minimumCashCoverageMonths: 1,
    desiredMonthlyDiscretionarySpending: "1000",
    ...overrides,
  };
}

let db: NodeSqliteDatabase;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
});

afterEach(() => db.close());

describe("product application service", () => {
  it("persists Chinese display names exactly and leaves Model Core outputs invariant", async () => {
    const englishNames: OnboardingSubmission = {
      ...onboarding({
        stableMonthlyIncome: "13000",
        essentialExpenses: [
          { category: "HOUSING", monthlyAmount: "1900" },
          { category: "TRANSPORT", monthlyAmount: "1028" },
          { category: "UTILITIES_COMMUNICATIONS", monthlyAmount: "600" },
        ],
        cashAccounts: [
          { name: "Yu'e Bao", balance: "4805.61", includeInSafetyResources: true },
          { name: "Agricultural Bank of China", balance: "0", includeInSafetyResources: true },
          { name: "Bank of Shanghai", balance: "0", includeInSafetyResources: true },
          { name: "Restricted rent cash", balance: "3800", includeInSafetyResources: false },
        ],
        assets: [
          { name: "Alipay fund", currentValue: "3842", includeInSafetyResources: true },
          {
            name: "Short-term wealth product 1",
            currentValue: "10000",
            includeInSafetyResources: false,
          },
          {
            name: "Short-term wealth product 2",
            currentValue: "7000",
            includeInSafetyResources: false,
          },
          {
            name: "Short-term wealth product 3",
            currentValue: "3000",
            includeInSafetyResources: false,
          },
        ],
        debts: [
          {
            name: "CMB installment debt",
            currentBalance: "46605.10",
            currentMonthDue: "5679.47",
          },
          {
            name: "Car loan / SPD Bank",
            currentBalance: "118137.60",
            currentMonthDue: "3487.87",
            fixedMonthlyPayment: "3487.87",
          },
          { name: "Huabei", currentBalance: "5306.76", currentMonthDue: "4362.56" },
          { name: "JD Baitiao", currentBalance: "2198.70", currentMonthDue: "657.46" },
          {
            name: "Meituan Monthly Pay",
            currentBalance: "331.37",
            currentMonthDue: "331.37",
          },
        ],
        safetyCoverageTargetMonths: 6,
        minimumCashCoverageMonths: 2,
        desiredMonthlyDiscretionarySpending: "1600",
      }),
    };
    const chineseNames: OnboardingSubmission = {
      ...englishNames,
      cashAccounts: [
        { name: "余额宝", balance: "4805.61", includeInSafetyResources: true },
        { name: "农业银行", balance: "0", includeInSafetyResources: true },
        { name: "上海银行", balance: "0", includeInSafetyResources: true },
        { name: "房租专用资金", balance: "3800", includeInSafetyResources: false },
      ],
      assets: [
        { name: "支付宝基金", currentValue: "3842", includeInSafetyResources: true },
        { name: "短期理财 1", currentValue: "10000", includeInSafetyResources: false },
        { name: "短期理财 2", currentValue: "7000", includeInSafetyResources: false },
        { name: "短期理财 3", currentValue: "3000", includeInSafetyResources: false },
      ],
      debts: [
        { name: "招商分期", currentBalance: "46605.10", currentMonthDue: "5679.47" },
        {
          name: "浦发车贷",
          currentBalance: "118137.60",
          currentMonthDue: "3487.87",
          fixedMonthlyPayment: "3487.87",
        },
        { name: "花呗", currentBalance: "5306.76", currentMonthDue: "4362.56" },
        { name: "京东白条", currentBalance: "2198.70", currentMonthDue: "657.46" },
        { name: "美团月付", currentBalance: "331.37", currentMonthDue: "331.37" },
      ],
    };

    const englishDb = new NodeSqliteDatabase();
    const chineseDb = new NodeSqliteDatabase();
    try {
      await migrateDatabase(englishDb, `${asOfDate}T00:00:00.000Z`);
      await migrateDatabase(chineseDb, `${asOfDate}T00:00:00.000Z`);
      const englishHome = await completeOnboarding(englishDb, englishNames, asOfDate);
      const chineseHome = await completeOnboarding(chineseDb, chineseNames, asOfDate);

      const { debts: englishDebts, ...englishFinancialState } = englishHome;
      const { debts: chineseDebts, ...chineseFinancialState } = chineseHome;
      expect(chineseFinancialState).toEqual(englishFinancialState);
      const debtFacts = (debts: typeof chineseDebts) =>
        debts
          .map(
            ({
              currentBalance,
              currentMonthDue,
              fixedMonthlyPayment,
              countedMonthlyPayment,
              paymentSource,
            }) => ({
              currentBalance,
              currentMonthDue,
              fixedMonthlyPayment,
              countedMonthlyPayment,
              paymentSource,
            }),
          )
          .sort((left, right) => left.currentBalance.localeCompare(right.currentBalance));
      expect(debtFacts(chineseDebts)).toEqual(debtFacts(englishDebts));
      expect(chineseHome).toMatchObject({
        spendingStatus: "STRUCTURAL_DEFICIT",
        priorityAction: { action_code: "RESTORE_CORE_BALANCE" },
        trendState: "BASELINE_BUILDING",
      });

      expect(await chineseDb.select("SELECT name FROM cash_accounts ORDER BY name")).toEqual(
        ["上海银行", "余额宝", "农业银行", "房租专用资金"].map((name) => ({ name })),
      );
      expect(await chineseDb.select("SELECT name FROM assets ORDER BY name")).toEqual(
        ["支付宝基金", "短期理财 1", "短期理财 2", "短期理财 3"].map((name) => ({ name })),
      );
      expect(await chineseDb.select("SELECT name FROM debts ORDER BY name")).toEqual(
        ["京东白条", "招商分期", "浦发车贷", "美团月付", "花呗"].map((name) => ({ name })),
      );
      const persisted = await getFinancialMaintenanceState(chineseDb, asOfDate);
      expect(persisted.assets.map((asset) => asset.kind)).toEqual([
        "LIQUID_INVESTMENT",
        "LIQUID_INVESTMENT",
        "LIQUID_INVESTMENT",
        "LIQUID_INVESTMENT",
      ]);
      expect(persisted.assets.map((asset) => asset.includeInSafetyResources).sort()).toEqual([
        false,
        false,
        false,
        true,
      ]);
    } finally {
      englishDb.close();
      chineseDb.close();
    }
  });

  it("rolls over aggregate cash and essential totals above the individual input ceiling", async () => {
    const home = await completeOnboarding(
      db,
      onboarding({
        stableMonthlyIncome: "10000",
        essentialExpenses: [
          { category: "HOUSING", monthlyAmount: "600000000000" },
          { category: "BASIC_FOOD", monthlyAmount: "600000000000" },
        ],
        cashAccounts: [
          { name: "Cash A", balance: "600000000000", includeInSafetyResources: true },
          { name: "Cash B", balance: "600000000000", includeInSafetyResources: true },
        ],
        assets: [],
        debts: [],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 0,
        desiredMonthlyDiscretionarySpending: "0",
      }),
      asOfDate,
    );
    expect(home.currentCash).toBe("1200000000000");
    expect(home.spendingStatus).toBe("STRUCTURAL_DEFICIT");
    expect((await getHomeApplicationState(db, "2026-11-03")).currentCash).toBe("1200000000000");
    const built = await buildMonthlyModelInput(db, "2026-11", "2026-11-03");
    expect(built.status).toBe("READY");
    if (built.status === "READY") {
      expect(built.input.facts.essentialExpenses).toBe("1200000000000");
      expect(built.input.facts.previousSnapshot?.eligibleCash).toBe("1200000000000");
    }
    const maintenance = await getFinancialMaintenanceState(db, "2026-11-03");
    expect(
      maintenance.cashAccounts.reduce((sum, account) => sum + BigInt(account.balance), 0n),
    ).toBe(1200000000000n);
  });

  it("reconstructs a precise scientific-notation recommendation across months", async () => {
    await completeOnboarding(
      db,
      onboarding({
        stableMonthlyIncome: "1.01",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1" }],
        cashAccounts: [{ name: "Cash", balance: "0.99", includeInSafetyResources: true }],
        assets: [],
        debts: [],
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 0,
        safetyRecoveryHorizonMonths: 1.000001,
        desiredMonthlyDiscretionarySpending: "0.01",
      }),
      "2026-09-03",
    );
    const firstMonth = await getHomeApplicationState(db, "2026-09-03");
    expect(firstMonth.recommendedMonthlySpending).toBe("9.99999000000999999000000999999e-9");
    const nextMonth = await getHomeApplicationState(db, "2026-10-03");
    expect(nextMonth.status).toBe("READY");
    const built = await buildMonthlyModelInput(db, "2026-10", "2026-10-03");
    expect(built.status).toBe("READY");
    if (built.status === "READY") {
      expect(built.input.facts.previousSnapshot?.recommendedMonthlySpending).toBe(
        firstMonth.recommendedMonthlySpending,
      );
    }
    await expect(getFinancialMaintenanceState(db, "2026-10-03")).resolves.toMatchObject({
      asOfDate: "2026-10-03",
    });
  });

  it("persists submitted onboarding facts and returns the Model Core home state", async () => {
    const home = await completeOnboarding(db, onboarding(), asOfDate);

    expect(home).toMatchObject({
      status: "READY",
      asOfDate,
      profileDisplayName: "Riley",
      currentCash: "5000",
      currentMonthSpending: "0",
      totalDebt: "1000",
      liquidAssets: "400",
      spendingStatus: "NORMAL",
      cashSafetyGateStatus: "CLEAR",
      cashFloorMet: true,
      trendState: "BASELINE_BUILDING",
    });
    expect(await getHomeApplicationState(db, asOfDate)).toEqual(home);
    expect(await db.select("SELECT id FROM profiles")).toHaveLength(1);
    expect(await db.select("SELECT amount FROM income_records")).toEqual([{ amount: "10000" }]);
  });

  it("requires and accepts a recovery horizon only when Model Core requires it", async () => {
    const needsHorizon = onboarding({
      stableMonthlyIncome: "1000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "100" }],
      cashAccounts: [],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 6,
    });
    await expect(completeOnboarding(db, needsHorizon, asOfDate)).rejects.toMatchObject({
      code: "SAFETY_RECOVERY_HORIZON_REQUIRED",
    });
    expect(await db.select("SELECT id FROM profiles")).toHaveLength(0);

    const home = await completeOnboarding(
      db,
      { ...needsHorizon, safetyRecoveryHorizonMonths: 12 },
      asOfDate,
    );
    expect(home.status).toBe("READY");
  });

  it("rolls back all onboarding writes when a submitted fact fails validation", async () => {
    const invalid = onboarding({
      essentialExpenses: [
        {
          category: "UNKNOWN" as OnboardingSubmission["essentialExpenses"][number]["category"],
          monthlyAmount: "2000",
        },
      ],
    });
    await expect(completeOnboarding(db, invalid, asOfDate)).rejects.toMatchObject({
      code: "INVALID_ESSENTIAL_CATEGORY",
    });
    for (const table of [
      "profiles",
      "financial_settings",
      "income_records",
      "essential_expense_items",
    ]) {
      expect(await db.select(`SELECT * FROM ${table}`)).toHaveLength(0);
    }
  });

  it("saves an expense and immediately returns the recalculated home state", async () => {
    await completeOnboarding(db, onboarding(), asOfDate);
    const home = await recordExpenseAndRecalculate(
      db,
      {
        amount: "125.50",
        dateTime: `${asOfDate}T10:30:00.000Z`,
        businessDate: asOfDate,
        category: "FOOD",
        note: "Lunch",
      },
      asOfDate,
    );

    expect(home.currentMonthSpending).toBe("125.5");
    expect(home.remainingSpendingCapacity).toBe("874.5");
    expect(await db.select("SELECT amount,category,note FROM expense_records")).toEqual([
      { amount: "125.5", category: "FOOD", note: "Lunch" },
    ]);
  });

  it.each([
    { label: "+08 month start", instant: "2026-10-01T00:30:00+08:00", businessDate: "2026-10-01" },
    { label: "-04 month end", instant: "2026-09-30T23:30:00-04:00", businessDate: "2026-09-30" },
    { label: "year end", instant: "2025-12-31T23:30:00-05:00", businessDate: "2025-12-31" },
    { label: "leap day", instant: "2024-02-29T23:30:00-05:00", businessDate: "2024-02-29" },
    {
      label: "short month end",
      instant: "2026-02-28T23:59:59.999-05:00",
      businessDate: "2026-02-28",
    },
  ])(
    "keeps local date through service, persistence, model and Home ($label)",
    async ({ instant, businessDate }) => {
      await completeOnboarding(db, onboarding(), businessDate);
      const home = await recordExpenseAndRecalculate(
        db,
        { amount: "0.01", dateTime: instant, businessDate },
        businessDate,
      );
      expect(home.currentMonth).toBe(businessDate.slice(0, 7));
      expect(home.currentMonthSpending).toBe("0.01");
      expect(
        (await new Repositories(db).listExpenses(businessDate, businessDate))[0]?.businessDate,
      ).toBe(businessDate);
    },
  );

  it("keeps both instants in a repeated DST hour under the same local day", async () => {
    const date = "2026-11-01";
    await completeOnboarding(db, onboarding(), date);
    const one = await recordExpenseAndRecalculate(
      db,
      { amount: "0.01", dateTime: "2026-11-01T01:30:00-04:00", businessDate: date },
      date,
    );
    const two = await recordExpenseAndRecalculate(
      db,
      { amount: "0.01", dateTime: "2026-11-01T01:30:00-05:00", businessDate: date },
      date,
    );
    expect(one.currentMonthSpending).toBe("0.01");
    expect(two.currentMonthSpending).toBe("0.02");
    expect(
      await db.select("SELECT occurred_at,business_date FROM expense_records ORDER BY occurred_at"),
    ).toEqual([
      { occurred_at: "2026-11-01T01:30:00-04:00", business_date: date },
      { occurred_at: "2026-11-01T01:30:00-05:00", business_date: date },
    ]);
  });

  it("rejects unsupported currency precision and range at the service boundary", async () => {
    await completeOnboarding(db, onboarding(), asOfDate);
    for (const amount of ["1000000000000.00", "1.001", "1e3", "NaN", "Infinity"]) {
      await expect(
        recordExpenseAndRecalculate(
          db,
          { amount, dateTime: `${asOfDate}T10:00:00Z`, businessDate: asOfDate },
          asOfDate,
        ),
      ).rejects.toMatchObject({ code: "INVALID_EXPENSE_AMOUNT" });
    }
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(0);
  });

  it("preserves an unselected expense category as SQL NULL", async () => {
    await completeOnboarding(db, onboarding(), asOfDate);
    const home = await recordExpenseAndRecalculate(
      db,
      { amount: "25", dateTime: `${asOfDate}T10:30:00.000Z`, businessDate: asOfDate },
      asOfDate,
    );

    expect(home.currentMonthSpending).toBe("25");
    expect(await db.select("SELECT category FROM expense_records")).toEqual([{ category: null }]);
    const expenses = await new Repositories(db).listExpenses(asOfDate, asOfDate);
    expect(expenses[0]?.category).toBe("OTHER_VARIABLE");
    expect((await getHomeApplicationState(db, asOfDate)).currentMonthSpending).toBe("25");
  });

  it("rolls back a saved expense if recalculation fails", async () => {
    await completeOnboarding(db, onboarding(), asOfDate);
    const failingDb: SqlDatabase = {
      execute: (sql, values) => db.execute(sql, values),
      select: (sql, values) => db.select(sql, values),
      transaction: (work) =>
        db.transaction(async (transactionDb) => {
          let expenseInserted = false;
          const tx: SqlDatabase = {
            execute: async (sql, values) => {
              const result = await transactionDb.execute(sql, values);
              if (sql.includes("INSERT INTO expense_records")) expenseInserted = true;
              return result;
            },
            select: async (sql, values) => {
              if (expenseInserted) throw new Error("Injected recalculation failure");
              return transactionDb.select(sql, values);
            },
            transaction: (nestedWork) => transactionDb.transaction(nestedWork),
          };
          return work(tx);
        }),
    };

    await expect(
      recordExpenseAndRecalculate(
        failingDb,
        { amount: "50", dateTime: `${asOfDate}T10:30:00.000Z`, businessDate: asOfDate },
        asOfDate,
      ),
    ).rejects.toThrow("Injected recalculation failure");
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(0);
  });

  it("rejects invalid quick-entry amounts and timestamps before writing", async () => {
    await completeOnboarding(db, onboarding(), asOfDate);
    await expect(
      recordExpenseAndRecalculate(
        db,
        { amount: "0", dateTime: `${asOfDate}T10:30:00Z`, businessDate: asOfDate },
        asOfDate,
      ),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_AMOUNT" });
    await expect(
      recordExpenseAndRecalculate(
        db,
        { amount: "10", dateTime: "2026-02-30T10:30:00Z", businessDate: asOfDate },
        asOfDate,
      ),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_DATE" });
    expect(await db.select("SELECT * FROM expense_records")).toHaveLength(0);
  });
});
