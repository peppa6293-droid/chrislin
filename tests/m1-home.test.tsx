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
import { M1Home } from "../src/ui/M1Home.js";
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

/**
 * Services over an existing database. setup() uses it for the first mount and
 * the remount check reuses it, so no second migration or onboarding happens.
 */
function servicesForDb(db: NodeSqliteDatabase): ProductApplicationServices {
  return {
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
}

async function setup(submission: OnboardingSubmission = base, now = "2026-10-30T04:00:00.000Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const asOf = now.slice(0, 10);
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, asOf + "T00:00:00.000Z");
  await completeOnboarding(db, submission, asOf);
  await ensureV2LedgerDefaults(db);
  const services = servicesForDb(db);
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

// Nothing here may appear on the M1 home. 资产 / 收入 / 债务 are counted
// separately below because the approved status note mentions 债务 once.
const EXCLUDED_TEXT = [
  "进展",
  "我的财务",
  "更新财务数据",
  "还款",
  "固定支出",
  "导入",
  "导出",
  "优先",
  "今天的一小步",
  "手头余地",
  "本月要还",
];

const M2_APPROVED_SCOPE_NOTE = "债务情况尚未确认，暂不显示建议金额。";
const M2_FORBIDDEN_CARD_TEXT = [
  "建议上限",
  "建议额度",
  "还可花",
  "已超出建议",
  "本月消费占建议上限比例",
];

/** D1: the single home node and the single month card inside it. */
function m2MonthCard(): Element {
  const homes = Array.from(document.querySelectorAll('[data-testid="m1-home"]'));
  expect(homes.length, "m1-home 数量").toBe(1);
  const home = homes[0];
  if (!home) throw new Error("找不到 m1-home");
  const cards = Array.from(
    home.querySelectorAll('section.v2-month-card[aria-labelledby="m1-month-title"]'),
  );
  expect(cards.length, "消费卡数量").toBe(1);
  const card = cards[0];
  if (!card) throw new Error("找不到消费卡");
  return card;
}

/** D1: every text source the card exposes, hidden nodes and id references included. */
function m2CardTexts(card: Element): string[] {
  const nodes = [card, ...Array.from(card.querySelectorAll("*"))];
  const texts: string[] = [];
  for (const node of nodes) {
    if (node.textContent) texts.push(node.textContent);
    for (const attr of ["aria-label", "aria-description", "title", "alt"]) {
      const value = node.getAttribute(attr);
      if (value) texts.push(value);
    }
  }
  for (const node of nodes) {
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
      const raw = node.getAttribute(attr);
      if (!raw) continue;
      for (const id of raw.split(/\s+/).filter(Boolean)) {
        const target = document.getElementById(id);
        expect(target, "ARIA 引用目标缺失：" + id).toBeTruthy();
        if (target) texts.push(target.textContent ?? "");
      }
    }
  }
  return texts;
}

/** The amount area's own text, so 0 in the target line cannot stand in for 0 spent. */
function m2SpentText(card: Element): string {
  return card.querySelector(".v2-card__value .money-amount")?.textContent ?? "";
}

/** D1 + approved A layout: no recommendation, no derived area, no residual text. */
function m2ExpectDisplayProtection(card: Element, opts: { desired: boolean }) {
  for (const selector of [
    '[data-testid="m1-remaining-line"]',
    ".v2-card__actions",
    ".v2-progress",
    '[role="progressbar"]',
    "[aria-valuenow]",
    "[aria-valuemin]",
    "[aria-valuemax]",
    "[aria-valuetext]",
  ]) {
    expect(card.querySelectorAll(selector).length, "消费卡内 " + selector + " 数量").toBe(0);
  }
  expect(card.querySelectorAll(".v2-card__head").length).toBe(1);
  expect(card.querySelectorAll(".v2-card__value").length).toBe(1);
  expect(card.querySelectorAll('[data-testid="m1-scope-note"]').length).toBe(1);
  expect(
    card.querySelector('[data-testid="m1-scope-note"]')?.textContent,
    "批准说明句必须严格相等",
  ).toBe(M2_APPROVED_SCOPE_NOTE);
  expect(card.querySelectorAll('[data-testid="m1-desired-line"]').length).toBe(
    opts.desired ? 1 : 0,
  );
  expect(card.querySelector(".v2-card__value small")?.textContent).toBe("本月已花");
  const children = Array.from(card.children);
  expect(children.length, "消费卡直接子节点数量").toBe(opts.desired ? 4 : 3);
  expect(children[0]?.classList.contains("v2-card__head")).toBe(true);
  expect(children[1]?.classList.contains("v2-card__value")).toBe(true);
  if (opts.desired) {
    expect(children[2]?.getAttribute("data-testid")).toBe("m1-desired-line");
    expect(children[3]?.getAttribute("data-testid")).toBe("m1-scope-note");
  } else {
    expect(children[2]?.getAttribute("data-testid")).toBe("m1-scope-note");
  }
  for (const text of m2CardTexts(card)) {
    for (const word of M2_FORBIDDEN_CARD_TEXT) {
      expect(text, "消费卡残留 " + word).not.toContain(word);
    }
    expect(text, "消费卡残留百分比").not.toMatch(/\d\s*[%％]/);
  }
}

describe("M1 home shows only spending against target and recent records", () => {
  it("empty month: ¥0.00 spent shown, no recommendation or derived area, no records, no NaN", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(m2SpentText(card), "金额区实际消费").toBe("¥0.00");
      expect(screen.getByTestId("m1-scope-note").textContent).toBe(M2_APPROVED_SCOPE_NOTE);
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
      expect(screen.getByText("还没有最近记录")).toBeTruthy();
      expect(home.textContent).not.toMatch(/NaN|Infinity|undefined/);
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(2000);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(2000);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(0);
      expect(state.desiredMonthlyDiscretionarySpending, "服务用户期望").toBe("2000");
    } finally {
      db.close();
    }
  }, 20_000);

  it("contains none of the excluded modules, no navigation, and only the approved note mentions debt", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      const buttons = within(home)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim() ?? "");
      expect(buttons.every((t) => /记一笔|记第一笔/.test(t))).toBe(true);
      expect(within(home).queryByRole("navigation")).toBeNull();
      const homeText = home.textContent ?? "";
      const occurrences = (text: string, word: string) => text.split(word).length - 1;
      for (const word of EXCLUDED_TEXT) {
        expect(occurrences(homeText, word), "excluded word " + word).toBe(0);
      }
      const noteText = screen.getByTestId("m1-scope-note").textContent ?? "";
      expect(noteText).toBe(M2_APPROVED_SCOPE_NOTE);
      expect(occurrences(homeText, "资产"), "整页 资产").toBe(0);
      expect(occurrences(homeText, "收入"), "整页 收入").toBe(0);
      expect(occurrences(homeText, "债务"), "整页 债务（仅说明句内 1 次）").toBe(1);
      expect(occurrences(noteText, "债务"), "说明句内 债务").toBe(1);
      const outsideNote = homeText.replace(noteText, "");
      for (const word of ["资产", "收入", "债务"]) {
        expect(occurrences(outsideNote, word), "排除说明后的 " + word).toBe(0);
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
      expect(screen.getByTestId("m1-scope-note").textContent).toBe(M2_APPROVED_SCOPE_NOTE);
    } finally {
      db.close();
    }
  }, 20_000);

  it("after saving two records the card shows 120.50 and the latest first, and a remount keeps the facts with no recommendation", async () => {
    const { db, services, user } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      await record(user, "100.50", "吃饭");
      await waitFor(() => expect(m2SpentText(card), "金额区实际消费").toBe("¥100.50"));
      m2ExpectDisplayProtection(card, { desired: true });
      const afterFirst = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(afterFirst.currentMonthSpending), "第一笔后服务实际消费").toBe(100.5);
      expect(Number(afterFirst.remainingSpendingCapacity), "第一笔后服务剩余").toBe(1899.5);
      const list = screen.getByRole("region", { name: "最近消费记录" });
      expect(within(list).getAllByText(/¥/).length).toBe(1);
      expect(list.textContent).toContain("餐饮");
      expect(list.textContent).toContain("100.50");
      await record(user, "20", "出行");
      await waitFor(() => expect(m2SpentText(card), "金额区实际消费").toBe("¥120.50"));
      m2ExpectDisplayProtection(card, { desired: true });
      const behind = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(behind.currentMonthSpending), "服务实际消费").toBe(120.5);
      expect(Number(behind.remainingSpendingCapacity), "服务剩余").toBe(1879.5);
      expect(Number(behind.recommendedMonthlySpending), "服务建议").toBe(2000);
      const rows = screen.getByRole("region", { name: "最近消费记录" }).children;
      expect(rows[0]?.textContent).toContain("交通");
      expect(rows[1]?.textContent).toContain("餐饮");
      // Remount on the same open database: no new setup, no re-recorded rows.
      cleanup();
      render(<App services={servicesForDb(db)} />);
      await screen.findByTestId("m1-home");
      const remounted = m2MonthCard();
      expect(m2SpentText(remounted), "重挂载后金额区").toBe("¥120.50");
      m2ExpectDisplayProtection(remounted, { desired: true });
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
      const afterRemount = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(afterRemount.currentMonthSpending), "重挂载后服务实际消费").toBe(120.5);
      expect(afterRemount.desiredMonthlyDiscretionarySpending, "重挂载后期望").toBe("2000");
    } finally {
      db.close();
    }
  }, 40_000);

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

  it("overspending: ¥2,500.00 spent is shown, with no amount above the recommendation and no negative remainder", async () => {
    const { db, services, user } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      await record(user, "2500");
      await waitFor(() => expect(m2SpentText(card), "金额区实际消费").toBe("¥2,500.00"));
      m2ExpectDisplayProtection(card, { desired: true });
      expect(screen.getByTestId("m1-home").textContent).not.toMatch(/-¥|NaN|Infinity/);
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(2000);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(500);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(2500);
    } finally {
      db.close();
    }
  }, 20_000);

  it("a zero recommendation renders no recommendation-0 line, no percentage and no derived area", async () => {
    const { db, services } = await setup({ ...base, stableMonthlyIncome: "4000" });
    try {
      render(<App services={services} />);
      const home = await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(m2SpentText(card), "金额区实际消费").toBe("¥0.00");
      expect(within(card).queryByRole("progressbar")).toBeNull();
      expect(home.textContent).not.toMatch(/NaN|Infinity/);
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(0);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(0);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
    } finally {
      db.close();
    }
  }, 20_000);

  it("a recommendation lower than the user target: only the user target is shown, never the 1,000 recommendation", async () => {
    const { db, services } = await setup({
      ...base,
      stableMonthlyIncome: "5000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "4000" }],
      desiredMonthlyDiscretionarySpending: "3000",
      cashAccounts: [{ name: "现金", balance: "99999", includeInSafetyResources: true }],
    });
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(m2SpentText(card), "金额区实际消费").toBe("¥0.00");
      expect(card.textContent, "不渲染建议 1,000").not.toContain("¥1,000.00");
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥3,000.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(1000);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(1000);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(0);
    } finally {
      db.close();
    }
  }, 20_000);

  it("on 2026-10-31 a saved expense counts in October and no derived line is rendered", async () => {
    const { db, services, user } = await setup(base, "2026-10-31T04:00:00.000Z");
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      await record(user, "50");
      await waitFor(() => expect(card.textContent, "实际消费").toContain("¥50.00"));
      m2ExpectDisplayProtection(card, { desired: true });
      const state = await getHomeApplicationState(db, "2026-10-31");
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(50);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(1950);
    } finally {
      db.close();
    }
  }, 20_000);

  it("positive service recommendation: the card renders no recommendation or derived area, while the service still returns 2000 / 0 / 2000", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(card.textContent, "实际消费仍然显示").toContain("¥0.00");
      expect(screen.getByTestId("m1-desired-line")?.textContent).toContain("¥2,000.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(2000);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(2000);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(0);
      expect(state.desiredMonthlyDiscretionarySpending, "服务用户期望").toBe("2000");
    } finally {
      db.close();
    }
  }, 20_000);

  it("zero service recommendation: the card renders no recommendation-0 line and no derived area, while the service still returns 0 / 0 / 0", async () => {
    const { db, services } = await setup({ ...base, stableMonthlyIncome: "4000" });
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(screen.getByTestId("m1-desired-line")?.textContent).toContain("¥2,000.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(0);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(0);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(0);
      expect(state.desiredMonthlyDiscretionarySpending, "服务用户期望").toBe("2000");
    } finally {
      db.close();
    }
  }, 20_000);

  it("U3 zero recommendation with spending: ¥300.00 spent is shown and no recommendation-0 line exists", async () => {
    const { db, services, user } = await setup({ ...base, stableMonthlyIncome: "4000" });
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      await record(user, "300");
      await waitFor(() => expect(m2SpentText(card), "金额区实际消费").toBe("¥300.00"));
      m2ExpectDisplayProtection(card, { desired: true });
      expect(screen.getByTestId("m1-desired-line").textContent).toContain("¥2,000.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(0);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(300);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(300);
    } finally {
      db.close();
    }
  }, 20_000);

  it("U6 desired=null: a copy of the real state renders 3 card children with no click and no callback", async () => {
    const { db, user } = await setup();
    try {
      const real = await getHomeApplicationState(db, "2026-10-30");
      const clickSpy = vi.spyOn(user, "click");
      const placeholder = vi.fn(async (): Promise<never> => {
        throw new Error("U6 只验证渲染：onRecordExpense 不应被调用");
      });
      render(
        <M1Home
          home={{ ...real, desiredMonthlyDiscretionarySpending: null }}
          onRecordExpense={placeholder}
        />,
      );
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: false });
      expect(m2SpentText(card), "金额区实际消费").toBe("¥0.00");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(clickSpy).toHaveBeenCalledTimes(0);
      expect(placeholder).not.toHaveBeenCalled();
      const again = await getHomeApplicationState(db, "2026-10-30");
      expect(again.desiredMonthlyDiscretionarySpending, "原服务期望仍为 2000").toBe("2000");
      expect(Number(again.recommendedMonthlySpending), "原服务建议").toBe(2000);
      expect(Number(again.remainingSpendingCapacity), "原服务剩余").toBe(2000);
      expect(Number(again.amountAboveRecommendation), "原服务超出").toBe(0);
    } finally {
      db.close();
    }
  }, 20_000);

  it("U7 a user target of 0 through the real onboarding path: the target line reads ¥0.00 and the card keeps 4 children", async () => {
    const { db, services } = await setup({ ...base, desiredMonthlyDiscretionarySpending: "0" });
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      expect(m2SpentText(card), "金额区实际消费").toBe("¥0.00");
      expect(screen.getByTestId("m1-desired-line").textContent).toBe("你设定的每月期望：¥0.00");
      const state = await getHomeApplicationState(db, "2026-10-30");
      expect(state.desiredMonthlyDiscretionarySpending, "服务期望").toBe("0");
      expect(Number(state.recommendedMonthlySpending), "服务建议").toBe(0);
      expect(Number(state.remainingSpendingCapacity), "服务剩余").toBe(0);
      expect(Number(state.amountAboveRecommendation), "服务超出").toBe(0);
      expect(Number(state.currentMonthSpending), "服务实际消费").toBe(0);
    } finally {
      db.close();
    }
  }, 20_000);

  it("D1 checker rejects a broken aria reference or an empty approved note on an otherwise compliant card", async () => {
    const { db, services } = await setup();
    try {
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      const card = m2MonthCard();
      m2ExpectDisplayProtection(card, { desired: true });
      const brokenRef = card.cloneNode(true) as Element;
      brokenRef.setAttribute("aria-describedby", "rv-missing-target");
      expect(document.getElementById("rv-missing-target")).toBeNull();
      expect(() => m2ExpectDisplayProtection(brokenRef, { desired: true })).toThrow(/引用/);
      const emptyNote = card.cloneNode(true) as Element;
      const note = emptyNote.querySelector('[data-testid="m1-scope-note"]');
      if (!note) throw new Error("找不到说明节点");
      note.textContent = "";
      expect(() => m2ExpectDisplayProtection(emptyNote, { desired: true })).toThrow(/说明/);
    } finally {
      db.close();
    }
  }, 20_000);
});
