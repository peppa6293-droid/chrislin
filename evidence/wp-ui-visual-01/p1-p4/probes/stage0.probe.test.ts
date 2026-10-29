import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../../../../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../../../../src/application/monthly-model-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  type OnboardingSubmission,
} from "../../../../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  recordEssentialPayment,
} from "../../../../src/application/ux-ledger-service.js";
import { V2ExpenseService } from "../../../../src/application/v2-expense-service.js";
import { migrateDatabase } from "../../../../src/persistence/migrations.js";
import { Repositories } from "../../../../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "../../../../tests/helpers/node-sqlite.js";

const NOW = "2026-10-03T00:00:00.000Z";
const TODAY = "2026-10-03";
const PREV_END = "2026-09-30";

function onboarding(overrides: Partial<OnboardingSubmission> = {}): OnboardingSubmission {
  return {
    displayName: "Stage0",
    stableMonthlyIncome: "10000",
    essentialExpenses: [{ category: "HOUSING", monthlyAmount: "2000" }],
    cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
    assets: [{ name: "Fund", currentValue: "400", includeInSafetyResources: true }],
    debts: [{ name: "Loan", currentBalance: "1000", currentMonthDue: "100" }],
    safetyCoverageTargetMonths: 1,
    minimumCashCoverageMonths: 1,
    desiredMonthlyDiscretionarySpending: "1000",
    ...overrides,
  };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "OK";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : `THROW:${(error as Error).message}`;
  }
}

let db: NodeSqliteDatabase;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  await migrateDatabase(db, NOW);
});

afterEach(() => db.close());

describe("STAGE-0 X-3: income four states", () => {
  it("数据库层:没有收入行时 listIncome 为空,家庭总览却把缺失呈现为 0", async () => {
    const profileId = "probe-no-income";
    await db.execute(
      "INSERT INTO profiles(id,singleton_id,display_name,created_at) VALUES(?,1,?,?)",
      [profileId, "Stage0", NOW],
    );
    await db.execute(
      `INSERT INTO financial_settings(profile_id,safety_coverage_target_months,minimum_cash_coverage_months,desired_monthly_discretionary_spending)
       VALUES(?,1,1,'1000')`,
      [profileId],
    );
    const repositories = new Repositories(db);
    const rows = await repositories.listIncome("2026-10", TODAY);
    const resolution = await repositories.resolvePlanningIncomeForMonth("2026-10", TODAY);
    console.log(
      JSON.stringify({
        x3MissingRows: {
          listIncomeRows: rows.length,
          planningResolutionAmount: resolution.amount,
          planningResolutionSource: resolution.source,
        },
      }),
    );
    expect(rows.length).toBe(0);
    expect(resolution.amount).toBeNull();
  });

  it("显式 0:onboarding 收 0 后模型输出 0/0/0,与缺失在 HomeApplicationState 上同形", async () => {
    const zeroDb = new NodeSqliteDatabase();
    await migrateDatabase(zeroDb, NOW);
    await completeOnboarding(zeroDb, onboarding({ stableMonthlyIncome: "0" }), TODAY);
    const home = await getHomeApplicationState(zeroDb, TODAY);
    const rows = await new Repositories(zeroDb).listIncome("2026-10", TODAY);
    zeroDb.close();

    console.log(
      JSON.stringify({
        x3ExplicitZero: {
          listIncomeRows: rows.length,
          planningRows: rows.filter((row) => row.kind === "PLANNING").map((row) => row.amount),
          homePlanningIncome: home.planningIncome,
          essentialExpenses: home.essentialExpenses,
          baseSurplus: home.baseSurplus,
        },
      }),
    );
    expect(home.planningIncome).toBe("0");
    expect(rows.filter((row) => row.kind === "PLANNING")).toHaveLength(1);
  });

  it("ACTUAL 收入带 status,可录负数;V2 记收入账本拒负数且不进模型收入", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const profile = await new Repositories(db).getProfile();
    if (!profile) throw new Error("profile missing");

    const pending = await updateFinancialDataAndRecalculate(
      db,
      { actualIncomeEntries: [{ amount: "5000.00", date: "2026-10-02", status: "PENDING" }] },
      TODAY,
    );
    const actualRows = (await new Repositories(db).listIncome("2026-10", TODAY)).filter(
      (row) => row.kind === "ACTUAL",
    );

    const countBeforeNegative = pending.home.actualIncomeRecordCount;
    const negativeActual = await codeOf(
      updateFinancialDataAndRecalculate(
        db,
        { actualIncomeEntries: [{ amount: "-200.00", date: "2026-10-03", status: "RECEIVED" }] },
        TODAY,
      ),
    );

    const negativePlanningDb = new NodeSqliteDatabase();
    await migrateDatabase(negativePlanningDb, NOW);
    await completeOnboarding(negativePlanningDb, onboarding(), TODAY);
    const negativePlanning = await codeOf(
      updateFinancialDataAndRecalculate(
        negativePlanningDb,
        { stableMonthlyIncome: "-500.00" },
        TODAY,
      ),
    );
    const negativePlanningHome = await getHomeApplicationState(negativePlanningDb, TODAY);
    negativePlanningDb.close();

    const v2 = new V2ExpenseService(new Repositories(db));
    const v2Negative = await codeOf(
      v2.recordIncomeEntry({
        id: "probe-entry-negative",
        profileId: profile.id,
        periodMonth: "2026-10",
        occurredAt: "2026-10-02",
        amount: "-1.00",
        label: "负收入",
        oneTime: false,
      }),
    );
    const v2Positive = await codeOf(
      v2.recordIncomeEntry({
        id: "probe-entry-positive",
        profileId: profile.id,
        periodMonth: "2026-10",
        occurredAt: "2026-10-02",
        amount: "8000.00",
        label: "工资",
        oneTime: false,
      }),
    );
    const homeAfterV2 = await getHomeApplicationState(db, TODAY);
    const dashboard = await v2.getDashboardProps(profile.id, "2026-10");

    console.log(
      JSON.stringify({
        x3Status: {
          actualStatuses: actualRows.map((row) => row.status),
          homeFieldsWithIncome: Object.keys(pending.home).filter((key) => /income/i.test(key)),
          homePlanningIncome: pending.home.planningIncome,
          homeActualIncomeRecordCount: pending.home.actualIncomeRecordCount,
          negativeActualResult: negativeActual,
          negativePlanningResult: negativePlanning,
          negativePlanningHome: {
            planningIncome: negativePlanningHome.planningIncome,
            baseSurplus: negativePlanningHome.baseSurplus,
          },
          v2NegativeResult: v2Negative,
          v2PositiveResult: v2Positive,
          homeAfterV2: {
            planningIncome: homeAfterV2.planningIncome,
            actualIncomeRecordCount: homeAfterV2.actualIncomeRecordCount,
          },
          v2DashboardIncome: dashboard.ledger.income,
          countBeforeNegative,
          countAfterNegative: (await getHomeApplicationState(db, TODAY)).actualIncomeRecordCount,
        },
      }),
    );

    expect(actualRows.map((row) => row.status)).toContain("PENDING");
    expect(pending.home.planningIncome).toBe("10000");
    expect(homeAfterV2.planningIncome).toBe("10000");
    expect(countBeforeNegative).toBe(1);
    expect(homeAfterV2.actualIncomeRecordCount).toBe(2);
    expect(dashboard.ledger.income).toBe("8000.00");
  });
});

describe("STAGE-0 X-2: historical month-end", () => {
  it("上月月末:固定支出为空、规划收入为空、设置回落到当前值、模型对比日仍是 9-03", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const repositories = new Repositories(db);

    const essentialsPrev = await repositories.listEssentialExpensesAt(PREV_END);
    const settingsPrev = await repositories.getSettingsAt("2026-09", PREV_END);
    const planningPrev = await repositories.resolvePlanningIncomeForMonth("2026-09", PREV_END);
    const actualPrev = await repositories.actualIncomeAt("2026-09", PREV_END);
    const buildPrev = await buildMonthlyModelInput(db, "2026-09", PREV_END);
    const buildNovWithoutFact = await codeOf(buildMonthlyModelInput(db, "2026-11", "2026-11-05"));
    const debtRows = await db.select<{ id: string }>("SELECT id FROM debts");
    const debtId = debtRows[0]?.id;
    if (!debtId) throw new Error("debt missing");
    await db.execute(
      `INSERT INTO debt_period_facts(id,debt_id,period_month,as_of_date,current_balance,current_month_due,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      ["probe-nov-fact", debtId, "2026-11", "2026-11-05", "1000.00", "100.00", NOW],
    );
    const previousSnapshot = (
      await buildMonthlyModelInput(db, "2026-11", "2026-11-05")
    ).input?.facts.previousSnapshot;

    console.log(
      JSON.stringify({
        x2Before: {
          essentialItemsAtPrevMonthEnd: essentialsPrev.length,
          settingsAtPrevMonthEnd: settingsPrev,
          planningAtPrevMonthEnd: planningPrev,
          actualRowsAtPrevMonthEnd: actualPrev.length,
          buildPrevPlanningIncome: buildPrev.input?.facts.planningIncome ?? null,
          buildPrevDebts: buildPrev.input?.facts.debts.length ?? null,
          modelPreviousSnapshotAsOfDate: previousSnapshot?.asOfDate ?? null,
          buildNovWithoutFact,
          settingsBeforeOnboardingMonth: await repositories.getSettingsAt("2026-08", "2026-08-31"),
        },
      }),
    );

    expect(essentialsPrev.length).toBe(0);
    expect(settingsPrev).not.toBeNull();
    expect(planningPrev.amount).toBeNull();
    expect(buildPrev.input?.facts.planningIncome).toBe("0");
    // 模型自带的“上一期”是上月同日(11-05 → 10-05),不是上月月末(10-31)。
    expect(buildNovWithoutFact).toBe("MISSING_DEBT_SNAPSHOT");
    expect(previousSnapshot?.asOfDate).toBe("2026-10-05");
  });

  it("债务在所选月之前已存在但没有该月事实时,读层拒绝(MISSING_DEBT_SNAPSHOT)", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    await db.execute("UPDATE debts SET created_at=?", ["2026-08-01T00:00:00.000Z"]);
    const buildPrev = await codeOf(buildMonthlyModelInput(db, "2026-09", PREV_END));
    const homePrev = await codeOf(getHomeApplicationState(db, PREV_END));
    console.log(JSON.stringify({ x2MissingFact: { buildPrev, homePrev } }));
    expect(buildPrev).toBe("MISSING_DEBT_SNAPSHOT");
    expect(homePrev).toBe("MISSING_DEBT_SNAPSHOT");
  });

  it("补上上月债务事实后可算,但收入/固定支出按当时记录为空(0),设置仍用当前值", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const debtRows = await db.select<{ id: string }>("SELECT id FROM debts");
    const debtId = debtRows[0]?.id;
    if (!debtId) throw new Error("debt missing");
    await db.execute(
      `INSERT INTO debt_period_facts(id,debt_id,period_month,as_of_date,current_balance,current_month_due,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      ["probe-sept-fact", debtId, "2026-09", "2026-09-30", "1000.00", "100.00", NOW],
    );

    await updateFinancialDataAndRecalculate(
      db,
      {
        settings: {
          safetyCoverageTargetMonths: 6,
          minimumCashCoverageMonths: 3,
          safetyRecoveryHorizonMonths: 12,
        },
      },
      "2026-10-20",
    );

    const homePrev = await getHomeApplicationState(db, PREV_END);
    const buildPrev = await buildMonthlyModelInput(db, "2026-09", PREV_END);

    console.log(
      JSON.stringify({
        x2AfterSeed: {
          planningIncome: homePrev.planningIncome,
          essentialExpenses: homePrev.essentialExpenses,
          mandatoryDebtService: homePrev.mandatoryDebtService,
          baseSurplus: homePrev.baseSurplus,
          actualIncomeRecordCount: homePrev.actualIncomeRecordCount,
          settingsUsedForPrevMonth: buildPrev.input?.settings ?? null,
        },
      }),
    );

    expect(homePrev.planningIncome).toBe("0");
    expect(homePrev.essentialExpenses).toBe("0");
    expect(homePrev.mandatoryDebtService).toBe("100");
    // 9 月没有任何 settings_revision,读层回落到 financial_settings 基行(1/1),
    // 调用方无法区分“9 月真实版本”与“回落值”。
    expect(buildPrev.input?.settings.safetyCoverageTargetMonths).toBe(1);
    const revision = await db.select<{ safety_coverage_target_months: number }>(
      "SELECT safety_coverage_target_months FROM settings_revisions ORDER BY revision_id DESC LIMIT 1",
    );
    expect(revision[0]?.safety_coverage_target_months).toBe(6);
  });

  it("固定支出版本按 as_of_date 生效:10-20 的修改不回溯 9 月末", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const items = await new Repositories(db).listEssentialExpensesAt(TODAY);
    const itemId = items[0]?.id;
    if (!itemId) throw new Error("essential item missing");
    await updateFinancialDataAndRecalculate(
      db,
      {
        essentialExpenses: [
          { id: itemId, name: "房租", category: "HOUSING", monthlyAmount: "2600.00" },
        ],
      },
      "2026-10-20",
    );

    const atPrev = await new Repositories(db).listEssentialExpensesAt(PREV_END);
    const atRevision = await new Repositories(db).listEssentialExpensesAt("2026-10-20");

    console.log(
      JSON.stringify({
        x2EssentialVersions: {
          atPrevMonthEnd: atPrev.map((row) => row.monthlyAmount),
          atRevisionDate: atRevision.map((row) => row.monthlyAmount),
        },
      }),
    );

    expect(atPrev.length).toBe(0);
    expect(atRevision.map((row) => row.monthlyAmount)).toEqual(["2600.00"]);
  });
});

describe("STAGE-0 X-6: duplicate sources", () => {
  it("同一笔房贷既建固定支出又建债务时,负担被双计,系统无同笔识别", async () => {
    const duplicateDb = new NodeSqliteDatabase();
    await migrateDatabase(duplicateDb, NOW);
    const home = await completeOnboarding(
      duplicateDb,
      onboarding({
        safetyRecoveryHorizonMonths: 12,
        essentialExpenses: [
          { category: "HOUSING", monthlyAmount: "3000" },
          { category: "TRANSPORT", monthlyAmount: "500" },
        ],
        debts: [{ name: "房贷", currentBalance: "800000", currentMonthDue: "3000" }],
      }),
      TODAY,
    );

    console.log(
      JSON.stringify({
        x6Duplicate: {
          essentialExpenses: home.essentialExpenses,
          mandatoryDebtService: home.mandatoryDebtService,
          burden: String(Number(home.essentialExpenses) + Number(home.mandatoryDebtService)),
          debtPaymentSources: home.debts.map((debt) => debt.paymentSource),
          countedMonthlyPayment: home.debts.map((debt) => debt.countedMonthlyPayment),
        },
      }),
    );

    expect(home.essentialExpenses).toBe("3500");
    expect(home.mandatoryDebtService).toBe("3000");
    duplicateDb.close();
  });

  it("固定支出支付记录只进 expense_records,不回灌计划额,也不进可变支出", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const items = await listEssentialPaymentItems(db, TODAY);
    const itemId = items[0]?.id;
    if (!itemId) throw new Error("essential item missing");
    const receipt = await recordEssentialPayment(db, {
      itemId,
      amount: "2000.00",
      paidOn: TODAY,
      note: "房租",
    });

    const modelInput = await buildMonthlyModelInput(db, "2026-10", TODAY);
    console.log(
      JSON.stringify({
        x6Payment: {
          afterPaymentEssentialExpenses: receipt.home.essentialExpenses,
          monthTotal: receipt.monthTotal,
          modelExpenseKinds: modelInput.input?.facts.expenses.map((row) => row.kind) ?? [],
          modelEssentialExpenses: modelInput.input?.facts.essentialExpenses ?? null,
          variableSpending: (await getHomeApplicationState(db, TODAY)).currentMonthSpending,
        },
      }),
    );

    expect(receipt.home.essentialExpenses).toBe("2000");
    expect(receipt.monthTotal).toBe("2000");
    // 支付记录进入 facts.expenses(kind=ESSENTIAL),但可变支出仍为 0,不清空计划额。
    expect(modelInput.input?.facts.expenses.map((row) => row.kind)).toEqual(["ESSENTIAL"]);
  });
});

describe("STAGE-0 读层能力", () => {
  it("home 读层已接受任意 asOfDate(无需新增月份参数),依赖当月债务事实", async () => {
    await completeOnboarding(db, onboarding(), TODAY);
    const home = await getHomeApplicationState(db, TODAY);
    const maintenance = await getFinancialMaintenanceState(db, TODAY);
    console.log(
      JSON.stringify({
        readLayer: {
          currentMonth: home.currentMonth,
          maintenanceNeedsCurrentMonthFact: maintenance.debts.map(
            (debt) => debt.needsCurrentMonthFact,
          ),
          homeKeys: Object.keys(home).filter((key) =>
            /income|surplus|essential|debt/i.test(key),
          ),
          planningIncome: home.planningIncome,
          baseSurplus: home.baseSurplus,
          essentialExpenses: home.essentialExpenses,
          mandatoryDebtService: home.mandatoryDebtService,
          actualSumAfterSwitchingToActualIncome: String(
            8000 - Number(home.essentialExpenses) - Number(home.mandatoryDebtService),
          ),
        },
      }),
    );
    expect(home.currentMonth).toBe("2026-10");
    expect(maintenance.debts.every((debt) => debt.needsCurrentMonthFact === false)).toBe(true);
  });
});
