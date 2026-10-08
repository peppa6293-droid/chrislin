import { money, zeroMoney } from "./money.js";
import type { ModelInput, SafetyResult, SpendingResult, SpendingStatus } from "./types.js";

export function calculateActualVariableSpending(input: ModelInput): ReturnType<typeof zeroMoney> {
  const elapsedDay = Number(input.facts.asOfDate.slice(8, 10));
  return input.facts.expenses.reduce((total, expense) => {
    const date = expense.businessDate;
    if (
      expense.kind === "VARIABLE" &&
      date.slice(0, 7) === input.facts.currentMonth &&
      Number(date.slice(8, 10)) <= elapsedDay
    ) {
      return total.plus(money(expense.amount));
    }
    return total;
  }, zeroMoney());
}

export function calculateSpending(
  input: ModelInput,
  safety: SafetyResult,
  actualVariableSpending = calculateActualVariableSpending(input),
): SpendingResult {
  const baseSurplus = money(input.facts.planningIncome).minus(safety.monthlyCoreObligations);
  const desiredMonthlyDiscretionarySpending = money(
    input.settings.desiredMonthlyDiscretionarySpending,
  );
  const status: SpendingStatus = baseSurplus.lt(0)
    ? "STRUCTURAL_DEFICIT"
    : baseSurplus.eq(0)
      ? "BALANCED_NO_SURPLUS"
      : "NORMAL";

  let safeOptionalCapacity = zeroMoney();
  let recommendedMonthlySpending = zeroMoney();
  if (status === "NORMAL") {
    safeOptionalCapacity = safety.safetyGap.gt(0)
      ? maxZero(baseSurplus.minus(safety.actualMonthlySafetyRecovery))
      : baseSurplus;
    recommendedMonthlySpending = DecimalMin(
      desiredMonthlyDiscretionarySpending,
      safeOptionalCapacity,
    );
  }

  const remainingOptionalSpendingCapacity = maxZero(
    recommendedMonthlySpending.minus(actualVariableSpending),
  );
  const amountAboveRecommendation = maxZero(
    actualVariableSpending.minus(recommendedMonthlySpending),
  );
  const unallocatedSurplus = maxZero(baseSurplus.minus(recommendedMonthlySpending));
  const recommendedNewInvestmentCapacity = safety.safetyGap.gt(0)
    ? zeroMoney()
    : unallocatedSurplus;

  return {
    status,
    baseSurplus,
    desiredMonthlyDiscretionarySpending,
    recommendedMonthlySpending,
    actualVariableSpending,
    remainingOptionalSpendingCapacity,
    amountAboveRecommendation,
    safeOptionalCapacity,
    unallocatedSurplus,
    recommendedNewInvestmentCapacity,
    rulesApplied: [
      "Base Surplus is Planning Income less Monthly Core Obligations.",
      "Structural deficit applies only below zero; exact zero is balanced with no surplus.",
      "Recommended spending is capped at the user's desired spending target.",
      "Overspending does not reduce the recommended monthly amount.",
    ],
  };
}

function DecimalMin(left: ReturnType<typeof money>, right: ReturnType<typeof money>) {
  return left.lte(right) ? left : right;
}

function maxZero(value: ReturnType<typeof money>) {
  return value.gt(0) ? value : zeroMoney();
}
