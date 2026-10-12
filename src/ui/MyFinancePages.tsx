import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { SaveCurrentMonthDebtFactResult } from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../application/product-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import { money } from "../model/money.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import { FinanceIllustration, type financeArt } from "./FinanceIllustration.js";
import { MoneyAmount } from "./MoneyAmount.js";

export type MyFinanceRoute =
  | "MY_FINANCE"
  | "INCOME_LIST"
  | "PLANNING_INCOME"
  | "MONTH_PLANNING"
  | "CASH_LIST"
  | "ASSET_LIST"
  | "DEBT_LIST"
  | "SAFETY_LIST";

export function MyFinancePages({
  route,
  home,
  data,
  loading,
  error,
  asOfDate,
  onRoute,
  onBack,
  onHome,
  onRetry,
  onOpenLegacyMaintenance,
  getRequirement,
  onSavePlanning,
  isSessionDateCurrent,
  onGetPlanningMonth,
  onSavePlanningMonth,
  onReviseActualIncome,
  onDeactivateCashAccount,
  onDeactivateAsset,
  onDeactivateDebt,
  onSaveCurrentMonthDebtFact,
}: {
  route: MyFinanceRoute;
  home: HomeApplicationState;
  data: FinancialMaintenanceState | null;
  loading: boolean;
  error: string;
  asOfDate: string;
  onRoute: (route: MyFinanceRoute) => void;
  onBack: () => void;
  onHome: () => void;
  onRetry: () => void;
  onOpenLegacyMaintenance: () => void;
  getRequirement: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  onSavePlanning: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<FinancialMaintenanceState>;
  isSessionDateCurrent: () => boolean;
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
  if (route === "PLANNING_INCOME") {
    return (
      <PlanningIncomePage
        data={data}
        loading={loading}
        error={error}
        asOfDate={asOfDate}
        onBack={onBack}
        onHome={onHome}
        onRetry={onRetry}
        getRequirement={getRequirement}
        onSave={onSavePlanning}
        isSessionDateCurrent={isSessionDateCurrent}
      />
    );
  }
  if (route === "MONTH_PLANNING") {
    return (
      <MonthPlanningPage
        asOfDate={asOfDate}
        stableAmount={data?.stableMonthlyIncome ?? "0"}
        onBack={onBack}
        onHome={onHome}
        getMonth={onGetPlanningMonth}
        saveMonth={onSavePlanningMonth}
        isSessionDateCurrent={isSessionDateCurrent}
      />
    );
  }

  const title = route === "MY_FINANCE" ? "我的财务" : categoryTitle[route];
  return (
    <main className="home-page finance-page">
      <FinancePageHeader title={title} onBack={route === "MY_FINANCE" ? onHome : onBack} />
      {loading ? (
        <section className="finance-state-card" role="status">
          正在读取当前财务项目…
        </section>
      ) : error ? (
        <section className="finance-state-card" aria-live="polite">
          <p role="alert">读取失败：{error}</p>
          <button className="button button-secondary" type="button" onClick={onRetry}>
            重试
          </button>
          <button
            className="text-button finance-legacy-link"
            type="button"
            onClick={onOpenLegacyMaintenance}
          >
            打开现有财务维护
          </button>
        </section>
      ) : !data ? (
        <section className="finance-state-card">
          <p>当前财务项目尚未读取。</p>
          <button className="button button-secondary" type="button" onClick={onRetry}>
            读取当前数据
          </button>
        </section>
      ) : route === "MY_FINANCE" ? (
        <Hub
          data={data}
          home={home}
          onRoute={onRoute}
          onOpenLegacyMaintenance={onOpenLegacyMaintenance}
        />
      ) : (
        <CategoryList
          route={route}
          data={data}
          home={home}
          asOfDate={asOfDate}
          onPlanningEdit={() => onRoute("PLANNING_INCOME")}
          onOpenLegacyMaintenance={onOpenLegacyMaintenance}
          onRoute={onRoute}
          onSavePatch={onSavePlanning}
          onReviseActualIncome={onReviseActualIncome}
          onGetActualHistory={onGetPlanningMonth}
          onDeactivateCashAccount={onDeactivateCashAccount}
          onDeactivateAsset={onDeactivateAsset}
          onDeactivateDebt={onDeactivateDebt}
          onSaveCurrentMonthDebtFact={onSaveCurrentMonthDebtFact}
          onGetRequirement={getRequirement}
          isSessionDateCurrent={isSessionDateCurrent}
        />
      )}
    </main>
  );
}

const categoryTitle: Record<
  Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME" | "MONTH_PLANNING">,
  string
> = {
  INCOME_LIST: "收入",
  CASH_LIST: "现金",
  ASSET_LIST: "资产",
  DEBT_LIST: "债务",
  SAFETY_LIST: "安全目标",
};

const categories: Array<{
  route: Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME" | "MONTH_PLANNING">;
  title: "收入" | "现金" | "资产" | "债务";
  description: string;
}> = [
  { route: "INCOME_LIST", title: "收入", description: "长期计划收入与本月收入记录" },
  { route: "CASH_LIST", title: "现金", description: "当前现金账户" },
  { route: "ASSET_LIST", title: "资产", description: "当前有效资产项目" },
  { route: "DEBT_LIST", title: "债务", description: "当前债务与本月已计入还款" },
];

function FinancePageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="finance-page-header">
      <button className="back-button" type="button" onClick={onBack} aria-label="返回">
        <span aria-hidden="true">←</span> 返回
      </button>
      <h1>{title}</h1>
    </header>
  );
}

function Hub({
  data,
  home,
  onRoute,
  onOpenLegacyMaintenance,
}: {
  data: FinancialMaintenanceState;
  home: HomeApplicationState;
  onRoute: (route: MyFinanceRoute) => void;
  onOpenLegacyMaintenance: () => void;
}) {
  const cards: Record<
    (typeof categories)[number]["title"],
    { kind: keyof typeof financeArt; primary: string; suffix?: string; secondary: ReactNode }
  > = {
    收入: {
      kind: "income",
      primary: data.stableMonthlyIncome,
      suffix: " / 月",
      secondary: `本月收入记录 ${data.actualIncomeRecords.length} 笔`,
    },
    现金: {
      kind: "cash",
      primary: sum(data.cashAccounts.map((item) => item.balance)),
      secondary: `${data.cashAccounts.length} 个账户`,
    },
    资产: {
      kind: "assets",
      primary: allEffectiveAssetsTotal(data),
      secondary: `${data.assets.length} 项当前有效资产`,
    },
    债务: {
      kind: "debt",
      primary: home.totalDebt,
      secondary: (
        <>
          {data.debts.length} 笔 · 本月必须还款{" "}
          <MoneyAmount value={home.mandatoryDebtService} size="inline" />
        </>
      ),
    },
  };
  return (
    <>
      <section className="finance-hub-grid" aria-label="四类财务项目">
        {categories.map((item) => {
          const card = cards[item.title];
          return (
            <button
              key={item.route}
              className="finance-category-card"
              data-primary-category={item.route}
              type="button"
              onClick={() => onRoute(item.route)}
            >
              <FinanceIllustration kind={card.kind} className="finance-card-art" />
              <span className="finance-card-copy">
                <span className="finance-card-title">{item.title}</span>
                <strong className="finance-card-primary">
                  <MoneyAmount value={card.primary} size="summary" />
                  {card.suffix}
                </strong>
                <span className="finance-card-summary">{card.secondary}</span>
                {item.title === "债务" && (
                  <span className="finance-card-context">本月还款按模型计入金额</span>
                )}
              </span>
              <span className="finance-card-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
      </section>
      <section className="finance-secondary-entry">
        <FinanceIllustration kind="plan" className="secondary-plan-art" />
        <div>
          <h2>生活支出与计划</h2>
          <p>维护必要支出、消费目标和安全参数。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onOpenLegacyMaintenance}>
          高级维护
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={() => onRoute("SAFETY_LIST")}
        >
          设置安全目标
        </button>
      </section>
      <button
        className="text-button finance-legacy-link"
        type="button"
        onClick={onOpenLegacyMaintenance}
      >
        打开现有综合维护
      </button>
    </>
  );
}

function CategoryList({
  route,
  data,
  home,
  asOfDate,
  onPlanningEdit,
  onOpenLegacyMaintenance,
  onRoute,
  onSavePatch,
  onReviseActualIncome,
  onGetActualHistory,
  onDeactivateCashAccount,
  onDeactivateAsset,
  onDeactivateDebt,
  onSaveCurrentMonthDebtFact,
  onGetRequirement,
  isSessionDateCurrent,
}: {
  route: Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME" | "MONTH_PLANNING">;
  data: FinancialMaintenanceState;
  home: HomeApplicationState;
  asOfDate: string;
  onPlanningEdit: () => void;
  onOpenLegacyMaintenance: () => void;
  onRoute: (route: MyFinanceRoute) => void;
  onSavePatch: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<FinancialMaintenanceState>;
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
  onGetActualHistory?: ((month: string) => Promise<V4FinancialReadState>) | undefined;
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
  onGetRequirement: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  isSessionDateCurrent: () => boolean;
}) {
  const [editing, setEditing] = useState<DailyEdit | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<{
    kind: "cash" | "asset" | "debt";
    id: string;
    name: string;
  } | null>(null);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  const [actualHistory, setActualHistory] = useState<V4FinancialReadState["actualIncomeHistory"]>(
    [],
  );
  const [domainHistory, setDomainHistory] = useState<V4FinancialReadState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  return (
    <section className="finance-list-panel" aria-label={`${categoryTitle[route]}项目`}>
      {route !== "INCOME_LIST" && route !== "SAFETY_LIST" && (
        <FinanceListSummary
          route={route}
          count={
            route === "CASH_LIST"
              ? data.cashAccounts.length
              : route === "ASSET_LIST"
                ? data.assets.length
                : data.debts.length
          }
          total={
            route === "CASH_LIST"
              ? sum(data.cashAccounts.map((item) => item.balance))
              : route === "ASSET_LIST"
                ? allEffectiveAssetsTotal(data)
                : home.totalDebt
          }
          {...(route === "DEBT_LIST"
            ? {
                secondary: (
                  <>
                    本月必须还款 <MoneyAmount value={home.mandatoryDebtService} size="inline" />
                  </>
                ),
              }
            : {})}
        />
      )}
      {route === "INCOME_LIST" && (
        <>
          <article className="finance-list-card planning-income-summary">
            <FinanceIllustration kind="income" className="finance-summary-art" />
            <div>
              <span className="finance-row-eyebrow">用于长期计划的基础收入</span>
              <h2>稳定月收入</h2>
              <p>维护日期 {asOfDate}</p>
            </div>
            <strong>
              <MoneyAmount value={data.stableMonthlyIncome} size="summary" />
            </strong>
            <button
              className="button button-secondary"
              type="button"
              aria-label="编辑稳定月收入"
              onClick={onPlanningEdit}
            >
              编辑
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => onRoute("MONTH_PLANNING")}
            >
              设置本月计划
            </button>
          </article>
          <div className="finance-list-heading">
            <h2>本月收入记录</h2>
            <span>{data.actualIncomeRecords.length} 笔</span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setEditing({ kind: "actual", amount: "", date: asOfDate, status: "EXPECTED" });
                setEditError("");
              }}
            >
              新增收入
            </button>
          </div>
          <button
            className="text-button"
            type="button"
            disabled={historyLoading}
            onClick={() => {
              if (historyOpen) {
                setHistoryOpen(false);
                return;
              }
              setHistoryLoading(true);
              void onGetActualHistory?.(asOfDate.slice(0, 7))
                .then((value) => {
                  setActualHistory(value.actualIncomeHistory);
                  setHistoryOpen(true);
                })
                .catch((reason: unknown) =>
                  setEditError(reason instanceof Error ? reason.message : "读取收入历史失败。"),
                )
                .finally(() => setHistoryLoading(false));
            }}
          >
            {historyLoading ? "正在读取…" : historyOpen ? "收起收入历史" : "查看收入历史"}
          </button>
          {historyOpen && (
            <section className="stable-income-history" aria-label="实际收入修改历史">
              {actualHistory.length === 0 ? (
                <p className="finance-empty-state">暂无收入修改记录。</p>
              ) : (
                actualHistory.map((entry) => (
                  <article
                    className="finance-data-row"
                    key={`${entry.id}-${entry.revisionId ?? "base"}`}
                  >
                    <div>
                      <strong>
                        {actualStatusLabel[entry.status]}
                        {entry.active ? "" : " · 已作废"}
                      </strong>
                      <span>业务日期 · {entry.date}</span>
                      <span>记录日期 · {entry.asOfDate}</span>
                    </div>
                    <strong>
                      <MoneyAmount value={entry.amount} size="list" />
                    </strong>
                  </article>
                ))
              )}
            </section>
          )}
          {data.actualIncomeRecords.length === 0 ? (
            <div className="finance-empty-state">
              <FinanceIllustration kind="incomeEmpty" className="income-empty-art" />
              <strong>本月尚未记录实际收入</strong>
              <span>实际收入会单独记录，不包含在稳定月收入中。</span>
            </div>
          ) : (
            data.actualIncomeRecords.map((item) => (
              <article
                className="finance-data-row income-record-row"
                data-visual-tone={visualToneForId(item.id)}
                key={item.id}
              >
                <FinanceIllustration kind="income" className="finance-row-art" />
                <div>
                  <strong>{actualStatusLabel[item.status]}</strong>
                  <span>{item.date}</span>
                </div>
                <strong>
                  <MoneyAmount value={item.amount} size="list" />
                </strong>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setEditing({
                      kind: "actual",
                      id: item.id,
                      amount: item.amount,
                      date: item.date,
                      status: item.status,
                    });
                    setEditError("");
                  }}
                >
                  修改
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setEditing({
                      kind: "actual",
                      id: item.id,
                      amount: item.amount,
                      date: item.date,
                      status: item.status,
                      void: true,
                    });
                    setEditError("");
                  }}
                >
                  作废
                </button>
              </article>
            ))
          )}
          <StablePlanningIncomeHistory
            revisions={data.stableIncomeRevisions}
            viewAsOfDate={asOfDate}
          />
        </>
      )}
      {route === "CASH_LIST" &&
        (data.cashAccounts.length ? (
          data.cashAccounts.map((item) => (
            <article
              className="finance-data-row"
              data-visual-tone={visualToneForId(item.id)}
              key={item.id}
            >
              <FinanceIllustration kind="cash" className="finance-row-art" />
              <div>
                <strong>{item.name}</strong>
                <span>{item.includeInSafetyResources ? "纳入安全储备" : "不纳入安全储备"}</span>
              </div>
              <strong>
                <MoneyAmount value={item.balance} size="list" />
              </strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setEditing({
                    kind: "cash",
                    id: item.id,
                    name: item.name,
                    amount: item.balance,
                    include: item.includeInSafetyResources,
                  })
                }
              >
                编辑
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setPendingDeactivation({ kind: "cash", id: item.id, name: item.name })
                }
              >
                停用账户
              </button>
            </article>
          ))
        ) : (
          <p className="finance-empty-state">当前没有现金账户。</p>
        ))}
      {route === "ASSET_LIST" &&
        (data.assets.length ? (
          data.assets.map((item) => (
            <article
              className="finance-data-row"
              data-visual-tone={visualToneForId(item.id)}
              key={item.id}
            >
              <FinanceIllustration kind="assets" className="finance-row-art" />
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.kind === "LIQUID_INVESTMENT" ? "流动投资" : "其他资产"} ·{" "}
                  {item.includeInSafetyResources ? "纳入安全储备" : "不纳入安全储备"}
                </span>
              </div>
              <strong>
                <MoneyAmount value={item.currentValue} size="list" />
              </strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setEditing({
                    kind: "asset",
                    id: item.id,
                    name: item.name,
                    amount: item.currentValue,
                    kindValue: item.kind,
                    include: item.includeInSafetyResources,
                  })
                }
              >
                编辑
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setPendingDeactivation({ kind: "asset", id: item.id, name: item.name })
                }
              >
                停用资产
              </button>
            </article>
          ))
        ) : (
          <p className="finance-empty-state">当前没有资产。</p>
        ))}
      {route === "DEBT_LIST" &&
        (data.debts.length ? (
          data.debts.map((item) => {
            const modelDebt = home.debts.find((candidate) => candidate.id === item.id);
            return (
              <article
                className="finance-data-row"
                data-visual-tone={visualToneForId(item.id)}
                key={item.id}
              >
                <FinanceIllustration kind="debt" className="finance-row-art" />
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.needsCurrentMonthFact || !modelDebt ? (
                      "本月还款待确认"
                    ) : (
                      <>
                        本月已计入还款{" "}
                        <MoneyAmount value={modelDebt.countedMonthlyPayment} size="inline" />
                      </>
                    )}
                  </span>
                </div>
                <strong>
                  <MoneyAmount value={item.currentBalance} size="list" />
                </strong>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    setEditing({
                      kind: "debt",
                      id: item.id,
                      name: item.name,
                      amount: item.currentBalance,
                      due: item.currentMonthDue ?? "",
                      fixed: item.fixedMonthlyPayment ?? "",
                    })
                  }
                >
                  编辑
                </button>
                {item.needsCurrentMonthFact && (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      setEditing({
                        kind: "debt",
                        id: item.id,
                        name: item.name,
                        amount: item.currentBalance,
                        due: "",
                        fixed: item.fixedMonthlyPayment ?? "",
                        confirmOnly: true,
                      })
                    }
                  >
                    确认本月事实
                  </button>
                )}
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    setPendingDeactivation({ kind: "debt", id: item.id, name: item.name })
                  }
                >
                  停用债务
                </button>
              </article>
            );
          })
        ) : (
          <p className="finance-empty-state">当前没有债务。</p>
        ))}
      {route === "DEBT_LIST" && data.debts.some((item) => item.needsCurrentMonthFact) && (
        <section className="finance-state-card" role="status">
          <strong>首页还需要确认本月债务</strong>
          <p>
            {data.debts
              .filter((item) => item.needsCurrentMonthFact)
              .map((item) => item.name)
              .join("、")}
          </p>
          <p>逐笔保存本月余额和应还金额后，首页才会使用完整的本月事实。</p>
        </section>
      )}
      {route !== "INCOME_LIST" && route !== "SAFETY_LIST" && (
        <div className="finance-list-heading">
          <h2>日常维护</h2>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setEditing(newDailyEdit(route))}
          >
            新增{categoryTitle[route]}
          </button>
        </div>
      )}
      {route === "SAFETY_LIST" && (
        <section className="finance-list-card">
          <h2>安全目标</h2>
          <p>安全垫目标：{data.settings.safetyCoverageTargetMonths} 个月</p>
          <p>最低现金保障：{data.settings.minimumCashCoverageMonths} 个月</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              setEditing({
                kind: "safety",
                target: String(data.settings.safetyCoverageTargetMonths),
                floor: String(data.settings.minimumCashCoverageMonths),
              })
            }
          >
            编辑安全目标
          </button>
        </section>
      )}
      {route !== "INCOME_LIST" && route !== "SAFETY_LIST" && (
        <button
          className="text-button"
          type="button"
          disabled={historyLoading}
          onClick={() => {
            if (domainHistory) {
              setDomainHistory(null);
              return;
            }
            if (!onGetActualHistory) return;
            setHistoryLoading(true);
            void onGetActualHistory(asOfDate.slice(0, 7))
              .then(setDomainHistory)
              .catch((reason: unknown) =>
                setEditError(reason instanceof Error ? reason.message : "读取历史失败。"),
              )
              .finally(() => setHistoryLoading(false));
          }}
        >
          {historyLoading
            ? "正在读取…"
            : domainHistory
              ? "收起历史"
              : `查看${categoryTitle[route]}历史`}
        </button>
      )}
      {domainHistory && route === "CASH_LIST" && (
        <section className="stable-income-history" aria-label="现金账户历史">
          {domainHistory.cashHistory.map((entry) => (
            <article
              className="finance-data-row"
              key={`${entry.id}-${entry.asOfDate}-${entry.revisionId ?? "base"}`}
            >
              <div>
                <strong>
                  {entry.name}
                  {entry.active ? "" : " · 已停用"}
                </strong>
                <span>
                  {entry.asOfDate} ·{" "}
                  {entry.includeInSafetyResources === null
                    ? "状态记录"
                    : entry.includeInSafetyResources
                      ? "纳入安全储备"
                      : "不纳入安全储备"}
                </span>
              </div>
              <strong>
                {entry.balance === null ? (
                  "停用记录"
                ) : (
                  <MoneyAmount value={entry.balance} size="list" />
                )}
              </strong>
            </article>
          ))}
        </section>
      )}
      {domainHistory && route === "ASSET_LIST" && (
        <section className="stable-income-history" aria-label="资产历史">
          {domainHistory.assetHistory.map((entry) => (
            <article
              className="finance-data-row"
              key={`${entry.id}-${entry.asOfDate}-${entry.revisionId ?? "base"}`}
            >
              <div>
                <strong>
                  {entry.name}
                  {entry.active ? "" : " · 已停用"}
                </strong>
                <span>
                  {entry.asOfDate} · {entry.kind === "OTHER" ? "其他资产" : "流动投资"} ·{" "}
                  {entry.includeInSafetyResources ? "纳入安全储备" : "不纳入安全储备"}
                </span>
              </div>
              <strong>
                {entry.currentValue === null ? (
                  ""
                ) : (
                  <MoneyAmount value={entry.currentValue} size="list" />
                )}
              </strong>
            </article>
          ))}
        </section>
      )}
      {domainHistory && route === "DEBT_LIST" && (
        <section className="stable-income-history" aria-label="债务历史">
          {domainHistory.debtHistory.map((entry) => (
            <article
              className="finance-data-row"
              key={`${entry.id}-${entry.periodMonth}-${entry.asOfDate}-${entry.revisionId ?? "base"}`}
            >
              <div>
                <strong>
                  {entry.name}
                  {entry.active ? "" : " · 已停用"}
                </strong>
                <span>
                  {entry.periodMonth} · {entry.asOfDate} · 本月应还{" "}
                  {entry.currentMonthDue === null ? "待确认" : entry.currentMonthDue}
                </span>
              </div>
              <strong>
                {entry.currentBalance === null ? (
                  ""
                ) : (
                  <MoneyAmount value={entry.currentBalance} size="list" />
                )}
              </strong>
            </article>
          ))}
        </section>
      )}
      <p className="finance-readonly-note">历史与停用项目可在综合维护中查看。</p>
      <button
        className="text-button finance-legacy-link"
        type="button"
        onClick={onOpenLegacyMaintenance}
      >
        打开现有综合维护
      </button>
      {editing && (
        <DailyEditDialog
          edit={editing}
          asOfDate={asOfDate}
          saving={editSaving}
          error={editError}
          message={editMessage}
          onClose={() => {
            if (!editSaving) setEditing(null);
          }}
          onSubmit={async (patch, actual, horizon) => {
            if (editSavingRef.current) return;
            if (!isSessionDateCurrent()) {
              setEditError("本地日期已变化，请重新载入后再编辑。");
              return;
            }
            editSavingRef.current = true;
            setEditSaving(true);
            setEditError("");
            setEditMessage("");
            try {
              if (actual && editing.kind === "actual" && editing.id) {
                if (!onReviseActualIncome) throw new Error("实际收入修改服务暂不可用。");
                await onReviseActualIncome({
                  incomeId: editing.id,
                  periodMonth: asOfDate.slice(0, 7),
                  amount: actual.amount,
                  status: actual.status,
                  date: actual.date,
                  ...(actual.void === undefined ? {} : { void: actual.void }),
                });
              } else if (editing.kind === "debt" && editing.confirmOnly && patch?.debts?.[0]) {
                if (!onSaveCurrentMonthDebtFact) throw new Error("本月债务确认服务暂不可用。");
                const fact = patch.debts[0];
                const result = await onSaveCurrentMonthDebtFact({
                  debtId: editing.id ?? "",
                  currentBalance: fact.currentBalance ?? "",
                  currentMonthDue: fact.currentMonthDue ?? null,
                });
                if (result.status === "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS")
                  setEditMessage("这笔事实已保存；还需要确认其他本月债务后，首页才能完成计算。");
                setEditing(null);
              } else if (patch) {
                let resolvedPatch = patch;
                if (patch.settings) {
                  const need = await onGetRequirement(patch, asOfDate);
                  if (
                    need.requiresSafetyRecoveryHorizon &&
                    data.settings.safetyRecoveryHorizonMonths === undefined
                  ) {
                    const parsed = Number(horizon);
                    if (!horizon.trim() || !Number.isFinite(parsed) || parsed <= 0) {
                      setEditMessage(
                        "安全目标提高后需要补足期限；请填写安全恢复期限（月）再保存。",
                      );
                      setEditSaving(false);
                      editSavingRef.current = false;
                      return;
                    }
                    resolvedPatch = {
                      ...patch,
                      settings: { ...patch.settings, safetyRecoveryHorizonMonths: parsed },
                    };
                  }
                }
                await onSavePatch(resolvedPatch, asOfDate);
              }
              setEditing(null);
            } catch (reason) {
              setEditError(reason instanceof Error ? reason.message : "保存失败，草稿仍保留。");
            } finally {
              editSavingRef.current = false;
              setEditSaving(false);
            }
          }}
        />
      )}
      {pendingDeactivation && (
        <div className="dialog-backdrop">
          <section className="discard-confirm" role="alertdialog" aria-modal="true">
            <h2>确定停用“{pendingDeactivation.name}”吗？</h2>
            <p>历史记录会保留；停用后，该项目将不再参与后续计算。</p>
            <div className="planning-form-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setPendingDeactivation(null)}
              >
                取消
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  const pending = pendingDeactivation;
                  setPendingDeactivation(null);
                  const deactivate =
                    pending.kind === "cash"
                      ? onDeactivateCashAccount
                      : pending.kind === "asset"
                        ? onDeactivateAsset
                        : onDeactivateDebt;
                  if (!deactivate) return;
                  void deactivate(pending.id).catch((reason: unknown) =>
                    setEditError(reason instanceof Error ? reason.message : "项目未停用。"),
                  );
                }}
              >
                确认停用
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

type DailyEdit =
  | {
      kind: "actual";
      id?: string;
      amount: string;
      date: string;
      status: "EXPECTED" | "PENDING" | "RECEIVED";
      void?: boolean;
    }
  | { kind: "cash"; id?: string; name: string; amount: string; include: boolean | null }
  | {
      kind: "asset";
      id?: string;
      name: string;
      amount: string;
      kindValue: "LIQUID_INVESTMENT" | "OTHER" | null;
      include: boolean | null;
    }
  | {
      kind: "debt";
      id?: string;
      name: string;
      amount: string;
      due: string;
      fixed: string;
      confirmOnly?: boolean;
    }
  | { kind: "safety"; target: string; floor: string };

function newDailyEdit(
  route: Exclude<
    MyFinanceRoute,
    "MY_FINANCE" | "INCOME_LIST" | "PLANNING_INCOME" | "MONTH_PLANNING"
  >,
): DailyEdit {
  if (route === "CASH_LIST") return { kind: "cash", name: "", amount: "0", include: null };
  if (route === "ASSET_LIST")
    return { kind: "asset", name: "", amount: "0", kindValue: null, include: null };
  if (route === "DEBT_LIST") return { kind: "debt", name: "", amount: "0", due: "", fixed: "" };
  return { kind: "safety", target: "0", floor: "0" };
}

function DailyEditDialog({
  edit,
  asOfDate,
  saving,
  error,
  message,
  onClose,
  onSubmit,
}: {
  edit: DailyEdit;
  asOfDate: string;
  saving: boolean;
  error: string;
  message: string;
  onClose: () => void;
  onSubmit: (
    patch: FinancialMaintenancePatch | null,
    actual: {
      amount: string;
      status: "EXPECTED" | "PENDING" | "RECEIVED";
      date: string;
      void?: boolean;
    } | null,
    horizon: string,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DailyEdit>(edit);
  const [horizon, setHorizon] = useState("");
  const [dirty, setDirty] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [validation, setValidation] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      if (confirm) setConfirm(false);
      else if (dirty) setConfirm(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, confirm, dirty, onClose]);
  function change(key: string, value: string | boolean | null) {
    setDraft((current) => ({ ...current, [key]: value }) as DailyEdit);
    setDirty(true);
  }
  function makePatch(): FinancialMaintenancePatch | null {
    if (draft.kind === "actual") {
      if (draft.id) return null;
      return {
        actualIncomeEntries: [{ amount: draft.amount, date: draft.date, status: draft.status }],
      };
    }
    if (draft.kind === "cash")
      return {
        cashAccounts: [
          {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            balance: draft.amount.trim(),
            includeInSafetyResources: draft.include === true,
          },
        ],
      };
    if (draft.kind === "asset")
      return {
        assets: [
          {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            currentValue: draft.amount.trim(),
            kind: draft.kindValue ?? "OTHER",
            includeInSafetyResources: draft.include === true,
          },
        ],
      };
    if (draft.kind === "debt")
      return {
        debts: [
          {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            currentBalance: draft.amount.trim(),
            currentMonthDue: draft.due.trim() ? draft.due.trim() : null,
            fixedMonthlyPayment: draft.fixed.trim() ? draft.fixed.trim() : null,
          },
        ],
      };
    return {
      settings: {
        safetyCoverageTargetMonths: Number(draft.target),
        minimumCashCoverageMonths: Number(draft.floor),
      },
    };
  }
  function submit() {
    if (
      (draft.kind === "cash" || draft.kind === "asset") &&
      (draft.include === null || (draft.kind === "asset" && draft.kindValue === null))
    ) {
      setValidation("请明确选择是否纳入安全储备；新增资产还需选择类别。");
      return;
    }
    if (draft.kind === "safety") {
      const target = draft.target.trim();
      const floor = draft.floor.trim();
      if (
        !target ||
        !floor ||
        !Number.isFinite(Number(target)) ||
        !Number.isFinite(Number(floor)) ||
        Number(target) < 0 ||
        Number(floor) < 0
      ) {
        setValidation("请填写两个不小于 0 的有效月数；留空、负数或无法识别的数值不能保存。");
        return;
      }
    }
    setValidation("");
    void onSubmit(
      makePatch(),
      draft.kind === "actual" && draft.id
        ? {
            amount: draft.amount.trim(),
            date: draft.date,
            status: draft.status,
            ...(draft.void === undefined ? {} : { void: draft.void }),
          }
        : null,
      horizon,
    );
  }
  const title =
    draft.kind === "actual"
      ? "实际收入"
      : draft.kind === "cash"
        ? "现金账户"
        : draft.kind === "asset"
          ? "资产"
          : draft.kind === "debt"
            ? "债务"
            : "安全目标";
  const input = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    type = "text",
  ) => (
    <label className="planning-income-label">
      {label}
      <input
        aria-label={label}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        disabled={saving}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
  return (
    <div className="dialog-backdrop">
      <section
        className="discard-confirm daily-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-edit-title"
      >
        <button
          type="button"
          className="text-button"
          aria-label="关闭编辑"
          onClick={() => (dirty ? setConfirm(true) : onClose())}
        >
          关闭
        </button>
        <h2 id="daily-edit-title">
          {"id" in draft && draft.id ? "编辑" : "新增"}
          {title}
        </h2>
        <p>记录日期：{asOfDate}</p>
        {draft.kind === "actual" && (
          <>
            {input("收入金额（元）", draft.amount, (value) => change("amount", value))}
            {input("收入日期", draft.date, (value) => change("date", value), "date")}
            <label className="planning-income-label">
              收入状态
              <select
                aria-label="收入状态"
                value={draft.status}
                disabled={saving}
                onChange={(event) => change("status", event.target.value as typeof draft.status)}
              >
                <option value="EXPECTED">预计收入</option>
                <option value="PENDING">待到账</option>
                <option value="RECEIVED">已到账</option>
              </select>
            </label>
          </>
        )}
        {draft.kind === "cash" && (
          <>
            {input("账户名称", draft.name, (value) => change("name", value))}
            {input("当前余额（元）", draft.amount, (value) => change("amount", value))}
            {draft.id ? (
              <label>
                <input
                  type="checkbox"
                  checked={draft.include === true}
                  disabled={saving}
                  onChange={(event) => change("include", event.target.checked)}
                />{" "}
                纳入安全储备
              </label>
            ) : (
              <fieldset disabled={saving}>
                <legend>是否纳入安全储备</legend>
                <label>
                  <input
                    type="radio"
                    name="cash-eligible"
                    checked={draft.include === true}
                    onChange={() => change("include", true)}
                  />{" "}
                  纳入
                </label>
                <label>
                  <input
                    type="radio"
                    name="cash-eligible"
                    checked={draft.include === false}
                    onChange={() => change("include", false)}
                  />{" "}
                  不纳入
                </label>
              </fieldset>
            )}
          </>
        )}
        {draft.kind === "asset" && (
          <>
            {input("资产名称", draft.name, (value) => change("name", value))}
            {input("当前价值（元）", draft.amount, (value) => change("amount", value))}
            <label className="planning-income-label">
              资产类别
              <select
                aria-label="资产类别"
                value={draft.kindValue ?? ""}
                disabled={saving}
                onChange={(event) =>
                  change(
                    "kindValue",
                    event.target.value === ""
                      ? null
                      : (event.target.value as "LIQUID_INVESTMENT" | "OTHER"),
                  )
                }
              >
                <option value="">请选择</option>
                <option value="LIQUID_INVESTMENT">流动投资</option>
                <option value="OTHER">其他资产</option>
              </select>
            </label>
            {draft.id ? (
              <label>
                <input
                  type="checkbox"
                  checked={draft.include === true}
                  disabled={saving}
                  onChange={(event) => change("include", event.target.checked)}
                />{" "}
                纳入安全储备
              </label>
            ) : (
              <fieldset disabled={saving}>
                <legend>是否纳入安全储备</legend>
                <label>
                  <input
                    type="radio"
                    name="asset-eligible"
                    checked={draft.include === true}
                    onChange={() => change("include", true)}
                  />{" "}
                  纳入
                </label>
                <label>
                  <input
                    type="radio"
                    name="asset-eligible"
                    checked={draft.include === false}
                    onChange={() => change("include", false)}
                  />{" "}
                  不纳入
                </label>
              </fieldset>
            )}
          </>
        )}
        {draft.kind === "debt" && (
          <>
            {input("债务名称", draft.name, (value) => change("name", value))}
            {input("当前余额（元）", draft.amount, (value) => change("amount", value))}
            {input("本月应还（留空表示尚未确认）", draft.due, (value) => change("due", value))}
            {input("固定月供（留空表示未设置）", draft.fixed, (value) => change("fixed", value))}
            <p>本月应还为 0 与未填写是不同状态。</p>
          </>
        )}
        {draft.kind === "safety" && (
          <>
            {input("安全垫目标（月）", draft.target, (value) => change("target", value))}
            {input("最低现金保障（月）", draft.floor, (value) => change("floor", value))}
            {message.includes("需要补足期限") && input("安全恢复期限（月）", horizon, setHorizon)}
          </>
        )}
        {message && (
          <p role="status" className="finance-feedback">
            {message}
          </p>
        )}
        {validation && (
          <p role="alert" className="finance-error">
            {validation}
          </p>
        )}
        {error && (
          <p role="alert" className="finance-error">
            {error}
          </p>
        )}
        <div className="planning-form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={saving}
            onClick={() => setConfirm(true)}
          >
            取消
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={saving || !dirty}
            onClick={submit}
          >
            {saving ? "正在保存…" : draft.kind === "actual" && draft.void ? "确认作废" : "保存"}
          </button>
        </div>
        {confirm && (
          <div className="dialog-backdrop">
            <section className="discard-confirm" role="alertdialog" aria-modal="true">
              <h3>放弃未保存的修改？</h3>
              <div className="planning-form-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setConfirm(false)}
                >
                  继续编辑
                </button>
                <button className="button button-primary" type="button" onClick={onClose}>
                  放弃并关闭
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function FinanceListSummary({
  route,
  count,
  total,
  secondary,
}: {
  route: "CASH_LIST" | "ASSET_LIST" | "DEBT_LIST";
  count: number;
  total: string;
  secondary?: ReactNode;
}) {
  const kind = route === "CASH_LIST" ? "cash" : route === "ASSET_LIST" ? "assets" : "debt";
  const label =
    route === "CASH_LIST" ? "现金账户总额" : route === "ASSET_LIST" ? "当前资产总额" : "债务总额";
  const countLabel =
    route === "CASH_LIST" ? "个账户" : route === "ASSET_LIST" ? "项当前有效资产" : "笔债务";
  return (
    <article className={`finance-list-summary finance-list-summary-${kind}`}>
      <FinanceIllustration kind={kind} className="finance-summary-art" />
      <div>
        <span>{label}</span>
        <strong>
          <MoneyAmount value={total} size="hero" />
        </strong>
        <small>
          {count} {countLabel}
          {secondary ? <> · {secondary}</> : ""}
        </small>
      </div>
    </article>
  );
}

const actualStatusLabel = { EXPECTED: "预计", PENDING: "待到账", RECEIVED: "已到账" } as const;

function MonthPlanningPage({
  asOfDate,
  stableAmount,
  onBack,
  onHome,
  getMonth,
  saveMonth,
  isSessionDateCurrent,
}: {
  asOfDate: string;
  stableAmount: string;
  onBack: () => void;
  onHome: () => void;
  getMonth?: ((month: string) => Promise<V4FinancialReadState>) | undefined;
  saveMonth?: ((month: string, decision: PlanningIncomeMonthDecision) => Promise<void>) | undefined;
  isSessionDateCurrent: () => boolean;
}) {
  const [month, setMonth] = useState(asOfDate.slice(0, 7));
  const [read, setRead] = useState<V4FinancialReadState | null>(null);
  const [mode, setMode] = useState<"INHERIT" | "OVERRIDE">("INHERIT");
  const [amount, setAmount] = useState(stableAmount);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    if (!getMonth) {
      setError("本月计划收入暂不可用。");
      setLoading(false);
      return;
    }
    void getMonth(month)
      .then((value) => {
        if (!alive) return;
        setRead(value);
        const decision = value.planningIncome.source === "MONTH_OVERRIDE" ? "OVERRIDE" : "INHERIT";
        setMode(decision);
        setAmount(value.planningIncome.amount ?? stableAmount);
        setDirty(false);
      })
      .catch(
        (reason: unknown) =>
          alive && setError(reason instanceof Error ? reason.message : "读取本月计划失败。"),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [getMonth, month, stableAmount]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (dirty) setDiscard(true);
      else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onBack]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saveMonth || savingRef.current || !read) return;
    if (!isSessionDateCurrent()) {
      setError("本地日期已变化。请重新载入后再编辑。");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await saveMonth(
        month,
        mode === "OVERRIDE"
          ? { decision: "OVERRIDE", amount: amount.trim() }
          : { decision: "INHERIT", amount: null },
      );
      const refreshed = await getMonth?.(month);
      if (refreshed) setRead(refreshed);
      setDirty(false);
      setMessage("本月计划已保存，首页已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，草稿仍保留。请重试。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="home-page finance-page planning-page">
      <header className="finance-page-header">
        <button
          className="back-button"
          type="button"
          onClick={() => (dirty ? setDiscard(true) : onBack())}
        >
          ← 返回收入
        </button>
        <span className="current-period">维护日期 {asOfDate}</span>
        <h1>本月计划收入</h1>
      </header>
      {loading ? (
        <p role="status">正在读取本月计划…</p>
      ) : (
        <form className="planning-income-form" onSubmit={submit}>
          <label className="planning-income-label">
            计划月份
            <input
              aria-label="计划月份"
              type="month"
              value={month}
              disabled={saving}
              onChange={(event) => {
                setMonth(event.target.value);
                setDirty(false);
                setMessage("");
              }}
            />
          </label>
          <p>
            平时收入基线：
            <MoneyAmount value={stableAmount} size="inline" /> / 月
          </p>
          <fieldset disabled={saving}>
            <legend>这个月的计划</legend>
            <label>
              <input
                type="radio"
                name="month-mode"
                checked={mode === "INHERIT"}
                onChange={() => {
                  setMode("INHERIT");
                  setDirty(true);
                }}
              />{" "}
              跟随平时收入
            </label>
            <label>
              <input
                type="radio"
                name="month-mode"
                checked={mode === "OVERRIDE"}
                onChange={() => {
                  setMode("OVERRIDE");
                  setDirty(true);
                }}
              />{" "}
              本月单独设置
            </label>
          </fieldset>
          {mode === "OVERRIDE" && (
            <label className="planning-income-label">
              本月计划金额（元）
              <input
                aria-label="本月计划金额"
                inputMode="decimal"
                value={amount}
                disabled={saving}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
          )}
          <p className="planning-effective-note">
            当前计划金额：
            <strong>
              <MoneyAmount value={read?.planningIncome.amount ?? "0"} size="inline" />
            </strong>
            。实际收入记录单独管理，不会改写这项计划。
          </p>
          {message && (
            <p role="status" className="finance-feedback">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="finance-error">
              {error}
            </p>
          )}
          <div className="planning-form-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={() => (dirty ? setDiscard(true) : onBack())}
            >
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={saving || !dirty}>
              {saving ? "正在保存…" : "保存本月计划"}
            </button>
          </div>
        </form>
      )}
      {discard && (
        <div className="dialog-backdrop">
          <section className="discard-confirm" role="alertdialog" aria-modal="true">
            <h2>放弃未保存的修改？</h2>
            <p>当前计划尚未保存。</p>
            <div className="planning-form-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setDiscard(false)}
              >
                继续编辑
              </button>
              <button className="button button-primary" type="button" onClick={onBack}>
                放弃并返回
              </button>
            </div>
          </section>
        </div>
      )}
      <button
        className="finance-home-link text-button"
        type="button"
        onClick={() => (dirty ? setDiscard(true) : onHome())}
      >
        返回首页
      </button>
    </main>
  );
}

function PlanningIncomePage({
  data,
  loading,
  error,
  asOfDate,
  onBack,
  onHome,
  onRetry,
  getRequirement,
  onSave,
  isSessionDateCurrent,
}: {
  data: FinancialMaintenanceState | null;
  loading: boolean;
  error: string;
  asOfDate: string;
  onBack: () => void;
  onHome: () => void;
  onRetry: () => void;
  getRequirement: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  onSave: (
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) => Promise<FinancialMaintenanceState>;
  isSessionDateCurrent: () => boolean;
}) {
  const [draft, setDraft] = useState(data?.stableMonthlyIncome ?? "");
  const [horizonDraft, setHorizonDraft] = useState("");
  const [requiresHorizon, setRequiresHorizon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardDestination, setDiscardDestination] = useState<"income" | "home">("income");
  const [stale, setStale] = useState(false);
  const savingRef = useRef(false);

  const amountChanged = data ? !sameMoney(draft, data.stableMonthlyIncome) : false;
  const horizonChanged = horizonDraft.trim().length > 0;
  const dirty = amountChanged || horizonChanged;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      if (dirty) setConfirmDiscard(true);
      else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, onBack]);

  function back(destination: "income" | "home" = "income") {
    if (dirty) {
      setDiscardDestination(destination);
      setConfirmDiscard(true);
    } else if (destination === "home") onHome();
    else onBack();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || savingRef.current || stale) return;
    if (!isSessionDateCurrent()) {
      setStale(true);
      setSaveError("本地日期已变化，本次编辑未提交。请重新载入后再编辑。");
      return;
    }
    setSaveError("");
    setMessage("");
    if (!amountChanged) {
      setMessage("金额没有变化，未新增计划版本。");
      return;
    }
    const basePatch: FinancialMaintenancePatch = { stableMonthlyIncome: draft.trim() };
    savingRef.current = true;
    setSaving(true);
    try {
      const requirement = await getRequirement(basePatch, asOfDate);
      setRequiresHorizon(requirement.requiresSafetyRecoveryHorizon);
      let patch = basePatch;
      if (
        requirement.requiresSafetyRecoveryHorizon &&
        data.settings.safetyRecoveryHorizonMonths === undefined
      ) {
        if (!horizonDraft.trim()) {
          setMessage("本次收入调整需要设置安全恢复期限。请填写后再次保存。");
          setSaving(false);
          savingRef.current = false;
          return;
        }
        const horizon = Number(horizonDraft);
        if (!Number.isFinite(horizon) || horizon <= 0) {
          setSaveError("安全恢复期限必须是大于 0 的有效月数。");
          setSaving(false);
          savingRef.current = false;
          return;
        }
        patch = { ...basePatch, settings: { safetyRecoveryHorizonMonths: horizon } };
      }
      if (!isSessionDateCurrent()) {
        setStale(true);
        setSaveError("本地日期已变化，本次编辑未提交。请重新载入后再编辑。");
        return;
      }
      const next = await onSave(patch, asOfDate);
      setDraft(next.stableMonthlyIncome);
      setHorizonDraft("");
      setRequiresHorizon(false);
      setMessage("稳定月收入已保存，首页已更新。");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "保存失败，数据未更改。请重试。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="home-page finance-page planning-page">
      <header className="finance-page-header">
        <button className="back-button" type="button" onClick={() => back()} aria-label="返回">
          <span aria-hidden="true">←</span> 返回收入
        </button>
        <span className="current-period">维护日期 {asOfDate}</span>
        <h1>稳定月收入</h1>
      </header>
      {loading ? (
        <p role="status">正在读取当前收入…</p>
      ) : !data ? (
        <section className="finance-state-card">
          <p role="alert">{error || "当前收入暂不可用。"}</p>
          <button className="button button-secondary" type="button" onClick={onRetry}>
            重试
          </button>
        </section>
      ) : stale ? (
        <section className="finance-state-card">
          <p role="alert">{saveError}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            重新载入
          </button>
        </section>
      ) : (
        <form className="planning-income-form" onSubmit={submit}>
          <FinanceIllustration kind="income" className="planning-hero-art" />
          <p className="finance-row-eyebrow">稳定月收入基线</p>
          <p className="planning-income-current">
            当前金额{" "}
            <strong>
              <MoneyAmount value={data.stableMonthlyIncome} size="hero" />
            </strong>
          </p>
          <label className="planning-income-label">
            稳定月收入（元）
            <input
              aria-label="稳定月收入金额"
              inputMode="decimal"
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setMessage("");
                setSaveError("");
              }}
            />
          </label>
          <p className="planning-effective-note">
            保存后按 {asOfDate} 的当前维护记录生效。它是模型使用的月度基线，不代表本月实际到账。
          </p>
          {requiresHorizon && data.settings.safetyRecoveryHorizonMonths === undefined && (
            <label className="planning-income-label">
              安全恢复期限（月）
              <input
                aria-label="安全恢复期限月数"
                inputMode="decimal"
                type="number"
                min="0.01"
                step="any"
                value={horizonDraft}
                disabled={saving}
                onChange={(event) => setHorizonDraft(event.target.value)}
              />
            </label>
          )}
          {message && (
            <p role="status" className="finance-feedback">
              {message}
            </p>
          )}
          {saveError && (
            <p role="alert" className="finance-error">
              {saveError}
            </p>
          )}
          <div className="planning-form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => back()}
              disabled={saving}
            >
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "正在保存…" : "保存稳定月收入"}
            </button>
          </div>
        </form>
      )}
      {confirmDiscard && (
        <div className="dialog-backdrop">
          <section
            className="discard-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-title"
          >
            <h2 id="discard-title">放弃未保存的修改？</h2>
            <p>当前金额尚未保存。</p>
            <div className="planning-form-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setConfirmDiscard(false)}
              >
                继续编辑
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={discardDestination === "home" ? onHome : onBack}
              >
                放弃并返回
              </button>
            </div>
          </section>
        </div>
      )}
      {data && (
        <StablePlanningIncomeHistory
          revisions={data.stableIncomeRevisions}
          viewAsOfDate={asOfDate}
        />
      )}
      <button className="finance-home-link text-button" type="button" onClick={() => back("home")}>
        返回首页
      </button>
    </main>
  );
}

function StablePlanningIncomeHistory({
  revisions,
  viewAsOfDate,
}: {
  revisions: FinancialMaintenanceState["stableIncomeRevisions"];
  viewAsOfDate: string;
}) {
  const viewMonth = viewAsOfDate.slice(0, 7);
  return (
    <section className="stable-income-history" aria-label="稳定月收入修改记录">
      <header className="finance-list-heading">
        <h2>稳定月收入修改记录</h2>
        <span>{revisions.length} 条 · 最新记录在前</span>
      </header>
      <p className="stable-income-history-note">
        按生效月份、记录日期和版本顺序排列。未来记录不会提前改变当前显示金额。
      </p>
      {revisions.length === 0 ? (
        <p className="finance-empty-state" role="status">
          暂无稳定月收入修改记录。
        </p>
      ) : (
        revisions.map((revision, index) => {
          const futureEffective = revision.effectiveMonth > viewMonth;
          const futureKnowledge = revision.asOfDate > viewAsOfDate;
          return (
            <article
              className="finance-data-row stable-income-revision"
              data-visual-tone={index % 3 === 0 ? "mint" : index % 3 === 1 ? "peach" : "blue"}
              data-revision-id={revision.revisionId}
              key={revision.revisionId}
            >
              <div>
                <strong>版本 {revision.revisionId}</strong>
                <span>
                  {futureEffective ? "未来生效月份" : "生效月份"} · {revision.effectiveMonth}
                </span>
                <span>
                  {futureKnowledge ? "未来记录日期" : "记录日期"} · {revision.asOfDate}
                </span>
              </div>
              <strong>
                <MoneyAmount value={revision.amount} size="list" />
              </strong>
            </article>
          );
        })
      )}
    </section>
  );
}

function sameMoney(left: string, right: string): boolean {
  try {
    return money(left.trim()).eq(money(right));
  } catch {
    return false;
  }
}

function sum(values: string[]): string {
  return values.reduce((total, value) => total.plus(money(value)), money(0)).toString();
}

function allEffectiveAssetsTotal(data: FinancialMaintenanceState): string {
  return sum(data.assets.map((item) => item.currentValue));
}

function visualToneForId(id: string): "mint" | "peach" | "blue" {
  const stableValue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return (["mint", "peach", "blue"] as const)[stableValue % 3] ?? "mint";
}
