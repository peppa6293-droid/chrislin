// V1 mapping was implemented in U-08/build-35. The decision rules are listed in
// the mapping table in section 1 of docs/EXEC-U08-INSTRUCTIONS.md:
// hasStructuralDeficit <- HomeApplicationState.spendingStatus === "STRUCTURAL_DEFICIT"
// belowCashFloor <- HomeApplicationState.cashSafetyGateStatus === "ACTIVE"
// consumptionIsPrimaryDrag <- HomeApplicationState.primaryDrag === "CONSUMPTION"
// hasMissingDebtFact <- FinancialMaintenanceState.debts[].needsCurrentMonthFact
// hasSafetyGap <- hasPositiveSafetyGap(HomeApplicationState.safetyGap)

import { money } from "./money.js";

/** Whether the safety gap is positive; money comparisons stay in the model layer. */
export function hasPositiveSafetyGap(safetyGap: string): boolean {
  return money(safetyGap).gt(0);
}

export interface TaskContext {
  hasStructuralDeficit: boolean;
  belowCashFloor: boolean;
  consumptionIsPrimaryDrag: boolean;
  hasMissingDebtFact: boolean;
  hasSafetyGap: boolean;
  monthExpenseCount: number;
}

export type TaskId =
  | "CLARIFY_GAP"
  | "SECURE_CASH"
  | "CONFIRM_DEBT"
  | "CHECK_SAFETY"
  | "RECORD_EXPENSE"
  | "DEFAULT_RECORD";

export const TASK_COPY: Record<
  TaskId,
  { title: string; reason: string; duration: string; action: string }
> = {
  CLARIFY_GAP: {
    title: "把本月收支缺口理清",
    reason: "本月支出超过了收入，先看清现状",
    duration: "约 3 分钟",
    action: "去记录",
  },
  SECURE_CASH: {
    title: "先让手里的现金安心一点",
    reason: "现金低于安全线，先稳住手头",
    duration: "约 3 分钟",
    action: "去记录",
  },
  CONFIRM_DEBT: {
    title: "确认本月要还多少",
    reason: "本月债务事实还没确认",
    duration: "约 2 分钟",
    action: "去记录",
  },
  CHECK_SAFETY: {
    title: "看看安全垫离目标还有多远",
    reason: "安全垫还有缺口",
    duration: "约 2 分钟",
    action: "去记录",
  },
  RECORD_EXPENSE: {
    title: "记下一笔今天的花销",
    reason: "每一笔记录都让画面更完整",
    duration: "约 10 秒",
    action: "去记录",
  },
  DEFAULT_RECORD: {
    title: "记下第一笔花销",
    reason: "从第一笔开始，建立你的财务画面",
    duration: "约 10 秒",
    action: "去记录",
  },
};

export function selectTodayTask(context: TaskContext): TaskId {
  const recordTask: TaskId = context.monthExpenseCount === 0 ? "DEFAULT_RECORD" : "RECORD_EXPENSE";
  if (context.hasStructuralDeficit) return "CLARIFY_GAP";
  if (context.belowCashFloor) return "SECURE_CASH";
  if (context.consumptionIsPrimaryDrag) return recordTask;
  if (context.hasMissingDebtFact) return "CONFIRM_DEBT";
  if (context.hasSafetyGap) return "CHECK_SAFETY";
  return recordTask;
}

export function isRecordTask(taskId: TaskId): boolean {
  return taskId === "RECORD_EXPENSE" || taskId === "DEFAULT_RECORD";
}
