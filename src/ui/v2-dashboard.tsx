import { Banknote, Landmark, ReceiptText, RefreshCw, ShoppingCart, Wallet } from "lucide-react";
import type { BillStatus } from "../model/v2-cashflow.js";
import type { AffordableSavingsResult, SavingsPlan } from "../model/v2-savings-goal.js";
import type { TrendSummary } from "../model/v2-trends.js";
import { TrendPanel, type TrendWindow } from "./v2-trends.js";

export interface DashboardLedgerSummary {
  income: string;
  dailyExpense: string;
  accountCash: string;
  recurringIncome: string;
  incomeIncludesOneTime: boolean;
}

export interface V2DashboardProps {
  ledger: DashboardLedgerSummary;
  billStatuses: BillStatus[];
  savingsPlans: SavingsPlan[];
  affordableSavings: AffordableSavingsResult[];
  trendSummary: TrendSummary | null;
  trendWindow: TrendWindow;
  reducedMotion?: boolean;
}

function formatAmount(value: string): string {
  if (!value) return "0.00";
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

export function V2Dashboard({
  ledger,
  billStatuses,
  savingsPlans,
  affordableSavings,
  trendSummary,
  trendWindow,
  reducedMotion = false,
}: V2DashboardProps) {
  const motionClass = reducedMotion ? "v2-dashboard v2-dashboard--reduced" : "v2-dashboard";

  return (
    <main className={motionClass} data-testid="v2-dashboard" aria-label="个人财务综合面板">
      <h1 className="v2-dashboard__title">财务概览</h1>

      {/* 收支与现金 */}
      <section className="v2-dashboard__section" aria-label="收支与账户现金">
        <h2>收入、日常支出与账户现金</h2>
        <div className="v2-dashboard__grid">
          <section className="v2-dashboard__card" aria-label="收入">
            <span className="v2-dashboard__icon v2-dashboard__icon--coral" aria-hidden="true">
              <Wallet size={18} />
            </span>
            <p className="v2-dashboard__label">收入</p>
            <p className="v2-dashboard__amount">{formatAmount(ledger.income)}</p>
            {ledger.incomeIncludesOneTime ? (
              <span className="v2-dashboard__label" data-testid="income-one-time-badge">
                含一次性收入
              </span>
            ) : null}
          </section>
          <section className="v2-dashboard__card" aria-label="日常支出">
            <span className="v2-dashboard__icon v2-dashboard__icon--yellow" aria-hidden="true">
              <ShoppingCart size={18} />
            </span>
            <p className="v2-dashboard__label">日常支出</p>
            <p className="v2-dashboard__amount">{formatAmount(ledger.dailyExpense)}</p>
          </section>
          <section className="v2-dashboard__card" aria-label="账户现金">
            <span className="v2-dashboard__icon v2-dashboard__icon--coral" aria-hidden="true">
              <Banknote size={18} />
            </span>
            <p className="v2-dashboard__label">账户现金</p>
            <p className="v2-dashboard__amount">{formatAmount(ledger.accountCash)}</p>
          </section>
        </div>
      </section>

      {/* 信用卡待还与到期压力 */}
      <section className="v2-dashboard__section" aria-label="信用卡待还与到期压力">
        <h2>债务确认：信用卡待还</h2>
        {billStatuses.length === 0 ? (
          <p role="status" className="v2-dashboard__empty">
            当前没有待还账单。
          </p>
        ) : (
          <ul className="v2-dashboard__list">
            {billStatuses.map((bill) => (
              <li key={bill.billId} className="v2-dashboard__list-item" data-testid="v2-bill-item">
                <div className="v2-dashboard__bill-header">
                  <span className="v2-dashboard__label">待还金额</span>
                  <span className="v2-dashboard__amount">{formatAmount(bill.remainingAmount)}</span>
                </div>
                <div className="v2-dashboard__bill-meta">
                  <span>
                    已还 {formatAmount(bill.paidAmount)} / 应还 {formatAmount(bill.amountDue)}
                  </span>
                  <span
                    className={`v2-dashboard__pressure v2-dashboard__pressure--${bill.pressure.toLowerCase()}`}
                    data-testid="v2-pressure-badge"
                    role="status"
                    aria-label={`现金压力状态：${bill.pressure}`}
                  >
                    {bill.pressure === "NONE" && "已还清"}
                    {bill.pressure === "UPCOMING" && "待还款"}
                    {bill.pressure === "SHORTFALL" && "现金不足"}
                    {bill.pressure === "OVERDUE" && "已逾期"}
                  </span>
                </div>
                <p className="v2-dashboard__explanation" role="status">
                  {bill.explanation}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 储蓄目标 */}
      <section className="v2-dashboard__section" aria-label="储蓄目标与计划">
        <h2>安全储备：储蓄目标</h2>
        {savingsPlans.length === 0 ? (
          <p role="status" className="v2-dashboard__empty">
            还没有设定储蓄目标。
          </p>
        ) : (
          <ul className="v2-dashboard__list">
            {savingsPlans.map((plan) => {
              const affordable = affordableSavings.find((a) => a.goalId === plan.goalId);
              return (
                <li
                  key={plan.goalId}
                  className="v2-dashboard__list-item"
                  data-testid="v2-savings-item"
                >
                  <div className="v2-dashboard__savings-header">
                    <h3>{plan.goalName}</h3>
                    <span
                      className={`v2-dashboard__status v2-dashboard__status--${plan.status.toLowerCase()}`}
                      data-testid="v2-savings-status"
                      role="status"
                      aria-label={`储蓄状态：${plan.status}`}
                    >
                      {plan.status === "COMPLETED" && "已完成"}
                      {plan.status === "ON_TRACK" && "正常推进"}
                      {plan.status === "SHORTFALL" && "缺口不足"}
                      {plan.status === "OVERDUE" && "已逾期"}
                    </span>
                  </div>
                  <div className="v2-dashboard__grid v2-dashboard__grid--compact">
                    <div>
                      <span className="v2-dashboard__label">目标金额</span>
                      <span>{formatAmount(plan.targetAmount)}</span>
                    </div>
                    <div>
                      <span className="v2-dashboard__label">当前已存</span>
                      <span>{formatAmount(plan.currentSaved)}</span>
                    </div>
                    <div>
                      <span className="v2-dashboard__label">剩余缺口</span>
                      <span>{formatAmount(plan.gap)}</span>
                    </div>
                    <div>
                      <span className="v2-dashboard__label">月均保留</span>
                      <span>{formatAmount(plan.monthlyTarget)}</span>
                    </div>
                  </div>
                  <p className="v2-dashboard__explanation" role="status">
                    {plan.explanation}
                  </p>
                  {affordable && (
                    <div className="v2-dashboard__affordable" data-testid="v2-affordable-info">
                      <p>
                        <span className="v2-dashboard__label">本月可安全存入：</span>
                        {formatAmount(affordable.safeToSave)}
                        {affordable.canAfford
                          ? "（足够完成本月计划）"
                          : "（不足以覆盖本月计划，需先确保还清账单）"}
                      </p>
                      <p role="status">{affordable.explanation}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 资产与债务占位（保留必需名称） */}
      <section className="v2-dashboard__section" aria-label="资产与债务概览">
        <h2>资产与债务</h2>
        <div className="v2-dashboard__grid">
          <section className="v2-dashboard__card" aria-label="资产">
            <span className="v2-dashboard__icon v2-dashboard__icon--lavender" aria-hidden="true">
              <Landmark size={18} />
            </span>
            <p className="v2-dashboard__label">资产</p>
            <p className="v2-dashboard__placeholder">待接入</p>
          </section>
          <section className="v2-dashboard__card" aria-label="债务">
            <span className="v2-dashboard__icon v2-dashboard__icon--blue" aria-hidden="true">
              <ReceiptText size={18} />
            </span>
            <p className="v2-dashboard__label">债务</p>
            <p className="v2-dashboard__placeholder">待接入</p>
          </section>
          <section className="v2-dashboard__card" aria-label="资产更新">
            <span className="v2-dashboard__icon v2-dashboard__icon--lavender" aria-hidden="true">
              <RefreshCw size={18} />
            </span>
            <p className="v2-dashboard__label">资产更新</p>
            <p className="v2-dashboard__placeholder">待接入</p>
          </section>
        </div>
      </section>

      {/* 收支趋势 */}
      <section className="v2-dashboard__section" aria-label="收支趋势">
        <h2>收支趋势</h2>
        {trendSummary ? (
          <TrendPanel summary={trendSummary} window={trendWindow} reducedMotion={reducedMotion} />
        ) : (
          <p role="status" className="v2-dashboard__empty">
            暂无趋势数据。
          </p>
        )}
      </section>
    </main>
  );
}
