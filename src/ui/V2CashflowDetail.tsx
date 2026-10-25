import { ArrowDownLeft, PiggyBank } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { V2DetailHero, V2EvidenceCard, V2EvidenceGrid, V2HowCalculated } from "./V2DetailHero.js";
import { V2EmptyState } from "./V2EmptyState.js";

/** §8.1 cashflow: where this month's money goes, by existing proportions only. */
export function V2CashflowDetail({ home }: { home: HomeApplicationState }) {
  const income = money(home.planningIncome);
  if (!income.gt(0)) {
    return (
      <section className="v2-detail-page-body" aria-label="现金流">
        <V2EmptyState
          icon={<PiggyBank size={40} />}
          title="记下一笔后，这里会变清楚"
          body="有了本月的计划和记录，钱的去向会在这里排好队。"
        />
      </section>
    );
  }

  const fixed = money(home.essentialExpenses);
  const daily = money(home.currentMonthSpending);
  const surplus = money(home.baseSurplus);
  const positiveSurplus = surplus.gt(0) ? surplus : money(0);
  const total = fixed.plus(daily).plus(positiveSurplus);
  const scale = Math.max(total.toNumber(), income.toNumber(), 1);
  const shareOf = (value: number) => Math.max(12, (value / scale) * 100);

  const negative = surplus.lt(0);
  const conclusion = negative
    ? "这月花得比进来的多"
    : positiveSurplus.toNumber() >= Math.max(fixed.toNumber(), daily.toNumber())
      ? "还有一部分留给未来"
      : fixed.gt(daily)
        ? "收入主要用在固定支出"
        : "收入主要用在日常支出";

  return (
    <section className="v2-detail-page-body" aria-label="现金流">
      <V2DetailHero
        question="这个月的钱，流向哪里了？"
        badge={conclusion}
        badgeTone={negative ? "danger" : "success"}
      >
        <div className="v2-sankey">
          <div className="v2-sankey-source">
            <span className="v2-sankey-source-icon" aria-hidden="true">
              <ArrowDownLeft size={22} />
            </span>
            <span>本月收入</span>
            <MoneyAmount value={home.planningIncome} size="detail" />
          </div>
          <div className="v2-sankey-bands" aria-hidden="true">
            <span
              className="v2-sankey-band v2-sankey-band--fixed"
              style={{ flexGrow: shareOf(fixed.toNumber()) }}
            >
              <em>固定支出</em>
            </span>
            <span
              className="v2-sankey-band v2-sankey-band--daily"
              style={{ flexGrow: shareOf(daily.toNumber()) }}
            >
              <em>日常支出</em>
            </span>
            {positiveSurplus.gt(0) && (
              <span
                className="v2-sankey-band v2-sankey-band--room"
                style={{ flexGrow: shareOf(positiveSurplus.toNumber()) }}
              >
                <em>余地</em>
              </span>
            )}
          </div>
          <div className="v2-sankey-legend">
            <div>
              <span className="v2-sankey-dot v2-sankey-dot--fixed" aria-hidden="true" />
              <span>固定支出</span>
              <MoneyAmount value={home.essentialExpenses} size="list" />
            </div>
            <div>
              <span className="v2-sankey-dot v2-sankey-dot--daily" aria-hidden="true" />
              <span>日常支出</span>
              <MoneyAmount value={home.currentMonthSpending} size="list" />
            </div>
            <div>
              <span className="v2-sankey-dot v2-sankey-dot--room" aria-hidden="true" />
              <span>余地</span>
              <MoneyAmount value={home.baseSurplus} size="list" />
            </div>
          </div>
        </div>
      </V2DetailHero>

      <V2EvidenceGrid>
        <V2EvidenceCard
          label="每月要覆盖"
          value={<MoneyAmount value={home.monthlyCoreObligations} size="detail" />}
        />
        <V2EvidenceCard
          label="本月应还"
          value={<MoneyAmount value={home.mandatoryDebtService} size="detail" />}
          tone="yellow"
        />
        <V2EvidenceCard
          label="实际进账"
          value={
            home.actualIncomeRecordCount === 0 ? "尚未记录" : `${home.actualIncomeRecordCount} 笔`
          }
          tone="teal"
        />
      </V2EvidenceGrid>

      {negative && (
        <p className="v2-detail-advice" role="status">
          先看看日常支出，不急着一次改完；记下这个月的缺口，就已经比昨天清楚。
        </p>
      )}

      <V2HowCalculated>
        <p>
          预计进账减去固定支出、日常支出，剩下的就是这个月的余地。彩带只表达现有口径的比例，
          不会为了好看重新计算金额。预计进账和实际到账是两回事，记下收入也不会自动改变手头现金。
        </p>
      </V2HowCalculated>
    </section>
  );
}
