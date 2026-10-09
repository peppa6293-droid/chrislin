import { type FormEvent, type ReactNode, useRef, useState } from "react";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { FinanceIllustration, type financeArt } from "./FinanceIllustration.js";
import { MoneyAmount } from "./MoneyAmount.js";

export type MyFinanceRoute =
  | "MY_FINANCE"
  | "INCOME_LIST"
  | "PLANNING_INCOME"
  | "CASH_LIST"
  | "ASSET_LIST"
  | "DEBT_LIST";

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
        />
      )}
    </main>
  );
}

const categoryTitle: Record<Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME">, string> = {
  INCOME_LIST: "收入",
  CASH_LIST: "现金",
  ASSET_LIST: "资产",
  DEBT_LIST: "债务",
};

const categories: Array<{
  route: Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME">;
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
          打开
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
}: {
  route: Exclude<MyFinanceRoute, "MY_FINANCE" | "PLANNING_INCOME">;
  data: FinancialMaintenanceState;
  home: HomeApplicationState;
  asOfDate: string;
  onPlanningEdit: () => void;
  onOpenLegacyMaintenance: () => void;
}) {
  return (
    <section className="finance-list-panel" aria-label={`${categoryTitle[route]}项目`}>
      {route !== "INCOME_LIST" && (
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
          </article>
          <div className="finance-list-heading">
            <h2>本月收入记录</h2>
            <span>{data.actualIncomeRecords.length} 笔</span>
          </div>
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
              </article>
            ))
          )}
          <StablePlanningIncomeHistory revisions={data.stableIncomeRevisions} viewAsOfDate={asOfDate} />
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
              </article>
            );
          })
        ) : (
          <p className="finance-empty-state">当前没有债务。</p>
        ))}
      <p className="finance-readonly-note">此列表只读。现有综合维护仍可用于当前已支持的修改。</p>
      <button
        className="text-button finance-legacy-link"
        type="button"
        onClick={onOpenLegacyMaintenance}
      >
        打开现有综合维护
      </button>
    </section>
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
      {data && <StablePlanningIncomeHistory revisions={data.stableIncomeRevisions} viewAsOfDate={asOfDate} />}
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
        <p className="finance-empty-state" role="status">暂无稳定月收入修改记录。</p>
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
                <span>{futureEffective ? "未来生效月份" : "生效月份"} · {revision.effectiveMonth}</span>
                <span>{futureKnowledge ? "未来记录日期" : "记录日期"} · {revision.asOfDate}</span>
              </div>
              <strong><MoneyAmount value={revision.amount} size="list" /></strong>
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
