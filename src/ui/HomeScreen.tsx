import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { SaveCurrentMonthDebtFactResult } from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import { assertUserInputMoney, formatMoneyExact, money } from "../model/money.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import { localDateTime } from "./date.js";
import { FinanceIllustration } from "./FinanceIllustration.js";
import { FinancialMaintenanceDialog } from "./FinancialMaintenanceDialog.js";
import { MoneyAmount, type MoneyAmountSize } from "./MoneyAmount.js";
import { MyFinancePages, type MyFinanceRoute } from "./MyFinancePages.js";

const trendCopy: Record<string, string> = {
  IMPROVING_STRONGLY: "本月状态明显改善",
  IMPROVING: "本月状态有所改善",
  STABLE: "本月状态保持平稳",
  UNDER_PRESSURE: "本月需要留意",
  DETERIORATING: "本月状态正在承压",
  BASELINE_BUILDING: "财务基准建立中",
};
const spendingStatusCopy: Record<HomeApplicationState["spendingStatus"], string> = {
  NORMAL: "按当前计划有结余",
  STRUCTURAL_DEFICIT: "这个月的计划有缺口",
  BALANCED_NO_SURPLUS: "按当前计划基本持平",
};
const categoryLabels: Record<string, string> = {
  FOOD: "餐饮",
  TRANSPORT: "交通",
  SHOPPING: "购物",
  ENTERTAINMENT: "娱乐",
  HOUSEHOLD: "日用",
  OTHER_VARIABLE: "其他",
};

type HomeDetailRoute = "SPENDING_DETAIL" | "CASHFLOW_DETAIL" | "SAFETY_DETAIL" | "DEBT_DETAIL";
type HomeRoute = "HOME" | HomeDetailRoute | MyFinanceRoute;

const routeTitle: Record<Exclude<HomeRoute, "HOME">, string> = {
  SPENDING_DETAIL: "本月可变消费",
  CASHFLOW_DETAIL: "本月计划收支",
  SAFETY_DETAIL: "安全垫情况",
  DEBT_DETAIL: "债务与本月还款",
  MY_FINANCE: "我的财务",
  INCOME_LIST: "收入",
  PLANNING_INCOME: "稳定月收入",
  MONTH_PLANNING: "本月计划收入",
  CASH_LIST: "现金",
  ASSET_LIST: "资产",
  DEBT_LIST: "债务",
  SAFETY_LIST: "安全目标",
};

const spendingStatusDetail: Record<HomeApplicationState["spendingStatus"], string> = {
  NORMAL: "本月收入计划覆盖必要生活支出和本月需要还款后仍有结余。",
  STRUCTURAL_DEFICIT: "本月收入计划不足以覆盖必要生活支出和本月需要还款。",
  BALANCED_NO_SURPLUS: "本月收入计划基本用于覆盖必要生活支出和本月需要还款。",
};

function cashFloorLabel(cashFloorMet: HomeApplicationState["cashFloorMet"]): string {
  if (cashFloorMet === true) return "现金安全线已达到";
  if (cashFloorMet === false) return "现金安全线未达标";
  return "现金安全线暂不适用";
}

function overallGateLabel(status: HomeApplicationState["cashSafetyGateStatus"]): string {
  if (status === "NOT_APPLICABLE") return "整体安全状态暂不适用";
  if (status === "CLEAR") return "整体安全状态正常";
  return "整体安全状态受限";
}

function homeSafetySummary(home: HomeApplicationState): string {
  if (home.cashSafetyGateStatus === "NOT_APPLICABLE")
    return overallGateLabel(home.cashSafetyGateStatus);
  if (home.cashSafetyGateStatus === "CLEAR") return overallGateLabel(home.cashSafetyGateStatus);
  if (home.spendingStatus === "STRUCTURAL_DEFICIT") return "这个月的计划有缺口";
  if (home.cashFloorMet === false) return "现金安全线未达标";
  return overallGateLabel(home.cashSafetyGateStatus);
}

const trendDetail: Record<string, string> = {
  IMPROVING_STRONGLY: "明显改善",
  IMPROVING: "有所改善",
  STABLE: "保持平稳",
  UNDER_PRESSURE: "需要留意",
  DETERIORATING: "正在承压",
  BASELINE_BUILDING: "基准建立中",
};

const dimensions: Record<string, string> = {
  LIQUIDITY_SAFETY: "现金安全",
  DEBT: "债务",
  CONSUMPTION: "消费",
  WEALTH: "流动资产",
};

export function HomeScreen({
  home,
  asOfDate,
  isSessionDateCurrent = () => true,
  wp03PreviewDateControl = null,
  pendingDebtFactNames = [],
  onRecordExpense,
  onLoadFinancialMaintenance,
  onGetFinancialMaintenanceRequirement,
  onUpdateFinancialData,
  onGetPlanningMonth,
  onSavePlanningMonth,
  onReviseActualIncome,
  onDeactivateCashAccount,
  onDeactivateAsset,
  onDeactivateDebt,
  onSaveCurrentMonthDebtFact,
}: {
  home: HomeApplicationState;
  asOfDate?: string;
  isSessionDateCurrent?: () => boolean;
  wp03PreviewDateControl?: ReactNode;
  pendingDebtFactNames?: string[];
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<void>;
  onLoadFinancialMaintenance: (asOfDate: string) => Promise<FinancialMaintenanceState>;
  onGetFinancialMaintenanceRequirement: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  onUpdateFinancialData: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<FinancialMaintenanceState>;
  onGetPlanningMonth?: ((month: string) => Promise<V4FinancialReadState>) | undefined;
  onSavePlanningMonth?:
    | ((month: string, decision: PlanningIncomeMonthDecision) => Promise<void>)
    | undefined;
  onReviseActualIncome?:
    | ((input: {
        incomeId: string;
        periodMonth: string;
        amount: string;
        status: "EXPECTED" | "PENDING" | "RECEIVED";
        date: string;
        void?: boolean;
      }) => Promise<void>)
    | undefined;
  onDeactivateCashAccount?: ((accountId: string) => Promise<void>) | undefined;
  onDeactivateAsset?: ((assetId: string) => Promise<void>) | undefined;
  onDeactivateDebt?: ((debtId: string) => Promise<void>) | undefined;
  onSaveCurrentMonthDebtFact?:
    | ((command: {
        debtId: string;
        currentBalance: string;
        currentMonthDue: string | null;
      }) => Promise<SaveCurrentMonthDebtFactResult>)
    | undefined;
}) {
  const sessionAsOfDate = asOfDate ?? home.asOfDate;
  const [route, setRoute] = useState<HomeRoute>("HOME");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceData, setMaintenanceData] = useState<FinancialMaintenanceState | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");
  const safetyProgress = safetyProgressPercentage(
    home.safetyCoverageMonths,
    home.safetyCoverageTargetMonths,
  );
  const safetyCoverageAvailable =
    home.safetyCoverageMonths != null &&
    Number.isFinite(Number(home.safetyCoverageMonths)) &&
    Number(home.safetyCoverageMonths) >= 0 &&
    Number.isFinite(home.safetyCoverageTargetMonths) &&
    home.safetyCoverageTargetMonths >= 0;
  const safetyTargetUnset = safetyCoverageAvailable && home.safetyCoverageTargetMonths === 0;

  function openMyFinance() {
    setRoute("MY_FINANCE");
    void loadMaintenance();
  }

  function openLegacyMaintenance() {
    setMaintenanceOpen(true);
    if (!maintenanceData) void loadMaintenance();
  }

  async function loadMaintenance() {
    setMaintenanceLoading(true);
    setMaintenanceError("");
    try {
      setMaintenanceData(await onLoadFinancialMaintenance(sessionAsOfDate));
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : "读取失败，请重试。");
    } finally {
      setMaintenanceLoading(false);
    }
  }

  async function savePlanningIncome(
    patch: FinancialMaintenancePatch,
    date: string,
  ): Promise<FinancialMaintenanceState> {
    const next = await onUpdateFinancialData(patch, date);
    setMaintenanceData(next);
    return next;
  }

  async function saveActualIncomeRevision(input: {
    incomeId: string;
    periodMonth: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    void?: boolean;
  }) {
    if (!onReviseActualIncome) throw new Error("实际收入修改服务暂不可用。");
    await onReviseActualIncome(input);
    await loadMaintenance();
  }

  async function deactivateCash(accountId: string) {
    if (!onDeactivateCashAccount) throw new Error("账户停用服务暂不可用。");
    await onDeactivateCashAccount(accountId);
    await loadMaintenance();
  }

  async function deactivateAssetItem(assetId: string) {
    if (!onDeactivateAsset) throw new Error("资产停用服务暂不可用。");
    await onDeactivateAsset(assetId);
    await loadMaintenance();
  }

  async function deactivateDebtItem(debtId: string) {
    if (!onDeactivateDebt) throw new Error("债务停用服务暂不可用。");
    await onDeactivateDebt(debtId);
    await loadMaintenance();
  }

  async function saveDebtFact(command: {
    debtId: string;
    currentBalance: string;
    currentMonthDue: string | null;
  }) {
    if (!onSaveCurrentMonthDebtFact) throw new Error("本月债务确认服务暂不可用。");
    const result = await onSaveCurrentMonthDebtFact(command);
    await loadMaintenance();
    return result;
  }

  if (isHomeDetailRoute(route))
    return (
      <HomeDetail
        home={home}
        route={route}
        onBack={() => setRoute("HOME")}
        onRoute={setRoute}
        onCashAccounts={() => {
          setRoute("CASH_LIST");
          void loadMaintenance();
        }}
      />
    );
  if (route !== "HOME") {
    return (
      <>
        <MyFinancePages
          route={route}
          home={home}
          data={maintenanceData}
          loading={maintenanceLoading}
          error={maintenanceError}
          asOfDate={sessionAsOfDate}
          onRoute={setRoute}
          onBack={() => setRoute(route === "PLANNING_INCOME" ? "INCOME_LIST" : "MY_FINANCE")}
          onHome={() => setRoute("HOME")}
          onRetry={() => void loadMaintenance()}
          onOpenLegacyMaintenance={openLegacyMaintenance}
          getRequirement={onGetFinancialMaintenanceRequirement}
          onSavePlanning={savePlanningIncome}
          isSessionDateCurrent={isSessionDateCurrent}
          onGetPlanningMonth={onGetPlanningMonth}
          onSavePlanningMonth={onSavePlanningMonth}
          onReviseActualIncome={saveActualIncomeRevision}
          onDeactivateCashAccount={deactivateCash}
          onDeactivateAsset={deactivateAssetItem}
          onDeactivateDebt={deactivateDebtItem}
          onSaveCurrentMonthDebtFact={saveDebtFact}
        />
        {maintenanceOpen && (
          <FinancialMaintenanceDialog
            initial={maintenanceData}
            loading={maintenanceLoading}
            error={maintenanceError}
            onClose={() => setMaintenanceOpen(false)}
            onLoad={loadMaintenance}
            getRequirement={(patch) => onGetFinancialMaintenanceRequirement(patch, sessionAsOfDate)}
            onSave={async (patch) => {
              setMaintenanceError("");
              try {
                setMaintenanceData(await onUpdateFinancialData(patch, sessionAsOfDate));
                setMaintenanceOpen(false);
              } catch (error) {
                const message = error instanceof Error ? error.message : "保存失败，请重试。";
                setMaintenanceError(message);
                throw error;
              }
            }}
          />
        )}
      </>
    );
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">
            <FinanceIllustration kind="brand" />
          </span>
          <span className="brand-name">小钱家</span>
          <span className="local-chip">仅保存在本机</span>
        </div>
        <div className="header-actions">
          <span className="current-period">
            {sessionAsOfDate.slice(0, 7).replace("-", " 年 ")} 月
          </span>
          <button
            className="button button-primary add-expense"
            type="button"
            onClick={() => {
              setExpenseError("");
              setExpenseOpen(true);
            }}
          >
            ＋ 记一笔
          </button>
        </div>
      </header>
      {wp03PreviewDateControl}
      <section className="home-intro" aria-labelledby="home-title">
        <h1 id="home-title">你好，今天也认真管理生活。</h1>
        <p>{trendCopy[home.trendState] ?? "查看本月财务概况"}</p>
      </section>

      {pendingDebtFactNames.length > 0 && (
        <section className="finance-state-card home-debt-facts-pending" role="status">
          <h2>{sessionAsOfDate.slice(0, 7)} 本月债务待确认</h2>
          <p>{pendingDebtFactNames.join("、")}</p>
          <p>首页暂不按上月应还金额估算。逐笔确认本月余额和应还后，才会更新本月计算。</p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              setRoute("DEBT_LIST");
              void loadMaintenance();
            }}
          >
            逐笔确认本月债务
          </button>
        </section>
      )}
      <section
        className="home-modules"
        aria-label="本月财务四个方面"
        hidden={pendingDebtFactNames.length > 0}
      >
        <article className="home-module module-spending" data-primary-module="spending">
          <ModuleHeading title="本月可变消费" onClick={() => setRoute("SPENDING_DETAIL")} />
          <div className="spending-main-line">
            <div>
              <span className="module-label">本月已花</span>
              <strong className="module-primary-value" data-testid="actual-variable-spending">
                <YuanAmount value={home.currentMonthSpending} />
              </strong>
            </div>
            <span className="versus-mark" aria-hidden="true">
              /
            </span>
            <div>
              <span className="module-label">个人目标</span>
              <strong className="module-secondary-value" data-testid="personal-spending-target">
                {home.desiredMonthlyDiscretionarySpending == null ? (
                  "未设置"
                ) : (
                  <YuanAmount value={home.desiredMonthlyDiscretionarySpending} />
                )}
              </strong>
            </div>
            <FinanceIllustration kind="spending" className="home-module-art spending-art" />
          </div>
          <div className="target-progress-row">
            <div
              className="target-progress"
              role="progressbar"
              aria-label="个人月度消费目标进度"
              aria-valuemin={0}
              aria-valuemax={Number(home.desiredMonthlyDiscretionarySpending ?? 0)}
              aria-valuenow={Math.min(
                Number(home.currentMonthSpending),
                Number(home.desiredMonthlyDiscretionarySpending ?? 0),
              )}
              aria-valuetext={
                home.desiredMonthlyDiscretionarySpending == null
                  ? "未设置个人目标"
                  : `${formatYuanText(home.currentMonthSpending)} / ${formatYuanText(home.desiredMonthlyDiscretionarySpending)}`
              }
            >
              <i style={{ width: `${personalTargetProgress(home)}%` }} />
            </div>
            <span>
              {home.desiredMonthlyDiscretionarySpending == null
                ? ""
                : `${personalTargetProgress(home).toFixed(0)}%`}
            </span>
          </div>
          <div className="module-footline">
            {personalTargetRemaining(home) === null ? (
              <span data-testid="personal-target-remaining">未设置个人目标</span>
            ) : money(home.currentMonthSpending).gt(
                money(home.desiredMonthlyDiscretionarySpending ?? "0"),
              ) ? (
              <span className="value-warning" data-testid="personal-target-exceeded">
                已超目标 <YuanAmount value={personalTargetExceeded(home) ?? "0"} />
              </span>
            ) : (
              <span data-testid="personal-target-remaining">
                目标内剩余 <YuanAmount value={personalTargetRemaining(home) ?? "0"} />
              </span>
            )}
            <span className="module-secondary-note safety-recommendation-pill">
              安全建议 <YuanAmount value={home.recommendedMonthlySpending} />
            </span>
          </div>
        </article>

        <article className="home-module module-cashflow" data-primary-module="cashflow">
          <ModuleHeading title="本月收支状态" onClick={() => setRoute("CASHFLOW_DETAIL")} />
          <div className="cashflow-flow">
            <div className="flow-step flow-income">
              <FinanceIllustration kind="incomeFlow" className="cashflow-main-art" />
              <div className="flow-value">
                <span className="module-label">本月计划收入</span>
                <strong>
                  <YuanAmount value={home.planningIncome} />
                </strong>
              </div>
            </div>
            <span className="flow-arrow" aria-hidden="true">
              →
            </span>
            <div className="flow-step flow-obligations">
              <FinanceIllustration kind="spending" className="cashflow-obligations-art" />
              <div className="flow-value">
                <span className="module-label">生活和本月还款</span>
                <strong>
                  <YuanAmount value={home.monthlyCoreObligations} />
                </strong>
              </div>
            </div>
            <span className="flow-arrow flow-down" aria-hidden="true">
              →
            </span>
            <div
              className={`flow-balance ${home.spendingStatus === "STRUCTURAL_DEFICIT" ? "balance-negative" : "balance-positive"}`}
            >
              <span className="balance-state-icon" aria-hidden="true">
                {home.spendingStatus === "STRUCTURAL_DEFICIT" ? "↓" : "↑"}
              </span>
              <span className="module-label">
                {home.spendingStatus === "STRUCTURAL_DEFICIT" ? "按计划还差" : "按计划还剩"}
              </span>
              <strong data-testid="home-base-surplus">
                <YuanAmount value={home.baseSurplus} />
              </strong>
            </div>
          </div>
          <div className="module-footline">
            <span
              className={`status-text status-${home.spendingStatus.toLowerCase()}`}
              data-testid="home-spending-status"
            >
              {spendingStatusCopy[home.spendingStatus]}
            </span>
            {home.actualIncomeRecordCount === 0 && (
              <span className="module-secondary-note" data-testid="no-actual-income">
                本月收入记录为 0 笔
              </span>
            )}
          </div>
          {home.spendingStatus === "STRUCTURAL_DEFICIT" && (
            <p className="module-explanation">按当前计划收入，暂时不够覆盖生活支出和本月还款。</p>
          )}
        </article>

        <article className="home-module module-safety" data-primary-module="safety">
          <ModuleHeading title="安全垫" onClick={() => setRoute("SAFETY_DETAIL")} />
          <div className="safety-main-line">
            <FinanceIllustration kind="safety" className="home-module-art safety-art" />
            <div className="safety-coverage" data-testid="home-safety-coverage">
              {!safetyCoverageAvailable ? (
                "暂不可计算"
              ) : (
                <>
                  <strong>{formatMonths(home.safetyCoverageMonths)}</strong>
                  <span>
                    {safetyTargetUnset
                      ? " 个月 · 未设目标"
                      : ` / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`}
                  </span>
                </>
              )}
            </div>
          </div>
          {safetyProgress === null ? (
            <p className="safety-progress-unavailable">
              {safetyTargetUnset ? "未设定安全垫目标，不显示目标进度。" : "覆盖进度暂不可计算"}
            </p>
          ) : (
            <div
              className="safety-progress"
              role="progressbar"
              aria-label="安全垫覆盖进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={safetyProgress}
              aria-valuetext={`${formatMonths(home.safetyCoverageMonths)} / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`}
            >
              <i style={{ width: `${safetyProgress}%` }} />
            </div>
          )}
          <div className="module-footline safety-footline">
            <span>
              距目标约{" "}
              <strong>
                <YuanAmount value={home.safetyGap} />
              </strong>
            </span>
            <span
              className={`gate-status ${home.cashSafetyGateStatus === "ACTIVE" ? "gate-active" : ""}`}
              data-testid="home-cash-gate"
            >
              {homeSafetySummary(home)}
            </span>
          </div>
          {home.cashFloorMet === false && (
            <p className="cash-warning" role="status">
              现金还没有达到你设定的最低安全线。
            </p>
          )}
        </article>

        <article className="home-module module-debt" data-primary-module="debt">
          <ModuleHeading title="债务" onClick={() => setRoute("DEBT_DETAIL")} />
          <div className="debt-home-values">
            <FinanceIllustration kind="debt" className="debt-home-art" />
            <div>
              <span className="module-label">总债务</span>
              <strong className="module-primary-value" data-testid="home-total-debt">
                <YuanAmount value={home.totalDebt} />
              </strong>
            </div>
            <div className="debt-due-callout">
              {pendingDebtFactNames.length > 0 ? (
                <>
                  <span className="module-label">本月应还待确认</span>
                  <strong data-testid="home-mandatory-debt-service">待确认</strong>
                </>
              ) : (
                <>
                  <span className="module-label">本月必须还款</span>
                  <strong data-testid="home-mandatory-debt-service">
                    <YuanAmount value={home.mandatoryDebtService} />
                  </strong>
                </>
              )}
            </div>
          </div>
        </article>
      </section>
      <footer className="home-footer">
        <span>依据本月记录的财务数据</span>
        <button type="button" className="button button-secondary" onClick={openMyFinance}>
          我的财务
        </button>
        <button
          type="button"
          className="button button-secondary maintenance-entry"
          onClick={openLegacyMaintenance}
        >
          更新财务数据
        </button>
      </footer>
      {expenseOpen && (
        <ExpenseDialog
          busy={busy}
          error={expenseError}
          setError={setExpenseError}
          onClose={() => setExpenseOpen(false)}
          onSubmit={async (submission) => {
            setBusy(true);
            setExpenseError("");
            try {
              await onRecordExpense(submission, sessionAsOfDate);
              setExpenseOpen(false);
            } catch (error) {
              setExpenseError(error instanceof Error ? error.message : "保存失败，请重试。");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {maintenanceOpen && (
        <FinancialMaintenanceDialog
          initial={maintenanceData}
          loading={maintenanceLoading}
          error={maintenanceError}
          onClose={() => setMaintenanceOpen(false)}
          onLoad={loadMaintenance}
          getRequirement={(patch) => onGetFinancialMaintenanceRequirement(patch, sessionAsOfDate)}
          onSave={async (patch) => {
            setMaintenanceError("");
            try {
              setMaintenanceData(await onUpdateFinancialData(patch, sessionAsOfDate));
              setMaintenanceOpen(false);
            } catch (error) {
              const message = error instanceof Error ? error.message : "保存失败，请重试。";
              setMaintenanceError(message);
              throw error;
            }
          }}
        />
      )}
    </main>
  );
}

function ModuleHeading({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <div className="module-heading">
      <h2>{title}</h2>
      <button
        className="module-detail-button"
        type="button"
        onClick={onClick}
        aria-label={`查看${title}详情`}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function HomeDetail({
  home,
  route,
  onBack,
  onRoute,
  onCashAccounts,
}: {
  home: HomeApplicationState;
  route: HomeDetailRoute;
  onBack: () => void;
  onRoute: (route: HomeRoute) => void;
  onCashAccounts: () => void;
}) {
  return (
    <main className="home-page detail-page">
      <header className="detail-header">
        <button className="back-button" type="button" onClick={onBack} aria-label="返回首页">
          <span aria-hidden="true">←</span> 返回首页
        </button>
        <span className="current-period">{home.currentMonth.replace("-", " 年 ")} 月</span>
      </header>
      <h1 className="detail-title" tabIndex={-1}>
        {routeTitle[route]}
      </h1>
      {route === "SPENDING_DETAIL" && <SpendingDetail home={home} />}
      {route === "CASHFLOW_DETAIL" && <CashflowDetail home={home} />}
      {route === "SAFETY_DETAIL" && (
        <SafetyDetail home={home} onRoute={onRoute} onCashAccounts={onCashAccounts} />
      )}
      {route === "DEBT_DETAIL" && <DebtDetail home={home} />}
    </main>
  );
}

function isHomeDetailRoute(route: HomeRoute): route is HomeDetailRoute {
  return (
    route === "SPENDING_DETAIL" ||
    route === "CASHFLOW_DETAIL" ||
    route === "SAFETY_DETAIL" ||
    route === "DEBT_DETAIL"
  );
}

function SpendingDetail({ home }: { home: HomeApplicationState }) {
  return (
    <section className="detail-panel" aria-labelledby="spending-detail-heading">
      <h2 id="spending-detail-heading">本月消费情况</h2>
      <DetailRow label="本月已花" value={<YuanAmount value={home.currentMonthSpending} />} />
      <DetailRow
        label="个人月度目标"
        value={
          home.desiredMonthlyDiscretionarySpending == null ? (
            "未设置"
          ) : (
            <YuanAmount value={home.desiredMonthlyDiscretionarySpending} />
          )
        }
      />
      <DetailRow
        label={personalTargetExceeded(home) === null ? "个人目标还剩" : "已超过个人目标"}
        value={
          personalTargetExceeded(home) === null ? (
            personalTargetRemaining(home) === null ? (
              "未设置"
            ) : (
              <YuanAmount value={personalTargetRemaining(home)} />
            )
          ) : (
            <YuanAmount value={personalTargetExceeded(home)} />
          )
        }
      />
      <DetailRow
        label="可变消费参考额度"
        testId="safe-spending-recommendation"
        value={<YuanAmount value={home.recommendedMonthlySpending} />}
      />
      {home.spendingStatus === "STRUCTURAL_DEFICIT" &&
        money(home.recommendedMonthlySpending).isZero() && (
          <p className="detail-status">
            按当前收入和必要支出，本月暂时没有可安全追加的可变消费额度。
          </p>
        )}
      <p className="detail-note">
        参考额度用于辅助计划，不会限制你记录已经发生的消费；个人目标和参考额度含义不同。
      </p>
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <DetailRow
          label="模型推荐可变消费额度"
          value={<YuanAmount value={home.recommendedMonthlySpending} />}
        />
        <DetailRow
          label="已花金额超过模型参考额度"
          testId="above-safe-recommendation"
          value={<YuanAmount value={home.amountAboveRecommendation} />}
        />
        <DetailRow label="按计划结余" value={<YuanAmount value={home.baseSurplus} />} />
        <p className="detail-note">
          参考额度由当月计划结余和安全条件共同决定；它不会替代个人目标，也不会阻止记账。
        </p>
      </details>
    </section>
  );
}

function CashflowDetail({ home }: { home: HomeApplicationState }) {
  return (
    <section className="detail-panel" aria-labelledby="cashflow-detail-heading">
      <h2 id="cashflow-detail-heading">本月计划收支</h2>
      <DetailRow label="本月计划收入" value={<YuanAmount value={home.planningIncome} />} />
      <DetailRow
        label={home.baseSurplus.startsWith("-") ? "按计划还差" : "按计划还剩"}
        value={<YuanAmount value={home.baseSurplus} />}
      />
      <DetailRow
        label="本月收入记录"
        value={
          home.actualIncomeRecordCount === 0
            ? "尚未记录"
            : `已有 ${home.actualIncomeRecordCount} 笔记录`
        }
      />
      <p className="detail-status">{spendingStatusDetail[home.spendingStatus]}</p>
      <p className="detail-note">
        本月计划收入目前沿用稳定月收入基线，不代表本月已经到账；收入记录与计划分开，记录实际收入不会自动改变现金余额。
      </p>
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <DetailRow
          label="每月要覆盖的生活和还款"
          value={<YuanAmount value={home.monthlyCoreObligations} />}
        />
        <DetailRow label="必要生活支出" value={<YuanAmount value={home.essentialExpenses} />} />
        <DetailRow label="本月应还" value={<YuanAmount value={home.mandatoryDebtService} />} />
        <DetailRow label="基础计划结余" value={<YuanAmount value={home.baseSurplus} />} />
        <div className="detail-subsection">
          <h3>趋势</h3>
          <DetailRow label="本月变化" value={trendDetail[home.trendState] ?? "尚无可用趋势"} />
          {home.primaryImprovement && (
            <DetailRow
              label="改善方向"
              value={dimensions[home.primaryImprovement] ?? home.primaryImprovement}
            />
          )}
          {home.primaryDrag && (
            <DetailRow label="承压方向" value={dimensions[home.primaryDrag] ?? home.primaryDrag} />
          )}
        </div>
      </details>
    </section>
  );
}

function SafetyDetail({
  home,
  onRoute,
  onCashAccounts,
}: {
  home: HomeApplicationState;
  onRoute: (route: HomeRoute) => void;
  onCashAccounts: () => void;
}) {
  const safetyCoverageAvailable =
    home.safetyCoverageMonths != null &&
    Number.isFinite(Number(home.safetyCoverageMonths)) &&
    Number(home.safetyCoverageMonths) >= 0 &&
    Number.isFinite(home.safetyCoverageTargetMonths) &&
    home.safetyCoverageTargetMonths >= 0;
  const safetyTargetUnset = safetyCoverageAvailable && home.safetyCoverageTargetMonths === 0;
  const noObligations = home.cashSafetyGateStatus === "NOT_APPLICABLE";
  const structuralDeficit = home.spendingStatus === "STRUCTURAL_DEFICIT";
  const cashFloorShort = home.cashFloorMet === false;
  return (
    <section className="detail-panel" aria-labelledby="safety-detail-heading">
      <h2 id="safety-detail-heading">安全垫情况</h2>
      <section
        className="safety-primary-status"
        aria-label="当前安全情况"
        data-testid="safety-primary-status"
      >
        {noObligations ? (
          <p>当前没有需要覆盖的必要支出和还款，安全覆盖月数暂不适用。</p>
        ) : structuralDeficit && cashFloorShort ? (
          <>
            <p>
              可用现金还没有达到你设定的最低安全线；同时，这个月的计划收入也不够支付生活和必须还款。
            </p>
            <div className="safety-primary-actions">
              <button type="button" onClick={() => onRoute("CASHFLOW_DETAIL")}>
                查看本月收支
              </button>
              <button type="button" onClick={onCashAccounts}>
                查看现金账户
              </button>
            </div>
          </>
        ) : structuralDeficit ? (
          <>
            <p>应急现金已经达到你的最低要求，但这个月的计划收入还不够支付生活和必须还款。</p>
            <button type="button" onClick={() => onRoute("CASHFLOW_DETAIL")}>
              查看本月收支
            </button>
          </>
        ) : cashFloorShort ? (
          <>
            <p>本月计划收支没有缺口，但可用现金还没有达到你设定的最低安全线。</p>
            <button type="button" onClick={onCashAccounts}>
              查看现金账户
            </button>
          </>
        ) : home.cashSafetyGateStatus === "CLEAR" ? (
          <p>本月计划收支和最低现金保障均正常。</p>
        ) : (
          <p>整体安全状态受限，请查看本月计划收支和现金保障情况。</p>
        )}
      </section>
      <DetailRow
        label="安全垫大约够几个月"
        value={
          !safetyCoverageAvailable
            ? "暂不可计算"
            : safetyTargetUnset
              ? `${formatMonths(home.safetyCoverageMonths)} 个月 · 未设目标`
              : `${formatMonths(home.safetyCoverageMonths)} / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`
        }
      />
      <DetailRow
        label="安全垫目标"
        value={`${formatMonths(home.safetyCoverageTargetMonths)} 个月`}
      />
      <DetailRow label="离安全垫目标还差" value={<YuanAmount value={home.safetyGap} />} />
      <DetailRow
        label="应急现金大约够几个月"
        value={
          home.cashCoverageMonths == null
            ? "暂不可计算"
            : `${formatMonths(home.cashCoverageMonths)} / ${formatMonths(home.minimumCashCoverageMonths)} 个月`
        }
      />
      <DetailRow
        label="最低现金保障"
        value={`${formatMonths(home.minimumCashCoverageMonths)} 个月`}
      />
      <DetailRow label="已经准备好的安全储备" value={<YuanAmount value={home.safetyResources} />} />
      {home.cashFloorMet === false && (
        <p className="cash-warning" role="status">
          可用现金还没有达到你设定的最低安全线。
        </p>
      )}
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <DetailRow label="纳入安全储备的现金" value={<YuanAmount value={home.eligibleCash} />} />
        <DetailRow
          label="纳入安全储备的流动投资"
          value={<YuanAmount value={home.eligibleLiquidInvestmentAssets} />}
        />
        <DetailRow label="安全目标金额" value={<YuanAmount value={home.safetyTargetResources} />} />
        <DetailRow label="安全覆盖月数" value={formatMonths(home.safetyCoverageMonths)} />
        <DetailRow label="现金覆盖月数" value={formatMonths(home.cashCoverageMonths)} />
        <DetailRow label="整体安全状态" value={overallGateLabel(home.cashSafetyGateStatus)} />
        <DetailRow label="基础收支情况" value={spendingStatusCopy[home.spendingStatus]} />
        <DetailRow label="最低现金保障状态" value={cashFloorLabel(home.cashFloorMet)} />
        <p className="detail-note">
          安全垫只统计明确纳入的现金和符合条件的流动投资；最低现金保障只看纳入的现金。
        </p>
      </details>
    </section>
  );
}

function DebtDetail({ home }: { home: HomeApplicationState }) {
  return (
    <section className="detail-panel" aria-labelledby="debt-detail-heading">
      <h2 id="debt-detail-heading">债务与本月还款</h2>
      <DetailRow label="总共还欠多少" value={<YuanAmount value={home.totalDebt} />} />
      <DetailRow
        label="这个月需要还多少"
        value={<YuanAmount value={home.mandatoryDebtService} />}
      />
      <div className="debt-detail-list">
        {home.debts.length === 0 ? (
          <p>当前没有债务记录。</p>
        ) : (
          home.debts.map((debt) => (
            <article className="debt-detail-row" key={debt.id}>
              <div className="debt-detail-title">
                <h3>{debt.name}</h3>
                <strong>
                  <YuanAmount value={debt.currentBalance} />
                </strong>
              </div>
              <p>
                本月需要还{" "}
                <strong>
                  <YuanAmount value={debt.countedMonthlyPayment} />
                </strong>
              </p>
            </article>
          ))
        )}
      </div>
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <p className="detail-note">
          有本月应还金额时按该金额计入；没有本月应还时才使用固定月供。两者不会相加。这里显示的是计划计入金额，不代表已经还款。
        </p>
        {home.debts.map((debt) => (
          <DetailRow
            key={`debt-source-${debt.id}`}
            label={`${debt.name}的计入方式`}
            value={
              debt.paymentSource === "CURRENT_MONTH_DUE"
                ? "采用本月应还"
                : debt.paymentSource === "FIXED_MONTHLY_PAYMENT"
                  ? "采用固定月供（本月应还缺失）"
                  : "没有月度还款金额"
            }
          />
        ))}
      </details>
    </section>
  );
}

function DetailRow({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function ExpenseDialog({
  busy,
  error,
  setError,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  setError: (error: string) => void;
  onClose: () => void;
  onSubmit: (submission: ExpenseSubmission) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [dateTime, setDateTime] = useState(localDateTime(new Date()));
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    amountRef.current?.focus();
    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", onDialogKeyDown);
      previousFocus?.focus();
    };
  }, [busy, onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let canonicalAmount: string;
    try {
      canonicalAmount = assertUserInputMoney(amount.trim(), "消费金额");
    } catch {
      setError("请输入大于 0 的金额。");
      return;
    }
    if (!money(canonicalAmount).gt(0)) {
      setError("请输入大于 0 的金额。");
      return;
    }
    if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) {
      setError("请填写有效的日期和时间。");
      return;
    }
    void onSubmit({
      amount: amount.trim(),
      dateTime: new Date(dateTime).toISOString(),
      businessDate: dateTime.slice(0, 10),
      ...(category ? { category: category as NonNullable<ExpenseSubmission["category"]> } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="expense-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">QUICK EXPENSE</p>
            <h2 id="expense-title">记一笔消费</h2>
          </div>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label className="amount-field">
            消费金额
            <input
              aria-label="消费金额"
              ref={amountRef}
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError("");
              }}
              placeholder="0.00"
              aria-describedby="amount-hint"
            />
            <span>元</span>
          </label>
          <small id="amount-hint" className="field-hint">
            输入实际支出金额
          </small>
          <label>
            日期和时间
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(event) => setDateTime(event.target.value)}
            />
          </label>
          <label>
            消费分类（选填）
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">暂不选择</option>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            备注（选填）
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：午餐"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "保存中…" : "保存消费"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function formatYuanText(value: string) {
  const formatted = formatMoneyExact(value);
  const negative = formatted.startsWith("-");
  const unsigned = negative ? formatted.slice(1) : formatted;
  const [integer, fraction] = unsigned.split(".");
  return `${negative ? "-" : ""}¥${integer}.${(fraction ?? "").padEnd(2, "0")}`;
}
function YuanAmount({
  value,
  size = "detail",
}: {
  value: string | null | undefined;
  size?: MoneyAmountSize;
}) {
  return <MoneyAmount value={value} size={size} />;
}
function formatMonths(value: string | number | null | undefined) {
  return value == null ? "暂无" : formatMoneyExact(String(value));
}
function personalTargetRemaining(home: HomeApplicationState): string | null {
  if (home.desiredMonthlyDiscretionarySpending == null) return null;
  const remaining = money(home.desiredMonthlyDiscretionarySpending).minus(
    money(home.currentMonthSpending),
  );
  return (remaining.lt(0) ? money(0) : remaining).toString();
}
function personalTargetProgress(home: HomeApplicationState) {
  if (home.desiredMonthlyDiscretionarySpending == null) return 0;
  const target = money(home.desiredMonthlyDiscretionarySpending);
  if (!target.gt(0)) return 0;
  const current = money(home.currentMonthSpending);
  const percentage = current.div(target).times(100);
  return Math.max(0, Math.min(100, percentage.toNumber()));
}
function safetyProgressPercentage(
  coverageMonths: string | number | null | undefined,
  targetMonths: number,
): number | null {
  if (coverageMonths == null) return null;
  const coverage = Number(coverageMonths);
  const target = Number(targetMonths);
  if (!Number.isFinite(coverage) || coverage < 0 || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  return Math.min(100, (coverage / target) * 100);
}
function personalTargetExceeded(home: HomeApplicationState): string | null {
  if (home.desiredMonthlyDiscretionarySpending == null) return null;
  const exceeded = money(home.currentMonthSpending).minus(
    money(home.desiredMonthlyDiscretionarySpending),
  );
  return exceeded.gt(0) ? exceeded.toString() : null;
}
