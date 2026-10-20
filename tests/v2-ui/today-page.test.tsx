// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import type { Repositories } from "../../src/persistence/repositories.js";
import { V2Today } from "../../src/ui/v2-today.js";

const repositories = {
  listV2Expenses: vi.fn(),
} as unknown as Repositories;

function makeService(
  overrides: {
    summary?: Promise<{ dailyExpenseTotal: string; billStatuses: never[] }>;
    recent?: Promise<
      Array<{
        id: string;
        amount: string;
        currency: string;
        occurredOn: string;
        categoryId: string;
        description: string;
        kind: "CASH_DEBIT";
        accountId: string;
        profileId: string;
      }>
    >;
  } = {},
) {
  return {
    getMonthSummary: vi.fn(
      overrides.summary
        ? () => overrides.summary
        : () => Promise.resolve({ dailyExpenseTotal: "0.00", billStatuses: [] }),
    ),
  } as unknown as V2ExpenseService & { getMonthSummary: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EXEC-U-03 V2 today page", () => {
  it("renders the loading state before data resolves", () => {
    vi.spyOn(repositories, "listV2Expenses").mockReturnValue(new Promise(() => {}) as never);
    render(
      <V2Today
        expenseService={makeService()}
        repositories={repositories}
        profileId="profile-v2"
        onGoRecord={vi.fn()}
      />,
    );
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("shows the monthly amount, entry count, and recent rows", async () => {
    vi.spyOn(repositories, "listV2Expenses").mockResolvedValue([
      { id: "e1", amount: "35.00", categoryId: "cat-food", occurredOn: "2026-10-20" },
      { id: "e2", amount: "12.50", categoryId: "cat-transport", occurredOn: "2026-10-19" },
      { id: "e3", amount: "8.00", categoryId: "cat-food", occurredOn: "2026-10-18" },
    ] as never);
    render(
      <V2Today
        expenseService={makeService({
          summary: Promise.resolve({ dailyExpenseTotal: "123.45", billStatuses: [] }),
        })}
        repositories={repositories}
        profileId="profile-v2"
        onGoRecord={vi.fn()}
      />,
    );
    expect(await screen.findByText("¥123.45")).toBeTruthy();
    expect(screen.getByText("3 笔")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("查看全部")).toBeTruthy();
  });

  it("shows the friendly empty state without a duplicate record button", async () => {
    vi.spyOn(repositories, "listV2Expenses").mockResolvedValue([] as never);
    render(
      <V2Today
        expenseService={makeService()}
        repositories={repositories}
        profileId="profile-v2"
        onGoRecord={vi.fn()}
      />,
    );
    expect(await screen.findByText("还没有记录，记下第一笔吧。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "记一笔" })).toBeNull();
  });

  it("invokes onGoRecord from the recent list action", async () => {
    const onGoRecord = vi.fn();
    const user = userEvent.setup();
    vi.spyOn(repositories, "listV2Expenses").mockResolvedValue([
      { id: "e1", amount: "1.00", categoryId: "cat-food", occurredOn: "2026-10-20" },
    ] as never);
    render(
      <V2Today
        expenseService={makeService()}
        repositories={repositories}
        profileId="profile-v2"
        onGoRecord={onGoRecord}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
    expect(onGoRecord).toHaveBeenCalledTimes(1);
  });

  it("shows the error state when loading fails", async () => {
    const failing = {
      getMonthSummary: vi.fn().mockRejectedValue(new Error("load failed")),
    } as unknown as V2ExpenseService;
    vi.spyOn(repositories, "listV2Expenses").mockResolvedValue([] as never);
    render(
      <V2Today
        expenseService={failing}
        repositories={repositories}
        profileId="profile-v2"
        onGoRecord={vi.fn()}
      />,
    );
    expect(await screen.findByText("数据加载失败，请重试。")).toBeTruthy();
  });
});
