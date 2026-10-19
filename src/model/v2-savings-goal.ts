import { Decimal } from "decimal.js";
import {
  calculateBillStatus,
  type BillStatus,
  type CreditCardBill,
} from "./v2-cashflow.js";

const MONEY_SCALE = 2;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type SavingsGoalStatus = "ON_TRACK" | "COMPLETED" | "SHORTFALL" | "OVERDUE";

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: string;
  targetDate: string;
  currentSaved: string;
}

export interface SavingsPlan {
  goalId: string;
  goalName: string;
  targetAmount: string;
  currentSaved: string;
  gap: string;
  monthsRemaining: number;
  monthlyTarget: string;
  status: SavingsGoalStatus;
  explanation: string;
}

export interface SavingsCashContext {
  availableCash: string;
  asOf: string;
  bills: CreditCardBill[];
}

function parseDate(value: string, field: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`${field} must use YYYY-MM-DD format`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError(`${field} must be a valid calendar date`);
  }
  return date;
}

function money(value: string, field: string, allowZero = false): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new RangeError(`${field} must be a valid decimal amount`);
  }
  if (!parsed.isFinite() || (allowZero ? parsed.isNegative() : parsed.isZero() || parsed.isNegative())) {
    throw new RangeError(`${field} must be ${allowZero ? "zero or positive" : "positive"}`);
  }
  return parsed.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

function fmt(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

/**
 * Calculate whole months between two dates.
 * Uses year*12+month difference; if the end day < start day, subtract one month.
 */
function monthsBetween(from: Date, to: Date): number {
  const yDiff = to.getUTCFullYear() - from.getUTCFullYear();
  const mDiff = to.getUTCMonth() - from.getUTCMonth();
  let months = yDiff * 12 + mDiff;
  if (to.getUTCDate() < from.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

export function createSavingsGoal(input: Omit<SavingsGoal, "id"> & { id?: string }): SavingsGoal {
  const target = money(input.targetAmount, "targetAmount");
  const saved = money(input.currentSaved, "currentSaved", true);
  if (saved.gt(target)) {
    throw new RangeError("currentSaved cannot exceed targetAmount");
  }
  parseDate(input.targetDate, "targetDate");
  if (!input.name || input.name.trim().length === 0) {
    throw new RangeError("name must not be empty");
  }
  return {
    id: input.id ?? `goal-${Date.now()}`,
    name: input.name.trim(),
    targetAmount: fmt(target),
    targetDate: input.targetDate,
    currentSaved: fmt(saved),
  };
}

/**
 * Sum all outstanding bill remaining amounts via L-04 calculateBillStatus.
 * This is a read-only call; no L-04 files are modified.
 */
function totalOutstandingBills(
  bills: CreditCardBill[],
  asOf: string,
): Decimal {
  let total = new Decimal(0);
  for (const bill of bills) {
    const status: BillStatus = calculateBillStatus(bill, { asOf, availableCash: "0.00" });
    total = total.plus(status.remainingAmount);
  }
  return total.toDecimalPlaces(MONEY_SCALE);
}

export function calculateSavingsPlan(
  goal: SavingsGoal,
  asOf: string,
): SavingsPlan {
  const now = parseDate(asOf, "asOf");
  const target = money(goal.targetAmount, "targetAmount");
  const saved = money(goal.currentSaved, "currentSaved", true);
  const targetDate = parseDate(goal.targetDate, "targetDate");

  const gap = target.minus(saved).toDecimalPlaces(MONEY_SCALE);
  const completed = gap.lte(0);
  const pastDue = !completed && now > targetDate;
  const monthsLeft = completed ? 0 : monthsBetween(now, targetDate);

  let monthlyTarget: Decimal;
  if (completed) {
    monthlyTarget = new Decimal(0);
  } else if (monthsLeft <= 0) {
    // Target date has passed or is today with remaining gap
    monthlyTarget = gap;
  } else {
    monthlyTarget = gap.div(monthsLeft).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
  }

  let status: SavingsGoalStatus;
  let explanation: string;

  if (completed) {
    status = "COMPLETED";
    explanation = `${goal.name}已经存够了，目标金额 ${fmt(target)} 已全部完成。`;
  } else if (pastDue) {
    status = "OVERDUE";
    explanation = `${goal.name}的目标日期已过，还差 ${fmt(gap)} 没有存到。可以重新设定一个更合适的日期。`;
  } else if (monthsLeft === 0) {
    status = "SHORTFALL";
    explanation = `${goal.name}距离目标日期不到一个月，还需要再存 ${fmt(gap)}。`;
  } else {
    status = "ON_TRACK";
    explanation = `${goal.name}还差 ${fmt(gap)}，距离目标还有 ${monthsLeft} 个月，平均每月需要存 ${fmt(monthlyTarget)}。`;
  }

  return {
    goalId: goal.id,
    goalName: goal.name,
    targetAmount: fmt(target),
    currentSaved: fmt(saved),
    gap: fmt(gap),
    monthsRemaining: monthsLeft,
    monthlyTarget: fmt(monthlyTarget),
    status,
    explanation,
  };
}

export interface AffordableSavingsResult {
  goalId: string;
  goalName: string;
  monthlyTarget: string;
  affordableAmount: string;
  canAfford: boolean;
  outstandingBills: string;
  safeToSave: string;
  explanation: string;
}

/**
 * Determine how much can actually be saved after reserving cash for
 * outstanding credit-card bills (via L-04 calculateBillStatus).
 *
 * affordableAmount = max(0, availableCash - totalOutstandingBills)
 * The user should not treat bill-repayment cash as savable funds.
 */
export function calculateAffordableSavings(
  goal: SavingsGoal,
  context: SavingsCashContext,
): AffordableSavingsResult {
  const plan = calculateSavingsPlan(goal, context.asOf);
  const cash = money(context.availableCash, "availableCash", true);
  const outstanding = totalOutstandingBills(context.bills, context.asOf);
  const safe = cash.minus(outstanding).toDecimalPlaces(MONEY_SCALE);
  const safeToSave = safe.lt(0) ? new Decimal(0) : safe;
  const monthlyNeeded = new Decimal(plan.monthlyTarget);
  const canAfford = safeToSave.gte(monthlyNeeded);

  let explanation: string;
  if (plan.status === "COMPLETED") {
    explanation = `${goal.name}已经完成，不需要再额外存钱。`;
  } else if (outstanding.gt(0) && safeToSave.lt(monthlyNeeded)) {
    explanation = `当前有 ${fmt(outstanding)} 的信用卡账单待还，扣除后可用现金为 ${fmt(safeToSave)}，不够本月计划存的 ${fmt(monthlyNeeded)}。先确保还清账单再存钱会更安心。`;
  } else if (!canAfford) {
    explanation = `扣除待还账单后，可用现金 ${fmt(safeToSave)} 仍不足以覆盖本月计划存的 ${fmt(monthlyNeeded)}。可以适当调整目标日期或每月存入金额。`;
  } else {
    explanation = `扣除 ${fmt(outstanding)} 的待还账单后，可用现金足够本月存 ${fmt(monthlyNeeded)}，可以放心按计划存钱。`;
  }

  return {
    goalId: goal.id,
    goalName: goal.name,
    monthlyTarget: plan.monthlyTarget,
    affordableAmount: fmt(safeToSave),
    canAfford,
    outstandingBills: fmt(outstanding),
    safeToSave: fmt(safeToSave),
    explanation,
  };
}
