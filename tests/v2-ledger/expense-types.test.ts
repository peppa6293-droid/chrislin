import { describe, expect, it } from "vitest";
import {
  calculateInstallmentSchedule,
  createCashDebitExpense,
  createCreditInstallmentExpense,
  createCreditOneTimeExpense,
} from "../../src/model/v2-expense.js";

describe("V2 expense kinds", () => {
  const common = {
    id: "expense-1",
    profileId: "profile-a",
    amount: "120.00",
    currency: "CNY",
    occurredOn: "2026-10-17",
    categoryId: "category-food",
    description: "synthetic lunch",
  };

  it("creates cash debit, credit one-time, and credit installment expenses", () => {
    expect(createCashDebitExpense({ ...common, accountId: "cash-1" })).toMatchObject({
      kind: "CASH_DEBIT",
      accountId: "cash-1",
    });
    expect(createCreditOneTimeExpense({ ...common, creditCardId: "card-1" })).toMatchObject({
      kind: "CREDIT_ONE_TIME",
      creditCardId: "card-1",
    });

    const installment = createCreditInstallmentExpense({
      ...common,
      amount: "100.00",
      totalAmount: "100.00",
      periods: 3,
      fee: "2.00",
      firstInstallmentMonth: "2026-10",
      creditCardId: "card-1",
    });
    expect(installment.kind).toBe("CREDIT_INSTALLMENT");
    expect(installment.installmentAmount).toBe("34.00");
    expect(installment.repaymentSchedule).toHaveLength(3);
    expect(installment.remainingAmount).toBe("102.00");
    expect(installment.remainingPeriods).toBe(3);
  });

  it("keeps decimal precision and allocates rounding remainder to the final installment", () => {
    const schedule = calculateInstallmentSchedule("100.00", 3, "0.01", "2026-10");
    expect(schedule.map((item) => item.amount)).toEqual(["33.33", "33.33", "33.35"]);
    expect(schedule.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)).toBe("100.01");
  });

  it("crosses December to January and returns future N months deterministically", () => {
    const schedule = calculateInstallmentSchedule("120.00", 4, "0.00", "2026-12");
    expect(schedule.map((item) => item.dueMonth)).toEqual([
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(schedule.map((item) => item.amount)).toEqual(["30.00", "30.00", "30.00", "30.00"]);
  });

  it("tracks paid and remaining installment amounts without changing the original obligation", () => {
    const expense = createCreditInstallmentExpense({
      ...common,
      amount: "100.00",
      totalAmount: "100.00",
      periods: 3,
      fee: "2.00",
      firstInstallmentMonth: "2026-12",
      creditCardId: "card-1",
      paidPeriods: 1,
    });
    expect(expense.repaymentSchedule.map((item) => item.amount)).toEqual(["34.00", "34.00", "34.00"]);
    expect(expense.paidPeriods).toBe(1);
    expect(expense.remainingPeriods).toBe(2);
    expect(expense.remainingAmount).toBe("68.00");
  });

  it("rejects invalid periods, months, and negative amounts", () => {
    expect(() => calculateInstallmentSchedule("100.00", 0, "0.00", "2026-10")).toThrow();
    expect(() => calculateInstallmentSchedule("100.00", 2, "0.00", "2026-13")).toThrow();
    expect(() => calculateInstallmentSchedule("-1.00", 2, "0.00", "2026-10")).toThrow();
  });

  it("rejects inconsistent installment amount and totalAmount fields", () => {
    expect(() =>
      createCreditInstallmentExpense({
        ...common,
        amount: "999.00",
        totalAmount: "100.00",
        periods: 3,
        fee: "2.00",
        firstInstallmentMonth: "2026-10",
        creditCardId: "card-1",
      }),
    ).toThrow(/amount must equal totalAmount/);
  });

  it("rejects an invalid installment amount even when totalAmount is valid", () => {
    expect(() =>
      createCreditInstallmentExpense({
        ...common,
        amount: "not-a-money-value",
        totalAmount: "100.00",
        periods: 3,
        fee: "2.00",
        firstInstallmentMonth: "2026-10",
        creditCardId: "card-1",
      }),
    ).toThrow(/amount must be a valid decimal amount/);
  });
});
