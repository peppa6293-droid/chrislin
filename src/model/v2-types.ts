export type AccountType = "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "OTHER";

export interface Account {
  id: string;
  profileId: string;
  name: string;
  type: AccountType;
  currency: string;
  active: boolean;
}

export interface ExpenseCategoryDefinition {
  id: string;
  profileId: string;
  name: string;
  icon: string;
  color: string;
  monthlyBudget: string | null;
  overspendingAlert: boolean;
  savingsRelated: boolean;
  adjustable: boolean;
  builtin: boolean;
  active: boolean;
}
