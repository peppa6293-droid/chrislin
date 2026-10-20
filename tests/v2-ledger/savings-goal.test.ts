import { describe, expect, it } from "vitest";
import { createBillingCycle, createCreditCardBill } from "../../src/model/v2-cashflow.js";
import {
  calculateAffordableSavings,
  calculateSavingsPlan,
  createSavingsGoal,
} from "../../src/model/v2-savings-goal.js";

describe("V2 savings goal", () => {
  it("creates a valid goal and normalizes amounts", () => {
    const goal = createSavingsGoal({
      id: "g1",
      name: "旅行基金",
      targetAmount: "1200.00",
      targetDate: "2027-06-15",
      currentSaved: "200.50",
    });
    expect(goal).toMatchObject({
      id: "g1",
      name: "旅行基金",
      targetAmount: "1200.00",
      currentSaved: "200.50",
      targetDate: "2027-06-15",
    });
  });

  it("calculates a normal plan with correct monthly target and explanation", () => {
    const goal = createSavingsGoal({
      id: "g2",
      name: "应急储备",
      targetAmount: "6000.00",
      targetDate: "2027-06-17",
      currentSaved: "1000.00",
    });
    // asOf 2026-10-17 → target 2027-06-17 = 8 months exactly
    const plan = calculateSavingsPlan(goal, "2026-10-17");
    expect(plan.status).toBe("ON_TRACK");
    expect(plan.gap).toBe("5000.00");
    expect(plan.monthsRemaining).toBe(8);
    expect(plan.monthlyTarget).toBe("625.00");
    expect(plan.explanation).toContain("还差 5000.00");
    expect(plan.explanation).toContain("8 个月");
    expect(plan.explanation).toContain("625.00");
  });

  it("recognizes a completed goal", () => {
    const goal = createSavingsGoal({
      id: "g3",
      name: "买耳机",
      targetAmount: "500.00",
      targetDate: "2027-01-01",
      currentSaved: "500.00",
    });
    const plan = calculateSavingsPlan(goal, "2026-12-01");
    expect(plan.status).toBe("COMPLETED");
    expect(plan.gap).toBe("0.00");
    expect(plan.monthlyTarget).toBe("0.00");
    expect(plan.monthsRemaining).toBe(0);
    expect(plan.explanation).toContain("已经存够了");
  });

  it("detects overdue when target date has passed with remaining gap", () => {
    const goal = createSavingsGoal({
      id: "g4",
      name: "旧目标",
      targetAmount: "1000.00",
      targetDate: "2026-09-01",
      currentSaved: "300.00",
    });
    const plan = calculateSavingsPlan(goal, "2026-10-17");
    expect(plan.status).toBe("OVERDUE");
    expect(plan.gap).toBe("700.00");
    expect(plan.explanation).toContain("目标日期已过");
    expect(plan.explanation).toContain("700.00");
  });

  it("handles cross-year month calculation correctly", () => {
    const goal = createSavingsGoal({
      id: "g5",
      name: "跨年目标",
      targetAmount: "2400.00",
      targetDate: "2028-01-15",
      currentSaved: "0.00",
    });
    // 2026-10-17 → 2028-01-15: Oct→Jan = 15 months (day 15 < 17 so -1) → 14 months
    const plan = calculateSavingsPlan(goal, "2026-10-17");
    expect(plan.monthsRemaining).toBe(14);
    expect(plan.gap).toBe("2400.00");
    // 2400 / 14 = 171.428... → 171.43
    expect(plan.monthlyTarget).toBe("171.43");
  });

  it("rejects invalid amounts, dates, empty names, and saved > target", () => {
    expect(() =>
      createSavingsGoal({
        id: "x",
        name: "",
        targetAmount: "100.00",
        targetDate: "2027-01-01",
        currentSaved: "0.00",
      }),
    ).toThrow(/name/);
    expect(() =>
      createSavingsGoal({
        id: "x",
        name: "A",
        targetAmount: "0.00",
        targetDate: "2027-01-01",
        currentSaved: "0.00",
      }),
    ).toThrow(/positive/);
    expect(() =>
      createSavingsGoal({
        id: "x",
        name: "A",
        targetAmount: "-10.00",
        targetDate: "2027-01-01",
        currentSaved: "0.00",
      }),
    ).toThrow(/positive/);
    expect(() =>
      createSavingsGoal({
        id: "x",
        name: "A",
        targetAmount: "100.00",
        targetDate: "2027-13-01",
        currentSaved: "0.00",
      }),
    ).toThrow();
    expect(() =>
      createSavingsGoal({
        id: "x",
        name: "A",
        targetAmount: "100.00",
        targetDate: "2027-01-01",
        currentSaved: "150.00",
      }),
    ).toThrow(/cannot exceed/);
  });

  it("deducts outstanding bills before computing affordable savings via L-04", () => {
    const goal = createSavingsGoal({
      id: "g6",
      name: "安全储备",
      targetAmount: "3000.00",
      targetDate: "2027-04-17",
      currentSaved: "600.00",
    });
    // 6 months remaining, gap = 2400, monthly = 400.00
    const cycle = createBillingCycle({ statementMonth: "2026-10", statementDay: 1, dueDay: 25 });
    const bill = createCreditCardBill({
      id: "bill-1",
      cardId: "card-1",
      cycle,
      amountDue: "500.00",
      payments: [{ id: "p1", paidOn: "2026-10-20", amount: "200.00" }],
    });
    // availableCash = 600, outstanding = 300, safeToSave = 300
    // monthlyTarget = 400, so cannot afford
    const result = calculateAffordableSavings(goal, {
      availableCash: "600.00",
      asOf: "2026-10-17",
      bills: [bill],
    });
    expect(result.outstandingBills).toBe("300.00");
    expect(result.safeToSave).toBe("300.00");
    expect(result.monthlyTarget).toBe("400.00");
    expect(result.canAfford).toBe(false);
    expect(result.explanation).toContain("300.00");
    expect(result.explanation).toContain("400.00");
  });

  it("confirms affordability when cash covers both bills and monthly target", () => {
    const goal = createSavingsGoal({
      id: "g7",
      name: "旅游基金",
      targetAmount: "1200.00",
      targetDate: "2027-04-17",
      currentSaved: "0.00",
    });
    // 6 months, gap 1200, monthly = 200
    const result = calculateAffordableSavings(goal, {
      availableCash: "1000.00",
      asOf: "2026-10-17",
      bills: [],
    });
    expect(result.outstandingBills).toBe("0.00");
    expect(result.safeToSave).toBe("1000.00");
    expect(result.monthlyTarget).toBe("200.00");
    expect(result.canAfford).toBe(true);
    expect(result.explanation).toContain("可以放心按计划存钱");
  });

  it("handles zero available cash with outstanding bills gracefully", () => {
    const goal = createSavingsGoal({
      id: "g8",
      name: "备用金",
      targetAmount: "500.00",
      targetDate: "2027-06-01",
      currentSaved: "0.00",
    });
    const cycle = createBillingCycle({ statementMonth: "2026-10", statementDay: 1, dueDay: 25 });
    const bill = createCreditCardBill({
      id: "b2",
      cardId: "c2",
      cycle,
      amountDue: "800.00",
    });
    const result = calculateAffordableSavings(goal, {
      availableCash: "500.00",
      asOf: "2026-10-17",
      bills: [bill],
    });
    // outstanding = 800, cash = 500, safe = max(0, 500-800) = 0
    expect(result.safeToSave).toBe("0.00");
    expect(result.canAfford).toBe(false);
    expect(result.explanation).toContain("先确保还清账单再存钱会更安心");
  });
});
