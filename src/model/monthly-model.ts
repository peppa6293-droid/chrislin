import { calculateDebt } from "./debt.js";
import { money } from "./money.js";
import { calculatePriorityAction } from "./priority-action.js";
import { calculateSafety } from "./safety.js";
import { calculateActualVariableSpending, calculateSpending } from "./spending.js";
import { calculateTrend } from "./trend.js";
import type { ModelInput, MonthlyModelResult, MonthlySnapshot } from "./types.js";
import { validateModelInput } from "./validation.js";

export function calculateMonthlyModel(input: ModelInput): MonthlyModelResult {
  validateModelInput(input);
  const debt = calculateDebt(input.facts.debts);
  const baseSurplus = money(input.facts.planningIncome).minus(
    money(input.facts.essentialExpenses).plus(debt.mandatoryDebtService),
  );
  const spendingStatus = baseSurplus.lt(0)
    ? "STRUCTURAL_DEFICIT"
    : baseSurplus.eq(0)
      ? "BALANCED_NO_SURPLUS"
      : "NORMAL";
  const safety = calculateSafety(input, debt, spendingStatus);
  const actualVariableSpending = calculateActualVariableSpending(input);
  const spending = calculateSpending(input, safety, actualVariableSpending);
  const trendAnalysis = calculateTrend({ input, safety, spending });
  const priorityAction = calculatePriorityAction(safety, spending, trendAnalysis.outcome);

  const snapshot: MonthlySnapshot = {
    currentMonth: input.facts.currentMonth,
    eligibleCash: safety.eligibleCash,
    safetyResources: safety.safetyResources,
    monthlyCoreObligations: safety.monthlyCoreObligations,
    totalDebtBalance: debt.totalDebtBalance,
    liquidInvestableAssets: input.facts.assets
      .filter((asset) => asset.kind === "LIQUID_INVESTMENT")
      .reduce((total, asset) => total.plus(money(asset.currentValue)), money(0)),
    actualVariableSpending,
    recommendedMonthlySpending: spending.recommendedMonthlySpending,
  };

  return {
    debt,
    safety,
    spending,
    trend: trendAnalysis.outcome,
    priorityAction,
    consumptionUtilization: {
      current: trendAnalysis.currentConsumptionUtilization,
      previous: trendAnalysis.previousConsumptionUtilization,
    },
    snapshot,
  };
}
