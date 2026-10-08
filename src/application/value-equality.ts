import { money } from "../model/money.js";

/** Compare stored/user money by numeric value, independent of decimal formatting. */
export function sameMoneyValue(left: string, right: string): boolean {
  try {
    return money(left).eq(money(right));
  } catch {
    return false;
  }
}
