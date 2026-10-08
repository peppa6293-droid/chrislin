import type {
  SaveCurrentMonthDebtFactCommand,
  SaveCurrentMonthDebtFactResult,
} from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
  FinancialMaintenanceUpdateResult,
} from "../application/financial-maintenance-service.js";
import type {
  ExpenseSubmission,
  HomeApplicationState,
  OnboardingRequirement,
  OnboardingSubmission,
} from "../application/product-service.js";
import type { ApplicationStartupState } from "../runtime/tauri-bootstrap.js";

export interface ProductApplicationServices {
  bootstrap(): Promise<ApplicationStartupState>;
  getOnboardingRequirement(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): OnboardingRequirement;
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
