import { formatMoneyExact } from "../model/money.js";

export type MoneyAmountSize = "hero" | "summary" | "detail" | "list" | "inline";

/** Exact, display-only currency text. It never performs business calculations. */
export function MoneyAmount({
  value,
  size = "list",
  className = "",
}: {
  value: string | null | undefined;
  size?: MoneyAmountSize;
  className?: string;
}) {
  if (value == null)
    return <span className={`money-amount-empty ${className}`.trim()}>暂无数据</span>;
  const formatted = formatMoneyExact(value);
  const negative = formatted.startsWith("-");
  const unsigned = negative ? formatted.slice(1) : formatted;
  const [integer = "0", fraction] = unsigned.split(".");
  const number = `${negative ? "-" : ""}${integer}.${(fraction ?? "").padEnd(2, "0")}`;
  const digits = integer.replaceAll(",", "").length;
  const widthClass = digits >= 10 ? "money-amount--wide" : "";
  const longClass = digits >= 6 ? "money-amount--long" : "";
  const ariaText = `${negative ? "负 " : ""}${integer}点${(fraction ?? "").padEnd(2, "0")} 元人民币`;
  return (
    <span
      className={`money-amount money-amount--${size} ${widthClass} ${longClass} ${className}`.trim()}
      role="img"
      aria-label={ariaText}
      data-money-digits={digits}
    >
      {negative ? "-" : ""}¥{number.replace(/^-/, "")}
    </span>
  );
}
