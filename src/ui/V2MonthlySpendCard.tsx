import { ArrowRight, ReceiptText } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import { V2ProgressBar } from "./V2ProgressBar.js";

/** This month's discretionary spending against the owner's target. */
export function V2MonthlySpendCard({
  home,
  savedExpenseId,
  onOpenDetail,
  onOpenLedger,
  onOpenExpense,
}: {
  home: HomeApplicationState;
  savedExpenseId: string | null;
  onOpenDetail: () => void;
  onOpenLedger: () => void;
  onOpenExpense: () => void;
}) {
  const spent = money(home.currentMonthSpending);
  const targetText = home.desiredMonthlyDiscretionarySpending;
  const target = targetText == null ? null : money(targetText);
  const started = spent.gt(0);
  // biome-ignore lint/complexity/useOptionalChain: null check narrows target for the Decimal comparison
  const overTarget = target != null && target.gt(0) && spent.gt(target);
  const remaining = target == null ? null : target.minus(spent);
  const ratio = target == null || target.lte(0) ? 0 : spent.dividedBy(target).times(100).toNumber();
  const band: "empty" | "normal" | "warn" | "over" | "no-target" =
    target == null
      ? "no-target"
      : !started
        ? "empty"
        : overTarget
          ? "over"
          : ratio >= 80
            ? "warn"
            : "normal";
  const heading =
    band === "no-target"
      ? "先给这个月定个目标"
      : band === "empty"
        ? "这个月还没开始记录"
        : band === "over"
          ? "这个月已经超过目标"
          : band === "warn"
            ? "快到目标了，慢一点也没关系"
            : "这个月的花销还在目标里";
  const note =
    band === "no-target"
      ? "先记起来，之后再设目标。"
      : band === "empty"
        ? "记下一笔，月底会更清楚。"
        : band === "over"
          ? `这个月多花了一点，看看哪一类（超出 ${formatCurrency(remaining?.abs().toFixed(2) ?? "0")}）。`
          : band === "warn"
            ? "快到目标了，慢一点也没关系。"
            : `节奏不错，还可以花 ${formatCurrency(remaining?.toFixed(2) ?? "0")}。`;

  return (
    <section
      className={`v2-card v2-today-snapshot v2-month-card ${overTarget ? "is-over-budget v2-card--over" : ""}`}
      aria-labelledby="v2-month-title"
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">本月消费 · 这个月花得怎样</span>
        <button className="v2-text-button" type="button" onClick={onOpenDetail}>
          消费详情 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2 id="v2-month-title" className="v2-card__title">
        {heading}
      </h2>
      <div className="v2-card__value">
        <MoneyAmount
          value={home.currentMonthSpending}
          size="summary"
          className={savedExpenseId ? "is-expense-value-emphasis" : ""}
        />
        <small>本月已花{target == null ? "" : ` · 目标 ${formatCurrency(targetText)}`}</small>
      </div>
      {band === "no-target" ? (
        <span className="v2-dots" role="img" aria-label="还没有设置目标">
          <span className="v2-dot" />
          <span className="v2-dot" />
          <span className="v2-dot" />
        </span>
      ) : (
        <V2ProgressBar
          value={ratio}
          max={overTarget ? 120 : 100}
          tone={overTarget ? "over" : band === "warn" ? "warn" : "normal"}
          showEnd={started && !overTarget}
          label="本月消费占目标比例"
        />
      )}
      <p className="v2-card__note">{note}</p>
      <div className="v2-card__actions">
        {overTarget ? (
          <span className="v2-badge v2-badge--danger">超出目标</span>
        ) : (
          <span className="v2-card__line">
            {target == null ? "在财务管理里设置目标" : overTarget ? "已超目标" : "还在目标内"}
          </span>
        )}
        <button
          className={`v2-btn ${band === "empty" ? "v2-btn--primary" : "v2-btn--secondary"}`}
          type="button"
          onClick={band === "empty" ? onOpenExpense : onOpenLedger}
        >
          <ReceiptText size={16} aria-hidden="true" />
          {band === "empty" ? "记第一笔" : "查看本月记录"}
        </button>
      </div>
    </section>
  );
}
