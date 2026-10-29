// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EssentialItemPatch,
  EssentialItemRecord,
  EssentialPaymentRecord,
} from "../src/application/ux-ledger-service.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { FixedExpensesPage } from "../src/ui/FixedExpensesPage.js";

const ITEMS: EssentialItemRecord[] = [
  {
    id: "rent",
    name: "房租",
    category: "HOUSING",
    monthlyAmount: "1800",
    active: true,
  },
  {
    id: "power",
    name: "水电",
    category: "UTILITIES_COMMUNICATIONS",
    monthlyAmount: "228",
    active: true,
  },
  {
    id: "commute",
    name: "地铁",
    category: "TRANSPORT",
    monthlyAmount: "900",
    active: true,
  },
  {
    id: "food",
    name: "菜钱",
    category: "BASIC_FOOD",
    monthlyAmount: "600",
    active: true,
  },
] as unknown as EssentialItemRecord[];

function payment(
  itemId: string,
  amount: string,
  itemName: string,
  id = `${itemId}-1`,
): EssentialPaymentRecord {
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

function makeServices(items: EssentialItemRecord[], payments: EssentialPaymentRecord[]) {
  return {
    listEssentialPaymentItems: vi.fn(async () => items),
    listEssentialPayments: vi.fn(async () => payments),
    saveEssentialItems: vi.fn(async (_patches: EssentialItemPatch[]) => ({ home: {} })),
    recordEssentialPayment: vi.fn(async () => ({ home: {}, monthTotal: "0" })),
  } as unknown as ProductApplicationServices;
}

async function renderPage(items = ITEMS, payments: EssentialPaymentRecord[] = []) {
  const services = makeServices(items, payments);
  const view = render(
    <FixedExpensesPage
      asOfDate="2026-10-14"
      services={services}
      onApplyHome={() => {}}
      onBack={() => {}}
    />,
  );
  await waitFor(() => expect(screen.queryByText("读取中")).toBeNull());
  await act(() => Promise.resolve());
  return { ...view, services };
}

afterEach(cleanup);

describe("P2 fixed-expense page", () => {
  it("renders the signed title, the three summary numbers and the paid share ring", async () => {
    const { container } = await renderPage(ITEMS, [
      payment("rent", "1800", "房租"),
      payment("power", "228", "水电"),
      payment("commute", "600", "地铁"),
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("固定支出·4项");
    const summary = container.querySelector(".fixed-summary");
    if (!summary) throw new Error("summary missing");
    expect(summary.textContent).toContain("¥3,528.00");
    expect(summary.textContent).toContain("¥2,628.00");
    expect(summary.textContent).toContain("¥900.00");
    expect(summary.textContent).toContain("所选月份已付占比");
    expect(
      within(summary as HTMLElement)
        .getByRole("img")
        .getAttribute("aria-label"),
    ).toBe("所选月份已付占比 74.5%");
  });

  it("prints 未付 for an unpaid category and never uses 待付", async () => {
    const { container } = await renderPage(ITEMS, [payment("rent", "1800", "房租")]);
    const categories = container.querySelector(".fixed-categories");
    if (!categories) throw new Error("categories missing");
    expect(categories.textContent).toContain("未付");
    expect(container.textContent).not.toContain("待付");
    expect(container.textContent).not.toContain("本月已付占比");
    expect(container.textContent).not.toContain("再记一笔");
  });

  it("prints the frozen over-paid line for a category above its plan", async () => {
    const { container } = await renderPage(ITEMS, [
      payment("rent", "2200", "房租"),
      payment("rent", "200", "房租", "rent-2"),
    ]);
    const housing = container.querySelector<HTMLElement>('.fixed-category[data-state="OVERPAID"]');
    if (!housing) throw new Error("overpaid category missing");
    expect(housing.textContent).toContain("已付 ¥2,400.00 / 计划 ¥1,800.00");
    expect(housing.textContent).toContain("超计划 ¥600.00 · 已付/计划 133.3%");
    expect(housing.querySelector<HTMLElement>(".fixed-progress > span")?.style.width).toBe("100%");
  });

  it("hides 记一笔 on a paid row and keeps it on an unpaid row", async () => {
    const { container } = await renderPage(ITEMS, [payment("rent", "1800", "房租")]);
    const rows = [...container.querySelectorAll<HTMLElement>(".fixed-item")];
    const paidRow = rows.find((row) => row.textContent?.includes("房租"));
    const unpaidRow = rows.find((row) => row.textContent?.includes("水电"));
    expect(paidRow?.textContent).toContain("已付 ¥1,800.00 · 已付/计划 100%");
    expect(within(paidRow as HTMLElement).queryByRole("button", { name: "记一笔" })).toBeNull();
    expect(within(unpaidRow as HTMLElement).getByRole("button", { name: "记一笔" })).toBeTruthy();
    expect(unpaidRow?.textContent).toContain("未付");
  });

  it("fills the payment form from an unpaid row and focuses the amount", async () => {
    const user = userEvent.setup();
    const { container } = await renderPage(ITEMS, []);
    const unpaidRow = [...container.querySelectorAll<HTMLElement>(".fixed-item")].find((row) =>
      row.textContent?.includes("水电"),
    );
    await user.click(within(unpaidRow as HTMLElement).getByRole("button", { name: "记一笔" }));
    expect(screen.getByLabelText("金额")).toHaveProperty("value", "228");
    expect(document.activeElement).toBe(screen.getByLabelText("金额"));
  });

  it("keeps ownership unknown when the month has an unowned payment", async () => {
    const { container } = await renderPage(ITEMS, [
      payment("rent", "1800", "房租"),
      payment("", "300", "旧记录"),
    ]);
    const rows = [...container.querySelectorAll<HTMLElement>(".fixed-item")];
    const powerRow = rows.find((row) => row.textContent?.includes("水电"));
    // 无归属支付只进页面合计，不让条目/分类误显示「未付」。
    expect(powerRow?.textContent).not.toContain("未付");
    const categories = container.querySelectorAll(".fixed-category");
    for (const row of categories) {
      if (row.getAttribute("data-state") === "UNPAID")
        expect(row.textContent).not.toContain("未付");
    }
    const summary = container.querySelector(".fixed-summary");
    expect(summary?.textContent).toContain("¥2,100.00");
  });

  it("shows only the two signed empty-state lines with no icon and no CTA", async () => {
    const { container } = await renderPage([], []);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("固定支出·0项");
    const empty = container.querySelector(".fixed-empty");
    if (!empty) throw new Error("empty state missing");
    expect(empty.textContent).toBe("暂无固定支出");
    expect(empty.querySelector("button")).toBeNull();
    expect(empty.querySelector("svg")).toBeNull();
    expect(container.textContent).not.toContain("0/0");
    expect(container.textContent).not.toContain("0%");
  });
});
