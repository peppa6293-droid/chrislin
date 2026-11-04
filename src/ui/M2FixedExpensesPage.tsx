import { ChevronLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EssentialPaymentRecord } from "../application/ux-ledger-service.js";
import { isValidUserInputMoney, MAX_SUPPORTED_MONEY, money } from "../model/money.js";
import type { ProductApplicationServices } from "./contracts.js";
import { shiftMonth } from "./DateField.js";
import { localDate } from "./date.js";
import type { FixedExpenseOperation } from "./M2FinanceRoute.js";
import { formatCurrency } from "./money-format.js";
import { V2CalendarPicker } from "./V2CalendarPicker.js";

/**
 * M2-T02 固定支出闭环：查看 → 新增 → 记支付 → 独立读回确认。
 *
 * 业务操作（令牌、会话业务日、冻结草稿、固定 UUID、写前集合、付款收据、阶段、
 * 写服务派发标记、锁与结果文案）全部由宿主 M2FinanceRoute 唯一持有；本页只保留
 * 未提交的编辑内容与展示状态，向上发送事件，不持有第二份业务锁或未知结果真相。
 */

const CATEGORY_OPTIONS = [
  { value: "HOUSING", label: "住房" },
  { value: "BASIC_FOOD", label: "基本饮食" },
  { value: "TRANSPORT", label: "交通" },
  { value: "UTILITIES_COMMUNICATIONS", label: "水电通信" },
  { value: "INSURANCE", label: "保险" },
  { value: "FAMILY_FIXED_RESPONSIBILITY", label: "家庭支出" },
  { value: "OTHER_ESSENTIAL", label: "其他" },
] as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
);

const CROSS_DAY_MESSAGE = "日期已变化，暂时不能添加。";
const PAY_CROSS_DAY_MESSAGE = "日期已变化，暂时不能记录这笔付款。请完全退出应用后重新打开。";
const FUTURE_DATE_MESSAGE = "不能填写未来的日期，请重新选择。";
const DUPLICATE_PAYMENT_MESSAGE =
  "这天已有一笔同额记录。请到该月记录核对；确认是另一笔后再点一次保存。";
const DUPLICATE_CHECK_ERROR = "暂时无法核对已有记录，请稍后再试。";

type EssentialItem = { id: string; name: string; category: string; monthlyAmount: string };
type View = "LIST" | "ADD_FORM" | "ADD_CONFIRM" | "PAY_FORM";

type AddDraft = { name: string; category: string; amount: string };
type PayDraft = { itemId: string; itemName: string; amount: string; paidOn: string; note: string };

const EMPTY_ADD: AddDraft = { name: "", category: "HOUSING", amount: "0" };

/** 每月金额：空串与全空白按 0 处理（合同要求），其余按批准文案逐条校验。 */
function validateMonthlyAmount(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("-")) return "每月金额不能小于0";
  if (/^\d+\.\d{3,}$/.test(value)) return "金额最多填两位小数";
  // 上限必须早于格式判定：isValidUserInputMoney 内部已把超限值判为不合法，
  // 若先走格式分支，用户看到的会是含糊的「请输入正确金额」。
  if (/^\d+(\.\d{1,2})?$/.test(value) && money(value).gt(money(MAX_SUPPORTED_MONEY)))
    return "金额太大，请检查";
  if (!isValidUserInputMoney(value)) return "请输入正确金额";
  return "";
}

/** 付款金额必须大于 0；空串不算合法。 */
function validatePaymentAmount(raw: string): string {
  const value = raw.trim();
  if (!value) return "请输入大于0的付款金额";
  if (value.startsWith("-")) return "请输入大于0的付款金额";
  if (/^\d+\.\d{3,}$/.test(value)) return "金额最多填两位小数";
  if (/^\d+(\.\d{1,2})?$/.test(value) && money(value).gt(money(MAX_SUPPORTED_MONEY)))
    return "金额太大，请检查";
  if (!isValidUserInputMoney(value)) return "请输入正确金额";
  if (money(value).lte(0)) return "请输入大于0的付款金额";
  return "";
}

function sumAmounts(values: string[]): string {
  return values.reduce((total, value) => total.plus(money(value)), money("0")).toString();
}

function inFlight(operation: FixedExpenseOperation | null): boolean {
  if (!operation) return false;
  return (
    operation.phase === "PRE_CHECK" ||
    operation.phase === "SUBMITTING" ||
    operation.phase === "READBACK"
  );
}

export function M2FixedExpensesPage({
  services,
  asOfDate,
  operation,
  dataVersion,
  onPrepareAdd,
  onConfirmAdd,
  onConfirmPay,
  onStartOperation,
  onCloseOperation,
  onDeactivateItem,
  onBack,
}: {
  services: ProductApplicationServices;
  asOfDate: string;
  operation: FixedExpenseOperation | null;
  dataVersion: number;
  onPrepareAdd: (draft: AddDraft) => void;
  onConfirmAdd: () => void;
  onConfirmPay: (draft: PayDraft) => void;
  onStartOperation: () => void;
  onCloseOperation: () => void;
  onDeactivateItem: (item: EssentialItem) => Promise<void>;
  onBack: () => void;
}) {
  const month = asOfDate.slice(0, 7);
  const [viewMonth, setViewMonth] = useState(month);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [items, setItems] = useState<EssentialItem[]>([]);
  const [payments, setPayments] = useState<EssentialPaymentRecord[]>([]);
  const [view, setView] = useState<View>("LIST");
  const [addDraft, setAddDraft] = useState<AddDraft>(EMPTY_ADD);
  const [addError, setAddError] = useState("");
  const [payDraft, setPayDraft] = useState<PayDraft>({
    itemId: "",
    itemName: "",
    amount: "",
    paidOn: asOfDate,
    note: "",
  });
  const [payError, setPayError] = useState("");
  const [payNotice, setPayNotice] = useState("");
  const [payChecking, setPayChecking] = useState(false);
  const [payDuplicatePending, setPayDuplicatePending] = useState(false);
  // 付款提交的本地防重入：检查完成前不派发，也不依赖宿主写锁兜底。
  const payCheckBusy = useRef(false);
  // 冻结屏只允许「返回查看」一次本屏展示；重新进入页面时回到冻结屏本身。
  const [addBack, setAddBack] = useState(false);
  const [payBack, setPayBack] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<string | null>(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");

  const load = useCallback(async () => {
    setPhase("LOADING");
    try {
      const [nextItems, nextPayments] = await Promise.all([
        services.listEssentialPaymentItems(asOfDate),
        services.listEssentialPayments(viewMonth),
      ]);
      setItems(nextItems);
      setPayments(nextPayments);
      setPhase("READY");
    } catch {
      setPhase("ERROR");
    }
  }, [services, asOfDate, viewMonth]);

  // 会话月变化时回到新的会话月；用户手动翻月不受影响。
  useEffect(() => {
    setViewMonth(month);
  }, [month]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataVersion 是宿主派发的重载触发器，变化即需重读，不是推导值
  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const opAdd = operation?.kind === "ADD" ? operation : null;
  const opPay = operation?.kind === "PAY" ? operation : null;
  // 写服务已派发且尚未完整确认：只有宿主能结束这一段，页面不能清除。
  const payDispatched = opPay?.dispatched === true && opPay.phase !== "CONFIRMED";
  const payLocked = opPay !== null && (opPay.locked || opPay.phase === "UNKNOWN");
  const writeBusy = inFlight(operation);
  const blocking = writeBusy || Boolean(operation?.locked);

  // 冻结态由宿主操作决定；本页上的「返回」只切本屏展示，不动操作身份。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 新操作令牌出现即需重置本屏展示，令牌只用于触发重置
  useEffect(() => {
    setAddBack(false);
    setPayBack(false);
  }, [operation?.token]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在完整确认或换令牌时清草稿，token 只用于触发重置
  useEffect(() => {
    if (operation?.phase !== "CONFIRMED") return;
    setView("LIST");
    setAddDraft(EMPTY_ADD);
    setAddError("");
    setPayError("");
    setPayNotice("");
    setPayDuplicatePending(false);
    setPayDraft({ itemId: "", itemName: "", amount: "", paidOn: asOfDate, note: "" });
  }, [operation?.phase, operation?.token, asOfDate]);

  const projection = sumAmounts(items.map((item) => item.monthlyAmount));
  // 已完整核对的那张凭据只属于它自己的显示月份：与「已保存」同帧并入，
  // 不等重载回来才显示，避免成功提示和本月合计短暂互相矛盾；
  // 但跨月付款不得计入本月（F01），否则上月 300.20 会污染本月统计。
  const viewLabel = viewMonth === month ? "本月" : viewMonth;
  const confirmedReceipt =
    operation?.phase === "CONFIRMED" &&
    operation.kind === "PAY" &&
    operation.receipt?.paidOn.slice(0, 7) === viewMonth
      ? operation.receipt
      : null;
  const ledger = (() => {
    if (!confirmedReceipt) return payments;
    if (payments.some((row) => row.id === confirmedReceipt.id)) return payments;
    return [...payments, confirmedReceipt];
  })();
  const paid = sumAmounts(ledger.map((payment) => payment.amount));
  const banner = operation?.phase === "CONFIRMED" ? operation.message : "";

  function paidForItem(itemId: string) {
    return sumAmounts(
      ledger.filter((payment) => payment.itemId === itemId).map((payment) => payment.amount),
    );
  }

  function openAddForm() {
    onStartOperation();
    setAddDraft(EMPTY_ADD);
    setAddError("");
    setView("ADD_FORM");
  }

  function submitAddForm() {
    if (blocking) return;
    if (addDraft.name.trim() === "") return setAddError("请填写支出名称");
    if (!CATEGORY_OPTIONS.some((option) => option.value === addDraft.category))
      return setAddError("请选择类别");
    const amountError = validateMonthlyAmount(addDraft.amount);
    if (amountError) return setAddError(amountError);
    // 跨日守卫：会话日期一旦不是今天，就不再拿旧日期写入。
    if (asOfDate !== localDate(new Date())) return setAddError(CROSS_DAY_MESSAGE);
    setAddError("");
    onPrepareAdd({
      name: addDraft.name.trim(),
      category: addDraft.category,
      amount: addDraft.amount.trim() || "0",
    });
    setView("ADD_CONFIRM");
  }

  function openPayForm(item: EssentialItem) {
    if (blocking) return;
    setPayError("");
    setPayNotice("");
    setPayDuplicatePending(false);
    setPayDraft({ itemId: item.id, itemName: item.name, amount: "", paidOn: asOfDate, note: "" });
    setView("PAY_FORM");
  }

  function resetDuplicateCheck() {
    setPayDuplicatePending(false);
    setPayNotice("");
    setPayError("");
  }

  /** 停用走独立回调（不进 buildPatch）；成功后宿主 bump dataVersion 让本页重读清单。 */
  async function runDeactivate(item: EssentialItem) {
    if (deactivateBusy) return;
    setDeactivateBusy(true);
    setDeactivateError("");
    try {
      await onDeactivateItem(item);
      setConfirmingDeactivate(null);
    } catch {
      setDeactivateError("停用未完成，请返回列表核对结果。");
    } finally {
      setDeactivateBusy(false);
    }
  }

  async function submitPayForm() {
    if (blocking || payCheckBusy.current) return;
    const amountError = validatePaymentAmount(payDraft.amount);
    if (amountError) return setPayError(amountError);
    // 先判跨日：午夜后会话日期仍是昨天，先判未来会把真实的今天误报为未来。
    if (asOfDate !== localDate(new Date())) return setPayError(PAY_CROSS_DAY_MESSAGE);
    if (payDraft.paidOn > asOfDate) return setPayError(FUTURE_DATE_MESSAGE);
    setPayError("");
    const draft = {
      itemId: payDraft.itemId,
      itemName: payDraft.itemName,
      amount: payDraft.amount.trim(),
      paidOn: payDraft.paidOn,
      note: payDraft.note.trim(),
    };
    if (payDuplicatePending) {
      setPayDuplicatePending(false);
      setPayNotice("");
      onConfirmPay(draft);
      return;
    }
    payCheckBusy.current = true;
    setPayChecking(true);
    try {
      const existing = await services.listEssentialPayments(payDraft.paidOn.slice(0, 7));
      const amount = money(draft.amount);
      const duplicate = existing.some(
        (row) =>
          row.itemId === draft.itemId &&
          row.paidOn === draft.paidOn &&
          money(row.amount).eq(amount),
      );
      if (duplicate) {
        setPayDuplicatePending(true);
        setPayNotice(DUPLICATE_PAYMENT_MESSAGE);
        return;
      }
      onConfirmPay(draft);
    } catch {
      setPayError(DUPLICATE_CHECK_ERROR);
    } finally {
      payCheckBusy.current = false;
      setPayChecking(false);
    }
  }

  // 已派发的付款操作是宿主持有的冻结真相：清单/记录读不出来也不能把它藏起来（§5.2）。
  // 冻结付款屏不依赖 items/payments 即可渲染自身草稿与未知结果文案。
  if (phase === "LOADING" && !payDispatched)
    return (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <p className="m2-status" role="status">
              正在读取…
            </p>
          </div>
        </section>
      </main>
    );

  if (phase === "ERROR" && !payDispatched)
    return (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <p className="m2-status" role="alert">
              暂时打不开，请重试
            </p>
            <div className="m2-actions">
              <button className="button button-secondary" type="button" onClick={onBack}>
                返回
              </button>
              <button className="button button-primary" type="button" onClick={() => void load()}>
                重试
              </button>
            </div>
          </div>
        </section>
      </main>
    );

  // 已派发未确认的操作决定当前屏，页面自己的 view 不能把它顶掉。
  let effectiveView: View = view;
  if (opAdd && (inFlight(opAdd) || opAdd.phase === "UNKNOWN" || opAdd.locked)) {
    effectiveView = addBack ? "ADD_FORM" : "ADD_CONFIRM";
  } else if (payDispatched) {
    effectiveView = payBack ? "LIST" : "PAY_FORM";
  }

  if (effectiveView === "ADD_FORM") {
    const frozenAdd = Boolean(operation?.locked);
    return (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <h1 className="m2-title">添加支出</h1>
            <form
              className="m2-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitAddForm();
              }}
            >
              <label className="m2-field">
                <span>支出名称</span>
                <input
                  type="text"
                  value={addDraft.name}
                  autoComplete="off"
                  onChange={(event) =>
                    setAddDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className="m2-field">
                <span>类别</span>
                <select
                  value={addDraft.category}
                  onChange={(event) =>
                    setAddDraft((current) => ({ ...current, category: event.target.value }))
                  }
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="m2-field">
                <span>每月金额</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={addDraft.amount}
                  onChange={(event) =>
                    setAddDraft((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </label>
              {(addError || (frozenAdd ? operation?.message : "")) && (
                <p className="m2-error" role="alert">
                  {addError || operation?.message}
                </p>
              )}
              <div className="m2-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setAddError("");
                    onStartOperation();
                    setView("LIST");
                  }}
                >
                  取消
                </button>
                <button className="button button-primary" type="submit" disabled={blocking}>
                  添加
                </button>
              </div>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (effectiveView === "ADD_CONFIRM") {
    const draft = opAdd?.draft ?? { ...addDraft, amount: addDraft.amount.trim() || "0" };
    const after = money(projection)
      .plus(money(draft.amount || "0"))
      .toString();
    const error = opAdd?.message || addError;
    return (
      <main className="v2-shell m2-shell">
        <section className="v2-content">
          <div className="v2-page">
            <h1 className="m2-title">添加支出</h1>
            <section className="v2-card m2-summary" aria-label="添加核对">
              <p className="m2-summary__row">
                <span>当前每月合计</span>
                <strong>{formatCurrency(projection)}</strong>
              </p>
              <p className="m2-summary__row">
                <span>本次新增</span>
                <strong>
                  {draft.name} · {formatCurrency(draft.amount || "0")}
                </strong>
              </p>
              <p className="m2-summary__row">
                <span>添加后合计</span>
                <strong>{formatCurrency(after)}</strong>
              </p>
              <p className="m2-note">从今天起生效。</p>
              <p className="m2-note">
                只添加原金额里没有的支出；如果这项已经包含在原金额里，或者不确定，先返回查看。
              </p>
            </section>
            {error && (
              <p className="m2-error" role="alert">
                {error}
              </p>
            )}
            {writeBusy && (
              <p className="m2-status" role="status">
                正在保存…
              </p>
            )}
            <div className="m2-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setAddError("");
                  setAddBack(true);
                  setView("ADD_FORM");
                }}
              >
                返回
              </button>
              {!writeBusy && !(opAdd?.phase === "UNKNOWN" || opAdd?.locked) && (
                <button className="button button-primary" type="button" onClick={onConfirmAdd}>
                  确认添加
                </button>
              )}
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (effectiveView === "PAY_FORM") {
    const shown: PayDraft = payDispatched
      ? {
          itemId: opPay?.itemId ?? "",
          itemName: opPay?.itemName ?? "",
          amount: opPay?.amount ?? "",
          paidOn: opPay?.paidOn ?? asOfDate,
          note: opPay?.note ?? "",
        }
      : payDraft;
    // R 拒绝与跨日提示发生在未派发阶段，也必须让用户看到。
    const error = opPay && opPay.phase !== "CONFIRMED" ? opPay.message || payError : payError;
    return (
      <main className="v2-shell m2-shell">
        {payDispatched && (
          <header className="v2-topbar">
            <div className="v2-brand">
              <div>
                <strong>记一笔</strong>
              </div>
            </div>
            <div className="v2-topbar-actions">
              <button className="button button-secondary" type="button" onClick={onBack}>
                <ChevronLeft size={17} aria-hidden="true" />
                <span>返回</span>
              </button>
            </div>
          </header>
        )}
        <section className="v2-content">
          <div className="v2-page">
            <h1 className="m2-title">记一笔</h1>
            <p className="m2-note">{shown.itemName}</p>
            <form
              className="m2-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!payDispatched) void submitPayForm();
              }}
            >
              <label className="m2-field">
                <span>付款金额</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={shown.amount}
                  readOnly={payDispatched || payChecking}
                  onChange={(event) => {
                    if (payDispatched) return;
                    resetDuplicateCheck();
                    setPayDraft((current) => ({ ...current, amount: event.target.value }));
                  }}
                />
              </label>
              <div className="m2-field">
                <span>日期</span>
                <V2CalendarPicker
                  label="日期"
                  value={shown.paidOn}
                  disabled={payDispatched || payChecking}
                  onChange={(value) => {
                    if (payDispatched) return;
                    resetDuplicateCheck();
                    setPayDraft((current) => ({ ...current, paidOn: value }));
                  }}
                />
              </div>
              <label className="m2-field">
                <span>备注（选填）</span>
                <input
                  type="text"
                  value={shown.note}
                  autoComplete="off"
                  readOnly={payDispatched || payChecking}
                  onChange={(event) => {
                    if (payDispatched) return;
                    resetDuplicateCheck();
                    setPayDraft((current) => ({ ...current, note: event.target.value }));
                  }}
                />
              </label>
              {(error || payNotice) && (
                <p className="m2-error" role="alert">
                  {error || payNotice}
                </p>
              )}
              {payChecking && (
                <p className="m2-status" role="status">
                  正在核对记录…
                </p>
              )}
              {writeBusy && (
                <p className="m2-status" role="status">
                  正在保存…
                </p>
              )}
              <div className="m2-actions">
                {payLocked ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setPayBack(true);
                      setView("LIST");
                    }}
                  >
                    返回查看记录
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setPayError("");
                      onCloseOperation();
                      setView("LIST");
                    }}
                  >
                    取消
                  </button>
                )}
                {!payDispatched && (
                  <button className="button button-primary" type="submit" disabled={payChecking}>
                    保存
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="v2-shell m2-shell">
      <header className="v2-topbar">
        <div className="v2-brand">
          <div>
            <strong>固定支出</strong>
          </div>
        </div>
        <div className="v2-topbar-actions">
          <button className="button button-secondary" type="button" onClick={onBack}>
            <ChevronLeft size={17} aria-hidden="true" />
            <span>返回</span>
          </button>
        </div>
      </header>
      <section className="v2-content">
        <div className="v2-page">
          <h1 className="m2-title">固定支出</h1>
          {banner && (
            <p className="m2-banner" role="status">
              {banner}
            </p>
          )}
          {!banner && blocking && operation?.message && (
            <p className="m2-error" role="alert">
              {operation.message}
            </p>
          )}
          {deactivateError && (
            <p className="m2-error" role="alert">
              {deactivateError}
            </p>
          )}
          <section className="v2-card m2-summary" aria-label="本月合计">
            <div className="m2-summary__cell">
              <span>本月预计</span>
              <strong>{formatCurrency(projection)}</strong>
            </div>
            <div className="m2-summary__cell">
              <span>{viewLabel}已付</span>
              <strong>{formatCurrency(paid)}</strong>
            </div>
          </section>

          {items.length === 0 ? (
            <p className="m2-empty">还没有固定支出</p>
          ) : (
            <section className="m2-items" aria-label="固定支出项目">
              <ul className="m2-list">
                {items.map((item) => (
                  <li className="m2-row" key={item.id} data-item-id={item.id}>
                    <div className="m2-row__main">
                      <strong>{item.name}</strong>
                      <span className="m2-row__meta">
                        {CATEGORY_LABELS[item.category] ?? item.category} · 每月
                        {formatCurrency(item.monthlyAmount)}
                      </span>
                      <span className="m2-row__paid">
                        该项{viewLabel}已记录支付 {formatCurrency(paidForItem(item.id))}
                      </span>
                    </div>
                    {!blocking && confirmingDeactivate !== item.id && (
                      <div>
                        <button
                          className="button button-secondary m2-row__action"
                          type="button"
                          aria-label={`记一笔 ${item.name}`}
                          onClick={() => openPayForm(item)}
                        >
                          记一笔
                        </button>
                        <button
                          className="button button-secondary m2-row__action"
                          type="button"
                          aria-label={`停用 ${item.name}`}
                          onClick={() => {
                            setDeactivateError("");
                            setConfirmingDeactivate(item.id);
                          }}
                        >
                          停用
                        </button>
                      </div>
                    )}
                    {!blocking && confirmingDeactivate === item.id && (
                      <div>
                        <p className="m2-note">
                          历史记录会保留；停用后，该项目将不再参与后续计算。
                        </p>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={deactivateBusy}
                          onClick={() => setConfirmingDeactivate(null)}
                        >
                          取消
                        </button>
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={deactivateBusy}
                          onClick={() => void runDeactivate(item)}
                        >
                          确认停用
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!blocking && (
            <button className="m2-add" type="button" onClick={openAddForm}>
              <Plus size={17} aria-hidden="true" />
              <span>添加支出</span>
            </button>
          )}

          {!blocking && (
            <div className="m2-month-nav">
              <button
                className="m2-month-nav__button"
                type="button"
                aria-label="上个月"
                onClick={() => setViewMonth((current) => shiftMonth(current, -1))}
              >
                ‹ 上个月
              </button>
              <span className="m2-month-nav__label">{viewMonth}</span>
              <button
                className="m2-month-nav__button"
                type="button"
                aria-label="下个月"
                disabled={viewMonth === month}
                onClick={() => setViewMonth((current) => shiftMonth(current, 1))}
              >
                下个月 ›
              </button>
            </div>
          )}

          <section aria-label={`${viewLabel}记录`}>
            <h2 className="m2-subtitle">{viewLabel}记录</h2>
            {ledger.length === 0 ? (
              <p className="m2-empty">{viewLabel}还没有记录</p>
            ) : (
              <ul className="m2-list">
                {ledger.map((payment) => (
                  <li className="m2-record" key={payment.id}>
                    <div className="m2-row__main">
                      <strong>{payment.itemId === "" ? "对应支出不明" : payment.itemName}</strong>
                      <span className="m2-row__meta">
                        {CATEGORY_LABELS[payment.category] ?? payment.category} · {payment.paidOn}
                        {payment.note ? ` · ${payment.note}` : ""}
                      </span>
                    </div>
                    <strong>{formatCurrency(payment.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
