import {
  type SaveCurrentMonthDebtFactCommand,
  type SaveCurrentMonthDebtFactResult,
  saveCurrentMonthDebtFact,
} from "../application/debt-fact-service.js";
import {
  type FinancialMaintenancePatch,
  type FinancialMaintenanceState,
  type FinancialMaintenanceUpdateResult,
  getFinancialMaintenanceRequirement,
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../application/financial-maintenance-service.js";
import {
  type ApplicationInitializationState,
  getApplicationInitializationState,
} from "../application/initialization-service.js";
import {
  completeOnboarding,
  type ExpenseSubmission,
  getHomeApplicationState,
  getOnboardingRequirement,
  type HomeApplicationState,
  type OnboardingSubmission,
  recordExpenseAndRecalculate,
} from "../application/product-service.js";
import { migrateDatabase } from "../persistence/migrations.js";
import { TauriSqlDatabase } from "../persistence/tauri-database.js";

export type ApplicationStartupState =
  | ApplicationInitializationState
  | { status: "ERROR"; message: string };

export async function bootstrapTauriApplication(): Promise<ApplicationStartupState> {
  try {
    const db = new TauriSqlDatabase();
    await db.open();
    await migrateDatabase(db);
    return await getApplicationInitializationState(db);
  } catch (error) {
    return {
      status: "ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** UI-facing application boundary. The database stays private to this composition root. */
export interface TauriApplicationServices {
  initialization: ApplicationStartupState;
  completeOnboarding(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getHome(asOfDate: string): Promise<HomeApplicationState>;
  recordExpense(expense: ExpenseSubmission, asOfDate: string): Promise<HomeApplicationState>;
  getFinancialMaintenanceState(asOfDate: string): Promise<FinancialMaintenanceState>;
  getFinancialMaintenanceRequirement(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  updateFinancialData(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<FinancialMaintenanceUpdateResult>;
  saveCurrentMonthDebtFact(
    command: SaveCurrentMonthDebtFactCommand,
    asOfDate: string,
  ): Promise<SaveCurrentMonthDebtFactResult>;
}

export interface TauriProductServices {
  bootstrap(): Promise<ApplicationStartupState>;
  getOnboardingRequirement: typeof getOnboardingRequirement;
  completeOnboarding(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getHomeApplicationState(asOfDate: string): Promise<HomeApplicationState>;
  recordExpenseAndRecalculate(
    expense: ExpenseSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getFinancialMaintenanceState(asOfDate: string): Promise<FinancialMaintenanceState>;
  getFinancialMaintenanceRequirement(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  updateFinancialDataAndRecalculate(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<FinancialMaintenanceUpdateResult>;
  saveCurrentMonthDebtFact(
    command: SaveCurrentMonthDebtFactCommand,
    asOfDate: string,
  ): Promise<SaveCurrentMonthDebtFactResult>;
}

export async function createTauriApplicationServices(): Promise<TauriApplicationServices> {
  const db = new TauriSqlDatabase();
  await db.open();
  await migrateDatabase(db);
  const initialization = await getApplicationInitializationState(db);
  return {
    initialization,
    completeOnboarding: (submission, asOfDate) => completeOnboarding(db, submission, asOfDate),
    getHome: (asOfDate) => getHomeApplicationState(db, asOfDate),
    recordExpense: (expense, asOfDate) => recordExpenseAndRecalculate(db, expense, asOfDate),
    getFinancialMaintenanceState: (asOfDate) => getFinancialMaintenanceState(db, asOfDate),
    getFinancialMaintenanceRequirement: (patch, asOfDate) =>
      getFinancialMaintenanceRequirement(db, patch, asOfDate),
    updateFinancialData: (patch, asOfDate) =>
      updateFinancialDataAndRecalculate(db, patch, asOfDate),
    saveCurrentMonthDebtFact: (command, asOfDate) =>
      saveCurrentMonthDebtFact(db, command, asOfDate),
  };
}

/** Stable UI API with lazy startup; neither the UI nor its contract receives the database. */
export function getTauriProductServices(): TauriProductServices {
  let application: Promise<TauriApplicationServices> | undefined;
  const open = () => (application ??= createTauriApplicationServices());
  return {
    bootstrap: async () => {
      try {
        return (await open()).initialization;
      } catch (error) {
        return {
          status: "ERROR",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    getOnboardingRequirement,
    completeOnboarding: async (submission, asOfDate) =>
      (await open()).completeOnboarding(submission, asOfDate),
    getHomeApplicationState: async (asOfDate) => (await open()).getHome(asOfDate),
    recordExpenseAndRecalculate: async (expense, asOfDate) =>
      (await open()).recordExpense(expense, asOfDate),
    getFinancialMaintenanceState: async (asOfDate) =>
      (await open()).getFinancialMaintenanceState(asOfDate),
    getFinancialMaintenanceRequirement: async (patch, asOfDate) =>
      (await open()).getFinancialMaintenanceRequirement(patch, asOfDate),
    updateFinancialDataAndRecalculate: async (patch, asOfDate) =>
      (await open()).updateFinancialData(patch, asOfDate),
    saveCurrentMonthDebtFact: async (command, asOfDate) =>
      (await open()).saveCurrentMonthDebtFact(command, asOfDate),
  };
}
