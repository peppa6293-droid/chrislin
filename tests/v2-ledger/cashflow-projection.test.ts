import { describe, expect, it } from "vitest";
import {
  calculateBillStatus,
  createBillingCycle,
  createCreditCardBill,
  projectCashAfterBillPayment,
} from "../../src/model/v2-cashflow.js";

describe("V2 credit-card cash-flow planning", () => {
  it("creates a normal cycle and rolls the due date into the next month", () => {
    const cycle = createBillingCycle({ statementMonth: "2026-12", statementDay: 20, dueDay: 10 });
    expect(cycle).toEqual({
      statementMonth: "2026-12",
      periodStart: "2026-11-21",
      periodEnd: "2026-12-20",
      statementDate: "2026-12-20",
      dueDate: "2027-01-10",
    });
  });

  it("supports partial and multiple payments without double-counting spending", () => {
    const bill = createCreditCardBill({
      id: "bill-1",
      cardId: "card-1",
      cycle: createBillingCycle({ statementMonth: "2027-01", statementDay: 15, dueDay: 25 }),
      amountDue: "100.00",
      payments: [
        { id: "p1", paidOn: "2027-01-20", amount: "30.00" },
        { id: "p2", paidOn: "2027-01-24", amount: "20.00" },
      ],
    });
    const status = calculateBillStatus(bill, { asOf: "2027-01-24", availableCash: "80.00" });
    expect(status).toMatchObject({ amountDue: "100.00", paidAmount: "50.00", remainingAmount: "50.00", pressure: "UPCOMING" });
    expect(status.explanation).toContain("50.00");
    expect(projectCashAfterBillPayment("80.00", bill)).toBe("30.00");
  });

  it("recognizes paid-off and zero remaining states", () => {
    const bill = createCreditCardBill({
      id: "bill-paid",
      cardId: "card-1",
      cycle: createBillingCycle({ statementMonth: "2027-02", statementDay: 28, dueDay: 5 }),
      amountDue: "40.00",
      payments: [{ id: "p1", paidOn: "2027-03-05", amount: "40.00" }],
    });
    const status = calculateBillStatus(bill, { asOf: "2027-03-06", availableCash: "0.00" });
    expect(status).toMatchObject({ paidAmount: "40.00", remainingAmount: "0.00", paidOff: true, overdue: false, pressure: "NONE" });
  });

  it("detects a cash shortfall before the due date and overdue risk after it", () => {
    const bill = createCreditCardBill({
      id: "bill-risk",
      cardId: "card-1",
      cycle: createBillingCycle({ statementMonth: "2027-03", statementDay: 31, dueDay: 30 }),
      amountDue: "120.00",
    });
    expect(calculateBillStatus(bill, { asOf: "2027-04-15", availableCash: "100.00" }).pressure).toBe("SHORTFALL");
    expect(calculateBillStatus(bill, { asOf: "2027-05-01", availableCash: "200.00" })).toMatchObject({ pressure: "OVERDUE", overdue: true });
  });

  it("handles cross-year statement and due dates", () => {
    const cycle = createBillingCycle({ statementMonth: "2027-12", statementDay: 31, dueDay: 1 });
    expect(cycle.periodStart).toBe("2027-12-01");
    expect(cycle.dueDate).toBe("2028-01-01");
  });

  it("rejects invalid dates, amounts, payment overage, and cash overpayment", () => {
    expect(() => createBillingCycle({ statementMonth: "2027-02", statementDay: 31, dueDay: 5 })).not.toThrow();
    expect(() => createBillingCycle({ statementMonth: "2027-13", statementDay: 10, dueDay: 5 })).toThrow();
    expect(() => createCreditCardBill({ id: "bad", cardId: "c", cycle: createBillingCycle({ statementMonth: "2027-01", statementDay: 10, dueDay: 20 }), amountDue: "0.00" })).toThrow();
    expect(() => createCreditCardBill({ id: "bad-pay", cardId: "c", cycle: createBillingCycle({ statementMonth: "2027-01", statementDay: 10, dueDay: 20 }), amountDue: "10.00", payments: [{ id: "p", paidOn: "2027-01-15", amount: "11.00" }] })).toThrow();
    const bill = createCreditCardBill({ id: "cash", cardId: "c", cycle: createBillingCycle({ statementMonth: "2027-01", statementDay: 10, dueDay: 20 }), amountDue: "10.00" });
    expect(() => projectCashAfterBillPayment("9.99", bill)).toThrow();
  });

  it("rejects malformed payment dates and negative available cash", () => {
    const cycle = createBillingCycle({ statementMonth: "2027-01", statementDay: 10, dueDay: 20 });
    expect(() => createCreditCardBill({ id: "bad-date", cardId: "c", cycle, amountDue: "10.00", payments: [{ id: "p", paidOn: "2027-02-31", amount: "1.00" }] })).toThrow(/calendar date/);
    const bill = createCreditCardBill({ id: "cash", cardId: "c", cycle, amountDue: "10.00" });
    expect(() => calculateBillStatus(bill, { asOf: "2027-01-11", availableCash: "-1.00" })).toThrow();
  });
});
