// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "../../src/persistence/repositories.js";
import { V2TodayTask } from "../../src/ui/v2-today-task.js";

const repositories = { listV2Expenses: vi.fn() } as unknown as Repositories;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderTask(onGoRecord = vi.fn()) {
  render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={onGoRecord} />);
  return onGoRecord;
}

function assertNoDangerOrScore(container: HTMLElement) {
  expect(container.innerHTML).not.toContain("danger");
  expect(container.textContent).not.toMatch(/\d+\s*\/\s*100/);
  expect(container.textContent).not.toMatch(/\d+\s*分(?!钟)/);
}

describe("EXEC-U-05 deterministic today task", () => {
  it("shows the default record task when there are no records this month", async () => {
    vi.mocked(repositories.listV2Expenses).mockResolvedValue([] as never);
    const { container } = render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={vi.fn()} />);
    expect(await screen.findByText("记下第一笔花销")).toBeTruthy();
    expect(screen.getByText("从第一笔开始，建立你的财务画面")).toBeTruthy();
    expect(screen.getByText("约 10 秒")).toBeTruthy();
    const action = screen.getByRole("button", { name: "去记录" });
    expect(action.disabled).toBe(false);
    assertNoDangerOrScore(container);
    expect(container.querySelectorAll("section.v2-today-task")).toHaveLength(1);
    expect(repositories.listV2Expenses).toHaveBeenCalledWith("profile-v2", "2026-10");
  });

  it("shows today's record task when this month has older records only", async () => {
    vi.mocked(repositories.listV2Expenses).mockResolvedValue([
      { id: "e1", occurredOn: "2026-10-18" },
    ] as never);
    render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={vi.fn()} />);
    expect(await screen.findByText("记下一笔今天的花销")).toBeTruthy();
    expect(screen.getByRole("button", { name: "去记录" }).disabled).toBe(false);
  });

  it("marks the task done when today has two records", async () => {
    vi.mocked(repositories.listV2Expenses).mockResolvedValue([
      { id: "e1", occurredOn: "2026-10-20" },
      { id: "e2", occurredOn: "2026-10-20" },
    ] as never);
    const { container } = render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={vi.fn()} />);
    const action = await screen.findByRole("button", { name: "已完成" });
    expect(action.disabled).toBe(true);
    expect(screen.getByText("今天已记 2 笔")).toBeTruthy();
    assertNoDangerOrScore(container);
  });

  it("routes the pending CTA to the record page once", async () => {
    const user = userEvent.setup();
    vi.mocked(repositories.listV2Expenses).mockResolvedValue([] as never);
    const onGoRecord = renderTask();
    await user.click(await screen.findByRole("button", { name: "去记录" }));
    expect(onGoRecord).toHaveBeenCalledTimes(1);
  });

  it("does not route the completed CTA", async () => {
    const user = userEvent.setup();
    vi.mocked(repositories.listV2Expenses).mockResolvedValue([
      { id: "e1", occurredOn: "2026-10-20" },
    ] as never);
    const onGoRecord = renderTask();
    await user.click(await screen.findByRole("button", { name: "已完成" }));
    expect(onGoRecord).toHaveBeenCalledTimes(0);
  });

  it("renders nothing while loading", () => {
    vi.mocked(repositories.listV2Expenses).mockReturnValue(new Promise(() => {}) as never);
    const { container } = render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={vi.fn()} />);
    expect(container.children).toHaveLength(0);
    expect(screen.queryByText("加载中…")).toBeNull();
  });

  it("renders nothing after a load failure", async () => {
    vi.mocked(repositories.listV2Expenses).mockRejectedValue(new Error("load failed"));
    const { container } = render(<V2TodayTask repositories={repositories} profileId="profile-v2" onGoRecord={vi.fn()} />);
    await waitFor(() => expect(container.children).toHaveLength(0));
  });
});
