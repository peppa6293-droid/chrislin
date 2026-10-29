// V-2 分界对比度「实渲染像素」探针：截真实 DOM 渲染像素，不再拿候选色值做算术。
// 用法: node probe-contrast.mjs --width 390 --out ../after-contrast
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const WIDTH = Number(args.width ?? 390);
const DPR = Number(args.dpr ?? 2);
const STATE = args.state ?? "actual";
const out = resolve(args.out ?? "../after-contrast");
await mkdir(out, { recursive: true });

/* ---------- 最小 PNG 解码（Chrome 截图：8bit RGBA，无隔行） ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error("not png");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  if (depth !== 8) throw new Error(`unsupported depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colorType ${colorType}`);
  let pos = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const outBuf = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = outBuf.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? outBuf.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
  }
  return { w, h, channels, data: outBuf };
}

/* ---------- WCAG 独立复算 ---------- */
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (c1, c2) => {
  const a = lum(c1), b = lum(c2);
  return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
};
const hexOf = ({ r, g, b }) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const profile = await mkdtemp(resolve(tmpdir(), "xqj-v2-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const report = { width: WIDTH, dpr: DPR, state: STATE, states: [], checks: {}, problems: [] };

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
  const socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });

  let seq = 0;
  const waiting = new Map();
  const exceptions = [];
  socket.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.exceptionThrown")
      exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
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
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: 1600,
    deviceScaleFactor: DPR,
    mobile: WIDTH <= 760,
    screenWidth: WIDTH,
    screenHeight: 1600,
  });
  await send("Page.navigate", { url: pathToFileURL(resolve("dist/index.html")).href + `?view=home&state=${STATE}&scale=1` });
  await new Promise((r) => setTimeout(r, 700));
  await evaluate(`document.fonts.ready.then(() => 1)`);
  await new Promise((r) => setTimeout(r, 300));

  const geometry = await evaluate(`(() => {
    const ring = document.querySelector(".v2-ring");
    const chart = document.querySelector(".v2-ring__chart");
    const r = ring.getBoundingClientRect();
    const c = chart.getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector(".v2-ring__arc-edge.is-outer") || document.querySelector(".v2-ring__edge"));
    const arcs = [...document.querySelectorAll(".v2-ring__arc")].map((a) => {
      const s = getComputedStyle(a);
      return { cls: a.getAttribute("class"), opacity: s.opacity, stroke: s.stroke, width: s.strokeWidth };
    });
    const edges = [...document.querySelectorAll(".v2-ring__arc-edge")].map((a) => {
      const s = getComputedStyle(a);
      return { cls: a.getAttribute("class"), stroke: s.stroke, width: s.strokeWidth };
    });
    const tracks = [...document.querySelectorAll(".v2-ring__track")].map((t) => ({
      cls: t.getAttribute("class"), stroke: getComputedStyle(t).stroke,
    }));
    const hair = [...document.querySelectorAll(".v2-ring__edge")].map((t) => getComputedStyle(t).stroke);
    const ends = document.querySelectorAll(".v2-ring__arc-end").length;
    const cardBg = getComputedStyle(document.querySelector(".v2-structure-card")).backgroundColor;
    return {
      ring: { x: r.x, y: r.y, w: r.width, h: r.height },
      chart: { x: c.x, y: c.y, w: c.width, h: c.height },
      edgeStroke: cs.stroke,
      arcs, edges, tracks, hair, ends, cardBg,
    };
  })()`);
  report.computed = geometry;

  const bandOf = (cls) => (/is-outer/.test(cls) ? "outer" : "inner");

  async function shoot(tag) {
    const ring = await evaluate(`(() => {
      const r = document.querySelector(".v2-ring").getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
    })()`);
    const clip = {
      x: Math.floor(ring.x - 4),
      y: Math.floor(ring.y - 4),
      width: Math.ceil(ring.w + 8),
      height: Math.ceil(ring.h + 8),
      scale: 1,
    };
    const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    const buf = Buffer.from(shot.data, "base64");
    await writeFile(resolve(out, `ring-${tag}.png`), buf);
    return { png: decodePng(buf), clip, ring };
  }

  const px = (png, clip, cssX, cssY) => {
    const x = Math.round((cssX - clip.x) * DPR);
    const y = Math.round((cssY - clip.y) * DPR);
    if (x < 0 || y < 0 || x >= png.w || y >= png.h) return null;
    const i = (y * png.w + x) * png.channels;
    return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2], a: png.channels === 4 ? png.data[i + 3] : 255 };
  };
  const darkest = (png, clip, cssX, cssY, rad = 2) => {
    let best = null;
    for (let dx = -rad; dx <= rad; dx++)
      for (let dy = -rad; dy <= rad; dy++) {
        const p = px(png, clip, cssX + dx, cssY + dy);
        if (!p) continue;
        if (!best || lum(p) < lum(best)) best = p;
      }
    return best;
  };
  const brightest = (png, clip, cssX, cssY, rad = 2) => {
    let best = null;
    for (let dx = -rad; dx <= rad; dx++)
      for (let dy = -rad; dy <= rad; dy++) {
        const p = px(png, clip, cssX + dx, cssY + dy);
        if (!p) continue;
        if (!best || lum(p) > lum(best)) best = p;
      }
    return best;
  };

  const KEYS = ["outer", "inner"];

  async function samplePoints(selectedRing) {
    return evaluate(`(() => {
      const out = {};
      for (const key of ["outer", "inner"]) {
        const track = document.querySelector('.v2-ring__track.is-' + key);
        const arc = document.querySelector('.v2-ring__arc.is-' + key);
        const cx = Number(track.getAttribute("cx"));
        const cy = Number(track.getAttribute("cy"));
        const r = Number(track.getAttribute("r"));
        const C = 2 * Math.PI * r;
        const ctm = track.getScreenCTM();
        const pt = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
        const sel = track.parentElement.hasAttribute("data-selected");
        const dash = arc ? arc.getAttribute("stroke-dasharray") : null;
        const L = dash ? Number(dash.split(" ")[0]) : 0;
        const capped = L / C;
        // 弧被 rotate(-90) 旋到 12 点起笔；circle 路径的 0 点在 3 点，故整体偏移 0.75C。
        const O = 0.75 * C;
        const at = (x) => track.getPointAtLength(((O + x) % C + C) % C);
        const mid = at(L / 2);
        const end = at(Math.min(L, C - 0.01));
        const past = at(Math.min(L + 7, C - 0.01));
        const ux = (mid.x - cx) / r;
        const uy = (mid.y - cy) / r;
        const rad = (d) => pt(cx + ux * (r + d), cy + uy * (r + d));
        out[key] = {
          hasArc: Boolean(arc),
          selected: sel,
          r, C, L, capped,
          arcMid: pt(mid.x, mid.y),
          end: pt(end.x, end.y),
          past: pt(past.x, past.y),
          endSweep: [0, 0.6, 1.2, 1.8, 2.4].map((d) => {
            const q = at(Math.min(L + d, C - 0.01));
            return pt(q.x, q.y);
          }),
          center: pt(cx, cy),
          bandHalf: sel ? 9 : 6.5,
          bndHalf: sel ? 11 : 8.5,
          radial: { m6: rad(6), m10: rad(10), p0: rad(0), plus: rad(10), plus6: rad(16) },
        };
      }
      return out;
    })()`);
  }

  for (const sel of ["none", "essential", "debt"]) {
    if (sel !== "none") {
      await evaluate(`document.querySelector('.v2-ring-row[data-ring="${sel === "essential" ? "outer" : "inner"}"]').click()`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const tag = `sel-${sel}`;
    const { png, clip } = await shoot(tag);
    const geo = await samplePoints();
    const rows = [];
    for (const key of KEYS) {
      const g = geo[key];
      if (!g.hasArc || g.capped <= 0.001) {
        rows.push({ ring: key, selected: g.selected, skipped: "no arc (capped 0)", capped: +g.capped.toFixed(4) });
        continue;
      }
      const ux = (g.arcMid.x - g.center.x) / g.r;
      const uy = (g.arcMid.y - g.center.y) / g.r;
      const at = (d) => ({ x: g.center.x + ux * (g.r + d), y: g.center.y + uy * (g.r + d) });
      const pArc = px(png, clip, g.arcMid.x, g.arcMid.y);
      const pBndOut = darkest(png, clip, at((g.bandHalf + g.bndHalf) / 2).x, at((g.bandHalf + g.bndHalf) / 2).y, 1);
      const pBndIn = darkest(png, clip, at(-(g.bandHalf + g.bndHalf) / 2).x, at(-(g.bandHalf + g.bndHalf) / 2).y, 1);
      const pBg = brightest(png, clip, at(g.bndHalf + 7).x, at(g.bndHalf + 7).y, 2);
      const full = g.capped > 0.985;
      const pTrack = full ? null : px(png, clip, g.past.x, g.past.y);
      const pEnd = full
        ? null
        : g.endSweep
            .map((q) => darkest(png, clip, q.x, q.y, 1))
            .filter(Boolean)
            .reduce((a, b) => (!a || lum(b) < lum(a) ? b : a), null);
      rows.push({
        ring: key,
        selected: g.selected,
        capped: +g.capped.toFixed(4),
        bandHalf: g.bandHalf,
        bndHalf: g.bndHalf,
        arcPixel: pArc && hexOf(pArc),
        bndOuterPixel: pBndOut && hexOf(pBndOut),
        bndInnerPixel: pBndIn && hexOf(pBndIn),
        bgPixel: pBg && hexOf(pBg),
        trackPixel: pTrack && hexOf(pTrack),
        endPixel: pEnd && hexOf(pEnd),
        cBndVsArc: pBndOut && pArc ? contrast(pBndOut, pArc) : null,
        cBndInnerVsArc: pBndIn && pArc ? contrast(pBndIn, pArc) : null,
        cBndVsBg: pBndOut && pBg ? contrast(pBndOut, pBg) : null,
        cEndVsTrack: pEnd && pTrack ? contrast(pEnd, pTrack) : null,
        cEndVsArc: pEnd && pArc ? contrast(pEnd, pArc) : null,
      });
    }
    const arcsNow = await evaluate(`[...document.querySelectorAll(".v2-ring__arc")].map((a) => {
      const s = getComputedStyle(a);
      return { band: a.parentElement.getAttribute("data-ring"), opacity: s.opacity, stroke: s.stroke, width: s.strokeWidth };
    })`);
    report.states.push({ selected: sel, rows, arcs: arcsNow, shot: `ring-${tag}.png` });
  }

  /* ---- 判定 ---- */
  const MIN = 3;
  for (const st of report.states) {
    for (const row of st.rows) {
      if (row.skipped) continue;
      const label = `${st.selected}/${row.ring}`;
      for (const [k, v] of [
        ["boundary↔arc", row.cBndVsArc],
        ["boundary↔cardbg", row.cBndVsBg],
        ["endline↔track", row.cEndVsTrack],
        ["endline↔arc", row.cEndVsArc],
      ]) {
        if (v === null || v === undefined) continue;
        if (v < MIN) report.problems.push(`${label} ${k} ${v}:1 < 3:1`);
      }
      if (!row.bndOuterPixel) report.problems.push(`${label} missing boundary pixel`);
    }
    for (const a of st.arcs) {
      if (Number(a.opacity) < 1) report.problems.push(`selected=${st.selected} ${a.band} arc opacity ${a.opacity} < 1`);
    }
  }
  report.checks = {
    boundaryColorExpected: "#556864",
    boundaryComputed: geometry.edgeStroke,
    hairlineComputed: geometry.hair,
    endsRendered: geometry.ends,
    exceptions,
  };
} finally {
  try { socket?.close(); } catch {}
  chrome.kill("SIGKILL");
}

await writeFile(resolve(out, "contrast.json"), JSON.stringify(report, null, 2));
const brief = report.states.map((s) => ({
  selected: s.selected,
  rows: s.rows.map((r) => ({
    ring: r.ring,
    arc: r.arcPixel, bnd: r.bndOuterPixel, bndIn: r.bndInnerPixel, bg: r.bgPixel, track: r.trackPixel, end: r.endPixel,
    bndArc: r.cBndVsArc, bndBg: r.cBndVsBg, endTrack: r.cEndVsTrack, endArc: r.cEndVsArc,
  })),
}));
console.log(JSON.stringify({ width: report.width, checks: report.checks, brief, problems: report.problems }, null, 2));
