import { afterEach, expect, it } from "vitest";
import { saveCurrentMonthDebtFact } from "../src/application/debt-fact-service.js";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import { completeOnboarding } from "../src/application/product-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const databases: NodeSqliteDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("becomes model-ready in 2026-12 after saving every visible debt when 美团 is inactive", async () => {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await migrateDatabase(db);
  await completeOnboarding(
    db,
    {
      displayName: "Synthetic",
      stableMonthlyIncome: "13000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1900" }],
      cashAccounts: [{ name: "Cash", balance: "20000", includeInSafetyResources: true }],
      assets: [],
      debts: [
        {
          name: "Loan A",
          currentBalance: "4000",
          currentMonthDue: "300",
          fixedMonthlyPayment: "300",
        },
        {
          name: "美团",
          currentBalance: "1000",
          currentMonthDue: "100",
          fixedMonthlyPayment: "100",
        },
      ],
      safetyCoverageTargetMonths: 0,
      minimumCashCoverageMonths: 0,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    "2026-10-03",
  );

  const repositories = new Repositories(db);
  const octoberDebts = await repositories.debtsAt("2026-10", "2026-10-03");
  const loanId = octoberDebts.find((debt) => debt.name === "Loan A")?.id;
  const meituanId = octoberDebts.find((debt) => debt.name === "美团")?.id;
  if (!loanId || !meituanId) throw new Error("Synthetic debts are missing.");

  const deactivated = await new V4FoundationService(db).deactivateDebt(
    meituanId,
    "2026-10",
    "2026-10-04",
  );
  expect(deactivated.status).toBe("SAVED");
  expect((await getFinancialMaintenanceState(db, "2026-12-01")).debts).toMatchObject([
    { id: loanId, name: "Loan A" },
  ]);

  const result = await saveCurrentMonthDebtFact(
    db,
    { debtId: loanId, currentBalance: "3900", currentMonthDue: "300" },
    "2026-12-01",
  );

  expect(result.status).toBe("SAVED_MODEL_READY");
});
