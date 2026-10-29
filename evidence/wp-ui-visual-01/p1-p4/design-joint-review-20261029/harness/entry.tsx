import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { HomeApplicationState } from "../../../../../src/application/product-service.js";
import type {
  EssentialItemRecord,
  EssentialPaymentRecord,
} from "../../../../../src/application/ux-ledger-service.js";
import type { ProductApplicationServices } from "../../../../../src/ui/contracts.js";
import { FixedExpensesPage } from "../../../../../src/ui/FixedExpensesPage.js";
import { V2MonthlySpendCard } from "../../../../../src/ui/V2MonthlySpendCard.js";
import { V2StructureCard } from "../../../../../src/ui/V2StructureCard.js";
import "../../../../../src/style.css";
import "../../../../../src/ui/trial-experience.css";
import "../../../../../src/ui/pixel-world.css";
import "../../../../../src/ui/duo-guide.css";
import "../../../../../src/ui/v2-surface.css";
import "../../../../../src/ui/v2-tokens.css";
import "../../../../../src/ui/v2-card.css";
import "../../../../../src/ui/v2-home-revamp.css";
import "../../../../../src/ui/v2-structure-ring.css";
import "../../../../../src/ui/v2-fixed-page.css";
import "../../../../../src/ui/v2-feedback.css";
import "../../../../../src/ui/v2-calendar-picker.css";
import "../../../../../src/ui/v2-detail-visual.css";
import "../../../../../src/ui/v2-savings-room.css";

const BASE_HOME: HomeApplicationState = {
  status: "READY",
  asOfDate: "2026-10-29",
  currentMonth: "2026-10",
  profileDisplayName: "小钱",
  actualIncomeRecordCount: 1,
  actualIncomeTotal: "13000",
  currentCash: "5000",
  currentMonthSpending: "125.50",
  currentMonthVariableExpenseCount: 2,
  totalDebt: "800",
  liquidAssets: "1500",
  desiredMonthlyDiscretionarySpending: "1600",
  planningIncome: "13000",
  essentialExpenses: "3528",
  mandatoryDebtService: "800",
  monthlyCoreObligations: "4328",
  baseSurplus: "8672",
  eligibleCash: "5000",
  eligibleLiquidInvestmentAssets: "1500",
  safetyResources: "6500",
  safetyTargetResources: "25968",
  safetyCoverageMonths: "1.50",
  safetyCoverageStatus: "NORMAL",
  safetyCoverageTargetMonths: 6,
  recommendedMonthlySpending: "1000",
  remainingSpendingCapacity: "874.50",
  amountAboveRecommendation: "0",
  cashCoverageMonths: "1.15",
  minimumCashCoverageMonths: 2,
  safetyGap: "19468",
  debts: [],
  spendingStatus: "NORMAL",
  cashSafetyGateStatus: "CLEAR",
  cashFloorMet: true,
  consumptionUtilization: { status: "CALCULATED", value: "0.12" },
  trendState: "BASELINE_BUILDING",
  trendDimensions: {
    LIQUIDITY_SAFETY: {
      direction: "NO_BASELINE",
      reason: "Prior cash or core-obligation baseline is missing.",
    },
    DEBT: { direction: "NO_BASELINE", reason: "Prior valid debt balance is missing." },
    CONSUMPTION: {
      direction: "NO_BASELINE",
      reason: "Prior same-period variable spending is missing.",
    },
    WEALTH: {
      direction: "NO_BASELINE",
      reason: "Prior liquid-investable-asset snapshot is missing.",
    },
  },
  primaryImprovement: null,
  primaryDrag: null,
  priorityAction: { action_code: "NO_ACTION", reason: "No clear issue." },
  recentExpenses: [],
} as unknown as HomeApplicationState;

type StructureState = {
  income: string;
  fixed: string;
  debt: string;
  pendingDebt?: boolean;
  spending?: string;
};

const STRUCTURE_STATES: Record<string, StructureState> = {
  actual: { income: "13791.25", fixed: "3528", debt: "14518.73" },
  large: { income: "123456789.12", fixed: "12345678.90", debt: "14518.73" },
  roomy: { income: "13000", fixed: "4800", debt: "1300" },
  "light-over": { income: "13000", fixed: "10500", debt: "3500" },
  overload: { income: "13000", fixed: "11800", debt: "4200" },
  "zero-burden": { income: "0", fixed: "2500", debt: "1000" },
  "over-outer": { income: "13000", fixed: "15600", debt: "2600" },
  "over-both": { income: "13000", fixed: "15600", debt: "15600" },
  "over-large": { income: "10000", fixed: "23000", debt: "1000" },
  "over-split": { income: "13000", fixed: "9100", debt: "5200" },
  pending: { income: "13000", fixed: "3528", debt: "800", pendingDebt: true },
};

function homeFor(state: StructureState): HomeApplicationState {
  const income = Number(state.income);
  const surplus = income - Number(state.fixed) - Number(state.debt);
  return {
    ...BASE_HOME,
    actualIncomeTotal: state.income,
    actualIncomeRecordCount: Number(state.income) > 0 ? 1 : 0,
    planningIncome: "13000",
    essentialExpenses: state.fixed,
    mandatoryDebtService: state.debt,
    monthlyCoreObligations: String(Number(state.fixed) + Number(state.debt)),
    baseSurplus: String(surplus),
    currentMonthSpending: state.spending ?? BASE_HOME.currentMonthSpending,
  };
}

const ITEMS = [
  { id: "rent", name: "房租", category: "HOUSING", monthlyAmount: "1800", active: true },
  {
    id: "power",
    name: "水电",
    category: "UTILITIES_COMMUNICATIONS",
    monthlyAmount: "228",
    active: true,
  },
  { id: "commute", name: "地铁", category: "TRANSPORT", monthlyAmount: "900", active: true },
  { id: "food", name: "菜钱", category: "BASIC_FOOD", monthlyAmount: "600", active: true },
] as unknown as EssentialItemRecord[];

function payment(itemId: string, amount: string, itemName: string, id = `${itemId}-1`) {
  return {
    id,
    itemId,
    itemName,
    category: "HOUSING",
    amount,
    paidOn: "2026-10-05",
    note: "",
    recordedAt: "2026-10-05T10:00:00.000Z",
  } as unknown as EssentialPaymentRecord;
}

const FIXED_STATES: Record<string, { items: EssentialItemRecord[]; payments: EssentialPaymentRecord[] }> = {
  normal: {
    items: ITEMS,
    payments: [
      payment("rent", "1800", "房租"),
      payment("power", "228", "水电"),
      payment("commute", "600", "地铁"),
    ],
  },
  unpaid: { items: ITEMS, payments: [] },
  overpaid: {
    items: ITEMS,
    payments: [
      payment("rent", "2200", "房租"),
      payment("rent", "200", "房租", "rent-2"),
      payment("power", "228", "水电"),
    ],
  },
  "zero-plan": {
    items: [
      ...ITEMS.filter((item) => item.id !== "commute"),
      { id: "commute", name: "地铁", category: "TRANSPORT", monthlyAmount: "0", active: true },
    ] as unknown as EssentialItemRecord[],
    payments: [payment("commute", "120", "地铁")],
  },
  empty: { items: [], payments: [] },
  unowned: {
    items: ITEMS,
    payments: [payment("rent", "1800", "房租"), payment("", "300", "旧记录")],
  },
};

function fakeServices(items: EssentialItemRecord[], payments: EssentialPaymentRecord[]) {
  return {
    listEssentialPaymentItems: async () => items,
    listEssentialPayments: async () => payments,
    saveEssentialItems: async () => ({ home: {} }),
    recordEssentialPayment: async () => ({ home: {}, monthTotal: "0" }),
  } as unknown as ProductApplicationServices;
}

function HomeView({ state }: { state: StructureState }) {
  const [pending, setPending] = useState<string[]>(state.pendingDebt ? ["房贷"] : []);
  const home = homeFor(state);
  return (
    <div className="v2-shell">
      <div className="v2-content">
        <div className="v2-page">
          <div className="v2-today-page">
            <div className="v2-home-cards">
              <V2StructureCard
                home={home}
                pendingDebtFactNames={pending}
                onOpenFixedExpenses={() => setPending([])}
                onOpenDebt={() => {}}
                onOpenCashflow={() => {}}
              />
              <V2MonthlySpendCard
                home={home}
                savedExpenseId={null}
                onOpenDetail={() => {}}
                onOpenLedger={() => {}}
                onOpenExpense={() => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCALE = Number(new URLSearchParams(window.location.search).get("scale") ?? "1");
if (Number.isFinite(SCALE) && SCALE > 1) {
  document.documentElement.style.fontSize = `${16 * SCALE}px`;
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "home";
  const state = params.get("state") ?? (view === "fixed" ? "normal" : "roomy");

  if (view === "fixed") {
    const fixture = FIXED_STATES[state] ?? FIXED_STATES.normal;
    return (
      <FixedExpensesPage
        asOfDate="2026-10-14"
        services={fakeServices(fixture.items, fixture.payments)}
        onApplyHome={() => {}}
        onBack={() => {}}
      />
    );
  }

  return <HomeView state={STRUCTURE_STATES[state] ?? STRUCTURE_STATES.roomy} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("root missing");
createRoot(root).render(<App />);
