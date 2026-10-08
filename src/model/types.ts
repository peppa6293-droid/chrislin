import type { Decimal } from "decimal.js";

/** Decimal.js values are immutable and retain arbitrary decimal precision. */
export type Money = Decimal;
export type MoneyInput = Decimal.Value;

export interface FinancialProfile {
  id: string;
  displayName?: string;
}

export interface FinancialSettings {
  safetyCoverageTargetMonths: number;
  minimumCashCoverageMonths: number;
  safetyRecoveryHorizonMonths?: number;
  desiredMonthlyDiscretionarySpending: MoneyInput;
}

export type IncomeKind = "PLANNING" | "ACTUAL";
export type IncomeStatus = "EXPECTED" | "PENDING" | "RECEIVED";

export interface IncomeRecord {
  id: string;
  kind: IncomeKind;
  status: IncomeStatus;
  amount: MoneyInput;
  date: string;
}

export type ExpenseKind = "ESSENTIAL" | "VARIABLE";
export type ExpenseCategory =
  | "HOUSING"
  | "BASIC_FOOD"
  | "TRANSPORT"
  | "UTILITIES_COMMUNICATIONS"
  | "INSURANCE"
  | "FAMILY_FIXED_RESPONSIBILITY"
  | "OTHER_ESSENTIAL"
  | "FOOD"
  | "SHOPPING"
  | "ENTERTAINMENT"
  | "HOUSEHOLD"
  | "OTHER_VARIABLE";

export interface ExpenseRecord {
  id: string;
  amount: MoneyInput;
  dateTime: string;
  /** User-local calendar date used for all financial period grouping. */
  businessDate: string;
  kind: ExpenseKind;
  category: ExpenseCategory;
  note?: string;
}

export interface CashAccount {
  id: string;
  balance: MoneyInput;
  includeInSafetyResources: boolean;
}

export type AssetKind = "LIQUID_INVESTMENT" | "OTHER";

export interface Asset {
  id: string;
  currentValue: MoneyInput;
  kind: AssetKind;
  includeInSafetyResources: boolean;
}

export interface Debt {
  id: string;
  name: string;
  currentBalance: MoneyInput;
  currentMonthDue?: MoneyInput | null;
  fixedMonthlyPayment?: MoneyInput | null;
}

/** Prior observed facts used only as comparison baselines, never as current derived output. */
export interface HistoricalSnapshot {
  asOfDate: string;
  eligibleCash?: MoneyInput | null;
  safetyResources?: MoneyInput | null;
  monthlyCoreObligations?: MoneyInput | null;
  debtBalance?: MoneyInput | null;
  liquidInvestableAssets?: MoneyInput | null;
  samePeriodVariableSpending?: MoneyInput | null;
  recommendedMonthlySpending?: MoneyInput | null;
}

export interface FinancialFacts {
  asOfDate: string;
  currentMonth: string;
  planningIncome: MoneyInput;
  actualIncomeRecords: IncomeRecord[];
  essentialExpenses: MoneyInput;
  cashAccounts: CashAccount[];
  assets: Asset[];
  debts: Debt[];
  expenses: ExpenseRecord[];
  previousSnapshot?: HistoricalSnapshot | null;
}

export interface ModelInput {
  profile: FinancialProfile;
  settings: FinancialSettings;
  facts: FinancialFacts;
}

export type SafetyCoverageStatus = "NORMAL" | "NO_CORE_OBLIGATION";
export type CashSafetyGateStatus = "ACTIVE" | "CLEAR" | "NOT_APPLICABLE";

export interface DebtResult {
  mandatoryDebtService: Money;
  totalDebtBalance: Money;
  debtPayments: Array<{
    debtId: string;
    amount: Money;
    source: "CURRENT_MONTH_DUE" | "FIXED_MONTHLY_PAYMENT" | "NO_PAYMENT";
  }>;
  rulesApplied: string[];
}

export interface SafetyResult {
  safetyResources: Money;
  eligibleCash: Money;
  eligibleLiquidInvestmentAssets: Money;
  monthlyCoreObligations: Money;
  coverageStatus: SafetyCoverageStatus;
  safetyCoverageMonths: Money | null;
  cashCoverageMonths: Money | null;
  safetyTargetResources: Money;
  safetyGap: Money;
  cashFloorMet: boolean | null;
  cashSafetyGateStatus: CashSafetyGateStatus;
  requiredMonthlySafetyRecovery: Money;
  actualMonthlySafetyRecovery: Money;
  rulesApplied: string[];
}

export type SpendingStatus = "NORMAL" | "STRUCTURAL_DEFICIT" | "BALANCED_NO_SURPLUS";

export interface SpendingResult {
  status: SpendingStatus;
  baseSurplus: Money;
  desiredMonthlyDiscretionarySpending: Money;
  recommendedMonthlySpending: Money;
  actualVariableSpending: Money;
  remainingOptionalSpendingCapacity: Money;
  amountAboveRecommendation: Money;
  safeOptionalCapacity: Money;
  unallocatedSurplus: Money;
  recommendedNewInvestmentCapacity: Money;
  rulesApplied: string[];
}

export type TrendDimension = "LIQUIDITY_SAFETY" | "DEBT" | "CONSUMPTION" | "WEALTH";
export type DimensionDirection =
  | "IMPROVING"
  | "NEUTRAL"
  | "WORSENING"
  | "NO_BASELINE"
  | "NOT_APPLICABLE";

export interface DimensionSignal {
  direction: DimensionDirection;
  reason: string;
}

export type OverallTrendState =
  | "IMPROVING_STRONGLY"
  | "IMPROVING"
  | "STABLE"
  | "UNDER_PRESSURE"
  | "DETERIORATING"
  | "BASELINE_BUILDING";

export interface TrendResult {
  state: OverallTrendState;
  dimensions: Record<TrendDimension, DimensionSignal>;
  validComparisonDimensionCount: number;
  improvingCount: number;
  worseningCount: number;
  primaryImprovement: TrendDimension | null;
  primaryDrag: TrendDimension | null;
  rulesApplied: string[];
}

export interface ConsumptionUtilization {
  status: "CALCULATED" | "ZERO_RECOMMENDATION";
  value: Money | null;
  actualSpend: Money;
  proratedRecommendedSpend: Money;
}

export interface SpecBlocker {
  code: "BLOCKED_BY_SPEC";
  exactCase: string;
  conflictingRules: string[];
  minimalResolutionNeeded: string;
}

export type TrendOutcome =
  | { status: "COMPLETE"; result: TrendResult }
  | { status: "BLOCKED_BY_SPEC"; blocker: SpecBlocker };

export type PriorityActionCode =
  | "RESTORE_CORE_BALANCE"
  | "REBUILD_CASH_FLOOR"
  | "ADDRESS_PRIMARY_DRAG"
  | "ADDRESS_SAFETY_GAP"
  | "NO_ACTION";

export interface PriorityAction {
  action_code: PriorityActionCode;
  reason: string;
  dimension?: TrendDimension;
}

export type PriorityActionOutcome = PriorityAction;

export interface MonthlySnapshot {
  currentMonth: string;
  eligibleCash: Money;
  safetyResources: Money;
  monthlyCoreObligations: Money;
  totalDebtBalance: Money;
  liquidInvestableAssets: Money;
  actualVariableSpending: Money;
  recommendedMonthlySpending: Money;
}

export interface MonthlyModelResult {
  debt: DebtResult;
  safety: SafetyResult;
  spending: SpendingResult;
  trend: TrendOutcome;
  priorityAction: PriorityActionOutcome;
  consumptionUtilization: {
    current: ConsumptionUtilization;
    previous: ConsumptionUtilization | null;
  };
  snapshot: MonthlySnapshot;
}
