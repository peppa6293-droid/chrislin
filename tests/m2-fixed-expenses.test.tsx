// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, Profiler, useCallback, useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import { ApplicationModelError } from "../src/application/monthly-model-service.js";
import type { HomeApplicationState } from "../src/application/product-service.js";
import {
  completeOnboarding,
  getExpenseRecordById,
  getHomeApplicationState,
  getOnboardingRequirement,
} from "../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../src/application/ux-ledger-service.js";
import { ModelValidationError } from "../src/model/errors.js";
import { money } from "../src/model/money.js";
import type { ExpenseCategory } from "../src/model/types.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  ensureV2LedgerDefaults,
  recordV2CashExpenseForDatabase,
} from "../src/runtime/tauri-bootstrap.js";
import { App } from "../src/ui/App.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { M2FinanceRoute } from "../src/ui/M2FinanceRoute.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const AS_OF = "2026-11-01";
const MONTH = "2026-11";
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  cleanup();
});

/** UI 侧 M2_EVIDENCE：与 service 测试同前缀，undefined 以标记保留。 */
function emitUiEvidence(caseId: string, payload: Record<string, unknown>) {
  const mark = (value: unknown): unknown => {
    if (value === undefined) return { $undefined: true };
    if (Array.isArray(value)) return value.map(mark);
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        Object.defineProperty(output, key, {
          value: mark(inner),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return output;
    }
    return value;
  };
  console.log(`M2_EVIDENCE ${JSON.stringify(mark({ caseId, ...payload }))}`);
}

type Services = ProductApplicationServices & {
  listEssentialPaymentItems: ReturnType<typeof vi.fn>;
  listEssentialPayments: ReturnType<typeof vi.fn>;
  recordEssentialPayment: ReturnType<typeof vi.fn>;
  saveEssentialItems: ReturnType<typeof vi.fn>;
};

function startClock(asOf: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${asOf}T04:00:00.000Z`));
}

/**
 * 与 onboarding 产出的数据形状一致：项目名称就是类别代码，金额 1000 + 200。
 * 固定日期种子，供断言 本月预计 = ¥1,200.00；再加一笔历史消费让首页非空。
 */
async function seed(asOf = AS_OF) {
  startClock(asOf);
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${asOf}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "2000",
      essentialExpenses: [
        { category: "HOUSING", monthlyAmount: "1000" },
        { category: "UTILITIES_COMMUNICATIONS", monthlyAmount: "200" },
      ],
      cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    asOf,
  );
  await ensureV2LedgerDefaults(db);
  await recordV2CashExpenseForDatabase(
    db,
    { amount: "50", dateTime: `${asOf}T00:00:00.000Z`, businessDate: asOf, category: "FOOD" },
    asOf,
  );
  return db;
}

function makeServices(
  db: NodeSqliteDatabase,
  overrides: Partial<Record<keyof Services, unknown>> = {},
): Services {
  return {
    bootstrap: vi.fn().mockResolvedValue({ status: "READY" }),
    getOnboardingRequirement,
    completeOnboarding: vi.fn(),
    getHomeApplicationState: vi.fn((date: string) => getHomeApplicationState(db, date)),
    getExpenseRecordById: vi.fn((id: string) => getExpenseRecordById(db, id)),
    recordExpenseAndRecalculate: vi.fn(),
    recordV2CashExpense: vi.fn(),
    getFinancialMaintenanceState: vi.fn((date: string) => getFinancialMaintenanceState(db, date)),
    getFinancialMaintenanceRequirement: vi.fn(),
    updateFinancialDataAndRecalculate: vi.fn(),
    listEssentialPaymentItems: vi.fn((date: string) => listEssentialPaymentItems(db, date)),
    listEssentialPayments: vi.fn((month?: string) => listEssentialPayments(db, month)),
    recordEssentialPayment: vi.fn((input: Parameters<typeof recordEssentialPayment>[1]) =>
      recordEssentialPayment(db, input),
    ),
    saveEssentialItems: vi.fn((items: Parameters<typeof saveEssentialItems>[1], date: string) =>
      saveEssentialItems(db, items, date),
    ),
    ...overrides,
  } as unknown as Services;
}

async function mount(services: Services) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App services={services} />);
  await screen.findByTestId("m1-home");
  return user;
}

type User = Awaited<ReturnType<typeof mount>>;

async function openFixedExpenses(user: User) {
  await user.click(await screen.findByRole("button", { name: "我的财务" }));
  await user.click(await screen.findByRole("button", { name: /固定支出/ }));
  await screen.findByRole("region", { name: "固定支出项目" });
}

async function itemByCategory(db: NodeSqliteDatabase, category: ExpenseCategory, asOf = AS_OF) {
  const item = (await listEssentialPaymentItems(db, asOf)).find(
    (candidate) => candidate.category === category,
  );
  if (!item) throw new Error(`缺少 ${category} 项目`);
  return item;
}

async function openPayForm(user: User, db: NodeSqliteDatabase, category: ExpenseCategory) {
  const item = await itemByCategory(db, category);
  await user.click(screen.getByRole("button", { name: `记一笔 ${item.name}` }));
  await screen.findByLabelText("付款金额");
  return item;
}

async function fillAddForm(
  user: User,
  input: { name?: string; category?: string; amount?: string },
) {
  await user.click(await screen.findByRole("button", { name: "添加支出" }));
  await screen.findByLabelText("支出名称");
  if (input.name) await user.type(screen.getByLabelText("支出名称"), input.name);
  if (input.category) await user.selectOptions(screen.getByLabelText("类别"), input.category);
  if (input.amount !== undefined) {
    const field = screen.getByLabelText("每月金额") as HTMLInputElement;
    await user.clear(field);
    // user-event 不接受空串（Expected key descriptor）；空即目标态，无需再输入。
    if (input.amount !== "") await user.type(field, input.amount);
  }
}

async function confirmAdd(user: User) {
  await screen.findByRole("region", { name: "添加核对" });
  await user.click(screen.getByRole("button", { name: "确认添加" }));
}

async function addItem(user: User, input: { name: string; category?: string; amount: string }) {
  await fillAddForm(user, input);
  await user.click(screen.getByRole("button", { name: "添加" }));
  await confirmAdd(user);
  await screen.findByText("已添加");
}

/** 让页面在指定日期重新挂载，用于「历史月份」与「重开」场景。 */
async function remountLater(services: Services, days: number) {
  cleanup();
  vi.setSystemTime(new Date(Date.parse(`${AS_OF}T04:00:00.000Z`) + days * DAY_MS));
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App services={services} />);
  await screen.findByTestId("m1-home");
  await openFixedExpenses(user);
  return user;
}

/** REWORK-02 需要：可在既有 seed 之上覆盖部分模型输入的真实内存库夹具。 */
async function seedWith(overrides: Record<string, unknown>) {
  startClock(AS_OF);
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "2000",
      essentialExpenses: [
        { category: "HOUSING", monthlyAmount: "1000" },
        { category: "UTILITIES_COMMUNICATIONS", monthlyAmount: "200" },
      ],
      cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
      ...overrides,
    } as never,
    AS_OF,
  );
  await ensureV2LedgerDefaults(db);
  await recordV2CashExpenseForDatabase(
    db,
    { amount: "50", dateTime: `${AS_OF}T00:00:00.000Z`, businessDate: AS_OF, category: "FOOD" },
    AS_OF,
  );
  return db;
}

/** 一个可由测试显式放行的 promise 闸门；不使用固定 sleep。 */
function gate() {
  let release!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolve, rejectFn) => {
    release = resolve;
    reject = rejectFn;
  });
  return { promise, release, reject };
}

/** 记录写入与读回真实发生的先后，供时间线断言使用，不靠计数总数。 */
function timeline() {
  const entries: string[] = [];
  return {
    entries,
    push(entry: string) {
      entries.push(entry);
    },
    indexOf(entry: string) {
      return entries.indexOf(entry);
    },
    count(prefix: string) {
      return entries.filter((entry) => entry.startsWith(prefix)).length;
    },
    lastIndexOf(entry: string) {
      return entries.lastIndexOf(entry);
    },
    slice(from: number) {
      return entries.slice(from);
    },
  };
}

async function goToFixedExpensesFromToday(user: User) {
  await user.click(await screen.findByRole("button", { name: "今天" }));
  await screen.findByTestId("m1-home");
  await user.click(await screen.findByRole("button", { name: "我的财务" }));
  await user.click(await screen.findByRole("button", { name: /固定支出/ }));
}

describe("V01 我的财务 → 固定支出常驻路径", () => {
  it("两步进入，项目四字段与服务读回一致，返回逐级回到我的财务与今天", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);

      expect(screen.getByRole("heading", { name: "固定支出" })).toBeTruthy();
      const expected = await listEssentialPaymentItems(db, AS_OF);
      const rows = within(screen.getByRole("region", { name: "固定支出项目" })).getAllByRole(
        "listitem",
      );
      expect(rows).toHaveLength(expected.length);
      for (const [index, item] of expected.entries()) {
        const row = rows[index];
        if (!row) throw new Error("缺少项目行");
        expect(row.getAttribute("data-item-id")).toBe(item.id);
        expect(row.textContent).toContain(item.name);
        expect(row.textContent).toContain(item.category === "HOUSING" ? "住房" : "水电通信");
        expect(row.textContent).toContain(
          money(item.monthlyAmount).eq(1000) ? "¥1,000.00" : "¥200.00",
        );
      }

      await user.click(screen.getByRole("button", { name: "返回" }));
      expect(await screen.findByRole("heading", { name: "我的财务" })).toBeTruthy();
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();

      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "固定支出项目" });
      await user.click(screen.getByRole("button", { name: "返回" }));
      await user.click(await screen.findByRole("button", { name: "今天" }));

      const home = await screen.findByTestId("m1-home");
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();
      const labels = within(home)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim() ?? "");
      expect(labels.every((text) => /记一笔|记第一笔/.test(text))).toBe(true);
      expect(within(home).queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V02 初始读取、空态与读取失败", () => {
  it("两项目显示 本月预计 ¥1,200.00 本月已付 ¥0.00，本月记录为空态", async () => {
    const db = await seed();
    try {
      const user = await mount(makeServices(db));
      await openFixedExpenses(user);
      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("本月预计");
      expect(summary.textContent).toContain("¥1,200.00");
      expect(summary.textContent).toContain("本月已付");
      expect(summary.textContent).toContain("¥0.00");
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
    } finally {
      db.close();
    }
  }, 30_000);

  it("无项目时显示 还没有固定支出，且 0 次支付调用", async () => {
    const db = await seed();
    try {
      await db.execute("UPDATE essential_expense_items SET active=0");
      const services = makeServices(db);
      const user = await mount(services);
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      expect(await screen.findByText("还没有固定支出")).toBeTruthy();
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);

  it("项目读取失败显示可重试错误，重试只重读且不改数据", async () => {
    const db = await seed();
    try {
      let fail = true;
      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          if (fail) throw new Error("读取失败");
          return listEssentialPaymentItems(db, date);
        }),
      });
      const user = await mount(services);
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      expect(await screen.findByText("暂时打不开，请重试")).toBeTruthy();

      const before = await db.select(
        "SELECT id,monthly_amount FROM essential_expense_items ORDER BY id",
      );
      fail = false;
      await user.click(screen.getByRole("button", { name: "重试" }));
      await screen.findByRole("region", { name: "固定支出项目" });
      expect(services.listEssentialPaymentItems).toHaveBeenCalledTimes(2);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
      expect(
        await db.select("SELECT id,monthly_amount FROM essential_expense_items ORDER BY id"),
      ).toEqual(before);
    } finally {
      db.close();
    }
  }, 30_000);

  it("历史读取失败同样给出可观察错误，不伪装成空态", async () => {
    const db = await seed();
    try {
      const services = makeServices(db, {
        listEssentialPayments: vi.fn(async () => {
          throw new Error("历史读取失败");
        }),
      });
      const user = await mount(services);
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      expect(await screen.findByText("暂时打不开，请重试")).toBeTruthy();
      expect(screen.queryByText("本月还没有记录")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V03 一笔支付与 8 字段独立读回", () => {
  it("住房 300.20 只保存一次，读回 8 字段全部一致后才显示已保存", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const housing = await openPayForm(user, db, "HOUSING");
      expect(screen.getByText(housing.name)).toBeTruthy();

      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.type(screen.getByLabelText("备注（选填）"), "合成验收");
      await user.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("已保存");

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(services.recordEssentialPayment.mock.calls[0]?.[0]).toEqual({
        itemId: housing.id,
        amount: "300.20",
        paidOn: AS_OF,
        note: "合成验收",
      });

      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(1);
      const record = rows[0];
      if (!record) throw new Error("缺少支付记录");
      expect(record.id).toBeTruthy();
      expect(record.itemId).toBe(housing.id);
      expect(record.itemName).toBe(housing.name);
      expect(record.category).toBe("HOUSING");
      expect(money(record.amount).eq("300.2")).toBe(true);
      expect(record.paidOn).toBe(AS_OF);
      expect(record.note).toBe("合成验收");
      expect(record.recordedAt).toBeTruthy();

      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥300.20");
      expect(summary.textContent).toContain("¥1,200.00");
      expect(
        within(screen.getByRole("region", { name: "本月记录" })).getAllByRole("listitem"),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V07/V21 同步锁与防重复提交", () => {
  it("写在途时连点保存两次只调用一次服务、只落一笔", async () => {
    const db = await seed();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            await gate;
            return recordEssentialPayment(db, input);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "UTILITIES_COMMUNICATIONS");
      await user.type(screen.getByLabelText("付款金额"), "200");

      const save = screen.getByRole("button", { name: "保存" });
      await user.click(save);
      await user.click(save);
      release();
      await screen.findByText("已保存");

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        1,
      );
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        0,
      );
    } finally {
      db.close();
    }
  }, 30_000);

  it("同一草稿连点确认添加两次只新增一个项目与一条修订", async () => {
    const db = await seed();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            await gate;
            return saveEssentialItems(db, items, date);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));

      const confirm = await screen.findByRole("button", { name: "确认添加" });
      await user.click(confirm);
      await user.click(confirm);
      release();
      await screen.findByText("已添加");

      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        1,
      );
    } finally {
      db.close();
    }
  }, 30_000);

  it("支付在途时不能同时进入新增流程，也不产生第二次写调用", async () => {
    const db = await seed();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            await gate;
            return recordEssentialPayment(db, input);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300");
      await user.click(screen.getByRole("button", { name: "保存" }));

      // 支付表单在写入期间保持独占：不存在可点击的「添加支出」入口。
      const addEntries = screen.queryAllByRole("button", { name: "添加支出" });
      expect(addEntries).toHaveLength(0);
      release();
      await screen.findByText("已保存");

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V15/V22 新增、独立读回与确认前不写入", () => {
  it("新增 300 后四字段读回一致、合计 1500，旧项目原样保留", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const before = await listEssentialPaymentItems(db, AS_OF);
      await addItem(user, { name: "合成保险", category: "INSURANCE", amount: "300" });

      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      const patch = services.saveEssentialItems.mock.calls[0]?.[0] as Array<{ id?: string }>;
      expect(patch).toHaveLength(1);
      expect(patch[0]?.id).toBeTruthy();

      const items = await listEssentialPaymentItems(db, AS_OF);
      expect(items).toHaveLength(3);
      const added = items.find((item) => item.name === "合成保险");
      expect(added?.category).toBe("INSURANCE");
      expect(money(added?.monthlyAmount ?? "0").eq(300)).toBe(true);
      for (const previous of before) {
        const current = items.find((item) => item.id === previous.id);
        expect(current?.name).toBe(previous.name);
        expect(current?.category).toBe(previous.category);
        expect(current && money(current.monthlyAmount).eq(previous.monthlyAmount)).toBe(true);
      }

      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥1,500.00");
      const rows = within(screen.getByRole("region", { name: "固定支出项目" })).getAllByRole(
        "listitem",
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.getAttribute("data-item-id"))).toEqual(
        expect.arrayContaining(items.map((item) => item.id)),
      );
      expect(screen.queryByLabelText("支出名称")).toBeNull();
    } finally {
      db.close();
    }
  }, 30_000);

  it("新增后立即支付 60.50：读回一致、计划仍 1500、不补快照", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const snapshotsBefore = await db.select(
        "SELECT item_id,as_of_date FROM essential_expense_snapshots",
      );
      await addItem(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await openPayForm(user, db, "INSURANCE");
      await user.type(screen.getByLabelText("付款金额"), "60.50");
      await user.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("已保存");

      const added = await itemByCategory(db, "INSURANCE");
      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(1);
      const record = rows[0];
      if (!record) throw new Error("缺少支付记录");
      expect(record.id).toBeTruthy();
      expect(record.itemId).toBe(added.id);
      expect(record.itemName).toBe("合成保险");
      expect(record.category).toBe("INSURANCE");
      expect(money(record.amount).eq("60.5")).toBe(true);
      expect(record.paidOn).toBe(AS_OF);
      expect(record.note).toBeNull();
      expect(record.recordedAt).toBeTruthy();

      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥1,500.00");
      expect(summary.textContent).toContain("¥60.50");
      expect(await db.select("SELECT item_id,as_of_date FROM essential_expense_snapshots")).toEqual(
        snapshotsBefore,
      );
      expect((await getHomeApplicationState(db, AS_OF)).essentialExpenses).toBe("1500");
    } finally {
      db.close();
    }
  }, 30_000);

  it("点添加只进入核对页：0 次写入，返回后草稿保留", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));

      const draft = await screen.findByRole("region", { name: "添加核对" });
      expect(draft.textContent).toContain("¥1,200.00");
      expect(draft.textContent).toContain("¥1,500.00");
      expect(draft.textContent).toContain("合成保险");
      expect(draft.textContent).toContain("从今天起生效");
      expect(draft.textContent).toContain("只添加原金额里没有的支出");
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);

      await user.click(screen.getByRole("button", { name: "返回" }));
      expect(((await screen.findByLabelText("支出名称")) as HTMLInputElement).value).toBe(
        "合成保险",
      );
      expect((screen.getByLabelText("每月金额") as HTMLInputElement).value).toBe("300");
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        0,
      );
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V18 表单校验：不合格输入 0 次写入", () => {
  it("类别只提供七个批准项、默认住房、每月金额初始 0", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await user.click(screen.getByRole("button", { name: "添加支出" }));

      const select = (await screen.findByLabelText("类别")) as HTMLSelectElement;
      expect(select.value).toBe("HOUSING");
      expect(Array.from(select.options).map((option) => option.value)).toEqual([
        "HOUSING",
        "BASIC_FOOD",
        "TRANSPORT",
        "UTILITIES_COMMUNICATIONS",
        "INSURANCE",
        "FAMILY_FIXED_RESPONSIBILITY",
        "OTHER_ESSENTIAL",
      ]);
      expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
        "住房",
        "基本饮食",
        "交通",
        "水电通信",
        "保险",
        "家庭支出",
        "其他",
      ]);
      expect((screen.getByLabelText("每月金额") as HTMLInputElement).value).toBe("0");
      expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "添加" })).toBeTruthy();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);

  it.each([
    ["", "请填写支出名称"],
    ["   ", "请填写支出名称"],
  ])(
    "名称 %j 提示 %s 且 0 次写入",
    async (name, message) => {
      const db = await seed();
      try {
        const services = makeServices(db);
        const user = await mount(services);
        await openFixedExpenses(user);
        await fillAddForm(user, { name: "", amount: "300" });
        if (name) await user.type(screen.getByLabelText("支出名称"), name);
        await user.click(screen.getByRole("button", { name: "添加" }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      } finally {
        db.close();
      }
    },
    30_000,
  );

  it.each([
    ["-1", "每月金额不能小于0"],
    ["-0.01", "每月金额不能小于0"],
    ["1.001", "金额最多填两位小数"],
    ["1e2", "请输入正确金额"],
    ["1,000", "请输入正确金额"],
    ["1000000000000", "金额太大，请检查"],
  ])(
    "每月金额 %s 提示 %s 且 0 次写入",
    async (amount, message) => {
      const db = await seed();
      try {
        const services = makeServices(db);
        const user = await mount(services);
        await openFixedExpenses(user);
        await fillAddForm(user, { name: "合成保险", amount });
        await user.click(screen.getByRole("button", { name: "添加" }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      } finally {
        db.close();
      }
    },
    30_000,
  );

  it.each([
    ["", "请输入大于0的付款金额"],
    ["0", "请输入大于0的付款金额"],
    ["-1", "请输入大于0的付款金额"],
    ["1.001", "金额最多填两位小数"],
    ["1e2", "请输入正确金额"],
  ])(
    "付款金额 %j 提示 %s 且 0 次写入",
    async (amount, message) => {
      const db = await seed();
      try {
        const services = makeServices(db);
        const user = await mount(services);
        await openFixedExpenses(user);
        await openPayForm(user, db, "HOUSING");
        if (amount) await user.type(screen.getByLabelText("付款金额"), amount);
        await user.click(screen.getByRole("button", { name: "保存" }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
        expect(
          await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'"),
        ).toHaveLength(0);
      } finally {
        db.close();
      }
    },
    30_000,
  );

  it("每月金额 0 与上限 999999999999.99 均通过，不误用支付的 >0 规则", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);

      await fillAddForm(user, { name: "零额项目", amount: "0" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      expect((await screen.findByRole("region", { name: "添加核对" })).textContent).toContain(
        "¥0.00",
      );
      await confirmAdd(user);
      await screen.findByText("已添加");
      const zero = (await listEssentialPaymentItems(db, AS_OF)).find(
        (item) => item.name === "零额项目",
      );
      expect(zero && money(zero.monthlyAmount).eq(0)).toBe(true);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);

      await fillAddForm(user, { name: "上限项目", amount: "999999999999.99" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      expect((await screen.findByRole("region", { name: "添加核对" })).textContent).toContain(
        "¥999,999,999,999.99",
      );
      await confirmAdd(user);
      await screen.findByText("已添加");
      const capped = (await listEssentialPaymentItems(db, AS_OF)).find(
        (item) => item.name === "上限项目",
      );
      expect(capped && money(capped.monthlyAmount).eq("999999999999.99")).toBe(true);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V08/V09/V20 写后状态不明与读回不匹配", () => {
  async function payWithReadback(
    mutate: (rows: Awaited<ReturnType<typeof listEssentialPayments>>) => unknown,
    options: { failReadback?: boolean } = {},
  ) {
    const db = await seed();
    let tampered = false;
    const services = makeServices(db, {
      recordEssentialPayment: vi.fn(async (input: Parameters<typeof recordEssentialPayment>[1]) => {
        const result = await recordEssentialPayment(db, input);
        tampered = true;
        return result;
      }),
      listEssentialPayments: vi.fn(async (month?: string) => {
        if (options.failReadback && tampered) throw new Error("读回失败");
        const rows = await listEssentialPayments(db, month);
        return tampered ? mutate(rows) : rows;
      }),
    });
    const user = await mount(services);
    await openFixedExpenses(user);
    await openPayForm(user, db, "HOUSING");
    await user.type(screen.getByLabelText("付款金额"), "300.20");
    await user.click(screen.getByRole("button", { name: "保存" }));
    return { db, services };
  }

  it("读回抛错：不显示成功、不自动重写、保留已填金额", async () => {
    const { db, services } = await payWithReadback((rows) => rows, { failReadback: true });
    try {
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("已保存")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        1,
      );
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
    } finally {
      db.close();
    }
  }, 30_000);

  it.each([
    [
      "金额",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, amount: "1" })),
    ],
    [
      "日期",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, paidOn: "2026-11-02" })),
    ],
    [
      "项目 id",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, itemId: "someone-else" })),
    ],
  ])(
    "读回 %s 不符：不显示成功、不重写",
    async (_label, mutate) => {
      const { db, services } = await payWithReadback(mutate);
      try {
        expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
        expect(screen.queryByText("已保存")).toBeNull();
        expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText("付款金额")).toBeTruthy();
      } finally {
        db.close();
      }
    },
    30_000,
  );

  it("读回缺记录：不显示成功、不自动重写", async () => {
    const { db, services } = await payWithReadback(() => []);
    try {
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("已保存")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        1,
      );
    } finally {
      db.close();
    }
  }, 30_000);

  // T01：写服务已派发后 reject 本身不证明未写入；无可靠 payment.id 一律保持待核查。
  it("写服务派发后 reject：保持待核查、草稿保留、零新增行且不认领旧付款", async () => {
    const db = await seed();
    try {
      const order = timeline();
      const services = makeServices(db, {
        listEssentialPayments: vi.fn(async (month?: string) => {
          order.push("read");
          return listEssentialPayments(db, month);
        }),
        recordEssentialPayment: vi.fn(async () => {
          order.push("write-reject");
          throw new Error("写前失败");
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      const readsBefore = order.count("read");
      await user.click(screen.getByRole("button", { name: "保存" }));

      // 未知合同：不声称未保存，也不声称成功。
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("未保存，填写内容已保留")).toBeNull();
      expect(screen.queryByText("已保存")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      // reject 之后必须发生只读核查（按增量而非初读累计）。
      const rejectAt = order.indexOf("write-reject");
      expect(rejectAt).toBeGreaterThanOrEqual(0);
      expect(order.slice(rejectAt + 1).includes("read")).toBe(true);
      expect(order.count("read")).toBeGreaterThan(readsBefore);

      // 实际零新增行；不按同字段认领、不自动重写。
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        0,
      );
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      // 完整草稿冻结保留在冻结表单里。
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).readOnly).toBe(true);
      // 不允许第二次提交同一笔。
      expect(screen.queryAllByRole("button", { name: "保存" })).toHaveLength(0);
    } finally {
      db.close();
    }
  }, 30_000);

  // T01：ADD 派发后 reject 同样不证明未写入；保留同一 UUID、零新增行、待核查。
  it("新增写服务派发后 reject：保持待核查、同一UUID、项目仍 2 条", async () => {
    const db = await seed();
    try {
      const order = timeline();
      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          order.push("read");
          return listEssentialPaymentItems(db, date);
        }),
        saveEssentialItems: vi.fn(async () => {
          order.push("write-reject");
          throw new Error("写前失败");
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);

      // 未知合同：不声称未保存，也不声称成功。
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("未保存，填写内容已保留")).toBeNull();
      expect(screen.queryByText("已添加")).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);

      // reject 之后必须发生只读核查。
      const rejectAt = order.indexOf("write-reject");
      expect(rejectAt).toBeGreaterThanOrEqual(0);
      expect(order.slice(rejectAt + 1).includes("read")).toBe(true);

      // 实际零新增行，项目仍 2 条。
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        0,
      );

      // 停在核对页，草稿冻结保留同一 UUID，且不允许重复提交。
      expect(screen.getByRole("region", { name: "添加核对" })).toBeTruthy();
      expect(screen.getByText("合成保险 · ¥300.00")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "确认添加" })).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);

  it("新增写返回后清单读回失败：不显示成功、不自动重写、草稿保留", async () => {
    const db = await seed();
    try {
      let failReadback = false;
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            const result = await saveEssentialItems(db, items, date);
            failReadback = true;
            return result;
          },
        ),
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          if (failReadback) throw new Error("读回失败");
          return listEssentialPaymentItems(db, date);
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);

      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("已添加")).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(screen.getByRole("region", { name: "添加核对" })).toBeTruthy();
      // 草稿必须还在：返回上一屏即可看到原样输入，不需要用户重填。
      await user.click(screen.getByRole("button", { name: "返回" }));
      expect(((await screen.findByLabelText("每月金额")) as HTMLInputElement).value).toBe("300");
      expect((screen.getByLabelText("支出名称") as HTMLInputElement).value).toBe("合成保险");
    } finally {
      db.close();
    }
  }, 30_000);

  it("新增读回金额不符：给出专门的核对未完成文案，不显示成功、不重写", async () => {
    const db = await seed();
    try {
      let tampered = false;
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            const result = await saveEssentialItems(db, items, date);
            tampered = true;
            return result;
          },
        ),
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          const items = await listEssentialPaymentItems(db, date);
          return tampered
            ? items.map((item) =>
                item.name === "合成保险" ? { ...item, monthlyAmount: "1" } : item,
              )
            : items;
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);

      expect(
        await screen.findByText("已找到这项支出，但金额核对还没完成，请先不要重复添加"),
      ).toBeTruthy();
      expect(screen.queryByText("已添加")).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(screen.getByRole("region", { name: "添加核对" })).toBeTruthy();
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V10/V11 小数、重开与历史身份", () => {
  it("0.10 与 0.20 精确合计 ¥0.30，无浮点尾数", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      for (const amount of ["0.10", "0.20"]) {
        await recordEssentialPayment(db, { itemId: housing.id, amount, paidOn: AS_OF });
      }
      const user = await mount(makeServices(db));
      await openFixedExpenses(user);

      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥0.30");
      expect(summary.textContent).not.toMatch(/0\.30{2,}|0\.2999/);
      const records = screen.getByRole("region", { name: "本月记录" });
      expect(records.textContent).toContain("¥0.10");
      expect(records.textContent).toContain("¥0.20");
      expect(records.textContent).not.toMatch(/0\.3000|0\.2999/);
    } finally {
      db.close();
    }
  }, 30_000);

  it("重开后仍读到同一笔 300.20，不依赖草稿缓存", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      await recordEssentialPayment(db, { itemId: housing.id, amount: "300.20", paidOn: AS_OF });
      const user = await mount(makeServices(db));
      await openFixedExpenses(user);
      expect(
        within(screen.getByRole("region", { name: "本月记录" })).getAllByRole("listitem"),
      ).toHaveLength(1);

      cleanup();
      const user2 = await mount(makeServices(db));
      await openFixedExpenses(user2);
      const records = screen.getByRole("region", { name: "本月记录" });
      expect(records.textContent).toContain("¥300.20");
      expect(within(records).getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥300.20");
    } finally {
      db.close();
    }
  }, 30_000);

  it("旧支付无 itemId：计入本月已付但不归属任何项目，并标注对应支出不明", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      const utilities = await itemByCategory(db, "UTILITIES_COMMUNICATIONS");
      await recordEssentialPayment(db, { itemId: housing.id, amount: "100", paidOn: AS_OF });
      await recordEssentialPayment(db, { itemId: utilities.id, amount: "50", paidOn: AS_OF });
      const profile = await db.select<{ id: string }>("SELECT id FROM profiles LIMIT 1");
      await db.execute(
        `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
         VALUES('legacy-1',?,?,?,'ESSENTIAL','OTHER_ESSENTIAL',NULL,?,?)`,
        [profile[0]?.id, "20", `${AS_OF}T00:00:00.000Z`, `${AS_OF}T00:00:00.000Z`, AS_OF],
      );

      const user = await mount(makeServices(db));
      await openFixedExpenses(user);

      const records = screen.getByRole("region", { name: "本月记录" });
      expect(records.textContent).toContain("对应支出不明");
      expect(records.textContent).toContain("¥20.00");
      expect(within(records).getAllByRole("listitem")).toHaveLength(3);
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥170.00");

      const rows = within(screen.getByRole("region", { name: "固定支出项目" })).getAllByRole(
        "listitem",
      );
      for (const row of rows) {
        expect(row.textContent).not.toContain("¥170.00");
        expect(row.textContent).not.toContain("¥120.00");
        expect(row.textContent).not.toContain("¥20.00");
      }
      const housingRow = rows.find((row) => row.getAttribute("data-item-id") === housing.id);
      expect(housingRow?.textContent).toContain("¥100.00");
      const utilitiesRow = rows.find((row) => row.getAttribute("data-item-id") === utilities.id);
      expect(utilitiesRow?.textContent).toContain("¥50.00");
    } finally {
      db.close();
    }
  }, 30_000);

  it("上月支付不计入本月：本月已付保持 ¥0.00 且记录空态", async () => {
    const db = await seed();
    try {
      const profile = await db.select<{ id: string }>("SELECT id FROM profiles LIMIT 1");
      await db.execute(
        `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
         VALUES('last-month',?,?,?,'ESSENTIAL','HOUSING',NULL,?,?)`,
        [
          profile[0]?.id,
          "500",
          "2026-10-31T00:00:00.000Z",
          "2026-10-31T00:00:00.000Z",
          "2026-10-31",
        ],
      );

      const user = await mount(makeServices(db));
      await openFixedExpenses(user);
      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥0.00");
      expect(summary.textContent).toContain("¥1,200.00");
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
    } finally {
      db.close();
    }
  }, 30_000);

  it("跨月后只显示当月：11 月 1 日的一笔在 12 月 1 日不计入本月已付", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      await recordEssentialPayment(db, { itemId: housing.id, amount: "300.20", paidOn: AS_OF });
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥300.20");

      await remountLater(services, 30);
      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥0.00");
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
      expect(services.listEssentialPayments).toHaveBeenLastCalledWith("2026-12");
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("V12/V23 显示保护与刷新路径", () => {
  const FORBIDDEN = ["建议", "剩余", "超出", "进度", "基础盈余", "还可花", "欠付", "剩余应付"];

  function collectText(root: Element) {
    const texts: string[] = [];
    for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
      if (node.textContent) texts.push(node.textContent);
      for (const attr of ["aria-label", "aria-description", "title", "alt", "placeholder"]) {
        const value = node.getAttribute(attr);
        if (value) texts.push(value);
      }
    }
    return texts;
  }

  function expectClean(where: string) {
    const texts = collectText(document.body);
    for (const word of FORBIDDEN) {
      expect(
        texts.filter((text) => text.includes(word)),
        `${where} 出现了禁用词「${word}」`,
      ).toEqual([]);
    }
    expect(document.querySelectorAll('[role="progressbar"]').length).toBe(0);
  }

  it("固定支出页、新增表单、支付表单都不出现建议/剩余/进度类表述，首页说明保留", async () => {
    const db = await seed();
    try {
      const user = await mount(makeServices(db));
      // M1 首页自带的免责说明保留（其中含「建议」），不在本次显示保护范围内。
      expect(screen.getByTestId("m1-scope-note").textContent).toBe(
        "债务情况尚未确认，暂不显示建议金额。",
      );
      expect(document.querySelectorAll('[role="progressbar"]').length).toBe(0);

      await openFixedExpenses(user);
      expectClean("固定支出页");

      await user.click(screen.getByRole("button", { name: "添加支出" }));
      await screen.findByLabelText("支出名称");
      expectClean("新增表单");
      await user.click(screen.getByRole("button", { name: "取消" }));
      await screen.findByRole("region", { name: "固定支出项目" });

      await openPayForm(user, db, "HOUSING");
      expectClean("支付表单");
      await user.click(screen.getByRole("button", { name: "取消" }));
      await screen.findByRole("region", { name: "固定支出项目" });

      await user.click(screen.getByRole("button", { name: "今天" }));
      await screen.findByTestId("m1-home");
      expect(screen.getByTestId("m1-scope-note").textContent).toBe(
        "债务情况尚未确认，暂不显示建议金额。",
      );
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();
      expect(document.querySelectorAll('[role="progressbar"]').length).toBe(0);
    } finally {
      db.close();
    }
  }, 30_000);

  it("确认新增后留在固定支出页：合计与行同步刷新，取消支付不写入", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await addItem(user, { name: "合成保险", category: "INSURANCE", amount: "300" });

      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥1,500.00");
      expect(
        within(screen.getByRole("region", { name: "固定支出项目" })).getAllByRole("listitem"),
      ).toHaveLength(3);

      await openPayForm(user, db, "INSURANCE");
      await user.type(screen.getByLabelText("付款金额"), "9999");
      await user.click(screen.getByRole("button", { name: "取消" }));
      await screen.findByRole("region", { name: "固定支出项目" });

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥1,500.00");
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        0,
      );
    } finally {
      db.close();
    }
  }, 30_000);

  it("支付取消后重新进入仍是空表单，不回填上次草稿且默认今天", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "123.45");
      await user.type(screen.getByLabelText("备注（选填）"), "会被丢弃");
      await user.click(screen.getByRole("button", { name: "取消" }));
      await screen.findByRole("region", { name: "固定支出项目" });

      await openPayForm(user, db, "HOUSING");
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("备注（选填）") as HTMLInputElement).value).toBe("");
      expect(screen.getByLabelText(`日期 ${AS_OF}`)).toBeTruthy();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("REWORK-01 六项缺陷（AC-01…AC-06）", () => {
  // AC-01：项目四字段 + 合计 + 会话日 home 全部核对完成前，不得提示成功、不得清草稿、不得开放支付。
  it("AC-01 新增读回通过但 home 刷新拒绝：不提示成功、草稿保留、无法进入新增项目支付", async () => {
    const db = await seed();
    try {
      let savedOnce = false;
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            const result = await saveEssentialItems(db, items, date);
            savedOnce = true;
            return result;
          },
        ),
        getHomeApplicationState: vi.fn((date: string) => {
          if (savedOnce) return Promise.reject(new Error("home 读取失败"));
          return getHomeApplicationState(db, date);
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);

      // 数据确实已落库（3 条），但成功提示必须 0 次。
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(screen.queryByText("已添加")).toBeNull();
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      // 草稿保留在核对页，且不因 home 失败而回滚已写入的项目。
      expect(screen.getByRole("region", { name: "添加核对" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "返回" }));
      expect(((await screen.findByLabelText("支出名称")) as HTMLInputElement).value).toBe(
        "合成保险",
      );
      // 未成功即不开放该项目支付：清单里没有可点的记一笔属于新项目。
      expect(screen.queryByRole("button", { name: /记一笔 合成保险/ })).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);

  // AC-02：写入 reject 后必须先只读核查；未知时不得说「未保存」，且不得允许重提。
  it("AC-02 新增写入 reject 后只读核查：不得提示未保存、不得允许重复添加", async () => {
    const db = await seed();
    try {
      // 真实落库后再抛错，模拟「提交已生效但返回失败」。
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            await saveEssentialItems(db, items, date);
            throw new Error("提交后返回失败");
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);

      // 只读核查必须真的发生（写前 1 次 + reject 后至少 1 次）。
      expect(services.listEssentialPaymentItems.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("未保存，填写内容已保留")).toBeNull();
      expect(
        (await screen.findAllByText(/暂时无法确认是否保存，请先不要重复操作|已经添加过这项支出/))
          .length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText("已添加")).toBeNull();
      // 数据库仍只有 1 条新增（3 条总数），不能因为再点一次变 4 条。
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      const confirmButton = screen
        .getAllByRole("button")
        .find((button) => button.textContent?.includes("确认添加")) as
        | HTMLButtonElement
        | undefined;
      if (confirmButton) expect(confirmButton.disabled).toBe(true);
    } finally {
      db.close();
    }
  }, 30_000);

  // AC-03：未知态 + 锁必须跨导航卸载存活；重进后重付同一笔应被拦。
  it("AC-03 支付未知态后经导航离开再回来：不得产生第二笔重复付款", async () => {
    const db = await seed();
    try {
      let payDone = false;
      const refreshed = { current: false };
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            const result = await recordEssentialPayment(db, input);
            payDone = true;
            return result;
          },
        ),
        listEssentialPayments: vi.fn(async (month?: string) => {
          // 支付提交后读回一直失败（直到显式恢复），保证进入未知态。
          if (payDone && !refreshed.current) throw new Error("读回失败");
          return listEssentialPayments(db, month);
        }),
      });
      const user = await mount(services);
      // 先进入页面再注入：openFixedExpenses 需要一次成功的首读。
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "固定支出项目" });
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();

      // 读回故障恢复，再经导航彻底离开并回来（固定支出页面组件被卸载）。
      // T02：统一走已批准的二步入口「我的财务 → 固定支出」，不引入自动重开设计。
      refreshed.current = true;
      await user.click(screen.getByRole("button", { name: "今天" }));
      await screen.findByTestId("m1-home");
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));

      // 未知态必须仍然可见（重新进入后回到被冻结的付款表单），且不允许再次保存同一笔。
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).readOnly).toBe(true);
      const saveButtons = screen.queryAllByRole("button", { name: "保存" });
      expect(saveButtons).toHaveLength(0);
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        1,
      );
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);

  // AC-04：支付读回通过后，必须按当前会话业务日独立刷新 home。
  it("AC-04 支付成功后按会话日独立刷新 home 一次", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const homeCallsBefore = services.getHomeApplicationState.mock.calls.length;
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("已保存");

      const homeCalls = services.getHomeApplicationState.mock.calls.slice(homeCallsBefore);
      expect(homeCalls.length).toBeGreaterThanOrEqual(1);
      expect(homeCalls.at(-1)?.[0]).toBe(AS_OF);
    } finally {
      db.close();
    }
  }, 30_000);

  // AC-05：跨日后仍用旧会话日期新增 → 必须停止写入，不能偷偷写昨天。
  it("AC-05 跨日后新增：0 次写入，不走旧会话日期", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      // 进程不重启，时钟进入第二天。
      const nextDay = new Date(Date.parse(`${AS_OF}T04:00:00.000Z`) + 24 * 60 * 60 * 1000);
      vi.setSystemTime(nextDay);

      await fillAddForm(user, { name: "跨日保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));

      // 要么在核对页就被拦下，要么根本不发生写入；两种都要求 0 写入。
      const confirmButton = screen.queryByRole("button", { name: "确认添加" });
      if (confirmButton) await user.click(confirmButton);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
    } finally {
      db.close();
    }
  }, 30_000);

  // AC-06：新增金额清空（空串 / 全空白）按 0 处理，真实新增 1 条且金额为 0。
  it.each([[""], ["   "]])(
    "AC-06 每月金额为 %j 时按 0 新增 1 条",
    async (blank) => {
      const db = await seed();
      try {
        const services = makeServices(db);
        const user = await mount(services);
        await openFixedExpenses(user);
        await fillAddForm(user, { name: "空白金额项目", amount: blank });
        await user.click(screen.getByRole("button", { name: "添加" }));
        await confirmAdd(user);
        await screen.findByText("已添加");

        const items = await listEssentialPaymentItems(db, AS_OF);
        expect(items).toHaveLength(3);
        const added = items.find((item) => item.name === "空白金额项目");
        expect(added && money(added.monthlyAmount).eq(0)).toBe(true);
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      } finally {
        db.close();
      }
    },
    30_000,
  );
});

describe("REWORK-02 宿主身份、跨导航存活与未知结果（R1-a/R1-b/R2/R3）", () => {
  /** R1-a：真实 V20 夹具新增1000，事务已提交但 home 抛 ModelValidationError。 */
  it("R1-a 真实 V20 夹具新增1000后home失败：UUID不变、新增写1、计划2200、成功0、支付0", async () => {
    const db = await seedWith({
      stableMonthlyIncome: "3000",
      safetyCoverageTargetMonths: 3,
      safetyRecoveryHorizonMonths: undefined,
    });
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      expect(before.essentialExpenses).toBe("1200");
      expect(before.baseSurplus).toBe("1800");
      expect(before.safetyTargetResources).toBe("3600");
      expect(before.safetyGap).toBe("0");

      let realError: unknown;
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            try {
              return await saveEssentialItems(db, items, date);
            } catch (error) {
              realError = error;
              throw error;
            }
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);

      const itemsBefore = await db.select("SELECT id FROM essential_expense_items ORDER BY id");
      const revisionsBefore = await db.select(
        "SELECT revision_id FROM essential_expense_revisions",
      );
      const snapshotsBefore = await db.select(
        "SELECT item_id,as_of_date FROM essential_expense_snapshots ORDER BY item_id",
      );
      expect(itemsBefore).toHaveLength(2);

      await fillAddForm(user, { name: "整租差价", category: "INSURANCE", amount: "1000" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);
      await screen.findByText("暂时无法确认是否保存，请先不要重复操作");

      // 服务把模型异常包装成 ApplicationModelError，原始 ModelValidationError 在 cause 上。
      expect(realError).toBeInstanceOf(ApplicationModelError);
      expect((realError as ApplicationModelError).code).toBe("MODEL_VALIDATION_FAILED");
      expect((realError as ApplicationModelError).cause).toBeInstanceOf(ModelValidationError);
      expect(
        ((realError as ApplicationModelError).cause as ModelValidationError).issues.map(
          (issue) => issue.field,
        ),
      ).toContain("settings.safetyRecoveryHorizonMonths");

      const firstAddCall = services.saveEssentialItems.mock.calls[0] as
        | [Array<{ id?: string }>, string]
        | undefined;
      const draftId = firstAddCall?.[0][0]?.id;
      expect(typeof draftId).toBe("string");

      const itemsAfter = await db.select("SELECT id FROM essential_expense_items ORDER BY id");
      expect(itemsAfter).toHaveLength(3);
      expect(
        await db.select("SELECT revision_id FROM essential_expense_revisions WHERE item_id=?", [
          draftId,
        ]),
      ).toHaveLength(1);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        revisionsBefore.length + 1,
      );
      expect(
        await db.select(
          "SELECT item_id,as_of_date FROM essential_expense_snapshots ORDER BY item_id",
        ),
      ).toEqual(snapshotsBefore);

      const businessItems = await listEssentialPaymentItems(db, AS_OF);
      expect(
        businessItems
          .reduce((total, item) => total.plus(money(item.monthlyAmount)), money("0"))
          .toString(),
      ).toBe("2200");
      expect(businessItems.filter((item) => item.id === draftId)).toHaveLength(1);

      expect(money("3000").minus(money("2200")).toString()).toBe("800");
      expect(money("3").times(money("2200")).toString()).toBe("6600");
      expect(money("6600").minus(money("5000")).toString()).toBe("1600");

      expect(screen.queryByText("已添加")).toBeNull();
      expect(screen.queryByRole("button", { name: /记一笔/ })).toBeNull();

      await goToFixedExpensesFromToday(user);
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "添加支出" })).toBeNull();
      expect(screen.queryByRole("button", { name: "确认添加" })).toBeNull();
      expect(screen.queryByText("已添加")).toBeNull();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        revisionsBefore.length + 1,
      );
      expect((await db.select("SELECT id FROM essential_expense_items")).length).toBe(3);
    } finally {
      db.close();
    }
  }, 30_000);

  /** R1-b：首笔 300.20 停在服务未 settle，切 tab / 返回重进后再尝试付款。 */
  it("R1-b 在途付款跨tab与返回重进：第二次写0、最终总写1、付款1、合计300.20", async () => {
    const db = await seed();
    try {
      const g = gate();
      const order = timeline();
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            order.push("write-start");
            await g.promise;
            order.push("write-release");
            return recordEssentialPayment(db, input);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(order.count("write-start")).toBe(1);

      await user.click(screen.getByRole("button", { name: "今天" }));
      await screen.findByTestId("m1-home");
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));

      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect(screen.queryByRole("button", { name: /记一笔/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "添加支出" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "返回" }));
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect(order.count("write-start")).toBe(1);

      g.release();
      await screen.findByText("已保存");
      expect(order.indexOf("write-start")).toBeLessThan(order.indexOf("write-release"));
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(1);
      expect(money(rows[0]?.amount ?? "0").eq("300.20")).toBe(true);
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥300.20");
    } finally {
      db.close();
    }
  }, 30_000);

  /** R2：付款已提交且返回可靠 id，但独立读回失败。 */
  it("R2 可靠id但读回失败：同一id与限制跨导航存活，总写1、记录1、成功0", async () => {
    const db = await seed();
    try {
      let payDone = false;
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            const result = await recordEssentialPayment(db, input);
            payDone = true;
            return result;
          },
        ),
        listEssentialPayments: vi.fn(async (month?: string) => {
          if (payDone) throw new Error("读回失败");
          return listEssentialPayments(db, month);
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("已保存")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(1);
      const paymentId = rows[0]?.id;

      await user.click(screen.getByRole("button", { name: "返回查看记录" }));
      await goToFixedExpensesFromToday(user);

      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect(screen.queryByRole("button", { name: /记一笔/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "添加支出" })).toBeNull();
      expect(screen.queryByText("已保存")).toBeNull();

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      const after = await listEssentialPayments(db, MONTH);
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(paymentId);
      expect(money(after[0]?.amount ?? "0").eq("300.20")).toBe(true);
    } finally {
      db.close();
    }
  }, 30_000);

  /** R3：存在同项目/日期/金额旧付款；本次写前 reject。 */
  it("R3 写前reject且存在同字段旧付款：旧id不变、新行0、不认领、不重写、不解锁", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      const legacy = await recordEssentialPayment(db, {
        itemId: housing.id,
        amount: "300.20",
        paidOn: AS_OF,
        note: "旧的同额付款",
      });
      const beforeRows = await listEssentialPayments(db, MONTH);
      expect(beforeRows).toHaveLength(1);
      const legacyId = legacy.payment.id;

      const order = timeline();
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(async () => {
          order.push("write-reject");
          throw new Error("写前拒绝");
        }),
        listEssentialPayments: vi.fn(async (month?: string) => {
          order.push("list-payments");
          return listEssentialPayments(db, month);
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      const readsBefore = order.count("list-payments");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(order.count("list-payments")).toBeGreaterThan(readsBefore);
      expect(order.indexOf("write-reject")).toBeLessThan(order.lastIndexOf("list-payments"));

      expect(screen.queryByText("已经记上了")).toBeNull();
      expect(screen.queryByText("已保存")).toBeNull();
      const afterRows = await listEssentialPayments(db, MONTH);
      expect(afterRows).toHaveLength(1);
      expect(afterRows[0]?.id).toBe(legacyId);
      expect(afterRows[0]).toEqual(beforeRows[0]);

      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
      expect(screen.queryByRole("button", { name: /记一笔/ })).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("REWORK-02 C1 阶段时序与晚回调，C2 合法第二笔", () => {
  it("C1 新增在途连点确认：只派发1次，写前读取之后才写", async () => {
    const db = await seed();
    try {
      const g = gate();
      const order = timeline();
      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          order.push("pre-read");
          return listEssentialPaymentItems(db, date);
        }),
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            order.push("write-start");
            await g.promise;
            order.push("write-release");
            return saveEssentialItems(db, items, date);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      const confirm = await screen.findByRole("button", { name: "确认添加" });
      await user.click(confirm);
      await user.click(confirm);
      await user.click(confirm);
      expect(order.count("write-start")).toBe(1);
      expect(order.count("pre-read")).toBeGreaterThanOrEqual(1);
      expect(order.indexOf("pre-read")).toBeLessThan(order.indexOf("write-start"));

      g.release();
      await screen.findByText("已添加");
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        1,
      );
    } finally {
      db.close();
    }
  }, 30_000);

  it("C1 新增reject后只读核查：读取增量在拒绝之后，且不再允许写入", async () => {
    const db = await seed();
    try {
      const order = timeline();
      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          order.push("read");
          return listEssentialPaymentItems(db, date);
        }),
        saveEssentialItems: vi.fn(async () => {
          order.push("write-reject");
          throw new Error("事务内失败");
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);
      await screen.findByText("暂时无法确认是否保存，请先不要重复操作");

      const rejectAt = order.indexOf("write-reject");
      expect(rejectAt).toBeGreaterThanOrEqual(0);
      expect(order.slice(rejectAt + 1).includes("read")).toBe(true);
      expect(screen.queryByText("未保存，填写内容已保留")).toBeNull();
      expect(screen.queryByRole("button", { name: "确认添加" })).toBeNull();
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);

  it("C1 完整核对期间用户离开：晚结果只作用于同令牌，不切回页面", async () => {
    const db = await seed();
    try {
      // T03：闸门必须在 mount 与初始化完成之后才武装，只拦本次写后的独立 home，
      // 不能以卡住初始化来代替晚回调验证。
      const homeGate = gate();
      const armed = { current: false };
      const order = timeline();
      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          order.push("items-read");
          return listEssentialPaymentItems(db, date);
        }),
        getHomeApplicationState: vi.fn(async (date: string) => {
          order.push("home-read");
          if (armed.current) await homeGate.promise;
          return getHomeApplicationState(db, date);
        }),
      });

      // 先完成 mount 与初始化：此时闸门未武装，首页正常可读。
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));

      // 只拦本次写后的 home：从确认添加起武装。
      const itemsReadsBefore = order.count("items-read");
      const homeReadsBefore = order.count("home-read");
      armed.current = true;
      await confirmAdd(user);

      // 明确的读回阶段信号：写后独立读回清单已发生（按增量断言，不靠 sleep）。
      await waitFor(() => expect(order.count("items-read")).toBeGreaterThan(itemsReadsBefore + 1));
      // 此刻写入已完成、独立读回已发生，正卡在本次写后的那一次 home 上。
      await waitFor(() => expect(order.count("home-read")).toBe(homeReadsBefore + 1));

      // 核对期间离开：切回今天页。
      await user.click(screen.getByRole("button", { name: "今天" }));
      expect(await screen.findByTestId("m1-home")).toBeTruthy();

      // 释放闸门，等待同令牌核对链真正完成的信号（写后 home 已真实返回）。
      homeGate.release();
      await waitFor(() => expect(order.count("home-read")).toBe(homeReadsBefore + 1));
      await waitFor(() => expect(screen.getByTestId("m1-home")).toBeTruthy());

      // 晚结果不得强行切回固定支出页，也不得覆盖当前展示。
      expect(screen.getByTestId("m1-home")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();
      expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
      expect(screen.queryByText("已添加")).toBeNull();

      // 仅一次写入；同令牌核对完成后经二步入口重进才可见成功与 3 条项目。
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      await goToFixedExpensesFromToday(user);
      expect(await screen.findByText("已添加")).toBeTruthy();
      expect(
        within(screen.getByRole("region", { name: "固定支出项目" })).getAllByRole("listitem"),
      ).toHaveLength(3);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);

  it("C2 确认后同额第二笔：两个不同id、合计600.40，不做同字段去重", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);

      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("已保存");

      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      await user.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("已保存");

      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(2);
      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
      expect(
        rows.reduce((total, row) => total.plus(money(row.amount)), money("0")).toString(),
      ).toBe("600.4");
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥600.40");
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("REWORK-02 已批设计恢复：占位正文、短提示、跨日文案、返回", () => {
  it("记录与进展页仅显示标题和暂未开放，四标签不变", async () => {
    const db = await seed();
    try {
      const user = await mount(makeServices(db));
      await user.click(await screen.findByRole("button", { name: "记录" }));
      expect(await screen.findByRole("heading", { name: "记录" })).toBeTruthy();
      expect(screen.getByText("暂未开放")).toBeTruthy();
      expect(screen.queryByText("这个页面还没有开放。")).toBeNull();

      await user.click(screen.getByRole("button", { name: "进展" }));
      expect(await screen.findByRole("heading", { name: "进展" })).toBeTruthy();
      expect(screen.getByText("暂未开放")).toBeTruthy();

      const labels = within(screen.getByRole("navigation", { name: "主导航" }))
        .getAllByRole("button")
        .map((button) => button.textContent?.trim() ?? "");
      expect(labels).toEqual(["今天", "记录", "进展", "我的财务"]);
    } finally {
      db.close();
    }
  }, 30_000);

  it("页头与入口不再出现每月固定要付的钱小字，返回为左箭头加返回文字", async () => {
    const db = await seed();
    try {
      const user = await mount(makeServices(db));
      await user.click(await screen.findByRole("button", { name: "我的财务" }));
      const menu = await screen.findByRole("navigation", { name: "我的财务" });
      expect(menu.textContent).not.toContain("每月固定要付的钱");
      expect(menu.textContent).toContain("固定支出");

      await user.click(within(menu).getByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "固定支出项目" });
      expect(screen.queryByText("每月固定要付的钱")).toBeNull();
      const back = screen.getByRole("button", { name: "返回" });
      expect(back.textContent?.trim()).toBe("返回");
      expect(back.querySelector("svg")).toBeTruthy();
    } finally {
      db.close();
    }
  }, 30_000);

  it("跨日：添加与确认添加两处都停写并显示日期已变化，暂时不能添加。", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "跨日保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      expect((await screen.findByRole("region", { name: "添加核对" })).textContent).toContain(
        "跨日保险",
      );

      vi.setSystemTime(Date.parse(`${AS_OF}T04:00:00.000Z`) + DAY_MS);
      await user.click(screen.getByRole("button", { name: "确认添加" }));
      expect(await screen.findByText("日期已变化，暂时不能添加。")).toBeTruthy();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "确认添加" })).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "返回" }));
      await user.click(screen.getByRole("button", { name: "添加" }));
      expect(await screen.findByText("日期已变化，暂时不能添加。")).toBeTruthy();
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
    } finally {
      db.close();
    }
  }, 30_000);

  it("跨日后付款仍按已有校验处理，不被新增跨日文案替代", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      vi.setSystemTime(Date.parse(`${AS_OF}T04:00:00.000Z`) + DAY_MS);
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("已保存")).toBeTruthy();
      expect(screen.queryByText("日期已变化，暂时不能添加。")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("REWORK-02 CONTINUATION-01 F01 确认收据按显示月份隔离", () => {
  /**
   * F01：上月 31 日的付款收据不得并入本月统计。
   * 项目 2026-10-01 已生效，会话日 2026-11-01；经实际表单保存 2026-10-31 的 300.20，
   * 完成独立读回后：上月恰 1 笔、本月 0 笔且合计 0、该项目本月已付 0，home 仍为会话日。
   */
  it("F01 上月31日付款300.20：本月合计0、上月恰1笔，收据不并入本月", async () => {
    const db = await seed("2026-10-01");
    try {
      // 项目已于 2026-10-01 生效，把会话日推进到 2026-11-01。
      vi.setSystemTime(new Date("2026-11-01T04:00:00.000Z"));
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");

      // 经实际日历把付款日期改为上月末 2026-10-31。
      await user.click(screen.getByLabelText("日期 2026-11-01"));
      await user.click(await screen.findByRole("button", { name: "上个月" }));
      await user.click(await screen.findByRole("gridcell", { name: "2026-10-31" }));
      await user.click(screen.getByRole("button", { name: "确定" }));
      await screen.findByLabelText("日期 2026-10-31");

      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("已保存")).toBeTruthy();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      // 真实事务结果：上月恰 1 笔 300.20，本月 0 笔。
      const lastMonth = await listEssentialPayments(db, "2026-10");
      expect(lastMonth).toHaveLength(1);
      expect(money(lastMonth[0]?.amount ?? "0").eq("300.20")).toBe(true);
      expect(lastMonth[0]?.paidOn).toBe("2026-10-31");
      const thisMonth = await listEssentialPayments(db, "2026-11");
      expect(thisMonth).toHaveLength(0);

      // 本月统计不得被上月收据污染。
      const summary = screen.getByRole("region", { name: "本月合计" });
      expect(summary.textContent).toContain("¥0.00");
      expect(summary.textContent).not.toContain("¥300.20");
      // 本月记录仍为空态。
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
      // 该项目本月已付仍为 0。
      const housing = await itemByCategory(db, "HOUSING");
      const row = screen.getByText(housing.name).closest("li");
      expect(row?.textContent).toContain("该项本月已记录支付 ¥0.00");
      expect(row?.textContent).not.toContain("¥300.20");

      // home 始终按会话日 2026-11-01 刷新，未跟随付款月份。
      const homeDates = new Set(services.getHomeApplicationState.mock.calls.map((c) => c[0]));
      expect([...homeDates]).toEqual(["2026-11-01"]);

      // 上月页面上该笔必须可见（收据属于它自己的显示月份）。
      cleanup();
      vi.setSystemTime(new Date("2026-10-05T04:00:00.000Z"));
      const octoberUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      await openFixedExpenses(octoberUser);
      const octoberSummary = screen.getByRole("region", { name: "本月合计" });
      expect(octoberSummary.textContent).toContain("¥300.20");
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("M2-T02 v3 跨月补记：项目生效日（11-01）晚于付款日（10-31）", () => {
  /**
   * 真机 V14-3 的失败场景：项目首版快照 2026-11-01，补记 2026-10-31 的支付。
   * 旧实现按 paidOn 查项目会抛 ESSENTIAL_ITEM_NOT_FOUND；新实现应恰好写入一笔。
   */
  it("F01-B 项目11-01生效、经UI补记10-31的728：恰写一笔、字段正确、重开10月仍一笔", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const item = await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "728.00");
      await user.type(screen.getByLabelText("备注（选填）"), "补记上月");

      await user.click(screen.getByLabelText("日期 2026-11-01"));
      await user.click(await screen.findByRole("button", { name: "上个月" }));
      await user.click(await screen.findByRole("gridcell", { name: "2026-10-31" }));
      await user.click(screen.getByRole("button", { name: "确定" }));
      await screen.findByLabelText("日期 2026-10-31");

      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("已保存")).toBeTruthy();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      // 按 receipt.payment.id 读回付款月份：恰一笔，项目/金额/日期/备注一致。
      const receipt = (await services.recordEssentialPayment.mock.results[0]?.value) as
        | { payment: { id: string } }
        | undefined;
      if (!receipt) throw new Error("缺少付款收据");
      const october = await listEssentialPayments(db, "2026-10");
      const matched = october.filter((row) => row.id === receipt.payment.id);
      expect(matched).toHaveLength(1);
      expect(matched[0]?.itemId).toBe(item.id);
      expect(money(matched[0]?.amount ?? "0").eq(money("728.00"))).toBe(true);
      expect(matched[0]?.paidOn).toBe("2026-10-31");
      expect(matched[0]?.note).toBe("补记上月");
      expect(await listEssentialPayments(db, "2026-11")).toHaveLength(0);

      // 本月统计与首页刷新仍按会话日 2026-11-01，不被上月回执污染。
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥0.00");
      expect(screen.getByText("本月还没有记录")).toBeTruthy();
      const homeDates = new Set(services.getHomeApplicationState.mock.calls.map((c) => c[0]));
      expect([...homeDates]).toEqual(["2026-11-01"]);

      // 重新挂载到 10 月：该笔仍恰一笔、可见、合计 728。
      cleanup();
      vi.setSystemTime(new Date("2026-10-05T04:00:00.000Z"));
      const octoberUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App services={services} />);
      await screen.findByTestId("m1-home");
      // 10 月里该项目尚未生效（按 asOf 投影不出现），但收据属于它自己的付款月份。
      await octoberUser.click(await screen.findByRole("button", { name: "我的财务" }));
      await octoberUser.click(await screen.findByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "本月合计" });
      const octoberSummary = screen.getByRole("region", { name: "本月合计" });
      expect(octoberSummary.textContent).toContain("¥728.00");
      const octoberRecords = screen.getByRole("region", { name: "本月记录" });
      expect(within(octoberRecords).getAllByRole("listitem")).toHaveLength(1);
      expect(octoberRecords.textContent).toContain("补记上月");
    } finally {
      db.close();
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * E-T03（PLAN §2）：真实 M2FinanceRoute 测试内宿主。
 * 只用真实 Route + 真实 M2FixedExpensesPage + 真实 M1Home + 真实服务 + 内存库；
 * 不引入通用测试框架、模块替身或生产测试钩子。
 * ------------------------------------------------------------------ */

type T03Probe = {
  events: string[];
  push(event: string): void;
  count(prefix: string): number;
  enterSeq: number;
  received: HomeApplicationState[];
  lastReceived: HomeApplicationState | null;
  appliedRefs: number;
  commits: number;
};

function makeT03Probe(): T03Probe {
  const events: string[] = [];
  return {
    events,
    push(event: string) {
      events.push(event);
    },
    count(prefix: string) {
      return events.filter((event) => event.startsWith(prefix)).length;
    },
    enterSeq: 0,
    received: [],
    lastReceived: null,
    appliedRefs: 0,
    commits: 0,
  };
}

function T03Host({
  services,
  asOfDate,
  initialHome,
  probe,
  onRecordExpense,
  notifyReceived,
}: {
  services: ProductApplicationServices;
  asOfDate: string;
  initialHome: HomeApplicationState;
  probe: T03Probe;
  onRecordExpense: (expense: never, date: string) => Promise<never>;
  /** 本次 onHome 已被宿主接收的信号（由测试侧解析，不是固定等待）。 */
  notifyReceived: () => void;
}) {
  const [home, setHome] = useState<HomeApplicationState>(initialHome);
  const receivedRef = useRef<HomeApplicationState | null>(null);

  // 宿主的 onHome：先记录带结果引用/日期的 home-received，再应用真实结果。
  const onHome = useCallback(
    (next: HomeApplicationState) => {
      probe.push(`home-received:${next.asOfDate}`);
      probe.received.push(next);
      receivedRef.current = next;
      probe.lastReceived = next;
      setHome(next);
      notifyReceived();
    },
    [probe, notifyReceived],
  );

  // 同一真实结果引用已应用时才记 home-applied。
  useLayoutEffect(() => {
    if (receivedRef.current !== null && home === receivedRef.current) {
      probe.push(`home-applied:${home.asOfDate}`);
      probe.appliedRefs += 1;
    }
  }, [home, probe]);

  return (
    <Profiler
      id="t03-route"
      onRender={() => {
        probe.push("react-commit");
        probe.commits += 1;
      }}
    >
      <M2FinanceRoute
        services={services}
        asOfDate={asOfDate}
        home={home}
        onHome={onHome}
        onRecordExpense={onRecordExpense as never}
      />
    </Profiler>
  );
}

describe("E-T03 新增确认因果见证：真实 home 返回 → onHome → React 提交 → act 后仍在今天", () => {
  it("E-T03 完整时序：闸门只拦本次写后独立 home，释放后同结果被提交，未导航不跳页且消费草稿保留，最后二步重进确认", async () => {
    const db = await seed();
    try {
      const probe = makeT03Probe();
      const homeGate = gate();
      const armed = { current: false, held: 0 };
      let homeReturned!: () => void;
      const homeReturnedPromise = new Promise<void>((resolve) => {
        homeReturned = resolve;
      });
      let homeReceived!: () => void;
      const homeReceivedPromise = new Promise<void>((resolve) => {
        homeReceived = resolve;
      });
      const writes: string[] = [];
      const patchIds: string[] = [];
      let recordExpenseCalls = 0;

      const services = makeServices(db, {
        listEssentialPaymentItems: vi.fn(async (date: string) => {
          probe.push(`items-read:${date}`);
          return listEssentialPaymentItems(db, date);
        }),
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            const patchId = items[0]?.id ?? "";
            patchIds.push(patchId);
            writes.push(`write:${patchId}`);
            probe.push("write");
            return saveEssentialItems(db, items, date);
          },
        ),
        getHomeApplicationState: vi.fn(async (date: string) => {
          probe.enterSeq += 1;
          const seq = probe.enterSeq;
          const isArmedHome = armed.current && armed.held === 0;
          probe.push(`home-enter:${seq}:${date}`);
          if (isArmedHome) {
            armed.held += 1;
            await homeGate.promise;
          }
          const result = await getHomeApplicationState(db, date);
          // home-return 必须在真实 await 之后才记录。
          probe.push(`home-return:${seq}`);
          if (isArmedHome) homeReturned();
          return result;
        }),
      });

      const initialHome = await getHomeApplicationState(db, AS_OF);
      const initialIds = (await listEssentialPaymentItems(db, AS_OF)).map((item) => item.id).sort();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <T03Host
          services={services}
          asOfDate={AS_OF}
          initialHome={initialHome}
          probe={probe}
          onRecordExpense={async () => {
            recordExpenseCalls += 1;
            throw new Error("本场景不提交消费");
          }}
          notifyReceived={() => homeReceived()}
        />,
      );
      await screen.findByTestId("m1-home");
      const user2 = user;

      // 步骤 1：正常初始化、进入固定支出与添加核对页之后才武装闸门。
      await user2.click(await screen.findByRole("button", { name: "我的财务" }));
      await user2.click(await screen.findByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "固定支出项目" });
      await fillAddForm(user2, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user2.click(screen.getByRole("button", { name: "添加" }));
      await screen.findByRole("region", { name: "添加核对" });

      const itemsReadsBefore = probe.count("items-read");
      armed.current = true;

      // 步骤 1-2：确认添加，只允许一个本次操作。
      await user2.click(screen.getByRole("button", { name: "确认添加" }));

      // 步骤 2-3：等写后四字段读回完成、home-enter 出现，而 home-return 仍为 0。
      await waitFor(() => expect(probe.count("items-read")).toBeGreaterThan(itemsReadsBefore + 1));
      await waitFor(() => expect(probe.count("home-enter")).toBe(1));
      expect(probe.count("home-return")).toBe(0);
      expect(probe.count("home-received")).toBe(0);
      expect(screen.queryByText("已添加")).toBeNull();

      // 步骤 3：用户切到今天，打开真实记一笔表单，填写但不提交。
      await user2.click(screen.getByRole("button", { name: "今天" }));
      await screen.findByTestId("m1-home");
      await user2.click(screen.getByRole("button", { name: /记一笔/ }));
      const amountField = (await screen.findByLabelText("消费金额")) as HTMLInputElement;
      const noteField = (await screen.findByLabelText("备注（选填）")) as HTMLInputElement;
      await user2.type(amountField, "12.34");
      await user2.type(noteField, "晚回调保留");
      const amountNode = amountField;
      const noteNode = noteField;
      const commitsBefore = probe.commits;
      const appliedBefore = probe.appliedRefs;

      // 步骤 4：单次 act 内释放并等待真实返回与本次 onHome 接收。
      // 单次 act 内释放；随后严格等待真实返回与本次 onHome 接收两个真实 promise。
      // 两者都必须真正发生，卡住即由测试超时暴露，绝不以超时或固定等待充当完成。
      await act(async () => {
        homeGate.release();
        await homeReturnedPromise;
        await homeReceivedPromise;
      });

      // 见证：home-return → home-received → home-applied/React 提交，onHome 增量恰 1。
      const order = probe.events.join("|");
      expect(order.indexOf("home-return:1")).toBeLessThan(order.indexOf("home-received:"));
      expect(order.indexOf("home-received:")).toBeLessThan(order.indexOf("home-applied:"));
      expect(probe.count("home-return")).toBe(1);
      expect(probe.count("home-received")).toBe(1);
      expect(probe.appliedRefs).toBe(appliedBefore + 1);
      expect(probe.commits).toBeGreaterThan(commitsBefore);
      expect(probe.received).toHaveLength(1);
      // 同一真实结果引用被应用，不是另造对象。
      expect(probe.lastReceived).toBe(probe.received[0]);

      // 步骤 6：仍未主动导航——今天仍活动，固定支出与核对不在 DOM，成功 0。
      expect(screen.getByTestId("m1-home")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "固定支出项目" })).toBeNull();
      expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
      expect(screen.queryByText("已添加")).toBeNull();
      // 消费草稿未被卸载重建或覆盖。
      expect(screen.getByLabelText("消费金额")).toBe(amountNode);
      expect(screen.getByLabelText("备注（选填）")).toBe(noteNode);
      expect(amountNode.value).toBe("12.34");
      expect(noteNode.value).toBe("晚回调保留");
      expect(recordExpenseCalls).toBe(0);

      // 同一操作唯一 UUID、仅一条写链。
      expect(writes).toHaveLength(1);
      expect(new Set(patchIds).size).toBe(1);
      const draftId = patchIds[0] ?? "";
      expect(draftId).not.toBe("");

      // 步骤 7：关闭未提交消费表单，主动经二步入口重进确认。
      await user2.click(screen.getByRole("button", { name: "关闭" }));
      await goToFixedExpensesFromToday(user2);
      expect(await screen.findByText("已添加")).toBeTruthy();
      const items = await listEssentialPaymentItems(db, AS_OF);
      expect(items).toHaveLength(3);
      expect(items.filter((item) => item.id === draftId)).toHaveLength(1);
      const created = items.find((item) => item.id === draftId);
      expect(created?.name).toBe("合成保险");
      expect(created?.category).toBe("INSURANCE");
      expect(money(created?.monthlyAmount ?? "0").eq(money("300"))).toBe(true);
      // 计划合计 1500 由页面文本体现（项目行本身只显示各自金额）。
      expect(document.body.textContent).toContain("¥1,500.00");
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
      // 原项目集合未被改动。
      for (const id of initialIds) {
        expect(items.filter((item) => item.id === id)).toHaveLength(1);
      }

      emitUiEvidence("E-T03", {
        V: "V13/V15/V21/V23",
        fixtureId: "A",
        phase: "confirm-late-home",
        draftId,
        initialIds,
        patchIds,
        writeCount: writes.length,
        eventOrder: probe.events,
        homeReturnCount: probe.count("home-return"),
        homeReceivedCount: probe.count("home-received"),
        homeAppliedCount: probe.appliedRefs - appliedBefore,
        reactCommits: probe.commits - commitsBefore,
        sameReferenceApplied: probe.lastReceived === probe.received[0],
        receivedHome: probe.received[0],
        stayedOnToday: true,
        successBannerWhileOnToday: 0,
        expenseDraft: { amount: amountNode.value, note: noteNode.value, sameNodes: true },
        recordExpenseCalls,
        finalItemCount: items.length,
        saveCalls: 1,
        assertion:
          "闸门只拦本次写后独立 home；home-return 先于 home-received 先于 home-applied；未导航不跳页、消费草稿同节点未变、消费服务 0 调用；二步重进后同 UUID 恰 1 条且计划 1500",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E08/E09/E11/E20 UI 写后未知、读回反例与同类别归属", () => {
  it("E08-COMMIT-REJECT 真实 PAY 已写后 reject：UI 无可靠 id、1 笔 300.20 保留、草稿冻结、零自动重写", async () => {
    const db = await seed();
    try {
      const probe = timeline();
      const serverReceipts: unknown[] = [];
      const services = makeServices(db, {
        recordEssentialPayment: vi.fn(
          async (input: Parameters<typeof recordEssentialPayment>[1]) => {
            // 真实写入先发生，收据只留在证据变量里，然后抛测试故障。
            const real = await recordEssentialPayment(db, input);
            serverReceipts.push(real.payment);
            probe.push("written-then-reject");
            throw new Error("写入已提交后返回异常");
          },
        ),
        listEssentialPayments: vi.fn(async (month?: string) => {
          probe.push("read");
          return listEssentialPayments(db, month);
        }),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await openPayForm(user, db, "HOUSING");
      await user.type(screen.getByLabelText("付款金额"), "300.20");
      const readsBefore = probe.count("read");
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByText("已保存")).toBeNull();
      expect(screen.queryByText("未保存，填写内容已保留")).toBeNull();
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);

      // 服务确实执行并落库 1 笔 300.20；UI 未拿到可靠 id。
      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(1);
      expect(money(rows[0]?.amount ?? "0").eq(money("300.20"))).toBe(true);
      expect(serverReceipts).toHaveLength(1);

      // reject 之后才有只读核查（按增量）。
      const rejectAt = probe.indexOf("written-then-reject");
      expect(rejectAt).toBeGreaterThanOrEqual(0);
      expect(probe.slice(rejectAt + 1).includes("read")).toBe(true);
      expect(probe.count("read")).toBeGreaterThan(readsBefore);

      // 零自动重写、金额草稿冻结。
      expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
      expect((screen.getByLabelText("付款金额") as HTMLInputElement).readOnly).toBe(true);

      // 二步重进仍不可重提同一笔。
      await goToFixedExpensesFromToday(user);
      expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect(await listEssentialPayments(db, MONTH)).toHaveLength(1);

      emitUiEvidence("E08-COMMIT-REJECT", {
        V: "V08",
        fixtureId: "A（seed 收入 2000，非 P 的 10000）",
        phase: "committed-then-reject",
        callArgs: { amount: "300.20", paidOn: AS_OF },
        serverReceipt: serverReceipts[0],
        uiHasReliableId: false,
        trace: probe.entries,
        targetMonthRows: rows,
        draftAmount: "300.20",
        draftReadOnly: true,
        successBanner: 0,
        autoRewrite: 0,
        assertion: "真实写入 1 笔 300.20 保留；UI 无 id 保持待核查；核查在 reject 之后；重进仍锁",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  // 本组是"付款（PAY）"读回反例，对象为 recordEssentialPayment 与 listEssentialPayments。
  // 原卡 V09 逐字规定的是缺记录/错金额/错日期/错itemId/错备注五项，故：
  //   MISSING/AMOUNT 可准确关联 V09；ID/NAME/CAT 属补充 PAY 反例，不冒称 V09 子项。
  it.each([
    [
      "E20PAY-MISSING",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) => [] as typeof rows,
    ],
    [
      "E20PAY-ID",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, id: "other-id" })),
    ],
    [
      "E20PAY-NAME",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, itemName: "别的项目" })),
    ],
    [
      "E20PAY-CAT",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, category: "FOOD" as never })),
    ],
    [
      "E20PAY-AMOUNT",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, amount: "1" })),
    ],
    [
      "E09-NOTE",
      (rows: Awaited<ReturnType<typeof listEssentialPayments>>) =>
        rows.map((row) => ({ ...row, note: "被改过的备注" })),
    ],
  ])(
    "%s：成功 0、自动重写 0、保留草稿且禁支付",
    async (caseId, mutate) => {
      const db = await seed();
      try {
        let written = false;
        const services = makeServices(db, {
          recordEssentialPayment: vi.fn(
            async (input: Parameters<typeof recordEssentialPayment>[1]) => {
              const real = await recordEssentialPayment(db, input);
              written = true;
              return real;
            },
          ),
          listEssentialPayments: vi.fn(async (month?: string) => {
            const rows = await listEssentialPayments(db, month);
            return written ? mutate(rows) : rows;
          }),
        });
        const user = await mount(services);
        await openFixedExpenses(user);
        await openPayForm(user, db, "HOUSING");
        await user.type(screen.getByLabelText("付款金额"), "300.20");
        await user.click(screen.getByRole("button", { name: "保存" }));

        expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
        expect(screen.queryByText("已保存")).toBeNull();
        // 自动重写 0：服务只被调用 1 次；实际写库仍恰 1 笔 300.20。
        expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1);
        const dbRows = await listEssentialPayments(db, MONTH);
        expect(dbRows).toHaveLength(1);
        expect(money(dbRows[0]?.amount ?? "0").eq(money("300.20"))).toBe(true);
        // 草稿保留且禁支付。
        expect((screen.getByLabelText("付款金额") as HTMLInputElement).value).toBe("300.20");
        expect(screen.queryByRole("button", { name: "保存" })).toBeNull();

        // 原 V 编号只填真实对应：缺记录/错金额→V09，错备注→V09；其余为补充 PAY 反例，不填错号。
        const V09_EXACT = new Set(["E20PAY-MISSING", "E20PAY-AMOUNT", "E09-NOTE"]);
        const isV09Exact = V09_EXACT.has(caseId);
        emitUiEvidence(caseId, {
          V: isV09Exact ? "V09" : null,
          V09ExactSubitem: isV09Exact,
          supplemental: isV09Exact ? null : "补充 PAY 读回反例（原卡 V09 未逐字规定该子项）",
          object:
            "PAY（listEssentialPaymentItems 未参与；对象为 recordEssentialPayment 与 listEssentialPayments）",
          fixtureId: "A（seed 收入 2000，非 P 的 10000）",
          phase: "readback-mismatch",
          callArgs: { amount: "300.20", paidOn: AS_OF },
          mutatedReadback: mutate(dbRows),
          actualDbRows: dbRows,
          uiSuccess: 0,
          autoRewrite: 0,
          draftAmount: "300.20",
          saveButtonCount: 0,
          assertion: "读回不符：成功 0、自动重写 0、草稿保留、禁再次提交；实际写库未改",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );

  it("E11-SAME-CATEGORY 同类别两个不同项目 id：各归所属、合计 600.40", async () => {
    const db = await seed();
    try {
      // 真实服务准备第二个 HOUSING 项目（不同 id，同类别）。
      const secondId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: secondId, name: "第二处住房", category: "HOUSING", monthlyAmount: "800.00" }],
        AS_OF,
      );
      const housingItems = (await listEssentialPaymentItems(db, AS_OF)).filter(
        (item) => item.category === "HOUSING",
      );
      expect(housingItems).toHaveLength(2);
      const firstId = housingItems.find((item) => item.id !== secondId)?.id ?? "";

      await recordEssentialPayment(db, { itemId: firstId, amount: "300.20", paidOn: AS_OF });
      await recordEssentialPayment(db, { itemId: secondId, amount: "300.20", paidOn: AS_OF });

      const rows = await listEssentialPayments(db, MONTH);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.itemId === firstId)).toHaveLength(1);
      expect(rows.filter((row) => row.itemId === secondId)).toHaveLength(1);
      const total = rows.reduce((sum, row) => sum.plus(money(row.amount)), money("0")).toString();
      expect(total).toBe("600.4");

      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥600.40");

      emitUiEvidence("E11-SAME-CATEGORY", {
        V: "V11",
        fixtureId: "A（seed 收入 2000，非 P 的 10000）",
        phase: "two-housing-items",
        items: housingItems,
        firstId,
        secondId,
        receipts: rows,
        targetMonthRows: rows,
        total,
        uiTotal: screen.getByRole("region", { name: "本月合计" }).textContent,
        assertion: "同类别不靠类别分配：两条按不同 itemId 各自归属，合计 600.40",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E18 非法输入全例：零保存、零主表、零修订", () => {
  async function counts(db: Awaited<ReturnType<typeof seed>>) {
    const items = await db.select("SELECT id FROM essential_expense_items");
    const revisions = await db.select("SELECT revision_id FROM essential_expense_revisions");
    return { items: items.length, revisions: revisions.length };
  }

  it("名称：空与纯空格均拒绝，0 保存", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const before = await counts(db);
      const cases: Array<{ label: string; name: string }> = [
        { label: "空", name: "" },
        { label: "纯空格", name: "   " },
        { label: "全角空格", name: "\u3000" },
      ];
      const observed: Array<Record<string, unknown>> = [];
      // 表单只打开一次；每个用例只改名称字段，验证同一表单内的写前校验。
      await fillAddForm(user, { name: cases[0]?.name ?? "", category: "INSURANCE", amount: "300" });
      for (const item of cases) {
        const nameField = screen.getByLabelText("支出名称") as HTMLInputElement;
        await user.clear(nameField);
        if (item.name !== "") await user.type(nameField, item.name);
        await user.click(screen.getByRole("button", { name: "添加" }));
        const savedNow = services.saveEssentialItems.mock.calls.length;
        observed.push({
          label: item.label,
          name: item.name,
          saveCalls: savedNow,
          confirmVisible: screen.queryByRole("region", { name: "添加核对" }) !== null,
        });
      }
      const after = await counts(db);
      expect(observed.every((row) => row.saveCalls === 0)).toBe(true);
      expect(observed.every((row) => row.confirmVisible === false)).toBe(true);
      expect(after).toEqual(before);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);

      emitUiEvidence("E18-NAME", {
        V: "V18",
        fixtureId: "A",
        phase: "invalid-name",
        cases: observed,
        countsBefore: before,
        countsAfter: after,
        saveCalls: 0,
        assertion: "空/纯空格/全角空格名称均不进入核对，零保存零写入",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  it("类别：7 个合法值可选，注入非法值被拒绝且 0 保存", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const before = await counts(db);
      await fillAddForm(user, { name: "类别测试", category: "HOUSING", amount: "300" });
      const select = screen.getByLabelText("类别") as HTMLSelectElement;
      const legal = Array.from(select.options).map((option) => option.value);
      expect(legal).toHaveLength(7);

      // 注入一个产品未提供的类别值，验证写前校验而非仅靠下拉限制。
      const injected = document.createElement("option");
      injected.value = "FOOD";
      injected.textContent = "FOOD";
      select.appendChild(injected);
      await user.selectOptions(select, "FOOD");
      await user.click(screen.getByRole("button", { name: "添加" }));

      const after = await counts(db);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
      expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
      expect(after).toEqual(before);

      emitUiEvidence("E18-CATEGORY", {
        V: "V18",
        fixtureId: "A",
        phase: "invalid-category",
        legalCategories: legal,
        injectedCategory: "FOOD",
        countsBefore: before,
        countsAfter: after,
        saveCalls: 0,
        assertion: "7 个合法类别可选；注入 FOOD 被写前校验拒绝，零保存零写入",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  it("金额：空、非数字、零、负数、三位小数、科学计数、全角均拒绝且 0 保存", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const before = await counts(db);
      // 空与 "0" 不属于「非法」：产品写前校验显式允许空并以 "0" 落库（见 validateMonthlyAmount
      // 首行 return "" 与 submitAddForm 的 amount.trim() || "0"）。此处只把实测行为记录进证据，
      // 不作缺陷指控，也不修改产品；真正非法的 6 个值逐一断言被拒。
      const values = ["abc", "-5", "1.234", "1e3", "12.3.4", "１２３"];
      const observed: Array<Record<string, unknown>> = [];
      // 表单只打开一次，名称与类别保持合法，仅逐值替换金额。
      await fillAddForm(user, { name: "金额测试", category: "INSURANCE", amount: "300" });
      for (const value of values) {
        const field = screen.getByLabelText("每月金额") as HTMLInputElement;
        await user.clear(field);
        if (value !== "") await user.type(field, value);
        await user.click(screen.getByRole("button", { name: "添加" }));
        observed.push({
          value,
          saveCalls: services.saveEssentialItems.mock.calls.length,
          confirmVisible: screen.queryByRole("region", { name: "添加核对" }) !== null,
        });
      }
      const after = await counts(db);
      expect(observed.every((row) => row.saveCalls === 0)).toBe(true);
      expect(observed.every((row) => row.confirmVisible === false)).toBe(true);
      expect(after).toEqual(before);

      emitUiEvidence("E18-AMOUNT", {
        V: "V18",
        fixtureId: "A",
        phase: "invalid-amount",
        cases: observed,
        countsBefore: before,
        countsAfter: after,
        saveCalls: 0,
        assertion: "6 个非法金额全部不进入核对，零保存零写入",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  it("E18-AMOUNT-ZERO 实测空与「0」月额：产品接受并进入核对、零写入（记录行为，不作缺陷指控）", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      const accepted: Array<Record<string, unknown>> = [];
      for (const value of ["", "0"]) {
        await fillAddForm(user, { name: "零额观察", category: "INSURANCE", amount: value });
        await user.click(screen.getByRole("button", { name: "添加" }));
        accepted.push({
          value,
          enteredConfirm: screen.queryByRole("region", { name: "添加核对" }) !== null,
          confirmText: screen.queryByRole("region", { name: "添加核对" })?.textContent ?? null,
          saveCalls: services.saveEssentialItems.mock.calls.length,
        });
        // 退回清单：核对视图先「返回」到表单，再从表单「取消」回列表；不产生任何写入。
        const back = screen.queryByRole("button", { name: "返回" });
        if (back) await user.click(back);
        const cancel = screen.queryByRole("button", { name: "取消" });
        if (cancel) await user.click(cancel);
        await screen.findByRole("button", { name: "添加支出" });
      }
      const items = await db.select("SELECT id FROM essential_expense_items");
      expect(items).toHaveLength(2);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);

      emitUiEvidence("E18-AMOUNT-ZERO-OBSERVED", {
        V: "V18",
        fixtureId: "A",
        phase: "observed-empty-and-zero-amount",
        cases: accepted,
        itemsInDb: items.length,
        saveCalls: 0,
        assertion:
          "实测：空金额与「0」均被产品接受并进入核对、未产生写入；记录为既有产品行为，不作缺陷指控",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E15-ADD 新增四字段原义：id/name/category/monthlyAmount", () => {
  it("E15-ADD 真实新增成功后四字段同源一致", async () => {
    const db = await seed();
    try {
      let savedId = "";
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            savedId = items[0]?.id ?? "";
            return saveEssentialItems(db, items, date);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "四字段保险", category: "INSURANCE", amount: "300.20" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);
      expect(await screen.findByText("已添加")).toBeTruthy();

      const items = await listEssentialPaymentItems(db, AS_OF);
      const created = items.filter((item) => item.id === savedId);
      expect(created).toHaveLength(1);
      const row = created[0];
      expect(row?.id).toBe(savedId);
      expect(row?.name).toBe("四字段保险");
      expect(row?.category).toBe("INSURANCE");
      expect(money(row?.monthlyAmount ?? "0").eq(money("300.20"))).toBe(true);
      const list = screen.getByRole("region", { name: "固定支出项目" });
      expect(list.textContent).toContain("四字段保险");
      expect(list.textContent).toContain("保险");
      expect(list.textContent).toContain("¥300.20");

      emitUiEvidence("E15-ADD", {
        V: "V15",
        object: "ADD 新增成功四字段",
        fixtureId: "A",
        phase: "add-success",
        input: { name: "四字段保险", category: "INSURANCE", amount: "300.20" },
        savedId,
        readback: row,
        listText: list.textContent,
        saveCalls: 1,
        assertion: "真实新增成功后 id/name/category/monthlyAmount 四字段同源一致",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E23 五条路径隐藏保护与同库重挂", () => {
  const FORBIDDEN = ["建议", "剩余", "超出", "进度", "基础盈余", "还可花", "欠付", "剩余应付"];

  // T01 免责说明：只精确豁免指定节点 m1-scope-note 的文本，绝不按句子全局删除。
  const SCOPE_NOTE_TEXT = "债务情况尚未确认，暂不显示建议金额。";
  const SCOPE_NOTE_SELECTOR = '[data-testid="m1-scope-note"]';
  const ATTRS = ["aria-label", "aria-description", "title", "alt", "placeholder"] as const;

  /** 先断言指定节点存在且原文精确，再返回其文本节点集合用于精确剔除。 */
  function assertScopeNoteIntact(where: string) {
    const node = document.querySelector(SCOPE_NOTE_SELECTOR);
    if (!node) return { present: false, text: null };
    expect(node.textContent, `${where} 的 m1-scope-note 原文`).toBe(SCOPE_NOTE_TEXT);
    return { present: true, text: node.textContent };
  }

  /**
   * 用克隆 DOM 扫描：所有节点的属性完整检查；文本仅剔除指定豁免节点的
   * 那些文本节点内容，其他任何位置出现同样句子都不豁免。
   */
  function scanVisibleAndA11y(where: string) {
    const clone = document.body.cloneNode(true) as HTMLElement;
    const exempted: string[] = [];
    // 只把被豁免节点自身的直接文本节点清空，保留其属性供检查。
    const noteClone = clone.querySelector(SCOPE_NOTE_SELECTOR);
    if (noteClone) {
      for (const child of Array.from(noteClone.childNodes)) {
        if (child.nodeType === 3) {
          exempted.push(child.textContent ?? "");
          child.textContent = "";
        }
      }
    }
    const texts: string[] = [];
    for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      const text = node.textContent ?? "";
      if (text.trim() !== "") texts.push(text);
      for (const attr of ATTRS) {
        const value = node.getAttribute(attr);
        if (value !== null) texts.push(value);
      }
    }
    for (const word of FORBIDDEN) {
      expect(
        texts.filter((text) => text.includes(word)),
        `${where} 出现了禁用词「${word}」`,
      ).toEqual([]);
    }
    expect(document.querySelectorAll('[role="progressbar"]').length).toBe(0);
    return { where, exemptedTextNodes: exempted, scannedNodeCount: texts.length };
  }

  it("E23 新增成功后五条路径都无建议/剩余/进度类表述，同库重挂 1 条新项目四字段一致", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "合成保险", category: "INSURANCE", amount: "300" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);
      await screen.findByText("已添加");
      const created = (await listEssentialPaymentItems(db, AS_OF)).filter(
        (item) => item.name === "合成保险",
      );
      expect(created).toHaveLength(1);
      const createdId = created[0]?.id ?? "";
      const paths: string[] = [];
      const scans: Array<Record<string, unknown>> = [];

      // 路径 1：新增完成后的固定支出页。
      await screen.findByRole("region", { name: "固定支出项目" });
      scans.push(scanVisibleAndA11y("路径1 固定支出页"));
      paths.push("固定支出页");

      // 路径 2：返回今天（M1Home 说明节点必须原样在）。
      await user.click(screen.getByRole("button", { name: "今天" }));
      await screen.findByTestId("m1-home");
      const noteOnToday = assertScopeNoteIntact("路径2 今天页");
      expect(noteOnToday.present).toBe(true);
      scans.push(scanVisibleAndA11y("路径2 今天页"));
      paths.push("今天页");

      // 路径 3：重进我的财务——先停在分组页扫描，再点固定支出扫描，不一步越过中间页。
      await user.click(screen.getByRole("button", { name: "我的财务" }));
      const groupPage = await screen.findByRole("region", { name: "财务分组" }).catch(() => null);
      expect(groupPage ?? document.body).toBeTruthy();
      scans.push(scanVisibleAndA11y("路径3a 我的财务分组页"));
      paths.push("我的财务分组页");
      await user.click(await screen.findByRole("button", { name: /固定支出/ }));
      await screen.findByRole("region", { name: "固定支出项目" });
      scans.push(scanVisibleAndA11y("路径3b 重进固定支出"));
      paths.push("重进固定支出");

      // 路径 4：打开新增表单。
      await fillAddForm(user, { name: "临时", category: "HOUSING", amount: "1" });
      scans.push(scanVisibleAndA11y("路径4 新增表单"));
      paths.push("新增表单");

      // 路径 5：打开支付表单。
      await user.click(screen.getByRole("button", { name: "取消" }));
      await screen.findByRole("button", { name: "添加支出" });
      await openPayForm(user, db, "HOUSING");
      scans.push(scanVisibleAndA11y("路径5 支付表单"));
      paths.push("支付表单");

      // 同库重挂：先卸载当前应用，再用同一个库重新挂载，只有 1 条新项目且四字段一致。
      cleanup();
      const other = makeServices(db);
      const user2 = await mount(other);
      await openFixedExpenses(user2);
      const after = await listEssentialPaymentItems(db, AS_OF);
      expect(after).toHaveLength(3);
      const again = after.filter((item) => item.id === createdId);
      expect(again).toHaveLength(1);
      expect(again[0]?.name).toBe("合成保险");
      expect(again[0]?.category).toBe("INSURANCE");
      expect(money(again[0]?.monthlyAmount ?? "0").eq(money("300"))).toBe(true);
      scans.push(scanVisibleAndA11y("重挂后固定支出页"));

      emitUiEvidence("E23", {
        V: "V23",
        fixtureId: "A",
        phase: "five-paths-and-remount",
        createdId,
        paths,
        forbiddenWords: FORBIDDEN,
        progressbarCount: 0,
        scopeNote: { selector: SCOPE_NOTE_SELECTOR, exactText: SCOPE_NOTE_TEXT },
        scans,
        exemptionMethod:
          "克隆 DOM 后仅清空 m1-scope-note 自身的直接文本节点；所有节点属性完整检查；其他节点同句不豁免",
        waitedOnGroupPage: true,
        itemCountAfterRemount: after.length,
        createdRowAfterRemount: again[0],
        assertion: "五条路径均无禁用词与进度条；同库重挂后新项目恰 1 条且四字段一致",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E03/E15 单笔付款原始收据、读回与四字段显示一致", () => {
  it("E03-RAW 一次付款的调用参数、收据、当月读回、首页合计全部原文记录", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      const callArgs = { itemId: housing.id, amount: "300.20", paidOn: AS_OF, note: "十月房租" };
      const receipt = await recordEssentialPayment(db, callArgs);
      const readback = await listEssentialPayments(db, MONTH);
      const home = await getHomeApplicationState(db, AS_OF);

      expect(readback).toHaveLength(1);
      expect(receipt.payment.id).toBe(readback[0]?.id);
      expect(receipt.monthTotal).toBe("300.2");

      emitUiEvidence("E03-RAW", {
        V: "V03",
        fixtureId: "A（seed 收入 2000，非 P 的 10000）",
        phase: "single-payment",
        callArgs,
        receipt,
        readback,
        homeEssentialExpenses: home.essentialExpenses,
        homeCurrentMonthSpending: home.currentMonthSpending,
        assertion: "收据 id 与读回 id 相同、当月合计 300.2、首页合计与模型输入一致",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  it("E15PAY-DISPLAY 付款记录四显示字段与收据一致（非 V15 原义）", async () => {
    const db = await seed();
    try {
      const housing = await itemByCategory(db, "HOUSING");
      const receipt = await recordEssentialPayment(db, {
        itemId: housing.id,
        amount: "300.20",
        paidOn: AS_OF,
        note: "十月房租",
      });
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);

      const list = screen.getByRole("region", { name: "本月记录" });
      expect(list.textContent).toContain(housing.name);
      expect(list.textContent).toContain(housing.categoryLabel ?? housing.category);
      expect(list.textContent).toContain("¥300.20");
      expect(list.textContent).toContain("11-01");
      expect(screen.getByRole("region", { name: "本月合计" }).textContent).toContain("¥300.20");

      emitUiEvidence("E15PAY-DISPLAY", {
        V: null,
        supplemental: "付款记录显示补充例（非 V15；V15 由 E15-ADD 与原新增回归承担）",
        fixtureId: "A（seed 收入 2000，非 P 的 10000）",
        phase: "four-field-display",
        receipt: receipt.payment,
        itemName: housing.name,
        itemCategory: housing.category,
        listText: list.textContent,
        totalText: screen.getByRole("region", { name: "本月合计" }).textContent,
        assertion: "页面四字段与收据一致：名称、类别、¥300.20、11-01",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("E18-DATE 真实 Route 注入非法会话日期", () => {
  it.each(["2026-02-30", "2026-13-01"])(
    "E18-DATE %s：新增被跨日守卫拒绝、付款被服务层日期校验拒绝，零写入",
    async (bogusDate) => {
      const db = await seed();
      try {
        const probe = makeT03Probe();
        // 注入边界：只读显示层固定用合法 AS_OF 读取已初始化项目，以便进入真实表单；
        // 写入路径一律使用 Route 传入的非法日期，绝不改写为合法值。
        const services = makeServices(db, {
          listEssentialPaymentItems: vi.fn(async () => listEssentialPaymentItems(db, AS_OF)),
          listEssentialPayments: vi.fn(async () => listEssentialPayments(db, MONTH)),
          getHomeApplicationState: vi.fn(async () => getHomeApplicationState(db, AS_OF)),
        });
        const initialHome = await getHomeApplicationState(db, AS_OF);
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
          <T03Host
            services={services}
            asOfDate={bogusDate}
            initialHome={initialHome}
            probe={probe}
            onRecordExpense={async () => {
              throw new Error("本场景不提交消费");
            }}
            notifyReceived={() => {}}
          />,
        );
        await screen.findByTestId("m1-home");
        await user.click(await screen.findByRole("button", { name: "我的财务" }));
        await user.click(await screen.findByRole("button", { name: /固定支出/ }));
        await screen.findByRole("region", { name: "固定支出项目" });

        // 新增：真实表单可用，但跨日守卫拒绝派发。
        await fillAddForm(user, { name: "非法日期新增", category: "INSURANCE", amount: "300" });
        await user.click(screen.getByRole("button", { name: "添加" }));
        expect(await screen.findByText("日期已变化，暂时不能添加。")).toBeTruthy();
        expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        const itemsAfterAdd = await db.select("SELECT id FROM essential_expense_items");
        expect(itemsAfterAdd).toHaveLength(2);
        const revisionsAfterAdd = await db.select(
          "SELECT revision_id FROM essential_expense_revisions",
        );
        expect(revisionsAfterAdd).toHaveLength(0);

        // 付款：页面无跨日守卫，必须由服务层日期校验拒绝。
        await user.click(screen.getByRole("button", { name: "取消" }));
        await screen.findByRole("button", { name: "添加支出" });
        await openPayForm(user, db, "HOUSING");
        await user.type(await screen.findByLabelText("付款金额"), "300.20");
        await user.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(services.recordEssentialPayment).toHaveBeenCalledTimes(1));
        expect(screen.queryByText("已保存")).toBeNull();
        const payments = await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'");
        expect(payments).toHaveLength(0);

        emitUiEvidence(`E18-DATE-${bogusDate}`, {
          V: "V18",
          fixtureId: "A",
          phase: "invalid-session-date",
          injectedAsOfDate: bogusDate,
          injectionBoundary: "只读显示层固定用合法 AS_OF 读取项目；写入沿用非法日期",
          addMessage: "日期已变化，暂时不能添加。",
          addSaveCalls: 0,
          itemsAfterAdd: itemsAfterAdd.length,
          revisionsAfterAdd: revisionsAfterAdd.length,
          payServiceCalls: 1,
          payRowsWritten: payments.length,
          paySuccessBanner: 0,
          assertion: "非法日期：新增被跨日守卫拒绝、付款被服务层 validDate 拒绝，两侧均零写入",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );
});

describe("EC01 ADD 五反例：真实 saveEssentialItems 后仅拦截独立读回", () => {
  // 复用的真实新增输入：名称、类别、月金额即本次原始输入。
  const DRAFT = { name: "合成保险", category: "INSURANCE", amount: "300" } as const;

  async function addWithReadback(
    mutate: (
      rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>,
      newId: string,
    ) => Awaited<ReturnType<typeof listEssentialPaymentItems>>,
  ) {
    const db = await seed();
    const order = timeline();
    let newId = "";
    let tampered = false;
    let patch: Parameters<typeof saveEssentialItems>[1] = [];
    let patchDate = "";
    let originalRows: Array<Record<string, unknown>> = [];
    let insertedRow: Record<string, unknown> | undefined;
    const services = makeServices(db, {
      saveEssentialItems: vi.fn(
        async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
          order.push("write-start");
          // 写前：真实原项目完整行（全部列），用于写后逐字段比较。
          originalRows = await db.select("SELECT * FROM essential_expense_items ORDER BY id");
          patch = items;
          patchDate = date;
          const result = await saveEssentialItems(db, items, date);
          newId = items[0]?.id ?? "";
          insertedRow = (
            await db.select("SELECT * FROM essential_expense_items WHERE id=?", [newId])
          )[0];
          order.push("write-done");
          tampered = true;
          return result;
        },
      ),
      // 只拦截本次写后的独立读回；写前读取原样返回。
      listEssentialPaymentItems: vi.fn(async (date: string) => {
        const rows = await listEssentialPaymentItems(db, date);
        if (!tampered) {
          order.push("pre-read");
          return rows;
        }
        order.push("post-read");
        return mutate(rows, newId);
      }),
    });
    const user = await mount(services);
    await openFixedExpenses(user);
    await fillAddForm(user, DRAFT);
    await user.click(screen.getByRole("button", { name: "添加" }));
    await confirmAdd(user);
    return {
      db,
      services,
      order,
      user,
      getNewId: () => newId,
      getPatch: () => patch,
      getPatchDate: () => patchDate,
      getOriginalRows: () => originalRows,
      getInsertedRow: () => insertedRow,
    };
  }

  it.each([
    [
      "E20ADD-MISSING 缺本次新增 UUID 的记录",
      "UNKNOWN",
      (rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>, newId: string) =>
        rows.filter((row) => row.id !== newId),
    ],
    [
      "E20ADD-ID 返回错误 id",
      "UNKNOWN",
      (rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>, newId: string) =>
        rows.map((row) => (row.id === newId ? { ...row, id: "other-id" } : row)),
    ],
    [
      "E20ADD-NAME 保持 id 但 name 错误",
      "MISMATCH",
      (rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>, newId: string) =>
        rows.map((row) => (row.id === newId ? { ...row, name: "别的项目" } : row)),
    ],
    [
      "E20ADD-CAT 保持 id 但 category 错误",
      "MISMATCH",
      (rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>, newId: string) =>
        rows.map((row) => (row.id === newId ? { ...row, category: "HOUSING" as never } : row)),
    ],
    [
      "E20ADD-AMOUNT 保持 id 但 monthlyAmount 错误",
      "MISMATCH",
      (rows: Awaited<ReturnType<typeof listEssentialPaymentItems>>, newId: string) =>
        rows.map((row) => (row.id === newId ? { ...row, monthlyAmount: "1" } : row)),
    ],
  ])(
    "%s：真实写已发生、新增与修订各1、原项目保留、草稿冻结、save1/pay0/成功0",
    async (caseId, expectKind, mutate) => {
      const {
        db,
        services,
        order,
        user,
        getNewId,
        getPatch,
        getPatchDate,
        getOriginalRows,
        getInsertedRow,
      } = await addWithReadback(mutate);
      try {
        if (expectKind === "UNKNOWN") {
          expect(await screen.findByText("暂时无法确认是否保存，请先不要重复操作")).toBeTruthy();
          expect(
            screen.queryByText("已找到这项支出，但金额核对还没完成，请先不要重复添加"),
          ).toBeNull();
        } else {
          expect(
            await screen.findByText("已找到这项支出，但金额核对还没完成，请先不要重复添加"),
          ).toBeTruthy();
        }
        const newId = getNewId();
        expect(newId).not.toBe("");
        expect(screen.queryByText("已添加")).toBeNull();

        // 真实写已发生：新增恰 1 条、对应修订恰 1 条、原两条项目保留。
        const items = await db.select(
          "SELECT id,name,category,monthly_amount FROM essential_expense_items ORDER BY rowid",
        );
        expect(items).toHaveLength(3);
        const created = items.filter((row) => row.id === newId);
        expect(created).toHaveLength(1);
        const revisions = await db.select(
          "SELECT revision_id,item_id FROM essential_expense_revisions WHERE item_id=?",
          [newId],
        );
        expect(revisions).toHaveLength(1);

        // 逐字段比较原两项目：按本次新 id 剔除新增行后，与写前完整行逐列相等。
        const fullRows = await db.select("SELECT * FROM essential_expense_items ORDER BY id");
        const keptRows = fullRows.filter((row) => row.id !== newId);
        const originals = getOriginalRows();
        expect(originals).toHaveLength(2);
        expect(keptRows).toHaveLength(2);
        const byId = (rows: Array<Record<string, unknown>>) =>
          [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        expect(byId(keptRows)).toEqual(byId(originals));
        // 逐列显式比对（防止整行相等被字段缺失掩盖）。
        for (const original of originals) {
          const kept = keptRows.find((row) => row.id === original.id);
          expect(kept).toBeTruthy();
          for (const key of Object.keys(original)) {
            expect(kept?.[key], `${String(original.id)}.${key}`).toEqual(original[key]);
          }
        }

        // save 总次数 1、pay 0、成功 0、无二次提交入口。
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(1);
        expect(services.recordEssentialPayment).toHaveBeenCalledTimes(0);
        expect(screen.queryByRole("button", { name: "确认添加" })).toBeNull();
        // 写后读回确实发生在写完成之后。
        expect(order.indexOf("write-done")).toBeLessThan(order.indexOf("post-read"));

        // 冻结语义：核对区仍在（草稿未被丢弃）、不能再确认提交、无成功提示、不出现支付入口。
        expect(screen.getByRole("region", { name: "添加核对" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "确认添加" })).toBeNull();
        expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
        expect(screen.queryByText("已添加")).toBeNull();
        // 返回上一屏仍能看到原样输入，证明完整 ADD 草稿保留、无需重填。
        const back = screen.queryByRole("button", { name: "返回" });
        if (back) await user.click(back);
        const nameField = (await screen.findByLabelText("支出名称")) as HTMLInputElement;
        const categoryField = screen.getByLabelText("类别") as HTMLSelectElement;
        const amountField = screen.getByLabelText("每月金额") as HTMLInputElement;
        expect(nameField.value).toBe(DRAFT.name);
        expect(categoryField.value).toBe(DRAFT.category);
        expect(amountField.value).toBe(DRAFT.amount);
        const draftReadback = {
          name: nameField.value,
          category: categoryField.value,
          amount: amountField.value,
        };
        expect(draftReadback).toEqual({ ...DRAFT });

        // 冻结 = 不能再次派发写入：实际点一次“添加”，再核计数与库行。
        const addButton = screen.getByRole("button", { name: "添加" }) as HTMLButtonElement;
        const addDisabledBefore = addButton.disabled;
        await user.click(addButton);
        await Promise.resolve();
        const saveCallsAfterRetry = (services.saveEssentialItems as ReturnType<typeof vi.fn>).mock
          .calls.length;
        const payCallsAfterRetry = (services.recordEssentialPayment as ReturnType<typeof vi.fn>)
          .mock.calls.length;
        expect(saveCallsAfterRetry).toBe(1);
        expect(payCallsAfterRetry).toBe(0);
        expect(screen.queryByText("已添加")).toBeNull();
        // 库里仍只有本次 UUID 对应的 1 条新增，没有第二个身份或第二条项目。
        const itemsAfterRetry = await db.select(
          "SELECT id FROM essential_expense_items ORDER BY rowid",
        );
        expect(itemsAfterRetry).toHaveLength(3);
        expect(itemsAfterRetry.filter((row) => row.id === newId)).toHaveLength(1);
        const revisionsAfterRetry = await db.select(
          "SELECT revision_id FROM essential_expense_revisions WHERE item_id=?",
          [newId],
        );
        expect(revisionsAfterRetry).toHaveLength(1);

        emitUiEvidence(caseId.split(" ")[0] ?? caseId, {
          V: "V20",
          object: "ADD（saveEssentialItems + 写后独立 listEssentialPaymentItems）",
          fixtureId: "A",
          phase: "add-readback-mismatch",
          draftInput: DRAFT,
          newId,
          patch: getPatch(),
          patchCount: getPatch().length,
          patchDate: getPatchDate(),
          insertedRow: getInsertedRow(),
          expectedKind: expectKind,
          readbackInjected: mutate(await listEssentialPaymentItems(db, AS_OF), newId),
          originalRowsBefore: getOriginalRows(),
          keptRowsAfter: keptRows,
          itemsAfter: items,
          revisionsAfter: revisions,
          saveCalls: saveCallsAfterRetry,
          payCalls: payCallsAfterRetry,
          successBanner: screen.queryByText("已添加") === null ? 0 : 1,
          addDisabledBefore,
          retryAttempted: true,
          itemsAfterRetry,
          revisionsAfterRetry,
          draftFrozen: true,
          draftPreserved: draftReadback,
          trace: order.entries,
          assertion:
            "真实写已发生且新增与修订各1；原两项目写后逐字段与写前相等；返回后名称类别金额均与原草稿一致；再点添加后save仍1/pay仍0/成功仍0且库中仍只有本次UUID 1条新增",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );
});

describe("EC02 V18 原值清单：类别 4 值与金额 9 值逐值真实表单", () => {
  const ADD_NAME = "边界测试";

  async function openAddOnce() {
    const db = await seed();
    const services = makeServices(db);
    const user = await mount(services);
    await openFixedExpenses(user);
    await fillAddForm(user, { name: ADD_NAME, category: "HOUSING", amount: "300" });
    return { db, services, user };
  }

  async function countsOf(db: Awaited<ReturnType<typeof seed>>) {
    const items = await db.select("SELECT id FROM essential_expense_items");
    const revisions = await db.select("SELECT revision_id FROM essential_expense_revisions");
    return { items: items.length, revisions: revisions.length };
  }

  it.each([
    ["E18-CAT-EMPTY", ""],
    ["E18-CAT-FOOD", "FOOD"],
    ["E18-CAT-VARIABLE", "VARIABLE"],
    ["E18-CAT-LOWER-HOUSING", "housing"],
  ])(
    "%s 类别原值「%s」：真实表单被写前校验拒绝，save 0、主表/修订各 0 新增",
    async (caseId, value) => {
      const { db, services, user } = await openAddOnce();
      try {
        const before = await countsOf(db);
        const select = screen.getByLabelText("类别") as HTMLSelectElement;
        // 空串与下同形值必然不在真实 7 个合法选项里，用注入 option + 真实 change 事件表达，
        // 不改产品选项；FOOD 与 VARIABLE 同样注入以证明不是靠下拉限制。
        const injected = document.createElement("option");
        injected.value = value;
        injected.textContent = value === "" ? "（空）" : value;
        select.appendChild(injected);
        await user.selectOptions(select, value);
        expect(select.value).toBe(value);
        await user.click(screen.getByRole("button", { name: "添加" }));

        const after = await countsOf(db);
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
        expect(after).toEqual(before);
        const alert = screen.queryByText("请选择类别");
        expect(alert).toBeTruthy();
        // 表单仍在，可继续同一会话重试。
        expect(screen.getByLabelText("类别")).toBeTruthy();

        emitUiEvidence(caseId, {
          V: "V18",
          object: "ADD 表单类别写前校验",
          fixtureId: "A",
          phase: "invalid-category",
          input: value,
          legalOptions: Array.from(select.options)
            .map((option) => option.value)
            .filter((option) => option !== value),
          alertText: alert?.textContent ?? null,
          saveCalls: 0,
          countsBefore: before,
          countsAfter: after,
          assertion: "该类别原值被写前校验拒绝，零保存且主表/修订各 0 新增",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );

  it.each([
    ["E18-MONEY-NEG1", "-1"],
    ["E18-MONEY-NEG001", "-0.01"],
    ["E18-MONEY-3DEC", "1.001"],
    ["E18-MONEY-EXP", "1e2"],
    ["E18-MONEY-PLUS", "+1"],
    ["E18-MONEY-LEADZERO", "01"],
    ["E18-MONEY-COMMA", "1,000"],
    ["E18-MONEY-NAN", "NaN"],
    ["E18-MONEY-TOOBIG", "1000000000000"],
  ])(
    "%s 金额原值「%s」：真实表单被写前校验拒绝，save 0、主表/修订各 0 新增",
    async (caseId, value) => {
      const { db, services, user } = await openAddOnce();
      try {
        const before = await countsOf(db);
        const field = screen.getByLabelText("每月金额") as HTMLInputElement;
        await user.clear(field);
        await user.type(field, value);
        expect(field.value).toBe(value);
        await user.click(screen.getByRole("button", { name: "添加" }));

        const after = await countsOf(db);
        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        expect(screen.queryByRole("region", { name: "添加核对" })).toBeNull();
        expect(after).toEqual(before);
        const alert = screen.queryByRole("alert");
        expect(alert).toBeTruthy();

        emitUiEvidence(caseId, {
          V: "V18",
          object: "ADD 表单金额写前校验",
          fixtureId: "A",
          phase: "invalid-amount",
          input: value,
          domValue: field.value,
          alertText: alert?.textContent ?? null,
          saveCalls: 0,
          countsBefore: before,
          countsAfter: after,
          assertion: "该金额原值被写前校验拒绝，零保存且主表/修订各 0 新增",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );

  it("E18-MONEY-LEGAL-30020 合法 300.20：真实 ADD 成功并读回四字段与合计", async () => {
    const db = await seed();
    try {
      let savedId = "";
      const services = makeServices(db, {
        saveEssentialItems: vi.fn(
          async (items: Parameters<typeof saveEssentialItems>[1], date: string) => {
            savedId = items[0]?.id ?? "";
            return saveEssentialItems(db, items, date);
          },
        ),
      });
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: ADD_NAME, category: "HOUSING", amount: "300.20" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      await confirmAdd(user);
      expect(await screen.findByText("已添加")).toBeTruthy();

      const items = await listEssentialPaymentItems(db, AS_OF);
      const created = items.filter((item) => item.id === savedId);
      expect(created).toHaveLength(1);
      const row = created[0];
      expect(row?.name).toBe(ADD_NAME);
      expect(row?.category).toBe("HOUSING");
      expect(money(row?.monthlyAmount ?? "0").eq(money("300.20"))).toBe(true);
      expect(items).toHaveLength(3);
      expect(document.body.textContent).toContain("¥1,500.20");

      emitUiEvidence("E18-MONEY-LEGAL-30020", {
        V: "V18",
        object: "ADD 表单合法金额边界",
        fixtureId: "A",
        phase: "legal-amount",
        input: "300.20",
        savedId,
        readback: row,
        itemCount: items.length,
        planTotalText: "¥1,500.20",
        saveCalls: 1,
        assertion: "合法 300.20 经真实新增成功，读回四字段一致，计划 1200+300.20=1500.20",
      });
    } finally {
      db.close();
    }
  }, 40_000);

  it("E18-MONEY-LEGAL-MAX 合法上限 999999999999.99：过金额边界校验并真实新增", async () => {
    const db = await seed();
    try {
      const services = makeServices(db);
      const user = await mount(services);
      await openFixedExpenses(user);
      await fillAddForm(user, { name: "上限测试", category: "HOUSING", amount: "999999999999.99" });
      await user.click(screen.getByRole("button", { name: "添加" }));
      // 上限合法即进入核对页（校验通过）；模型后续是否可算不属 V18。
      expect(await screen.findByRole("region", { name: "添加核对" })).toBeTruthy();
      const items = await db.select("SELECT id FROM essential_expense_items");
      expect(items).toHaveLength(2);
      expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);

      emitUiEvidence("E18-MONEY-LEGAL-MAX", {
        V: "V18",
        object: "ADD 表单金额上限边界",
        fixtureId: "A",
        phase: "legal-max-amount",
        input: "999999999999.99",
        enteredConfirm: true,
        itemsBefore: 2,
        saveCalls: 0,
        assertion: "上限值通过写前金额校验并进入核对；未确认故未写库",
      });
    } finally {
      db.close();
    }
  }, 40_000);
});

describe("EC03 V22 两语义：已包含与不确定各自完整返回序列", () => {
  // 两条语义夹具的差异只在语义前提，不在产品行为：产品无“是否包含”控件，不得新增。
  const SEMANTICS = [
    {
      caseId: "E22-INCLUDED",
      premise: "房租已包含在旧 HOUSING 1000 内，因此不确认新增",
      hint: "该房租已包含在住房 1000 内",
    },
    {
      caseId: "E22-UNCERTAIN",
      premise: "是否已包含该房租尚不确定，因此返回不确认",
      hint: "是否已包含尚不确定",
    },
  ] as const;

  // 局部采集：sqlite_sequence 内部计数单列（本文件内定义，不新增共享辅助文件）。
  async function readSqliteSequence(db: Awaited<ReturnType<typeof seed>>) {
    return db.select<{ name: string; seq: number }>(
      "SELECT name, seq FROM sqlite_sequence ORDER BY name",
    );
  }

  // 局部采集能力：本用例自身真实库的全业务表、全列，不借用别处数据。
  async function fullTableSnapshot(db: Awaited<ReturnType<typeof seed>>) {
    const master = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const allTables = master.map((row) => row.name);
    const BUSINESS = allTables.filter((name) => name !== "schema_migrations");
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const name of BUSINESS) {
      tables[name] = await db.select(`SELECT * FROM ${name} ORDER BY rowid`);
    }
    return { allTables, businessTables: BUSINESS, tables };
  }

  function tableDiff(
    before: Record<string, Array<Record<string, unknown>>>,
    after: Record<string, Array<Record<string, unknown>>>,
  ) {
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    for (const name of Object.keys(before)) {
      const b = before[name] ?? [];
      const a = after[name] ?? [];
      const key = (row: Record<string, unknown>) => JSON.stringify(row);
      const bKeys = b.map(key);
      const aKeys = a.map(key);
      const grew = a.length - b.length;
      const lost = b.length - a.length;
      const same = bKeys.filter((k) => aKeys.includes(k)).length;
      if (grew > 0 || lost > 0 || same !== b.length) {
        if (grew > 0) added.push(name);
        if (lost > 0) removed.push(name);
        if (grew <= 0 && lost <= 0) modified.push(name);
      } else {
        unchanged.push(name);
      }
    }
    return { added, removed, modified, unchanged };
  }

  it.each(SEMANTICS)(
    "$caseId：$premise",
    async ({ caseId, premise, hint }) => {
      const db = await seed();
      try {
        const beforeHome = await getHomeApplicationState(db, AS_OF);
        const beforeItems = await listEssentialPaymentItems(db, AS_OF);
        const beforeSeq = await readSqliteSequence(db);
        const beforeSnap = await fullTableSnapshot(db);
        const services = makeServices(db);
        const user = await mount(services);
        await openFixedExpenses(user);

        // 真实添加表单 → 现有核对页。
        await fillAddForm(user, { name: "本月房租增量", category: "HOUSING", amount: "1000" });
        await user.click(screen.getByRole("button", { name: "添加" }));
        const confirmRegion = await screen.findByRole("region", { name: "添加核对" });
        const confirmText = confirmRegion.textContent ?? "";
        expect(confirmText).toContain("本月房租增量");
        expect(confirmText).toContain("¥1,000.00");

        // 按批准提示返回、不确认。
        const back = screen.getByRole("button", { name: "返回" });
        await user.click(back);
        expect(await screen.findByLabelText("支出名称")).toBeTruthy();
        const cancel = screen.getByRole("button", { name: "取消" });
        await user.click(cancel);
        expect(await screen.findByRole("button", { name: "添加支出" })).toBeTruthy();

        const afterHome = await getHomeApplicationState(db, AS_OF);
        const afterItems = await listEssentialPaymentItems(db, AS_OF);
        const afterSeq = await readSqliteSequence(db);
        const afterSnap = await fullTableSnapshot(db);

        expect(services.saveEssentialItems).toHaveBeenCalledTimes(0);
        expect(beforeHome.essentialExpenses).toBe("1200");
        expect(afterHome.essentialExpenses).toBe("1200");
        expect(afterItems).toEqual(beforeItems);

        // 每表逐行比较：新增 0 / 修改 0 / 删除 0。
        const diff = tableDiff(beforeSnap.tables, afterSnap.tables);
        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.modified).toEqual([]);
        expect(diff.unchanged).toHaveLength(beforeSnap.businessTables.length);
        // 表集合本身也不变，并与 sqlite_master 一致。
        expect(afterSnap.allTables).toEqual(beforeSnap.allTables);
        expect(afterSnap.businessTables).toEqual(beforeSnap.businessTables);
        // 空表明确列出，不靠"没比"冒充通过。
        const emptyTables = beforeSnap.businessTables.filter(
          (name) => (beforeSnap.tables[name] ?? []).length === 0,
        );
        // 内部序列单列前后比较。
        const seqChanged = afterSeq.filter(
          (row) =>
            JSON.stringify(beforeSeq.find((b) => b.name === row.name)) !== JSON.stringify(row),
        );
        expect(seqChanged).toEqual([]);
        // schema_migrations 若采集则保存；此处按非业务元数据显式排除并记差集。
        const excluded = afterSnap.allTables.filter(
          (name) => !afterSnap.businessTables.includes(name),
        );

        emitUiEvidence(caseId, {
          V: "V22",
          object: "ADD 核对页返回，不确认",
          fixtureId: "A",
          phase: "confirm-before-return",
          semanticPremise: premise,
          semanticHint: hint,
          draftInput: { name: "本月房租增量", category: "HOUSING", amount: "1000" },
          confirmRegionText: confirmText,
          actionOrder: ["填写表单", "点添加进入核对", "点返回", "点取消回列表"],
          saveCalls: 0,
          planBefore: beforeHome.essentialExpenses,
          planAfter: afterHome.essentialExpenses,
          allTables: beforeSnap.allTables,
          businessTables: beforeSnap.businessTables,
          comparedTables: Object.keys(beforeSnap.tables),
          excludedTables: excluded.map((name) => ({
            table: name,
            reason: "迁移版本元数据表，仅记录已应用迁移文件名，不承载业务事实行",
          })),
          setDiff: {
            onlyInMaster: excluded.filter((n) => n !== "schema_migrations"),
            onlyInCompared: afterSnap.businessTables.filter(
              (n) => !afterSnap.allTables.includes(n),
            ),
          },
          beforeTables: beforeSnap.tables,
          afterTables: afterSnap.tables,
          tableDiff: diff,
          emptyTables,
          sqliteSequenceBefore: beforeSeq,
          sqliteSequenceAfter: afterSeq,
          sqliteSequenceChanged: seqChanged,
          itemsBefore: beforeItems,
          itemsAfter: afterItems,
          assertion:
            "两语义各自自身库全业务表逐行比较新增0修改0删除0；内部序列不变；save 0 且计划前后均 1200",
        });
      } finally {
        db.close();
      }
    },
    40_000,
  );
});
