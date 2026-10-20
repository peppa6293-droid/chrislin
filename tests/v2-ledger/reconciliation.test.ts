import { describe, expect, it } from "vitest";
import {
  calculateCashAfterPayment,
  reconcileCashDebitExpense,
  reconcileCreditCardPayment,
  reconcileInstallmentTotal,
} from "../../src/model/v2-reconciliation.js";

describe("V2 reconciliation", () => {
  const payment = {
    id: "payment-1",
    expenseId: "expense-1",
    cashAccountId: "cash-1",
    amount: "30.00",
    currency: "CNY",
    paidOn: "2027-01-10",
  };

  it("calls the cash reconciliation logic once and does not double count a cash expense", () => {
    const cashExpense = {
      id: "cash-expense-1",
      accountId: "cash-1",
      amount: "30.00",
      currency: "CNY",
    };
    const cash = reconcileCashDebitExpense(cashExpense);
    expect(cash).toEqual({
      expenseId: "cash-expense-1",
      spendingRecognition: "30.00",
      cashReduction: "30.00",
      countsAsDailyExpense: true,
    });
    expect(cash.spendingRecognition).toBe(cash.cashReduction);
  });

  it("recognizes credit-card repayment as cash settlement only", () => {
    const creditPurchaseSpending = "30.00";
    const repayment = reconcileCreditCardPayment("expense-1", payment);
    expect(creditPurchaseSpending).toBe("30.00");
    expect(repayment).toMatchObject({
      cashAccountId: "cash-1",
      cashReduction: "30.00",
      spendingRecognition: "0.00",
      countsAsDailyExpense: false,
    });
    expect(Number(creditPurchaseSpending) + Number(repayment.spendingRecognition)).toBe(30);
  });

  it("reconciles installment records to principal plus fee", () => {
    expect(
      reconcileInstallmentTotal(
        [
          { installmentNumber: 1, amount: "33.33" },
          { installmentNumber: 2, amount: "33.33" },
          { installmentNumber: 3, amount: "33.35" },
        ],
        "100.01",
      ),
    ).toBe("100.01");
  });

  it("matches cash change to the actual payment", () => {
    expect(calculateCashAfterPayment("250.00", payment)).toBe("220.00");
  });

  it("requires unique continuous installment numbers", () => {
    expect(() =>
      reconcileInstallmentTotal(
        [
          { installmentNumber: 1, amount: "1.00" },
          { installmentNumber: 1, amount: "1.00" },
        ],
        "2.00",
      ),
    ).toThrow(/continuous/);
    expect(() =>
      reconcileInstallmentTotal(
        [
          { installmentNumber: 1, amount: "1.00" },
          { installmentNumber: 3, amount: "1.00" },
        ],
        "2.00",
      ),
    ).toThrow(/continuous/);
  });

  it("rejects zero/invalid amounts, empty schedules, mismatched totals, and overpayment", () => {
    expect(() => reconcileCreditCardPayment("expense-1", { ...payment, amount: "0.00" })).toThrow();
    expect(() => reconcileInstallmentTotal([], "1.00")).toThrow();
    expect(() =>
      reconcileInstallmentTotal([{ installmentNumber: 1, amount: "1.00" }], "2.00"),
    ).toThrow();
    expect(() => calculateCashAfterPayment("10.00", payment)).toThrow();
  });
});
