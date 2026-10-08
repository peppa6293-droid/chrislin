import { money, zeroMoney } from "./money.js";
import type { Debt, DebtResult } from "./types.js";

export function calculateDebt(debts: Debt[]): DebtResult {
  let mandatoryDebtService = zeroMoney();
  let totalDebtBalance = zeroMoney();
  const debtPayments: DebtResult["debtPayments"] = [];

  for (const debt of debts) {
    const balance = money(debt.currentBalance);
    totalDebtBalance = totalDebtBalance.plus(balance);

    if (debt.currentMonthDue !== undefined && debt.currentMonthDue !== null) {
      const amount = money(debt.currentMonthDue);
      mandatoryDebtService = mandatoryDebtService.plus(amount);
      debtPayments.push({ debtId: debt.id, amount, source: "CURRENT_MONTH_DUE" });
    } else if (debt.fixedMonthlyPayment !== undefined && debt.fixedMonthlyPayment !== null) {
      const amount = money(debt.fixedMonthlyPayment);
      mandatoryDebtService = mandatoryDebtService.plus(amount);
      debtPayments.push({ debtId: debt.id, amount, source: "FIXED_MONTHLY_PAYMENT" });
    } else {
      debtPayments.push({ debtId: debt.id, amount: zeroMoney(), source: "NO_PAYMENT" });
    }
  }

  return {
    mandatoryDebtService,
    totalDebtBalance,
    debtPayments,
    rulesApplied: [
      "For each debt, use current-month due when present; otherwise use fixed monthly payment.",
      "Never count both payment fields for the same debt and month.",
    ],
  };
}
