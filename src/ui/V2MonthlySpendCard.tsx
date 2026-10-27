import { ArrowRight, ReceiptText } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { CARD_DISABLED_TITLE, type CardStatus } from "./card-status.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import { V2ProgressBar } from "./V2ProgressBar.js";
import { pickDailyLine } from "./v2-month-copy.js";

const KICKER = "本月消费";
const PROGRESS_LABEL = `${KICKER}占目标比例`;
const FUTURE_RECORD_TITLE = "本月还没有已发生的消费。";

const SPEND_BANDS = {
  LOW: "支付软件：你是不是把我卸了？",
  SAFE: "钱包：目前还没申请工伤。",
  WATCH: "预算：我感觉有人在试探我的底线。",
  EDGE: "预算：现在撤回付款还来得及吗？",
  OVER: "预算：我先走一步，剩下你俩聊。",
} as const;

type SpendBand = keyof typeof SPEND_BANDS;

/** This month's discretionary spending against the owner's target. */
export function V2MonthlySpendCard({
  home,
  savedExpenseId,
  onOpenDetail,
  onOpenLedger,
  onOpenExpense,
  status = "ready",
}: {
  home: HomeApplicationState;
  savedExpenseId: string | null;
  onOpenDetail: () => void;
  onOpenLedger: () => void;
  onOpenExpense: () => void;
  status?: CardStatus;
}) {
  const spent = money(home.currentMonthSpending);
  const targetText = home.desiredMonthlyDiscretionarySpending;
  const hasTarget = targetText != null && money(targetText).gt(0);
  const count = home.currentMonthVariableExpenseCount;

  const ratio = hasTarget && targetText != null ? spent.dividedBy(money(targetText)) : null;
  const remaining = hasTarget && targetText != null ? money(targetText).minus(spent) : null;

  const band: SpendBand | null =
    ratio == null || !spent.gt(0)
      ? null
      : ratio.lt("0.4")
        ? "LOW"
        : ratio.lt("0.7")
          ? "SAFE"
          : ratio.lt("0.9")
            ? "WATCH"
            : ratio.lte(1)
              ? "EDGE"
              : "OVER";

  const state: "unknown" | "empty" | "future" | "band" | "no-target" = !Number.isFinite(count)
    ? "unknown"
    : count === 0 && spent.eq(0)
      ? "empty"
      : spent.eq(0)
        ? "future"
        : band != null
          ? "band"
          : "no-target";

  const title =
    state === "empty"
      ? pickDailyLine(home.asOfDate)
      : state === "future"
        ? FUTURE_RECORD_TITLE
        : band != null
          ? SPEND_BANDS[band]
          : "";

  const loading = status === "loading";
  const disabled = status === "disabled";
  const titleText = disabled ? CARD_DISABLED_TITLE : title;

  const line =
    band === "OVER" && remaining != null
      ? `已超出 ${formatCurrency(remaining.abs().toFixed(2))}`
      : band != null && remaining != null
        ? `剩余 ${formatCurrency(remaining.toFixed(2))}`
        : state === "future" && remaining != null
          ? `剩余 ${formatCurrency(remaining.toFixed(2))}`
          : state === "no-target"
            ? "目标 —"
            : null;

  return (
    <section
      className={[
        "v2-card",
        "v2-today-snapshot",
        "v2-month-card",
        band === "OVER" ? "is-over-budget v2-card--over" : "",
        disabled ? "v2-card--disabled is-disabled" : "",
        loading ? "is-loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby="v2-month-title"
      aria-busy={loading || undefined}
      inert={loading}
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">{KICKER}</span>
        <button className="v2-text-button" type="button" onClick={onOpenDetail}>
          消费详情 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2
        id="v2-month-title"
        className="v2-card__title"
        aria-label={titleText ? undefined : KICKER}
      >
        {titleText}
      </h2>
      {state !== "empty" && (
        <div className="v2-card__value">
          <MoneyAmount
            value={home.currentMonthSpending}
            size="summary"
            className={savedExpenseId ? "is-expense-value-emphasis" : ""}
          />
          <small>
            {hasTarget && targetText != null
              ? `本月已花 · 目标 ${formatCurrency(targetText)}`
              : "本月已花"}
          </small>
        </div>
      )}
      {state === "empty" ? (
        <div className="v2-month-empty">
          <ReceiptText size={40} aria-hidden="true" />
          <span className="v2-month-empty__bar" aria-hidden="true" />
        </div>
      ) : state === "future" && hasTarget ? (
        <V2ProgressBar value={0} max={100} tone="normal" label={PROGRESS_LABEL} />
      ) : state === "band" && ratio != null ? (
        <V2ProgressBar
          value={ratio.times(100).toNumber()}
          max={band === "OVER" ? 120 : 100}
          tone={band === "OVER" ? "over" : band === "EDGE" ? "warn" : "normal"}
          showEnd={band !== "OVER"}
          label={PROGRESS_LABEL}
        />
      ) : null}
      <div className="v2-card__actions">
        {line != null && <span className="v2-card__line">{line}</span>}
        <button
          className={`v2-btn ${state === "empty" ? "v2-btn--primary" : "v2-btn--secondary"}`}
          type="button"
          onClick={state === "empty" ? onOpenExpense : onOpenLedger}
        >
          <ReceiptText size={16} aria-hidden="true" />
          {state === "empty" ? "记第一笔" : "查看本月记录"}
        </button>
      </div>
      {loading && (
        <div className="v2-card__skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </section>
  );
}
