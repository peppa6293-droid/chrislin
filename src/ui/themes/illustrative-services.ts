import type { FinancialMaintenanceState } from "../../application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../../application/product-service.js";
import type { ProductApplicationServices } from "../contracts.js";

/**
 * Browser-only stand-in so the real shell can open without the Tauri ledger.
 * Numbers are illustrative. Dev builds load this from `?illustrative=1`.
 */
export function illustrativeHome(asOfDate: string): HomeApplicationState {
  const quiet = { direction: "NO_BASELINE" as const, reason: "Illustrative preview." };
  return {
    status: "READY",
    asOfDate,
    currentMonth: asOfDate.slice(0, 7),
    profileDisplayName: null,
    actualIncomeRecordCount: 0,
    actualIncomeTotal: "0",
    currentCash: "8000",
    currentMonthSpending: "56.00",
    currentMonthVariableExpenseCount: 3,
    totalDebt: "0",
    liquidAssets: "0",
    desiredMonthlyDiscretionarySpending: "2000",
    planningIncome: "0",
    essentialExpenses: "0",
    mandatoryDebtService: "0",
    monthlyCoreObligations: "0",
    baseSurplus: "0",
    eligibleCash: "8000",
    eligibleLiquidInvestmentAssets: "0",
    safetyResources: "8000",
    safetyTargetResources: "0",
    safetyCoverageMonths: null,
    safetyCoverageStatus: "NORMAL",
    safetyCoverageTargetMonths: 6,
    recommendedMonthlySpending: "2000",
    remainingSpendingCapacity: "1944",
    amountAboveRecommendation: "0",
    cashCoverageMonths: null,
    minimumCashCoverageMonths: 1,
    safetyGap: "0",
    debts: [],
    spendingStatus: "NORMAL",
    cashSafetyGateStatus: "NOT_APPLICABLE",
    cashFloorMet: null,
    consumptionUtilization: { status: "CALCULATED", value: "0.03" },
    trendState: "BASELINE_BUILDING",
    trendDimensions: {
      LIQUIDITY_SAFETY: quiet,
      DEBT: quiet,
      CONSUMPTION: quiet,
      WEALTH: quiet,
    },
    primaryImprovement: null,
    primaryDrag: null,
    priorityAction: { action_code: "NO_ACTION", reason: "Illustrative preview." },
    recentExpenses: [
      {
        id: "illustrative-1",
        amount: "18.00",
        businessDate: asOfDate,
        category: "FOOD",
        categoryName: "吃饭",
        note: "豆浆",
      },
      {
        id: "illustrative-2",
        amount: "6.00",
        businessDate: asOfDate,
        category: "TRANSPORT",
        categoryName: "出行",
        note: "地铁",
      },
      {
        id: "illustrative-3",
        amount: "32.00",
        businessDate: asOfDate,
        category: "SHOPPING",
        categoryName: "买东西",
        note: "便利店",
      },
    ],
    spendingBreakdown: [],
  };
}

function illustrativeMaintenance(asOfDate: string): FinancialMaintenanceState {
  return {
    stableMonthlyIncome: "0",
    stableIncomeRevisions: [],
    actualIncomeRecords: [],
    essentialExpenses: [],
    cashAccounts: [
      { id: "illustrative-cash", name: "零钱", balance: "8000", includeInSafetyResources: true },
    ],
    assets: [],
    debts: [],
    settings: {
      safetyCoverageTargetMonths: 6,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    requiresSafetyRecoveryHorizon: false,
    asOfDate,
  };
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error("演示数据没有这项操作。"));
}

export function createIllustrativeServices(): ProductApplicationServices {
  return {
    bootstrap: async () => ({ status: "READY" }),
    getOnboardingRequirement: () => ({ requiresSafetyRecoveryHorizon: false }),
    completeOnboarding: async (_submission, asOfDate) => illustrativeHome(asOfDate),
    getHomeApplicationState: async (asOfDate) => illustrativeHome(asOfDate),
    getExpenseRecordById: async () => null,
    recordExpenseAndRecalculate: async (_expense, asOfDate) => illustrativeHome(asOfDate),
    recordV2CashExpense: async () => ({ expenseId: "illustrative" }),
    getV2ImportOptions: unavailable,
    writeV2Import: unavailable,
    getFinancialMaintenanceState: async (asOfDate) => illustrativeMaintenance(asOfDate),
    getFinancialMaintenanceRequirement: async () => ({ requiresSafetyRecoveryHorizon: false }),
    updateFinancialDataAndRecalculate: async (_patch, asOfDate) => ({
      state: illustrativeMaintenance(asOfDate),
      home: illustrativeHome(asOfDate),
    }),
    saveCurrentMonthDebtFact: unavailable,
    savePlanningMonthDecision: unavailable,
    reviseActualIncome: unavailable,
    getV4FinancialReadState: unavailable,
    deactivateCashAccount: unavailable,
    deactivateAsset: unavailable,
    deactivateDebt: unavailable,
    listLedgerExpenses: unavailable,
    editLedgerExpense: unavailable,
    deleteLedgerExpense: unavailable,
    restoreLedgerExpense: unavailable,
    listLedgerTransfers: unavailable,
    createLedgerTransfer: unavailable,
    editLedgerTransfer: unavailable,
    deleteLedgerTransfer: unavailable,
    restoreLedgerTransfer: unavailable,
    getRecordingStreak: unavailable,
    listEssentialPaymentItems: async () => [],
    listEssentialPayments: async () => [],
    recordEssentialPayment: unavailable,
    saveEssentialItems: unavailable,
    listDebtPaymentLog: unavailable,
    recordDebtRepayment: unavailable,
    recategorizeLedgerExpenses: unavailable,
    readAuditLog: unavailable,
    exportLedger: unavailable,
  };
}
