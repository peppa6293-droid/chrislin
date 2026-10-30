import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeOnboarding,
  getHomeApplicationState,
  getOnboardingRequirement,
  type OnboardingSubmission,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const asOfDate = "2026-10-30";
const m1 = (o: Partial<OnboardingSubmission> = {}): OnboardingSubmission => ({
  stableMonthlyIncome: "10000",
  essentialExpenses: [{ category: "HOUSING", monthlyAmount: "4000" }],
  cashAccounts: [{ name: "现金", balance: "30000", includeInSafetyResources: true }],
  assets: [],
  debts: [],
  safetyCoverageTargetMonths: 6,
  minimumCashCoverageMonths: 1,
  desiredMonthlyDiscretionarySpending: "2000",
  ...o,
});

let db: NodeSqliteDatabase;
beforeEach(async () => {
  db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
});
afterEach(() => db.close());

const count = async (table: string) =>
  Number((await db.select<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0]?.n);

describe("M1 first-time setup: income, essentials, cash, safety targets", () => {
  it("saves and reads back with no asset or debt rows invented", async () => {
    const home = await completeOnboarding(db, m1(), asOfDate);
    expect(home).toMatchObject({
      planningIncome: "10000",
      essentialExpenses: "4000",
      currentCash: "30000",
      totalDebt: "0",
      liquidAssets: "0",
      safetyCoverageTargetMonths: 6,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    });
    expect(await getHomeApplicationState(db, asOfDate)).toEqual(home);
    expect([await count("assets"), await count("debts")]).toEqual([0, 0]);
  });

  it("asks for a recovery horizon exactly when the model requires it", async () => {
    expect(getOnboardingRequirement(m1(), asOfDate)).toEqual({
      requiresSafetyRecoveryHorizon: false,
    });
    const gap = m1({
      cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
    });
    expect(getOnboardingRequirement(gap, asOfDate)).toEqual({
      requiresSafetyRecoveryHorizon: true,
    });
    await expect(completeOnboarding(db, gap, asOfDate)).rejects.toMatchObject({
      code: "SAFETY_RECOVERY_HORIZON_REQUIRED",
    });
    expect(await count("profiles")).toBe(0);
  });

  it.each([
    ["non-numeric income", { stableMonthlyIncome: "abc" }],
    ["three decimals", { stableMonthlyIncome: "100.123" }],
    ["thousands separator", { stableMonthlyIncome: "1,000" }],
    [
      "negative essential",
      { essentialExpenses: [{ category: "HOUSING" as const, monthlyAmount: "-5" }] },
    ],
    [
      "negative cash",
      { cashAccounts: [{ name: "现金", balance: "-1", includeInSafetyResources: true }] },
    ],
    ["negative target months", { safetyCoverageTargetMonths: -1 }],
    ["NaN floor months", { minimumCashCoverageMonths: Number.NaN }],
    ["empty desired spending", { desiredMonthlyDiscretionarySpending: "" }],
  ])("rejects %s and writes nothing", async (_name, override) => {
    await expect(completeOnboarding(db, m1(override), asOfDate)).rejects.toBeDefined();
    for (const table of ["profiles", "financial_settings", "income_records", "cash_accounts"])
      expect(await count(table)).toBe(0);
  });

  it("a second submission cannot create a second profile", async () => {
    await completeOnboarding(db, m1(), asOfDate);
    await expect(
      completeOnboarding(db, m1({ stableMonthlyIncome: "99999" }), asOfDate),
    ).rejects.toBeDefined();
    expect(await count("profiles")).toBe(1);
    expect(await count("cash_accounts")).toBe(1);
    expect(await db.select("SELECT amount FROM income_records")).toEqual([{ amount: "10000" }]);
  });
});
