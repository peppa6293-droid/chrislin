import { Plus } from "lucide-react";
import { useState } from "react";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import brandLogo from "./assets/finance/brand-wallet-sprout.svg";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import { type ExpenseSaveReceipt, ExpenseSheet, RecentExpenses } from "./V2HomeSurface.js";
import { V2ProgressBar } from "./V2ProgressBar.js";

/** M1 home: this month's spending against the model's recommended amount, and the latest records. */
export function M1Home({
  home,
  onRecordExpense,
}: {
  home: HomeApplicationState;
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<ExpenseSaveReceipt>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const spent = money(home.currentMonthSpending);
  const recommended = money(home.recommendedMonthlySpending);
  const above = money(home.amountAboveRecommendation);
  const hasRecommendation = recommended.gt(0);
  const ratio = hasRecommendation ? spent.dividedBy(recommended).times(100).toNumber() : 0;
  const desired = home.desiredMonthlyDiscretionarySpending;

  function openSheet() {
    setError("");
    setBlocked(false);
    setOpen(true);
  }

  async function save(expense: ExpenseSubmission) {
    setBusy(true);
    setError("");
    try {
      const receipt = await onRecordExpense(expense, home.asOfDate);
      if (receipt.status !== "CONFIRMED") {
        setError(receipt.message);
        setBlocked(true);
        return;
      }
      setOpen(false);
      setSavedId(receipt.record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="v2-shell" data-testid="m1-home">
      <header className="v2-topbar">
        <div className="v2-brand">
          <span className="v2-brand-mark" aria-hidden="true">
            <img src={brandLogo} alt="" aria-hidden="true" draggable="false" />
          </span>
          <div>
            <strong>小钱家</strong>
            <span>本地账本</span>
          </div>
        </div>
        <div className="v2-topbar-actions">
          <span className="v2-period">
            {home.asOfDate.slice(0, 4)} 年 {Number(home.asOfDate.slice(5, 7))} 月
          </span>
          <button
            className="button button-secondary v2-top-record"
            type="button"
            onClick={openSheet}
          >
            <Plus size={17} aria-hidden="true" />
            <span>记一笔</span>
          </button>
        </div>
      </header>
      <section className="v2-content">
        <div className="v2-page">
          <section className="v2-card v2-month-card" aria-labelledby="m1-month-title">
            <div className="v2-card__head">
              <span className="v2-card__kicker" id="m1-month-title">
                本月消费
              </span>
            </div>
            <div className="v2-card__value">
              <MoneyAmount value={home.currentMonthSpending} size="summary" />
              <small>
                {hasRecommendation
                  ? `本月已花 · 建议上限 ${formatCurrency(home.recommendedMonthlySpending)}`
                  : "本月已花"}
              </small>
            </div>
            {hasRecommendation && (
              <V2ProgressBar
                value={ratio}
                max={ratio > 100 ? 120 : 100}
                tone={above.gt(0) ? "over" : "normal"}
                label="本月消费占建议上限比例"
              />
            )}
            <div className="v2-card__actions">
              <span className="v2-card__line" data-testid="m1-remaining-line">
                {!hasRecommendation
                  ? "本月建议额度 ¥0.00"
                  : above.gt(0)
                    ? `已超出建议 ${formatCurrency(home.amountAboveRecommendation)}`
                    : `还可花 ${formatCurrency(home.remainingSpendingCapacity)}`}
              </span>
            </div>
            {desired != null && (
              <p className="v2-card__line" data-testid="m1-desired-line">
                你设定的每月期望：{formatCurrency(desired)}
              </p>
            )}
            <p className="v2-card__line" data-testid="m1-scope-note">
              建议额度只按收入、必要支出和安全目标计算，没有计入你没录入的资产和债务。
            </p>
          </section>
          <div className="v2-section-heading v2-recent-heading">
            <div>
              <span className="v2-kicker">最近记录</span>
              <h2>最近三笔</h2>
            </div>
          </div>
          <RecentExpenses
            expenses={home.recentExpenses ?? []}
            onOpenExpense={openSheet}
            savedExpenseId={savedId}
          />
        </div>
      </section>
      {open && (
        <ExpenseSheet
          busy={busy}
          blocked={blocked}
          error={error}
          onClose={() => setOpen(false)}
          onSubmit={save}
        />
      )}
    </main>
  );
}
