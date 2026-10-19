import { Decimal } from "decimal.js";

export interface CashDebitExpenseRecord {
  id: string;
  accountId: string;
  amount: string;
  currency: string;
}

export interface CashExpenseReconciliation {
  expenseId: string;
  spendingRecognition: string;
  cashReduction: string;
  countsAsDailyExpense: true;
}

export interface CreditCardPaymentRecord {
  id: string;
  expenseId: string;
  cashAccountId: string;
  amount: string;
  currency: string;
  paidOn: string;
}

export interface CreditCardPaymentReconciliation {
  expenseId: string;
  paymentId: string;
  cashAccountId: string;
  cashReduction: string;
  spendingRecognition: string;
  countsAsDailyExpense: false;
}

export interface InstallmentRecord {
  installmentNumber: number;
  amount: string;
}

function money(value: string, field: string, allowZero = false): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new RangeError(`${field} must be a valid decimal amount`);
  }
  if (!parsed.isFinite() || (allowZero ? parsed.isNegative() : parsed.isZero() || parsed.isNegative())) {
    throw new RangeError(`${field} must be ${allowZero ? "zero or positive" : "positive"}`);
  }
  return parsed;
}

export function reconcileCashDebitExpense(
  expense: CashDebitExpenseRecord,
): CashExpenseReconciliation {
  const amount = money(expense.amount, "expense.amount");
  return {
    expenseId: expense.id,
    spendingRecognition: amount.toDecimalPlaces(2).toFixed(2),
    cashReduction: amount.toDecimalPlaces(2).toFixed(2),
    countsAsDailyExpense: true,
  };
}

export function reconcileCreditCardPayment(
  expenseId: string,
  payment: CreditCardPaymentRecord,
): CreditCardPaymentReconciliation {
  if (!expenseId || payment.expenseId !== expenseId) {
    throw new RangeError("payment must reference the expense");
  }
  const amount = money(payment.amount, "payment.amount");
  return {
    expenseId,
    paymentId: payment.id,
    cashAccountId: payment.cashAccountId,
    cashReduction: amount.toDecimalPlaces(2).toFixed(2),
    spendingRecognition: "0.00",
    countsAsDailyExpense: false,
  };
}

export function reconcileInstallmentTotal(
  records: InstallmentRecord[],
  expectedTotal: string,
): string {
  if (records.length === 0) throw new RangeError("installment records must not be empty");
  const expected = money(expectedTotal, "expectedTotal");
  const ordered = [...records].sort((a, b) => a.installmentNumber - b.installmentNumber);
  ordered.forEach((record, index) => {
    if (record.installmentNumber !== index + 1) {
      throw new RangeError("installment numbers must be unique and continuous");
    }
  });
  const actual = ordered.reduce((sum, record) => sum.plus(money(record.amount, "installment.amount")), new Decimal(0));
  const normalizedActual = actual.toDecimalPlaces(2);
  if (!normalizedActual.eq(expected.toDecimalPlaces(2))) {
    throw new RangeError(
      `installment total ${normalizedActual.toFixed(2)} does not equal expected ${expected.toFixed(2)}`,
    );
  }
  return normalizedActual.toFixed(2);
}

export function calculateCashAfterPayment(initialCash: string, payment: CreditCardPaymentRecord): string {
  const cash = money(initialCash, "initialCash", true);
  const paid = money(payment.amount, "payment.amount");
  const remaining = cash.minus(paid);
  if (remaining.isNegative()) throw new RangeError("payment cannot exceed available cash");
  return remaining.toDecimalPlaces(2).toFixed(2);
}
