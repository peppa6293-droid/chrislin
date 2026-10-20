import { useEffect, useState } from "react";
import type { V2ExpenseService } from "../application/v2-expense-service.js";
import { localDate } from "./date.js";
import "./v2-progress.css";

interface V2ProgressProps {
  expenseService: V2ExpenseService;
  profileId: string;
}

const PLACEHOLDER_NODES = ["稳住现金", "理清责任", "建立余地"];

export function V2Progress({ expenseService, profileId }: V2ProgressProps) {
  const [dailyExpenseTotal, setDailyExpenseTotal] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const month = localDate(new Date()).slice(0, 7);
        const summary = await expenseService.getMonthSummary(profileId, month);
        if (cancelled) return;
        setDailyExpenseTotal(summary.dailyExpenseTotal);
        setError(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setDailyExpenseTotal(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [expenseService, profileId]);

  if (error) return <p className="v2-progress__error">数据加载失败，请重试。</p>;
  if (dailyExpenseTotal === null) return <p className="v2-progress__loading">加载中…</p>;

  return (
    <section className="v2-progress" aria-label="进展">
      <article className="v2-progress__node">
        <h2 className="v2-progress__node-title">看清消费</h2>
        <p className="v2-progress__value">本月已花 ¥{dailyExpenseTotal}</p>
        <p className="v2-progress__muted">暂无上月数据</p>
      </article>
      {PLACEHOLDER_NODES.map((title) => (
        <article key={title} className="v2-progress__node v2-progress__node--placeholder">
          <h2 className="v2-progress__node-title">{title}</h2>
          <p className="v2-progress__placeholder">即将开放</p>
        </article>
      ))}
    </section>
  );
}
