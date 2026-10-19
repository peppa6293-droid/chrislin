import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { aggregateTrends } from "../../src/model/v2-trends.js";
import { TrendPanel, trendWindowMonths } from "../../src/ui/v2-trends.js";

describe("isolated V2 trend aggregation and render contract", () => {
  const rows = [
    { date: "2026-08-01", month: "2026-08", category: "餐饮", income: "0.00", expense: "10.00" },
    { date: "2026-09-01", month: "2026-09", category: "交通", income: "0.00", expense: "20.00" },
    { date: "2026-10-01", month: "2026-10", category: "餐饮", income: "100.00", expense: "30.00" },
    { date: "2026-11-03", month: "2026-11", category: "餐饮", income: "0.00", expense: "50.00" },
    { date: "2026-12-03", month: "2026-12", category: "餐饮", income: "0.00", expense: "60.00" },
    { date: "2027-01-03", month: "2027-01", category: "餐饮", income: "0.00", expense: "70.00" },
  ];

  it("aggregates daily/monthly/category data and identifies maxima", () => {
    const result = aggregateTrends(rows, ["2026-10", "2026-11"]);
    expect(result.monthly["2026-10"]).toEqual({ income: "100.00", expense: "30.00" });
    expect(result.categories.find((item) => item.category === "餐饮")?.months).toEqual({ "2026-10": "30.00", "2026-11": "50.00" });
    expect(result.maxIncomeDay).toBe("2026-10-01");
    expect(result.maxExpenseDay).toBe("2027-01-03");
    expect(result.averageMonthlyExpense).toBe("40.00");
    expect(result.copy).toContain("多了约 20.00 元");
  });

  it("defines explicit 1/3/6-month window contracts", () => {
    const months = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
    expect(trendWindowMonths(1, months)).toEqual(["2027-01"]);
    expect(trendWindowMonths(3, months)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(trendWindowMonths(6, months)).toEqual(months);
    for (const window of [1, 3, 6] as const) {
      const summary = aggregateTrends(rows, trendWindowMonths(window, months));
      expect(Object.keys(summary.monthly)).toHaveLength(window);
      const markup = renderToStaticMarkup(<TrendPanel summary={summary} window={window} reducedMotion />);
      expect(markup).toContain(`data-trend-window="${window}"`);
      expect(markup).toContain('data-motion="reduced"');
      expect(markup).toContain("role=\"img\"");
      expect(markup).toContain("aria-label=\"");
    }
  });

  it("supports empty, zero, and very large values in the rendering layer", () => {
    const empty = aggregateTrends([], ["2026-10"]);
    const emptyMarkup = renderToStaticMarkup(<TrendPanel summary={empty} window={1} reducedMotion />);
    expect(emptyMarkup).toContain("还没有可展示的收支记录");
    const result = aggregateTrends([{ date: "2026-10-01", month: "2026-10", category: "其他", income: "999999999999.99", expense: "0.00" }], ["2026-10"]);
    const markup = renderToStaticMarkup(<TrendPanel summary={result} window={1} />);
    expect(markup).toContain("999999999999.99");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });
});
