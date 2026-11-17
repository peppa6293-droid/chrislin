// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/ui/App.js";
import { createIllustrativeServices } from "../src/ui/themes/illustrative-services.js";
import { DEMO_MEMBER_STORAGE_KEY, THEME_STORAGE_KEY } from "../src/ui/themes/theme-preference.js";

const services = createIllustrativeServices();

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function shellTheme(): string | null {
  return document.querySelector(".m2-theme")?.getAttribute("data-theme") ?? null;
}

async function openThemePage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "我的财务" }));
  await user.click(await screen.findByRole("button", { name: /主题皮肤/ }));
  expect(await screen.findByRole("heading", { name: "主题皮肤" })).toBeTruthy();
}

describe("会员主题皮肤", () => {
  it("lists the default skin and three member skins from 我的财务", async () => {
    const user = userEvent.setup();
    render(<App services={services} />);
    const home = await screen.findByTestId("m1-home");
    expect(home.textContent).toContain("当前皮肤 · 默认");
    expect(shellTheme()).toBe("default");

    await user.click(screen.getByRole("button", { name: "我的财务" }));
    const menu = await screen.findByRole("navigation", { name: "我的财务" });
    expect(menu.textContent).toContain("固定支出");
    expect(menu.textContent).toContain("资料维护");
    expect(menu.textContent).toContain("主题皮肤");
    expect(screen.getByTestId("m2-finance-skin").textContent).toContain("当前皮肤 · 默认");
    await user.click(screen.getByRole("button", { name: /主题皮肤/ }));
    expect(await screen.findByRole("heading", { name: "主题皮肤" })).toBeTruthy();
    expect(screen.getByTestId("m2-theme-current").textContent).toContain("当前皮肤 · 默认");
    for (const name of ["可爱猫咪", "可爱小狗", "像素风"]) {
      const card = screen.getByRole("button", { name: new RegExp(name) });
      expect(card.textContent).toContain("会员专属");
      expect(card.textContent).toContain("看短预览");
    }
    expect(screen.getByRole("button", { name: /默认/ }).textContent).toContain("使用中");
  });

  it("lets a non-member preview a skin without applying it", async () => {
    const user = userEvent.setup();
    render(<App services={services} />);
    await screen.findByTestId("m1-home");
    await openThemePage(user);

    await user.click(screen.getByRole("button", { name: /可爱猫咪/ }));
    const preview = screen.getByRole("region", { name: "皮肤短预览" });
    expect(preview.getAttribute("data-theme")).toBe("cute-cat");
    expect(preview.textContent).toContain("会员专属");
    expect(preview.textContent).toContain("还不能应用到首页和我的财务");
    expect(shellTheme()).toBe("default");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).not.toBe("cute-cat");
  });

  it("applies a member skin, keeps it after remount, and can return to default", async () => {
    const user = userEvent.setup();
    render(<App services={services} />);
    await screen.findByTestId("m1-home");
    await openThemePage(user);

    await user.click(screen.getByRole("checkbox", { name: "演示：当作会员" }));
    await user.click(screen.getByRole("button", { name: /可爱猫咪/ }));
    expect(shellTheme()).toBe("cute-cat");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("cute-cat");
    expect(localStorage.getItem(DEMO_MEMBER_STORAGE_KEY)).toBe("1");
    expect(screen.getByRole("status").textContent).toContain("已应用可爱猫咪");

    await user.click(screen.getByRole("button", { name: "今天" }));
    expect((await screen.findByTestId("m2-skin-mark")).textContent).toBe("会员皮肤 · 可爱猫咪");
    expect(screen.getByTestId("m1-home").querySelector("nav")).toBeNull();

    cleanup();
    render(<App services={services} />);
    expect((await screen.findByTestId("m2-skin-mark")).textContent).toBe("会员皮肤 · 可爱猫咪");
    expect(shellTheme()).toBe("cute-cat");

    await openThemePage(user);
    await user.click(screen.getByRole("button", { name: /默认/ }));
    expect(shellTheme()).toBe("default");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("default");
    await user.click(screen.getByRole("button", { name: "今天" }));
    expect((await screen.findByTestId("m2-skin-mark")).textContent).toBe("当前皮肤 · 默认");
  });

  it("ignores a stored member skin when the demo member flag is off", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "pixel");
    localStorage.setItem(DEMO_MEMBER_STORAGE_KEY, "0");
    render(<App services={services} />);
    await screen.findByTestId("m1-home");
    expect(shellTheme()).toBe("default");
    expect(screen.getByTestId("m2-skin-mark").textContent).toBe("当前皮肤 · 默认");
  });
});
