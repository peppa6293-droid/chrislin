import { Decimal } from "decimal.js";
import type { Money, MoneyInput } from "./types.js";

/** Isolated high-precision constructor; Decimal operations do not mutate operands. */
export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function money(value: MoneyInput): Money {
  return new MoneyDecimal(value) as Money;
}

export function zeroMoney(): Money {
  return new MoneyDecimal(0) as Money;
}

export function moneyString(value: Money): string {
  return value.toString();
}

export const MAX_SUPPORTED_MONEY = "999999999999.99";
const supportedMoneyPattern = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/** Strict contract for one user-entered currency amount and its persisted source fact. */
export function isValidUserInputMoney(value: string): boolean {
  if (!supportedMoneyPattern.test(value)) return false;
  const parsed = new MoneyDecimal(value);
  return parsed.abs().lte(MAX_SUPPORTED_MONEY);
}

export function assertUserInputMoney(value: string, field = "Amount"): string {
  if (!isValidUserInputMoney(value)) {
    throw new RangeError(
      `${field} must be a finite amount with at most 2 decimal places and an absolute value no greater than ${MAX_SUPPORTED_MONEY}.`,
    );
  }
  return value;
}

const internalDecimalPattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Validate trusted aggregate/derived decimal text without user-entry limits. */
export function parseInternalMoney(value: MoneyInput): Money {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("Internal money must be finite.");
  }
  if (typeof value === "string" && !internalDecimalPattern.test(value)) {
    throw new RangeError("Internal money must be a valid decimal value.");
  }
  let parsed: Money;
  try {
    parsed = money(value);
  } catch {
    throw new RangeError("Internal money must be a valid decimal value.");
  }
  if (!parsed.isFinite()) throw new RangeError("Internal money must be finite.");
  return parsed;
}

/** Locale-group exact decimal text without converting a money value to JS Number. */
export function formatMoneyExact(value: string, locale = "zh-CN"): string {
  const parsed = new MoneyDecimal(value);
  const canonical =
    parsed.decimalPlaces() > 2
      ? parsed.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2)
      : parsed.toString();
  const negative = canonical.startsWith("-");
  const [integer = "0", fraction] = (negative ? canonical.slice(1) : canonical).split(".");
  const group =
    new Intl.NumberFormat(locale).formatToParts(123456789).find((part) => part.type === "group")
      ?.value ?? ",";
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `${decimal}${fraction}`}`;
}
