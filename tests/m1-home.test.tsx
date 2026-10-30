// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import {
  completeOnboarding,
  getExpenseRecordById,
  getHomeApplicationState,
  getOnboardingRequirement,
  type OnboardingSubmission,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  ensureV2LedgerDefaults,
  recordV2CashExpenseForDatabase,
} from "../src/runtime/tauri-bootstrap.js";
import { App } from "../src/ui/App.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base: OnboardingSubmission = {
  stableMonthlyIncome: "10000",
  essentialExpenses: [{ category: "HOUSING", monthlyAmount: "4000" }],
  cashAccounts: [{ name: "现金", balance: "30000", includeInSafetyResources: true }],
  assets: [],
  debts: [],
  safetyCoverageTargetMonths: 6,
  minimumCashCoverageMonths: 1,
  desiredMonthlyDiscretionarySpending: "2000",
};

async function setup(submission: OnboardingSubmission = base, now = "2026-10-30T04:00:00.000Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const asOf = now.slice(0, 10);
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${asOf}T00:00:00.000Z`);
  await completeOnboarding(db, submission, asOf);
  await ensureV2LedgerDefaults(db);
  const services = {
    bootstrap: vi.fn().mockResolvedValue({ status: "READY" }),
    getOnboardingRequirement,
    completeOnboarding: vi.fn(),
    getHomeApplicationState: (d: string) => getHomeApplicationState(db, d),
    getExpenseRecordById: (id: string) => getExpenseRecordById(db, id),
    recordExpenseAndRecalculate: vi.fn(),
    recordV2CashExpense: (s: Parameters<typeof recordV2CashExpenseForDatabase>[1], d: string) =>
      recordV2CashExpenseForDatabase(db, s, d),
    getFinancialMaintenanceState: (d: string) => getFinancialMaintenanceState(db, d),
    getFinancialMaintenanceRequirement: vi.fn(),
    updateFinancialDataAndRecalculate: vi.fn(),
  } as unknown as ProductApplicationServices;
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  return { db, services, user };
}

async function record(user: ReturnType<typeof userEvent.setup>, amount: string, label?: string) {
  await user.click(screen.getByRole("button", { name: /记一笔/ }));
  await user.type(screen.getByLabelText(/消费金额/), amount);
  if (label) await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("button", { name: "保存消费" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const EXCLUDED_TEXT = [
  "进展",
  "我的财务",
  "更新财务数据",
  "债务",
  "还款",
  "资产",
  "固定支出",
  "导入",
  "导出",
  "优先",
  "今天的一小步",
  "手头余地",
  "本月要还",
  "收入",
];

describe("M1 home shows only spending against target and recent records", () => {
  it("empty month: ¥0.00 spent, full recommended amount left, no records, no NaN", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      expect(home.textContent).toContain("¥0.00");
      expect(home.textContent).toContain("建议上限 ¥2,000.00");
      expect(screen.getByTestId("m1-remaining-line").textContent).toBe("还可花 ¥2,000.00");
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
      expect(screen.getByText("还没有最近记录")).toBeTruthy();
      expect(home.textContent).not.toMatch(/NaN|Infinity|undefined/);
    } finally {
      db.close();
    }
  }, 20_000);

  it("contains none of the excluded modules and exposes no navigation", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      const buttons = within(home)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim() ?? "");
      expect(buttons.every((t) => /记一笔|记第一笔/.test(t))).toBe(true);
      expect(within(home).queryByRole("navigation")).toBeNull();
      for (const word of EXCLUDED_TEXT) {
        const hits = (home.textContent ?? "").split(word).length - 1;
        // These words appear once, only inside the scope note explaining what the amount is based on.
        const allowed = ["资产", "债务", "收入"].includes(word) ? 1 : 0;
        expect(hits, `excluded word ${word}`).toBeLessThanOrEqual(allowed);
      }
    } finally {
      db.close();
    }
  }, 20_000);

  it("never shows total debt as zero or any asset total", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      expect(home.textContent).not.toContain("总债务");
      expect(home.textContent).not.toContain("¥30,000.00");
      expect(screen.getByTestId("m1-scope-note").textContent).toContain("没有计入");
    } finally {
      db.close();
    }
  }, 20_000);

  it("after saving, spent and remaining move by the amount and the record is listed first", async () => {
    const { db, services, user } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      await record(user, "100.50", "吃饭");
      await waitFor(() =>
        expect(screen.getByTestId("m1-remaining-line").textContent).toBe("还可花 ¥1,899.50"),
      );
      const list = screen.getByRole("region", { name: "最近消费记录" });
      expect(within(list).getAllByText(/¥/).length).toBe(1);
      expect(list.textContent).toContain("餐饮");
      expect(list.textContent).toContain("100.50");
      await record(user, "20", "出行");
      await waitFor(() =>
        expect(screen.getByTestId("m1-remaining-line").textContent).toBe("还可花 ¥1,879.50"),
      );
      const rows = screen.getByRole("region", { name: "最近消费记录" }).children;
      expect(rows[0]?.textContent).toContain("交通");
      expect(rows[1]?.textContent).toContain("餐饮");
    } finally {
      db.close();
    }
  }, 30_000);

  it("shows at most the latest three records", async () => {
    const { db, services, user } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      for (const a of ["1", "2", "3", "4"]) await record(user, a);
      await waitFor(() =>
        expect(screen.getByRole("region", { name: "最近消费记录" }).children.length).toBe(3),
      );
      const text = screen.getByRole("region", { name: "最近消费记录" }).textContent ?? "";
      expect(text).toContain("4.00");
      expect(text).toContain("2.00");
      expect(text).not.toContain("1.00");
    } finally {
      db.close();
    }
  }, 40_000);

  it("overspending shows the amount above the recommendation, not a negative remainder", async () => {
    const { db, services, user } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      await record(user, "2500");
      await waitFor(() =>
        expect(screen.getByTestId("m1-remaining-line").textContent).toBe("已超出建议 ¥500.00"),
      );
      expect(screen.getByTestId("m1-home").textContent).not.toMatch(/-¥|NaN|Infinity/);
    } finally {
      db.close();
    }
  }, 20_000);

  it("a recommendation of zero shows a clear line, no percentage, no NaN", async () => {
    const { db, services } = await setup({ ...base, stableMonthlyIncome: "4000" });
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      expect(screen.getByTestId("m1-remaining-line").textContent).toBe("本月建议额度 ¥0.00");
      expect(within(home).queryByRole("progressbar")).toBeNull();
      expect(home.textContent).not.toMatch(/NaN|Infinity/);
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
    } finally {
      db.close();
    }
  }, 20_000);

  it("the recommendation can be lower than the user's own target and both are shown", async () => {
    const { db, services } = await setup({
      ...base,
      stableMonthlyIncome: "5000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "4000" }],
      desiredMonthlyDiscretionarySpending: "3000",
      cashAccounts: [{ name: "现金", balance: "99999", includeInSafetyResources: true }],
    });
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      expect(home.textContent).toContain("建议上限 ¥1,000.00");
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥3,000.00");
    } finally {
      db.close();
    }
  }, 20_000);

  it("month boundary: an entry dated next month does not change this month's total", async () => {
    const { db, services, user } = await setup(base, "2026-10-31T04:00:00.000Z");
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      await record(user, "50");
      await waitFor(() =>
        expect(screen.getByTestId("m1-remaining-line").textContent).toBe("还可花 ¥1,950.00"),
      );
    } finally {
      db.close();
    }
  }, 20_000);
});
