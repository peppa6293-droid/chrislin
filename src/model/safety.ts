import { ModelValidationError } from "./errors.js";
import { money, zeroMoney } from "./money.js";
import type { DebtResult, ModelInput, SafetyResult, SpendingStatus } from "./types.js";

export function calculateSafety(
  input: ModelInput,
  debtResult: DebtResult,
  spendingStatus: SpendingStatus,
): SafetyResult {
  let eligibleCash = zeroMoney();
  for (const account of input.facts.cashAccounts) {
    if (account.includeInSafetyResources) eligibleCash = eligibleCash.plus(money(account.balance));
  }

  let eligibleLiquidInvestmentAssets = zeroMoney();
  for (const asset of input.facts.assets) {
    if (asset.kind === "LIQUID_INVESTMENT" && asset.includeInSafetyResources) {
      eligibleLiquidInvestmentAssets = eligibleLiquidInvestmentAssets.plus(
        money(asset.currentValue),
      );
    }
  }

  const safetyResources = eligibleCash.plus(eligibleLiquidInvestmentAssets);
  const monthlyCoreObligations = money(input.facts.essentialExpenses).plus(
    debtResult.mandatoryDebtService,
  );
  const targetResources = money(input.settings.safetyCoverageTargetMonths).times(
    monthlyCoreObligations,
  );
  const safetyGap = DecimalMax(targetResources.minus(safetyResources), zeroMoney());

  if (!monthlyCoreObligations.gt(0)) {
    return {
      safetyResources,
      eligibleCash,
      eligibleLiquidInvestmentAssets,
      monthlyCoreObligations,
      coverageStatus: "NO_CORE_OBLIGATION",
      safetyCoverageMonths: null,
      cashCoverageMonths: null,
      safetyTargetResources: targetResources,
      safetyGap,
      cashFloorMet: null,
      cashSafetyGateStatus: "NOT_APPLICABLE",
      requiredMonthlySafetyRecovery: zeroMoney(),
      actualMonthlySafetyRecovery: zeroMoney(),
      rulesApplied: [
        "With no positive core obligations, coverage months are null.",
        "The cash safety gate is not applicable and does not produce a cash warning.",
      ],
    };
  }

  const safetyCoverageMonths = safetyResources.div(monthlyCoreObligations);
  const cashCoverageMonths = eligibleCash.div(monthlyCoreObligations);
  const minimumCashCoverage = money(input.settings.minimumCashCoverageMonths);
  const cashFloorMet = cashCoverageMonths.gte(minimumCashCoverage);
  const cashSafetyGateStatus =
    spendingStatus === "STRUCTURAL_DEFICIT" || !cashFloorMet ? "ACTIVE" : "CLEAR";

  let requiredMonthlySafetyRecovery = zeroMoney();
  let actualMonthlySafetyRecovery = zeroMoney();
  if (safetyGap.gt(0) && money(input.facts.planningIncome).minus(monthlyCoreObligations).gt(0)) {
    const horizon = input.settings.safetyRecoveryHorizonMonths;
    if (horizon === undefined || horizon <= 0) {
      throw new ModelValidationError([
        {
          field: "settings.safetyRecoveryHorizonMonths",
          code: "REQUIRED",
          message: "A positive horizon is required when Safety Gap and Base Surplus are positive.",
        },
      ]);
    }
    requiredMonthlySafetyRecovery = safetyGap.div(horizon);
    const baseSurplus = money(input.facts.planningIncome).minus(monthlyCoreObligations);
    actualMonthlySafetyRecovery = DecimalMin(requiredMonthlySafetyRecovery, baseSurplus);
  }

  return {
    safetyResources,
    eligibleCash,
    eligibleLiquidInvestmentAssets,
    monthlyCoreObligations,
    coverageStatus: "NORMAL",
    safetyCoverageMonths,
    cashCoverageMonths,
    safetyTargetResources: targetResources,
    safetyGap,
    cashFloorMet,
    cashSafetyGateStatus,
    requiredMonthlySafetyRecovery,
    actualMonthlySafetyRecovery,
    rulesApplied: [
      "Safety Resources include eligible cash and eligible liquid investment assets.",
      "Monthly Core Obligations include Essential Expenses and Mandatory Debt Service.",
      "The cash safety gate is active for structural deficit or a cash coverage value below the user floor.",
      "Safety recovery follows the user-selected target horizon and is capped at positive Base Surplus.",
    ],
  };
}

function DecimalMax(left: ReturnType<typeof money>, right: ReturnType<typeof money>) {
  return left.gte(right) ? left : right;
}

function DecimalMin(left: ReturnType<typeof money>, right: ReturnType<typeof money>) {
  return left.lte(right) ? left : right;
}
