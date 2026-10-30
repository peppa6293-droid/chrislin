import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const cssFiles = [
  "src/style.css",
  ...readdirSync(join(root, "src/ui"))
    .filter((f) => f.endsWith(".css") && !/ 2\./.test(f))
    .map((f) => `src/ui/${f}`),
];
const read = (p: string) => readFileSync(join(root, p), "utf8");
const allCss = cssFiles.map((f) => ({ f, ast: postcss.parse(read(f)) }));

describe("M1 iOS platform baseline (no visual change)", () => {
  it("viewport covers the notch and never disables zoom", () => {
    const html = read("index.html");
    expect(html).toContain("viewport-fit=cover");
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });

  it("every :hover rule sits inside a hover-capable, fine-pointer media query", () => {
    const offenders: string[] = [];
    for (const { f, ast } of allCss)
      ast.walkRules((rule) => {
        if (!rule.selector.includes(":hover")) return;
        let p: postcss.Container | postcss.Document | undefined = rule.parent;
        let gated = false;
        while (p) {
          if (p.type === "atrule" && (p as postcss.AtRule).params.includes("hover: hover"))
            gated = true;
          p = p.parent;
        }
        if (!gated) offenders.push(`${f}: ${rule.selector}`);
      });
    expect(offenders).toEqual([]);
  });

  it("no raw 100vh-style heights remain; dynamic units are used", () => {
    const raw: string[] = [];
    for (const { f, ast } of allCss)
      ast.walkDecls((d) => {
        if (/(^|[^ds])\d+(\.\d+)?vh\b/.test(d.value)) raw.push(`${f}: ${d.prop}: ${d.value}`);
      });
    expect(raw).toEqual([]);
  });

  it("global tap highlight is off and controls use touch-action: manipulation", () => {
    const css = read("src/style.css");
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(css).toMatch(/touch-action:\s*manipulation/);
  });

  it("text inputs are at least 16px on touch devices, after every other input rule", () => {
    const style = postcss.parse(read("src/style.css"));
    let last = -1;
    let idx = 0;
    let coarseIdx = -1;
    style.walkRules((r) => {
      idx += 1;
      if (/(^|[\s,])(input|select|textarea)(,|$|\s)/.test(r.selector) && r.parent?.type === "root")
        last = idx;
      if (
        r.parent?.type === "atrule" &&
        (r.parent as postcss.AtRule).params.includes("pointer: coarse") &&
        r.selector.split(",").some((s) => s.trim() === "input")
      )
        coarseIdx = idx;
    });
    expect(coarseIdx).toBeGreaterThan(last);
    const coarse = style.nodes.find(
      (n) => n.type === "atrule" && (n as postcss.AtRule).params.includes("pointer: coarse"),
    ) as postcss.AtRule | undefined;
    expect(coarse).toBeDefined();
    let size = "";
    coarse?.walkDecls("font-size", (d) => {
      size = d.value;
    });
    expect(size).toBe("16px");
  });

  it("fixed top chrome pads below the status bar", () => {
    const surface = read("src/ui/v2-surface.css");
    expect((surface.match(/safe-area-inset-top/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
