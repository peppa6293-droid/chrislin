// 段 2 证据截图 + DOM 断言（本机 Chrome CDP，无网络、无真实数据库）。
// 用法: node shoot.mjs --out ../shots
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const out = resolve(args.out ?? "shots");
await mkdir(out, { recursive: true });

const HOME_STATES = ["actual"];
const FIXED_STATES = [];
const WIDTHS = [390, 980];

const profile = await mkdtemp(resolve(tmpdir(), "xqj-f10-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let socket;
const metrics = [];
const problems = [];

try {
  let port;
  for (let i = 0; i < 160; i++) {
    try {
      port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!port) throw new Error("Chrome did not expose its debugging port");
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });

  let seq = 0;
  const waiting = new Map();
  const exceptions = [];
  const remote = [];
  socket.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.exceptionThrown")
      exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Network.requestWillBeSent" && /^https?:/.test(m.params.request.url))
      remote.push(m.params.request.url);
    if (m.id && waiting.has(m.id)) {
      const { resolve: res, reject, timer } = waiting.get(m.id);
      clearTimeout(timer);
      waiting.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        waiting.delete(id);
        rej(new Error(`CDP timeout ${method}`));
      }, 20000);
      waiting.set(id, { resolve: res, reject: rej, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const base = pathToFileURL(resolve("dist/index.html"));

  async function open({ view, state, width, height = 1200, scale = 1 }) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 760,
      screenWidth: width,
      screenHeight: height,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const query = new URLSearchParams({ view, state, scale: String(scale) }).toString();
    const url = new URL(base.href);
    url.search = query;
    await send("Page.navigate", { url: url.href });
    const marker =
      view === "home"
        ? `document.querySelectorAll('.v2-ring-row').length > 0`
        : `!!document.querySelector('.v2-fixed-page')`;
    for (let i = 0; i < 200; i++) {
      try {
        const ready = await evaluate(
          `location.search === ${JSON.stringify(`?${query}`)} && document.readyState === 'complete' && ${marker}`,
        );
        if (ready) break;
      } catch {
        /* document still swapping */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    await evaluate("document.fonts.ready");
    await evaluate(`(() => {
      const sizes = [...document.body.querySelectorAll('*')].map(el => ({el, fs: parseFloat(getComputedStyle(el).fontSize), lh: parseFloat(getComputedStyle(el).lineHeight)}));
      for (const {el,fs,lh} of sizes) {el.style.setProperty('font-size', (fs*2)+'px','important'); if(Number.isFinite(lh))el.style.setProperty('line-height',(lh*2)+'px','important');}
    })()`);
    await new Promise((r) => setTimeout(r, 150));
  }

  async function shoot(file, width) {
    const m = await send("Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(m.cssContentSize.height), 4600);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await writeFile(resolve(out, file), Buffer.from(shot.data, "base64"));
    return height;
  }

  const PROBE = (view) => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const fonts = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontSize : null;
    };
    const base = {
      view: viewEl(),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      height: document.documentElement.scrollHeight,
    };
    function viewEl() {
      return document.querySelector(".v2-structure-card") ? "home" : "fixed";
    }
    if (base.view === "home") {
      const ring = document.querySelector(".v2-ring");
      const ringRect = rect(ring);
      const centreRect = rect(document.querySelector(".v2-ring__centre-amount"));
      const svgRect = rect(document.querySelector(".v2-ring__chart"));
      const innerCircle =
        document.querySelector(".v2-ring__track.is-inner") ??
        document.querySelector(".v2-ring__arc.is-inner");
      const innerR = innerCircle ? Number(innerCircle.getAttribute("r")) : null;
      const innerStroke = innerCircle
        ? Number(innerCircle.getAttribute("stroke-width") ?? 13)
        : null;
      const holeRadius =
        innerR != null && innerStroke != null && svgRect
          ? (innerR - innerStroke / 2) * (svgRect.w / 240)
          : null;
      const dx = centreRect && svgRect ? Math.abs(centreRect.x + centreRect.w / 2 - (svgRect.x + svgRect.w / 2)) : null;
      const dy = centreRect && svgRect ? Math.abs(centreRect.y + centreRect.h / 2 - (svgRect.y + svgRect.h / 2)) : null;
      const clearance =
        centreRect && holeRadius && dx != null && dy != null
          ? +(holeRadius - Math.hypot(centreRect.w / 2 + dx, centreRect.h / 2 + dy)).toFixed(2)
          : null;
      return {
        ...base,
        arcs: document.querySelectorAll(".v2-ring__arc").length,
        // R1 回归探针：任务书 §3.4「不在环上叠标记」，环内 over-mark 必须为 0。
        overMarks: document.querySelectorAll(".v2-ring__over-mark").length,
        markerColors: [...document.querySelectorAll(".v2-ring-row__marker")].map(
          (el) => getComputedStyle(el).backgroundColor,
        ),
        arcDash: [...document.querySelectorAll(".v2-ring__arc")].map((a) =>
          a.getAttribute("stroke-dasharray"),
        ),
        ring: ringRect,
        chart: svgRect,
        centre: centreRect,
        dx,
        dy,
        holeRadius: holeRadius == null ? null : +holeRadius.toFixed(2),
        centreClearancePx: clearance,
        centreFont: fonts(".v2-ring__centre-amount"),
        amountFont: fonts(".v2-ring-row__amount"),
        rowFont: fonts(".v2-ring-row__name"),
        percentFont: fonts(".v2-ring-row__percent"),
        rows: [...document.querySelectorAll(".v2-ring-row")].map((row) => ({
          name: row.querySelector(".v2-ring-row__name")?.textContent,
          amount: row.querySelector(".v2-ring-row__amount")?.textContent,
          percent: row.querySelector(".v2-ring-row__percent")?.textContent ?? null,
          pressed: row.getAttribute("aria-pressed"),
          marker: !!row.querySelector(".v2-ring-row__marker"),
          over: row.querySelector(".v2-ring-row__over")?.textContent ?? null,
        })),
        ariaLabel: document.querySelector(".v2-ring__chart")?.getAttribute("aria-label"),
        surplus: text(".v2-card__value"),
        hasDots: !!document.querySelector(".v2-structure-dots"),
        hasCompareBar: !!document.querySelector(".v2-structure-bar"),
        hasLine: !!document.querySelector(".v2-card__line"),
      };
    }
    const summary = document.querySelector(".fixed-summary");
    return {
      ...base,
      title: text("h1"),
      summary: summary?.textContent ?? null,
      ringLabel: document.querySelector(".v2-paid-ring")?.getAttribute("aria-label") ?? null,
      ringArc: !!document.querySelector(".v2-paid-ring__arc"),
      empty: rect(document.querySelector(".fixed-empty")),
      emptyText: text(".fixed-empty p"),
      emptyInnerWidth: document.querySelector(".fixed-empty")?.getBoundingClientRect().width ?? null,
      categories: [...document.querySelectorAll(".fixed-category")].map((row) => ({
        state: row.getAttribute("data-state"),
        text: row.textContent,
        width: row.querySelector(".fixed-progress > span")?.style.width,
      })),
      items: [...document.querySelectorAll(".fixed-item")].map((row) => ({
        text: row.textContent,
        hasPayButton: !!row.querySelector(".fixed-item__pay"),
      })),
      titleFont: fonts("h1"),
      // R3 回归探针：分类区只允许单列基线（不得出现新断点带来的双列）。
      categoryColumns: (() => {
        const grid = document.querySelector(".fixed-categories__grid");
        return grid ? getComputedStyle(grid).gridTemplateColumns : null;
      })(),
      pageText: document.body.innerText,
    };
  };

  for (const width of WIDTHS) {
    for (const state of HOME_STATES) {
      await open({ view: "home", state, width });
      const probe = await evaluate(`(${PROBE.toString()})()`);
      const file = `home-${state}-${width}.png`;
      probe.file = file;
      probe.shotHeight = await shoot(file, width);
      metrics.push(probe);
    }
    for (const state of FIXED_STATES) {
      await open({ view: "fixed", state, width });
      const probe = await evaluate(`(${PROBE.toString()})()`);
      const file = `fixed-${state}-${width}.png`;
      probe.file = file;
      probe.shotHeight = await shoot(file, width);
      metrics.push(probe);
    }
  }

  await writeFile(resolve(out, "metrics.json"), JSON.stringify({metrics,problems,exceptions,remote},null,2));
  console.log(JSON.stringify({metrics,exceptions,remote},null,2));
} finally {
  socket?.close();
  chrome.kill("SIGKILL");
}
