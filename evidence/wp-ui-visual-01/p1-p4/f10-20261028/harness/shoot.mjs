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

const HOME_STATES = [
  "roomy",
  "light-over",
  "overload",
  "zero-burden",
  "over-outer",
  "over-both",
  "over-large",
  "over-split",
  "pending",
];
const FIXED_STATES = ["normal", "unpaid", "overpaid", "zero-plan", "empty", "unowned"];
const WIDTHS = [390, 760, 980, 1440];

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

  // 200% 文字：根字号 32px，量中心收入是否侵入圆环。
  for (const [view, state] of [
    ["home", "roomy"],
    ["home", "over-large"],
    ["home", "zero-burden"],
    ["fixed", "normal"],
  ]) {
    for (const width of [390, 980]) {
      await open({ view, state, width, scale: 2 });
      const probe = await evaluate(`(${PROBE.toString()})()`);
      probe.file = `text200-${view}-${state}-${width}.png`;
      probe.scale = 2;
      probe.rootFont = await evaluate("getComputedStyle(document.documentElement).fontSize");
      probe.shotHeight = await shoot(probe.file, width);
      metrics.push(probe);
    }
  }

  // 交互态：hover / 键盘焦点 / 选中。
  await open({ view: "home", state: "roomy", width: 390 });
  const rowBox = await evaluate(`(() => {
    const r = document.querySelector(".v2-ring-row[data-ring='outer']").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rowBox.x, y: rowBox.y });
  await new Promise((r) => setTimeout(r, 200));
  const hover = await evaluate(`getComputedStyle(document.querySelector(".v2-ring-row[data-ring='outer']")).backgroundColor`);
  await shoot("home-hover-390.png", 390);

  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rowBox.x, y: rowBox.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rowBox.x, y: rowBox.y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 250));
  const selected = await evaluate(`(() => {
    const row = document.querySelector(".v2-ring-row[data-ring='outer']");
    return {
      pressed: row.getAttribute("aria-pressed"),
      ringSelected: document.querySelector(".v2-ring").getAttribute("data-selected"),
      bg: getComputedStyle(row).backgroundColor,
      outerArcWidth: document.querySelector(".v2-ring__arc.is-outer").getAttribute("stroke-width"),
      innerOpacity: getComputedStyle(document.querySelector(".v2-ring__band[data-ring='inner'] .v2-ring__arc")).opacity,
    };
  })()`);
  await shoot("home-selected-390.png", 390);

  // 键盘焦点态：从 body 起按 Tab 到第一个明细行。
  await open({ view: "home", state: "roomy", width: 390 });
  await evaluate("document.body.focus()");
  for (let i = 0; i < 8; i++) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", windowsVirtualKeyCode: 9 });
    const hit = await evaluate(`document.activeElement?.classList.contains("v2-ring-row")`);
    if (hit) break;
  }
  const focus = await evaluate(`(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, cls: el.className, outline: s.outline, offset: s.outlineOffset };
  })()`);
  await shoot("home-focus-390.png", 390);

  // 键盘操作：Enter / Space 切换选中。
  const pressedBefore = await evaluate(`document.activeElement.getAttribute("aria-pressed")`);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await new Promise((r) => setTimeout(r, 150));
  const afterEnter = await evaluate(`document.activeElement.getAttribute("aria-pressed")`);
  const pressedBeforeEnter = pressedBefore;
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", windowsVirtualKeyCode: 32 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", windowsVirtualKeyCode: 32 });
  await new Promise((r) => setTimeout(r, 150));
  const afterSpace = await evaluate(`document.activeElement.getAttribute("aria-pressed")`);

  // 固定支出页键盘焦点：Tab 到「记一笔」。
  await open({ view: "fixed", state: "unpaid", width: 390 });
  await evaluate("document.body.focus()");
  for (let i = 0; i < 14; i++) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", windowsVirtualKeyCode: 9 });
    const hit = await evaluate(`document.activeElement?.classList.contains("fixed-item__pay")`);
    if (hit) break;
  }
  const fixedFocus = await evaluate(`(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { cls: el.className, outline: s.outline, height: el.getBoundingClientRect().height };
  })()`);
  await shoot("fixed-focus-390.png", 390);

  const interaction = { hoverBg: hover, selected, focus, pressedBeforeEnter, afterEnter, afterSpace, fixedFocus };

  const CONTRAST = `(() => {
    const parse = (s) => {
      const m = s.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const p = m[1].split(",").map((v) => Number(v.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    };
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0) return bg;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const out = [];
    for (const sel of [
      ".v2-card__kicker",
      ".v2-card__title",
      ".v2-card__value",
      ".v2-ring__centre-label",
      ".v2-ring__centre-amount",
      ".v2-ring-row__name",
      ".v2-ring-row__amount",
      ".v2-ring-row__percent",
      ".v2-ring-row__over",
      ".v2-ring-row__marker",
      ".v2-ring__arc.is-outer",
      ".v2-ring__track.is-outer",
      "h1",
      ".fixed-summary__metrics dt",
      ".fixed-summary__metrics dd",
      ".fixed-item__amount",
      ".fixed-summary__ring-name",
      ".fixed-item__name",
      ".fixed-item__status",
      ".fixed-category__name",
      ".fixed-category__plan",
      ".fixed-category__primary",
      ".fixed-category__secondary",
      ".fixed-category[data-state=OVERPAID] .fixed-category__secondary",
      ".v2-paid-ring__value",
      ".fixed-progress > span",
      ".fixed-empty p",
      ".v2-btn--primary",
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      const bg = bgOf(el.parentElement ?? el);
      const bgForRatio =
        sel === ".v2-btn--primary" ? parse(s.backgroundColor) ?? bg : bg;
      const isText =
        !sel.includes("arc") &&
        !sel.includes("track") &&
        !sel.includes("marker") &&
        !sel.includes("progress");
      let fgColor = parse(s.color);
      let bgColor = bgForRatio;
      if (sel.includes("arc")) {
        const mark = document.querySelector(sel);
        const track = document.querySelector(sel.replace("__arc", "__track"));
        fgColor = mark ? parse(getComputedStyle(mark).stroke) : null;
        if (track) bgColor = parse(getComputedStyle(track).stroke) ?? bgColor;
      } else if (!isText) {
        const parentBg = el.parentElement ? parse(getComputedStyle(el.parentElement).backgroundColor) : null;
        fgColor = parse(s.backgroundColor) ?? parse(s.borderTopColor);
        if (parentBg && parentBg.a > 0) bgColor = parentBg;
      }
      out.push({
        sel,
        fg: \`rgb(\${fgColor ? fgColor.r : 0}, \${fgColor ? fgColor.g : 0}, \${fgColor ? fgColor.b : 0})\`,
        bg: \`rgb(\${bgColor.r}, \${bgColor.g}, \${bgColor.b})\`,
        ratio: fgColor ? ratio(fgColor, bgColor) : null,
        need: isText ? 4.5 : 3,
        font: s.fontSize,
        weight: s.fontWeight,
      });
    }
    return out;
  })()`;

  const contrast = {};
  for (const [view, state] of [
    ["home", "roomy"],
    ["home", "over-large"],
    ["home", "pending"],
    ["fixed", "normal"],
    ["fixed", "overpaid"],
    ["fixed", "empty"],
  ]) {
    await open({ view, state, width: 390 });
    contrast[`${view}-${state}`] = await evaluate(CONTRAST);
  }

  for (const m of metrics) {
    if (m.scrollWidth > m.innerWidth) problems.push(`${m.file}: horizontal overflow ${m.scrollWidth}>${m.innerWidth}`);
    if (m.view === "home") {
      if (m.centreClearancePx != null && m.centreClearancePx < 0)
        problems.push(`${m.file}: centre text intrudes into the ring (${m.centreClearancePx}px)`);
      if (m.hasDots || m.hasCompareBar) problems.push(`${m.file}: legacy dots/bar still rendered`);
      if (m.overMarks > 0) problems.push(`${m.file}: ring over-mark still rendered (${m.overMarks})`);
      for (const c of m.markerColors ?? [])
        if (c !== "rgb(194, 80, 60)") problems.push(`${m.file}: marker colour ${c} != #C2503C`);
    }
    if (m.view === "fixed" && m.pageText) {
      for (const banned of ["待付", "本月已付占比", "再记一笔", "0/0"]) {
        if (m.pageText.includes(banned)) problems.push(`${m.file}: banned copy ${banned}`);
      }
      const tracks = (m.categoryColumns ?? "").trim().split(/\s+/).filter(Boolean);
      if (tracks.length > 1)
        problems.push(`${m.file}: categories not single column (${m.categoryColumns})`);
    }
  }
  if (exceptions.length) problems.push(`runtime exceptions: ${exceptions.join(" | ")}`);
  if (remote.length) problems.push(`remote requests: ${remote.join(" | ")}`);

  await writeFile(resolve(out, "contrast.json"), `${JSON.stringify(contrast, null, 2)}\n`);
  for (const [state, rows] of Object.entries(contrast)) {
    for (const row of rows) {
      if (row.ratio != null && row.ratio < row.need && !row.sel.includes("__arc"))
        problems.push(`${state} ${row.sel}: contrast ${row.ratio} < ${row.need}`);
    }
  }

  await writeFile(
    resolve(out, "metrics.json"),
    `${JSON.stringify({ metrics, interaction, problems, exceptions, remote }, null, 2)}\n`,
  );
  await writeFile(resolve(out, "problems.txt"), `${problems.join("\n") || "none"}\n`);
  console.log(JSON.stringify({ shots: metrics.length, problems }, null, 2));
} finally {
  socket?.close();
  chrome.kill("SIGKILL");
}
