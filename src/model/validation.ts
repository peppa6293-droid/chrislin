import type { Decimal } from "decimal.js";
import { ModelValidationError, type ValidationIssue } from "./errors.js";
import { isValidUserInputMoney, parseInternalMoney } from "./money.js";
import type { ModelInput, MoneyInput } from "./types.js";

function issue(
  issues: ValidationIssue[],
  field: string,
  code: ValidationIssue["code"],
  message: string,
): void {
  issues.push({ field, code, message });
}

function checkMoney(
  value: MoneyInput | null | undefined,
  field: string,
  issues: ValidationIssue[],
  rule: "FINITE" | "NON_NEGATIVE" | "POSITIVE",
  domain: "USER_INPUT_MONEY" | "AGGREGATE_MONEY" | "DERIVED_MONEY",
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" && !Number.isFinite(value)) {
    issue(issues, field, "NON_FINITE_MONEY", "Money must be finite.");
    return;
  }
  let parsed: Decimal;
  try {
    parsed = parseInternalMoney(value);
  } catch {
    issue(issues, field, "INVALID_MONEY", "Money must be a valid decimal value.");
    return;
  }
  if (!parsed.isFinite()) {
    issue(issues, field, "NON_FINITE_MONEY", "Money must be finite.");
    return;
  }
  const decimalText = typeof value === "string" ? value : parsed.toString();
  const validDecimal =
    domain === "USER_INPUT_MONEY" ? isValidUserInputMoney(decimalText) : parsed.isFinite();
  if (!validDecimal) {
    issue(
      issues,
      field,
      "INVALID_MONEY",
      domain === "USER_INPUT_MONEY"
        ? "User-entered money must have at most 2 decimal places and be within the supported range."
        : "Internal money must be a valid finite decimal.",
    );
    return;
  }
  if (rule === "NON_NEGATIVE" && parsed.isNegative()) {
    issue(issues, field, "NEGATIVE_VALUE", "Money cannot be negative.");
  }
  if (rule === "POSITIVE" && !parsed.gt(0)) {
    issue(issues, field, "NON_POSITIVE_VALUE", "Money must be greater than zero.");
  }
}

function checkRequiredMoney(
  value: MoneyInput | null | undefined,
  field: string,
  issues: ValidationIssue[],
  domain: "USER_INPUT_MONEY" | "AGGREGATE_MONEY" | "DERIVED_MONEY",
): void {
  if (value === null || value === undefined) {
    issue(issues, field, "REQUIRED", "Money value is required.");
    return;
  }
  checkMoney(value, field, issues, "FINITE", domain);
}

function checkNonNegativeNumber(value: number, field: string, issues: ValidationIssue[]): void {
  if (!Number.isFinite(value)) {
    issue(issues, field, "INVALID_NUMBER", "Value must be finite.");
  } else if (value < 0) {
    issue(issues, field, "NEGATIVE_VALUE", "Value cannot be negative.");
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

export function validateModelInput(input: ModelInput): void {
  const issues: ValidationIssue[] = [];
  if (!input.profile.id.trim()) issue(issues, "profile.id", "REQUIRED", "Profile id is required.");

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.facts.currentMonth)) {
    issue(issues, "facts.currentMonth", "INVALID_PERIOD", "Expected YYYY-MM.");
  }
  if (!validDate(input.facts.asOfDate)) {
    issue(issues, "facts.asOfDate", "INVALID_DATE", "Expected a valid YYYY-MM-DD date.");
  } else if (input.facts.asOfDate.slice(0, 7) !== input.facts.currentMonth) {
    issue(issues, "facts.asOfDate", "INVALID_PERIOD", "Date must belong to currentMonth.");
  }
  const previous = input.facts.previousSnapshot;
  if (previous && !validDate(previous.asOfDate)) {
    issue(
      issues,
      "facts.previousSnapshot.asOfDate",
      "INVALID_DATE",
      "Expected a valid YYYY-MM-DD date.",
    );
  } else if (
    previous &&
    validDate(input.facts.asOfDate) &&
    previous.asOfDate >= input.facts.asOfDate
  ) {
    issue(
      issues,
      "facts.previousSnapshot.asOfDate",
      "INVALID_DATE",
      "Previous snapshot must precede the current as-of date.",
    );
  }

  checkRequiredMoney(input.facts.planningIncome, "facts.planningIncome", issues, "AGGREGATE_MONEY");
  checkRequiredMoney(
    input.facts.essentialExpenses,
    "facts.essentialExpenses",
    issues,
    "AGGREGATE_MONEY",
  );
  checkMoney(
    input.facts.essentialExpenses,
    "facts.essentialExpenses",
    issues,
    "NON_NEGATIVE",
    "AGGREGATE_MONEY",
  );
  checkRequiredMoney(
    input.settings.desiredMonthlyDiscretionarySpending,
    "settings.desiredMonthlyDiscretionarySpending",
    issues,
    "USER_INPUT_MONEY",
  );
  checkMoney(
    input.settings.desiredMonthlyDiscretionarySpending,
    "settings.desiredMonthlyDiscretionarySpending",
    issues,
    "NON_NEGATIVE",
    "USER_INPUT_MONEY",
  );
  checkNonNegativeNumber(
    input.settings.safetyCoverageTargetMonths,
    "settings.safetyCoverageTargetMonths",
    issues,
  );
  checkNonNegativeNumber(
    input.settings.minimumCashCoverageMonths,
    "settings.minimumCashCoverageMonths",
    issues,
  );
  if (input.settings.safetyRecoveryHorizonMonths !== undefined) {
    if (!Number.isFinite(input.settings.safetyRecoveryHorizonMonths)) {
      issue(
        issues,
        "settings.safetyRecoveryHorizonMonths",
        "INVALID_NUMBER",
        "Value must be finite.",
      );
    } else if (input.settings.safetyRecoveryHorizonMonths <= 0) {
      issue(
        issues,
        "settings.safetyRecoveryHorizonMonths",
        "NON_POSITIVE_VALUE",
        "Value must be greater than zero.",
      );
    }
  }

  input.facts.cashAccounts.forEach((account, index) => {
    checkRequiredMoney(
      account.balance,
      `facts.cashAccounts[${index}].balance`,
      issues,
      "USER_INPUT_MONEY",
    );
  });
  input.facts.assets.forEach((asset, index) => {
    checkRequiredMoney(
      asset.currentValue,
      `facts.assets[${index}].currentValue`,
      issues,
      "USER_INPUT_MONEY",
    );
  });
  input.facts.debts.forEach((debt, index) => {
    checkRequiredMoney(
      debt.currentBalance,
      `facts.debts[${index}].currentBalance`,
      issues,
      "USER_INPUT_MONEY",
    );
    checkMoney(
      debt.currentBalance,
      `facts.debts[${index}].currentBalance`,
      issues,
      "NON_NEGATIVE",
      "USER_INPUT_MONEY",
    );
    checkMoney(
      debt.currentMonthDue,
      `facts.debts[${index}].currentMonthDue`,
      issues,
      "NON_NEGATIVE",
      "USER_INPUT_MONEY",
    );
    checkMoney(
      debt.fixedMonthlyPayment,
      `facts.debts[${index}].fixedMonthlyPayment`,
      issues,
      "NON_NEGATIVE",
      "USER_INPUT_MONEY",
    );
  });
  input.facts.expenses.forEach((expense, index) => {
    checkMoney(
      expense.amount,
      `facts.expenses[${index}].amount`,
      issues,
      "POSITIVE",
      "USER_INPUT_MONEY",
    );
    if (expense.businessDate !== undefined && !validDate(expense.businessDate)) {
      issue(
        issues,
        `facts.expenses[${index}].businessDate`,
        "INVALID_DATE",
        "Expected a valid local YYYY-MM-DD business date.",
      );
    }
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(expense.dateTime) ||
      !validDate(expense.dateTime.slice(0, 10)) ||
      Number.isNaN(Date.parse(expense.dateTime))
    ) {
      issue(issues, `facts.expenses[${index}].dateTime`, "INVALID_DATE", "Date/time is invalid.");
    }
  });
  input.facts.actualIncomeRecords.forEach((income, index) => {
    checkRequiredMoney(
      income.amount,
      `facts.actualIncomeRecords[${index}].amount`,
      issues,
      "USER_INPUT_MONEY",
    );
    if (!validDate(income.date)) {
      issue(
        issues,
        `facts.actualIncomeRecords[${index}].date`,
        "INVALID_DATE",
        "Expected YYYY-MM-DD.",
      );
    }
  });

  Object.entries(previous ?? {}).forEach(([key, value]) => {
    if (key === "asOfDate") return;
    checkMoney(
      value,
      `facts.previousSnapshot.${key}`,
      issues,
      key === "debtBalance" ? "NON_NEGATIVE" : "FINITE",
      key === "recommendedMonthlySpending" ? "DERIVED_MONEY" : "AGGREGATE_MONEY",
    );
  });

  if (issues.length > 0) throw new ModelValidationError(issues);
}
