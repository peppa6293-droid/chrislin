import { money } from "../model/money.js";
import { formatCurrency } from "./money-format.js";
import { percentOf } from "./structure-ring.js";

/**
 * Pure payment-progress model for the fixed-expense page (B-03).
 *
 * The five signed states are decided here and only here, so the visible copy,
 * the progress width and the page summary can never drift apart. Amounts are
 * printed in full: the bar caps visually, the numbers never do.
 */
export type PaymentProgressState =
  | "MISSING_PLAN"
  | "NO_PLAN_NO_PAY"
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "OVERPAID"
  | "ZERO_PLAN_PAID";

export interface PaymentProgress {
  state: PaymentProgressState;
  /** Visible first line; empty when the signed rules show no copy at all. */
  primary: string;
  /** Visible second line; empty when there is nothing more to say. */
  secondary: string;
  /** Row-level ratio clamped for the bar only (0..1). */
  progress: number;
  /** Exact percentage text, e.g. "120%"; null when a ratio must not be shown. */
  percent: string | null;
}

/** `null` means the plan is missing, which is not the same as a zero plan. */
export type PlanInput = string | null;

export function paymentProgress(plan: PlanInput, paid: string): PaymentProgress {
  if (plan === null) {
    return {
      state: "MISSING_PLAN",
      primary: "",
      secondary: "",
      progress: 0,
      percent: null,
    };
  }
  const planned = money(plan);
  const paidValue = money(paid);
  const hasPlan = planned.gt(0);

  if (!hasPlan && !paidValue.gt(0)) {
    return {
      state: "NO_PLAN_NO_PAY",
      primary: "",
      secondary: "",
      progress: 0,
      percent: null,
    };
  }

  if (!hasPlan) {
    // 计划=0 且已付>0：不显示比例，金额不截断。
    return {
      state: "ZERO_PLAN_PAID",
      primary: `计划 ¥0 · 已付 ${formatCurrency(paidValue.toString())} · 超计划 ${formatCurrency(
        paidValue.toString(),
      )}`,
      secondary: "",
      progress: 1,
      percent: null,
    };
  }

  if (!paidValue.gt(0)) {
    return {
      state: "UNPAID",
      primary: "未付",
      secondary: "",
      progress: 0,
      percent: null,
    };
  }

  const ratio = paidValue.dividedBy(planned);
  const percent = percentOf(paidValue.toString(), planned.toString());
  const primary = `已付 ${formatCurrency(paidValue.toString())} / 计划 ${formatCurrency(
    planned.toString(),
  )}`;

  if (paidValue.gt(planned)) {
    return {
      state: "OVERPAID",
      primary,
      secondary: `超计划 ${formatCurrency(
        paidValue.minus(planned).toString(),
      )} · 已付/计划 ${percent}`,
      progress: 1,
      percent,
    };
  }

  return {
    state: paidValue.eq(planned) ? "PAID" : "PARTIAL",
    primary,
    secondary: `已付/计划 ${percent}`,
    progress: Math.min(1, Math.max(0, ratio.toNumber())),
    percent,
  };
}

export interface EssentialItemLike {
  id: string;
  name: string;
  category: string;
  monthlyAmount: string;
}

export interface EssentialPaymentLike {
  itemId: string;
  amount: string;
}

/** Per-item paid totals; payments without an item id stay page-level only (Q-5). */
export function paidByItem(payments: EssentialPaymentLike[]): Map<string, string> {
  const totals = new Map<string, ReturnType<typeof money>>();
  for (const payment of payments) {
    if (!payment.itemId) continue;
    const current = totals.get(payment.itemId) ?? money(0);
    totals.set(payment.itemId, current.plus(money(payment.amount)));
  }
  return new Map([...totals].map(([id, value]) => [id, value.toString()]));
}

export function hasUnownedPayments(payments: EssentialPaymentLike[]): boolean {
  return payments.some((payment) => !payment.itemId);
}

export interface MonthPaidSummary {
  plan: string;
  paid: string;
  unpaid: string;
  /** Page-level "所选月份已付占比"; null when there is no plan to divide by. */
  percent: string | null;
  progress: number;
}

export function monthPaidSummary(
  items: EssentialItemLike[],
  payments: EssentialPaymentLike[],
): MonthPaidSummary {
  const plan = items.reduce((sum, item) => sum.plus(money(item.monthlyAmount)), money(0));
  // Unowned payments still count in the page total; they only never reach a row.
  const paid = payments.reduce((sum, payment) => sum.plus(money(payment.amount)), money(0));
  const unpaid = plan.minus(paid);
  const percent = percentOf(paid.toString(), plan.toString());
  return {
    plan: plan.toString(),
    paid: paid.toString(),
    unpaid: unpaid.gt(0) ? unpaid.toString() : "0",
    percent,
    progress: plan.gt(0) ? Math.min(1, paid.dividedBy(plan).toNumber()) : 0,
  };
}

export interface CategoryProgressRow {
  category: string;
  plan: string;
  paid: string;
  progress: PaymentProgress;
}

/** Category subtotals; categories are the signed grouping, never guessed from payment category. */
export function categoryProgress(
  items: EssentialItemLike[],
  payments: EssentialPaymentLike[],
): CategoryProgressRow[] {
  const byItem = paidByItem(payments);
  const planByCategory = new Map<string, ReturnType<typeof money>>();
  const paidByCategory = new Map<string, ReturnType<typeof money>>();
  for (const item of items) {
    planByCategory.set(
      item.category,
      (planByCategory.get(item.category) ?? money(0)).plus(money(item.monthlyAmount)),
    );
    const paid = byItem.get(item.id);
    if (paid) {
      paidByCategory.set(
        item.category,
        (paidByCategory.get(item.category) ?? money(0)).plus(money(paid)),
      );
    }
  }
  return [...planByCategory.entries()].map(([category, plan]) => {
    const paid = paidByCategory.get(category) ?? money(0);
    return {
      category,
      plan: plan.toString(),
      paid: paid.toString(),
      progress: paymentProgress(plan.toString(), paid.toString()),
    };
  });
}

/** Compact per-item status line; same five states, tokens from the frozen copy only. */
export function itemStatusLine(plan: PlanInput, paid: string): string {
  const progress = paymentProgress(plan, paid);
  const paidText = formatCurrency(paid);
  switch (progress.state) {
    case "UNPAID":
      return "未付";
    case "PARTIAL":
    case "PAID":
      return `已付 ${paidText} · 已付/计划 ${progress.percent}`;
    case "OVERPAID":
      return `已付 ${paidText} · 超计划 ${formatCurrency(
        money(paid)
          .minus(money(plan as string))
          .toString(),
      )}`;
    case "ZERO_PLAN_PAID":
      return `计划 ¥0 · 已付 ${paidText} · 超计划 ${paidText}`;
    default:
      return "";
  }
}
