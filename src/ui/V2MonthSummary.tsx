import { Sprout } from "lucide-react";
import { useState } from "react";
import type { LedgerExpenseRow } from "../application/ux-ledger-service.js";
import { money } from "../model/money.js";
import { formatCurrency } from "./money-format.js";
import { useReducedMotion } from "./use-reduced-motion.js";
import { V2EmptyState } from "./V2EmptyState.js";

export type MonthSummaryData = {
  recordedDays: number;
  total: string;
  topCategory: string | null;
  topCategoryCount: number;
  maxDay: string | null;
  maxDayAmount: string | null;
  withinTarget: boolean | null;
};

export function summarizeMonth(
  rows: LedgerExpenseRow[],
  targetText: string | null,
): MonthSummaryData | null {
  if (rows.length === 0) return null;
  const days = new Set<string>();
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, ReturnType<typeof money>>();
  let total = money(0);
  for (const row of rows) {
    days.add(row.businessDate);
    const amount = money(row.amount);
    total = total.plus(amount);
    byCategory.set(row.categoryName, (byCategory.get(row.categoryName) ?? 0) + 1);
    byDay.set(row.businessDate, (byDay.get(row.businessDate) ?? money(0)).plus(amount));
  }
  let topCategory: string | null = null;
  let topCategoryCount = 0;
  for (const [name, count] of byCategory) {
    if (count > topCategoryCount) {
      topCategory = name;
      topCategoryCount = count;
    }
  }
  let maxDay: string | null = null;
  let maxDayAmount: string | null = null;
  for (const [day, amount] of byDay) {
    if (maxDayAmount == null || amount.gt(money(maxDayAmount))) {
      maxDay = day;
      maxDayAmount = amount.toString();
    }
  }
  return {
    recordedDays: days.size,
    total: total.toString(),
    topCategory,
    topCategoryCount,
    maxDay,
    maxDayAmount,
    withinTarget: targetText == null ? null : total.lte(money(targetText)),
  };
}

export function V2MonthSummary({
  month,
  summary,
  onClose,
  onRecord,
}: {
  month: string;
  summary: MonthSummaryData | null;
  onClose: () => void;
  onRecord: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [page, setPage] = useState(0);
  const last = 2;

  return (
    <section
      className={`v2-month-summary ${reducedMotion ? "is-reduced-motion" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${month} 月度小结`}
    >
      <div className="v2-month-summary__sheet">
        <span className="v2-card__kicker">{month} · 月度小结</span>
        {summary == null ? (
          <V2EmptyState
            icon={<Sprout size={40} />}
            title="这个月还没有足够记录"
            body="先记上几笔，小结才会慢慢有意义。"
            action={
              <button className="v2-btn v2-btn--primary" type="button" onClick={onRecord}>
                去记一笔
              </button>
            }
          />
        ) : (
          <div className="v2-month-summary__page" key={page}>
            {page === 0 && (
              <>
                <span className="v2-month-summary__illustration" aria-hidden="true">
                  <Sprout size={72} />
                </span>
                <h2>这个月，你把钱照顾得怎么样？</h2>
                <p className="v2-card__note">
                  记录 {summary.recordedDays} 天，一共记下 {formatCurrency(summary.total)}。
                </p>
              </>
            )}
            {page === 1 && (
              <>
                <div className="v2-summary-figure">
                  <strong>{summary.recordedDays}</strong>
                  <span>天有记录</span>
                </div>
                <p className="v2-card__note">
                  {summary.topCategory
                    ? `最常记的是「${summary.topCategory}」，共 ${summary.topCategoryCount} 笔。`
                    : "还没有足够记录看清类别。"}
                </p>
                <p className="v2-card__note">
                  {summary.maxDay
                    ? `花得最多的一天是 ${summary.maxDay}，共 ${formatCurrency(summary.maxDayAmount ?? "0")}。`
                    : ""}
                </p>
              </>
            )}
            {page === 2 && (
              <>
                <h2>
                  {summary.withinTarget === null
                    ? "先记起来，下个月会更有数"
                    : summary.withinTarget
                      ? "本月消费在目标内"
                      : "这个月多花了一点"}
                </h2>
                <p className="v2-card__note">
                  {summary.withinTarget === null
                    ? "还没有设定本月目标，记录本身就是第一步。"
                    : summary.withinTarget
                      ? "节奏还在你手里，下个月可以提前留出还款的钱。"
                      : "看看哪一类花得最多，下个月先照顾那一边。"}
                </p>
                <button className="v2-btn v2-btn--secondary" type="button" onClick={onRecord}>
                  去记一笔
                </button>
              </>
            )}
          </div>
        )}
        <div className="v2-month-summary__actions">
          <button
            className="v2-btn v2-btn--secondary"
            type="button"
            disabled={page === 0 || summary == null}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            上一张
          </button>
          {page < last && summary != null ? (
            <button
              className="v2-btn v2-btn--primary"
              type="button"
              onClick={() => setPage((current) => Math.min(last, current + 1))}
            >
              下一张
            </button>
          ) : (
            <button className="v2-btn v2-btn--primary" type="button" onClick={onClose}>
              完成
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
