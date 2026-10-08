import { describe, expect, it } from "vitest";
import { calculateDebt } from "../src/model/debt.js";
import { ModelValidationError } from "../src/model/errors.js";
import { formatMoneyExact, money } from "../src/model/money.js";
import { calculateMonthlyModel } from "../src/model/monthly-model.js";
import { calculateActualVariableSpending } from "../src/model/spending.js";
import { makeHistory, makeInput, variableExpense } from "./fixtures/model-input.js";
import { ownerProfileFixture } from "./fixtures/owner-profile.js";

const completedTrend = (input: ReturnType<typeof makeInput>) => {
  const result = calculateMonthlyModel(input);
  expect(result.trend.status).toBe("COMPLETE");
  if (result.trend.status !== "COMPLETE") throw new Error("Expected trend result to be complete.");
  return result.trend.result;
};

describe("debt engine", () => {
  it("supports a user with no debts", () => {
    const result = calculateDebt([]);
    expect(result.mandatoryDebtService.toString()).toBe("0");
    expect(result.totalDebtBalance.toString()).toBe("0");
  });

  it("sums payment obligations and balances across multiple debts", () => {
    const result = calculateDebt([
      { id: "a", name: "A", currentBalance: "1000", currentMonthDue: "100" },
      { id: "b", name: "B", currentBalance: "2000", fixedMonthlyPayment: "200" },
      {
        id: "c",
        name: "C",
        currentBalance: "3000",
        currentMonthDue: "250",
        fixedMonthlyPayment: "900",
      },
    ]);
    expect(result.mandatoryDebtService.toString()).toBe("550");
    expect(result.totalDebtBalance.toString()).toBe("6000");
  });

  it("uses current-month due instead of also counting fixed payment", () => {
    const result = calculateDebt([
      {
        id: "loan",
        name: "Loan",
        currentBalance: "10000",
        currentMonthDue: "350",
        fixedMonthlyPayment: "400",
      },
    ]);
    expect(result.mandatoryDebtService.toString()).toBe("350");
    expect(result.debtPayments[0]?.source).toBe("CURRENT_MONTH_DUE");
  });
});

describe("safety and spending engines", () => {
  it("calculates a positive Base Surplus", () => {
    const result = calculateMonthlyModel(makeInput());
    expect(result.spending.status).toBe("NORMAL");
    expect(result.spending.baseSurplus.toString()).toBe("8000");
  });

  it("treats zero Base Surplus as BALANCED_NO_SURPLUS", () => {
    const result = calculateMonthlyModel(
      makeInput({ facts: { planningIncome: "5000", essentialExpenses: "5000", cashAccounts: [] } }),
    );
    expect(result.spending.status).toBe("BALANCED_NO_SURPLUS");
    expect(result.spending.recommendedMonthlySpending.toString()).toBe("0");
    expect(result.spending.remainingOptionalSpendingCapacity.toString()).toBe("0");
    expect(result.spending.recommendedNewInvestmentCapacity.toString()).toBe("0");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
  });

  it("treats negative Base Surplus as STRUCTURAL_DEFICIT", () => {
    const result = calculateMonthlyModel(
      makeInput({ facts: { planningIncome: "4999", essentialExpenses: "5000", cashAccounts: [] } }),
    );
    expect(result.spending.status).toBe("STRUCTURAL_DEFICIT");
    expect(result.spending.recommendedMonthlySpending.toString()).toBe("0");
    expect(result.spending.remainingOptionalSpendingCapacity.toString()).toBe("0");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
  });

  it("returns no Hard-Gate action when the cash gate is NOT_APPLICABLE", () => {
    const result = calculateMonthlyModel(
      makeInput({ facts: { essentialExpenses: "0", cashAccounts: [], assets: [], debts: [] } }),
    );
    expect(result.safety.coverageStatus).toBe("NO_CORE_OBLIGATION");
    expect(result.safety.safetyCoverageMonths).toBeNull();
    expect(result.safety.cashCoverageMonths).toBeNull();
    expect(result.safety.cashSafetyGateStatus).toBe("NOT_APPLICABLE");
    expect(result.trend.status).toBe("COMPLETE");
    if (result.trend.status === "COMPLETE") {
      expect(result.trend.result.dimensions.LIQUIDITY_SAFETY.direction).toBe("NOT_APPLICABLE");
      expect(result.trend.result.validComparisonDimensionCount).toBe(0);
    }
    expect(result.priorityAction.action_code).toBe("NO_ACTION");
  });

  it("handles Cash equal to zero without a coverage exception", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: { cashAccounts: [{ id: "zero", balance: "0", includeInSafetyResources: true }] },
      }),
    );
    expect(result.safety.cashCoverageMonths?.toString()).toBe("0");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
  });

  it("calculates Safety Resources without liquid assets", () => {
    const result = calculateMonthlyModel(makeInput({ facts: { assets: [] } }));
    expect(result.safety.safetyResources.toString()).toBe("6000");
    expect(result.safety.eligibleLiquidInvestmentAssets.toString()).toBe("0");
  });

  it("keeps the cash gate active for low cash despite very large liquid assets", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: {
          cashAccounts: [{ id: "cash", balance: "100", includeInSafetyResources: true }],
          assets: [
            {
              id: "large-fund",
              currentValue: "1000000",
              kind: "LIQUID_INVESTMENT",
              includeInSafetyResources: true,
            },
          ],
        },
      }),
    );
    expect(result.safety.safetyCoverageMonths?.gt(2)).toBe(true);
    expect(result.safety.cashCoverageMonths?.lt(2)).toBe(true);
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
  });

  it("calculates a zero Safety Gap when resources meet the target", () => {
    const result = calculateMonthlyModel(
      makeInput({ settings: { safetyCoverageTargetMonths: 1 } }),
    );
    expect(result.safety.safetyGap.toString()).toBe("0");
    expect(result.safety.actualMonthlySafetyRecovery.toString()).toBe("0");
    expect(result.spending.recommendedNewInvestmentCapacity.gt(0)).toBe(true);
  });

  it("calculates a positive Safety Gap and recovery amount", () => {
    const result = calculateMonthlyModel(makeInput());
    expect(result.safety.safetyGap.toString()).toBe("0");
    const gapInput = makeInput({
      settings: { safetyCoverageTargetMonths: 10 },
      facts: { cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }] },
    });
    const gapResult = calculateMonthlyModel(gapInput);
    expect(gapResult.safety.safetyGap.gt(0)).toBe(true);
    expect(gapResult.safety.requiredMonthlySafetyRecovery.gt(0)).toBe(true);
    expect(gapResult.safety.actualMonthlySafetyRecovery.lte(gapResult.spending.baseSurplus)).toBe(
      true,
    );
  });

  it("caps actual safety recovery at Base Surplus", () => {
    const result = calculateMonthlyModel(
      makeInput({
        settings: { safetyCoverageTargetMonths: 20, safetyRecoveryHorizonMonths: 1 },
        facts: {
          planningIncome: "3000",
          essentialExpenses: "2000",
          cashAccounts: [{ id: "cash", balance: "0", includeInSafetyResources: true }],
          assets: [],
        },
      }),
    );
    expect(result.safety.actualMonthlySafetyRecovery.toString()).toBe("1000");
    expect(result.spending.safeOptionalCapacity.toString()).toBe("0");
  });

  it("preserves the recommended amount after overspending", () => {
    const result = calculateMonthlyModel(
      makeInput({
        settings: { desiredMonthlyDiscretionarySpending: "2400", safetyCoverageTargetMonths: 1 },
        facts: { expenses: [variableExpense("3000")] },
      }),
    );
    expect(result.spending.recommendedMonthlySpending.toString()).toBe("2400");
    expect(result.spending.actualVariableSpending.toString()).toBe("3000");
    expect(result.spending.remainingOptionalSpendingCapacity.toString()).toBe("0");
    expect(result.spending.amountAboveRecommendation.toString()).toBe("600");
  });

  it("handles Recommended Spending equal to zero without NaN or Infinity", () => {
    const result = calculateMonthlyModel(
      makeInput({
        settings: { desiredMonthlyDiscretionarySpending: "0", safetyCoverageTargetMonths: 0 },
        facts: { expenses: [variableExpense("50")] },
      }),
    );
    expect(result.spending.recommendedMonthlySpending.toString()).toBe("0");
    expect(result.spending.amountAboveRecommendation.toString()).toBe("50");
    expect(result.consumptionUtilization.current.status).toBe("ZERO_RECOMMENDATION");
    expect(result.consumptionUtilization.current.value).toBeNull();
  });

  it("requires a positive recovery horizon only when recovery is needed", () => {
    const result = makeInput({
      settings: { safetyCoverageTargetMonths: 10 },
      facts: { cashAccounts: [] },
    });
    delete result.settings.safetyRecoveryHorizonMonths;
    expect(() => calculateMonthlyModel(result)).toThrow(ModelValidationError);
  });
});

describe("trend and priority behavior", () => {
  it("reports BASELINE_BUILDING without history", () => {
    const result = calculateMonthlyModel(makeInput());
    expect(result.trend.status).toBe("COMPLETE");
    if (result.trend.status === "COMPLETE") {
      expect(result.trend.result.state).toBe("BASELINE_BUILDING");
    }
  });

  it("requires two valid trend dimensions", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          previousSnapshot: makeHistory({
            eligibleCash: null,
            monthlyCoreObligations: null,
            liquidInvestableAssets: null,
            samePeriodVariableSpending: null,
            recommendedMonthlySpending: null,
          }),
        },
      }),
    );
    expect(result.validComparisonDimensionCount).toBe(1);
    expect(result.state).toBe("BASELINE_BUILDING");
  });

  it("evaluates two valid trend dimensions", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          previousSnapshot: makeHistory({
            eligibleCash: "4000",
            monthlyCoreObligations: "2000",
            debtBalance: "1000",
            liquidInvestableAssets: null,
            samePeriodVariableSpending: null,
            recommendedMonthlySpending: null,
          }),
        },
      }),
    );
    expect(result.validComparisonDimensionCount).toBe(2);
    expect(result.state).not.toBe("BASELINE_BUILDING");
  });

  it("reports strong improvement for at least three improving dimensions and met Safety Target", () => {
    const result = completedTrend(
      makeInput({
        settings: { safetyCoverageTargetMonths: 1 },
        facts: {
          debts: [],
          assets: [
            {
              id: "fund",
              currentValue: "5000",
              kind: "LIQUID_INVESTMENT",
              includeInSafetyResources: true,
            },
          ],
          previousSnapshot: makeHistory({
            eligibleCash: "4000",
            monthlyCoreObligations: "2000",
            debtBalance: "1000",
            liquidInvestableAssets: "4000",
            samePeriodVariableSpending: "0",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.improvingCount).toBe(3);
    expect(result.state).toBe("IMPROVING_STRONGLY");
  });

  it("reports deterioration for three worsening dimensions", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          planningIncome: "10000",
          cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }],
          assets: [
            {
              id: "fund",
              currentValue: "1000",
              kind: "LIQUID_INVESTMENT",
              includeInSafetyResources: true,
            },
          ],
          debts: [{ id: "loan", name: "Loan", currentBalance: "2000" }],
          expenses: [variableExpense("1000")],
          previousSnapshot: makeHistory({
            eligibleCash: "6000",
            monthlyCoreObligations: "2000",
            debtBalance: "1000",
            liquidInvestableAssets: "4000",
            samePeriodVariableSpending: "300",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.worseningCount).toBeGreaterThanOrEqual(3);
    expect(result.state).toBe("DETERIORATING");
  });

  it("chooses Primary Improvement and Primary Drag by dimension priority", () => {
    const result = calculateMonthlyModel(
      makeInput({
        settings: { safetyCoverageTargetMonths: 1 },
        facts: {
          debts: [{ id: "loan", name: "Loan", currentBalance: "1000" }],
          expenses: [variableExpense("1000")],
          previousSnapshot: makeHistory({
            eligibleCash: "4000",
            monthlyCoreObligations: "2000",
            debtBalance: "0",
            liquidInvestableAssets: "5000",
            samePeriodVariableSpending: "500",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.trend.status).toBe("COMPLETE");
    if (result.trend.status !== "COMPLETE")
      throw new Error("Expected trend result to be complete.");
    expect(result.trend.result.primaryImprovement).toBe("LIQUIDITY_SAFETY");
    expect(result.trend.result.primaryDrag).toBe("DEBT");
    expect(result.priorityAction.action_code).toBe("ADDRESS_PRIMARY_DRAG");
    expect(result.priorityAction.dimension).toBe("DEBT");
  });

  it("prioritizes a known Safety Gap and returns NO_ACTION when no issue is known", () => {
    const gapResult = calculateMonthlyModel(
      makeInput({ settings: { safetyCoverageTargetMonths: 10 } }),
    );
    expect(gapResult.priorityAction.action_code).toBe("ADDRESS_SAFETY_GAP");

    const clearResult = calculateMonthlyModel(
      makeInput({ settings: { safetyCoverageTargetMonths: 1 } }),
    );
    expect(clearResult.priorityAction.action_code).toBe("NO_ACTION");
  });

  it("activates the Hard Gate below the user cash floor", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: { cashAccounts: [{ id: "cash", balance: "0", includeInSafetyResources: true }] },
      }),
    );
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
    expect(result.priorityAction.action_code).toBe("REBUILD_CASH_FLOOR");
  });

  it("clears the Hard Gate when surplus is nonnegative and the cash floor is met", () => {
    const result = calculateMonthlyModel(makeInput());
    expect(result.safety.cashSafetyGateStatus).toBe("CLEAR");
  });

  it("clears the cash floor exactly at its threshold", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: { cashAccounts: [{ id: "cash", balance: "4000", includeInSafetyResources: true }] },
      }),
    );
    expect(result.safety.cashCoverageMonths?.toString()).toBe("2");
    expect(result.safety.cashSafetyGateStatus).toBe("CLEAR");
  });

  it("does not emit an action or cash warning solely for NO_CORE_OBLIGATION", () => {
    const result = calculateMonthlyModel(
      makeInput({ facts: { essentialExpenses: "0", cashAccounts: [], assets: [], debts: [] } }),
    );
    expect(result.safety.cashSafetyGateStatus).toBe("NOT_APPLICABLE");
    expect(result.priorityAction.action_code).toBe("NO_ACTION");
  });

  it("does not double-vote investment market gain as liquidity improvement", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          previousSnapshot: makeHistory({
            eligibleCash: "6000",
            monthlyCoreObligations: "2000",
            debtBalance: null,
            liquidInvestableAssets: "1000",
            samePeriodVariableSpending: null,
            recommendedMonthlySpending: null,
          }),
        },
      }),
    );
    expect(result.dimensions.LIQUIDITY_SAFETY.direction).toBe("NEUTRAL");
    expect(result.dimensions.WEALTH.direction).toBe("IMPROVING");
  });

  it("allows Safety Target crossing from market gain without a liquidity vote", () => {
    const result = completedTrend(
      makeInput({
        settings: { safetyCoverageTargetMonths: 1, minimumCashCoverageMonths: 0.5 },
        facts: {
          cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }],
          assets: [
            {
              id: "fund",
              currentValue: "1500",
              kind: "LIQUID_INVESTMENT",
              includeInSafetyResources: true,
            },
          ],
          expenses: [],
          previousSnapshot: makeHistory({
            eligibleCash: "1000",
            monthlyCoreObligations: "2000",
            debtBalance: "1000",
            liquidInvestableAssets: "500",
            samePeriodVariableSpending: "300",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.dimensions.LIQUIDITY_SAFETY.direction).toBe("NEUTRAL");
    expect(result.dimensions.WEALTH.direction).toBe("IMPROVING");
    expect(result.state).toBe("IMPROVING_STRONGLY");
  });

  it("permits liquidity improvement when Eligible Cash rises", () => {
    const result = completedTrend(
      makeInput({ facts: { previousSnapshot: makeHistory({ eligibleCash: "4000" }) } }),
    );
    expect(result.dimensions.LIQUIDITY_SAFETY.direction).toBe("IMPROVING");
  });

  it("permits liquidity improvement when core obligations fall and Cash Coverage rises", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          essentialExpenses: "1500",
          previousSnapshot: makeHistory({ eligibleCash: "6000", monthlyCoreObligations: "2500" }),
        },
      }),
    );
    expect(result.dimensions.LIQUIDITY_SAFETY.direction).toBe("IMPROVING");
  });

  it("does not classify increased consumption under recommendation as automatically worsening", () => {
    const result = completedTrend(
      makeInput({
        settings: { safetyCoverageTargetMonths: 0 },
        facts: {
          expenses: [variableExpense("200")],
          previousSnapshot: makeHistory({ samePeriodVariableSpending: "100" }),
        },
      }),
    );
    expect(result.dimensions.CONSUMPTION.direction).toBe("NEUTRAL");
  });

  it("marks consumption worsening when it exceeds the trajectory and rises in the same period", () => {
    const result = completedTrend(
      makeInput({
        settings: { safetyCoverageTargetMonths: 0 },
        facts: {
          expenses: [variableExpense("1000")],
          previousSnapshot: makeHistory({ samePeriodVariableSpending: "500" }),
        },
      }),
    );
    expect(result.dimensions.CONSUMPTION.direction).toBe("WORSENING");
  });

  it("prorates current and previous recommendations over matching elapsed days", () => {
    const result = calculateMonthlyModel(
      makeInput({
        settings: { safetyCoverageTargetMonths: 0, desiredMonthlyDiscretionarySpending: "3100" },
        facts: {
          expenses: [variableExpense("400")],
          previousSnapshot: makeHistory({
            samePeriodVariableSpending: "200",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.consumptionUtilization.current.proratedRecommendedSpend.toString()).toBe("400");
    expect(result.consumptionUtilization.current.value?.toString()).toBe("1");
    expect(result.consumptionUtilization.previous?.proratedRecommendedSpend.toString()).toBe("400");
    expect(result.consumptionUtilization.previous?.value?.toString()).toBe("0.5");
  });

  it("A: returns DETERIORATING for an active gate with worsening liquidity and only one worsening dimension", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: {
          cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }],
          previousSnapshot: makeHistory({
            eligibleCash: "6000",
            monthlyCoreObligations: "2000",
            debtBalance: "0",
            liquidInvestableAssets: null,
            samePeriodVariableSpending: null,
            recommendedMonthlySpending: null,
          }),
        },
      }),
    );
    expect(result.trend.status).toBe("COMPLETE");
    if (result.trend.status === "COMPLETE") {
      expect(result.trend.result.state).toBe("DETERIORATING");
      expect(result.trend.result.worseningCount).toBe(1);
    }
  });

  it("E: maps a breached cash floor without structural deficit to REBUILD_CASH_FLOOR", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: { cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }] },
      }),
    );
    expect(result.spending.status).not.toBe("STRUCTURAL_DEFICIT");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
    expect(result.priorityAction.action_code).toBe("REBUILD_CASH_FLOOR");
  });

  it("B: uses UNDER_PRESSURE for an active gate with neutral liquidity and fewer than three worsening dimensions", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: {
          cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }],
          previousSnapshot: makeHistory({
            eligibleCash: "1000",
            monthlyCoreObligations: "2000",
            debtBalance: "0",
            liquidInvestableAssets: null,
            samePeriodVariableSpending: null,
            recommendedMonthlySpending: null,
          }),
        },
      }),
    );
    expect(result.trend.status).toBe("COMPLETE");
    if (result.trend.status === "COMPLETE") {
      expect(result.trend.result.dimensions.LIQUIDITY_SAFETY.direction).toBe("NEUTRAL");
      expect(result.trend.result.state).toBe("UNDER_PRESSURE");
      expect(result.trend.result.worseningCount).toBeLessThan(3);
    }
  });

  it("C: keeps normal three-dimension deterioration under an active gate", () => {
    const result = completedTrend(
      makeInput({
        facts: {
          planningIncome: "10000",
          cashAccounts: [{ id: "cash", balance: "1000", includeInSafetyResources: true }],
          assets: [
            {
              id: "fund",
              currentValue: "1000",
              kind: "LIQUID_INVESTMENT",
              includeInSafetyResources: true,
            },
          ],
          debts: [{ id: "loan", name: "Loan", currentBalance: "2000" }],
          expenses: [variableExpense("1000")],
          previousSnapshot: makeHistory({
            eligibleCash: "6000",
            monthlyCoreObligations: "2000",
            debtBalance: "1000",
            liquidInvestableAssets: "4000",
            samePeriodVariableSpending: "300",
            recommendedMonthlySpending: "3000",
          }),
        },
      }),
    );
    expect(result.worseningCount).toBeGreaterThanOrEqual(3);
    expect(result.state).toBe("DETERIORATING");
  });

  it("D: prioritizes RESTORE_CORE_BALANCE when structural deficit and the cash floor breach coexist", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: {
          planningIncome: "1000",
          essentialExpenses: "2000",
          cashAccounts: [{ id: "cash", balance: "0", includeInSafetyResources: true }],
        },
      }),
    );
    expect(result.spending.status).toBe("STRUCTURAL_DEFICIT");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
    expect(result.priorityAction.action_code).toBe("RESTORE_CORE_BALANCE");
  });
});

describe("validation, pure periods, and fixtures", () => {
  it("enforces the approved money boundary and keeps cents exact in format and arithmetic", () => {
    expect(formatMoneyExact("999999999999.99")).toBe("999,999,999,999.99");
    expect(money("999999999999.99").minus("999999999999.98").toString()).toBe("0.01");
    for (const value of ["1000000000000.00", "1.001", "1e3", "NaN", "Infinity"]) {
      const input = makeInput();
      input.settings.desiredMonthlyDiscretionarySpending = value;
      expect(() => calculateMonthlyModel(input)).toThrow(ModelValidationError);
    }
  });
  it("uses explicit as-of date and excludes essential/out-of-period expenses", () => {
    const input = makeInput({
      facts: {
        expenses: [
          variableExpense("10", "2026-10-02"),
          variableExpense("20", "2026-10-05"),
          variableExpense("30", "2026-09-30"),
          {
            id: "essential",
            amount: "40",
            dateTime: "2026-10-03T10:00:00.000Z",
            businessDate: "2026-10-03",
            kind: "ESSENTIAL",
            category: "BASIC_FOOD",
          },
        ],
      },
    });
    expect(calculateActualVariableSpending(input).toString()).toBe("10");
  });

  it("remains deterministic for the same explicit input dates", () => {
    const input = makeInput({ facts: { expenses: [variableExpense("123.45")] } });
    const first = calculateMonthlyModel(input);
    const second = calculateMonthlyModel(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps expected or pending actual income separate from Planning Income", () => {
    const result = calculateMonthlyModel(
      makeInput({
        facts: {
          planningIncome: "0",
          essentialExpenses: "1000",
          actualIncomeRecords: [
            {
              id: "pending",
              kind: "ACTUAL",
              status: "PENDING",
              amount: "10000",
              date: "2026-10-20",
            },
          ],
        },
      }),
    );
    expect(result.spending.baseSurplus.toString()).toBe("-1000");
    expect(result.spending.status).toBe("STRUCTURAL_DEFICIT");
  });

  it("accepts the Owner profile fixture as test data only", () => {
    const result = calculateMonthlyModel(ownerProfileFixture);
    expect(result.debt.mandatoryDebtService.toString()).toBe("8207.26");
    expect(result.safety.eligibleCash.toString()).toBe("3948.41");
    expect(result.safety.eligibleLiquidInvestmentAssets.toString()).toBe("3842.12");
    expect(result.safety.cashSafetyGateStatus).toBe("ACTIVE");
  });

  it.each([
    ["NaN", "NaN"],
    ["positive infinity", "Infinity"],
    ["negative debt balance", "-1"],
    ["negative current-month due", "-1"],
    ["negative fixed monthly payment", "-1"],
    ["negative expense amount", "-1"],
    ["zero expense amount", "0"],
    ["negative safety target", "-1"],
    ["negative cash floor", "-1"],
    ["negative desired spending", "-1"],
  ])("rejects %s inputs", (_label, badValue) => {
    const input = makeInput();
    if (_label === "negative debt balance") {
      input.facts.debts = [{ id: "bad", name: "Bad", currentBalance: badValue }];
    } else if (_label === "negative current-month due") {
      input.facts.debts = [
        { id: "bad", name: "Bad", currentBalance: "0", currentMonthDue: badValue },
      ];
    } else if (_label === "negative fixed monthly payment") {
      input.facts.debts = [
        { id: "bad", name: "Bad", currentBalance: "0", fixedMonthlyPayment: badValue },
      ];
    } else if (_label === "negative expense amount") {
      input.facts.expenses = [variableExpense(badValue)];
    } else if (_label === "zero expense amount") {
      input.facts.expenses = [variableExpense(badValue)];
    } else if (_label === "negative safety target") {
      input.settings.safetyCoverageTargetMonths = Number(badValue);
    } else if (_label === "negative cash floor") {
      input.settings.minimumCashCoverageMonths = Number(badValue);
    } else if (_label === "negative desired spending") {
      input.settings.desiredMonthlyDiscretionarySpending = badValue;
    } else {
      input.facts.planningIncome = badValue;
    }
    expect(() => calculateMonthlyModel(input)).toThrow(ModelValidationError);
  });

  it("rejects a recovery horizon of zero when specified", () => {
    const input = makeInput({ settings: { safetyCoverageTargetMonths: 10 } });
    input.settings.safetyRecoveryHorizonMonths = 0;
    expect(() => calculateMonthlyModel(input)).toThrow(ModelValidationError);
  });

  it("uses decimal arithmetic without binary floating-point addition error", () => {
    expect(money("0.1").plus(money("0.2")).toString()).toBe("0.3");
  });
});

describe("invariants", () => {
  it("accepts aggregate facts above the per-entry user-input ceiling", () => {
    const input = makeInput({
      facts: {
        planningIncome: "600000000000",
        essentialExpenses: "1200000000000",
        cashAccounts: [
          { id: "cash-a", balance: "600000000000", includeInSafetyResources: true },
          { id: "cash-b", balance: "600000000000", includeInSafetyResources: true },
        ],
      },
    });
    const result = calculateMonthlyModel(input);
    expect(result.safety.eligibleCash.toString()).toBe("1200000000000");
    expect(result.spending.status).toBe("STRUCTURAL_DEFICIT");
  });

  it("accepts finite derived recommendation precision and exponent notation in history", () => {
    const input = makeInput({
      facts: {
        planningIncome: "1.01",
        essentialExpenses: "1",
        cashAccounts: [{ id: "cash", balance: "0.99", includeInSafetyResources: true }],
        assets: [],
        previousSnapshot: makeHistory({
          recommendedMonthlySpending: "9.99999000000999999000000999999e-9",
        }),
      },
      settings: {
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 0,
        safetyRecoveryHorizonMonths: 1.000001,
        desiredMonthlyDiscretionarySpending: "0.01",
      },
    });
    expect(() => calculateMonthlyModel(input)).not.toThrow();
  });

  it.each(["1000000000000.00", "1e3"])(
    "continues rejecting invalid individual user-input money %s",
    (value) => {
      const input = makeInput();
      input.settings.desiredMonthlyDiscretionarySpending = value;
      expect(() => calculateMonthlyModel(input)).toThrow(ModelValidationError);
    },
  );

  it.each(["garbage", "NaN", "Infinity", "-Infinity"])(
    "rejects invalid internal historical money %s",
    (value) => {
      const input = makeInput({
        facts: { previousSnapshot: makeHistory({ eligibleCash: value }) },
      });
      expect(() => calculateMonthlyModel(input)).toThrow(ModelValidationError);
    },
  );

  it("keeps model outputs within the frozen spending and recovery bounds", () => {
    const cases = [
      makeInput(),
      makeInput({ settings: { desiredMonthlyDiscretionarySpending: "0" } }),
      makeInput({ facts: { planningIncome: "0", essentialExpenses: "10" } }),
      makeInput({
        settings: { safetyCoverageTargetMonths: 20, safetyRecoveryHorizonMonths: 1 },
        facts: { cashAccounts: [{ id: "cash", balance: "0", includeInSafetyResources: true }] },
      }),
    ];
    for (const input of cases) {
      const result = calculateMonthlyModel(input);
      expect(result.spending.recommendedMonthlySpending.gte(0)).toBe(true);
      expect(
        result.spending.recommendedMonthlySpending.lte(
          result.spending.desiredMonthlyDiscretionarySpending,
        ),
      ).toBe(true);
      expect(result.spending.remainingOptionalSpendingCapacity.gte(0)).toBe(true);
      expect(result.spending.amountAboveRecommendation.gte(0)).toBe(true);
      expect(result.safety.safetyGap.gte(0)).toBe(true);
      expect(
        result.spending.baseSurplus.gt(0)
          ? result.safety.actualMonthlySafetyRecovery.lte(result.spending.baseSurplus)
          : result.safety.actualMonthlySafetyRecovery.isZero(),
      ).toBe(true);
      for (const coverage of [
        result.safety.safetyCoverageMonths,
        result.safety.cashCoverageMonths,
      ]) {
        expect(coverage === null || coverage.isFinite()).toBe(true);
      }
      expect(result.spending.status).toBe(
        result.spending.baseSurplus.lt(0)
          ? "STRUCTURAL_DEFICIT"
          : result.spending.baseSurplus.eq(0)
            ? "BALANCED_NO_SURPLUS"
            : "NORMAL",
      );
    }
  });
});
