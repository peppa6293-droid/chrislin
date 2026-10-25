import { ShieldCheck, Wallet } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { V2DetailHero, V2EvidenceCard, V2EvidenceGrid, V2HowCalculated } from "./V2DetailHero.js";
import { V2EmptyState } from "./V2EmptyState.js";
import { V2StatusBadge } from "./V2StatusBadge.js";

const months = (value: number) =>
  Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "0";

/** §8.2 safety: how many months can the earmarked cash carry? */
export function V2SafetyDetail({
  home,
  onOpenCash,
}: {
  home: HomeApplicationState;
  onOpenCash?: () => void;
}) {
  const applicable = home.cashSafetyGateStatus !== "NOT_APPLICABLE";
  const target = home.safetyCoverageTargetMonths;
  const current = Number(home.safetyCoverageMonths);
  const valid = home.safetyCoverageMonths != null && Number.isFinite(current) && current >= 0;
  const hasCash =
    money(home.eligibleCash).gt(0) || money(home.eligibleLiquidInvestmentAssets).gt(0);
  const reached = money(home.safetyGap).lte(0);
  const ratio = target > 0 && valid ? current / target : null;

  if (!applicable) {
    return (
      <section className="v2-detail-page-body" aria-label="安全垫">
        <V2EmptyState
          icon={<ShieldCheck size={40} />}
          title="暂时还不需要安全垫"
          body="先记下必要支出和还款，安全垫的目标才会算出来。"
        />
      </section>
    );
  }

  if (!hasCash && !reached) {
    return (
      <section className="v2-detail-page-body" aria-label="安全垫">
        <V2EmptyState
          icon={<Wallet size={40} />}
          title="先补充账户现金"
          body="把手里真正的现金记进来，才能看出安全垫够不够。"
          action={
            onOpenCash ? (
              <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenCash}>
                查看现金账户
              </button>
            ) : undefined
          }
        />
      </section>
    );
  }

  if (!valid) {
    return (
      <section className="v2-detail-page-body" aria-label="安全垫">
        <p className="v2-detail-error" role="alert">
          暂时算不出来，请检查数据。
        </p>
      </section>
    );
  }

  const conclusion = reached
    ? "安全垫够用了"
    : ratio != null && ratio >= 0.7
      ? "再补一点，会更安心"
      : "先从小目标开始";
  const tone = reached ? "success" : ratio != null && ratio >= 0.7 ? "warn" : "danger";
  const barTone = reached
    ? "normal"
    : ratio != null && ratio >= 0.7
      ? "v2-safety-scale--warn"
      : "v2-safety-scale--short";

  return (
    <section className="v2-detail-page-body" aria-label="安全垫">
      <V2DetailHero question="如果暂时少一笔收入，能撑多久？" badge={conclusion} badgeTone={tone}>
        <div className={`v2-safety-scale ${barTone}`}>
          <div className="v2-safety-scale__track">
            <span
              className="v2-safety-scale__fill"
              style={{ width: `${Math.min(100, Math.max(0, (ratio ?? 0) * 100))}%` }}
            />
            {ratio != null && (
              <span
                className="v2-safety-scale__dot"
                style={{ left: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="v2-safety-scale__labels">
            <span>0 个月</span>
            <span>目标 {months(target)} 个月</span>
          </div>
          <p className="v2-safety-answer">
            目前大约能撑 <strong>{months(current)}</strong> 个月
          </p>
        </div>
      </V2DetailHero>

      <V2EvidenceGrid>
        <V2EvidenceCard
          label="可用现金"
          value={<MoneyAmount value={home.eligibleCash} size="detail" />}
        />
        <V2EvidenceCard
          label="目标"
          value={<MoneyAmount value={home.safetyTargetResources} size="detail" />}
          tone="teal"
        />
        <V2EvidenceCard
          label="还差"
          value={
            reached ? (
              <V2StatusBadge>已达到</V2StatusBadge>
            ) : (
              <MoneyAmount value={home.safetyGap} size="detail" />
            )
          }
          tone={reached ? "teal" : "coral"}
        />
      </V2EvidenceGrid>

      <V2HowCalculated title="这个数怎么算的">
        <p>
          安全垫只统计明确纳入的现金和符合条件的流动投资，乘以每月必须花的钱，得出能覆盖的月数。
          最低现金保障只看纳入的现金，两者不混在一起。
        </p>
      </V2HowCalculated>
    </section>
  );
}
