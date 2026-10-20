import { useEffect, useState } from "react";
import type { HomeApplicationState } from "../application/product-service.js";
import type { V2ExpenseService } from "../application/v2-expense-service.js";
import type { SafetyCoverageStatus } from "../model/types.js";
import { localDate } from "./date.js";
import "./v2-progress.css";

interface V2ProgressProps {
  expenseService: V2ExpenseService;
  loadHomeState: (asOfDate: string) => Promise<HomeApplicationState>;
  profileId: string;
}

const SAFETY_COVERAGE_STATUS_COPY = {
  NORMAL: "安全垫正常",
  NO_CORE_OBLIGATION: "暂无需要覆盖的核心支出",
} satisfies Record<SafetyCoverageStatus, string>;

const CASH_SAFETY_GATE_STATUS_COPY = {
  ACTIVE: "现金低于安全线",
  CLEAR: "现金高于安全线",
  NOT_APPLICABLE: "安全线暂不适用",
} satisfies Record<Extract<HomeApplicationState["cashSafetyGateStatus"], string>, string>;

export function V2Progress({ expenseService, loadHomeState, profileId }: V2ProgressProps) {
  const [dailyExpenseTotal, setDailyExpenseTotal] = useState<string | null>(null);
  const [homeState, setHomeState] = useState<HomeApplicationState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const asOfDate = localDate(new Date());
        const month = asOfDate.slice(0, 7);
        const [summary, home] = await Promise.all([
          expenseService.getMonthSummary(profileId, month),
          loadHomeState(asOfDate),
        ]);
        if (cancelled) return;
        setDailyExpenseTotal(summary.dailyExpenseTotal);
        setHomeState(home);
        setError(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setDailyExpenseTotal(null);
          setHomeState(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [expenseService, loadHomeState, profileId]);

  if (error) return <p className="v2-progress__error">数据加载失败，请重试。</p>;
  if (dailyExpenseTotal === null || homeState === null)
    return <p className="v2-progress__loading">加载中…</p>;

  const cashCoverageCopy =
    homeState.cashCoverageMonths === null
      ? "覆盖月数待计算"
      : `可覆盖 ${homeState.cashCoverageMonths} 个月（最低要求 ${homeState.minimumCashCoverageMonths} 个月）`;
  const safetyCoverageCopy =
    homeState.safetyCoverageMonths === null
      ? null
      : `可覆盖 ${homeState.safetyCoverageMonths} 个月`;

  return (
    <section className="v2-progress" aria-label="进展">
      <article className="v2-progress__node">
        <h2 className="v2-progress__node-title">看清消费</h2>
        <p className="v2-progress__value">本月已花 ¥{dailyExpenseTotal}</p>
        <p className="v2-progress__muted">暂无上月数据</p>
      </article>
      <article className="v2-progress__node">
        <h2 className="v2-progress__node-title">稳住现金</h2>
        <p className="v2-progress__value">现金 ¥{homeState.currentCash}</p>
        <p className="v2-progress__muted">{cashCoverageCopy}</p>
        <p className="v2-progress__status">
          {CASH_SAFETY_GATE_STATUS_COPY[homeState.cashSafetyGateStatus]}
        </p>
      </article>
      <article className="v2-progress__node">
        <h2 className="v2-progress__node-title">理清责任</h2>
        <p className="v2-progress__value">总债务 ¥{homeState.totalDebt}</p>
        <p className="v2-progress__muted">本月还款义务 ¥{homeState.mandatoryDebtService}</p>
        <p className="v2-progress__muted">
          {homeState.debts.length === 0 ? "暂无债务记录" : `${homeState.debts.length} 笔债务`}
        </p>
      </article>
      <article className="v2-progress__node">
        <h2 className="v2-progress__node-title">建立余地</h2>
        <p className="v2-progress__value">
          安全垫 ¥{homeState.safetyResources} / 目标 ¥{homeState.safetyTargetResources}
        </p>
        {safetyCoverageCopy === null ? null : (
          <p className="v2-progress__muted">{safetyCoverageCopy}</p>
        )}
        <p className="v2-progress__status">
          {SAFETY_COVERAGE_STATUS_COPY[homeState.safetyCoverageStatus]}
        </p>
      </article>
    </section>
  );
}
