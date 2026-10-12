import { useEffect, useState } from "react";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
} from "../application/financial-maintenance-service.js";
import type {
  ExpenseSubmission,
  HomeApplicationState,
  OnboardingSubmission,
} from "../application/product-service.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import type { ApplicationStartupState } from "../runtime/tauri-bootstrap.js";
import {
  getTauriProductServices,
  getWp03PreviewTestDate,
  setWp03PreviewTestDate,
} from "../runtime/tauri-bootstrap.js";
import type { ProductApplicationServices } from "./contracts.js";
import { localDate } from "./date.js";
import { FinancialMaintenanceDialog } from "./FinancialMaintenanceDialog.js";
import { HomeScreen } from "./HomeScreen.js";
import { Onboarding } from "./Onboarding.js";
import { WP03PreviewDateControl } from "./WP03PreviewDateControl.js";

const defaultServices = getTauriProductServices();

type AppState =
  | { status: "LOADING" }
  | ApplicationStartupState
  | { status: "PRODUCT_ERROR"; message: string };

export function App({ services = defaultServices }: { services?: ProductApplicationServices }) {
  const [sessionAsOfDate, setSessionAsOfDate] = useState(() => localDate(new Date()));
  const [wp03PreviewDateEnabled, setWp03PreviewDateEnabled] = useState(false);
  const [pendingDebtFactNames, setPendingDebtFactNames] = useState<string[]>([]);
  const [state, setState] = useState<AppState>({ status: "LOADING" });
  const [home, setHome] = useState<HomeApplicationState | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryData, setRecoveryData] = useState<FinancialMaintenanceState | null>(null);
  const [recoveryError, setRecoveryError] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        let startupDate = localDate(new Date());
        if (__WP03_PREVIEW_BUILD__) {
          const configuredDate = await getWp03PreviewTestDate();
          if (!mounted) return;
          setWp03PreviewDateEnabled(true);
          if (configuredDate) startupDate = configuredDate;
        }
        setSessionAsOfDate(startupDate);
        const result = await services.bootstrap();
        if (mounted) setState(result);
      } catch (error) {
        if (mounted) setState({ status: "PRODUCT_ERROR", message: messageOf(error) });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [services]);

  async function updateWp03PreviewDate(nextDate: string | null) {
    if (!wp03PreviewDateEnabled) throw new Error("WP-03 验收日期仅在 WP-03 测试版中可用。");
    await setWp03PreviewTestDate(nextDate);
    const effectiveDate = nextDate ?? localDate(new Date());
    try {
      const maintenance = await services.getFinancialMaintenanceState(effectiveDate);
      const pending = maintenance.debts
        .filter((debt) => debt.needsCurrentMonthFact)
        .map((debt) => debt.name);
      const refreshed =
        pending.length === 0 ? await services.getHomeApplicationState(effectiveDate) : null;
      setSessionAsOfDate(effectiveDate);
      setPendingDebtFactNames(pending);
      if (refreshed) setHome(refreshed);
    } catch (error) {
      await setWp03PreviewTestDate(null);
      throw error;
    }
  }

  async function completeOnboarding(submission: OnboardingSubmission, asOfDate: string) {
    const result = await services.completeOnboarding(submission, asOfDate);
    setHome(result);
    setState({ status: "READY" });
  }

  async function recordExpense(expense: ExpenseSubmission, asOfDate: string) {
    const result = await services.recordExpenseAndRecalculate(expense, asOfDate);
    setHome(result);
  }

  async function loadFinancialMaintenance(asOfDate: string) {
    return services.getFinancialMaintenanceState(asOfDate);
  }

  async function getFinancialMaintenanceRequirement(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ) {
    return services.getFinancialMaintenanceRequirement(patch, asOfDate);
  }

  async function updateFinancialData(patch: FinancialMaintenancePatch, asOfDate: string) {
    const result = await services.updateFinancialDataAndRecalculate(patch, asOfDate);
    setHome(result.home);
    return result.state;
  }

  async function savePlanningMonthDecision(month: string, decision: PlanningIncomeMonthDecision) {
    const result = await services.savePlanningMonthDecision(month, sessionAsOfDate, decision);
    if (result.status === "SAVED" || result.status === "NO_CHANGE") {
      setHome(await services.getHomeApplicationState(sessionAsOfDate));
    } else {
      throw new Error(`本月计划收入未保存（${result.code}）。`);
    }
  }

  async function reviseActualIncome(input: {
    incomeId: string;
    periodMonth: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    void?: boolean;
  }) {
    const result = await services.reviseActualIncome({ ...input, asOfDate: sessionAsOfDate });
    if (result.status === "SAVED" || result.status === "NO_CHANGE") {
      setHome(await services.getHomeApplicationState(sessionAsOfDate));
    } else {
      throw new Error(`实际收入修改未保存（${result.code}）。`);
    }
  }

  async function deactivateCashAccount(accountId: string) {
    const result = await services.deactivateCashAccount(accountId, sessionAsOfDate);
    if (result.status === "SAVED" || result.status === "NO_CHANGE")
      setHome(await services.getHomeApplicationState(sessionAsOfDate));
    else throw new Error(`账户未停用（${result.code}）。`);
  }

  async function deactivateAsset(assetId: string) {
    const result = await services.deactivateAsset(assetId, sessionAsOfDate);
    if (result.status === "SAVED" || result.status === "NO_CHANGE")
      setHome(await services.getHomeApplicationState(sessionAsOfDate));
    else throw new Error(`资产未停用（${result.code}）。`);
  }

  async function deactivateDebt(debtId: string) {
    const result = await services.deactivateDebt(
      debtId,
      sessionAsOfDate.slice(0, 7),
      sessionAsOfDate,
    );
    if (result.status === "SAVED" || result.status === "NO_CHANGE")
      setHome(await services.getHomeApplicationState(sessionAsOfDate));
    else
      throw new Error(
        result.code === "DEBT_FACT_REQUIRED_BEFORE_DEACTIVATION"
          ? "请先确认这笔债务的本月余额和应还，再停用。"
          : `债务未停用（${result.code}）。`,
      );
  }

  async function saveCurrentMonthDebtFact(command: {
    debtId: string;
    currentBalance: string;
    currentMonthDue: string | null;
  }) {
    const result = await services.saveCurrentMonthDebtFact(command, sessionAsOfDate);
    if (result.status === "SAVED_MODEL_READY") {
      setPendingDebtFactNames([]);
      setHome(result.home);
    }
    if (result.status === "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS") {
      const maintenance = await services.getFinancialMaintenanceState(sessionAsOfDate);
      setPendingDebtFactNames(
        maintenance.debts.filter((debt) => debt.needsCurrentMonthFact).map((debt) => debt.name),
      );
    }
    if (
      result.status === "VALIDATION_FAILED" ||
      result.status === "CONFLICT_OR_UNKNOWN_ID" ||
      result.status === "SAVE_FAILED"
    )
      throw new Error(result.message);
    return result;
  }

  if (state.status === "LOADING")
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-mark" />
        <p>正在打开你的本地账本…</p>
      </main>
    );
  if (state.status === "ERROR" || state.status === "PRODUCT_ERROR")
    return (
      <>
        <main className="error-screen">
          <p className="eyebrow">PERSONAL FINANCE</p>
          <h1>暂时打不开账本</h1>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setRecoveryOpen(true);
              setRecoveryLoading(true);
              setRecoveryError("");
              void services
                .getFinancialMaintenanceState(sessionAsOfDate)
                .then(setRecoveryData)
                .catch(() => setRecoveryError("无法读取当前财务数据，请稍后重试。"))
                .finally(() => setRecoveryLoading(false));
            }}
          >
            更新财务数据
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => location.reload()}
          >
            重新打开
          </button>
        </main>
        {recoveryOpen && (
          <FinancialMaintenanceDialog
            initial={recoveryData}
            loading={recoveryLoading}
            error={recoveryError}
            onClose={() => {
              setRecoveryOpen(false);
              setRecoveryData(null);
            }}
            onLoad={async () => {
              setRecoveryLoading(true);
              try {
                setRecoveryData(await services.getFinancialMaintenanceState(sessionAsOfDate));
                setRecoveryError("");
              } catch {
                setRecoveryError("无法读取当前财务数据，请稍后重试。");
              } finally {
                setRecoveryLoading(false);
              }
            }}
            getRequirement={(patch) =>
              services.getFinancialMaintenanceRequirement(patch, sessionAsOfDate)
            }
            onSave={async (patch) => {
              const result = await services.updateFinancialDataAndRecalculate(
                patch,
                sessionAsOfDate,
              );
              setHome(result.home);
              setState({ status: "READY" });
              setRecoveryOpen(false);
            }}
          />
        )}
      </>
    );
  if (state.status === "INITIALIZATION_REQUIRED")
    return (
      <Onboarding
        getRequirement={services.getOnboardingRequirement}
        onComplete={completeOnboarding}
      />
    );
  if (!home) {
    return (
      <HomeLoader
        services={services}
        asOfDate={sessionAsOfDate}
        onReady={setHome}
        onError={(message) => setState({ status: "PRODUCT_ERROR", message })}
      />
    );
  }
  return (
    <HomeScreen
      home={home}
      asOfDate={sessionAsOfDate}
      isSessionDateCurrent={() =>
        wp03PreviewDateEnabled || localDate(new Date()) === sessionAsOfDate
      }
      wp03PreviewDateControl={
        __WP03_PREVIEW_BUILD__ && wp03PreviewDateEnabled ? (
          <WP03PreviewDateControl asOfDate={sessionAsOfDate} onApply={updateWp03PreviewDate} />
        ) : null
      }
      pendingDebtFactNames={pendingDebtFactNames}
      onRecordExpense={recordExpense}
      onLoadFinancialMaintenance={loadFinancialMaintenance}
      onGetFinancialMaintenanceRequirement={getFinancialMaintenanceRequirement}
      onUpdateFinancialData={updateFinancialData}
      onGetPlanningMonth={(month) => services.getV4FinancialReadState(month, sessionAsOfDate)}
      onSavePlanningMonth={savePlanningMonthDecision}
      onReviseActualIncome={reviseActualIncome}
      onDeactivateCashAccount={deactivateCashAccount}
      onDeactivateAsset={deactivateAsset}
      onDeactivateDebt={deactivateDebt}
      onSaveCurrentMonthDebtFact={saveCurrentMonthDebtFact}
    />
  );
}

function HomeLoader({
  services,
  asOfDate,
  onReady,
  onError,
}: {
  services: ProductApplicationServices;
  asOfDate: string;
  onReady: (state: HomeApplicationState) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    let mounted = true;
    void services
      .getHomeApplicationState(asOfDate)
      .then((result) => {
        if (mounted) onReady(result);
      })
      .catch((error: unknown) => {
        if (mounted) onError(messageOf(error));
      });
    return () => {
      mounted = false;
    };
  }, [services, onReady, onError, asOfDate]);
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="loading-mark" />
      <p>正在整理本月情况…</p>
    </main>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
