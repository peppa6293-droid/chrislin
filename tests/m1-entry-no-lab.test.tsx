// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// M1 rule: test pages (M0Lab / glass demo) must be unreachable from the real entry,
// with or without any env var or URL path.
const FORBIDDEN = /M0Lab|lab\/glass|m0_spike|VITE_M0_LAB|m0-lab|--m0-/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // " 2." files are iCloud conflict copies, not part of the build graph.
    else if (/\.(tsx?|css)$/.test(name) && !/ 2\./.test(name)) out.push(p);
  }
  return out;
}

describe("M1 entry has no test-page path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/");
  });

  it("no source file under src/ mentions the lab", () => {
    const hits = walk(join(process.cwd(), "src")).filter((f) =>
      FORBIDDEN.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("main.tsx renders the real App even with the lab path and env var set", async () => {
    vi.stubEnv("VITE_M0_LAB", "1");
    window.history.pushState({}, "", "/lab/glass");
    document.body.innerHTML = '<div id="root"></div>';
    const renderSpy = vi.fn();
    vi.doMock("react-dom/client", () => ({ createRoot: () => ({ render: renderSpy }) }));
    vi.doMock("../src/ui/App.js", () => ({
      App: function App() {
        return null;
      },
    }));
    await import("../src/main.tsx");
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const element = renderSpy.mock.calls[0][0] as { type: { name: string } };
    expect(element.type.name).toBe("App");
    // The real entry must not opt into the pre-M1 full home.
    expect((element as { props: { scope?: string } }).props.scope).toBeUndefined();
  });
});
