import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { SaveCurrentMonthDebtFactResult } from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import type { DebtPaymentRecord } from "../application/ux-ledger-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import { money } from "../model/money.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import { getTauriProductServices } from "../runtime/tauri-bootstrap.js";
import type { CardStatus } from "./card-status.js";
import type { ProductApplicationServices } from "./contracts.js";
import { FinancialMaintenanceDialog } from "./FinancialMaintenanceDialog.js";
import { FixedExpensesPage } from "./FixedExpensesPage.js";
import { LedgerPage } from "./LedgerPage.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { MyFinancePages, type MyFinanceRoute } from "./MyFinancePages.js";
import { formatCurrency } from "./money-format.js";
import { V2CalendarPicker } from "./V2CalendarPicker.js";
import { V2CashflowDetail } from "./V2CashflowDetail.js";
import {
  type ConfirmedMotion,
  type ExpenseSaveReceipt,
  type SurfaceTab,
  V2HomeSurface,
} from "./V2HomeSurface.js";
import { V2RepaymentDetail } from "./V2RepaymentDetail.js";
import { V2SafetyDetail } from "./V2SafetyDetail.js";
import { V2SavingsRoomPage } from "./V2SavingsRoomPage.js";
// v2-dashboard.tsx itself stays out of the core tsc graph (its type is re-exported
// through the application layer), so the stylesheet rides on the vite-graph
// consumer: mounting the ledger page always loads this CSS.
import { V2Dashboard, type V2DashboardProps } from "./v2-dashboard.js";
import "./v2-dashboard.css";
import { V2Import } from "./v2-import.js";

type HomeDetailRoute =
  | "SPENDING_DETAIL"
  | "CASHFLOW_DETAIL"
  | "SAFETY_DETAIL"
  | "SAVINGS_DETAIL"
  | "DEBT_DETAIL";
/** Standalone pages reached from the home surface, each with its own route. */
type HomePageRoute = "FIXED_EXPENSES" | "LEDGER" | "FINANCE_OVERVIEW";
type HomeRoute = "HOME" | "RECORD" | "PROGRESS" | HomeDetailRoute | HomePageRoute | MyFinanceRoute;
const detailTitles: Record<HomeDetailRoute, string> = {
  SPENDING_DETAIL: "这个月花了多少",
  CASHFLOW_DETAIL: "现金流",
  SAFETY_DETAIL: "安全垫",
  SAVINGS_DETAIL: "建立余地",
  DEBT_DETAIL: "债务还款",
};
const variableCategoryLabels: Record<string, string> = {
  FOOD: "吃饭",
  TRANSPORT: "出行",
  SHOPPING: "买东西",
  ENTERTAINMENT: "娱乐",
  HOUSEHOLD: "日用",
  OTHER_VARIABLE: "其他",
};
const variableCategoryColors = ["#e87862", "#6f88dc", "#9a83d2", "#e1ad43", "#4fae91", "#89939c"];
// The CSV import page talks to the composition root through the stable services
// object, keeping this component free of any database or repository handle.
const importServices = getTauriProductServices();
// The V2 dashboard reads the same composition-root boundary, so the ledger page
// never touches a database or repository handle either.
const dashboardServices = getTauriProductServices();

type Props = {
  home: HomeApplicationState;
  asOfDate?: string;
  isSessionDateCurrent?: () => boolean;
  wp03PreviewDateControl?: ReactNode;
  pendingDebtFactNames?: string[];
  cardsStatus?: CardStatus;
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<ExpenseSaveReceipt>;
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
  /** Lets maintenance pages push the freshly recomputed home state upward. */
  onApplyHome?: (home: HomeApplicationState) => void;
};

export function HomeScreen({
  home,
  asOfDate,
  isSessionDateCurrent = () => true,
  wp03PreviewDateControl = null,
  pendingDebtFactNames = [],
  cardsStatus = "ready",
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
  onApplyHome = () => undefined,
}: Props) {
  const date = asOfDate ?? home.asOfDate;
  const [route, setRoute] = useState<HomeRoute>("HOME");
  const [selectedTab, setSelectedTab] = useState<SurfaceTab>("TODAY");
  const [data, setData] = useState<FinancialMaintenanceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmedMotion, setConfirmedMotion] = useState<ConfirmedMotion | undefined>();
  const [motionSequence, setMotionSequence] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 3200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function loadMaintenance() {
    setLoading(true);
    setError("");
    try {
      setData(await onLoadFinancialMaintenance(date));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
    } finally {
      setLoading(false);
    }
  }
  function confirmMotion(kind: ConfirmedMotion["kind"], targetId?: string) {
    const sequence = motionSequence + 1;
    setMotionSequence(sequence);
    setConfirmedMotion({ kind, sequence, ...(targetId ? { targetId } : {}) });
  }
  function openFinance(next: MyFinanceRoute = "MY_FINANCE") {
    setSelectedTab("MINE");
    setRoute(next);
    void loadMaintenance();
  }
  function navigateTab(tab: SurfaceTab) {
    setSelectedTab(tab);
    if (tab === "TODAY") setRoute("HOME");
    if (tab === "RECORD") setRoute("RECORD");
    if (tab === "PROGRESS") setRoute("PROGRESS");
    if (tab === "MINE") {
      if (!isFinanceRoute(route)) {
        setRoute("MY_FINANCE");
        void loadMaintenance();
      }
    }
  }
  function navigateRoute(next: HomeRoute) {
    if (isFinanceRoute(next)) setSelectedTab("MINE");
    setRoute(next);
  }
  function openMaintenance() {
    setMaintenanceOpen(true);
    void loadMaintenance();
  }
  async function savePatch(patch: FinancialMaintenancePatch, asOf: string) {
    const next = await onUpdateFinancialData(patch, asOf);
    const verified = patchReadbackMatches(patch, next);
    if (!verified)
      throw new Error(
        "保存操作已返回，但保存后读取内容不匹配。没有播放成功反馈；请先重新读取核对。",
      );
    setData(next);
    setFeedback("保存好了，金额已更新。");
    const cashPatch = patch.cashAccounts?.[0];
    if (cashPatch) {
      const target = cashPatch.id
        ? next.cashAccounts.find((item) => item.id === cashPatch.id)
        : next.cashAccounts.find((item) => item.name === cashPatch.name);
      if (target) confirmMotion("cash", target.id);
    }
    const debtPatch = patch.debts?.[0];
    if (debtPatch) {
      const target = debtPatch.id
        ? next.debts.find((item) => item.id === debtPatch.id)
        : next.debts.find((item) => item.name === debtPatch.name);
      if (target) confirmMotion("debt", target.id);
    }
    return next;
  }
  async function reviseIncome(input: Parameters<NonNullable<Props["onReviseActualIncome"]>>[0]) {
    if (!onReviseActualIncome) throw new Error("实际收入修改服务暂不可用。");
    await onReviseActualIncome(input);
    await loadMaintenance();
    setFeedback(input.void ? "已作废，历史记录还在。" : "这笔收入更新好了。");
  }
  async function deactivate(
    id: string,
    action: ((id: string) => Promise<void>) | undefined,
    label: string,
  ) {
    if (!action) throw new Error(`${label}停用服务暂不可用。`);
    await action(id);
    await loadMaintenance();
    setFeedback(`${label}已停用，历史记录还在。`);
  }
  async function saveDebt(
    command: Parameters<NonNullable<Props["onSaveCurrentMonthDebtFact"]>>[0],
  ) {
    if (!onSaveCurrentMonthDebtFact) throw new Error("本月债务确认服务暂不可用。");
    const result = await onSaveCurrentMonthDebtFact(command);
    if (
      result.status === "SAVED_MODEL_READY" ||
      result.status === "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS"
    ) {
      const readback = await onLoadFinancialMaintenance(date);
      const debt = readback.debts.find((item) => item.id === command.debtId);
      if (
        !debt ||
        debt.needsCurrentMonthFact ||
        !money(debt.currentBalance).eq(money(command.currentBalance)) ||
        (debt.currentMonthDue ?? null) !== command.currentMonthDue
      )
        throw new Error("债务写入结果未通过保存后回读核对；没有播放成功反馈，请先核对后再操作。");
      setData(readback);
      confirmMotion("debt", command.debtId);
      setFeedback("这笔本月还款已确认。");
    } else if (result.status === "NO_CHANGE") {
      await loadMaintenance();
    } else {
      const failed = result as { status: string; message?: string };
      throw new Error(
        `债务保存未确认（${failed.status}）：${failed.message ?? "结果未知"}。没有播放成功反馈，请先核对结果。`,
      );
    }
    return result;
  }
  const destinationContent = isDetail(route) ? (
    <HomeDetail
      home={home}
      route={route}
      asOfDate={date}
      onApplyHome={onApplyHome}
      pendingDebtFactNames={pendingDebtFactNames}
      onBack={() => setRoute(selectedTab === "PROGRESS" ? "PROGRESS" : "HOME")}
      onCash={() => openFinance("CASH_LIST")}
      onSavings={() => openFinance("SAFETY_LIST")}
    />
  ) : route === "FIXED_EXPENSES" ? (
    <FixedExpensesPage
      asOfDate={date}
      services={dashboardServices}
      onApplyHome={onApplyHome}
      onBack={() => navigateTab("TODAY")}
    />
  ) : route === "LEDGER" ? (
    <LedgerPage
      asOfDate={date}
      services={dashboardServices}
      onApplyHome={onApplyHome}
      onBack={() => navigateTab("RECORD")}
    />
  ) : route === "FINANCE_OVERVIEW" ? (
    <section className="home-page detail-page v2-detail-page v2-finance-overview">
      <header className="detail-header">
        <button
          type="button"
          className="back-button"
          onClick={() => navigateRoute("MY_FINANCE")}
          aria-label="返回我的财务"
        >
          返回我的财务
        </button>
        <span>{date.slice(0, 7)}</span>
      </header>
      <h1 className="detail-title">财务概览</h1>
      <V2DashboardLoader month={date.slice(0, 7)} load={dashboardServices.getV2DashboardProps} />
    </section>
  ) : isFinanceRoute(route) ? (
    <>
      <MyFinancePages
        route={route}
        confirmedMotion={confirmedMotion}
        home={home}
        data={data}
        loading={loading}
        error={error}
        asOfDate={date}
        onRoute={(next) => navigateRoute(next)}
        onBack={() => navigateRoute(route === "PLANNING_INCOME" ? "INCOME_LIST" : "MY_FINANCE")}
        onHome={() => navigateTab("TODAY")}
        onRetry={() => void loadMaintenance()}
        onOpenLegacyMaintenance={openMaintenance}
        getRequirement={onGetFinancialMaintenanceRequirement}
        onSavePlanning={savePatch}
        isSessionDateCurrent={isSessionDateCurrent}
        onGetPlanningMonth={onGetPlanningMonth}
        onSavePlanningMonth={onSavePlanningMonth}
        onReviseActualIncome={reviseIncome}
        onDeactivateCashAccount={(id) => deactivate(id, onDeactivateCashAccount, "账户")}
        onDeactivateAsset={(id) => deactivate(id, onDeactivateAsset, "资产")}
        onDeactivateDebt={(id) => deactivate(id, onDeactivateDebt, "债务")}
        onSaveCurrentMonthDebtFact={saveDebt}
      />
      {route === "MY_FINANCE" ? (
        <>
          <button
            type="button"
            className="finance-state-card finance-ledger-entry"
            onClick={() => navigateRoute("LEDGER")}
          >
            收支账本 · 查看、改分类、删记录或导出
          </button>
          <button
            type="button"
            className="finance-state-card finance-ledger-entry"
            onClick={() => navigateRoute("FINANCE_OVERVIEW")}
          >
            财务概览 · 收入、趋势与储蓄目标
          </button>
          <details
            className="finance-state-card"
            onToggle={(event) => setImportOpen(event.currentTarget.open)}
          >
            <summary>账单导入</summary>
            {importOpen ? (
              <V2Import
                loadImportContext={importServices.getV2ImportOptions}
                writeImport={importServices.writeV2Import}
              />
            ) : null}
          </details>
        </>
      ) : null}
    </>
  ) : undefined;
  return (
    <>
      <V2HomeSurface
        home={home}
        asOfDate={date}
        pendingDebtFactNames={pendingDebtFactNames}
        cardsStatus={cardsStatus}
        recentExpenses={home.recentExpenses ?? []}
        wp03PreviewDateControl={wp03PreviewDateControl}
        selectedTab={selectedTab}
        destinationContent={destinationContent}
        onSelectTab={navigateTab}
        onRecordExpense={onRecordExpense}
        confirmedMotion={confirmedMotion}
        onOpenDetail={(detail) => navigateRoute(detail)}
        onOpenFinance={openFinance}
        onOpenFixedExpenses={() => navigateRoute("FIXED_EXPENSES")}
        onOpenLedger={() => navigateRoute("LEDGER")}
        onOpenSettings={openMaintenance}
        onLoadMonthRows={async (month) => {
          try {
            return await dashboardServices.listLedgerExpenses(month);
          } catch {
            return [];
          }
        }}
        onGetRecordingStreak={async (day) => {
          try {
            return (await dashboardServices.getRecordingStreak(day)).consecutiveDays;
          } catch {
            return 1;
          }
        }}
      />
      {feedback && (
        <div className="v2-feedback" role="status">
          {feedback}
        </div>
      )}
      {maintenanceOpen && (
        <FinancialMaintenanceDialog
          initial={data}
          loading={loading}
          error={error}
          onClose={() => setMaintenanceOpen(false)}
          onLoad={loadMaintenance}
          getRequirement={(patch) => onGetFinancialMaintenanceRequirement(patch, date)}
          onSave={async (patch) => {
            await savePatch(patch, date);
            setMaintenanceOpen(false);
          }}
        />
      )}
    </>
  );
}

function V2DashboardLoader({
  month,
  load,
}: {
  month: string;
  load: (month: string) => Promise<V2DashboardProps>;
}) {
  const [props, setProps] = useState<V2DashboardProps | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    load(month)
      .then((next) => {
        if (!cancelled) setProps(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
      });
    return () => {
      cancelled = true;
    };
  }, [load, month]);
  if (error) return <p role="alert">账本读取失败：{error}</p>;
  if (!props) return <p role="status">正在读取收支账本…</p>;
  return <V2Dashboard {...props} />;
}

function isFinanceRoute(route: HomeRoute): route is MyFinanceRoute {
  return !(
    route === "HOME" ||
    route === "RECORD" ||
    route === "PROGRESS" ||
    route === "SPENDING_DETAIL" ||
    route === "CASHFLOW_DETAIL" ||
    route === "SAFETY_DETAIL" ||
    route === "SAVINGS_DETAIL" ||
    route === "DEBT_DETAIL" ||
    route === "FIXED_EXPENSES" ||
    route === "LEDGER" ||
    route === "FINANCE_OVERVIEW"
  );
}

function isDetail(route: HomeRoute): route is HomeDetailRoute {
  return (
    route === "SPENDING_DETAIL" ||
    route === "CASHFLOW_DETAIL" ||
    route === "SAFETY_DETAIL" ||
    route === "SAVINGS_DETAIL" ||
    route === "DEBT_DETAIL"
  );
}

function patchReadbackMatches(
  patch: FinancialMaintenancePatch,
  readback: FinancialMaintenanceState,
): boolean {
  const stableIncomeMatches =
    patch.stableMonthlyIncome === undefined ||
    money(readback.stableMonthlyIncome).eq(money(patch.stableMonthlyIncome));
  const settings = patch.settings;
  const settingsMatch =
    settings === undefined ||
    ((settings.safetyCoverageTargetMonths === undefined ||
      readback.settings.safetyCoverageTargetMonths === settings.safetyCoverageTargetMonths) &&
      (settings.minimumCashCoverageMonths === undefined ||
        readback.settings.minimumCashCoverageMonths === settings.minimumCashCoverageMonths) &&
      (settings.safetyRecoveryHorizonMonths === undefined ||
        (settings.safetyRecoveryHorizonMonths === null
          ? readback.settings.safetyRecoveryHorizonMonths === undefined
          : readback.settings.safetyRecoveryHorizonMonths ===
            settings.safetyRecoveryHorizonMonths)) &&
      (settings.desiredMonthlyDiscretionarySpending === undefined ||
        money(readback.settings.desiredMonthlyDiscretionarySpending).eq(
          money(settings.desiredMonthlyDiscretionarySpending),
        )));
  const essentialMatches = (patch.essentialExpenses ?? []).every((expected) => {
    const current = expected.id
      ? readback.essentialExpenses.find((item) => item.id === expected.id)
      : readback.essentialExpenses.find((item) => item.name === expected.name);
    return (
      current !== undefined &&
      (expected.name === undefined || current.name === expected.name) &&
      (expected.category === undefined || current.category === expected.category) &&
      (expected.monthlyAmount === undefined ||
        money(current.monthlyAmount).eq(money(expected.monthlyAmount)))
    );
  });
  const cashMatches = (patch.cashAccounts ?? []).every((expected) => {
    const current = expected.id
      ? readback.cashAccounts.find((item) => item.id === expected.id)
      : readback.cashAccounts.find((item) => item.name === expected.name);
    return (
      current !== undefined &&
      (expected.name === undefined || current.name === expected.name) &&
      (expected.balance === undefined || money(current.balance).eq(money(expected.balance))) &&
      (expected.includeInSafetyResources === undefined ||
        current.includeInSafetyResources === expected.includeInSafetyResources)
    );
  });
  const assetMatches = (patch.assets ?? []).every((expected) => {
    const current = expected.id
      ? readback.assets.find((item) => item.id === expected.id)
      : readback.assets.find((item) => item.name === expected.name);
    return (
      current !== undefined &&
      (expected.name === undefined || current.name === expected.name) &&
      (expected.kind === undefined || current.kind === expected.kind) &&
      (expected.currentValue === undefined ||
        money(current.currentValue).eq(money(expected.currentValue))) &&
      (expected.includeInSafetyResources === undefined ||
        current.includeInSafetyResources === expected.includeInSafetyResources)
    );
  });
  const debtMatches = (patch.debts ?? []).every((expected) => {
    const current = expected.id
      ? readback.debts.find((item) => item.id === expected.id)
      : readback.debts.find((item) => item.name === expected.name);
    return (
      current !== undefined &&
      (expected.name === undefined || current.name === expected.name) &&
      (expected.currentBalance === undefined ||
        money(current.currentBalance).eq(money(expected.currentBalance))) &&
      (expected.currentMonthDue === undefined ||
        current.currentMonthDue === (expected.currentMonthDue ?? null)) &&
      (expected.fixedMonthlyPayment === undefined ||
        current.fixedMonthlyPayment === (expected.fixedMonthlyPayment ?? null))
    );
  });
  return (
    stableIncomeMatches &&
    settingsMatch &&
    essentialMatches &&
    cashMatches &&
    assetMatches &&
    debtMatches
  );
}
function Row({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}
function HomeDetail({
  home,
  route,
  asOfDate,
  onApplyHome,
  pendingDebtFactNames,
  onBack,
  onCash,
  onSavings,
}: {
  home: HomeApplicationState;
  route: HomeDetailRoute;
  asOfDate: string;
  onApplyHome: (home: HomeApplicationState) => void;
  pendingDebtFactNames: string[];
  onBack: () => void;
  onCash: () => void;
  onSavings: () => void;
}) {
  return (
    <section className="home-page detail-page v2-detail-page">
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回首页">
          返回首页
        </button>
        <span>{home.currentMonth}</span>
      </header>
      <h1 className="detail-title">{detailTitles[route]}</h1>
      {route === "SPENDING_DETAIL" && <SpendingDetail home={home} />}
      {route === "CASHFLOW_DETAIL" && <V2CashflowDetail home={home} />}
      {route === "SAFETY_DETAIL" && <V2SafetyDetail home={home} onOpenCash={onCash} />}
      {route === "SAVINGS_DETAIL" && <V2SavingsRoomPage home={home} onUpdate={onSavings} />}
      {route === "DEBT_DETAIL" && (
        <DebtDetail
          home={home}
          asOfDate={asOfDate}
          services={dashboardServices}
          onApplyHome={onApplyHome}
          pendingDebtFactNames={pendingDebtFactNames}
        />
      )}
    </section>
  );
}
function SpendingDetail({ home }: { home: HomeApplicationState }) {
  const target = home.desiredMonthlyDiscretionarySpending;
  const remaining = target == null ? null : money(target).minus(money(home.currentMonthSpending));
  const breakdown = home.spendingBreakdown ?? [];
  const recentExpenses = (home.recentExpenses ?? []).filter((expense) => expense.category);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const selected = selectedCategory
    ? breakdown.find((item) => (item.categoryId ?? item.category) === selectedCategory)
    : null;
  const visibleExpenses = selectedCategory
    ? recentExpenses.filter(
        (expense) => (expense.categoryId ?? expense.category) === selectedCategory,
      )
    : recentExpenses;
  return (
    <section className="detail-panel" aria-labelledby="spending-detail-heading">
      <h2 id="spending-detail-heading">这个月花了多少</h2>
      <SpendingPieChart
        breakdown={breakdown}
        selectedCategory={selectedCategory}
        onSelect={setSelectedCategory}
      />
      {selected && (
        <p className="spending-filter-note">
          现在看的是：{selected.label ?? variableCategoryLabels[selected.category] ?? "其他"}
          ，占本月花销 {selected.share}%，共 {selected.count} 笔。
          <button type="button" onClick={() => setSelectedCategory(null)}>
            看全部
          </button>
        </p>
      )}
      <section className="recent-expense-detail" aria-label="最近花销">
        <h3>最近花销</h3>
        {visibleExpenses.length === 0 ? (
          <p>{selectedCategory ? "这个分类暂时没有最近记录。" : "还没有花销记录。"}</p>
        ) : (
          visibleExpenses.map((expense) => (
            <div className="recent-expense-detail-row" key={expense.id}>
              <span>
                {expense.categoryName ?? variableCategoryLabels[expense.category] ?? "其他"}
              </span>
              <small>{expense.note || expense.businessDate}</small>
              <strong>{formatCurrency(expense.amount)}</strong>
            </div>
          ))
        )}
      </section>
      <Row
        label="已经花了"
        value={<MoneyAmount value={home.currentMonthSpending} />}
        testId="actual-variable-spending"
      />
      <Row
        label="自己定的目标"
        value={target == null ? "未设置" : <MoneyAmount value={target} />}
        testId="personal-spending-target"
      />
      <Row
        label={remaining?.lt(0) ? "已超过个人目标" : "个人目标还剩"}
        value={remaining == null ? "未设置" : <MoneyAmount value={remaining.abs().toString()} />}
        testId={remaining?.lt(0) ? "personal-target-exceeded" : "personal-target-remaining"}
      />
      <Row
        label="建议别超过"
        testId="safe-spending-recommendation"
        value={<MoneyAmount value={home.recommendedMonthlySpending} />}
      />
      {home.spendingStatus === "STRUCTURAL_DEFICIT" &&
        money(home.recommendedMonthlySpending).isZero() && (
          <p>按现在的收入和固定支出，这个月先别再增加太多花销。</p>
        )}
      <p className="detail-note">这个数字只是帮你做参考，不会限制你记录已经发生的花销。</p>
      <details className="detail-technical">
        <summary>想知道怎么算</summary>
        <Row label="建议别超过" value={<MoneyAmount value={home.recommendedMonthlySpending} />} />
        <Row
          label="比建议多花了"
          testId="above-safe-recommendation"
          value={<MoneyAmount value={home.amountAboveRecommendation} />}
        />
        <Row label="按计划结余" value={<MoneyAmount value={home.baseSurplus} />} />
      </details>
    </section>
  );
}

function SpendingPieChart({
  breakdown,
  selectedCategory,
  onSelect,
}: {
  breakdown: NonNullable<HomeApplicationState["spendingBreakdown"]>;
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
}) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <section className="spending-pie-section" aria-label="本月花销分类占比">
      <div className="spending-pie-wrap">
        <svg
          className="spending-pie"
          viewBox="0 0 120 120"
          role="img"
          aria-label="本月花销分类环形图"
        >
          <title>本月花销分类占比</title>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#edf0eb" strokeWidth="14" />
          {breakdown.map((item, index) => {
            const length = (Number(item.share) / 100) * circumference;
            const currentOffset = offset;
            offset += length;
            const itemKey = item.categoryId ?? item.category;
            const active = selectedCategory == null || selectedCategory === itemKey;
            return (
              <circle
                key={item.category}
                className="spending-pie-segment"
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={variableCategoryColors[index % variableCategoryColors.length]}
                strokeWidth="14"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-currentOffset}
                opacity={active ? 1 : 0.2}
                pathLength={circumference}
                transform="rotate(-90 60 60)"
              />
            );
          })}
          <circle cx="60" cy="60" r="31" fill="#fffefa" />
          <text x="60" y="57" textAnchor="middle" className="spending-pie-center-label">
            本月
          </text>
          <text x="60" y="70" textAnchor="middle" className="spending-pie-center-value">
            {breakdown.length ? `${breakdown.length} 类` : "暂无"}
          </text>
        </svg>
      </div>
      <div className="spending-pie-legend">
        {breakdown.length === 0 ? (
          <p>再记几笔，就能看到钱主要花在哪儿。</p>
        ) : (
          breakdown.map((item, index) => (
            <button
              key={item.categoryId ?? item.category}
              type="button"
              className={
                selectedCategory === (item.categoryId ?? item.category) ? "is-selected" : ""
              }
              onClick={() =>
                onSelect(
                  selectedCategory === (item.categoryId ?? item.category)
                    ? null
                    : (item.categoryId ?? item.category),
                )
              }
            >
              <i
                style={{
                  background: variableCategoryColors[index % variableCategoryColors.length],
                }}
              />
              <span>{item.label ?? variableCategoryLabels[item.category] ?? "其他"}</span>
              <strong>{item.share}%</strong>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
function DebtDetail({
  home,
  asOfDate,
  services,
  onApplyHome,
  pendingDebtFactNames,
}: {
  home: HomeApplicationState;
  asOfDate: string;
  services: ProductApplicationServices;
  onApplyHome: (home: HomeApplicationState) => void;
  pendingDebtFactNames: string[];
}) {
  const pending = new Set(pendingDebtFactNames);
  const hasPending = pending.size > 0;
  const [log, setLog] = useState<DebtPaymentRecord[]>([]);
  const [debtId, setDebtId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(asOfDate);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const loadLog = useCallback(async () => {
    try {
      setLog(await services.listDebtPaymentLog());
    } catch {
      // The repayment log is supporting detail; a read failure must not hide the page.
    }
  }, [services]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  const month = asOfDate.slice(0, 7);
  const monthLog = log.filter((payment) => payment.paidOn.slice(0, 7) === month);
  const repaidThisMonth = monthLog.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const repaidByDebt = new Map<string, number>();
  for (const payment of monthLog) {
    repaidByDebt.set(
      payment.debtId,
      (repaidByDebt.get(payment.debtId) ?? 0) + Number(payment.amount || 0),
    );
  }

  async function submitRepayment() {
    if (!debtId) {
      setError("先选要还哪一笔。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await services.recordDebtRepayment({
        debtId,
        amount: amount.trim(),
        paidOn,
        asOfDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onApplyHome(result.home);
      setFeedback(
        result.reconciliation.balanced
          ? `记好了，这笔还完后余额是 ${formatCurrency(result.payment.balanceAfter)}。`
          : "还款已记录，但两本账的余额还不一致，请先核对。",
      );
      setAmount("");
      setNote("");
      await loadLog();
    } catch (repayError) {
      setError(repayError instanceof Error ? repayError.message : "还款记录失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <V2RepaymentDetail
      home={home}
      repaidThisMonth={repaidThisMonth}
      repaidByDebt={repaidByDebt}
      pendingNames={pendingDebtFactNames}
    >
      <section className="detail-panel debt-repay-panel" aria-labelledby="debt-repay-heading">
        <h2 id="debt-repay-heading">记一笔还款</h2>
        <p className="detail-note">还了钱就记一笔，余额会自动扣减，流水可以随时查。</p>
        <label>
          还哪一笔
          <select
            value={debtId}
            onChange={(event) => {
              const next = event.target.value;
              setDebtId(next);
              const debt = home.debts.find((item) => item.id === next);
              if (debt) setAmount(debt.countedMonthlyPayment ?? "");
            }}
          >
            <option value="">请选择</option>
            {home.debts
              .filter((debt) => !pending.has(debt.name))
              .map((debt) => (
                <option key={debt.id} value={debt.id}>
                  {debt.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          还了多少
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <div className="v2-sheet-date">
          <span>还款日期</span>
          <V2CalendarPicker value={paidOn} onChange={setPaidOn} label="还款日期" disabled={busy} />
        </div>
        <label>
          备注（选填）
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || hasPending}
          onClick={() => void submitRepayment()}
        >
          记下这笔还款
        </button>
        {feedback && (
          <p className="v2-feedback-inline" role="status">
            {feedback}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="detail-panel" aria-labelledby="debt-log-heading">
        <h2 id="debt-log-heading">还款记录</h2>
        {log.length === 0 ? (
          <p>还没有还款记录。</p>
        ) : (
          <ul className="v2-plain-list">
            {log.slice(0, 20).map((payment) => (
              <li key={payment.id}>
                <span>
                  <strong>{payment.debtName}</strong>
                  <small>
                    {payment.paidOn}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </small>
                </span>
                <span>{formatCurrency(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <p>
          计划计入 = 本月计划要还的金额（有本月应还时用本月应还，没有时才用固定月供，两者不相加）。
          实还 = 你实际记下的还款。余额会随实还扣减，两者分开显示，不会互相覆盖。
        </p>
      </details>
    </V2RepaymentDetail>
  );
}
