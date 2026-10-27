import { assertUserInputMoney, money } from "../model/money.js";
import { calculateMonthlyModel } from "../model/monthly-model.js";
import type {
  ExpenseCategory,
  FinancialSettings,
  IncomeRecord,
  ModelInput,
} from "../model/types.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { Repositories, type StablePlanningIncomeRevision } from "../persistence/repositories.js";
import { ApplicationModelError, buildMonthlyModelInput } from "./monthly-model-service.js";
import { getHomeApplicationState, type HomeApplicationState } from "./product-service.js";

export interface FinancialMaintenanceState {
  stableMonthlyIncome: string;
  stableIncomeRevisions: StablePlanningIncomeRevision[];
  actualIncomeRecords: Array<{
    id: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    amount: string;
    date: string;
  }>;
  essentialExpenses: Array<{
    id: string;
    category: ExpenseCategory;
    name: string;
    monthlyAmount: string;
  }>;
  cashAccounts: Array<{
    id: string;
    name: string;
    balance: string;
    includeInSafetyResources: boolean;
  }>;
  assets: Array<{
    id: string;
    name: string;
    kind: "LIQUID_INVESTMENT" | "OTHER";
    currentValue: string;
    includeInSafetyResources: boolean;
  }>;
  debts: Array<{
    id: string;
    name: string;
    currentBalance: string;
    currentMonthDue: string | null;
    fixedMonthlyPayment: string | null;
    needsCurrentMonthFact: boolean;
  }>;
  settings: {
    safetyCoverageTargetMonths: number;
    minimumCashCoverageMonths: number;
    safetyRecoveryHorizonMonths?: number;
    desiredMonthlyDiscretionarySpending: string;
  };
  requiresSafetyRecoveryHorizon: boolean;
  asOfDate: string;
}

type EssentialExpensePatch =
  | { id: string; category?: ExpenseCategory; name?: string; monthlyAmount?: string }
  | { id?: never; category: ExpenseCategory; name: string; monthlyAmount: string };
type CashAccountPatch =
  | { id: string; name?: string; includeInSafetyResources?: boolean; balance?: string }
  | { id?: never; name: string; includeInSafetyResources: boolean; balance: string };
type AssetPatch =
  | {
      id: string;
      name?: string;
      kind?: "LIQUID_INVESTMENT" | "OTHER";
      includeInSafetyResources?: boolean;
      currentValue?: string;
    }
  | {
      id?: never;
      name: string;
      kind: "LIQUID_INVESTMENT" | "OTHER";
      includeInSafetyResources: boolean;
      currentValue: string;
    };
type DebtPatch =
  | {
      id: string;
      name?: string;
      currentBalance?: string;
      currentMonthDue?: string | null;
      fixedMonthlyPayment?: string | null;
    }
  | {
      id?: never;
      name: string;
      currentBalance: string;
      currentMonthDue?: string | null;
      fixedMonthlyPayment?: string | null;
    };

type MaintenanceSettingsPatch = Omit<Partial<FinancialSettings>, "safetyRecoveryHorizonMonths"> & {
  safetyRecoveryHorizonMonths?: number | null;
};

export interface FinancialMaintenancePatch {
  stableMonthlyIncome?: string;
  actualIncomeEntries?: Array<{
    amount: string;
    date: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
  }>;
  essentialExpenses?: EssentialExpensePatch[];
  cashAccounts?: CashAccountPatch[];
  assets?: AssetPatch[];
  debts?: DebtPatch[];
  settings?: MaintenanceSettingsPatch;
}

export interface FinancialMaintenanceUpdateResult {
  state: FinancialMaintenanceState;
  home: HomeApplicationState;
}

const essentialTypes = new Set<ExpenseCategory>([
  "HOUSING",
  "BASIC_FOOD",
  "TRANSPORT",
  "UTILITIES_COMMUNICATIONS",
  "INSURANCE",
  "FAMILY_FIXED_RESPONSIBILITY",
  "OTHER_ESSENTIAL",
]);

function newId(): string {
  return globalThis.crypto.randomUUID();
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}
function validateDate(asOfDate: string): void {
  if (!validDate(asOfDate))
    throw new ApplicationDataError("INVALID_DATE", "asOfDate must be a valid calendar date.");
}

async function buildMaintenanceModelInput(db: SqlDatabase, asOfDate: string): Promise<ModelInput> {
  const targetMonth = asOfDate.slice(0, 7);
  try {
    const current = await buildMonthlyModelInput(db, targetMonth, asOfDate);
    if (current.status === "READY") return current.input;
    throw new ApplicationDataError(
      "INITIALIZATION_REQUIRED",
      "Onboarding is required before monthly maintenance.",
    );
  } catch (error) {
    if (!(error instanceof ApplicationDataError) || error.code !== "MISSING_DEBT_SNAPSHOT")
      throw error;
  }

  const repositories = new Repositories(db);
  const [profile, income, settings, essentials, cash, assets, currentDebts, priorDebts, expenses] =
    await Promise.all([
      repositories.getProfile(),
      repositories.listIncome(targetMonth, asOfDate),
      repositories.getSettingsAt(targetMonth, asOfDate),
      repositories.listEssentialExpensesAt(asOfDate),
      repositories.cashAccountsAt(asOfDate),
      repositories.assetsAt(asOfDate),
      repositories.debtsAt(targetMonth, asOfDate, true),
      repositories.priorDebtsForMaintenance(targetMonth, asOfDate),
      repositories.listExpenses(`${targetMonth}-01`, asOfDate),
    ]);
  if (!profile || !settings)
    throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Financial settings are required.");
  return {
    profile,
    settings,
    facts: {
      asOfDate,
      currentMonth: targetMonth,
      planningIncome: income
        .filter((row) => row.kind === "PLANNING")
        .reduce((sum, row) => sum.plus(money(row.amount)), money(0))
        .toString(),
      actualIncomeRecords: income.filter((row) => row.kind === "ACTUAL"),
      essentialExpenses: essentials
        .reduce((sum, row) => sum.plus(money(row.monthlyAmount)), money(0))
        .toString(),
      cashAccounts: cash.map(({ id, balance, includeInSafetyResources }) => ({
        id,
        balance,
        includeInSafetyResources,
      })),
      assets: assets.map(({ id, currentValue, kind, includeInSafetyResources }) => ({
        id,
        currentValue,
        kind,
        includeInSafetyResources,
      })),
      debts: [
        ...currentDebts,
        ...priorDebts.filter((prior) => !currentDebts.some((row) => row.id === prior.id)),
      ].map(({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
        id,
        name,
        currentBalance,
        ...(currentMonthDue === undefined ? {} : { currentMonthDue }),
        ...(fixedMonthlyPayment === undefined ? {} : { fixedMonthlyPayment }),
      })),
      // Same boundary rule as buildMonthlyModelInput: zero-amount ledger rows
      // are not spending events and must not reach the frozen Model Core.
      expenses: expenses.filter((expense) => money(expense.amount).gt(0)),
      previousSnapshot: null,
    },
  };
}

export async function getFinancialMaintenanceRequirement(
  db: SqlDatabase,
  patch: FinancialMaintenancePatch,
  asOfDate: string,
): Promise<{ requiresSafetyRecoveryHorizon: boolean }> {
  validateDate(asOfDate);
  const built = await buildMaintenanceModelInput(db, asOfDate);
  const candidate = await applyPatchToCandidate(db, built, patch, asOfDate);
  return horizonRequirement(candidate);
}

export async function getFinancialMaintenanceState(
  db: SqlDatabase,
  asOfDate: string,
): Promise<FinancialMaintenanceState> {
  validateDate(asOfDate);
  const built = await buildMaintenanceModelInput(db, asOfDate);
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  const [essentials, cash, assets, stablePlanningIncome, stableIncomeRevisions] = await Promise.all(
    [
      repositories.listEssentialExpensesAt(asOfDate),
      repositories.cashAccountsAt(asOfDate),
      repositories.assetsAt(asOfDate),
      repositories.stablePlanningIncomeAt(asOfDate.slice(0, 7), asOfDate),
      profile ? repositories.listStablePlanningIncomeRevisions(profile.id) : Promise.resolve([]),
    ],
  );
  const currentDebtFacts = await repositories.debtsAt(asOfDate.slice(0, 7), asOfDate, true);
  const currentDebtIds = new Set(currentDebtFacts.map((item) => item.id));
  const requirement = horizonRequirement(built);
  return {
    stableMonthlyIncome: stablePlanningIncome?.amount ?? "0",
    stableIncomeRevisions,
    actualIncomeRecords: built.facts.actualIncomeRecords.map((item) => ({
      id: item.id,
      status: item.status,
      amount: money(item.amount).toString(),
      date: item.date,
    })),
    essentialExpenses: essentials.map((item) => ({
      ...item,
      monthlyAmount: money(item.monthlyAmount).toString(),
    })),
    cashAccounts: cash.map((item) => ({ ...item, balance: money(item.balance).toString() })),
    assets: assets.map((item) => ({ ...item, currentValue: money(item.currentValue).toString() })),
    debts: built.facts.debts.map((item) => ({
      id: item.id,
      name: item.name,
      currentBalance: money(item.currentBalance).toString(),
      currentMonthDue: item.currentMonthDue == null ? null : money(item.currentMonthDue).toString(),
      fixedMonthlyPayment:
        item.fixedMonthlyPayment == null ? null : money(item.fixedMonthlyPayment).toString(),
      needsCurrentMonthFact: !currentDebtIds.has(item.id),
    })),
    settings: {
      safetyCoverageTargetMonths: built.settings.safetyCoverageTargetMonths,
      minimumCashCoverageMonths: built.settings.minimumCashCoverageMonths,
      ...(built.settings.safetyRecoveryHorizonMonths === undefined
        ? {}
        : { safetyRecoveryHorizonMonths: built.settings.safetyRecoveryHorizonMonths }),
      desiredMonthlyDiscretionarySpending: money(
        built.settings.desiredMonthlyDiscretionarySpending,
      ).toString(),
    },
    requiresSafetyRecoveryHorizon: requirement.requiresSafetyRecoveryHorizon,
    asOfDate,
  };
}

export async function updateFinancialDataAndRecalculate(
  db: SqlDatabase,
  patch: FinancialMaintenancePatch,
  asOfDate: string,
): Promise<FinancialMaintenanceUpdateResult> {
  validateDate(asOfDate);
  assertUniquePatchIds("essentialExpenses", patch.essentialExpenses ?? []);
  assertUniquePatchIds("cashAccounts", patch.cashAccounts ?? []);
  assertUniquePatchIds("assets", patch.assets ?? []);
  assertUniquePatchIds("debts", patch.debts ?? []);
  const profile = await new Repositories(db).getProfile();
  if (!profile)
    throw new ApplicationDataError(
      "INITIALIZATION_REQUIRED",
      "Onboarding is required before monthly maintenance.",
    );
  const now = `${asOfDate}T00:00:00.000Z`;
  const targetMonth = asOfDate.slice(0, 7);
  validateActualIncomeEntries(patch.actualIncomeEntries ?? [], targetMonth, asOfDate);
  return db.transaction(async (tx) => {
    const repositories = new Repositories(tx);
    const prior = await buildMaintenanceModelInput(tx, asOfDate);
    const currentState = await getFinancialMaintenanceState(tx, asOfDate);
    const candidate = await applyPatchToCandidate(tx, prior, patch, asOfDate);
    // Validate all changed values with the frozen Model Core before writing.
    try {
      calculateMonthlyModel(candidate);
    } catch (error) {
      throw new ApplicationModelError(error);
    }

    if (patch.stableMonthlyIncome !== undefined)
      await repositories.appendPlanningIncomeRevision(
        profile.id,
        targetMonth,
        asOfDate,
        patch.stableMonthlyIncome,
        now,
      );
    for (const item of patch.actualIncomeEntries ?? []) {
      await repositories.saveIncome(
        { id: newId(), kind: "ACTUAL", status: item.status, amount: item.amount, date: item.date },
        profile.id,
        targetMonth,
        now,
      );
    }
    for (const item of resolvePatchedRows(
      currentState.essentialExpenses,
      patch.essentialExpenses ?? [],
      newId,
    )) {
      if (!essentialTypes.has(item.category))
        throw new ApplicationDataError(
          "INVALID_ESSENTIAL_CATEGORY",
          "Invalid essential expense category.",
        );
      await repositories.appendEssentialRevision(profile.id, item, asOfDate, now, newId);
    }
    for (const item of resolvePatchedRows(
      currentState.cashAccounts,
      patch.cashAccounts ?? [],
      newId,
    ))
      await repositories.appendCashRevision(profile.id, item, asOfDate, now, newId);
    for (const item of resolvePatchedRows(currentState.assets, patch.assets ?? [], newId))
      await repositories.appendAssetRevision(profile.id, item, asOfDate, now, newId);
    for (const item of resolvePatchedRows(currentState.debts, patch.debts ?? [], newId))
      await repositories.appendDebtRevision(profile.id, item, targetMonth, asOfDate, now, newId);
    if (patch.settings !== undefined) {
      const settings = mergeSettings(prior.settings, patch.settings);
      if (!sameSettings(prior.settings, settings))
        await repositories.appendSettingsRevision(profile.id, targetMonth, asOfDate, settings, now);
    }
    const home = await getHomeApplicationState(tx, asOfDate);
    const state = await getFinancialMaintenanceState(tx, asOfDate);
    return { state, home };
  });
}

function sameSettings(left: FinancialSettings, right: FinancialSettings): boolean {
  return (
    left.safetyCoverageTargetMonths === right.safetyCoverageTargetMonths &&
    left.minimumCashCoverageMonths === right.minimumCashCoverageMonths &&
    left.safetyRecoveryHorizonMonths === right.safetyRecoveryHorizonMonths &&
    money(left.desiredMonthlyDiscretionarySpending).eq(
      money(right.desiredMonthlyDiscretionarySpending),
    )
  );
}

function assertUniquePatchIds(domain: string, patches: Array<{ id?: string }>): void {
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!patch.id) continue;
    if (seen.has(patch.id))
      throw new ApplicationDataError(
        "DUPLICATE_ID",
        `A ${domain} update cannot contain the same ID more than once.`,
      );
    seen.add(patch.id);
  }
}

function validateActualIncomeEntries(
  entries: FinancialMaintenancePatch["actualIncomeEntries"],
  targetMonth: string,
  asOfDate: string,
): void {
  for (const [index, entry] of (entries ?? []).entries()) {
    if (!entry || typeof entry !== "object")
      throw new ApplicationDataError("INVALID_ACTUAL_INCOME", "Actual Income entry is invalid.");
    if (typeof entry.amount !== "string" || !entry.amount.trim())
      throw new ApplicationDataError(
        "INVALID_ACTUAL_INCOME",
        `Actual Income ${index + 1} needs an amount.`,
      );
    try {
      assertUserInputMoney(entry.amount.trim(), "Actual Income");
    } catch {
      throw new ApplicationDataError(
        "INVALID_ACTUAL_INCOME",
        `Actual Income ${index + 1} amount is invalid.`,
      );
    }
    if (typeof entry.date !== "string" || !validDate(entry.date))
      throw new ApplicationDataError(
        "INVALID_ACTUAL_INCOME",
        `Actual Income ${index + 1} needs a valid date.`,
      );
    if (entry.date.slice(0, 7) !== targetMonth)
      throw new ApplicationDataError(
        "ACTUAL_INCOME_MONTH_MISMATCH",
        `Actual Income date must belong to the maintenance month ${targetMonth}.`,
      );
    if (entry.date > asOfDate)
      throw new ApplicationDataError(
        "ACTUAL_INCOME_AFTER_AS_OF_DATE",
        `Actual Income date cannot be later than the maintenance as-of date ${asOfDate}.`,
      );
    if (!(entry.status === "EXPECTED" || entry.status === "PENDING" || entry.status === "RECEIVED"))
      throw new ApplicationDataError(
        "INVALID_ACTUAL_INCOME",
        `Actual Income ${index + 1} needs a valid status.`,
      );
  }
}

async function applyPatchToCandidate(
  db: SqlDatabase,
  base: ModelInput,
  patch: FinancialMaintenancePatch,
  asOfDate: string,
): Promise<ModelInput> {
  const candidate: ModelInput = structuredClone(base);
  if (patch.stableMonthlyIncome !== undefined) {
    const repositories = new Repositories(db);
    const hasV4 = (
      await db.select("SELECT 1 AS present FROM schema_migrations WHERE version=4")
    )[0];
    const profile = await repositories.getProfile();
    const exactDecision =
      hasV4 && profile
        ? await repositories.planningIncomeMonthDecisionAt(
            profile.id,
            asOfDate.slice(0, 7),
            asOfDate,
          )
        : null;
    // Stable-income maintenance updates the baseline, while an explicit
    // month override continues to control this month's candidate model.
    if (exactDecision?.decision.decision !== "OVERRIDE")
      candidate.facts.planningIncome = patch.stableMonthlyIncome;
  }
  if (patch.actualIncomeEntries?.length) {
    const profile = await new Repositories(db).getProfile();
    if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is missing.");
    candidate.facts.actualIncomeRecords = [
      ...candidate.facts.actualIncomeRecords,
      ...patch.actualIncomeEntries.map(
        (item, index): IncomeRecord => ({
          id: `candidate-${index}`,
          kind: "ACTUAL",
          status: item.status,
          amount: item.amount,
          date: item.date,
        }),
      ),
    ];
  }
  const repositories = new Repositories(db);
  if (patch.essentialExpenses !== undefined) {
    const existing = await repositories.listEssentialExpensesAt(asOfDate);
    const rows = mergeRows(existing, patch.essentialExpenses, (old, update) => ({
      ...old,
      ...update,
    }));
    if (rows.some((row) => !essentialTypes.has(row.category)))
      throw new ApplicationDataError(
        "INVALID_ESSENTIAL_CATEGORY",
        "Invalid essential expense category.",
      );
    for (const row of rows) {
      let amount: string;
      try {
        amount = assertUserInputMoney(row.monthlyAmount, "Essential expense");
      } catch {
        throw new ApplicationDataError(
          "INVALID_ESSENTIAL_EXPENSE",
          "Each essential expense must be a non-negative amount within the supported currency range.",
        );
      }
      if (money(amount).isNegative())
        throw new ApplicationDataError(
          "INVALID_ESSENTIAL_EXPENSE",
          "Each essential expense must be non-negative.",
        );
    }
    candidate.facts.essentialExpenses = rows
      .reduce((sum, row) => sum.plus(money(row.monthlyAmount)), money(0))
      .toString();
  }
  if (patch.cashAccounts !== undefined) {
    const existing = await repositories.cashAccountsAt(asOfDate);
    candidate.facts.cashAccounts = mergeRows(existing, patch.cashAccounts, (old, update) => ({
      ...old,
      ...update,
    })).map(({ id, balance, includeInSafetyResources }) => ({
      id,
      balance,
      includeInSafetyResources,
    }));
  }
  if (patch.assets !== undefined) {
    const existing = await repositories.assetsAt(asOfDate);
    candidate.facts.assets = mergeRows(existing, patch.assets, (old, update) => ({
      ...old,
      ...update,
    })).map(({ id, currentValue, kind, includeInSafetyResources }) => ({
      id,
      currentValue,
      kind,
      includeInSafetyResources,
    }));
  }
  if (patch.debts !== undefined) {
    const existing = candidate.facts.debts.map((row) => ({
      ...row,
      currentMonthDue: row.currentMonthDue ?? null,
      fixedMonthlyPayment: row.fixedMonthlyPayment ?? null,
    }));
    candidate.facts.debts = mergeRows(existing, patch.debts, (old, update) => ({
      ...old,
      ...update,
    })).map(({ id, name, currentBalance, currentMonthDue, fixedMonthlyPayment }) => ({
      id,
      name,
      currentBalance,
      ...(currentMonthDue === null ? {} : { currentMonthDue }),
      ...(fixedMonthlyPayment === null ? {} : { fixedMonthlyPayment }),
    }));
  }
  if (patch.settings !== undefined)
    candidate.settings = mergeSettings(candidate.settings, patch.settings);
  return candidate;
}

function mergeSettings(
  base: FinancialSettings,
  patch: MaintenanceSettingsPatch,
): FinancialSettings {
  const merged = { ...base, ...patch } as unknown as FinancialSettings;
  if (patch.safetyRecoveryHorizonMonths === null) delete merged.safetyRecoveryHorizonMonths;
  return merged;
}

function mergeRows<T extends { id: string }, P extends { id?: string }>(
  existing: T[],
  patches: P[],
  merge: (old: T, update: P) => T,
): T[] {
  const rows = [...existing];
  for (const patch of patches) {
    if (patch.id) {
      const index = rows.findIndex((row) => row.id === patch.id);
      if (index < 0)
        throw new ApplicationDataError("RECORD_NOT_FOUND", `Record ${patch.id} does not exist.`);
      const prior = rows[index];
      if (!prior)
        throw new ApplicationDataError("RECORD_NOT_FOUND", `Record ${patch.id} does not exist.`);
      rows[index] = merge(prior, patch);
    } else {
      const fresh = patch as P & { id: string };
      const complete = { ...fresh, id: `candidate-new-${rows.length}` } as unknown as T;
      rows.push(complete);
    }
  }
  return rows;
}

function resolvePatchedRows<T extends { id: string }, P extends { id?: string }>(
  existing: T[],
  patches: P[],
  createId: () => string,
): T[] {
  return patches.map((patch) => {
    if (patch.id) {
      const prior = existing.find((row) => row.id === patch.id);
      if (!prior)
        throw new ApplicationDataError("RECORD_NOT_FOUND", `Record ${patch.id} does not exist.`);
      return { ...prior, ...patch } as T;
    }
    const row = { ...patch, id: createId() } as unknown as T & {
      currentMonthDue?: string | null;
      fixedMonthlyPayment?: string | null;
    };
    if ("currentMonthDue" in row && row.currentMonthDue === undefined) row.currentMonthDue = null;
    if ("fixedMonthlyPayment" in row && row.fixedMonthlyPayment === undefined)
      row.fixedMonthlyPayment = null;
    return row as T;
  });
}

function horizonRequirement(input: ModelInput): { requiresSafetyRecoveryHorizon: boolean } {
  try {
    calculateMonthlyModel(input);
  } catch (error) {
    if (isHorizonOnlyError(error)) return { requiresSafetyRecoveryHorizon: true };
    throw new ApplicationModelError(error);
  }
  const withoutHorizon: ModelInput = { ...input, settings: { ...input.settings } };
  delete withoutHorizon.settings.safetyRecoveryHorizonMonths;
  try {
    calculateMonthlyModel(withoutHorizon);
    return { requiresSafetyRecoveryHorizon: false };
  } catch (error) {
    if (isHorizonOnlyError(error)) return { requiresSafetyRecoveryHorizon: true };
    throw new ApplicationModelError(error);
  }
}

function isHorizonOnlyError(error: unknown): boolean {
  const issues = (error as { issues?: Array<{ field: string; code: string }> }).issues;
  return (
    issues?.length === 1 &&
    issues[0]?.field === "settings.safetyRecoveryHorizonMonths" &&
    issues[0]?.code === "REQUIRED"
  );
}
