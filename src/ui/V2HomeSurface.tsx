import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Home,
  Landmark,
  ListChecks,
  Plus,
  Settings2,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ExpenseSubmission, HomeApplicationState } from "../application/product-service.js";
import { assertUserInputMoney, formatMoneyExact, money } from "../model/money.js";
import type { ExpenseCategory, ExpenseRecord } from "../model/types.js";
import { FinanceIllustration } from "./FinanceIllustration.js";
import { MoneyAmount } from "./MoneyAmount.js";
import type { MyFinanceRoute } from "./MyFinancePages.js";

declare const __WP03_PREVIEW_BUILD__: boolean;

export type ExpenseActivity = {
  id: string;
  amount: string;
  businessDate: string;
  category: ExpenseCategory;
  note?: string;
};

export type ExpenseSaveReceipt =
  | {
      status: "CONFIRMED";
      writeSignal: "RESOLVED" | "REJECTED";
      record: ExpenseRecord;
      home: HomeApplicationState;
    }
  | {
      status: "UNCONFIRMED";
      writeSignal: "RESOLVED" | "REJECTED";
      message: string;
    };

export type ConfirmedMotion = {
  kind: "cash" | "debt";
  sequence: number;
  targetId?: string;
};

type V2HomeSurfaceProps = {
  home: HomeApplicationState;
  asOfDate: string;
  pendingDebtFactNames?: string[];
  recentExpenses?: ExpenseActivity[];
  wp03PreviewDateControl?: ReactNode;
  selectedTab: SurfaceTab;
  destinationContent?: ReactNode;
  onSelectTab: (tab: SurfaceTab) => void;
  onRecordExpense: (expense: ExpenseSubmission, asOfDate: string) => Promise<ExpenseSaveReceipt>;
  onOpenDetail: (
    route: "SPENDING_DETAIL" | "CASHFLOW_DETAIL" | "SAFETY_DETAIL" | "DEBT_DETAIL",
  ) => void;
  onOpenFinance: (route?: MyFinanceRoute) => void;
  onOpenSettings: () => void;
  confirmedMotion?: ConfirmedMotion | undefined;
};

export type SurfaceTab = "TODAY" | "RECORD" | "PROGRESS" | "MINE";

const categoryLabels: Record<string, string> = {
  FOOD: "吃饭",
  TRANSPORT: "出行",
  SHOPPING: "买东西",
  ENTERTAINMENT: "娱乐",
  HOUSEHOLD: "日用",
  OTHER_VARIABLE: "其他",
};

const trendCopy: Record<string, string> = {
  IMPROVING_STRONGLY: "本月的节奏正在变得更稳。",
  IMPROVING: "本月比之前更有掌控感。",
  STABLE: "本月保持着自己的节奏。",
  UNDER_PRESSURE: "有一件小事值得今天留意。",
  DETERIORATING: "先照顾最重要的一件事，不用一次理完。",
  BASELINE_BUILDING: "先记录几次，慢慢建立属于你的基准。",
};

const statusCopy: Record<HomeApplicationState["spendingStatus"], string> = {
  NORMAL: "这个月大体够用",
  STRUCTURAL_DEFICIT: "这个月需要多留意",
  BALANCED_NO_SURPLUS: "这个月刚好持平",
};

const dimensionCopy: Record<string, string> = {
  LIQUIDITY_SAFETY: "先看看手里的现金是否够用。",
  DEBT: "核对本月的责任和还款事实。",
  CONSUMPTION: "记下一笔，就能更清楚本月节奏。",
  WEALTH: "更新资产的最新金额。",
};

export function V2HomeSurface({
  home,
  asOfDate,
  pendingDebtFactNames = [],
  recentExpenses = [],
  wp03PreviewDateControl = null,
  selectedTab,
  destinationContent,
  onSelectTab,
  onRecordExpense,
  onOpenDetail,
  onOpenFinance,
  onOpenSettings,
  confirmedMotion,
}: V2HomeSurfaceProps) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackSequence, setFeedbackSequence] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const [activeMotion, setActiveMotion] = useState<ConfirmedMotion | null>(null);
  const [unconfirmedSave, setUnconfirmedSave] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 3200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!confirmedMotion || selectedTab !== "TODAY" || destinationContent) return;
    setActiveMotion(confirmedMotion);
    const timer = window.setTimeout(() => setActiveMotion(null), 900);
    return () => window.clearTimeout(timer);
  }, [confirmedMotion, selectedTab, destinationContent]);

  const task = resolveTask(home, pendingDebtFactNames);
  const safetyProgress = progressFor(home.safetyCoverageMonths, home.safetyCoverageTargetMonths);
  const displayName = home.profileDisplayName?.trim() || "今天";

  function openExpense() {
    setExpenseError("");
    setUnconfirmedSave(false);
    setExpenseOpen(true);
  }

  function openTask() {
    if (task.kind === "spending") {
      openExpense();
      return;
    }
    if (task.kind === "debt") {
      onOpenFinance("DEBT_LIST");
      return;
    }
    if (task.kind === "safety") {
      onSelectTab("PROGRESS");
      return;
    }
    if (task.kind === "cash") {
      onOpenFinance("CASH_LIST");
      return;
    }
    onOpenFinance("INCOME_LIST");
  }

  async function saveExpense(expense: ExpenseSubmission) {
    setBusy(true);
    setExpenseError("");
    try {
      const receipt = await onRecordExpense(expense, asOfDate);
      if (receipt.status !== "CONFIRMED") {
        setExpenseError(receipt.message);
        setUnconfirmedSave(true);
        return;
      }
      setExpenseOpen(false);
      setCompleted(true);
      setSavedExpenseId(receipt.record.id);
      setFeedback(
        `已保存并重新读取确认，本月已花 ${formatYuan(receipt.home.currentMonthSpending)}。`,
      );
      setFeedbackSequence((sequence) => sequence + 1);
    } catch (error) {
      setExpenseError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="v2-shell" data-testid="v2-home">
      <header className="v2-topbar">
        <div className="v2-brand">
          <span className="v2-brand-mark" aria-hidden="true">
            <FinanceIllustration kind="brand" />
          </span>
          <div>
            <strong>小钱家</strong>
            <span>本地账本</span>
          </div>
        </div>
        <div className="v2-topbar-actions">
          <span className="v2-period">{formatPeriod(asOfDate)}</span>
          <button
            className="button button-secondary v2-top-record"
            type="button"
            onClick={openExpense}
          >
            <Plus size={17} aria-hidden="true" />
            <span>记一笔</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="更新财务数据"
            title="更新财务数据"
            onClick={onOpenSettings}
          >
            <Settings2 size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {__WP03_PREVIEW_BUILD__ && wp03PreviewDateControl && (
        <details className="trial-date-tools v2-preview-tools">
          <summary>试用日期</summary>
          {wp03PreviewDateControl}
        </details>
      )}

      <nav className="v2-primary-nav" aria-label="主导航">
        <SurfaceNavButton
          active={selectedTab === "TODAY"}
          icon={<Home size={18} />}
          onClick={() => onSelectTab("TODAY")}
        >
          今天
        </SurfaceNavButton>
        <SurfaceNavButton
          active={selectedTab === "RECORD"}
          icon={<CircleDollarSign size={18} />}
          onClick={() => onSelectTab("RECORD")}
        >
          记录
        </SurfaceNavButton>
        <SurfaceNavButton
          active={selectedTab === "PROGRESS"}
          icon={<BarChart3 size={18} />}
          onClick={() => onSelectTab("PROGRESS")}
        >
          进展
        </SurfaceNavButton>
        <SurfaceNavButton
          active={selectedTab === "MINE"}
          icon={<WalletCards size={18} />}
          onClick={() => onSelectTab("MINE")}
          ariaLabel="我的财务"
        >
          我的
        </SurfaceNavButton>
      </nav>

      <section className="v2-content">
        {destinationContent ??
          (selectedTab === "TODAY" ? (
            <TodayPanel
              home={home}
              displayName={displayName}
              asOfDate={asOfDate}
              task={task}
              completed={completed}
              safetyProgress={safetyProgress}
              pendingDebtFactNames={pendingDebtFactNames}
              recentExpenses={recentExpenses}
              savedExpenseId={savedExpenseId}
              activeMotion={activeMotion}
              onOpenExpense={openExpense}
              onOpenTask={openTask}
              onSelectTab={onSelectTab}
              onOpenDetail={onOpenDetail}
              onOpenFinance={onOpenFinance}
            />
          ) : selectedTab === "RECORD" ? (
            <RecordPanel
              recentExpenses={recentExpenses}
              onOpenExpense={openExpense}
              onOpenToday={() => onSelectTab("TODAY")}
            />
          ) : selectedTab === "PROGRESS" ? (
            <ProgressPanel
              home={home}
              pendingDebtFactNames={pendingDebtFactNames}
              onOpenDetail={onOpenDetail}
            />
          ) : null)}
      </section>

      {feedback && (
        <div className="v2-feedback" key={feedbackSequence} role="status">
          <span className="v2-feedback-icon" aria-hidden="true">
            <Check size={17} strokeWidth={3} />
          </span>
          <span>{feedback}</span>
        </div>
      )}
      {expenseOpen && (
        <ExpenseSheet
          busy={busy}
          blocked={unconfirmedSave}
          error={expenseError}
          onClose={() => setExpenseOpen(false)}
          onSubmit={saveExpense}
        />
      )}
    </main>
  );
}

function SurfaceNavButton({
  active,
  icon,
  children,
  onClick,
  ariaLabel,
}: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`v2-nav-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
    >
      <span className="v2-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}

function TodayPanel({
  home,
  displayName,
  asOfDate,
  task,
  completed,
  safetyProgress,
  pendingDebtFactNames,
  recentExpenses,
  savedExpenseId,
  activeMotion,
  onOpenExpense,
  onOpenTask,
  onSelectTab,
  onOpenDetail,
  onOpenFinance,
}: {
  home: HomeApplicationState;
  displayName: string;
  asOfDate: string;
  task: ResolvedTask;
  completed: boolean;
  safetyProgress: number | null;
  pendingDebtFactNames: string[];
  recentExpenses: ExpenseActivity[];
  savedExpenseId: string | null;
  activeMotion: ConfirmedMotion | null;
  onOpenExpense: () => void;
  onOpenTask: () => void;
  onSelectTab: (tab: SurfaceTab) => void;
  onOpenDetail: V2HomeSurfaceProps["onOpenDetail"];
  onOpenFinance: V2HomeSurfaceProps["onOpenFinance"];
}) {
  const spendingTarget = home.desiredMonthlyDiscretionarySpending;
  const targetRemaining =
    spendingTarget == null ? null : money(spendingTarget).minus(money(home.currentMonthSpending));
  const debtDisplay =
    pendingDebtFactNames.length > 0 ? "待确认" : formatYuan(home.mandatoryDebtService);
  return (
    <div className="v2-page v2-today-page">
      <section className="v2-today-intro" aria-labelledby="v2-home-title">
        <span className="v2-kicker">{formatShortDate(asOfDate)} · 今天</span>
        <h1 id="v2-home-title">你好，{displayName}</h1>
        <p>今天只需要照顾一件事。</p>
        <span className="v2-sr-only">
          {home.trendState === "IMPROVING"
            ? "本月比之前更有掌控感。"
            : (trendCopy[home.trendState] ?? "先照顾好今天的一小步。")}
        </span>
        {home.trendState === "BASELINE_BUILDING" && (
          <span className="v2-sr-only">财务基准建立中</span>
        )}
      </section>

      <section
        className={`v2-task-card ${completed ? "is-complete" : ""}`}
        aria-labelledby="v2-task-title"
      >
        <div className="v2-task-icon" aria-hidden="true">
          {completed ? <Check size={25} strokeWidth={3} /> : <Sparkles size={22} />}
        </div>
        <div className="v2-task-copy">
          <span className="v2-kicker">{completed ? "今天已完成" : "今天的一小步"}</span>
          <h2 id="v2-task-title">{completed ? "做得很好，账本已经更新" : task.title}</h2>
          <p>{completed ? "你随时可以再记一笔，或者先去看看本月进展。" : task.detail}</p>
        </div>
        <button
          className="button button-primary v2-task-action"
          type="button"
          onClick={completed ? onOpenExpense : onOpenTask}
        >
          {completed ? "再记一笔" : task.button}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>

      {pendingDebtFactNames.length > 0 && (
        <div className="v2-pending-note" role="status">
          <h2 className="v2-sr-only">{asOfDate.slice(0, 7)} 本月债务待确认</h2>
          <CreditCard size={18} aria-hidden="true" />
          <span>
            {pendingDebtFactNames.join("、")} 的本月还款还没确认。我们先不拿上个月的数字来估算。
          </span>
        </div>
      )}

      <section className="v2-today-snapshot" aria-labelledby="v2-snapshot-title">
        <div className="v2-snapshot-heading">
          <span className="v2-kicker">这个月</span>
          <button
            className="v2-text-button"
            type="button"
            onClick={() => onOpenDetail("SPENDING_DETAIL")}
          >
            查看进展 <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        <h2 id="v2-snapshot-title">{statusCopy[home.spendingStatus]}</h2>
        <p>
          {home.trendState === "BASELINE_BUILDING"
            ? "先记录几次，慢慢建立自己的节奏。"
            : "这个月的节奏正在变得更清楚。"}
        </p>
        <div className="v2-snapshot-value">
          <span>
            <MoneyAmount
              value={home.baseSurplus}
              className={savedExpenseId ? "is-expense-value-emphasis" : ""}
            />
          </span>
          <span>还可以安排</span>
        </div>
        <div className="v2-snapshot-rule">
          <span
            style={{
              width: `${Math.min(100, Math.max(0, Number(home.planningIncome) > 0 ? (Number(home.baseSurplus) / Number(home.planningIncome)) * 100 : 0))}%`,
            }}
          />
        </div>
        <div className="v2-snapshot-foot">
          <span>已花 {formatYuan(home.currentMonthSpending)}</span>
          <span>{spendingTarget == null ? "未设目标" : `目标 ${formatYuan(spendingTarget)}`}</span>
        </div>
        <div className="v2-snapshot-actions">
          <span className="v2-sr-only">{home.trendState === "IMPROVING" ? "" : ""}</span>
          <button
            className="v2-snapshot-cashflow-compat"
            type="button"
            aria-label="消费详情"
            onClick={() => onOpenDetail("SPENDING_DETAIL")}
          >
            消费详情
          </button>
          <button
            type="button"
            aria-label="收支详情"
            onClick={() => onOpenDetail("CASHFLOW_DETAIL")}
          >
            收支详情
          </button>
        </div>
      </section>
      <section className="v2-today-signals" aria-label="当前重要状态">
        <button
          className={`v2-today-signal ${activeMotion?.kind === "cash" ? "is-confirmed-cash" : ""}`}
          type="button"
          aria-label="现金安全"
          onClick={() => onOpenDetail("SAFETY_DETAIL")}
        >
          <span className="v2-signal-icon v2-tone-blue">
            <CircleDollarSign size={18} />
          </span>
          <span>
            <small>手头余地</small>
            <strong>
              {isUsableMonthValue(home.cashCoverageMonths)
                ? `${formatMonths(home.cashCoverageMonths)} 个月`
                : "暂不可计算"}
            </strong>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        <button
          className={`v2-today-signal ${activeMotion?.kind === "debt" ? "is-confirmed-debt" : ""}`}
          type="button"
          aria-label="本月责任"
          onClick={() => onOpenDetail("DEBT_DETAIL")}
        >
          <span className="v2-signal-icon v2-tone-lavender">
            <CreditCard size={18} />
          </span>
          <span>
            <small>本月要还</small>
            <strong>{pendingDebtFactNames.length > 0 ? "本月应还待确认" : debtDisplay}</strong>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </section>
      <SemanticDetailLayer
        home={home}
        pendingDebtFactNames={pendingDebtFactNames}
        safetyProgress={safetyProgress}
        activeMotion={activeMotion}
        savedExpenseId={savedExpenseId}
        onOpenDetail={onOpenDetail}
      />
      <div className="v2-sr-only" aria-hidden="true">
        <span data-testid="home-spending-status">{statusCopy[home.spendingStatus]}</span>
        {home.cashSafetyGateStatus === "ACTIVE" && home.cashFloorMet === false && (
          <span role="status">现金还没有达到你设定的最低安全线。</span>
        )}
        {home.actualIncomeRecordCount === 0 && (
          <span data-testid="no-actual-income">本月收入记录为 0 笔</span>
        )}
        {home.desiredMonthlyDiscretionarySpending == null ? (
          <span data-testid="personal-target-remaining">未设置个人目标</span>
        ) : money(home.currentMonthSpending).gt(money(home.desiredMonthlyDiscretionarySpending)) ? (
          <span data-testid="personal-target-exceeded">
            已超目标{" "}
            {formatYuan(
              money(home.currentMonthSpending)
                .minus(money(home.desiredMonthlyDiscretionarySpending))
                .toString(),
            )}
          </span>
        ) : (
          <span data-testid="personal-target-remaining">
            目标内剩余{" "}
            {formatYuan(
              money(home.desiredMonthlyDiscretionarySpending)
                .minus(money(home.currentMonthSpending))
                .toString(),
            )}
          </span>
        )}
      </div>

      <div className="v2-section-heading v2-recent-heading">
        <div>
          <span className="v2-kicker">刚刚发生</span>
          <h2>最近一笔</h2>
        </div>
        <button className="v2-text-button" type="button" onClick={() => onSelectTab("RECORD")}>
          查看记录 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <RecentExpenses
        expenses={recentExpenses}
        onOpenExpense={onOpenExpense}
        savedExpenseId={savedExpenseId}
      />
    </div>
  );
}

function SemanticDetailLayer({
  home,
  pendingDebtFactNames,
  safetyProgress,
  activeMotion,
  savedExpenseId,
  onOpenDetail,
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  safetyProgress: number | null;
  activeMotion: ConfirmedMotion | null;
  savedExpenseId: string | null;
  onOpenDetail: V2HomeSurfaceProps["onOpenDetail"];
}) {
  const debtLabel =
    pendingDebtFactNames.length > 0
      ? "本月应还待确认"
      : `本月需还 ${formatYuan(home.mandatoryDebtService)}`;
  const safetyLabel = !isUsableMonthValue(home.safetyCoverageMonths)
    ? "暂不可计算"
    : `${formatMonths(home.safetyCoverageMonths)} 个月`;
  return (
    <div className="v2-sr-only v2-semantic-detail-layer" aria-label="财务详情入口">
      <h2>照顾路径</h2>
      <button
        className={`module-spending ${savedExpenseId ? "is-expense-saved" : ""}`}
        data-primary-module="true"
        type="button"
        aria-label="查看本月可变消费详情"
        onClick={() => onOpenDetail("SPENDING_DETAIL")}
      >
        <h3>看清消费</h3>
        <span>{formatYuan(home.currentMonthSpending)}</span>
        <span>
          {home.desiredMonthlyDiscretionarySpending == null
            ? "还没设置目标"
            : `目标 ${formatYuan(home.desiredMonthlyDiscretionarySpending)}`}
        </span>
      </button>
      <button
        className="module-cashflow"
        data-primary-module="true"
        type="button"
        aria-label="查看本月收支状态详情"
        onClick={() => onOpenDetail("CASHFLOW_DETAIL")}
      >
        <h3>本月收支</h3>
        <span>{formatYuan(home.baseSurplus)}</span>
        <span>{statusCopy[home.spendingStatus]}</span>
      </button>
      <button
        className={`module-safety ${activeMotion?.kind === "cash" ? "is-confirmed-cash" : ""}`}
        data-primary-module="true"
        type="button"
        aria-label="查看安全垫详情"
        onClick={() => onOpenDetail("SAFETY_DETAIL")}
      >
        <h3>稳住现金</h3>
        <span>{safetyLabel}</span>
        <span>{home.cashFloorMet === false ? "现金安全线未达" : "现金安全线已达"}</span>
        {safetyProgress != null && (
          <span
            className="v2-path-progress"
            role="progressbar"
            aria-label="安全垫覆盖进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={safetyProgress}
            aria-valuetext={
              home.safetyCoverageTargetMonths > 0
                ? `${formatMonths(home.safetyCoverageMonths)} / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`
                : "未设定安全垫目标，不显示目标进度。"
            }
          />
        )}
        <span>
          {safetyProgress == null
            ? "覆盖进度暂不可计算"
            : home.safetyCoverageTargetMonths > 0
              ? `${formatMonths(home.safetyCoverageMonths)} / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`
              : "未设定安全垫目标，不显示目标进度。"}
        </span>
      </button>
      <button
        className={`module-debt ${activeMotion?.kind === "debt" ? "is-confirmed-debt" : ""}`}
        data-primary-module="true"
        type="button"
        aria-label="查看债务详情"
        onClick={() => onOpenDetail("DEBT_DETAIL")}
      >
        <h3>理清责任</h3>
        <span>{formatYuan(home.totalDebt)}</span>
        <span data-testid="home-mandatory-debt-service">
          {pendingDebtFactNames.length > 0 ? "本月应还待确认" : debtLabel}
        </span>
      </button>
    </div>
  );
}

function PathCard({
  className,
  tone,
  icon,
  title,
  value,
  meta,
  testId,
  onClick,
  ariaLabel,
  progress,
  progressLabel,
  extra,
  dataPrimary = false,
  effectClassName = "",
}: {
  className: string;
  tone: "coral" | "blue" | "yellow" | "lavender";
  icon: ReactNode;
  title: string;
  value: ReactNode;
  meta: string;
  testId: string;
  onClick: () => void;
  ariaLabel: string;
  progress?: number | null;
  progressLabel?: string;
  extra?: ReactNode;
  dataPrimary?: boolean;
  effectClassName?: string;
}) {
  return (
    <button
      type="button"
      className={`v2-path-card ${className} ${effectClassName}`}
      data-primary-module={dataPrimary ? "true" : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <div className={`v2-path-icon v2-tone-${tone}`} aria-hidden="true">
        {icon}
      </div>
      <div className="v2-path-copy">
        <div className="v2-path-title-row">
          <h3>{title}</h3>
          <span className="v2-path-open" aria-hidden="true">
            <ChevronRight size={17} aria-hidden="true" />
          </span>
        </div>
        <strong className="v2-path-value" data-testid={testId}>
          {value}
        </strong>
        <span className="v2-path-meta">{meta}</span>
        {progress != null && progressLabel && (
          <div className="v2-path-progress-wrap">
            <div
              className="v2-path-progress"
              role="progressbar"
              aria-label="安全垫覆盖进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={progressLabel}
            >
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>{progressLabel}</span>
          </div>
        )}
        {progress === null && progressLabel && (
          <span className="v2-path-unavailable">{progressLabel}</span>
        )}
        {extra}
      </div>
    </button>
  );
}

function ProgressPanel({
  home,
  pendingDebtFactNames,
  onOpenDetail,
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  onOpenDetail: V2HomeSurfaceProps["onOpenDetail"];
}) {
  const liquidity = home.trendDimensions.LIQUIDITY_SAFETY;
  const debt = home.trendDimensions.DEBT;
  const consumption = home.trendDimensions.CONSUMPTION;
  const debtPending = pendingDebtFactNames.length > 0;
  const coverageUnavailable = home.safetyCoverageStatus === "NO_CORE_OBLIGATION";
  const items = [
    {
      title: "看清消费",
      detail: `${directionLabel(consumption.direction)} · ${modelReasonCopy(consumption.reason)}`,
      value: formatYuan(home.currentMonthSpending),
      tone: "coral" as const,
      route: "SPENDING_DETAIL" as const,
    },
    {
      title: "稳住现金",
      detail: coverageUnavailable
        ? `${directionLabel(liquidity.direction)} · 暂无需要覆盖的核心支出。`
        : `${directionLabel(liquidity.direction)} · ${modelReasonCopy(liquidity.reason)}`,
      value: coverageUnavailable
        ? "不适用"
        : !isUsableMonthValue(home.cashCoverageMonths)
          ? "暂不可计算"
          : `现金覆盖 ${formatMonths(home.cashCoverageMonths)} 个月`,
      tone: "blue" as const,
      route: "SAFETY_DETAIL" as const,
    },
    {
      title: "理清责任",
      detail: debtPending
        ? `待确认 · ${pendingDebtFactNames.join("、")} 的本月事实尚未全部确认。`
        : `${directionLabel(debt.direction)} · ${modelReasonCopy(debt.reason)}`,
      value: debtPending ? "本月待确认" : formatYuan(home.totalDebt),
      tone: "lavender" as const,
      route: "DEBT_DETAIL" as const,
    },
    {
      title: "建立余地",
      detail: coverageUnavailable
        ? `${directionLabel(liquidity.direction)} · 暂无需要覆盖的核心支出。`
        : `${directionLabel(liquidity.direction)} · ${modelReasonCopy(liquidity.reason)}`,
      value: coverageUnavailable
        ? "不适用"
        : !isUsableMonthValue(home.safetyCoverageMonths)
          ? "暂不可计算"
          : `安全垫差额 ${formatYuan(home.safetyGap)} · ${formatMonths(home.safetyCoverageMonths)} / ${formatMonths(home.safetyCoverageTargetMonths)} 个月`,
      tone: "yellow" as const,
      route: "SAFETY_DETAIL" as const,
    },
  ];
  return (
    <div className="v2-page v2-progress-page">
      <section className="v2-page-heading">
        <span className="v2-kicker">慢慢看清</span>
        <h1>本月看看</h1>
        <p>四件重要的事，按需要看。</p>
      </section>
      <div className="v2-progress-summary">
        <div>
          <span className="v2-kicker">这个月</span>
          <strong>{statusCopy[home.spendingStatus]}</strong>
          <p>{trendCopy[home.trendState] ?? "继续记录，基准会越来越清楚。"}</p>
        </div>
      </div>
      <section className="v2-progress-list" aria-label="财务进展路径">
        {items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className="v2-progress-row"
            onClick={() => onOpenDetail(item.route)}
          >
            <span className={`v2-progress-number v2-tone-${item.tone}`}>{index + 1}</span>
            <span className="v2-progress-row-copy">
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <span className="v2-progress-row-value">{item.value}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </section>
      <SpendingInsight breakdown={home.spendingBreakdown ?? []} onOpenDetail={onOpenDetail} />
    </div>
  );
}

function SpendingInsight({
  breakdown,
  onOpenDetail,
}: {
  breakdown: NonNullable<HomeApplicationState["spendingBreakdown"]>;
  onOpenDetail: V2HomeSurfaceProps["onOpenDetail"];
}) {
  const top = breakdown[0];
  return (
    <button
      className="v2-insight-panel"
      type="button"
      aria-labelledby="spending-insight-title"
      onClick={() => onOpenDetail("SPENDING_DETAIL")}
    >
      <div className="v2-insight-header">
        <div>
          <span className="v2-kicker">钱花在哪儿</span>
          <h2 id="spending-insight-title">这个月的花钱分布</h2>
        </div>
        <span className="v2-insight-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      {top ? (
        <>
          <p className="v2-insight-lead">
            目前最多花在 <strong>{categoryLabels[top.category]}</strong>，占本月可变消费的{" "}
            {top.share}%。
          </p>
          <div className="v2-category-bars">
            {breakdown.slice(0, 4).map((item, index) => (
              <div className="v2-category-row" key={item.category}>
                <span className={`v2-category-dot v2-category-dot-${index}`} aria-hidden="true" />
                <span className="v2-category-name">{categoryLabels[item.category]}</span>
                <div className="v2-category-track">
                  <i style={{ width: `${item.share}%` }} />
                </div>
                <strong>{item.share}%</strong>
              </div>
            ))}
          </div>
          <p className="v2-insight-note">先看看，不用马上改变。知道钱去了哪里，就是很好的开始。</p>
        </>
      ) : (
        <div className="v2-insight-empty">
          <Sparkles size={20} aria-hidden="true" />
          <span>再记几笔，就能看到钱主要花在哪儿。</span>
        </div>
      )}
    </button>
  );
}

function directionLabel(direction: string): string {
  const labels: Record<string, string> = {
    IMPROVING: "改善",
    NEUTRAL: "持平",
    WORSENING: "承压",
    NO_BASELINE: "暂无基线",
    NOT_APPLICABLE: "暂不适用",
  };
  return labels[direction] ?? "暂不可用";
}

function modelReasonCopy(reason: string): string {
  const copy: Record<string, string> = {
    "Prior same-period variable spending is missing.": "缺少上期同期消费记录，暂不能比较。",
    "Prior cash or core-obligation baseline is missing.":
      "缺少上期现金或核心支出基线，暂不能比较。",
    "Prior cash coverage baseline is unavailable.": "缺少可比较的上期现金覆盖基线。",
    "Cash Floor changed from unmet to met.": "现金保障线从未达到变为已达到。",
    "Cash Floor changed from met to unmet.": "现金保障线从已达到变为未达到。",
    "Cash Coverage increased from the prior snapshot.": "现金覆盖高于上期记录。",
    "Cash Coverage decreased from the prior snapshot.": "现金覆盖低于上期记录。",
    "Cash Coverage and Cash Floor status are unchanged.": "现金覆盖与保障线状态和上期相同。",
    "Prior valid debt balance is missing.": "缺少上期有效债务余额，暂不能比较。",
    "Valid debt balance decreased.": "有效债务余额低于上期记录。",
    "Valid debt balance increased.": "有效债务余额高于上期记录。",
    "Valid debt balance is unchanged.": "有效债务余额和上期相同。",
    "Prior liquid-investable-asset snapshot is missing.": "缺少上期流动投资资产基线，暂不能比较。",
    "Liquid-investable-asset value increased.": "流动投资资产高于上期记录。",
    "Liquid-investable-asset value decreased.": "流动投资资产低于上期记录。",
    "Liquid-investable-asset value is unchanged.": "流动投资资产和上期相同。",
    "Spending exceeds the zero recommendation and increased from the prior same period.":
      "当前参考额度为零，且消费高于上期同期。",
    "Same-period spending decreased.": "消费低于上期同期。",
    "Spending matches the prior same period at a zero recommendation.":
      "当前参考额度为零，消费和上期同期相同。",
    "Spending is above recommendation and increased from the prior same period.":
      "消费高于参考额度，且高于上期同期。",
    "No comparable prior utilization value is available.": "缺少可比较的上期消费利用率。",
    "Utilization is not comparable for one period.": "本期消费利用率暂不能与上期比较。",
    "Spending exceeded prorated recommendation and increased from the prior same period.":
      "消费高于本期参考额度，且高于上期同期。",
    "Recommended Spending Utilization improved.": "消费相对于本期参考额度有所改善。",
    "Spending has not worsened beyond the prorated recommendation trajectory.":
      "消费未超过本期参考额度的变化范围。",
    "No core obligations exist to cover.": "暂无需要覆盖的核心支出。",
  };
  return copy[reason] ?? reason;
}

function RecordPanel({
  recentExpenses,
  onOpenExpense,
  onOpenToday,
}: {
  recentExpenses: ExpenseActivity[];
  onOpenExpense: () => void;
  onOpenToday: () => void;
}) {
  return (
    <div className="v2-page v2-record-page">
      <section className="v2-page-heading">
        <span className="v2-kicker">保持轻盈</span>
        <h1>记录一笔</h1>
        <p>金额先记下来，分类和备注都可以稍后补。</p>
      </section>
      <button className="v2-record-hero" type="button" onClick={onOpenExpense}>
        <span className="v2-record-hero-icon">
          <Plus size={26} aria-hidden="true" />
        </span>
        <span>
          <strong>记下今天的花销</strong>
          <small>通常只需要 3–5 秒</small>
        </span>
        <ArrowRight size={20} aria-hidden="true" />
      </button>
      <div className="v2-section-heading">
        <div>
          <span className="v2-kicker">本地记录</span>
          <h2>最近消费</h2>
        </div>
        <button className="v2-text-button" type="button" onClick={onOpenToday}>
          回到今天
        </button>
      </div>
      <RecentExpenses expenses={recentExpenses} onOpenExpense={onOpenExpense} />
    </div>
  );
}

function RecentExpenses({
  expenses,
  onOpenExpense,
  savedExpenseId,
}: {
  expenses: ExpenseActivity[];
  onOpenExpense: () => void;
  savedExpenseId?: string | null;
}) {
  if (expenses.length === 0)
    return (
      <section className="v2-empty-state">
        <ListChecks size={23} aria-hidden="true" />
        <strong>还没有最近记录</strong>
        <p>记下第一笔，就能看到本月节奏。</p>
        <button className="v2-text-button" type="button" onClick={onOpenExpense}>
          记第一笔 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>
    );
  return (
    <section className="v2-recent-list" aria-label="最近消费记录">
      {expenses.slice(0, 3).map((expense) => (
        <div
          className={`v2-recent-row ${savedExpenseId === expense.id ? "is-newly-saved" : ""}`}
          key={expense.id}
        >
          <span className="v2-recent-icon" aria-hidden="true">
            <CircleDollarSign size={17} />
          </span>
          <span className="v2-recent-copy">
            <strong>{categoryLabels[expense.category] ?? "消费"}</strong>
            <small>{expense.note || expense.businessDate}</small>
          </span>
          <MoneyAmount value={expense.amount} />
        </div>
      ))}
    </section>
  );
}

function ExpenseSheet({
  busy,
  blocked,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  blocked: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (expense: ExpenseSubmission) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [dateTime, setDateTime] = useState(toLocalDateTime(new Date()));
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    amountRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [busy, onClose]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let canonicalAmount: string;
    try {
      canonicalAmount = assertUserInputMoney(amount.trim(), "消费金额");
    } catch {
      setValidationError("请输入有效的消费金额。");
      return;
    }
    if (!money(canonicalAmount).gt(0)) {
      setValidationError("请输入大于 0 的金额。");
      return;
    }
    if (!dateTime) {
      setValidationError("请填写有效的日期和时间。");
      return;
    }
    setValidationError("");
    const expense: ExpenseSubmission = {
      id: globalThis.crypto.randomUUID(),
      amount: amount.trim(),
      dateTime: new Date(dateTime).toISOString(),
      businessDate: dateTime.slice(0, 10),
      ...(category ? { category: category as NonNullable<ExpenseSubmission["category"]> } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    void onSubmit(expense);
  }
  return (
    <div className="v2-sheet-backdrop">
      <section
        ref={dialogRef}
        className="v2-expense-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-expense-title"
      >
        <header className="v2-sheet-header">
          <div>
            <span className="v2-kicker">QUICK ENTRY</span>
            <h2 id="v2-expense-title">记一笔消费</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <label className="v2-amount-input">
            金额
            <input
              ref={amountRef}
              aria-label="消费金额"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            <span>元</span>
          </label>
          <div className="v2-category-picker">
            <span>分类（选填）</span>
            <div>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={category === key ? "is-selected" : ""}
                  onClick={() => setCategory(category === key ? "" : key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label>
            日期和时间
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(event) => setDateTime(event.target.value)}
            />
          </label>
          <label>
            备注（选填）
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：午餐"
            />
          </label>
          {(error || validationError) && (
            <p className="form-error" role="alert">
              {error || validationError}
            </p>
          )}
          <div className="v2-sheet-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </button>
            <button type="submit" className="button button-primary" disabled={busy || blocked}>
              {busy ? "保存中…" : blocked ? "请先核对结果" : "保存消费"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

type ResolvedTask = {
  kind: "spending" | "cash" | "debt" | "safety" | "income";
  title: string;
  detail: string;
  button: string;
};

function resolveTask(home: HomeApplicationState, pendingDebtFactNames: string[]): ResolvedTask {
  if (pendingDebtFactNames.length > 0)
    return {
      kind: "debt",
      title: "确认本月要还多少",
      detail: "本月债务事实还没确认，先核对这一件。",
      button: "去确认",
    };
  const action = home.priorityAction.action_code;
  if (action === "RESTORE_CORE_BALANCE")
    return {
      kind: "income",
      title: "先把本月收支缺口理清",
      detail: "看看计划收入和生活支出之间差在哪里。",
      button: "去看看",
    };
  if (action === "REBUILD_CASH_FLOOR")
    return {
      kind: "cash",
      title: "先让手里的现金安心一点",
      detail: "现在的可用现金还没到你设定的安心线。",
      button: "去看看",
    };
  if (action === "ADDRESS_SAFETY_GAP")
    return {
      kind: "safety",
      title: "看看安全垫离目标还有多远",
      detail: "了解当前余地，不用一次把它补齐。",
      button: "看进度",
    };
  if (action === "ADDRESS_PRIMARY_DRAG") {
    if (home.primaryDrag === "DEBT")
      return {
        kind: "debt",
        title: "核对本月的还款责任",
        detail: dimensionCopy.DEBT ?? "核对本月的责任和还款事实。",
        button: "去核对",
      };
    if (home.primaryDrag === "LIQUIDITY_SAFETY")
      return {
        kind: "cash",
        title: "先看看手里的现金够不够用",
        detail: dimensionCopy.LIQUIDITY_SAFETY ?? "先看看手里的现金是否够用。",
        button: "去核对",
      };
    if (home.primaryDrag === "WEALTH")
      return {
        kind: "safety",
        title: "更新资产的最新金额",
        detail: dimensionCopy.WEALTH ?? "更新资产的最新金额。",
        button: "去更新",
      };
  }
  return {
    kind: "spending",
    title: "记下一笔今天的花销",
    detail: "记下来就会更清楚本月的节奏。",
    button: "开始记录",
  };
}

function progressFor(value: string | null, target: number) {
  const current = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(target) || target <= 0)
    return null;
  return Math.min(100, Math.max(0, (current / target) * 100));
}

function formatYuan(value: string | null | undefined) {
  if (value == null) return "未设置";
  return `¥${formatMoneyExact(value)}`;
}

function formatMonths(value: string | number | null | undefined) {
  if (value == null) return "暂无";
  const numeric = Number(value);
  return !Number.isFinite(numeric) || numeric < 0 ? "暂不可计算" : formatMoneyExact(String(value));
}

function isUsableMonthValue(value: string | number | null | undefined): value is string | number {
  if (value == null) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function formatPeriod(value: string) {
  return `${value.slice(0, 4)} 年 ${Number(value.slice(5, 7))} 月`;
}

function formatShortDate(value: string) {
  return `${Number(value.slice(5, 7))} 月 ${Number(value.slice(8, 10))} 日`;
}

function toLocalDateTime(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
