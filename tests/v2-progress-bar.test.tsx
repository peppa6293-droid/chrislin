// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { V2ProgressBar } from "../src/ui/V2ProgressBar.js";

afterEach(cleanup);

describe("V2ProgressBar ARIA range", () => {
  it("caps aria-valuenow at max while valuetext keeps the real percentage", () => {
    render(<V2ProgressBar value={188} max={120} label="本月消费占目标比例" />);
    const bar = screen.getByRole("progressbar", { name: "本月消费占目标比例" });

    expect(bar.getAttribute("aria-valuenow")).toBe("120");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("120");
    expect(bar.getAttribute("aria-valuetext")).toBe("188%");
  });

  it("defaults to a 100 max and reports the value as text", () => {
    render(<V2ProgressBar value={3} label="默认进度" />);
    const bar = screen.getByRole("progressbar", { name: "默认进度" });

    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuetext")).toBe("3%");
  });

  it("clamps negative values to zero", () => {
    render(<V2ProgressBar value={-5} label="负值进度" />);
    const bar = screen.getByRole("progressbar", { name: "负值进度" });

    expect(bar.getAttribute("aria-valuenow")).toBe("0");
  });
});
