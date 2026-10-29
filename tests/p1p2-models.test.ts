import { describe, expect, it } from "vitest";
import {
  categoryProgress,
  hasUnownedPayments,
  itemStatusLine,
  monthPaidSummary,
  paidByItem,
  paymentProgress,
} from "../src/ui/fixed-expenses-model.js";
import { ringDatum, structureRings } from "../src/ui/structure-ring.js";

const item = (id: string, category: string, monthlyAmount: string) => ({
  id,
  name: id,
  category,
  monthlyAmount,
});

describe("P1-a ring model", () => {
  it("draws both rings from income and prints one-decimal shares", () => {
    const rings = structureRings({
      income: "13000",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
      pendingDebt: false,
    });
    expect(rings.outer.percent).toBe("27.1%");
    expect(rings.inner.percent).toBe("6.2%");
    expect(rings.outer.capped).toBeCloseTo(3528 / 13000, 10);
    expect(rings.outer.overAmount).toBeNull();
    expect(rings.inner.overAmount).toBeNull();
  });

  it("keeps each ring on its own numerator (no double counting)", () => {
    const rings = structureRings({
      income: "10000",
      essentialExpenses: "7000",
      mandatoryDebtService: "4000",
      pendingDebt: false,
    });
    expect(rings.outer.percent).toBe("70%");
    expect(rings.inner.percent).toBe("40%");
    expect(rings.outer.capped).toBeCloseTo(0.7, 10);
    expect(rings.inner.capped).toBeCloseTo(0.4, 10);
  });

  it("reports a single ring over income while capping only the arc", () => {
    const rings = structureRings({
      income: "13000",
      essentialExpenses: "15600",
      mandatoryDebtService: "2600",
      pendingDebt: false,
    });
    expect(rings.outer.percent).toBe("120%");
    expect(rings.outer.capped).toBe(1);
    expect(rings.outer.overAmount).toBe("2600");
    expect(rings.inner.capped).toBeCloseTo(0.2, 10);
  });

  it("keeps full values above 200% and still caps the arc at one turn", () => {
    const rings = structureRings({
      income: "10000",
      essentialExpenses: "23000",
      mandatoryDebtService: "1000",
      pendingDebt: false,
    });
    expect(rings.outer.percent).toBe("230%");
    expect(rings.outer.capped).toBe(1);
    expect(rings.outer.overAmount).toBe("13000");
  });

  it("draws no arc without a positive income", () => {
    for (const income of ["0", "-100"]) {
      const rings = structureRings({
        income,
        essentialExpenses: "2500",
        mandatoryDebtService: "1000",
        pendingDebt: false,
      });
      expect(rings.outer.available).toBe(false);
      expect(rings.outer.percent).toBeNull();
      expect(rings.inner.available).toBe(false);
    }
  });

  it("keeps the confirmed outer ring and drops the pending inner ring", () => {
    const rings = structureRings({
      income: "13000",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
      pendingDebt: true,
    });
    expect(rings.outer.percent).toBe("27.1%");
    expect(rings.inner.available).toBe(false);
    expect(rings.inner.percent).toBeNull();
  });

  it("rounds with decimal arithmetic, not floats", () => {
    expect(ringDatum("3", "1").percent).toBe("33.3%");
    expect(ringDatum("0.3", "0.1").percent).toBe("33.3%");
    expect(ringDatum("1000", "1000").percent).toBe("100%");
  });
});

describe("P2 payment progress (B-03 five states)", () => {
  it("plan minus paid greater than zero shows 未付 without a ratio", () => {
    const progress = paymentProgress("1000", "0");
    expect(progress.state).toBe("UNPAID");
    expect(progress.primary).toBe("未付");
    expect(progress.percent).toBeNull();
    expect(progress.progress).toBe(0);
  });

  it("a partial payment shows both amounts and the 已付/计划 share", () => {
    const progress = paymentProgress("1000", "800");
    expect(progress.state).toBe("PARTIAL");
    expect(progress.primary).toBe("已付 ¥800.00 / 计划 ¥1,000.00");
    expect(progress.secondary).toBe("已付/计划 80%");
    expect(progress.progress).toBeCloseTo(0.8, 10);
  });

  it("a full payment stays at 100% without an overage line", () => {
    const progress = paymentProgress("1000", "1000");
    expect(progress.state).toBe("PAID");
    expect(progress.primary).toBe("已付 ¥1,000.00 / 计划 ¥1,000.00");
    expect(progress.secondary).toBe("已付/计划 100%");
  });

  it("an over-payment keeps full numbers and prints the overage line", () => {
    const progress = paymentProgress("1000", "1200");
    expect(progress.state).toBe("OVERPAID");
    expect(progress.primary).toBe("已付 ¥1,200.00 / 计划 ¥1,000.00");
    expect(progress.secondary).toBe("超计划 ¥200.00 · 已付/计划 120%");
    expect(progress.progress).toBe(1);
  });

  it("zero plan and zero paid never prints 0/0 or 0%", () => {
    const progress = paymentProgress("0", "0");
    expect(progress.state).toBe("NO_PLAN_NO_PAY");
    expect(progress.primary).toBe("");
    expect(progress.secondary).toBe("");
    expect(progress.percent).toBeNull();
  });

  it("zero plan with a payment prints the frozen single line without a ratio", () => {
    const progress = paymentProgress("0", "120");
    expect(progress.state).toBe("ZERO_PLAN_PAID");
    expect(progress.primary).toBe("计划 ¥0 · 已付 ¥120.00 · 超计划 ¥120.00");
    expect(progress.secondary).toBe("");
    expect(progress.percent).toBeNull();
  });

  it("a missing plan is not a zero plan", () => {
    const progress = paymentProgress(null, "120");
    expect(progress.state).toBe("MISSING_PLAN");
    expect(progress.primary).toBe("");
    expect(progress.percent).toBeNull();
  });

  it("never rounds 100% up to 101% through float error", () => {
    const progress = paymentProgress("0.3", "0.3");
    expect(progress.percent).toBe("100%");
    expect(progress.state).toBe("PAID");
  });

  it("per-item lines reuse the frozen tokens", () => {
    expect(itemStatusLine("1000", "0")).toBe("未付");
    expect(itemStatusLine("1000", "800")).toBe("已付 ¥800.00 · 已付/计划 80%");
    expect(itemStatusLine("1000", "1200")).toBe("已付 ¥1,200.00 · 超计划 ¥200.00");
    expect(itemStatusLine("0", "120")).toBe("计划 ¥0 · 已付 ¥120.00 · 超计划 ¥120.00");
    expect(itemStatusLine(null, "120")).toBe("");
  });
});

describe("P2 page summary and category subtotals", () => {
  const items = [
    item("rent", "HOUSING", "1800"),
    item("power", "UTILITIES_COMMUNICATIONS", "228"),
    item("commute", "TRANSPORT", "900"),
    item("food", "BASIC_FOOD", "600"),
  ];

  it("sums the month and reports the paid share", () => {
    const summary = monthPaidSummary(items, [
      { itemId: "rent", amount: "1800" },
      { itemId: "power", amount: "228" },
      { itemId: "commute", amount: "600" },
    ]);
    expect(summary.plan).toBe("3528");
    expect(summary.paid).toBe("2628");
    expect(summary.unpaid).toBe("900");
    expect(summary.percent).toBe("74.5%");
    expect(summary.progress).toBeCloseTo(2628 / 3528, 10);
  });

  it("counts unowned payments in the page total only", () => {
    const payments = [
      { itemId: "rent", amount: "1800" },
      { itemId: "", amount: "200" },
    ];
    expect(hasUnownedPayments(payments)).toBe(true);
    expect(paidByItem(payments).has("")).toBe(false);
    const summary = monthPaidSummary(items, payments);
    expect(summary.paid).toBe("2000");
    const categories = categoryProgress(items, payments);
    expect(categories.find((row) => row.category === "HOUSING")?.paid).toBe("1800");
    expect(categories.reduce((sum, row) => sum + Number(row.paid), 0)).toBe(1800);
  });

  it("groups categories without guessing ownership from the payment category", () => {
    const rows = categoryProgress(items, [
      { itemId: "rent", amount: "1800" },
      { itemId: "commute", amount: "900" },
    ]);
    expect(rows.map((row) => row.category)).toEqual([
      "HOUSING",
      "UTILITIES_COMMUNICATIONS",
      "TRANSPORT",
      "BASIC_FOOD",
    ]);
    const transport = rows.find((row) => row.category === "TRANSPORT");
    expect(transport?.progress.state).toBe("PAID");
    const utilities = rows.find((row) => row.category === "UTILITIES_COMMUNICATIONS");
    expect(utilities?.progress.state).toBe("UNPAID");
  });

  it("shows no ratio when the month has no plan at all", () => {
    const summary = monthPaidSummary([], []);
    expect(summary.percent).toBeNull();
    expect(summary.progress).toBe(0);
  });
});
