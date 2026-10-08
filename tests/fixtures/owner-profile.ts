import type { ModelInput } from "../../src/model/types.js";

/** Owner-only scenario fixture. It is never imported by production modules. */
export const ownerProfileFixture: ModelInput = {
  profile: { id: "owner-fixture", displayName: "Owner fixture" },
  settings: {
    safetyCoverageTargetMonths: 6,
    minimumCashCoverageMonths: 2,
    safetyRecoveryHorizonMonths: 12,
    desiredMonthlyDiscretionarySpending: "1600",
  },
  facts: {
    asOfDate: "2026-10-04",
    currentMonth: "2026-10",
    planningIncome: "13000",
    actualIncomeRecords: [
      {
        id: "owner-salary-pending",
        kind: "ACTUAL",
        status: "PENDING",
        amount: "13000",
        date: "2026-10-20",
      },
    ],
    essentialExpenses: "4200",
    cashAccounts: [
      { id: "owner-free-cash", balance: "3948.41", includeInSafetyResources: true },
      { id: "owner-restricted-rent", balance: "3800", includeInSafetyResources: false },
    ],
    assets: [
      {
        id: "owner-liquid-investment",
        currentValue: "3842.12",
        kind: "LIQUID_INVESTMENT",
        includeInSafetyResources: true,
      },
      {
        id: "owner-locked-asset",
        currentValue: "20000",
        kind: "OTHER",
        includeInSafetyResources: false,
      },
    ],
    debts: [
      {
        id: "owner-consumer-debt",
        name: "Consumer debt",
        currentBalance: "47097.66",
        fixedMonthlyPayment: "1200",
      },
      {
        id: "owner-car-loan",
        name: "Car loan",
        currentBalance: "118137.60",
        currentMonthDue: "7007.26",
        fixedMonthlyPayment: "7007.26",
      },
    ],
    expenses: [],
  },
};
