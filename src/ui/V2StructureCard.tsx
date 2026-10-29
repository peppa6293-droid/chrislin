import { ArrowRight, WalletCards } from "lucide-react";
import { useState } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { CARD_DISABLED_TITLE, type CardStatus } from "./card-status.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { structureSurplus } from "./structure-ring.js";
import { type RingKey, V2StructureRings } from "./V2StructureRings.js";

const KICKER = "每月固定收支";
const INCOMPLETE_TITLE = "资料不齐，花点时间补一下";

const STRUCTURE_BANDS = {
  STEADY: "账单：不是，他怎么还剩钱？",
  TIGHT: "钱包：还活着，先别开香槟。",
  EVEN: "工资：来过，爱过，没留过。",
  MILD_DEFICIT: "工资：你们分赃怎么不带我商量？",
  DEEP_DEFICIT: "收入：我一个人打五个？",
} as const;

const ZERO_INCOME_COPY = {
  WITH_BURDEN: "收入：暂未出场。账单：戏份拉满。",
  ALL_ZERO: "收入：你不来？账单：那我也不来了。",
} as const;

type StructureBand = keyof typeof STRUCTURE_BANDS;

/** Long-term structure: income minus fixed expenses and debt service. */
export function V2StructureCard({
  home,
  pendingDebtFactNames,
  onOpenFixedExpenses,
  onOpenDebt,
  onOpenCashflow,
  status = "ready",
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  onOpenFixedExpenses: () => void;
  onOpenDebt: () => void;
  onOpenCashflow: () => void;
  status?: CardStatus;
}) {
  const [selected, setSelected] = useState<RingKey | null>(null);
  const essentialExpenses = money(home.essentialExpenses);
  const mandatoryDebtService = money(home.mandatoryDebtService);
  const burden = essentialExpenses.plus(mandatoryDebtService);
  // B-01/B-02：三个数同源，都读所选月份实际收入（income_records）。
  const structure = structureSurplus({
    income: home.actualIncomeTotal,
    essentialExpenses: home.essentialExpenses,
    mandatoryDebtService: home.mandatoryDebtService,
  });
  const surplus = structure.available && structure.amount != null ? money(structure.amount) : null;

  const pending = pendingDebtFactNames.length > 0;
  const ratio = pending || structure.ratio == null ? null : money(structure.ratio);
  const band: StructureBand | null =
    ratio == null
      ? null
      : ratio.gte("0.2")
        ? "STEADY"
        : ratio.gt(0)
          ? "TIGHT"
          : ratio.eq(0)
            ? "EVEN"
            : ratio.gt("-0.1")
              ? "MILD_DEFICIT"
              : "DEEP_DEFICIT";

  const title = pending
    ? INCOMPLETE_TITLE
    : band != null
      ? STRUCTURE_BANDS[band]
      : burden.gt(0)
        ? ZERO_INCOME_COPY.WITH_BURDEN
        : ZERO_INCOME_COPY.ALL_ZERO;

  const tone =
    pending || surplus == null
      ? ""
      : surplus.lt(0)
        ? "is-short"
        : surplus.eq(0)
          ? "is-even"
          : "is-steady";

  const loading = status === "loading";
  const disabled = status === "disabled";
  const titleText = disabled ? CARD_DISABLED_TITLE : title;

  return (
    <section
      className={[
        "v2-card",
        "v2-card--soft",
        "v2-today-snapshot",
        "v2-structure-card",
        tone,
        !pending && surplus != null && surplus.lt(0) ? "v2-card--over" : "",
        disabled ? "v2-card--disabled is-disabled" : "",
        loading ? "is-loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby="v2-structure-title"
      aria-busy={loading || undefined}
      inert={loading}
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">{KICKER}</span>
        <button className="v2-text-button" type="button" onClick={onOpenCashflow}>
          为什么 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2 id="v2-structure-title" className="v2-card__title">
        {titleText}
      </h2>
      <div className="v2-card__value v2-structure-value">
        {pending || surplus == null ? (
          <span role="img" aria-label="结构余量待确认">
            —
          </span>
        ) : (
          <MoneyAmount value={structure.amount} size="summary" />
        )}
        <small>结构余量 · 收入 − 固定支出 − 月供</small>
        {!pending && structure.percent != null && <small>占收入 {structure.percent}</small>}
      </div>
      <V2StructureRings
        income={home.actualIncomeTotal}
        essentialExpenses={home.essentialExpenses}
        mandatoryDebtService={home.mandatoryDebtService}
        pendingDebt={pending}
        selected={selected}
        onToggle={(ring) => setSelected((current) => (current === ring ? null : ring))}
      />
      <div className="v2-card__actions">
        <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenFixedExpenses}>
          <WalletCards size={16} aria-hidden="true" />
          查看固定支出
        </button>
        {(pending || surplus?.lt(0)) && (
          <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenDebt}>
            查看债务
          </button>
        )}
      </div>
      {loading && (
        <div className="v2-card__skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </section>
  );
}
