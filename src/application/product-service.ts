import { assertUserInputMoney, money } from "../model/money.js";
import { calculateMonthlyModel } from "../model/monthly-model.js";
import type {
  DimensionSignal,
  ExpenseCategory,
  ExpenseRecord,
  ModelInput,
  MonthlyModelResult,
  PriorityAction,
  SafetyCoverageStatus,
  TrendDimension,
} from "../model/types.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { Repositories } from "../persistence/repositories.js";
import { ApplicationModelError, buildMonthlyModelInput } from "./monthly-model-service.js";

export interface OnboardingSubmission {
  displayName?: string;
  stableMonthlyIncome: string;
  essentialExpenses: {
    category: Extract<
      ExpenseCategory,
      | "HOUSING"
      | "BASIC_FOOD"
      | "TRANSPORT"
      | "UTILITIES_COMMUNICATIONS"
      | "INSURANCE"
      | "FAMILY_FIXED_RESPONSIBILITY"
      | "OTHER_ESSENTIAL"
    >;
    monthlyAmount: string;
  }[];
  cashAccounts: { name: string; balance: string; includeInSafetyResources: boolean }[];
  assets: { name: string; currentValue: string; includeInSafetyResources: boolean }[];
  debts: {
    name: string;
    currentBalance: string;
    currentMonthDue?: string;
    fixedMonthlyPayment?: string;
  }[];
  safetyCoverageTargetMonths: number;
  minimumCashCoverageMonths: number;
  desiredMonthlyDiscretionarySpending: string;
  safetyRecoveryHorizonMonths?: number;
}

export interface OnboardingRequirement {
  requiresSafetyRecoveryHorizon: boolean;
}

export interface HomeApplicationState {
  status: "READY";
  asOfDate: string;
  currentMonth: string;
  profileDisplayName: string | null;
  actualIncomeRecordCount: number;
  /**
   * 所选月份 ACTUAL 收入合计（`income_records`，与收入页同源）。
   * 只读派生：由已在内存的 `facts.actualIncomeRecords` 求和，不新增查询；
   * 无记录时为 "0"，展示层必须据此走缺失态而不是补零。
   */
  actualIncomeTotal: string;
  currentCash: string;
  currentMonthSpending: string;
  /** 本月全部可变支出记录数（按 businessDate 的月份统计，不用 asOfDate 截断）。 */
  currentMonthVariableExpenseCount: number;
  totalDebt: string;
  liquidAssets: string;
  desiredMonthlyDiscretionarySpending: string | null;
  planningIncome: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
  monthlyCoreObligations: string;
  baseSurplus: string;
  eligibleCash: string;
  eligibleLiquidInvestmentAssets: string;
  safetyResources: string;
  safetyTargetResources: string;
  safetyCoverageMonths: string | null;
  safetyCoverageStatus: SafetyCoverageStatus;
  safetyCoverageTargetMonths: number;
  recommendedMonthlySpending: string;
  remainingSpendingCapacity: string;
  amountAboveRecommendation: string;
  cashCoverageMonths: string | null;
  minimumCashCoverageMonths: number;
  safetyGap: string;
  debts: Array<{
    id: string;
    name: string;
    currentBalance: string;
    currentMonthDue: string | null;
    fixedMonthlyPayment: string | null;
    countedMonthlyPayment: string;
    paymentSource: "CURRENT_MONTH_DUE" | "FIXED_MONTHLY_PAYMENT" | "NO_PAYMENT";
  }>;
  spendingStatus: "NORMAL" | "STRUCTURAL_DEFICIT" | "BALANCED_NO_SURPLUS";
  cashSafetyGateStatus: "ACTIVE" | "CLEAR" | "NOT_APPLICABLE";
  cashFloorMet: boolean | null;
  consumptionUtilization: { status: "CALCULATED" | "ZERO_RECOMMENDATION"; value: string | null };
  trendState: string;
  trendDimensions: Record<TrendDimension, DimensionSignal>;
  primaryImprovement: TrendDimension | null;
  primaryDrag: TrendDimension | null;
  priorityAction: PriorityAction;
  recentExpenses?: Array<{
    id: string;
    amount: string;
    businessDate: string;
    category: Extract<
      ExpenseCategory,
      "FOOD" | "TRANSPORT" | "SHOPPING" | "ENTERTAINMENT" | "HOUSEHOLD" | "OTHER_VARIABLE"
    >;
    /** V2 category identity; display layer prefers it over the flattened V1 value. */
    categoryId?: string;
    categoryName?: string;
    categoryColor?: string;
    note?: string;
  }>;
  spendingBreakdown: Array<{
    category: Extract<
      ExpenseCategory,
      "FOOD" | "TRANSPORT" | "SHOPPING" | "ENTERTAINMENT" | "HOUSEHOLD" | "OTHER_VARIABLE"
    >;
    /** V2 category id/name; display layer prefers them over the flattened V1 value. */
    categoryId?: string;
    label?: string;
    amount: string;
    share: string;
    count: number;
  }>;
}

export interface ExpenseSubmission {
  id?: string;
  amount: string;
  dateTime: string;
  businessDate: string;
  category?: Extract<
    ExpenseCategory,
    "FOOD" | "TRANSPORT" | "SHOPPING" | "ENTERTAINMENT" | "HOUSEHOLD" | "OTHER_VARIABLE"
  >;
  note?: string;
  /** S1 cash account or spending-mode debt card to deduct from; omit for no deduction. */
  deductionAccountId?: string;
}

export async function getExpenseRecordById(
  db: SqlDatabase,
  expenseId: string,
): Promise<ExpenseRecord | null> {
  if (!expenseId.trim())
    throw new ApplicationDataError("INVALID_EXPENSE_ID", "Expense ID must not be empty.");
  return new Repositories(db).expenseById(expenseId);
}

const essentialCategories = new Set<ExpenseCategory>([
  "HOUSING",
  "BASIC_FOOD",
  "TRANSPORT",
  "UTILITIES_COMMUNICATIONS",
  "INSURANCE",
  "FAMILY_FIXED_RESPONSIBILITY",
  "OTHER_ESSENTIAL",
]);
const expenseCategories = new Set<ExpenseCategory>([
  "FOOD",
  "TRANSPORT",
  "SHOPPING",
  "ENTERTAINMENT",
  "HOUSEHOLD",
  "OTHER_VARIABLE",
]);

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function buildCandidate(submission: OnboardingSubmission, asOfDate: string): ModelInput {
  for (const item of submission.essentialExpenses) {
    let amount: string;
    try {
      amount = assertUserInputMoney(item.monthlyAmount, "Essential expense");
    } catch {
      throw new ApplicationDataError(
        "INVALID_ESSENTIAL_EXPENSE",
        "Each essential expense must be a non-negative amount within the supported currency range.",
      );
    }
    if (money(amount).isNegative())
      throw new ApplicationDataError(
        "INVALID_ESSENTIAL_EXPENSE",
        "Each essential expense must be non-negative.",
      );
  }
  const month = asOfDate.slice(0, 7);
  return {
    profile: {
      id: "onboarding-candidate",
      ...(submission.displayName === undefined ? {} : { displayName: submission.displayName }),
    },
    settings: {
      safetyCoverageTargetMonths: submission.safetyCoverageTargetMonths,
      minimumCashCoverageMonths: submission.minimumCashCoverageMonths,
      desiredMonthlyDiscretionarySpending: submission.desiredMonthlyDiscretionarySpending,
      ...(submission.safetyRecoveryHorizonMonths === undefined
        ? {}
        : { safetyRecoveryHorizonMonths: submission.safetyRecoveryHorizonMonths }),
    },
    facts: {
      asOfDate,
      currentMonth: month,
      planningIncome: submission.stableMonthlyIncome,
      actualIncomeRecords: [],
      essentialExpenses: submission.essentialExpenses
        .reduce((total, item) => total.plus(money(item.monthlyAmount)), money(0))
        .toString(),
      cashAccounts: submission.cashAccounts.map((item, index) => ({
        id: `cash-${index}`,
        balance: item.balance,
        includeInSafetyResources: item.includeInSafetyResources,
      })),
      assets: submission.assets.map((item, index) => ({
        id: `asset-${index}`,
        currentValue: item.currentValue,
        kind: "LIQUID_INVESTMENT",
        includeInSafetyResources: item.includeInSafetyResources,
      })),
      debts: submission.debts.map((item, index) => ({
        id: `debt-${index}`,
        name: item.name,
        currentBalance: item.currentBalance,
        ...(item.currentMonthDue === undefined ? {} : { currentMonthDue: item.currentMonthDue }),
        ...(item.fixedMonthlyPayment === undefined
          ? {}
          : { fixedMonthlyPayment: item.fixedMonthlyPayment }),
      })),
      expenses: [],
      previousSnapshot: null,
    },
  };
}

function requirement(submission: OnboardingSubmission, asOfDate: string): OnboardingRequirement {
  const candidate = buildCandidate(submission, asOfDate);
  try {
    calculateMonthlyModel(candidate);
    return { requiresSafetyRecoveryHorizon: false };
  } catch (error) {
    const issues = (error as { issues?: Array<{ field: string; code: string }> }).issues;
    if (
      issues?.some(
        (issue) =>
          issue.field === "settings.safetyRecoveryHorizonMonths" && issue.code === "REQUIRED",
      )
    ) {
      if (issues.length !== 1) throw error;
      return { requiresSafetyRecoveryHorizon: true };
    }
    throw error;
  }
}

export function getOnboardingRequirement(
  submission: OnboardingSubmission,
  asOfDate: string,
): OnboardingRequirement {
  try {
    return requirement(submission, asOfDate);
  } catch (error) {
    throw new ApplicationModelError(error);
  }
}

export async function completeOnboarding(
  db: SqlDatabase,
  submission: OnboardingSubmission,
  asOfDate: string,
): Promise<HomeApplicationState> {
  const required = getOnboardingRequirement(submission, asOfDate);
  if (
    required.requiresSafetyRecoveryHorizon &&
    submission.safetyRecoveryHorizonMonths === undefined
  ) {
    throw new ApplicationDataError(
      "SAFETY_RECOVERY_HORIZON_REQUIRED",
      "A safety recovery horizon is required for this onboarding input.",
    );
  }
  const candidate = buildCandidate(submission, asOfDate);
  // Re-run the frozen Model Core with the entered horizon before any write.
  try {
    calculateMonthlyModel(candidate);
  } catch (error) {
    throw new ApplicationModelError(error);
  }

  const profileId = newId();
  const now = `${asOfDate}T00:00:00.000Z`;
  return db.transaction(async (tx) => {
    const repositories = new Repositories(tx);
    await repositories.createProfile(
      {
        id: profileId,
        ...(submission.displayName === undefined ? {} : { displayName: submission.displayName }),
      },
      now,
    );
    await repositories.saveSettings(profileId, {
      safetyCoverageTargetMonths: submission.safetyCoverageTargetMonths,
      minimumCashCoverageMonths: submission.minimumCashCoverageMonths,
      desiredMonthlyDiscretionarySpending: submission.desiredMonthlyDiscretionarySpending,
      ...(submission.safetyRecoveryHorizonMonths === undefined
        ? {}
        : { safetyRecoveryHorizonMonths: submission.safetyRecoveryHorizonMonths }),
    });
    await repositories.saveStablePlanningIncome(
      profileId,
      submission.stableMonthlyIncome,
      asOfDate,
      newId(),
    );
    for (const item of submission.essentialExpenses) {
      if (!essentialCategories.has(item.category))
        throw new ApplicationDataError(
          "INVALID_ESSENTIAL_CATEGORY",
          "Invalid essential expense category.",
        );
      const id = newId();
      await repositories.saveEssentialExpenseInTransaction(
        { id, category: item.category, name: item.category, monthlyAmount: item.monthlyAmount },
        profileId,
        asOfDate,
        now,
      );
    }
    for (const item of submission.cashAccounts) {
      const id = newId();
      await repositories.createCashAccount(
        { id, name: item.name, includeInSafetyResources: item.includeInSafetyResources },
        profileId,
        now,
      );
      await repositories.saveCashSnapshot(
        { id: newId(), accountId: id, asOfDate, balance: item.balance },
        now,
      );
    }
    for (const item of submission.assets) {
      const id = newId();
      await repositories.createAsset(
        {
          id,
          name: item.name,
          kind: "LIQUID_INVESTMENT",
          includeInSafetyResources: item.includeInSafetyResources,
        },
        profileId,
        now,
      );
      await repositories.saveAssetSnapshot(
        { id: newId(), assetId: id, asOfDate, value: item.currentValue },
        now,
      );
    }
    for (const item of submission.debts) {
      const id = newId();
      await repositories.createDebt(
        { id, name: item.name, fixedMonthlyPayment: item.fixedMonthlyPayment ?? null },
        profileId,
        now,
      );
      await repositories.saveDebtPeriodFact(
        {
          id: newId(),
          debtId: id,
          periodMonth: asOfDate.slice(0, 7),
          asOfDate,
          currentBalance: item.currentBalance,
          currentMonthDue: item.currentMonthDue ?? null,
        },
        now,
      );
    }
    const home = await homeFromDatabase(tx, asOfDate);
    if (home.status !== "READY")
      throw new ApplicationDataError(
        "ONBOARDING_INCOMPLETE",
        "Onboarding did not produce a complete profile.",
      );
    return home;
  });
}

export async function getHomeApplicationState(
  db: SqlDatabase,
  asOfDate: string,
): Promise<HomeApplicationState> {
  return homeFromDatabase(db, asOfDate);
}

async function homeFromDatabase(db: SqlDatabase, asOfDate: string): Promise<HomeApplicationState> {
  const built = await buildMonthlyModelInput(db, asOfDate.slice(0, 7), asOfDate);
  if (built.status !== "READY")
    throw new ApplicationDataError(
      "INITIALIZATION_REQUIRED",
      "Onboarding is required before home state is available.",
    );
  let model: MonthlyModelResult;
  try {
    model = calculateMonthlyModel(built.input);
  } catch (error) {
    throw new ApplicationModelError(error);
  }
  if (model.trend.status !== "COMPLETE")
    throw new ApplicationDataError(
      "TREND_BLOCKED",
      "Trend calculation is blocked by the frozen model specification.",
    );
  const repositories = new Repositories(db);
  const [cash, assets] = await Promise.all([
    repositories.cashAccountsAt(asOfDate),
    repositories.assetsAt(asOfDate),
  ]);
  return {
    status: "READY",
    asOfDate,
    currentMonth: asOfDate.slice(0, 7),
    profileDisplayName: built.input.profile.displayName ?? null,
    actualIncomeRecordCount: built.input.facts.actualIncomeRecords.length,
    actualIncomeTotal: built.input.facts.actualIncomeRecords
      .reduce((total, income) => total.plus(money(income.amount)), money(0))
      .toString(),
    currentCash: cash.reduce((total, row) => total.plus(money(row.balance)), money(0)).toString(),
    currentMonthSpending: model.spending.actualVariableSpending.toString(),
    currentMonthVariableExpenseCount: built.input.facts.expenses.filter(
      (expense) =>
        expense.kind === "VARIABLE" && expense.businessDate.slice(0, 7) === asOfDate.slice(0, 7),
    ).length,
    totalDebt: model.debt.totalDebtBalance.toString(),
    liquidAssets: assets
      .filter((asset) => asset.kind === "LIQUID_INVESTMENT")
      .reduce((total, row) => total.plus(money(row.currentValue)), money(0))
      .toString(),
    desiredMonthlyDiscretionarySpending:
      model.spending.desiredMonthlyDiscretionarySpending.toString(),
    planningIncome: built.input.facts.planningIncome.toString(),
    essentialExpenses: built.input.facts.essentialExpenses.toString(),
    mandatoryDebtService: model.debt.mandatoryDebtService.toString(),
    monthlyCoreObligations: model.safety.monthlyCoreObligations.toString(),
    baseSurplus: model.spending.baseSurplus.toString(),
    eligibleCash: model.safety.eligibleCash.toString(),
    eligibleLiquidInvestmentAssets: model.safety.eligibleLiquidInvestmentAssets.toString(),
    safetyResources: model.safety.safetyResources.toString(),
    safetyTargetResources: model.safety.safetyTargetResources.toString(),
    safetyCoverageMonths: model.safety.safetyCoverageMonths?.toString() ?? null,
    safetyCoverageStatus: model.safety.coverageStatus,
    safetyCoverageTargetMonths: built.input.settings.safetyCoverageTargetMonths,
    recommendedMonthlySpending: model.spending.recommendedMonthlySpending.toString(),
    remainingSpendingCapacity: model.spending.remainingOptionalSpendingCapacity.toString(),
    amountAboveRecommendation: model.spending.amountAboveRecommendation.toString(),
    cashCoverageMonths: model.safety.cashCoverageMonths?.toString() ?? null,
    minimumCashCoverageMonths: built.input.settings.minimumCashCoverageMonths,
    safetyGap: model.safety.safetyGap.toString(),
    debts: built.input.facts.debts.map((debt) => {
      const payment = model.debt.debtPayments.find((item) => item.debtId === debt.id);
      if (!payment)
        throw new ApplicationDataError(
          "MODEL_DEBT_PAYMENT_MISSING",
          `The monthly model did not return a payment detail for debt ${debt.id}.`,
        );
      return {
        id: debt.id,
        name: debt.name,
        currentBalance: String(debt.currentBalance),
        currentMonthDue: debt.currentMonthDue == null ? null : String(debt.currentMonthDue),
        fixedMonthlyPayment:
          debt.fixedMonthlyPayment == null ? null : String(debt.fixedMonthlyPayment),
        countedMonthlyPayment: payment.amount.toString(),
        paymentSource: payment.source,
      };
    }),
    spendingStatus: model.spending.status,
    cashSafetyGateStatus: model.safety.cashSafetyGateStatus,
    cashFloorMet: model.safety.cashFloorMet,
    consumptionUtilization: {
      status: model.consumptionUtilization.current.status,
      value: model.consumptionUtilization.current.value?.toString() ?? null,
    },
    trendState: model.trend.result.state,
    trendDimensions: model.trend.result.dimensions,
    primaryImprovement: model.trend.result.primaryImprovement,
    primaryDrag: model.trend.result.primaryDrag,
    priorityAction: model.priorityAction,
    recentExpenses: await recentExpensesForDisplay(
      db,
      repositories,
      built.input.profile.id,
      asOfDate,
    ),
    spendingBreakdown: await buildSpendingBreakdownFromV2(
      repositories,
      built.input.profile.id,
      built.input.facts.expenses,
      asOfDate.slice(0, 7),
    ),
  };
}

type LegacyCategory = Extract<
  ExpenseCategory,
  "FOOD" | "TRANSPORT" | "SHOPPING" | "ENTERTAINMENT" | "HOUSEHOLD" | "OTHER_VARIABLE"
>;

/**
 * Display-layer category read for the home surface.
 *
 * Root cause A of the "everything is 其他" complaint: the D-01 mirror pins
 * `category='OTHER_VARIABLE'`, so reading the V1 ledger loses the real V2
 * category. The mirror is contract-frozen; the display reads V2 instead.
 */
async function recentExpensesForDisplay(
  db: SqlDatabase,
  repositories: Repositories,
  profileId: string,
  asOfDate: string,
): Promise<NonNullable<HomeApplicationState["recentExpenses"]>> {
  const month = asOfDate.slice(0, 7);
  const [hasV2Expenses, hasCategories] = await Promise.all([
    repositories.hasTable("expenses"),
    repositories.hasTable("expense_categories"),
  ]);
  const categories = hasCategories ? await repositories.listExpenseCategories(profileId) : [];
  const v2Expenses = hasV2Expenses ? await repositories.listV2Expenses(profileId, month) : [];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  // Newest by business date, then by entry order; ids are random UUIDs so they cannot order entries.
  const entryRank = new Map(
    (hasV2Expenses
      ? await db.select<{ id: string }>(
          "SELECT id FROM expenses WHERE profile_id=? AND deleted_at IS NULL AND substr(occurred_on,1,7)=? ORDER BY created_at DESC, rowid DESC",
          [profileId, month],
        )
      : []
    ).map((row, rank) => [row.id, rank]),
  );
  const v2Recent = v2Expenses
    .filter((expense) => expense.kind === "CASH_DEBIT")
    .sort(
      (a, b) =>
        b.occurredOn.localeCompare(a.occurredOn) ||
        (entryRank.get(a.id) ?? 0) - (entryRank.get(b.id) ?? 0),
    )
    .slice(0, 3);
  if (v2Recent.length > 0) {
    return v2Recent.map((expense) => {
      const category = categoryById.get(expense.categoryId);
      return {
        id: expense.id,
        amount: String(expense.amount),
        businessDate: expense.occurredOn,
        category: "OTHER_VARIABLE" as LegacyCategory,
        categoryId: expense.categoryId,
        ...(category === undefined
          ? {}
          : { categoryName: category.name, categoryColor: category.color }),
        ...(expense.description ? { note: expense.description } : {}),
      };
    });
  }
  // Legacy-only databases (and unit fixtures) fall back to V1 rows; essential
  // payment records are excluded so they never look like variable spending.
  return (await repositories.listRecentExpenses(3, month))
    .filter((expense) => expense.kind === "VARIABLE")
    .map((expense) => ({
      id: expense.id,
      amount: String(expense.amount),
      businessDate: expense.businessDate,
      category: expense.category as LegacyCategory,
      ...(expense.note === undefined ? {} : { note: expense.note }),
    }));
}

async function buildSpendingBreakdownFromV2(
  repositories: Repositories,
  profileId: string,
  legacyExpenses: ExpenseRecord[],
  month: string,
): Promise<HomeApplicationState["spendingBreakdown"]> {
  const [hasV2Expenses, hasCategories] = await Promise.all([
    repositories.hasTable("expenses"),
    repositories.hasTable("expense_categories"),
  ]);
  const categories = hasCategories ? await repositories.listExpenseCategories(profileId) : [];
  const v2Expenses = hasV2Expenses ? await repositories.listV2Expenses(profileId, month) : [];
  if (v2Expenses.length > 0) {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const grouped = new Map<string, { amount: ReturnType<typeof money>; count: number }>();
    for (const expense of v2Expenses) {
      if (expense.kind !== "CASH_DEBIT") continue;
      const existing = grouped.get(expense.categoryId) ?? { amount: money(0), count: 0 };
      existing.amount = existing.amount.plus(money(String(expense.amount)));
      existing.count += 1;
      grouped.set(expense.categoryId, existing);
    }
    const total = [...grouped.values()].reduce((sum, item) => sum.plus(item.amount), money(0));
    if (total.isZero()) return [];
    return [...grouped.entries()]
      .map(([categoryId, item]) => {
        const category = categoryById.get(categoryId);
        return {
          category: "OTHER_VARIABLE" as LegacyCategory,
          categoryId,
          label: category?.name ?? "未分类",
          amount: item.amount.toString(),
          share: item.amount.div(total).mul(100).toDecimalPlaces(1).toString(),
          count: item.count,
        };
      })
      .sort((a, b) => Number(b.amount) - Number(a.amount));
  }
  return buildSpendingBreakdown(legacyExpenses, month);
}

function buildSpendingBreakdown(
  expenses: ExpenseRecord[],
  month: string,
): NonNullable<HomeApplicationState["spendingBreakdown"]> {
  const grouped = new Map<string, { amount: ReturnType<typeof money>; count: number }>();
  for (const expense of expenses) {
    if (expense.kind !== "VARIABLE" || !expense.businessDate.startsWith(month)) continue;
    const existing = grouped.get(expense.category) ?? { amount: money(0), count: 0 };
    existing.amount = existing.amount.plus(money(String(expense.amount)));
    existing.count += 1;
    grouped.set(expense.category, existing);
  }
  const total = [...grouped.values()].reduce((sum, item) => sum.plus(item.amount), money(0));
  if (total.isZero()) return [];
  return [...grouped.entries()]
    .map(([category, item]) => ({
      category: category as NonNullable<
        NonNullable<HomeApplicationState["spendingBreakdown"]>[number]["category"]
      >,
      amount: item.amount.toString(),
      share: item.amount.div(total).mul(100).toDecimalPlaces(1).toString(),
      count: item.count,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

export async function recordExpenseAndRecalculate(
  db: SqlDatabase,
  expense: ExpenseSubmission,
  asOfDate: string,
): Promise<HomeApplicationState> {
  let canonicalAmount: string;
  try {
    canonicalAmount = assertUserInputMoney(expense.amount, "Expense amount");
  } catch {
    throw new ApplicationDataError(
      "INVALID_EXPENSE_AMOUNT",
      "Expense amount must be within the supported range and have at most 2 decimal places.",
    );
  }
  const value = money(canonicalAmount);
  if (!value.isFinite() || !value.gt(0))
    throw new ApplicationDataError(
      "INVALID_EXPENSE_AMOUNT",
      "Expense amount must be a positive decimal.",
    );
  if (!validDateTime(expense.dateTime))
    throw new ApplicationDataError("INVALID_EXPENSE_DATE", "Expense date and time must be valid.");
  const businessDate = expense.businessDate;
  if (!validCalendarDate(businessDate))
    throw new ApplicationDataError(
      "INVALID_EXPENSE_DATE",
      "Expense business date must be a valid local calendar date.",
    );
  if (expense.category !== undefined && !expenseCategories.has(expense.category))
    throw new ApplicationDataError("INVALID_EXPENSE_CATEGORY", "Expense category is invalid.");
  return db.transaction(async (tx) => {
    const repositories = new Repositories(tx);
    const profile = await repositories.getProfile();
    if (!profile)
      throw new ApplicationDataError(
        "INITIALIZATION_REQUIRED",
        "Onboarding is required before recording expenses.",
      );
    await repositories.saveExpense(
      {
        id: expense.id?.trim() || newId(),
        amount: value.toString(),
        dateTime: expense.dateTime,
        businessDate,
        kind: "VARIABLE",
        ...(expense.category === undefined ? {} : { category: expense.category }),
        ...(expense.note === undefined ? {} : { note: expense.note }),
      },
      profile.id,
      `${asOfDate}T00:00:00.000Z`,
    );
    return homeFromDatabase(tx, asOfDate);
  });
}

function validDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    validCalendarDate(value.slice(0, 10))
  );
}
function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
