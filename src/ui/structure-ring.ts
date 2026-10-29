import { money } from "../model/money.js";

/**
 * Pure ring model for the home structure overview (B-01).
 *
 * Outer ring = fixed expenses / income, inner ring = mandatory debt service /
 * income, centre = income. Every number is derived from the same decimals the
 * UI prints, so the drawing can never disagree with the text beside it.
 */
export interface RingDatum {
  /** False when the ring must not draw a data arc (missing / zero income or pending part). */
  available: boolean;
  /** Ratio as an exact decimal string (e.g. "0.369"); null when unavailable. */
  ratio: string | null;
  /** Ratio clamped to one full turn for drawing only; never used as a display number. */
  capped: number;
  /** Display percentage, e.g. "36.9%" or "120%"; null when unavailable. */
  percent: string | null;
  /** Amount above income, exact decimal string, only when part > income. */
  overAmount: string | null;
}

const UNAVAILABLE: RingDatum = {
  available: false,
  ratio: null,
  capped: 0,
  percent: null,
  overAmount: null,
};

/** Percent with at most one decimal and no trailing ".0" — matches the approved visual. */
export function percentOf(part: string, whole: string): string | null {
  const base = money(whole);
  if (!base.gt(0)) return null;
  return `${money(part).dividedBy(base).times(100).toDecimalPlaces(1).toString()}%`;
}

export function ringDatum(
  income: string,
  part: string,
  options: { pending?: boolean } = {},
): RingDatum {
  if (options.pending) return UNAVAILABLE;
  const base = money(income);
  if (!base.gt(0)) return UNAVAILABLE;
  const value = money(part);
  const ratio = value.dividedBy(base);
  return {
    available: true,
    ratio: ratio.toString(),
    capped: Math.min(1, Math.max(0, ratio.toNumber())),
    percent: percentOf(part, income),
    overAmount: value.gt(base) ? value.minus(base).toString() : null,
  };
}

export interface StructureRings {
  outer: RingDatum;
  inner: RingDatum;
  incomeZero: boolean;
  incomeNegative: boolean;
}

export function structureRings({
  income,
  essentialExpenses,
  mandatoryDebtService,
  pendingDebt,
}: {
  income: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
  pendingDebt: boolean;
}): StructureRings {
  const base = money(income);
  return {
    outer: ringDatum(income, essentialExpenses),
    inner: ringDatum(income, mandatoryDebtService, { pending: pendingDebt }),
    incomeZero: base.eq(0),
    incomeNegative: base.lt(0),
  };
}

export interface StructureSurplus {
  /** False when income is not strictly positive: the card must print "—", never 0. */
  available: boolean;
  /** income − essential − mandatory debt service, exact decimal; null when unavailable. */
  amount: string | null;
  /** amount ÷ income as an exact decimal; null when unavailable. */
  ratio: string | null;
  /** Display share, e.g. "-30.9%"; null when unavailable. */
  percent: string | null;
}

const SURPLUS_UNAVAILABLE: StructureSurplus = {
  available: false,
  amount: null,
  ratio: null,
  percent: null,
};

/**
 * Surplus for the home structure card (B-02), on the same income as the rings.
 * Pending debt facts are a display concern and are handled by the card; this
 * function never invents a number when income is missing, so nothing is zeroed.
 */
export function structureSurplus({
  income,
  essentialExpenses,
  mandatoryDebtService,
}: {
  income: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
}): StructureSurplus {
  const base = money(income);
  if (!base.gt(0)) return SURPLUS_UNAVAILABLE;
  const amount = base.minus(money(essentialExpenses)).minus(money(mandatoryDebtService));
  const exact = amount.toString();
  return {
    available: true,
    amount: exact,
    ratio: amount.dividedBy(base).toString(),
    percent: percentOf(exact, income),
  };
}
