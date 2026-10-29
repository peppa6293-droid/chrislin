import { useEffect, useMemo, useRef, useState } from "react";
import type { V2ExpenseService } from "../application/v2-expense-service.js";
import { MAX_SUPPORTED_MONEY, MoneyDecimal } from "../model/money.js";
import type { Account, ExpenseCategoryDefinition } from "../model/v2-types.js";
import type { ApplicationDataError } from "../persistence/database.js";
import type { Repositories } from "../persistence/repositories.js";
import { localDate } from "./date.js";
import "./v2-quick-entry.css";

export type QuickEntryErrorReason =
  | "AMOUNT_REQUIRED"
  | "AMOUNT_INVALID"
  | "AMOUNT_NEGATIVE"
  | "AMOUNT_ZERO"
  | "AMOUNT_TOO_LARGE"
  | "CATEGORY_REQUIRED"
  | "ACCOUNT_REQUIRED"
  | "DATE_INVALID";

export interface QuickEntryDraft {
  amount: string;
  categoryId: string;
  accountId: string;
  occurredOn: string;
}

export type QuickEntryValidation =
  | { ok: true; amount: string }
  | { ok: false; reason: QuickEntryErrorReason };

const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_MESSAGES: Record<QuickEntryErrorReason, string> = {
  AMOUNT_REQUIRED: "请输入金额",
  AMOUNT_INVALID: "金额格式不正确（最多两位小数）",
  AMOUNT_NEGATIVE: "金额不能为负数",
  AMOUNT_ZERO: "金额不能为零",
  AMOUNT_TOO_LARGE: "金额超出范围",
  CATEGORY_REQUIRED: "请选择类别",
  ACCOUNT_REQUIRED: "请选择账户",
  DATE_INVALID: "日期格式不正确",
};

export function quickEntryErrorMessage(reason: QuickEntryErrorReason): string {
  return ERROR_MESSAGES[reason];
}

export function validateQuickEntryDraft(draft: QuickEntryDraft): QuickEntryValidation {
  const rawAmount = draft.amount.trim();
  if (!rawAmount) return { ok: false, reason: "AMOUNT_REQUIRED" };
  if (!AMOUNT_PATTERN.test(rawAmount)) return { ok: false, reason: "AMOUNT_INVALID" };
  let amount: InstanceType<typeof MoneyDecimal>;
  try {
    amount = new MoneyDecimal(rawAmount);
  } catch {
    return { ok: false, reason: "AMOUNT_INVALID" };
  }
  if (amount.isNegative()) return { ok: false, reason: "AMOUNT_NEGATIVE" };
  if (amount.isZero()) return { ok: false, reason: "AMOUNT_ZERO" };
  if (amount.abs().gt(MAX_SUPPORTED_MONEY)) return { ok: false, reason: "AMOUNT_TOO_LARGE" };
  if (!draft.categoryId.trim()) return { ok: false, reason: "CATEGORY_REQUIRED" };
  if (!draft.accountId.trim()) return { ok: false, reason: "ACCOUNT_REQUIRED" };
  if (!DATE_PATTERN.test(draft.occurredOn)) return { ok: false, reason: "DATE_INVALID" };
  return { ok: true, amount: amount.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2) };
}

interface V2QuickEntryProps {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
  focusSignal?: number;
  onRecorded?: (
    expense: Awaited<ReturnType<V2ExpenseService["recordCashDebitExpense"]>>["expense"],
  ) => void;
}

export function V2QuickEntry({
  expenseService,
  repositories,
  profileId,
  focusSignal,
  onRecorded,
}: V2QuickEntryProps) {
  const [categories, setCategories] = useState<ExpenseCategoryDefinition[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => localDate(new Date()));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const successTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [loadedCategories, loadedAccounts] = await Promise.all([
          repositories.listExpenseCategories(profileId),
          repositories.listAccounts(profileId),
        ]);
        if (cancelled) return;
        const cashAccounts = loadedAccounts.filter(
          (account) => account.active && account.type === "CASH",
        );
        setCategories(loadedCategories.filter((category) => category.active));
        setAccounts(cashAccounts);
        if (loadedCategories.length > 0) {
          setSelectedCategoryId(loadedCategories[0]?.id ?? "");
        }
        if (cashAccounts.length > 0) {
          setSelectedAccountId(cashAccounts[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) {
          setCategories([]);
          setAccounts([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId, repositories]);

  useEffect(() => {
    if (focusSignal !== undefined && focusSignal > 0) {
      const timer = globalThis.setTimeout(() => amountRef.current?.focus(), 0);
      return () => globalThis.clearTimeout(timer);
    }
  }, [focusSignal]);

  useEffect(
    () => () => {
      if (successTimerRef.current !== null) globalThis.clearTimeout(successTimerRef.current);
    },
    [],
  );

  const canSubmit = useMemo(
    () => !submitting && categories.length > 0 && accounts.length > 0,
    [accounts.length, categories.length, submitting],
  );

  const showError = (reason: QuickEntryErrorReason) => {
    setError(quickEntryErrorMessage(reason));
    setSuccess(false);
  };

  const submit = async () => {
    if (submitting) return;
    const validation = validateQuickEntryDraft({
      amount,
      categoryId: selectedCategoryId,
      accountId: selectedAccountId,
      occurredOn,
    });
    if (!validation.ok) {
      showError(validation.reason);
      return;
    }
    const account = accounts.find((item) => item.id === selectedAccountId);
    if (!account) {
      showError("ACCOUNT_REQUIRED");
      return;
    }
    setSubmitting(true);
    setSuccess(false);
    if (successTimerRef.current !== null) {
      globalThis.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setError("");
    try {
      const result = await expenseService.recordCashDebitExpense({
        id: crypto.randomUUID(),
        profileId,
        amount: validation.amount,
        currency: account.currency,
        occurredOn,
        categoryId: selectedCategoryId,
        description: note.trim(),
        accountId: selectedAccountId,
      });
      setAmount("");
      setNote("");
      setSuccess(true);
      onRecorded?.(result.expense);
      if (successTimerRef.current !== null) globalThis.clearTimeout(successTimerRef.current);
      successTimerRef.current = globalThis.setTimeout(() => setSuccess(false), 2000);
    } catch (caught) {
      setSuccess(false);
      if (
        typeof caught === "object" &&
        caught !== null &&
        "code" in caught &&
        (caught as ApplicationDataError).code === "INVALID_EXPENSE_AMOUNT"
      ) {
        setError(quickEntryErrorMessage("AMOUNT_INVALID"));
      } else {
        setError("保存失败，请重试");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="v2-quick-entry" aria-label="快速记账">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="v2-quick-entry__label">
          <span>金额</span>
          <input
            ref={amountRef}
            className="v2-quick-entry__input"
            type="text"
            inputMode="decimal"
            // biome-ignore lint/a11y/noAutofocus: required by U-01 contract to focus amount on mount
            autoFocus
            aria-label="金额"
            value={amount}
            disabled={submitting}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        <fieldset className="v2-quick-entry__field">
          <legend>类别</legend>
          {categories.length === 0 ? (
            <p className="v2-quick-entry__empty">暂无可用类别</p>
          ) : (
            <div className="v2-quick-entry__categories" role="radiogroup" aria-label="支出类别">
              {categories.map((category) => (
                <label
                  key={category.id}
                  title={`${category.icon} ${category.name}`}
                  className={`v2-quick-entry__category${
                    selectedCategoryId === category.id ? " is-selected" : ""
                  }`}
                >
                  <input
                    className="v2-quick-entry__category-radio"
                    type="radio"
                    name="v2-quick-entry-category"
                    aria-label={`${category.icon} ${category.name}`}
                    checked={selectedCategoryId === category.id}
                    onChange={() => setSelectedCategoryId(category.id)}
                  />
                  <span className="v2-quick-entry__category-badge" aria-hidden="true">
                    {category.name.slice(0, 1)}
                  </span>
                  <span className="v2-quick-entry__category-name">{category.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label className="v2-quick-entry__label">
          <span>账户</span>
          <select
            className="v2-quick-entry__input"
            aria-label="账户"
            value={selectedAccountId}
            disabled={submitting}
            onChange={(event) => setSelectedAccountId(event.target.value)}
          >
            {accounts.length === 0 ? (
              <option value="">暂无现金账户</option>
            ) : (
              accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))
            )}
          </select>
          {accounts.length === 0 ? <p className="v2-quick-entry__empty">暂无现金账户</p> : null}
        </label>

        <label className="v2-quick-entry__label">
          <span>日期</span>
          <input
            className="v2-quick-entry__input"
            type="date"
            aria-label="日期"
            value={occurredOn}
            disabled={submitting}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </label>

        <label className="v2-quick-entry__label">
          <span>备注</span>
          <input
            className="v2-quick-entry__input"
            type="text"
            aria-label="备注"
            placeholder="备注（可选）"
            value={note}
            disabled={submitting}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {error ? (
          <p className="v2-quick-entry__feedback v2-quick-entry__feedback--error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="v2-quick-entry__feedback v2-quick-entry__feedback--success" role="status">
            ✓ 已记入本月消费
          </p>
        ) : null}

        <button
          className="v2-quick-entry__submit"
          type="submit"
          disabled={!canSubmit}
          aria-label="记一笔"
        >
          记一笔
        </button>
      </form>
    </section>
  );
}
