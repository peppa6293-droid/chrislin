import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { SaveCurrentMonthDebtFactResult } from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import { formatMoneyExact, money } from "../model/money.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import { getTauriProductServices } from "../runtime/tauri-bootstrap.js";
import { FinancialMaintenanceDialog } from "./FinancialMaintenanceDialog.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { MyFinancePages, type MyFinanceRoute } from "./MyFinancePages.js";
import {
  type ConfirmedMotion,
  type ExpenseSaveReceipt,
  type SurfaceTab,
  V2HomeSurface,
} from "./V2HomeSurface.js";
import { V2Import } from "./v2-import.js";

type HomeDetailRoute = "SPENDING_DETAIL" | "CASHFLOW_DETAIL" | "SAFETY_DETAIL" | "DEBT_DETAIL";
type HomeRoute = "HOME" | "RECORD" | "PROGRESS" | HomeDetailRoute | MyFinanceRoute;
const detailTitles: Record<HomeDetailRoute, string> = {
  SPENDING_DETAIL: "这个月花了多少",
  CASHFLOW_DETAIL: "这个月够不够用",
  SAFETY_DETAIL: "手头余地",
  DEBT_DETAIL: "这个月要还多少",
};
const statusCopy: Record<HomeApplicationState["spendingStatus"], string> = {
  NORMAL: "按当前计划有结余",
  STRUCTURAL_DEFICIT: "这个月的计划有缺口",
  BALANCED_NO_SURPLUS: "按当前计划基本持平",
};
const trendCopy: Record<string, string> = {
  IMPROVING_STRONGLY: "明显改善",
  IMPROVING: "有所改善",
  STABLE: "保持平稳",
  UNDER_PRESSURE: "需要留意",
  DETERIORATING: "正在承压",
  BASELINE_BUILDING: "基准建立中",
};
const dimensions: Record<string, string> = {
  LIQUIDITY_SAFETY: "手头余地",
  DEBT: "本月要还",
  CONSUMPTION: "花钱",
  WEALTH: "手上的资产",
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

type Props = {
  home: HomeApplicationState;
  asOfDate?: string;
  isSessionDateCurrent?: () => boolean;
  wp03PreviewDateControl?: ReactNode;
  pendingDebtFactNames?: string[];
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
      pendingDebtFactNames={pendingDebtFactNames}
      onBack={() => setRoute(selectedTab === "PROGRESS" ? "PROGRESS" : "HOME")}
      onRoute={(next) => navigateRoute(next)}
      onCash={() => openFinance("CASH_LIST")}
    />
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
      ) : null}
    </>
  ) : undefined;
  return (
    <>
      <V2HomeSurface
        home={home}
        asOfDate={date}
        pendingDebtFactNames={pendingDebtFactNames}
        recentExpenses={home.recentExpenses ?? []}
        wp03PreviewDateControl={wp03PreviewDateControl}
        selectedTab={selectedTab}
        destinationContent={destinationContent}
        onSelectTab={navigateTab}
        onRecordExpense={onRecordExpense}
        confirmedMotion={confirmedMotion}
        onOpenDetail={(detail) => navigateRoute(detail)}
        onOpenFinance={openFinance}
        onOpenSettings={openMaintenance}
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

function isFinanceRoute(route: HomeRoute): route is MyFinanceRoute {
  return !(
    route === "HOME" ||
    route === "RECORD" ||
    route === "PROGRESS" ||
    route === "SPENDING_DETAIL" ||
    route === "CASHFLOW_DETAIL" ||
    route === "SAFETY_DETAIL" ||
    route === "DEBT_DETAIL"
  );
}

function isDetail(route: HomeRoute): route is HomeDetailRoute {
  return (
    route === "SPENDING_DETAIL" ||
    route === "CASHFLOW_DETAIL" ||
    route === "SAFETY_DETAIL" ||
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
  pendingDebtFactNames,
  onBack,
  onRoute,
  onCash,
}: {
  home: HomeApplicationState;
  route: HomeDetailRoute;
  pendingDebtFactNames: string[];
  onBack: () => void;
  onRoute: (route: HomeRoute) => void;
  onCash: () => void;
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
      {route === "CASHFLOW_DETAIL" && <CashflowDetail home={home} />}
      {route === "SAFETY_DETAIL" && <SafetyDetail home={home} onRoute={onRoute} onCash={onCash} />}
      {route === "DEBT_DETAIL" && (
        <DebtDetail home={home} pendingDebtFactNames={pendingDebtFactNames} />
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
    ? breakdown.find((item) => item.category === selectedCategory)
    : null;
  const visibleExpenses = selectedCategory
    ? recentExpenses.filter((expense) => expense.category === selectedCategory)
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
          现在看的是：{variableCategoryLabels[selected.category] ?? "其他"}，占本月花销{" "}
          {selected.share}%，共 {selected.count} 笔。
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
              <span>{variableCategoryLabels[expense.category] ?? "其他"}</span>
              <small>{expense.note || expense.businessDate}</small>
              <strong>¥{formatMoneyExact(expense.amount)}</strong>
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
            const active = selectedCategory == null || selectedCategory === item.category;
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
              key={item.category}
              type="button"
              className={selectedCategory === item.category ? "is-selected" : ""}
              onClick={() => onSelect(selectedCategory === item.category ? null : item.category)}
            >
              <i
                style={{
                  background: variableCategoryColors[index % variableCategoryColors.length],
                }}
              />
              <span>{variableCategoryLabels[item.category] ?? "其他"}</span>
              <strong>{item.share}%</strong>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
function CashflowDetail({ home }: { home: HomeApplicationState }) {
  return (
    <section className="detail-panel" aria-labelledby="cashflow-detail-heading">
      <h2 id="cashflow-detail-heading">这个月够不够用</h2>
      <Row label="预计进账" value={<MoneyAmount value={home.planningIncome} />} />
      <Row
        label={home.baseSurplus.startsWith("-") ? "按计划还差" : "按计划还剩"}
        value={<MoneyAmount value={home.baseSurplus} />}
      />
      <Row
        label="已经记下的进账"
        value={
          home.actualIncomeRecordCount === 0
            ? "尚未记录"
            : `已有 ${home.actualIncomeRecordCount} 笔记录`
        }
      />
      <p className="detail-status">{statusCopy[home.spendingStatus]}</p>
      <p className="detail-note">预计进账和实际到账是两回事，记下收入也不会自动改变手头现金。</p>
      <details className="detail-technical">
        <summary>想知道怎么算</summary>
        <Row
          label="每月要覆盖的生活和还款"
          value={<MoneyAmount value={home.monthlyCoreObligations} />}
        />
        <Row label="必要生活支出" value={<MoneyAmount value={home.essentialExpenses} />} />
        <Row label="本月应还" value={<MoneyAmount value={home.mandatoryDebtService} />} />
        <Row label="本月变化" value={trendCopy[home.trendState] ?? "尚无可用趋势"} />
        {home.primaryImprovement && (
          <Row label="改善方向" value={dimensions[home.primaryImprovement]} />
        )}
        {home.primaryDrag && <Row label="承压方向" value={dimensions[home.primaryDrag]} />}
      </details>
    </section>
  );
}
function SafetyDetail({
  home,
  onRoute,
  onCash,
}: {
  home: HomeApplicationState;
  onRoute: (route: HomeRoute) => void;
  onCash: () => void;
}) {
  const applicable = home.cashSafetyGateStatus !== "NOT_APPLICABLE";
  const deficit = home.spendingStatus === "STRUCTURAL_DEFICIT";
  const short = home.cashFloorMet === false;
  const coverage =
    home.safetyCoverageMonths != null &&
    Number.isFinite(Number(home.safetyCoverageMonths)) &&
    Number(home.safetyCoverageMonths) >= 0;
  return (
    <section className="detail-panel" aria-labelledby="safety-detail-heading">
      <h2 id="safety-detail-heading">安全垫情况</h2>
      <section
        className="safety-primary-status"
        data-testid="safety-primary-status"
        aria-label="当前安全情况"
      >
        <p>
          {!applicable
            ? "当前没有需要覆盖的必要支出和还款，安全覆盖月数暂不适用。"
            : deficit && short
              ? "可用现金还没有达到你设定的最低安全线；同时，这个月的计划收入也不够支付生活和必须还款。"
              : deficit
                ? "应急现金已经达到你的最低要求，但这个月的计划收入还不够支付生活和必须还款。"
                : short
                  ? "本月计划收支没有缺口，但可用现金还没有达到你设定的最低安全线。"
                  : "本月计划收支和最低现金保障均正常。"}
        </p>
        <div className="safety-primary-actions">
          {applicable && deficit && (
            <button type="button" onClick={() => onRoute("CASHFLOW_DETAIL")}>
              查看本月收支
            </button>
          )}
          {applicable && short && (
            <button type="button" onClick={onCash}>
              查看现金账户
            </button>
          )}
        </div>
      </section>
      <Row
        label="安全垫大约够几个月"
        value={
          !coverage
            ? "暂不可计算"
            : home.safetyCoverageTargetMonths === 0
              ? `${months(home.safetyCoverageMonths)} 个月 · 未设目标`
              : `${months(home.safetyCoverageMonths)} / ${months(home.safetyCoverageTargetMonths)} 个月`
        }
      />
      <Row label="安全垫目标" value={`${months(home.safetyCoverageTargetMonths)} 个月`} />
      <Row label="离安全垫目标还差" value={<MoneyAmount value={home.safetyGap} />} />
      <Row
        label="应急现金大约够几个月"
        value={
          home.cashCoverageMonths == null
            ? "暂不可计算"
            : `${months(home.cashCoverageMonths)} / ${months(home.minimumCashCoverageMonths)} 个月`
        }
      />
      <Row label="最低现金保障" value={`${months(home.minimumCashCoverageMonths)} 个月`} />
      <Row label="已经准备好的安全储备" value={<MoneyAmount value={home.safetyResources} />} />
      {applicable && short && (
        <p className="cash-warning" role="status">
          可用现金还没有达到你设定的最低安全线。
        </p>
      )}
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <Row label="纳入安全储备的现金" value={<MoneyAmount value={home.eligibleCash} />} />
        <Row
          label="纳入安全储备的流动投资"
          value={<MoneyAmount value={home.eligibleLiquidInvestmentAssets} />}
        />
        <Row label="安全目标金额" value={<MoneyAmount value={home.safetyTargetResources} />} />
        <Row
          label="整体安全状态"
          value={
            !applicable
              ? "整体安全状态暂不适用"
              : home.cashSafetyGateStatus === "CLEAR"
                ? "整体安全状态正常"
                : "整体安全状态受限"
          }
        />
        <Row label="基础收支情况" value={statusCopy[home.spendingStatus]} />
        <Row
          label="最低现金保障状态"
          value={
            home.cashFloorMet == null
              ? "现金安全线暂不适用"
              : home.cashFloorMet
                ? "现金安全线已达到"
                : "现金安全线未达标"
          }
        />
        <p className="detail-note">
          安全垫只统计明确纳入的现金和符合条件的流动投资；最低现金保障只看纳入的现金。
        </p>
      </details>
    </section>
  );
}
function DebtDetail({
  home,
  pendingDebtFactNames,
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
}) {
  const pending = new Set(pendingDebtFactNames);
  const hasPending = pending.size > 0;
  return (
    <section className="detail-panel" aria-labelledby="debt-detail-heading">
      <h2 id="debt-detail-heading">债务与本月还款</h2>
      <Row
        label="总共还欠多少"
        value={hasPending ? "本月余额待确认" : <MoneyAmount value={home.totalDebt} />}
      />
      <Row
        label="这个月需要还多少"
        value={hasPending ? "本月事实待确认" : <MoneyAmount value={home.mandatoryDebtService} />}
      />
      {hasPending && (
        <p className="finance-state-card" role="status">
          {pendingDebtFactNames.join("、")}{" "}
          的本月事实还未全部确认，确认前不显示债务总额和本月应还总额。
        </p>
      )}
      <div className="debt-detail-list">
        {home.debts.length === 0 ? (
          <p>当前没有债务记录。</p>
        ) : (
          home.debts.map((debt) => (
            <article className="debt-detail-row" key={debt.id}>
              <div className="debt-detail-title">
                <h3>{debt.name}</h3>
                {pending.has(debt.name) ? (
                  "本月余额待确认"
                ) : (
                  <MoneyAmount value={debt.currentBalance} />
                )}
              </div>
              <p>
                {pending.has(debt.name) ? (
                  "本月应还待确认"
                ) : (
                  <>
                    本月计划计入 <MoneyAmount value={debt.countedMonthlyPayment} />
                  </>
                )}
              </p>
            </article>
          ))
        )}
      </div>
      <details className="detail-technical">
        <summary>为什么 / 计算明细</summary>
        <p>
          有本月应还金额时按该金额计入；没有本月应还时才使用固定月供。两者不会相加。这里显示的是计划计入金额，不代表已经还款。
        </p>
      </details>
    </section>
  );
}
function months(value: string | number | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? "暂无"
    : formatMoneyExact(String(value));
}
