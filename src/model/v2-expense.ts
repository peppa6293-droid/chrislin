import { Decimal } from "decimal.js";

export type ExpenseKind = "CASH_DEBIT" | "CREDIT_ONE_TIME" | "CREDIT_INSTALLMENT";

export interface InstallmentScheduleItem {
  installmentNumber: number;
  dueMonth: string;
  amount: string;
}

export interface BaseV2Expense {
  id: string;
  profileId: string;
  kind: ExpenseKind;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string;
  description: string;
}

export interface CashDebitExpense extends BaseV2Expense {
  kind: "CASH_DEBIT";
  accountId: string;
}

export interface CreditOneTimeExpense extends BaseV2Expense {
  kind: "CREDIT_ONE_TIME";
  creditCardId: string;
}

export interface CreditInstallmentExpense extends BaseV2Expense {
  kind: "CREDIT_INSTALLMENT";
  totalAmount: string;
  periods: number;
  fee: string;
  firstInstallmentMonth: string;
  installmentAmount: string;
  creditCardId: string;
  repaymentSchedule: InstallmentScheduleItem[];
  paidPeriods: number;
  remainingPeriods: number;
  remainingAmount: string;
}

export type V2Expense = CashDebitExpense | CreditOneTimeExpense | CreditInstallmentExpense;

export interface InstallmentScheduleInput {
  totalAmount: string;
  periods: number;
  fee: string;
  startMonth: string;
}

const MONEY_SCALE = 2;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function money(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

function assertMoney(value: string, fieldName: string, allowZero = false): Decimal {
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new RangeError(`${fieldName} must be a valid decimal amount`);
  }
  if (!decimal.isFinite() || (allowZero ? decimal.isNegative() : !decimal.isPositive())) {
    throw new RangeError(`${fieldName} must be ${allowZero ? "zero or positive" : "positive"}`);
  }
  return decimal;
}

function assertMonth(month: string): void {
  if (!MONTH_PATTERN.test(month)) throw new RangeError("startMonth must use YYYY-MM format");
}

function monthOffset(startMonth: string, offset: number): string {
  const [yearText, monthText] = startMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calculateInstallmentSchedule(
  totalAmount: string,
  periods: number,
  fee: string,
  startMonth: string,
): InstallmentScheduleItem[] {
  const total = assertMoney(totalAmount, "totalAmount");
  const serviceFee = assertMoney(fee, "fee", true);
  if (!Number.isInteger(periods) || periods < 1) {
    throw new RangeError("periods must be a positive integer");
  }
  assertMonth(startMonth);

  const obligation = total.plus(serviceFee).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
  const baseAmount = obligation.div(periods).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);
  const finalAmount = obligation.minus(baseAmount.times(periods - 1)).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);

  return Array.from({ length: periods }, (_, index) => ({
    installmentNumber: index + 1,
    dueMonth: monthOffset(startMonth, index),
    amount: money(index === periods - 1 ? finalAmount : baseAmount),
  }));
}

export function createCashDebitExpense(input: Omit<CashDebitExpense, "kind">): CashDebitExpense {
  assertMoney(input.amount, "amount");
  return { ...input, kind: "CASH_DEBIT" };
}

export function createCreditOneTimeExpense(
  input: Omit<CreditOneTimeExpense, "kind">,
): CreditOneTimeExpense {
  assertMoney(input.amount, "amount");
  return { ...input, kind: "CREDIT_ONE_TIME" };
}

export function createCreditInstallmentExpense(
  input: Omit<CreditInstallmentExpense, "kind" | "installmentAmount" | "repaymentSchedule" | "remainingPeriods" | "remainingAmount" | "paidPeriods"> & {
    paidPeriods?: number;
  },
): CreditInstallmentExpense {
  const amount = assertMoney(input.amount, "amount");
  const totalAmount = assertMoney(input.totalAmount, "totalAmount");
  if (!amount.eq(totalAmount)) {
    throw new RangeError("amount must equal totalAmount for an installment expense");
  }
  const schedule = calculateInstallmentSchedule(
    totalAmount.toFixed(MONEY_SCALE),
    input.periods,
    input.fee,
    input.firstInstallmentMonth,
  );
  const paidPeriods = input.paidPeriods ?? 0;
  if (!Number.isInteger(paidPeriods) || paidPeriods < 0 || paidPeriods > input.periods) {
    throw new RangeError("paidPeriods must be between zero and periods");
  }
  const remainingSchedule = schedule.slice(paidPeriods);
  const remainingAmount = remainingSchedule.reduce(
    (sum, item) => sum.plus(item.amount),
    new Decimal(0),
  );
  return {
    ...input,
    kind: "CREDIT_INSTALLMENT",
    installmentAmount: schedule[0]?.amount ?? "0.00",
    repaymentSchedule: schedule,
    paidPeriods,
    remainingPeriods: remainingSchedule.length,
    remainingAmount: money(remainingAmount),
  };
}
