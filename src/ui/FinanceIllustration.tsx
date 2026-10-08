import type { CSSProperties } from "react";
import brandWalletSprout from "./assets/finance/brand-wallet-sprout.svg";
import assetsPlant from "./assets/finance/finance-assets-plant@2x.png";
import cashWallet from "./assets/finance/finance-cash-wallet@2x.png";
import debtCards from "./assets/finance/finance-debt-cards@2x.png";
import incomeCoins from "./assets/finance/finance-income-coins@2x.png";
import incomeEmpty from "./assets/finance/finance-income-empty@2x.png";
import incomeFlowCoins from "./assets/finance/finance-income-green-coins.svg";
import planHouse from "./assets/finance/finance-plan-house@2x.png";
import safetySprout from "./assets/finance/finance-safety-sprout@2x.png";
import spendingWallet from "./assets/finance/finance-spending-wallet@2x.png";

export const financeArt = {
  spending: spendingWallet,
  income: incomeCoins,
  incomeFlow: incomeFlowCoins,
  cash: cashWallet,
  assets: assetsPlant,
  safety: safetySprout,
  debt: debtCards,
  plan: planHouse,
  incomeEmpty,
  brand: brandWalletSprout,
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
  const style: CSSProperties | undefined = width ? { width } : undefined;
  return (
    <img
      className={`finance-illustration ${className}`.trim()}
      src={financeArt[kind]}
      alt={decorative ? "" : kind}
      aria-hidden={decorative ? "true" : undefined}
      draggable="false"
      style={style}
      data-finance-illustration={kind}
    />
  );
}
