import { money } from "./money.js";
import type {
  ConsumptionUtilization,
  DimensionSignal,
  HistoricalSnapshot,
  ModelInput,
  MoneyInput,
  OverallTrendState,
  SafetyResult,
  SpendingResult,
  TrendDimension,
  TrendOutcome,
  TrendResult,
} from "./types.js";

const TREND_PRIORITY: TrendDimension[] = ["LIQUIDITY_SAFETY", "DEBT", "CONSUMPTION", "WEALTH"];

export interface TrendInputs {
  input: ModelInput;
  safety: SafetyResult;
  spending: SpendingResult;
}

export interface TrendAnalysis {
  outcome: TrendOutcome;
  currentConsumptionUtilization: ConsumptionUtilization;
  previousConsumptionUtilization: ConsumptionUtilization | null;
}

export function calculateTrend(inputs: TrendInputs): TrendAnalysis {
  const { input, safety, spending } = inputs;
  const previous = input.facts.previousSnapshot;
  const currentConsumption = calculateUtilization(
    spending.actualVariableSpending,
    spending.recommendedMonthlySpending,
    input.facts.asOfDate,
  );
  const previousConsumption = previous
    ? calculateUtilization(
        valueOrZero(previous.samePeriodVariableSpending),
        valueOrZero(previous.recommendedMonthlySpending),
        comparablePreviousPeriodDate(input.facts.asOfDate),
      )
    : null;

  const dimensions: Record<TrendDimension, DimensionSignal> = {
    LIQUIDITY_SAFETY: liquiditySignal(input, safety, previous),
    DEBT: debtSignal(input, previous),
    CONSUMPTION: consumptionSignal(
      spending.actualVariableSpending,
      currentConsumption,
      previous,
      previousConsumption,
    ),
    WEALTH: wealthSignal(input, previous),
  };

  const applicable = TREND_PRIORITY.filter(
    (dimension) => dimensions[dimension].direction !== "NOT_APPLICABLE",
  );
  const valid = applicable.filter((dimension) => dimensions[dimension].direction !== "NO_BASELINE");
  const improvingCount = valid.filter(
    (dimension) => dimensions[dimension].direction === "IMPROVING",
  ).length;
  const worseningCount = valid.filter(
    (dimension) => dimensions[dimension].direction === "WORSENING",
  ).length;
  const primaryImprovement =
    TREND_PRIORITY.find((dimension) => dimensions[dimension].direction === "IMPROVING") ?? null;
  const primaryDrag =
    TREND_PRIORITY.find((dimension) => dimensions[dimension].direction === "WORSENING") ?? null;

  if (valid.length < 2) {
    const result = makeTrendResult(
      "BASELINE_BUILDING",
      dimensions,
      valid.length,
      improvingCount,
      worseningCount,
      primaryImprovement,
      primaryDrag,
    );
    return {
      outcome: { status: "COMPLETE", result },
      currentConsumptionUtilization: currentConsumption,
      previousConsumptionUtilization: previousConsumption,
    };
  }

  if (
    safety.cashSafetyGateStatus === "ACTIVE" &&
    dimensions.LIQUIDITY_SAFETY.direction === "WORSENING"
  ) {
    const result = makeTrendResult(
      "DETERIORATING",
      dimensions,
      valid.length,
      improvingCount,
      worseningCount,
      primaryImprovement,
      primaryDrag,
    );
    return {
      outcome: { status: "COMPLETE", result },
      currentConsumptionUtilization: currentConsumption,
      previousConsumptionUtilization: previousConsumption,
    };
  }

  let state = determineUngatedState(dimensions, valid.length, improvingCount, worseningCount);
  if (safety.coverageStatus === "NORMAL" && safety.safetyCoverageMonths !== null) {
    const safetyTargetMet = safety.safetyCoverageMonths.gte(
      money(input.settings.safetyCoverageTargetMonths),
    );
    if (state === "IMPROVING_STRONGLY" && !safetyTargetMet) state = "IMPROVING";
  }
  if (safety.cashSafetyGateStatus === "ACTIVE" && state !== "DETERIORATING") {
    state = "UNDER_PRESSURE";
  }

  const result = makeTrendResult(
    state,
    dimensions,
    valid.length,
    improvingCount,
    worseningCount,
    primaryImprovement,
    primaryDrag,
  );
  return {
    outcome: { status: "COMPLETE", result },
    currentConsumptionUtilization: currentConsumption,
    previousConsumptionUtilization: previousConsumption,
  };
}

function liquiditySignal(
  input: ModelInput,
  safety: SafetyResult,
  previous: HistoricalSnapshot | null | undefined,
): DimensionSignal {
  if (safety.coverageStatus === "NO_CORE_OBLIGATION") {
    return { direction: "NOT_APPLICABLE", reason: "No core obligations exist to cover." };
  }
  if (
    !previous ||
    previous.eligibleCash === undefined ||
    previous.eligibleCash === null ||
    previous.monthlyCoreObligations === undefined ||
    previous.monthlyCoreObligations === null
  ) {
    return {
      direction: "NO_BASELINE",
      reason: "Prior cash or core-obligation baseline is missing.",
    };
  }
  const previousObligations = money(previous.monthlyCoreObligations);
  if (!previousObligations.gt(0) || safety.cashCoverageMonths === null) {
    return { direction: "NO_BASELINE", reason: "Prior cash coverage baseline is unavailable." };
  }
  const previousCoverage = money(previous.eligibleCash).div(previousObligations);
  const previousFloorMet = previousCoverage.gte(money(input.settings.minimumCashCoverageMonths));
  const currentFloorMet = safety.cashFloorMet === true;

  if (!previousFloorMet && currentFloorMet) {
    return { direction: "IMPROVING", reason: "Cash Floor changed from unmet to met." };
  }
  if (previousFloorMet && !currentFloorMet) {
    return { direction: "WORSENING", reason: "Cash Floor changed from met to unmet." };
  }
  if (safety.cashCoverageMonths.gt(previousCoverage)) {
    return { direction: "IMPROVING", reason: "Cash Coverage increased from the prior snapshot." };
  }
  if (safety.cashCoverageMonths.lt(previousCoverage)) {
    return { direction: "WORSENING", reason: "Cash Coverage decreased from the prior snapshot." };
  }
  return { direction: "NEUTRAL", reason: "Cash Coverage and Cash Floor status are unchanged." };
}

function debtSignal(
  input: ModelInput,
  previous: HistoricalSnapshot | null | undefined,
): DimensionSignal {
  if (previous?.debtBalance === undefined || previous.debtBalance === null) {
    return { direction: "NO_BASELINE", reason: "Prior valid debt balance is missing." };
  }
  const current = input.facts.debts.reduce(
    (total, debt) => total.plus(money(debt.currentBalance)),
    money(0),
  );
  const prior = money(previous.debtBalance);
  if (current.lt(prior)) return { direction: "IMPROVING", reason: "Valid debt balance decreased." };
  if (current.gt(prior)) return { direction: "WORSENING", reason: "Valid debt balance increased." };
  return { direction: "NEUTRAL", reason: "Valid debt balance is unchanged." };
}

function wealthSignal(
  input: ModelInput,
  previous: HistoricalSnapshot | null | undefined,
): DimensionSignal {
  if (previous?.liquidInvestableAssets === undefined || previous.liquidInvestableAssets === null) {
    return {
      direction: "NO_BASELINE",
      reason: "Prior liquid-investable-asset snapshot is missing.",
    };
  }
  const current = input.facts.assets
    .filter((asset) => asset.kind === "LIQUID_INVESTMENT")
    .reduce((total, asset) => total.plus(money(asset.currentValue)), money(0));
  const prior = money(previous.liquidInvestableAssets);
  if (current.gt(prior))
    return { direction: "IMPROVING", reason: "Liquid-investable-asset value increased." };
  if (current.lt(prior))
    return { direction: "WORSENING", reason: "Liquid-investable-asset value decreased." };
  return { direction: "NEUTRAL", reason: "Liquid-investable-asset value is unchanged." };
}

function consumptionSignal(
  currentSpend: ReturnType<typeof money>,
  currentUtilization: ConsumptionUtilization,
  previous: HistoricalSnapshot | null | undefined,
  previousUtilization: ConsumptionUtilization | null,
): DimensionSignal {
  if (
    !previous ||
    previous.samePeriodVariableSpending === undefined ||
    previous.samePeriodVariableSpending === null
  ) {
    return { direction: "NO_BASELINE", reason: "Prior same-period variable spending is missing." };
  }
  const priorSpend = money(previous.samePeriodVariableSpending);
  if (currentUtilization.status === "ZERO_RECOMMENDATION") {
    if (currentSpend.gt(priorSpend)) {
      return {
        direction: "WORSENING",
        reason:
          "Spending exceeds the zero recommendation and increased from the prior same period.",
      };
    }
    if (currentSpend.lt(priorSpend)) {
      return { direction: "IMPROVING", reason: "Same-period spending decreased." };
    }
    return {
      direction: "NEUTRAL",
      reason: "Spending matches the prior same period at a zero recommendation.",
    };
  }

  if (!previousUtilization || previous.recommendedMonthlySpending == null) {
    if (currentSpend.gt(priorSpend) && currentUtilization.value?.gt(1)) {
      return {
        direction: "WORSENING",
        reason: "Spending is above recommendation and increased from the prior same period.",
      };
    }
    if (currentSpend.lt(priorSpend)) {
      return { direction: "IMPROVING", reason: "Same-period spending decreased." };
    }
    return { direction: "NEUTRAL", reason: "No comparable prior utilization value is available." };
  }

  const previousValue = previousUtilization.value;
  const currentValue = currentUtilization.value;
  if (!previousValue || !currentValue) {
    if (currentSpend.gt(priorSpend) && currentValue?.gt(1)) {
      return {
        direction: "WORSENING",
        reason: "Spending is above recommendation and increased from the prior same period.",
      };
    }
    if (currentSpend.lt(priorSpend)) {
      return { direction: "IMPROVING", reason: "Same-period spending decreased." };
    }
    return { direction: "NEUTRAL", reason: "Utilization is not comparable for one period." };
  }

  if (currentValue.gt(1) && currentSpend.gt(priorSpend)) {
    return {
      direction: "WORSENING",
      reason: "Spending exceeded prorated recommendation and increased from the prior same period.",
    };
  }
  if (currentValue.lt(previousValue) || (previousValue.gt(1) && currentValue.lte(1))) {
    return { direction: "IMPROVING", reason: "Recommended Spending Utilization improved." };
  }
  if (currentSpend.lt(priorSpend)) {
    return { direction: "IMPROVING", reason: "Same-period spending decreased." };
  }
  return {
    direction: "NEUTRAL",
    reason: "Spending has not worsened beyond the prorated recommendation trajectory.",
  };
}

function calculateUtilization(
  actualSpend: ReturnType<typeof money>,
  recommendedMonthly: ReturnType<typeof money>,
  asOfDate: string,
): ConsumptionUtilization {
  const [year, month, day] = asOfDate.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year ?? 0, month ?? 1, 0)).getUTCDate();
  const proratedRecommendedSpend = recommendedMonthly.times(day ?? 0).div(daysInMonth);
  if (!proratedRecommendedSpend.gt(0)) {
    return {
      status: "ZERO_RECOMMENDATION",
      value: null,
      actualSpend,
      proratedRecommendedSpend,
    };
  }
  return {
    status: "CALCULATED",
    value: actualSpend.div(proratedRecommendedSpend),
    actualSpend,
    proratedRecommendedSpend,
  };
}

function comparablePreviousPeriodDate(currentAsOfDate: string): string {
  const [year, month, day] = currentAsOfDate.split("-").map(Number);
  const priorMonthEnd = new Date(Date.UTC(year ?? 0, (month ?? 1) - 2 + 1, 0));
  const priorYear = priorMonthEnd.getUTCFullYear();
  const priorMonth = priorMonthEnd.getUTCMonth() + 1;
  const priorDay = Math.min(day ?? 1, priorMonthEnd.getUTCDate());
  return `${String(priorYear).padStart(4, "0")}-${String(priorMonth).padStart(2, "0")}-${String(priorDay).padStart(2, "0")}`;
}

function valueOrZero(value: MoneyInput | null | undefined): ReturnType<typeof money> {
  return value == null ? money(0) : money(value);
}

function determineUngatedState(
  dimensions: Record<TrendDimension, DimensionSignal>,
  validCount: number,
  improvingCount: number,
  worseningCount: number,
): OverallTrendState {
  if (validCount < 2) return "BASELINE_BUILDING";
  if (worseningCount >= 3) return "DETERIORATING";
  if (
    improvingCount >= 3 &&
    worseningCount === 0 &&
    Object.values(dimensions).some((signal) => signal.direction === "IMPROVING")
  ) {
    return "IMPROVING_STRONGLY";
  }
  if (improvingCount > worseningCount) return "IMPROVING";
  if (improvingCount === worseningCount) return "STABLE";
  return "UNDER_PRESSURE";
}

function makeTrendResult(
  state: OverallTrendState,
  dimensions: Record<TrendDimension, DimensionSignal>,
  validComparisonDimensionCount: number,
  improvingCount: number,
  worseningCount: number,
  primaryImprovement: TrendDimension | null,
  primaryDrag: TrendDimension | null,
): TrendResult {
  return {
    state,
    dimensions,
    validComparisonDimensionCount,
    improvingCount,
    worseningCount,
    primaryImprovement,
    primaryDrag,
    rulesApplied: [
      "NOT_APPLICABLE and NO_BASELINE dimensions are excluded from valid direction counts.",
      "Primary Improvement and Primary Drag follow the approved dimension priority.",
      "No cross-metric severity score or numeric weighted sum is used.",
    ],
  };
}
