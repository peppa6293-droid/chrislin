import { calculateDebt } from "../model/debt.js";
import { money } from "../model/money.js";
import { calculateMonthlyModel } from "../model/monthly-model.js";
import { calculateSafety } from "../model/safety.js";
import type { HistoricalSnapshot, ModelInput, MonthlyModelResult } from "../model/types.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { Repositories } from "../persistence/repositories.js";

export type MonthlyModelBuild =
  | { status: "INITIALIZATION_REQUIRED" }
  | { status: "READY"; input: ModelInput };

export class ApplicationModelError extends Error {
  readonly code = "MODEL_VALIDATION_FAILED";

  constructor(cause: unknown) {
    super("Stored facts or settings could not be used to calculate the monthly model.", { cause });
    this.name = "ApplicationModelError";
  }
}

export async function buildMonthlyModelInput(
  db: SqlDatabase,
  targetMonth: string,
  asOfDate: string,
): Promise<MonthlyModelBuild> {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth) ||
    !isValidCalendarDate(asOfDate) ||
    asOfDate.slice(0, 7) !== targetMonth
  ) {
    throw new ApplicationDataError(
      "INVALID_PERIOD",
      "targetMonth and asOfDate must identify the same valid calendar month.",
    );
  }
  const repositories = new Repositories(db);
  const [profile, settings] = await Promise.all([
    repositories.getProfile(),
    repositories.getSettingsAt(targetMonth, asOfDate),
  ]);
  if (!profile || !settings) return { status: "INITIALIZATION_REQUIRED" };

  const [essentialItems, income, currentExpenses, currentCash, assets, debts] = await Promise.all([
    repositories.listEssentialExpensesAt(asOfDate),
    repositories.listIncome(targetMonth, asOfDate),
    repositories.listExpenses(`${targetMonth}-01`, asOfDate),
    repositories.cashAccountsAt(asOfDate),
    repositories.assetsAt(asOfDate),
    repositories.debtsAt(targetMonth, asOfDate),
  ]);
  const planningIncome = income
    .filter((record) => record.kind === "PLANNING")
    .reduce((total, record) => total.plus(money(record.amount)), money(0));
  const actualIncomeRecords = income.filter((record) => record.kind === "ACTUAL");
  const essentialExpenses = essentialItems.reduce(
    (total, item) => total.plus(money(item.monthlyAmount)),
    money(0),
  );

  const previousDate = previousComparableDate(asOfDate);
  const previousMonth = previousDate.slice(0, 7);
  const [previousCash, previousAssets, previousEssentials, priorSpending] = await Promise.all([
    repositories.cashAccountsAt(previousDate),
    repositories.assetsAt(previousDate),
    repositories.listEssentialExpensesAt(previousDate),
    repositories.variableSpending(`${previousMonth}-01`, previousDate),
  ]);
  let previousDebts: Awaited<ReturnType<Repositories["debtsAt"]>> | null = null;
  try {
    previousDebts = await repositories.debtsAt(previousMonth, previousDate);
  } catch (error) {
    if (!(error instanceof ApplicationDataError) || error.code !== "MISSING_DEBT_SNAPSHOT")
      throw error;
  }
  const previousEssentialTotal = previousEssentials.reduce(
    (total, item) => total.plus(money(item.monthlyAmount)),
    money(0),
  );
  const previousSafety =
    previousDebts === null
      ? null
      : calculateSafety(
          {
            profile,
            settings,
            facts: {
              asOfDate: previousDate,
              currentMonth: previousMonth,
              planningIncome: "0",
              actualIncomeRecords: [],
              essentialExpenses: previousEssentialTotal.toString(),
              cashAccounts: previousCash.map((account) => ({
                id: account.id,
                balance: account.balance,
                includeInSafetyResources: account.includeInSafetyResources,
              })),
              assets: previousAssets.map(
                ({ id, currentValue, kind, includeInSafetyResources }) => ({
                  id,
                  currentValue,
                  kind,
                  includeInSafetyResources,
                }),
              ),
              debts: previousDebts.map(
                ({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
                  id,
                  name,
                  currentBalance,
                  ...(currentMonthDue === undefined ? {} : { currentMonthDue }),
                  ...(fixedMonthlyPayment === undefined ? {} : { fixedMonthlyPayment }),
                }),
              ),
              expenses: [],
              previousSnapshot: null,
            },
          },
          calculateDebt(previousDebts),
          "NORMAL",
        );
  const previousIncome = await repositories.listIncome(previousMonth, previousDate);
  const previousPlanningIncome = previousIncome
    .filter((record) => record.kind === "PLANNING")
    .reduce((total, record) => total.plus(money(record.amount)), money(0));
  const previousSettings = await repositories.getSettingsAt(previousMonth, previousDate);
  let previousModel: MonthlyModelResult | null = null;
  if (previousDebts && previousSettings) {
    try {
      previousModel = calculateMonthlyModel({
        profile,
        settings: previousSettings,
        facts: {
          asOfDate: previousDate,
          currentMonth: previousMonth,
          planningIncome: previousPlanningIncome.toString(),
          actualIncomeRecords: previousIncome.filter((record) => record.kind === "ACTUAL"),
          essentialExpenses: previousEssentialTotal.toString(),
          cashAccounts: previousCash.map(({ id, balance, includeInSafetyResources }) => ({
            id,
            balance,
            includeInSafetyResources,
          })),
          assets: previousAssets.map(({ id, currentValue, kind, includeInSafetyResources }) => ({
            id,
            currentValue,
            kind,
            includeInSafetyResources,
          })),
          debts: previousDebts.map(
            ({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
              id,
              name,
              currentBalance,
              ...(currentMonthDue === undefined ? {} : { currentMonthDue }),
              ...(fixedMonthlyPayment === undefined ? {} : { fixedMonthlyPayment }),
            }),
          ),
          expenses: [],
          previousSnapshot: null,
        },
      });
    } catch (error) {
      throw new ApplicationModelError(error);
    }
  }
  const previousEligibleCash =
    previousCash.length === 0
      ? null
      : previousCash
          .filter((account) => account.includeInSafetyResources)
          .reduce((total, account) => total.plus(money(account.balance)), money(0));
  const previousEligibleInvestments =
    previousAssets.length === 0
      ? null
      : previousAssets
          .filter((asset) => asset.kind === "LIQUID_INVESTMENT" && asset.includeInSafetyResources)
          .reduce((total, asset) => total.plus(money(asset.currentValue)), money(0));
  const previousLiquidAssets =
    previousAssets.length === 0
      ? null
      : previousAssets
          .filter((asset) => asset.kind === "LIQUID_INVESTMENT")
          .reduce((total, asset) => total.plus(money(asset.currentValue)), money(0));
  const previousDebtBalance =
    previousDebts === null || previousDebts.length === 0
      ? null
      : previousDebts.reduce((total, debt) => total.plus(money(debt.currentBalance)), money(0));

  const hasBaseline =
    previousCash.length +
      previousAssets.length +
      (previousDebts?.length ?? 0) +
      previousEssentials.length >
      0 || priorSpending !== "0";
  const previousSnapshot: HistoricalSnapshot | null = hasBaseline
    ? {
        asOfDate: previousDate,
        eligibleCash: previousEligibleCash?.toString() ?? null,
        safetyResources:
          previousEligibleCash !== null && previousEligibleInvestments !== null
            ? previousEligibleCash.plus(previousEligibleInvestments).toString()
            : null,
        monthlyCoreObligations: previousSafety?.monthlyCoreObligations.toString() ?? null,
        debtBalance: previousDebtBalance?.toString() ?? null,
        liquidInvestableAssets: previousLiquidAssets?.toString() ?? null,
        samePeriodVariableSpending: priorSpending,
        recommendedMonthlySpending:
          previousModel?.spending.recommendedMonthlySpending.toString() ?? null,
      }
    : null;

  return {
    status: "READY",
    input: {
      profile,
      settings,
      facts: {
        asOfDate,
        currentMonth: targetMonth,
        planningIncome: planningIncome.toString(),
        actualIncomeRecords,
        essentialExpenses: essentialExpenses.toString(),
        cashAccounts: currentCash.map((account) => ({
          id: account.id,
          balance: account.balance,
          includeInSafetyResources: account.includeInSafetyResources,
        })),
        assets: assets.map(({ id, currentValue, kind, includeInSafetyResources }) => ({
          id,
          currentValue,
          kind,
          includeInSafetyResources,
        })),
        debts: debts.map(({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
          id,
          name,
          currentBalance,
          ...(currentMonthDue === undefined ? {} : { currentMonthDue }),
          ...(fixedMonthlyPayment === undefined ? {} : { fixedMonthlyPayment }),
        })),
        expenses: currentExpenses,
        previousSnapshot,
      },
    },
  };
}

export async function calculateMonthlyModelFromDatabase(
  db: SqlDatabase,
  targetMonth: string,
  asOfDate: string,
): Promise<
  { status: "INITIALIZATION_REQUIRED" } | { status: "READY"; result: MonthlyModelResult }
> {
  const built = await buildMonthlyModelInput(db, targetMonth, asOfDate);
  if (built.status === "INITIALIZATION_REQUIRED") return built;
  try {
    return { status: "READY", result: calculateMonthlyModel(built.input) };
  } catch (error) {
    throw new ApplicationModelError(error);
  }
}

function previousComparableDate(asOfDate: string): string {
  const [year, month, day] = asOfDate.split("-").map(Number);
  const end = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 0));
  return `${end.getUTCFullYear().toString().padStart(4, "0")}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day ?? 1, end.getUTCDate())).padStart(2, "0")}`;
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}
