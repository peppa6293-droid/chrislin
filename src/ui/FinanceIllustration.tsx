import { Banknote, House, Inbox, Landmark, ReceiptText, Sprout, Wallet } from "lucide-react";
import type { CSSProperties } from "react";

export const financeArt = {
  income: { icon: Wallet, tone: "coral" },
  cash: { icon: Banknote, tone: "blue" },
  assets: { icon: Landmark, tone: "lavender" },
  debt: { icon: ReceiptText, tone: "yellow" },
  plan: { icon: House, tone: "teal" },
  incomeEmpty: { icon: Inbox, tone: "muted" },
  brand: { icon: Sprout, tone: "teal" },
} as const;

export function FinanceIllustration({
  kind,
  className = "",
  width,
  decorative = true,
}: {
  kind: keyof typeof financeArt;
  className?: string;
  width?: number;
  decorative?: boolean;
}) {
  const { icon: Icon, tone } = financeArt[kind];
  const style: CSSProperties | undefined = width ? { width } : undefined;
  return (
    <span
      className={`finance-icon-tile finance-icon-tile--${tone} ${className}`.trim()}
      style={style}
      aria-hidden={decorative ? true : undefined}
      data-finance-icon={kind}
    >
      <Icon
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : kind}
        role={decorative ? undefined : "img"}
        focusable="false"
        strokeWidth={1.75}
      />
    </span>
  );
}
