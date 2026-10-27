import { formatMoneyExact } from "../model/money.js";

/**
 * The single display formatter for every amount in the app.
 * Format: `¥` + thousands grouping + exactly two decimals (e.g. `¥9,309.32`).
 * It never performs business arithmetic; the frozen money core stays the source.
 */
export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "¥0.00";
  const text = typeof value === "number" ? String(value) : value;
  if (!text.trim()) return "¥0.00";
  try {
    const grouped = formatMoneyExact(text);
    const negative = grouped.startsWith("-");
    const body = negative ? grouped.slice(1) : grouped;
    const [integer = "0", fraction = ""] = body.split(".");
    // formatMoneyExact drops a zero fraction; the product contract is always
    // two decimals, so pad here instead of letting callers invent their own.
    const padded = fraction.length >= 2 ? fraction.slice(0, 2) : fraction.padEnd(2, "0");
    return `${negative ? "-" : ""}¥${integer}.${padded}`;
  } catch {
    return "¥0.00";
  }
}

/**
 * Same formatter with an explicit empty-state label. Keeps "unset" language out
 * of the formatter itself so no caller invents its own `¥` formatting.
 */
export function formatCurrencyOr(
  value: string | number | null | undefined,
  fallback: string,
): string {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : formatCurrency(value);
}
