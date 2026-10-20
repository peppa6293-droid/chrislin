import { useState } from "react";
import type { V2ExpenseService } from "../application/v2-expense-service.js";
import type { TrendSummary } from "../model/v2-trends.js";
import type { Repositories } from "../persistence/repositories.js";
import { V2Dashboard } from "./v2-dashboard.js";
import { V2QuickEntry } from "./v2-quick-entry.js";
import { TrendPanel } from "./v2-trends.js";
import "./v2-surface.css";

export type V2SurfaceTab = "today" | "record" | "progress" | "mine";

const TABS = [
  { id: "today", label: "今天" },
  { id: "record", label: "记录" },
  { id: "progress", label: "进展" },
  { id: "mine", label: "我的" },
] as const;

const mockDashboardProps = {
  ledger: { income: "0.00", dailyExpense: "0.00", accountCash: "0.00" },
  billStatuses: [],
  savingsPlans: [],
  affordableSavings: [],
  trendSummary: null,
  trendWindow: 1 as const,
  reducedMotion: false,
};

const mockTrendSummary: TrendSummary = {
  daily: [],
  monthly: {},
  categories: [],
  maxIncomeDay: null,
  maxExpenseDay: null,
  averageMonthlyExpense: "0.00",
  copy: "先记录几次，慢慢建立基准。",
};

export function V2Surface({
  expenseService,
  repositories,
  profileId,
}: {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
}) {
  const [tab, setTab] = useState<V2SurfaceTab>("today");
  const [focusSignal, setFocusSignal] = useState(0);

  const openRecord = () => {
    setTab("record");
    setFocusSignal((signal) => signal + 1);
  };

  return (
    <div className="v2-surface" data-testid="v2-surface">
      <nav className="v2-surface-nav" aria-label="主导航">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`v2-surface-nav__tab${tab === id ? " is-active" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="v2-surface-nav__record-btn"
          aria-label="记一笔"
          onClick={openRecord}
        >
          + 记一笔
        </button>
      </nav>

      <main className="v2-surface-content">
        {tab === "today" ? <V2Dashboard {...mockDashboardProps} /> : null}
        {tab === "record" ? (
          <V2QuickEntry
            expenseService={expenseService}
            repositories={repositories}
            profileId={profileId}
            focusSignal={focusSignal}
          />
        ) : null}
        {tab === "progress" ? (
          <TrendPanel summary={mockTrendSummary} window={1} reducedMotion={false} />
        ) : null}
        {tab === "mine" ? <p>导入功能即将开放</p> : null}
      </main>
    </div>
  );
}
