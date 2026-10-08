import type { PriorityActionOutcome, SafetyResult, SpendingResult, TrendOutcome } from "./types.js";

export function calculatePriorityAction(
  safety: SafetyResult,
  spending: SpendingResult,
  trend: TrendOutcome,
): PriorityActionOutcome {
  if (spending.status === "STRUCTURAL_DEFICIT") {
    return {
      action_code: "RESTORE_CORE_BALANCE",
      reason: "Planning Income is below Essential Expenses plus Mandatory Debt Service.",
    };
  }

  if (safety.cashSafetyGateStatus === "ACTIVE") {
    return {
      action_code: "REBUILD_CASH_FLOOR",
      reason: "Eligible Cash is below the selected minimum cash-coverage floor.",
    };
  }

  if (trend.status === "BLOCKED_BY_SPEC") {
    return { action_code: "NO_ACTION", reason: "No Priority Action is available." };
  }

  const primaryDrag = trend.result.primaryDrag;
  if (primaryDrag !== null) {
    return {
      action_code: "ADDRESS_PRIMARY_DRAG",
      dimension: primaryDrag,
      reason: `The ${primaryDrag} dimension is the highest-priority worsening signal.`,
    };
  }

  if (safety.safetyGap.gt(0)) {
    return {
      action_code: "ADDRESS_SAFETY_GAP",
      reason: "Safety Resources are below the user-selected Safety Coverage Target.",
    };
  }

  return { action_code: "NO_ACTION", reason: "No clear model issue requires an action." };
}
