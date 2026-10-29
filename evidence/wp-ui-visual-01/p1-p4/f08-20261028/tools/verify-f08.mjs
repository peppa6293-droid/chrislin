// F-08 verification harness (reference asset only, no product code).
// Usage: node verify-f08.mjs --root <asset dir> --out <evidence dir> --label after [--states a,b,c]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
  return acc;
}, []));
const asset = resolve(args.root);
const out = resolve(args.out);
const label = args.label || 'run';
await mkdir(out, { recursive: true });

// Independent expected values (hand-mirrored fixture table, not read from app.js).
const fixtures = {
  roomy: { income: 13000, fixed: 4800, debt: 1300, spend: 748, budget: 1100 },
  'light-over': { income: 13000, fixed: 10500, debt: 3500, spend: 1230, budget: 1100 },
  overload: { income: 13000, fixed: 11800, debt: 4200, spend: 1580, budget: 1100 },
  'zero-burden': { income: 0, fixed: 2500, debt: 1000, spend: 0, budget: 1100 },
  'over-outer': { income: 13000, fixed: 15600, debt: 0, spend: 900, budget: 1100 },
  'over-both': { income: 13000, fixed: 15600, debt: 0, spend: 1320, budget: 1100 },
  'over-large': { income: 10000, fixed: 23000, debt: 0, spend: 900, budget: 1100 },
};
const pct = n => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`;
const money = n => `¥${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function expected(name) {
  const d = fixtures[name];
  if (!d) return null;
  const known = d.income != null;
  if (!known) return { markers: 0, notes: [], aria: '资料不齐，金额与比例待确认' };
  const burden = d.fixed + d.debt;
  if (d.income === 0) return { markers: 0, notes: [], aria: `收入 ¥0，固定负担 ${money(burden)}，不显示百分比` };
  const outer = burden / d.income;
  const inner = d.budget > 0 ? d.spend / d.budget : null;
  const notes = [];
  if (outer > 1) notes.push(`已超出 ${money(burden - d.income)}`);
  if (inner != null && inner > 1) notes.push(`已超出 ${money(d.spend - d.budget)}`);
  const aria = `固定负担 ${pct(outer)}${outer > 1 ? `，已超出 ${money(burden - d.income)}` : ''}，消费 ${pct(inner)}${inner != null && inner > 1 ? `，已超出 ${money(d.spend - d.budget)}` : ''}`;
  return { markers: (outer > 1 ? 1 : 0) + (inner != null && inner > 1 ? 1 : 0), notes, aria };
}

const stateList = (args.states || 'over-outer,over-both,over-large,overload,light-over,zero-burden,roomy').split(',');
const widths = [390, 760, 980];

const profile = await mkdtemp(resolve(tmpdir(), 'xqj-f08-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let socket;
const results = [];
try {
  let port;
  for (let i = 0; i < 120; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await new Promise(r => setTimeout(r, 50)); }
  }
  if (!port) throw new Error('Chrome did not expose its debugging port');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const waiting = new Map();
  const exceptions = [];
  const remoteRequests = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(m.params.request.url)) remoteRequests.push(m.params.request.url);
    if (m.id && waiting.has(m.id)) {
      const { resolve: res, reject, timer } = waiting.get(m.id);
      clearTimeout(timer); waiting.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); rej(new Error(`CDP timeout ${method}`)); }, 20000);
    waiting.set(id, { resolve: res, reject: rej, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  async function open({ page = 'home', state, width, height = 1200, review = false }) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 760, screenWidth: width, screenHeight: height,
    });
    await send('Emulation.setEmulatedMedia', { features: [] });
    const q = new URLSearchParams({ state });
    if (review) q.set('view', 'review');
    const file = page === 'fixed' ? 'fixed-v3-source.html' : 'index.html';
    const url = pathToFileURL(resolve(asset, file)); url.search = q.toString();
    await send('Page.navigate', { url: url.href });
    for (let i = 0; i < 80; i++) {
      try {
        const ready = await evaluate(`document.readyState==='complete' && !!window.visualReference && window.visualReference.state===${JSON.stringify(state)}`);
        if (ready) break;
      } catch { /* navigation still replacing the document */ }
      await new Promise(r => setTimeout(r, 40));
    }
    await evaluate('document.fonts.ready');
    await new Promise(r => setTimeout(r, 80));
  }

  async function shoot(file, width) {
    const m = await send('Page.getLayoutMetrics');
    const height = Math.min(Math.ceil(m.cssContentSize.height), 4200);
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await writeFile(resolve(out, file), Buffer.from(shot.data, 'base64'));
    return height;
  }

  const probe = expectedExpr => `(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) }; };
    const textRect = node => { const range = document.createRange(); range.selectNodeContents(node); return rect(range); };
    const card = document.querySelector('.chart-card');
    const rows = [...document.querySelectorAll('.ring-detail .legend-row')];
    const markers = [...document.querySelectorAll('.overage-mark')].map(el => {
      const cs = getComputedStyle(el);
      const b = el.parentElement;
      const textNode = [...b.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      return { box: rect(el), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
        ariaHidden: el.getAttribute('aria-hidden'), rowOver: el.closest('.legend-row').dataset.over,
        textBox: textNode ? textRect(textNode) : null, amountText: b.textContent.trim() };
    });
    const notes = [...document.querySelectorAll('.overage-note')].map(el => ({ text: el.textContent.trim(), box: rect(el), clipped: el.scrollWidth > el.clientWidth + 1 }));
    const arcs = [...document.querySelectorAll('.ring-progress')].map(el => ({ r: +el.getAttribute('r'), dash: el.getAttribute('stroke-dasharray') }));
    const rowsInfo = rows.map(el => ({ text: el.textContent.trim(), over: el.dataset.over, box: rect(el), clipped: el.scrollWidth > el.clientWidth + 1 }));
    const stray = [...document.querySelectorAll('.chart-card svg')].map(s => s.closest('.double-ring') ? 'ring' : 'other-svg');
    const overflow = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 0.5; }).map(el => el.className || el.tagName).slice(0, 8);
    return {
      docScrollWidth: document.documentElement.scrollWidth, innerWidth,
      stripes: document.querySelectorAll('.excess-stripes,.excess-arc,pattern,.chart-warning').length,
      markers, notes, arcs, rows: rowsInfo, stray,
      aria: document.querySelector('.double-ring')?.getAttribute('aria-label'),
      overflow,
      cardBox: card ? rect(card) : null,
      reviewToolbar: !!document.querySelector('.review-tools'),
    };
  })()`;

  const report = [];
  for (const state of stateList) {
    const exp = expected(state);
    for (const width of widths) {
      await open({ state, width });
      const data = await evaluate(probe());
      const shot = `${label}-home-${state}-${width}.png`;
      const height = await shoot(shot, width);
      const checks = [];
      const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

      add('no-legacy-stripes-or-pattern', data.stripes === 0, data.stripes);
      add('marker-count', data.markers.length === exp.markers, `${data.markers.length}/${exp.markers}`);
      add('no-horizontal-overflow', data.docScrollWidth <= width + 1 && data.overflow.length === 0, { docScrollWidth: data.docScrollWidth, width, overflow: data.overflow });
      add('aria-label', data.aria === exp.aria, { actual: data.aria, expected: exp.aria });
      add('notes-text', JSON.stringify(data.notes.map(n => n.text)) === JSON.stringify(exp.notes), data.notes.map(n => n.text));
      add('notes-not-clipped', data.notes.every(n => !n.clipped && n.box.right <= width + 0.5), data.notes.map(n => n.box.right));
      add('marker-size-3x14', data.markers.every(m => Math.abs(m.box.w - 3) <= 0.6 && Math.abs(m.box.h - 14) <= 0.6), data.markers.map(m => [m.box.w, m.box.h]));
      add('marker-color-c2503c', data.markers.every(m => m.bg === 'rgb(194, 80, 60)'), data.markers.map(m => m.bg));
      add('marker-radius-2', data.markers.every(m => m.radius === '2px'), data.markers.map(m => m.radius));
      add('marker-decorative', data.markers.every(m => m.ariaHidden === 'true'), data.markers.map(m => m.ariaHidden));
      add('marker-left-of-amount', data.markers.every(m => m.textBox && m.box.right <= m.textBox.x + 0.6 && m.box.x >= m.textBox.x - 20), data.markers.map(m => ({ markRight: m.box.right, textX: m.textBox?.x })));
      add('amount-not-clipped', data.rows.every(r => !r.clipped), data.rows.map(r => r.text));
      add('single-lap-arcs', data.arcs.length === 0 || data.arcs.every(a => parseFloat(a.dash) <= 2 * Math.PI * a.r + 0.6), data.arcs);
      add('no-warning-icon-in-chart', data.stray.every(s => s === 'ring'), data.stray);
      add('clean-view', data.reviewToolbar === false, data.reviewToolbar);

      report.push({ label, state, width, height, screenshot: shot, checks, pass: checks.every(c => c.ok), data });
    }
  }

  // Regression: fixed page must be unchanged by F-08.
  for (const width of [390, 760, 980]) {
    await open({ page: 'fixed', state: 'normal', width });
    const data = await evaluate(`(() => ({
      stripes: document.querySelectorAll('.excess-stripes,.excess-arc,pattern,.chart-warning').length,
      overflow: document.documentElement.scrollWidth,
      ringName: document.querySelector('.summary-ring-name')?.textContent.trim(),
      payButton: !!document.querySelector('[data-pay]'),
    }))()`);
    const shot = `${label}-fixed-normal-${width}.png`;
    await shoot(shot, width);
    const checks = [
      { name: 'no-stripes-on-fixed-page', ok: data.stripes === 0, detail: data.stripes },
      { name: 'no-horizontal-overflow', ok: data.overflow <= width + 1, detail: { scrollWidth: data.overflow, width } },
      { name: 'summary-ring-name-kept', ok: data.ringName === '所选月份已付占比', detail: data.ringName },
      { name: 'pay-button-kept', ok: data.payButton === true, detail: data.payButton },
    ];
    report.push({ label, state: 'fixed-normal', width, screenshot: shot, checks, pass: checks.every(c => c.ok) });
  }

  const contrast = (() => {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = hex => { const [r, g, b] = hex.match(/\w\w/g).map(h => parseInt(h, 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    return { markOnWhite: ratio('c2503c', 'ffffff'), markOnPage: ratio('c2503c', 'f4f6f6'), noteOnWhite: ratio('1b292a', 'ffffff'), tealEdgeOnWhite: ratio('286d65', 'ffffff') };
  })();

  const summary = {
    label, asset, generatedAt: new Date().toISOString(),
    widths, states: stateList,
    contrast,
    exceptions, remoteRequests,
    total: report.length,
    passed: report.filter(r => r.pass).length,
    failures: report.flatMap(r => r.checks.filter(c => !c.ok).map(c => ({ state: r.state, width: r.width, ...c }))),
    report,
  };
  await writeFile(resolve(out, `${label}-report.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ label, total: summary.total, passed: summary.passed, failures: summary.failures, exceptions: exceptions.length, remoteRequests: remoteRequests.length, contrast }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 300));
}
