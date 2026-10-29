// R1（J-01/J-02）受限返工验收探针：本机 Chrome CDP，离线、合成数据、零活库访问。
// 用法:
//   node shoot-r1.mjs --mode default --out ../shots-default
//   node shoot-r1.mjs --mode text200 --out ../shots-text200
// mode=default 不放大字号（默认布局回归）；mode=text200 全元素计算字号×2（J-01 合成口径）。
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
const mode = args.mode ?? "default";
const rootScale = Number(args["root-scale"] ?? (mode === "root200" ? 2 : 1));
const doubleText = Number(args.double ?? (mode === "text200" ? 1 : 0));
const out = resolve(args.out ?? `shots-${mode}`);
const WIDTHS = (args.widths ?? "390,760,980").split(",").map(Number);
const HOME_STATES = ["actual", "zero-burden", "pending", "large", "over-both"];
await mkdir(out, { recursive: true });

const profile = await mkdtemp(resolve(tmpdir(), "xqj-r1-"));
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

// ---- WCAG 对拍（独立复算，不依赖浏览器） ----
const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s ?? "");
  if (!m) return null;
  const p = m[1].split(",").map((v) => parseFloat(v));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec((s ?? "").trim());
  return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 } : null;
};
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (c1, c2) => {
  const a = lum(c1);
  const b = lum(c2);
  return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
};
const over = (fg, bg) => {
  // fg 叠在 bg 上（fg 半透明时按 alpha 混合）
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
};

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

  async function open({ state, width, height = 1400 }) {
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
    const query = new URLSearchParams({ view: "home", state, scale: String(rootScale) }).toString();
    const url = new URL(base.href);
    url.search = query;
    await send("Page.navigate", { url: url.href });
    for (let i = 0; i < 200; i++) {
      try {
        const ready = await evaluate(
          `location.search === ${JSON.stringify(`?${query}`)} && document.readyState === 'complete' && document.querySelectorAll('.v2-ring-row').length > 0`,
        );
        if (ready) break;
      } catch {
        /* document still swapping */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    await evaluate("document.fonts.ready");
    if (doubleText) {
      await evaluate(`(() => {
        const sizes = [...document.body.querySelectorAll('*')].map(el => ({el, fs: parseFloat(getComputedStyle(el).fontSize), lh: parseFloat(getComputedStyle(el).lineHeight)}));
        for (const {el,fs,lh} of sizes) {el.style.setProperty('font-size', (fs*2)+'px','important'); if(Number.isFinite(lh))el.style.setProperty('line-height',(lh*2)+'px','important');}
      })()`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  async function shoot(file, width) {
    const m = await send("Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(m.cssContentSize.height), 5000);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await writeFile(resolve(out, file), Buffer.from(shot.data, "base64"));
    return height;
  }

  const PROBE = () => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const cs = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const lineCount = (el) => {
      if (!el) return null;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return Number.isFinite(lh) && lh > 0 ? +(el.getBoundingClientRect().height / lh).toFixed(2) : null;
    };
    const ring = document.querySelector(".v2-ring");
    const ringRect = rect(ring);
    const centreRect = rect(document.querySelector(".v2-ring__centre-amount"));
    const svgRect = rect(document.querySelector(".v2-ring__chart"));
    const innerCircle =
      document.querySelector(".v2-ring__track.is-inner") ??
      document.querySelector(".v2-ring__arc.is-inner");
    const innerR = innerCircle ? Number(innerCircle.getAttribute("r")) : null;
    const innerStroke = innerCircle ? Number(innerCircle.getAttribute("stroke-width") ?? 13) : null;
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

    const rows = [...document.querySelectorAll(".v2-ring-row")].map((row) => {
      const r = row.getBoundingClientRect();
      const name = row.querySelector(".v2-ring-row__name");
      const amount = row.querySelector(".v2-ring-row__amount");
      const percent = row.querySelector(".v2-ring-row__percent");
      const rName = name?.getBoundingClientRect();
      const rAmount = amount?.getBoundingClientRect();
      const rPercent = percent?.getBoundingClientRect();
      return {
        ring: row.dataset.ring,
        name: name?.textContent,
        amount: amount?.textContent,
        percent: percent?.textContent ?? null,
        pressed: row.getAttribute("aria-pressed"),
        marker: !!row.querySelector(".v2-ring-row__marker"),
        over: row.querySelector(".v2-ring-row__over")?.textContent ?? null,
        rowW: +r.width.toFixed(2),
        rowH: +r.height.toFixed(2),
        nameW: rName ? +rName.width.toFixed(2) : null,
        nameLines: lineCount(name),
        amountLines: lineCount(amount),
        percentLines: lineCount(percent),
        // 同一行判定：金额/比例与名称是否共享基线（重叠检测）
        overlapNameAmount:
          rName && rAmount
            ? !(rName.right <= rAmount.left || rAmount.right <= rName.left) &&
              !(rName.bottom <= rAmount.top || rAmount.bottom <= rName.top)
            : null,
        horizontal: !!(rName && rAmount && rPercent && rPercent.top >= rAmount.bottom - 0.5),
        amountFits: rAmount ? rAmount.right <= r.right - 9 && rAmount.left >= r.left + 9 : null,
      };
    });

    const styleOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        opacity: s.opacity,
        strokeDasharray: el.getAttribute("stroke-dasharray"),
        strokeDashoffset: el.getAttribute("stroke-dashoffset"),
        linecap: s.strokeLinecap,
      };
    };

    return {
      view: document.querySelector(".v2-structure-card") ? "home" : "other",
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      docHeight: document.documentElement.scrollHeight,
      ring: ringRect,
      chart: svgRect,
      centre: centreRect,
      centreLabel: rect(document.querySelector(".v2-ring__centre-label")),
      dx,
      dy,
      holeRadius: holeRadius == null ? null : +holeRadius.toFixed(2),
      centreClearancePx: clearance,
      centreFont: cs(".v2-ring__centre-amount", "fontSize"),
      centreLines: lineCount(document.querySelector(".v2-ring__centre-amount")),
      amountFont: cs(".v2-ring-row__amount", "fontSize"),
      rowFont: cs(".v2-ring-row__name", "fontSize"),
      percentFont: cs(".v2-ring-row__percent", "fontSize"),
      labelFont: cs(".v2-ring__centre-label", "fontSize"),
      rows,
      style: {
        edge: styleOf(".v2-ring__edge"),
        arcEdgeOuter: styleOf(".v2-ring__band[data-ring='outer'] .v2-ring__arc-edge"),
        arcEdgeInner: styleOf(".v2-ring__band[data-ring='inner'] .v2-ring__arc-edge"),
        trackOuter: styleOf(".v2-ring__track.is-outer"),
        trackInner: styleOf(".v2-ring__track.is-inner"),
        arcOuter: styleOf(".v2-ring__arc.is-outer"),
        arcInner: styleOf(".v2-ring__arc.is-inner"),
        cardBg: cs(".v2-card", "backgroundColor"),
        svgRectCount: document.querySelectorAll(".v2-ring__chart > *").length,
      },
      arcDash: [...document.querySelectorAll(".v2-ring__arc")].map((a) => a.getAttribute("stroke-dasharray")),
      arcEdgeDash: [...document.querySelectorAll(".v2-ring__arc-edge")].map((a) => ({
        dash: a.getAttribute("stroke-dasharray"),
        offset: a.getAttribute("stroke-dashoffset"),
        r: a.getAttribute("r"),
      })),
      ariaLabel: document.querySelector(".v2-ring__chart")?.getAttribute("aria-label"),
      surplus: text(".v2-card__value"),
      structureTitle: text("#v2-structure-title"),
      pageText: document.body.innerText,
      overMarks: document.querySelectorAll(".v2-ring__over-mark").length,
      forbidden: {
        m27582: document.body.innerText.includes("27,582.50"),
        s13000: (document.querySelector(".v2-structure-card")?.innerText ?? "").includes("13,000.00"),
        zero00: document.body.innerText.includes("¥0.00"),
      },
    };
  };

  const CONTRAST = (probe) => {
    const pair = (a, b) => (a && b ? contrast(over(a, { r: 255, g: 255, b: 255 }), over(b, { r: 255, g: 255, b: 255 })) : null);
    const c = (s) => (s ? (rgb(s) ?? hex(s)) : null);
    const st = probe.style;
    const table = {
      "arcOuter/trackOuter": pair(c(st.arcOuter?.stroke), c(st.trackOuter?.stroke)),
      "arcInner/trackInner": pair(c(st.arcInner?.stroke), c(st.trackInner?.stroke)),
      "arcEdge/trackOuter": pair(c(st.arcEdgeOuter?.stroke), c(st.trackOuter?.stroke)),
      "arcEdge/trackInner": pair(c(st.arcEdgeInner?.stroke), c(st.trackInner?.stroke)),
      "arcEdge/arcOuter": pair(c(st.arcEdgeOuter?.stroke), c(st.arcOuter?.stroke)),
      "arcEdge/arcInner": pair(c(st.arcEdgeInner?.stroke), c(st.arcInner?.stroke)),
      "edge/trackOuter": pair(c(st.edge?.stroke), c(st.trackOuter?.stroke)),
      "edge/trackInner": pair(c(st.edge?.stroke), c(st.trackInner?.stroke)),
      "edge/arcOuter": pair(c(st.edge?.stroke), c(st.arcOuter?.stroke)),
      "edge/arcInner": pair(c(st.edge?.stroke), c(st.arcInner?.stroke)),
      "arcEdge/cardBg": pair(c(st.arcEdgeOuter?.stroke), c(st.cardBg)),
      "arcOuter/cardBg": pair(c(st.arcOuter?.stroke), c(st.cardBg)),
    };
    return table;
  };

  for (const width of WIDTHS) {
    for (const state of HOME_STATES) {
      await open({ state, width });
      const probe = await evaluate(`(${PROBE.toString()})()`);
      probe.state = state;
      probe.width = width;
      probe.mode = mode;
      probe.rootScale = rootScale;
      probe.doubleText = doubleText;
      probe.contrast = CONTRAST(probe);
      // 选中态（点击外环明细按钮后）复测同一组样式
      await evaluate(`document.querySelector('.v2-ring-row[data-ring="outer"]')?.click()`);
      await new Promise((r) => setTimeout(r, 120));
      const sel = await evaluate(`(${PROBE.toString()})()`);
      probe.selected = {
        ring: sel.ring,
        centre: sel.centre,
        centreClearancePx: sel.centreClearancePx,
        rows: sel.rows,
        style: sel.style,
        scrollWidth: sel.scrollWidth,
        innerWidth: sel.innerWidth,
        ariaLabel: sel.ariaLabel,
      };
      probe.selected.contrast = CONTRAST(sel);
      probe.file = `home-${state}-${width}.png`;
      probe.shotHeight = await shoot(probe.file, width);
      const p = [];
      if (probe.scrollWidth > probe.innerWidth) p.push(`H-OVERFLOW ${probe.scrollWidth}>${probe.innerWidth}`);
      if (probe.centreClearancePx != null && probe.centreClearancePx < 0) p.push(`CLEARANCE ${probe.centreClearancePx}`);
      for (const row of probe.rows) {
        if (row.amountFits === false) p.push(`AMOUNT-OUT ${row.ring}`);
        if (row.overlapNameAmount) p.push(`NAME-AMOUNT-OVERLAP ${row.ring}`);
        if (row.nameLines > 1.4) p.push(`NAME-WRAP ${row.ring} ${row.nameLines}lines`);
      }
      probe.problems = p;
      if (p.length) problems.push({ state, width, problems: p });
      metrics.push(probe);
    }
  }

  await writeFile(resolve(out, "metrics.json"), JSON.stringify({ mode, rootScale, doubleText, metrics, problems, exceptions, remote }, null, 2));
  const brief = metrics.map((m) => ({
    state: m.state,
    width: m.width,
    clearance: m.centreClearancePx,
    centreFont: m.centreFont,
    centreLines: m.centreLines,
    ring: m.ring && Math.round(m.ring.w),
    rows: m.rows.map((r) => `${r.ring}:${r.nameLines}/${r.amountLines}/${r.percentLines}`),
    scroll: `${m.scrollWidth}/${m.innerWidth}`,
    contrast: m.contrast,
    problems: m.problems,
  }));
  console.log(JSON.stringify({ mode, rootScale, doubleText, brief, problems, exceptions, remote }, null, 2));
} finally {
  socket?.close();
  chrome.kill("SIGKILL");
}
