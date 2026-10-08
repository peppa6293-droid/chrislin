import type {
  ExpenseRecord,
  HistoricalSnapshot,
  ModelInput,
  MoneyInput,
} from "../../src/model/types.js";

export function makeInput(
  overrides: {
    facts?: Partial<ModelInput["facts"]>;
    settings?: Partial<ModelInput["settings"]>;
  } = {},
): ModelInput {
  return {
    profile: { id: "test-profile" },
    settings: {
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 2,
      safetyRecoveryHorizonMonths: 12,
      desiredMonthlyDiscretionarySpending: "3000",
      ...overrides.settings,
    },
    facts: {
      asOfDate: "2026-10-04",
      currentMonth: "2026-10",
      planningIncome: "10000",
      actualIncomeRecords: [],
      essentialExpenses: "2000",
      cashAccounts: [{ id: "cash", balance: "6000", includeInSafetyResources: true }],
      assets: [
        {
          id: "fund",
          currentValue: "4000",
          kind: "LIQUID_INVESTMENT",
          includeInSafetyResources: true,
        },
      ],
      debts: [],
      expenses: [],
      ...overrides.facts,
    },
  };
}

export function makeHistory(overrides: Partial<HistoricalSnapshot> = {}): HistoricalSnapshot {
  return {
    asOfDate: "2026-09-30",
    eligibleCash: "5000",
    safetyResources: "9000",
    monthlyCoreObligations: "2000",
    debtBalance: "1000",
    liquidInvestableAssets: "4000",
    samePeriodVariableSpending: "300",
    recommendedMonthlySpending: "3000",
    ...overrides,
  };
}

export function variableExpense(amount: MoneyInput, date = "2026-10-04"): ExpenseRecord {
  return {
    id: `variable-${date}-${String(amount)}`,
    amount,
    dateTime: `${date}T12:00:00.000Z`,
    businessDate: date,
    kind: "VARIABLE",
    category: "FOOD",
  };
}
