import { Check, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import type {
  EssentialItemPatch,
  EssentialPaymentRecord,
} from "../application/ux-ledger-service.js";
import { money } from "../model/money.js";
import type { ExpenseCategory } from "../model/types.js";
import type { ProductApplicationServices } from "./contracts.js";
import { DateField } from "./DateField.js";
import {
  categoryProgress,
  hasUnownedPayments,
  itemStatusLine,
  monthPaidSummary,
  paidByItem,
} from "./fixed-expenses-model.js";
import { formatCurrency } from "./money-format.js";
import { V2PaidRing } from "./V2PaidRing.js";

const ESSENTIAL_LABELS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "HOUSING", label: "住房" },
  { value: "BASIC_FOOD", label: "吃饭" },
  { value: "TRANSPORT", label: "通勤" },
  { value: "UTILITIES_COMMUNICATIONS", label: "水电通讯" },
  { value: "INSURANCE", label: "保险" },
  { value: "FAMILY_FIXED_RESPONSIBILITY", label: "家庭固定责任" },
  { value: "OTHER_ESSENTIAL", label: "其他固定支出" },
];

interface ItemDraft {
  id?: string;
  name: string;
  category: ExpenseCategory;
  monthlyAmount: string;
}

const EMPTY_DRAFT: ItemDraft = { name: "", category: "HOUSING", monthlyAmount: "" };

function categoryLabel(category: string): string {
  return ESSENTIAL_LABELS.find((entry) => entry.value === category)?.label ?? "其他固定支出";
}

export function FixedExpensesPage({
  asOfDate,
  services,
  onApplyHome,
  onBack,
}: {
  asOfDate: string;
  services: ProductApplicationServices;
  onApplyHome: (home: HomeApplicationState) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<
    Array<{ id: string; name: string; category: string; monthlyAmount: string }>
  >([]);
  const [payments, setPayments] = useState<EssentialPaymentRecord[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [paymentItemId, setPaymentItemId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(asOfDate);
  const [paymentNote, setPaymentNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [nextItems, nextPayments] = await Promise.all([
        services.listEssentialPaymentItems(asOfDate),
        services.listEssentialPayments(asOfDate.slice(0, 7)),
      ]);
      setItems(
        nextItems as Array<{ id: string; name: string; category: string; monthlyAmount: string }>,
      );
      setPayments(nextPayments);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "固定支出读取失败。");
    }
  }, [asOfDate, services]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = monthPaidSummary(items, payments);
  const categories = categoryProgress(items, payments);
  const paidByItemId = paidByItem(payments);
  const unownedPayments = hasUnownedPayments(payments);

  async function saveDraft() {
    if (!draft.name.trim()) {
      setError("先给这项固定支出起个名字。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const patch: EssentialItemPatch = {
        name: draft.name.trim(),
        category: draft.category,
        monthlyAmount: draft.monthlyAmount.trim() || "0",
        ...(draft.id ? { id: draft.id } : {}),
      };
      const result = await services.saveEssentialItems([patch], asOfDate);
      onApplyHome(result.home);
      setDraft(EMPTY_DRAFT);
      setFeedback("固定支出已保存。");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "固定支出保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(item: {
    id: string;
    name: string;
    category: string;
    monthlyAmount: string;
  }) {
    setBusy(true);
    setError("");
    try {
      const result = await services.saveEssentialItems(
        [
          {
            id: item.id,
            name: item.name,
            category: item.category as ExpenseCategory,
            monthlyAmount: item.monthlyAmount,
            active: false,
          },
        ],
        asOfDate,
      );
      onApplyHome(result.home);
      setFeedback(`已停用「${item.name}」。`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "停用失败。");
    } finally {
      setBusy(false);
    }
  }

  function beginPayment(item: { id: string; monthlyAmount: string }) {
    setPaymentItemId(item.id);
    setPaymentAmount(item.monthlyAmount);
    const field = amountInputRef.current;
    field?.scrollIntoView?.({ block: "center" });
    field?.focus();
  }

  async function submitPayment() {
    if (!paymentItemId) {
      setError("先选一项要支付的固定支出。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await services.recordEssentialPayment({
        itemId: paymentItemId,
        amount: paymentAmount.trim(),
        paidOn: paymentDate,
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      });
      onApplyHome(result.home);
      setFeedback(
        `记好了，本月固定支出已付 ${formatCurrency(result.monthTotal)}。这笔只进固定支出账，不算弹性消费。`,
      );
      setPaymentAmount("");
      setPaymentNote("");
      await load();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "支付记录失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-page detail-page v2-detail-page v2-fixed-page">
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回首页">
          返回首页
        </button>
        <span>{asOfDate.slice(0, 7)}</span>
      </header>

      <div className="fixed-title-row">
        <h1 className="detail-title">固定支出·{items.length}项</h1>
      </div>

      {items.length === 0 ? (
        <div className="fixed-empty">
          <p>暂无固定支出</p>
        </div>
      ) : (
        <>
          <section className="detail-panel fixed-summary" aria-label="固定支出">
            <dl className="fixed-summary__metrics">
              <div>
                <dt>计划</dt>
                <dd>{formatCurrency(summary.plan)}</dd>
              </div>
              <div>
                <dt>已付</dt>
                <dd className="is-paid">{formatCurrency(summary.paid)}</dd>
              </div>
              <div>
                <dt>未付</dt>
                <dd>{formatCurrency(summary.unpaid)}</dd>
              </div>
            </dl>
            <div className="fixed-summary__ring">
              <V2PaidRing
                progress={summary.progress}
                percent={summary.percent}
                label="所选月份已付占比"
              />
              <span className="fixed-summary__ring-name" aria-hidden="true">
                所选月份已付占比
              </span>
            </div>
          </section>

          <section className="detail-panel fixed-list" aria-labelledby="fixed-list-heading">
            <h2 id="fixed-list-heading" className="v2-sr-only">
              每月要付的
            </h2>
            <ul className="fixed-list__items">
              {items.map((item) => {
                const paid = paidByItemId.get(item.id) ?? "0";
                const paidValue = money(paid);
                const status =
                  unownedPayments && !paidValue.gt(0)
                    ? ""
                    : itemStatusLine(item.monthlyAmount, paid);
                return (
                  <li key={item.id} className={`fixed-item ${paidValue.gt(0) ? "is-paid" : ""}`}>
                    <div className="fixed-item__main">
                      <span className="fixed-item__identity">
                        <strong>{item.name}</strong>
                        <small>{categoryLabel(item.category)}</small>
                      </span>
                      <span className="fixed-item__amount">
                        {formatCurrency(item.monthlyAmount)} / 月
                      </span>
                    </div>
                    <div className="fixed-item__meta">
                      <span className="fixed-item__status">{status}</span>
                      <span className="fixed-item__actions">
                        {!paidValue.gt(0) && (
                          <button
                            type="button"
                            className="v2-btn v2-btn--primary fixed-item__pay"
                            disabled={busy}
                            onClick={() => beginPayment(item)}
                          >
                            记一笔
                          </button>
                        )}
                        <button
                          type="button"
                          className="v2-text-button"
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              id: item.id,
                              name: item.name,
                              category: item.category as ExpenseCategory,
                              monthlyAmount: item.monthlyAmount,
                            })
                          }
                        >
                          <Pencil size={15} aria-hidden="true" /> 改
                        </button>
                        <button
                          type="button"
                          className="v2-text-button"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`停用「${item.name}」？以后不再计入固定支出。`))
                              return;
                            void deactivate(item);
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" /> 停用
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="detail-panel fixed-categories" aria-label="固定支出">
            <div className="fixed-categories__grid">
              {categories.map((row) => (
                <div key={row.category} className="fixed-category" data-state={row.progress.state}>
                  <div className="fixed-category__head">
                    <span className="fixed-category__name">{categoryLabel(row.category)}</span>
                    <span className="fixed-category__plan">{formatCurrency(row.plan)}</span>
                  </div>
                  <div className="fixed-progress" aria-hidden="true">
                    <span style={{ width: `${row.progress.progress * 100}%` }} />
                  </div>
                  {/* 本月有无归属支付时，不为「已付 = 0」的分类断言「未付」（Q-5：不猜归属）。 */}
                  {(row.progress.state !== "UNPAID" || !unownedPayments) &&
                    row.progress.primary && (
                      <p className="fixed-category__primary">{row.progress.primary}</p>
                    )}
                  {(row.progress.state !== "UNPAID" || !unownedPayments) &&
                    row.progress.secondary && (
                      <p className="fixed-category__secondary">{row.progress.secondary}</p>
                    )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="detail-panel" aria-labelledby="fixed-edit-heading">
        <h2 id="fixed-edit-heading">{draft.id ? "修改这一项" : "添加一项固定支出"}</h2>
        <label>
          名称
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="例如：房租"
          />
        </label>
        <label>
          类别
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value as ExpenseCategory })
            }
          >
            {ESSENTIAL_LABELS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          每月金额
          <input
            inputMode="decimal"
            value={draft.monthlyAmount}
            onChange={(event) => setDraft({ ...draft, monthlyAmount: event.target.value })}
            placeholder="0.00"
          />
        </label>
        <div className="v2-sheet-actions">
          {draft.id ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              取消修改
            </button>
          ) : null}
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            <Plus size={16} aria-hidden="true" /> 保存
          </button>
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="fixed-pay-heading">
        <h2 id="fixed-pay-heading">记一笔实际支付</h2>
        <label>
          哪一项
          <select
            value={paymentItemId}
            onChange={(event) => {
              const next = event.target.value;
              setPaymentItemId(next);
              const item = items.find((entry) => entry.id === next);
              if (item) setPaymentAmount(item.monthlyAmount);
            }}
          >
            <option value="">请选择</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          金额
          <input
            ref={amountInputRef}
            inputMode="decimal"
            value={paymentAmount}
            onChange={(event) => setPaymentAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <div className="v2-sheet-date">
          <span>支付日期</span>
          <DateField
            value={paymentDate}
            onChange={setPaymentDate}
            label="支付日期"
            disabled={busy}
          />
        </div>
        <label>
          备注（选填）
          <input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
        </label>
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => void submitPayment()}
        >
          <WalletCards size={16} aria-hidden="true" /> 记下这笔支付
        </button>
      </section>

      <section className="detail-panel" aria-labelledby="fixed-history-heading">
        <h2 id="fixed-history-heading">本月支付记录</h2>
        {payments.length === 0 ? (
          <p>这个月还没有支付记录。</p>
        ) : (
          <ul className="v2-plain-list">
            {payments.map((payment) => (
              <li key={payment.id}>
                <span>
                  <strong>{payment.itemName}</strong>
                  <small>{payment.paidOn}</small>
                </span>
                <span>{formatCurrency(payment.amount)}</span>
                <Check size={15} aria-label="已记录" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {feedback && (
        <p className="v2-feedback-inline" role="status">
          {feedback}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
