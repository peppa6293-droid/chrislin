import { useEffect, useState } from "react";
import type { V2ExpenseService } from "../application/v2-expense-service.js";
import type { Repositories } from "../persistence/repositories.js";
import { localDate } from "./date.js";
import "./v2-today.css";

interface V2TodayProps {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
  onGoRecord: () => void;
}

type V2TodayData = {
  dailyExpenseTotal: string;
  entryCount: number;
  recent: Array<{
    id: string;
    amount: string;
    categoryId: string;
    occurredOn: string;
  }>;
};

export function V2Today({ expenseService, repositories, profileId, onGoRecord }: V2TodayProps) {
  const [data, setData] = useState<V2TodayData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const month = localDate(new Date()).slice(0, 7);
        const [summary, recent] = await Promise.all([
          expenseService.getMonthSummary(profileId, month),
          repositories.listV2Expenses(profileId, month),
        ]);
        if (cancelled) return;
        setData({
          dailyExpenseTotal: summary.dailyExpenseTotal,
          entryCount: recent.length,
          recent: [...recent]
            .sort((a, b) => (a.occurredOn === b.occurredOn ? b.id.localeCompare(a.id) : b.occurredOn.localeCompare(a.occurredOn)))
            .slice(0, 3)
            .map((expense) => ({
              id: expense.id,
              amount: expense.amount,
              categoryId: expense.categoryId,
              occurredOn: expense.occurredOn,
            })),
        });
        setError(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setData(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [expenseService, profileId, repositories]);

  if (error) return <p className="v2-today__error">数据加载失败，请重试。</p>;
  if (!data) return <p className="v2-today__loading">加载中…</p>;

  return (
    <section className="v2-today" aria-label="今天">
      <div className="v2-today__summary">
        <h2 className="v2-today__title">这个月</h2>
        <dl className="v2-today__metrics">
          <div className="v2-today__metric">
            <dt>本月已花</dt>
            <dd className="v2-today__amount">¥{data.dailyExpenseTotal}</dd>
          </div>
          <div className="v2-today__metric">
            <dt>个人目标</dt>
            <dd>未设置</dd>
          </div>
          <div className="v2-today__metric">
            <dt>记录笔数</dt>
            <dd>{data.entryCount} 笔</dd>
          </div>
          <div className="v2-today__metric">
            <dt>待还账单</dt>
            <dd>暂无</dd>
          </div>
        </dl>
      </div>

      <div className="v2-today__recent">
        <h2 className="v2-today__title">最近记录</h2>
        {data.recent.length === 0 ? (
          <div className="v2-today__empty">
            <p>还没有记录，记下第一笔吧。</p>
            <button type="button" onClick={onGoRecord}>
              记一笔
            </button>
          </div>
        ) : (
          <>
            <ul className="v2-today__list">
              {data.recent.map((expense) => (
                <li key={expense.id} className="v2-today__row">
                  <span className="v2-today__row-amount">¥{expense.amount}</span>
                  <span>{expense.categoryId}</span>
                  <span>{expense.occurredOn}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onGoRecord}>
              查看全部
            </button>
          </>
        )}
      </div>
    </section>
  );
}
