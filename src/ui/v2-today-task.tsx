import { useEffect, useState } from "react";
import {
  isRecordTask,
  selectTodayTask,
  TASK_COPY,
  type TaskContext,
} from "../model/v2-task-selector.js";
import type { Repositories } from "../persistence/repositories.js";
import { localDate } from "./date.js";
import "./v2-today-task.css";

interface V2TodayTaskProps {
  repositories: Repositories;
  profileId: string;
  onGoRecord: () => void;
}

export function V2TodayTask({ repositories, profileId, onGoRecord }: V2TodayTaskProps) {
  const [task, setTask] = useState<{
    taskId: ReturnType<typeof selectTodayTask>;
    todayCount: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const today = localDate(new Date());
        const expenses = await repositories.listV2Expenses(profileId, today.slice(0, 7));
        if (cancelled) return;
        const context: TaskContext = {
          hasStructuralDeficit: false,
          belowCashFloor: false,
          consumptionIsPrimaryDrag: false,
          hasMissingDebtFact: false,
          hasSafetyGap: false,
          monthExpenseCount: expenses.length,
        };
        setTask({
          taskId: selectTodayTask(context),
          todayCount: expenses.filter((expense) => expense.occurredOn === today).length,
        });
      } catch {
        if (!cancelled) setTask(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId, repositories]);

  if (!task) return null;
  const copy = TASK_COPY[task.taskId];
  const done = isRecordTask(task.taskId) && task.todayCount > 0;

  return (
    <section className="v2-today-task" aria-label="今日任务">
      <h2 className="v2-today-task__title">{copy.title}</h2>
      <p className="v2-today-task__reason">{copy.reason}</p>
      <p className="v2-today-task__duration">{copy.duration}</p>
      <button type="button" className="v2-today-task__action" disabled={done} onClick={onGoRecord}>
        {done ? "已完成" : copy.action}
      </button>
      {done ? <p className="v2-today-task__done-note">今天已记 {task.todayCount} 笔</p> : null}
    </section>
  );
}
