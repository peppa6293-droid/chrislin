import { Decimal } from "decimal.js";

const MONEY_SCALE = 2;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type CashPressureLevel = "NONE" | "UPCOMING" | "SHORTFALL" | "OVERDUE";

export interface BillingCycleInput {
  statementMonth: string;
  statementDay: number;
  dueDay: number;
}

export interface BillingCycle {
  statementMonth: string;
  periodStart: string;
  periodEnd: string;
  statementDate: string;
  dueDate: string;
}

export interface BillPayment {
  id: string;
  paidOn: string;
  amount: string;
}

export interface CreditCardBill {
  id: string;
  cardId: string;
  cycle: BillingCycle;
  amountDue: string;
  payments: BillPayment[];
}

export interface BillStatus {
  billId: string;
  amountDue: string;
  paidAmount: string;
  remainingAmount: string;
  paidOff: boolean;
  overdue: boolean;
  pressure: CashPressureLevel;
  explanation: string;
}

export interface CashPressureInput {
  asOf: string;
  availableCash: string;
}

function parseDate(value: string, field: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`${field} must use YYYY-MM-DD format`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError(`${field} must be a valid calendar date`);
  }
  return date;
}

function parseMonth(value: string): { year: number; month: number } {
  const match = YEAR_MONTH.exec(value);
  if (!match) throw new RangeError("statementMonth must use YYYY-MM format");
  return { year: Number(match[1]), month: Number(match[2]) };
}

function dateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampedDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))));
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function money(value: string, field: string, allowZero = false): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new RangeError(`${field} must be a valid decimal amount`);
  }
  if (
    !parsed.isFinite() ||
    (allowZero ? parsed.isNegative() : parsed.isZero() || parsed.isNegative())
  ) {
    throw new RangeError(`${field} must be ${allowZero ? "zero or positive" : "positive"}`);
  }
  return parsed.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

function formatted(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

export function createBillingCycle(input: BillingCycleInput): BillingCycle {
  const { year, month } = parseMonth(input.statementMonth);
  if (!Number.isInteger(input.statementDay) || input.statementDay < 1 || input.statementDay > 31) {
    throw new RangeError("statementDay must be an integer from 1 to 31");
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    throw new RangeError("dueDay must be an integer from 1 to 31");
  }
  const statement = clampedDate(year, month, input.statementDay);
  const dueMonth = input.dueDay > input.statementDay ? { year, month } : addMonths(year, month, 1);
  const due = clampedDate(dueMonth.year, dueMonth.month, input.dueDay);
  const previous = addMonths(year, month, -1);
  const previousStatement = clampedDate(previous.year, previous.month, input.statementDay);
  const periodStart = new Date(previousStatement.getTime() + 24 * 60 * 60 * 1000);
  if (due <= statement) throw new RangeError("dueDate must be after statementDate");
  return {
    statementMonth: input.statementMonth,
    periodStart: dateText(periodStart),
    periodEnd: dateText(statement),
    statementDate: dateText(statement),
    dueDate: dateText(due),
  };
}

export function createCreditCardBill(
  input: Omit<CreditCardBill, "payments"> & { payments?: BillPayment[] },
): CreditCardBill {
  const amountDue = money(input.amountDue, "amountDue");
  const statement = parseDate(input.cycle.statementDate, "statementDate");
  const periodStart = parseDate(input.cycle.periodStart, "periodStart");
  const periodEnd = parseDate(input.cycle.periodEnd, "periodEnd");
  const due = parseDate(input.cycle.dueDate, "dueDate");
  if (periodStart > periodEnd || periodEnd.getTime() !== statement.getTime() || due <= statement) {
    throw new RangeError(
      "billing cycle dates must be ordered periodStart <= statementDate < dueDate",
    );
  }
  const payments = (input.payments ?? []).map((payment) => {
    parseDate(payment.paidOn, "payment.paidOn");
    const value = money(payment.amount, "payment.amount");
    return { ...payment, amount: formatted(value) };
  });
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
  if (paid.gt(amountDue)) throw new RangeError("payments cannot exceed amountDue");
  return { ...input, amountDue: formatted(amountDue), payments };
}

export function calculateBillStatus(bill: CreditCardBill, input: CashPressureInput): BillStatus {
  const asOf = parseDate(input.asOf, "asOf");
  const availableCash = money(input.availableCash, "availableCash", true);
  const amountDue = money(bill.amountDue, "amountDue");
  const paid = bill.payments.reduce(
    (sum, payment) => sum.plus(money(payment.amount, "payment.amount")),
    new Decimal(0),
  );
  if (paid.gt(amountDue)) throw new RangeError("payments cannot exceed amountDue");
  const remaining = amountDue.minus(paid).toDecimalPlaces(MONEY_SCALE);
  const paidOff = remaining.isZero();
  const overdue = !paidOff && asOf > parseDate(bill.cycle.dueDate, "dueDate");
  const shortfall = !paidOff && availableCash.lt(remaining);
  const pressure: CashPressureLevel = paidOff
    ? "NONE"
    : overdue
      ? "OVERDUE"
      : shortfall
        ? "SHORTFALL"
        : "UPCOMING";
  const explanation = paidOff
    ? "这笔账单已经还清，不会再形成待还现金压力。"
    : overdue
      ? `账单已过还款日，仍有 ${formatted(remaining)} 待还，请尽快安排还款。`
      : shortfall
        ? `距离还款日还有时间，但当前可用现金不足以覆盖 ${formatted(remaining)} 的待还金额。`
        : `当前可用现金可以覆盖 ${formatted(remaining)} 的待还金额，请在 ${bill.cycle.dueDate} 前完成还款。`;
  return {
    billId: bill.id,
    amountDue: formatted(amountDue),
    paidAmount: formatted(paid),
    remainingAmount: formatted(remaining),
    paidOff,
    overdue,
    pressure,
    explanation,
  };
}

export function projectCashAfterBillPayment(availableCash: string, bill: CreditCardBill): string {
  const cash = money(availableCash, "availableCash", true);
  const remaining = money(
    calculateBillStatus(bill, { asOf: bill.cycle.statementDate, availableCash: "0.00" })
      .remainingAmount,
    "remainingAmount",
    true,
  );
  if (cash.lt(remaining)) throw new RangeError("payment would exceed available cash");
  return formatted(cash.minus(remaining));
}
