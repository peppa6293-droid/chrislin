import { CalendarClock, CheckCircle2, CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import { V2DetailHero } from "./V2DetailHero.js";
import { V2EmptyState } from "./V2EmptyState.js";
import { V2StatusBadge } from "./V2StatusBadge.js";

/** §8.3 repayment: planned (blue) and actually repaid (teal) are never merged. */
export function V2RepaymentDetail({
  home,
  repaidThisMonth,
  repaidByDebt,
  pendingNames,
  children,
}: {
  home: HomeApplicationState;
  repaidThisMonth: number;
  repaidByDebt: Map<string, number>;
  pendingNames: string[];
  children?: ReactNode;
}) {
  const pending = new Set(pendingNames);
  const hasPending = pending.size > 0;
  const planned = hasPending ? null : Number(home.mandatoryDebtService);
  const repaid = repaidThisMonth;
  const done = planned != null && planned > 0 && repaid >= planned;
  const remaining = planned != null ? Math.max(0, planned - repaid) : null;
  const percent = planned != null && planned > 0 ? Math.min(100, (repaid / planned) * 100) : 0;
  const conclusion = hasPending
    ? "本月应还待确认"
    : done
      ? "这月还款完成了"
      : repaid > 0
        ? "还在还款中"
        : "本月还没开始还";

  return (
    <section className="v2-detail-page-body v2-repayment" aria-label="债务还款">
      <V2DetailHero
        question="这个月要还多少？"
        badge={conclusion}
        badgeTone={hasPending ? "neutral" : done ? "success" : "warn"}
        aside={
          <div className="v2-repayment-total">
            <span>总负债</span>
            <MoneyAmount value={hasPending ? null : home.totalDebt} size="list" />
          </div>
        }
      >
        <div className="v2-repayment-hero">
          <p className="v2-repayment-due">
            <span>本月要还</span>
            {hasPending ? (
              <strong>待确认</strong>
            ) : (
              <MoneyAmount
                value={home.mandatoryDebtService}
                size="hero"
                className="v2-repayment-amount"
              />
            )}
          </p>
          {!hasPending && (
            <p className="v2-repayment-line">
              {done
                ? "这月还款完成了"
                : repaid > 0
                  ? `已还 ${formatCurrency(String(repaid))}，还剩 ${formatCurrency(String(remaining ?? 0))}`
                  : `本月还剩 ${formatCurrency(String(remaining ?? 0))}`}
            </p>
          )}
          {hasPending ? (
            <p className="v2-detail-warn" role="status">
              {pendingNames.join("、")} 的本月事实还未全部确认，确认前不显示债务总额和本月应还总额。
            </p>
          ) : (
            <>
              <div
                className="v2-repayment-split"
                role="progressbar"
                aria-label="本月还款进度"
                aria-valuenow={Math.round(percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span className="v2-repayment-split__repaid" style={{ width: `${percent}%` }} />
              </div>
              <div className="v2-repayment-legend">
                <span className="v2-repayment-legend__planned">
                  <CalendarClock size={16} aria-hidden="true" />
                  计划计入 <MoneyAmount value={home.mandatoryDebtService} size="inline" />
                </span>
                <span className="v2-repayment-legend__repaid">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  实际还款 <strong>{formatCurrency(String(repaid))}</strong>
                </span>
              </div>
            </>
          )}
        </div>
      </V2DetailHero>

      {home.debts.length === 0 ? (
        <V2EmptyState
          icon={<CreditCard size={40} />}
          title="目前没有待还记录"
          body="等有需要还的欠款时，这里会一家一家列出来。"
        />
      ) : (
        <div className="v2-repayment-list">
          {home.debts.map((debt) => {
            const debtPending = pending.has(debt.name);
            return (
              <article className="v2-repayment-row" key={debt.id}>
                <div className="v2-repayment-row__head">
                  <h3>{debt.name}</h3>
                  {debtPending ? (
                    <span className="v2-repayment-row__pending">本月余额待确认</span>
                  ) : (
                    <MoneyAmount value={debt.currentBalance} size="list" />
                  )}
                </div>
                {debtPending ? (
                  <V2StatusBadge tone="neutral">本月应还待确认</V2StatusBadge>
                ) : money(debt.countedMonthlyPayment).gt(0) ? (
                  <div className="v2-repayment-row__facts">
                    <span className="v2-repayment-legend__planned">
                      <CalendarClock size={14} aria-hidden="true" />
                      计划计入 <MoneyAmount value={debt.countedMonthlyPayment} size="inline" />
                    </span>
                    <span className="v2-repayment-legend__repaid">
                      <CheckCircle2 size={14} aria-hidden="true" />
                      实际还款{" "}
                      <strong>{formatCurrency(String(repaidByDebt.get(debt.id) ?? 0))}</strong>
                    </span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {children}
    </section>
  );
}
