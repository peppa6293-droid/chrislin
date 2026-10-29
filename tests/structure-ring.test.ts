import { describe, expect, it } from "vitest";
import { structureSurplus } from "../src/ui/structure-ring.js";

/**
 * P1-b：结构卡余量必须与两环同源（所选月份 ACTUAL 收入），
 * 缺失态不补零，单表求和不得出现 27,582.50 双计。
 */
describe("P1-b structure surplus on actual income", () => {
  it("matches the 2026-10 baseline: −4,255.48 and −30.9% of income", () => {
    const surplus = structureSurplus({
      income: "13791.25",
      essentialExpenses: "3528.00",
      mandatoryDebtService: "14518.73",
    });
    expect(surplus.available).toBe(true);
    expect(surplus.amount).toBe("-4255.48");
    expect(surplus.percent).toBe("-30.9%");
    expect(Number.parseFloat(surplus.ratio ?? "0")).toBeCloseTo(-4255.48 / 13791.25, 8);
  });

  it("uses the same income for a positive surplus in the steady band", () => {
    const surplus = structureSurplus({
      income: "13000",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
    });
    expect(surplus.amount).toBe("8672");
    expect(surplus.percent).toBe("66.7%");
  });

  it("keeps an exact zero surplus as zero, not missing", () => {
    const surplus = structureSurplus({
      income: "1000",
      essentialExpenses: "400",
      mandatoryDebtService: "600",
    });
    expect(surplus.available).toBe(true);
    expect(surplus.amount).toBe("0");
    expect(surplus.percent).toBe("0%");
  });

  it("returns unavailable for missing income so the card can print — instead of 0", () => {
    const surplus = structureSurplus({
      income: "0",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
    });
    expect(surplus.available).toBe(false);
    expect(surplus.amount).toBeNull();
    expect(surplus.ratio).toBeNull();
    expect(surplus.percent).toBeNull();
  });

  it("returns unavailable for negative income (data layer forbids it)", () => {
    const surplus = structureSurplus({
      income: "-100",
      essentialExpenses: "0",
      mandatoryDebtService: "0",
    });
    expect(surplus.available).toBe(false);
    expect(surplus.amount).toBeNull();
  });

  it("computes from a single income source, never the 27,582.50 double count", () => {
    const single = structureSurplus({
      income: "13791.25",
      essentialExpenses: "3528",
      mandatoryDebtService: "14518.73",
    });
    const doubled = structureSurplus({
      income: "27582.50",
      essentialExpenses: "3528",
      mandatoryDebtService: "14518.73",
    });
    expect(single.amount).toBe("-4255.48");
    expect(doubled.amount).toBe("9535.77");
    expect(single.amount).not.toBe(doubled.amount);
    // 单源口径下月供占收入 105.3%，双计会掉到 52.7%——后者不得出现。
    expect(single.percent).not.toBe("52.7%");
  });

  it("keeps full overrun beyond 200% without clamping the display number", () => {
    const surplus = structureSurplus({
      income: "1000",
      essentialExpenses: "0",
      mandatoryDebtService: "2500",
    });
    expect(surplus.amount).toBe("-1500");
    expect(surplus.percent).toBe("-150%");
  });
});
