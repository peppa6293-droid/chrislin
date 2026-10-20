import type { TrendSummary } from "../model/v2-trends.js";

export type TrendWindow = 1 | 3 | 6;

export interface TrendPanelProps {
  summary: TrendSummary;
  window: TrendWindow;
  reducedMotion?: boolean;
}

export function trendWindowMonths(window: TrendWindow, availableMonths: string[]): string[] {
  return availableMonths.slice(-window);
}

export function TrendPanel({ summary, window, reducedMotion = false }: TrendPanelProps) {
  const months = Object.keys(summary.monthly).slice(-window);
  const status = summary.daily.length === 0 ? "empty" : "ready";
  return (
    <section
      aria-label={`${window}个月收支趋势`}
      data-testid="v2-trend-panel"
      data-trend-window={window}
      data-motion={reducedMotion ? "reduced" : "full"}
      data-status={status}
      className={reducedMotion ? "v2-trend-panel v2-trend-panel--reduced" : "v2-trend-panel"}
    >
      <header className="v2-trend-panel__header">
        <div>
          <p className="v2-trend-panel__eyebrow">收支趋势</p>
          <h2>{window}个月收支变化</h2>
        </div>
        <span role="note" aria-label="图表数据来源">
          隔离账本
        </span>
      </header>
      {status === "empty" ? (
        <p role="status" className="v2-trend-panel__empty">
          还没有可展示的收支记录。
        </p>
      ) : (
        <>
          <div
            className="v2-trend-panel__chart"
            role="img"
            aria-label={`${window}个月收入支出趋势图`}
            // No additional aria props required.
          >
            {months.map((month) => {
              const value = summary.monthly[month] ?? { income: "0.00", expense: "0.00" };
              return (
                <div
                  className="v2-trend-bar"
                  data-testid="v2-trend-bar"
                  data-month={month}
                  key={month}
                >
                  <span
                    className="v2-trend-bar__income"
                    role="img"
                    style={{ height: "24px" }}
                    aria-label={`${month}收入 ${value.income} 元`}
                  />
                  <span
                    className="v2-trend-bar__expense"
                    role="img"
                    style={{ height: "24px" }}
                    aria-label={`${month}支出 ${value.expense} 元`}
                  />
                  <small>{month.slice(5)}</small>
                </div>
              );
            })}
          </div>
          <p role="status" className="v2-trend-panel__copy">
            {summary.copy}
          </p>
        </>
      )}
    </section>
  );
}
