import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import brandLogo from "./assets/finance/brand-wallet-sprout.svg";
import { MoneyAmount } from "./MoneyAmount.js";
import { formatCurrency } from "./money-format.js";
import {
  type DeductionAccountOption,
  type ExpenseSaveReceipt,
  ExpenseSheet,
  RecentExpenses,
} from "./V2HomeSurface.js";

/**
 * M1 home: this month's actual spending and the latest records.
 *
 * The debt list has never been confirmed in this build, so the model's
 * recommendation and everything derived from it (remaining, overspend,
 * progress) is hidden here; only facts the user can trust stay on screen.
 */
export function M1Home({
  home,
  deductionAccounts,
  onRecordExpense,
}: {
  home: HomeApplicationState;
  deductionAccounts?: readonly DeductionAccountOption[] | undefined;
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<ExpenseSaveReceipt>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const homeRef = useRef<HTMLElement>(null);

  const desired = home.desiredMonthlyDiscretionarySpending;

  // Topbar B: the handoff follows the real scroll position (24→80px), with no
  // timer. Reduced motion switches statically at 80px instead of fading.
  useEffect(() => {
    const node = homeRef.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const paint = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const p = reduced?.matches ? (y >= 80 ? 1 : 0) : Math.min(1, Math.max(0, (y - 24) / 56));
      node.style.setProperty("--m2-p", String(p));
    };
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    reduced?.addEventListener?.("change", paint);
    return () => {
      window.removeEventListener("scroll", paint);
      reduced?.removeEventListener?.("change", paint);
    };
  }, []);

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
    <main className="v2-shell m2-home" data-testid="m1-home" ref={homeRef}>
      <header className="m2-topbar">
        <span className="m2-topbar__brand" aria-hidden="true">
          <span className="v2-brand-mark">
            <img src={brandLogo} alt="" aria-hidden="true" draggable="false" />
          </span>
        </span>
        <span className="m2-topbar__compact" aria-hidden="true">
          小钱家
        </span>
        <button className="m2-topbar__record" type="button" onClick={openSheet}>
          <Plus size={20} aria-hidden="true" />
          <span>记一笔</span>
        </button>
      </header>
      <section className="v2-content">
        <div className="v2-page">
          <div className="m2-hero">
            <h1 className="m2-large-title">小钱家</h1>
            <p className="m2-period">
              {home.asOfDate.slice(0, 4)} 年 {Number(home.asOfDate.slice(5, 7))} 月
            </p>
          </div>
          <section className="v2-card v2-month-card" aria-labelledby="m1-month-title">
            <div className="v2-card__head">
              <span className="v2-card__kicker" id="m1-month-title">
                本月消费
              </span>
            </div>
            <div className="v2-card__value">
              <MoneyAmount value={home.currentMonthSpending} size="summary" />
              <small>本月已花</small>
            </div>
            {desired != null && (
              <p className="v2-card__line" data-testid="m1-desired-line">
                你设定的每月期望：{formatCurrency(desired)}
              </p>
            )}
            <p className="v2-card__line" data-testid="m1-scope-note">
              债务情况尚未确认，暂不显示建议金额。
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
          deductionAccounts={deductionAccounts}
          onClose={() => setOpen(false)}
          onSubmit={save}
        />
      )}
    </main>
  );
}
