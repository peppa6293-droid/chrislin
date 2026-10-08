// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AcceptanceHistories,
  AcceptanceRuntimeInfo,
  V4AcceptanceSandboxService,
} from "../src/application/v4-acceptance-sandbox-service.js";
import type { V4FinancialReadState } from "../src/application/v4-foundation-service.js";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../src/application/v4-acceptance-sandbox-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/application/v4-acceptance-sandbox-service.js")>();
  return { ...actual, createV4AcceptanceSandboxService: mocks.create };
});

import { V4AcceptanceApp } from "../src/ui/V4AcceptanceApp.js";

const runtime: AcceptanceRuntimeInfo = {
  identifier: "com.personalfinance.console.v4acceptance",
  appDataDir: "/Users/tester/Library/Application Support/com.personalfinance.console.v4acceptance",
  databasePath:
    "/Users/tester/Library/Application Support/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3",
};

const readState = {
  planningIncome: { amount: "13000", source: "STABLE_BASELINE" },
  actualIncome: [],
  cashAccounts: [{ name: "余额宝", balance: "4805.61" }],
} as unknown as V4FinancialReadState;

const histories: AcceptanceHistories = {
  planning: [
    {
      revision_id: 1,
      period_month: "2026-10",
      as_of_date: "2026-10-04",
      decision: "OVERRIDE",
      amount: "15500",
    },
    {
      revision_id: 2,
      period_month: "2026-10",
      as_of_date: "2026-10-05",
      decision: "INHERIT",
      amount: null,
    },
  ],
  actual: [],
  cash: [],
};

function makeService(overrides: { reset?: () => Promise<void> } = {}) {
  return {
    read: vi.fn().mockResolvedValue(readState),
    stableIncome: vi.fn().mockResolvedValue("13000"),
    histories: vi.fn().mockResolvedValue(histories),
    reset: vi.fn(overrides.reset ?? (() => Promise.resolve())),
  } as unknown as V4AcceptanceSandboxService;
}

async function renderReadyApp(service = makeService()) {
  mocks.create.mockResolvedValue({ service, runtime });
  render(<V4AcceptanceApp />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "恢复初始测试数据" }).disabled).toBe(false),
  );
  return service;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("V4 acceptance reset confirmation", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  it("starts hidden and opens an in-app confirmation from the reset button", async () => {
    await renderReadyApp();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "恢复初始测试数据" }));

    expect(screen.getByRole("alertdialog").textContent).toContain("确定恢复初始测试数据吗？");
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "这只会清空 V4 验收版里的测试记录，不会影响正式账本。",
    );
  });

  it("cancel closes confirmation without invoking reset or showing success", async () => {
    const service = await renderReadyApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "恢复初始测试数据" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(service.reset).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("confirm invokes reset once and renders success feedback", async () => {
    const service = await renderReadyApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "恢复初始测试数据" }));
    await user.click(screen.getByRole("button", { name: "确认恢复" }));

    expect(service.reset).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain("测试数据已恢复");
  });

  it("prevents a duplicate confirmation while reset is pending", async () => {
    let finishReset!: () => void;
    const service = await renderReadyApp(
      makeService({ reset: () => new Promise<void>((resolve) => (finishReset = resolve)) }),
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "恢复初始测试数据" }));
    const confirm = screen.getByRole("button", { name: "确认恢复" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(service.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "恢复初始测试数据" }).disabled).toBe(true);
    await act(async () => finishReset());
    expect((await screen.findByRole("status")).textContent).toContain("测试数据已恢复");
  });

  it("renders an error when the protected reset service fails", async () => {
    await renderReadyApp(makeService({ reset: () => Promise.reject(new Error("reset refused")) }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "恢复初始测试数据" }));
    await user.click(screen.getByRole("button", { name: "确认恢复" }));

    expect((await screen.findByRole("alert")).textContent).toContain("reset refused");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("maps stored Planning decision values to consumer-language history labels", async () => {
    await renderReadyApp();
    const table = screen
      .getByRole("heading", { name: "月收入设置记录" })
      .parentElement?.querySelector("table");
    expect(table).not.toBeNull();
    expect(within(table as HTMLElement).getByText("本月单独设置").textContent).toBe("本月单独设置");
    expect(within(table as HTMLElement).getByText("跟随平时收入").textContent).toBe("跟随平时收入");
    expect(within(table as HTMLElement).queryByText("OVERRIDE")).toBeNull();
    expect(within(table as HTMLElement).queryByText("INHERIT")).toBeNull();
  });
});
