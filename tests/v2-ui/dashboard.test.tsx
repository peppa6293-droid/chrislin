import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BillStatus } from "../../src/model/v2-cashflow.js";
import type { AffordableSavingsResult, SavingsPlan } from "../../src/model/v2-savings-goal.js";
import type { TrendSummary } from "../../src/model/v2-trends.js";
import { V2Dashboard, type V2DashboardProps } from "../../src/ui/v2-dashboard.js";

function makeProps(overrides: Partial<V2DashboardProps> = {}): V2DashboardProps {
  return {
    ledger: {
      income: "5000.00",
      dailyExpense: "2000.00",
      accountCash: "8000.00",
      recurringIncome: "5000.00",
      incomeIncludesOneTime: false,
    },
    billStatuses: [],
    savingsPlans: [],
    affordableSavings: [],
    trendSummary: null,
    trendWindow: 3,
    reducedMotion: false,
    ...overrides,
  };
}

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

describe("V2 Dashboard (isolated candidate)", () => {
  it("renders the main structure with required section names", () => {
    const html = renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()));
    expect(html).toContain("收入");
    expect(html).toContain("日常支出");
    expect(html).toContain("账户现金");
    expect(html).toContain("资产");
    expect(html).toContain("债务");
    expect(html).toContain("安全储备");
    expect(html).toContain("资产更新");
    expect(html).toContain("债务确认");
    expect(html).toContain('data-testid="v2-dashboard"');
    expect(html).toContain('aria-label="个人财务综合面板"');
  });

  it("renders ledger amounts without NaN or Infinity", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        V2Dashboard,
        makeProps({
          ledger: {
            income: "99999999.99",
            dailyExpense: "0.00",
            accountCash: "12345678.00",
            recurringIncome: "99999999.99",
            incomeIncludesOneTime: false,
          },
        }),
      ),
    );
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).toContain("¥99,999,999.99");
    expect(html).toContain("0.00");
  });

  it("shows empty state when no bills and no goals exist", () => {
    const html = renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()));
    expect(html).toContain("当前没有待还账单。");
    expect(html).toContain("还没有设定储蓄目标。");
    expect(html).toContain("暂无趋势数据。");
  });

  it("renders bill statuses with pressure badges and explanations", () => {
    const bills: BillStatus[] = [
      {
        billId: "b1",
        amountDue: "1000.00",
        paidAmount: "300.00",
        remainingAmount: "700.00",
        paidOff: false,
        overdue: false,
        pressure: "UPCOMING",
        explanation: "请在到期日前还款。",
      },
      {
        billId: "b2",
        amountDue: "500.00",
        paidAmount: "500.00",
        remainingAmount: "0.00",
        paidOff: true,
        overdue: false,
        pressure: "NONE",
        explanation: "这笔账单已经还清。",
      },
      {
        billId: "b3",
        amountDue: "2000.00",
        paidAmount: "0.00",
        remainingAmount: "2000.00",
        paidOff: false,
        overdue: true,
        pressure: "OVERDUE",
        explanation: "已逾期，请尽快处理。",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(V2Dashboard, makeProps({ billStatuses: bills })),
    );
    expect(html).toContain('data-testid="v2-bill-item"');
    expect(html).toContain("待还款");
    expect(html).toContain("已还清");
    expect(html).toContain("已逾期");
    expect(html).toContain("请在到期日前还款。");
    expect(html).toContain("¥700.00");
  });

  it("renders savings plans with status and affordable info", () => {
    const plans: SavingsPlan[] = [
      {
        goalId: "g1",
        goalName: "旅行基金",
        targetAmount: "10000.00",
        currentSaved: "3000.00",
        gap: "7000.00",
        monthsRemaining: 5,
        monthlyTarget: "1400.00",
        status: "ON_TRACK",
        explanation: "正常推进中。",
      },
      {
        goalId: "g2",
        goalName: "应急金",
        targetAmount: "5000.00",
        currentSaved: "5000.00",
        gap: "0.00",
        monthsRemaining: 0,
        monthlyTarget: "0.00",
        status: "COMPLETED",
        explanation: "已完成。",
      },
    ];
    const affordable: AffordableSavingsResult[] = [
      {
        goalId: "g1",
        goalName: "旅行基金",
        monthlyTarget: "1400.00",
        affordableAmount: "1500.00",
        canAfford: true,
        outstandingBills: "700.00",
        safeToSave: "1500.00",
        explanation: "可以按计划存钱。",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(
        V2Dashboard,
        makeProps({ savingsPlans: plans, affordableSavings: affordable }),
      ),
    );
    expect(html).toContain('data-testid="v2-savings-item"');
    expect(html).toContain("正常推进");
    expect(html).toContain("已完成");
    expect(html).toContain('data-testid="v2-affordable-info"');
    expect(html).toContain("¥1,500.00");
    expect(html).toContain("可以按计划存钱。");
  });

  it("handles shortfall and overdue savings states", () => {
    const plans: SavingsPlan[] = [
      {
        goalId: "g3",
        goalName: "买房首付",
        targetAmount: "500000.00",
        currentSaved: "10000.00",
        gap: "490000.00",
        monthsRemaining: 0,
        monthlyTarget: "490000.00",
        status: "SHORTFALL",
        explanation: "缺口不足一个月。",
      },
      {
        goalId: "g4",
        goalName: "旧目标",
        targetAmount: "1000.00",
        currentSaved: "200.00",
        gap: "800.00",
        monthsRemaining: 0,
        monthlyTarget: "800.00",
        status: "OVERDUE",
        explanation: "日期已过。",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(V2Dashboard, makeProps({ savingsPlans: plans })),
    );
    expect(html).toContain("缺口不足");
    expect(html).toContain("已逾期");
  });

  it("integrates U-04 TrendPanel when summary is provided", () => {
    const summary: TrendSummary = {
      daily: [{ date: "2027-01-01", income: "100.00", expense: "50.00" }],
      monthly: { "2027-01": { income: "100.00", expense: "50.00" } },
      maxIncomeDay: "2027-01-01",
      maxExpenseDay: "2027-01-01",
      copy: "本月收支平稳。",
    };
    const html = renderToStaticMarkup(
      React.createElement(V2Dashboard, makeProps({ trendSummary: summary, trendWindow: 1 })),
    );
    expect(html).toContain('data-testid="v2-trend-panel"');
    expect(html).toContain("1个月收支变化");
    expect(html).toContain("本月收支平稳。");
  });

  it("applies reduced-motion class when flag is set", () => {
    const html = renderToStaticMarkup(
      React.createElement(V2Dashboard, makeProps({ reducedMotion: true })),
    );
    expect(html).toContain("v2-dashboard--reduced");
  });

  it("does not double-count credit-card spending as daily expense in UI labels", () => {
    const html = renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()));
    // The component displays ledger.dailyExpense directly; it does not add bill payments to it.
    // Verify the label says 日常支出 and there is no duplicate counting text.
    expect(html).toContain("日常支出");
    expect(html).not.toContain("重复计入");
  });

  it("handles zero-value ledger gracefully", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        V2Dashboard,
        makeProps({
          ledger: {
            income: "0.00",
            dailyExpense: "0.00",
            accountCash: "0.00",
            recurringIncome: "0.00",
            incomeIncludesOneTime: false,
          },
        }),
      ),
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("0.00");
  });

  it("renders dimension-colored icons for all six overview cards", () => {
    const html = renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()));
    expect(countMatches(html, /v2-dashboard__icon--coral/g)).toBe(2);
    expect(countMatches(html, /v2-dashboard__icon--yellow/g)).toBe(1);
    expect(countMatches(html, /v2-dashboard__icon--lavender/g)).toBe(2);
    expect(countMatches(html, /v2-dashboard__icon--blue/g)).toBe(1);
    expect(countMatches(html, /<svg/g)).toBe(6);
  });

  it("shows the one-time income badge only when one-time income is included", () => {
    const withOneTime = renderToStaticMarkup(
      React.createElement(
        V2Dashboard,
        makeProps({
          ledger: {
            income: "13791.25",
            dailyExpense: "0.00",
            accountCash: "5325.93",
            recurringIncome: "12791.25",
            incomeIncludesOneTime: true,
          },
        }),
      ),
    );
    expect(withOneTime).toContain('data-testid="income-one-time-badge"');
    expect(withOneTime).toContain("含一次性收入");

    const withoutOneTime = renderToStaticMarkup(
      React.createElement(
        V2Dashboard,
        makeProps({
          ledger: {
            income: "12791.25",
            dailyExpense: "0.00",
            accountCash: "5325.93",
            recurringIncome: "12791.25",
            incomeIncludesOneTime: false,
          },
        }),
      ),
    );
    expect(withoutOneTime).not.toContain("含一次性收入");
  });

  it("marks the six overview icons as decorative", () => {
    const html = renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()));
    expect(countMatches(html, /class="v2-dashboard__icon /g)).toBe(6);
    expect(countMatches(html, /aria-hidden="true"/g)).toBeGreaterThanOrEqual(6);
    expect(
      countMatches(
        html,
        /<span class="v2-dashboard__icon v2-dashboard__icon--(?:coral|blue|yellow|lavender)" aria-hidden="true">/g,
      ),
    ).toBe(6);
  });
});
