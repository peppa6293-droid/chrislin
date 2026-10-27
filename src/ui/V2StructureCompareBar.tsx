import { money } from "../model/money.js";
import { formatCurrency } from "./money-format.js";

/** 收入 / 固定负担双条对比。轨道 aria-hidden，金额以文本给出，不做 progressbar。 */
export function V2StructureCompareBar({
  income,
  essentialExpenses,
  mandatoryDebtService,
}: {
  income: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
}) {
  const incomeValue = money(income);
  const essential = money(essentialExpenses);
  const debt = money(mandatoryDebtService);
  const burden = essential.plus(debt);
  const scale = incomeValue.gt(burden) ? incomeValue : burden;
  const share = (value: typeof burden) =>
    scale.lte(0) ? 0 : value.dividedBy(scale).times(100).toNumber();

  const incomePercent = share(incomeValue);
  const essentialPercent = share(essential);
  const debtPercent = share(debt);
  const burdenPercent = share(burden);
  const overhang = burden.gt(incomeValue);

  return (
    <div className="v2-structure-bar">
      <div className="v2-structure-bar__row">
        <span className="v2-structure-bar__label">收入</span>
        <span className="v2-structure-bar__track" aria-hidden="true">
          <span
            className="v2-structure-bar__fill is-income"
            style={{ width: `${incomePercent}%` }}
          />
        </span>
        <span className="v2-structure-bar__amount">{formatCurrency(income)}</span>
      </div>
      <div className="v2-structure-bar__row">
        <span className="v2-structure-bar__label">固定负担</span>
        <span className="v2-structure-bar__track" aria-hidden="true">
          <span
            className="v2-structure-bar__fill is-essential"
            style={{ width: `${essentialPercent}%` }}
          />
          <span className="v2-structure-bar__fill is-debt" style={{ width: `${debtPercent}%` }} />
          {overhang && (
            <>
              <span
                className="v2-structure-bar__overhang"
                style={{ left: `${incomePercent}%`, width: `${burdenPercent - incomePercent}%` }}
              />
              <span className="v2-structure-bar__tick" style={{ left: `${incomePercent}%` }} />
            </>
          )}
        </span>
        <span className="v2-structure-bar__amount">{formatCurrency(burden.toString())}</span>
      </div>
    </div>
  );
}
