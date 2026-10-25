import { ArrowRight, WalletCards } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import { V2ProgressBar } from "./V2ProgressBar.js";

const structureCopy: Record<HomeApplicationState["spendingStatus"], string> = {
  NORMAL: "长期看，每个月能留下一点",
  STRUCTURAL_DEFICIT: "长期看，每个月有个缺口",
  BALANCED_NO_SURPLUS: "长期看，每个月刚好打平",
};

/** Long-term structure: income minus fixed expenses and debt service. */
export function V2StructureCard({
  home,
  pendingDebtFactNames,
  onOpenFixedExpenses,
  onOpenDebt,
  onOpenCashflow,
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  onOpenFixedExpenses: () => void;
  onOpenDebt: () => void;
  onOpenCashflow: () => void;
}) {
  const income = money(home.planningIncome);
  const missingData = income.lte(0);
  const deficit = home.spendingStatus === "STRUCTURAL_DEFICIT";
  const surplus = money(home.baseSurplus);
  const percent = missingData
    ? 0
    : Math.min(100, Math.max(0, surplus.dividedBy(income).times(100).toNumber()));
  const debtDisplay =
    pendingDebtFactNames.length > 0 ? "待确认" : formatCurrency(home.mandatoryDebtService);
  const tone = surplus.lt(0) ? "is-short" : surplus.eq(0) ? "is-even" : "is-steady";

  return (
    <section
      className={`v2-card v2-card--soft v2-today-snapshot v2-structure-card ${tone} ${
        deficit ? "v2-card--over" : ""
      }`}
      aria-labelledby="v2-structure-title"
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">结构卡 · 长期格局</span>
        <button className="v2-text-button" type="button" onClick={onOpenCashflow}>
          为什么 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2 id="v2-structure-title" className="v2-card__title">
        {missingData ? "长期结构还看不全" : structureCopy[home.spendingStatus]}
      </h2>
      <div className="v2-card__value v2-structure-value">
        {missingData ? (
          <span role="img" aria-label="暂时没有结构余量">
            —
          </span>
        ) : (
          <MoneyAmount value={home.baseSurplus} size="summary" />
        )}
        <small>结构余量 · 收入 − 固定支出 − 月供</small>
      </div>
      <p className="v2-card__note">
        {missingData ? "把收入和固定支出补齐，就能看清长期格局。" : "长期格局，不用每月盯。"}
      </p>
      {missingData ? (
        <span className="v2-dots" aria-hidden="true">
          <span className="v2-dot" />
          <span className="v2-dot" />
          <span className="v2-dot" />
        </span>
      ) : (
        <V2ProgressBar
          value={percent}
          tone={deficit ? "over" : "normal"}
          showEnd
          label="结构余量占收入比例"
        />
      )}
      <div className="v2-structure-dots" aria-hidden="true">
        <span className={`v2-dot ${tone === "is-steady" ? "is-on" : ""}`} />
        <span className={`v2-dot ${tone === "is-steady" ? "is-on" : ""}`} />
        <span
          className={`v2-dot ${tone === "is-short" ? "is-over" : tone === "is-even" ? "is-warn" : "is-on"}`}
        />
      </div>
      <p className="v2-card__line">
        收入 {formatCurrency(home.planningIncome)} · 固定支出{" "}
        {formatCurrency(home.essentialExpenses)} · 月供 {debtDisplay}
      </p>
      <div className="v2-card__actions">
        <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenFixedExpenses}>
          <WalletCards size={16} aria-hidden="true" />
          查看固定支出
        </button>
        {deficit && (
          <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenDebt}>
            查看债务
          </button>
        )}
      </div>
    </section>
  );
}
