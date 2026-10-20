import { Decimal } from "decimal.js";
import { assertUserInputMoney } from "../model/money.js";
import type { BillStatus } from "../model/v2-cashflow.js";
import {
  type CashDebitExpense,
  type CreditInstallmentExpense,
  type CreditOneTimeExpense,
  calculateInstallmentSchedule,
  createCashDebitExpense,
  createCreditInstallmentExpense,
  createCreditOneTimeExpense,
} from "../model/v2-expense.js";
import {
  reconcileCashDebitExpense,
  reconcileCreditCardPayment,
  reconcileInstallmentTotal,
} from "../model/v2-reconciliation.js";
import { ApplicationDataError } from "../persistence/database.js";
import type { Repositories } from "../persistence/repositories.js";
import type { V2DashboardProps } from "../ui/v2-dashboard.js";

const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CashDebitExpenseDraft {
  id: string;
  profileId: string;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  accountId: string;
}

export interface CreditInstallmentDraft {
  totalAmount: string;
  periods: number;
  fee: string;
  firstInstallmentMonth: string;
}

export interface CreditExpenseDraft {
  id: string;
  profileId: string;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  creditCardId: string;
  installment?: CreditInstallmentDraft;
}

export interface CreditCardPaymentDraft {
  id: string;
  expenseId: string;
  cashAccountId: string;
  amount: string;
  currency: string;
  paidOn: string;
}

export interface V2MonthSummary {
  dailyExpenseTotal: string;
  billStatuses: BillStatus[];
}

function assertPositiveMoney(value: string, field: string): string {
  let normalized: string;
  try {
    normalized = assertUserInputMoney(value, field);
  } catch (error) {
    throw new ApplicationDataError("INVALID_EXPENSE_AMOUNT", `${field} is invalid.`, {
      cause: error,
    });
  }
  const parsed = new Decimal(normalized);
  if (!parsed.isPositive()) {
    throw new ApplicationDataError("INVALID_EXPENSE_AMOUNT", `${field} must be positive.`);
  }
  return normalized;
}

function assertCalendarDate(value: string, field: string): void {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new ApplicationDataError("INVALID_EXPENSE_DATE", `${field} must use YYYY-MM-DD format.`);
  }
  const [yearText = "0", monthText = "0", dayText = "0"] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new ApplicationDataError(
      "INVALID_EXPENSE_DATE",
      `${field} must be a valid calendar date.`,
    );
  }
}

function assertRequiredText(value: string, code: string, message: string): string {
  if (!value.trim()) throw new ApplicationDataError(code, message);
  return value;
}

function formatMoney(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export class V2ExpenseService {
  constructor(private readonly repositories: Repositories) {}

  async recordCashDebitExpense(draft: CashDebitExpenseDraft): Promise<{
    expense: CashDebitExpense;
    reconciliation: ReturnType<typeof reconcileCashDebitExpense>;
  }> {
    const amount = assertPositiveMoney(draft.amount, "amount");
    assertCalendarDate(draft.occurredOn, "occurredOn");
    assertRequiredText(draft.id, "INVALID_EXPENSE_ID", "Expense id is required.");
    assertRequiredText(draft.profileId, "INVALID_PROFILE", "Profile id is required.");
    assertRequiredText(draft.accountId, "INVALID_EXPENSE_ACCOUNT", "Account id is required.");
    assertRequiredText(draft.currency, "INVALID_CURRENCY", "Currency is required.");
    await this.assertCategoryExists(draft.profileId, draft.categoryId);

    const expense = createCashDebitExpense({
      id: draft.id,
      profileId: draft.profileId,
      amount,
      currency: draft.currency,
      occurredOn: draft.occurredOn,
      categoryId: draft.categoryId,
      description: draft.description,
      accountId: draft.accountId,
    });
    const reconciliation = reconcileCashDebitExpense(expense);
    const createdAt = new Date().toISOString();
    await this.repositories.createV2ExpenseWithLegacyMirror(expense, {
      amount: expense.amount,
      occurredAt: `${expense.occurredOn}T00:00:00.000Z`,
      businessDate: expense.occurredOn,
      note: expense.description === "" ? null : expense.description,
      createdAt,
    });
    const stored = await this.repositories.getV2ExpenseById(expense.id);
    if (stored?.kind !== "CASH_DEBIT") {
      throw new ApplicationDataError(
        "EXPENSE_READBACK_FAILED",
        "Cash debit expense readback did not match.",
      );
    }
    this.assertReadback(stored, expense);
    const legacy = await this.repositories.expenseById(expense.id);
    if (
      !legacy ||
      String(legacy.amount) !== expense.amount ||
      legacy.businessDate !== expense.occurredOn
    ) {
      throw new ApplicationDataError(
        "EXPENSE_READBACK_FAILED",
        "Cash debit legacy ledger mirror readback did not match.",
      );
    }
    return { expense: stored, reconciliation };
  }

  async recordCreditExpense(draft: CreditExpenseDraft): Promise<{
    expense: CreditOneTimeExpense | CreditInstallmentExpense;
  }> {
    const amount = assertPositiveMoney(draft.amount, "amount");
    assertCalendarDate(draft.occurredOn, "occurredOn");
    assertRequiredText(draft.id, "INVALID_EXPENSE_ID", "Expense id is required.");
    assertRequiredText(draft.profileId, "INVALID_PROFILE", "Profile id is required.");
    assertRequiredText(
      draft.creditCardId,
      "INVALID_EXPENSE_ACCOUNT",
      "Credit card id is required.",
    );
    assertRequiredText(draft.currency, "INVALID_CURRENCY", "Currency is required.");
    await this.assertCategoryExists(draft.profileId, draft.categoryId);

    const base = {
      id: draft.id,
      profileId: draft.profileId,
      amount,
      currency: draft.currency,
      occurredOn: draft.occurredOn,
      categoryId: draft.categoryId,
      description: draft.description,
      creditCardId: draft.creditCardId,
    };

    if (!draft.installment) {
      const expense = createCreditOneTimeExpense(base);
      await this.repositories.createV2Expense(expense);
      const stored = await this.repositories.getV2ExpenseById(expense.id);
      if (stored?.kind !== "CREDIT_ONE_TIME") {
        throw new ApplicationDataError(
          "EXPENSE_READBACK_FAILED",
          "Credit one-time expense readback did not match.",
        );
      }
      this.assertReadback(stored, expense);
      return { expense: stored };
    }

    const totalAmount = assertPositiveMoney(
      draft.installment.totalAmount,
      "installment.totalAmount",
    );
    if (!new Decimal(amount).eq(totalAmount)) {
      throw new ApplicationDataError(
        "INVALID_EXPENSE_INSTALLMENT",
        "Installment totalAmount must equal expense amount.",
      );
    }
    if (!Number.isInteger(draft.installment.periods) || draft.installment.periods < 1) {
      throw new ApplicationDataError(
        "INVALID_EXPENSE_INSTALLMENT",
        "Installment periods must be a positive integer.",
      );
    }
    assertUserInputMoney(draft.installment.fee, "installment.fee");
    assertCalendarMonth(draft.installment.firstInstallmentMonth);
    const schedule = calculateInstallmentSchedule(
      totalAmount,
      draft.installment.periods,
      draft.installment.fee,
      draft.installment.firstInstallmentMonth,
    );
    const obligation = new Decimal(totalAmount).plus(new Decimal(draft.installment.fee));
    let scheduleTotal: string;
    try {
      scheduleTotal = reconcileInstallmentTotal(schedule, obligation.toFixed(2));
    } catch (error) {
      throw new ApplicationDataError(
        "INVALID_EXPENSE_INSTALLMENT",
        "Installment schedule total does not equal totalAmount plus fee.",
        { cause: error },
      );
    }
    if (scheduleTotal !== obligation.toDecimalPlaces(2).toFixed(2)) {
      throw new ApplicationDataError(
        "INVALID_EXPENSE_INSTALLMENT",
        "Installment schedule total does not equal totalAmount plus fee.",
      );
    }
    const expense = createCreditInstallmentExpense({
      ...base,
      totalAmount,
      periods: draft.installment.periods,
      fee: draft.installment.fee,
      firstInstallmentMonth: draft.installment.firstInstallmentMonth,
    });
    await this.repositories.createV2Expense(expense);
    const stored = await this.repositories.getV2ExpenseById(expense.id);
    if (stored?.kind !== "CREDIT_INSTALLMENT") {
      throw new ApplicationDataError(
        "EXPENSE_READBACK_FAILED",
        "Credit installment expense readback did not match.",
      );
    }
    this.assertReadback(stored, expense);
    return { expense };
  }

  async recordCreditCardPayment(paymentDraft: CreditCardPaymentDraft): Promise<{
    reconciliation: ReturnType<typeof reconcileCreditCardPayment>;
  }> {
    assertRequiredText(paymentDraft.id, "INVALID_PAYMENT_ID", "Payment id is required.");
    assertRequiredText(paymentDraft.expenseId, "INVALID_EXPENSE_ID", "Expense id is required.");
    assertRequiredText(
      paymentDraft.cashAccountId,
      "INVALID_EXPENSE_ACCOUNT",
      "Cash account id is required.",
    );
    assertRequiredText(paymentDraft.currency, "INVALID_CURRENCY", "Currency is required.");
    assertCalendarDate(paymentDraft.paidOn, "paidOn");
    assertPositiveMoney(paymentDraft.amount, "amount");
    const reconciliation = reconcileCreditCardPayment(paymentDraft.expenseId, paymentDraft);
    return { reconciliation };
  }

  async getMonthSummary(profileId: string, month: string): Promise<V2MonthSummary> {
    assertRequiredText(profileId, "INVALID_PROFILE", "Profile id is required.");
    assertCalendarMonth(month);
    const expenses = await this.repositories.listV2Expenses(profileId, month);
    const dailyExpenseTotal = expenses
      .reduce((total, expense) => {
        if (expense.kind === "CASH_DEBIT" || expense.kind === "CREDIT_ONE_TIME") {
          return total.plus(new Decimal(expense.amount));
        }
        return total.plus(new Decimal(expense.installmentAmount));
      }, new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      dailyExpenseTotal: formatMoney(dailyExpenseTotal),
      billStatuses: [],
    };
  }

  async getDashboardProps(profileId: string, month: string): Promise<V2DashboardProps> {
    const summary = await this.getMonthSummary(profileId, month);
    return {
      ledger: {
        income: "0.00",
        dailyExpense: summary.dailyExpenseTotal,
        accountCash: "0.00",
      },
      billStatuses: summary.billStatuses,
      savingsPlans: [],
      affordableSavings: [],
      trendSummary: null,
      trendWindow: "month" as never,
    };
  }

  private async assertCategoryExists(profileId: string, categoryId: string): Promise<void> {
    assertRequiredText(categoryId, "INVALID_CATEGORY", "Category id is required.");
    const category = await this.repositories.getExpenseCategoryById(categoryId);
    if (!category || category.profileId !== profileId || !category.active) {
      throw new ApplicationDataError("CATEGORY_NOT_FOUND", "Expense category does not exist.");
    }
  }

  private assertReadback<TExpense extends { id: string }>(
    stored: TExpense | null,
    expected: TExpense,
  ): void {
    if (!stored || stored.id !== expected.id) {
      throw new ApplicationDataError(
        "EXPENSE_READBACK_FAILED",
        "Expense readback did not match the stored id.",
      );
    }
  }
}

function assertCalendarMonth(value: string): void {
  if (!MONTH_PATTERN.test(value)) {
    throw new ApplicationDataError("INVALID_MONTH", "month must use YYYY-MM format.");
  }
}
