// F-09 verification harness (reference asset only, no product code, no network).
// Usage: node verify-f09.mjs --root <asset dir> --out <evidence dir> --label after [--states a,b,c]
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

// Hand-mirrored fixture table (independent of app.js), B-01 mapping:
// outer = fixed / income, inner = mandatory debt service / income.
const fixtures = {
  roomy: { income: 13000, fixed: 4800, debt: 1300 },
  'light-over': { income: 13000, fixed: 10500, debt: 3500 },
  overload: { income: 13000, fixed: 11800, debt: 4200 },
  'zero-burden': { income: 0, fixed: 2500, debt: 1000 },
  'over-outer': { income: 13000, fixed: 15600, debt: 2600 },
  'over-both': { income: 13000, fixed: 15600, debt: 15600 },
  'over-large': { income: 10000, fixed: 23000, debt: 1000 },
  'over-split': { income: 13000, fixed: 9100, debt: 5200 },
  pending: { income: null, fixed: null, debt: null },
};
const pct = n => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`;
const money = n => `¥${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = n => (n < 0 ? `−${money(-n)}` : money(n));

function expected(name) {
  const d = fixtures[name];
  if (!d) return null;
  if (d.income == null) return { rows: [], markers: 0, notes: [], aria: '资料不齐，金额与比例待确认', surplus: '—' };
  if (d.income === 0) {
    return {
      rows: [],
      markers: 0,
      notes: [],
      aria: `收入 ¥0，固定支出 ${money(d.fixed)}，必须偿还月供 ${money(d.debt)}，不显示百分比`,
      surplus: signed(-(d.fixed + d.debt)),
    };
  }
  const outer = d.fixed / d.income;
  const inner = d.debt / d.income;
  const notes = [];
  if (outer > 1) notes.push(`已超出 ${money(d.fixed - d.income)}`);
  if (inner > 1) notes.push(`已超出 ${money(d.debt - d.income)}`);
  const aria = `固定支出 ${pct(outer)}${outer > 1 ? `，已超出 ${money(d.fixed - d.income)}` : ''}，必须偿还月供 ${pct(inner)}${inner > 1 ? `，已超出 ${money(d.debt - d.income)}` : ''}`;
  return {
    rows: [
      { name: '固定支出', amount: money(d.fixed), share: `占收入 ${pct(outer)}`, over: outer > 1 },
      { name: '必须偿还月供', amount: money(d.debt), share: `占收入 ${pct(inner)}`, over: inner > 1 },
    ],
    markers: (outer > 1 ? 1 : 0) + (inner > 1 ? 1 : 0),
    notes,
    aria,
    surplus: signed(d.income - d.fixed - d.debt),
    ratio: `占收入 ${pct((d.income - d.fixed - d.debt) / d.income)}`,
  };
}

const stateList = (args.states || 'over-outer,over-both,over-large,over-split,overload,roomy,light-over,zero-burden,pending').split(',');
const widths = [390, 760, 980];

const profile = await mkdtemp(resolve(tmpdir(), 'xqj-f09-'));
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

  const probe = `(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) }; };
    const textRect = node => { const range = document.createRange(); range.selectNodeContents(node); return rect(range); };
    const rows = [...document.querySelectorAll('.ring-detail .legend-row')].map(el => {
      const amountEl = el.querySelector('.legend-amount');
      const marker = el.querySelector('.overage-mark');
      const textNode = amountEl ? [...amountEl.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()) : null;
      return {
        name: el.querySelector('.legend-name')?.textContent.trim(),
        amount: amountEl?.textContent.trim(),
        share: el.querySelector('.legend-share')?.textContent.trim(),
        over: el.dataset.over,
        box: rect(el),
        clipped: el.scrollWidth > el.clientWidth + 1,
        marker: marker ? {
          box: rect(marker), bg: getComputedStyle(marker).backgroundColor,
          radius: getComputedStyle(marker).borderTopLeftRadius, ariaHidden: marker.getAttribute('aria-hidden'),
          gap: textNode ? +(textRect(textNode).x - rect(marker).right).toFixed(2) : null,
        } : null,
        amountBox: textNode ? textRect(textNode) : null,
      };
    });
    const notes = [...document.querySelectorAll('.overage-note')].map(el => ({ text: el.textContent.trim(), box: rect(el), clipped: el.scrollWidth > el.clientWidth + 1 }));
    const arcs = [...document.querySelectorAll('.ring-progress')].map(el => ({ r: +el.getAttribute('r'), dash: el.getAttribute('stroke-dasharray') }));
    const stray = [...document.querySelectorAll('.chart-card svg')].map(s => s.closest('.double-ring') ? 'ring' : 'other-svg');
    const overflow = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 0.5; }).map(el => el.className || el.tagName).slice(0, 8);
    const ringText = document.querySelector('.ring-detail')?.textContent || '';
    return {
      docScrollWidth: document.documentElement.scrollWidth, innerWidth,
      stripes: document.querySelectorAll('.excess-stripes,.excess-arc,pattern,.chart-warning').length,
      overflowSummary: !!document.querySelector('.overflow-summary'),
      categoryExtra: !!document.querySelector('.category-extra'),
      rows, notes, arcs, stray,
      aria: document.querySelector('.double-ring')?.getAttribute('aria-label'),
      ringText,
      hasSpendWord: ringText.includes('消费'),
      surplus: document.querySelector('#surplus-value')?.textContent.trim(),
      ratio: document.querySelector('.hero .ratio')?.textContent.trim(),
      center: document.querySelector('.ring-center strong')?.textContent.trim(),
      overflow,
      reviewToolbar: !!document.querySelector('.review-tools'),
    };
  })()`;

  const report = [];
  for (const state of stateList) {
    const exp = expected(state);
    for (const width of widths) {
      await open({ state, width });
      const data = await evaluate(probe);
      const shot = `${label}-home-${state}-${width}.png`;
      const height = await shoot(shot, width);
      const checks = [];
      const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

      add('no-legacy-stripes-or-pattern', data.stripes === 0, data.stripes);
      add('no-overflow-summary-block', data.overflowSummary === false, data.overflowSummary);
      add('no-category-extra', data.categoryExtra === false, data.categoryExtra);
      add('marker-count', data.rows.reduce((n, r) => n + (r.marker ? 1 : 0), 0) === exp.markers, `${data.rows.reduce((n, r) => n + (r.marker ? 1 : 0), 0)}/${exp.markers}`);
      add('no-horizontal-overflow', data.docScrollWidth <= width + 1 && data.overflow.length === 0, { docScrollWidth: data.docScrollWidth, width, overflow: data.overflow });
      add('aria-label', data.aria === exp.aria, { actual: data.aria, expected: exp.aria });
      add('ring-has-no-spend-word', data.hasSpendWord === false, data.ringText);
      add('notes-text', JSON.stringify(data.notes.map(n => n.text)) === JSON.stringify(exp.notes), data.notes.map(n => n.text));
      add('notes-not-clipped', data.notes.every(n => !n.clipped && n.box.right <= width + 0.5), data.notes.map(n => n.box.right));
      add('row-count', data.rows.length === exp.rows.length, `${data.rows.length}/${exp.rows.length}`);
      add('row-name-amount-share', JSON.stringify(data.rows.map(r => [r.name, r.amount, r.share])) === JSON.stringify(exp.rows.map(r => [r.name, r.amount, r.share])), data.rows.map(r => [r.name, r.amount, r.share]));
      add('row-over-flag', JSON.stringify(data.rows.map(r => r.over === 'true')) === JSON.stringify((exp.rows || []).map(r => r.over)), data.rows.map(r => r.over));
      add('row-not-clipped', data.rows.every(r => !r.clipped), data.rows.map(r => r.name));
      const d0 = fixtures[state];
      const expectedCenter = d0.income == null ? '待确认' : `¥${Number(d0.income).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      add('center-is-income', data.center === expectedCenter, { actual: data.center, expected: expectedCenter });
      add('surplus-value', data.surplus === exp.surplus, { actual: data.surplus, expected: exp.surplus });
      add('ratio-value', data.ratio === exp.ratio, { actual: data.ratio, expected: exp.ratio });
      add('marker-size-3x14', data.rows.every(r => !r.marker || (Math.abs(r.marker.box.w - 3) <= 0.6 && Math.abs(r.marker.box.h - 14) <= 0.6)), data.rows.map(r => r.marker && [r.marker.box.w, r.marker.box.h]));
      add('marker-color-c2503c', data.rows.every(r => !r.marker || r.marker.bg === 'rgb(194, 80, 60)'), data.rows.map(r => r.marker?.bg));
      add('marker-radius-2', data.rows.every(r => !r.marker || r.marker.radius === '2px'), data.rows.map(r => r.marker?.radius));
      add('marker-decorative', data.rows.every(r => !r.marker || r.marker.ariaHidden === 'true'), data.rows.map(r => r.marker?.ariaHidden));
      add('marker-left-of-amount-8px', data.rows.every(r => !r.marker || (r.marker.gap != null && Math.abs(r.marker.gap - 8) <= 1.5)), data.rows.map(r => r.marker?.gap));
      add('single-lap-arcs', data.arcs.length === 0 || data.arcs.every(a => parseFloat(a.dash) <= 2 * Math.PI * a.r + 0.6), data.arcs);
      add('no-warning-icon-in-chart', data.stray.every(s => s === 'ring'), data.stray);
      // pending / overpaid / zero-plan are forced into the external review view by the asset itself.
      if (!['pending'].includes(state)) add('clean-view', data.reviewToolbar === false, data.reviewToolbar);

      report.push({ label, state, width, height, screenshot: shot, checks, pass: checks.every(c => c.ok), data });
    }
  }

  // Regression: fixed page (F-01..F-08) plus the removed hatch bar on the B-03 overpaid candidate.
  for (const [state, width] of [['normal', 390], ['normal', 760], ['normal', 980], ['overpaid', 390], ['overpaid', 760], ['overpaid', 980], ['zero-plan', 390], ['zero-plan', 760], ['zero-plan', 980]]) {
    // Taller viewport for the two B-03 category candidates so the fixed bottom nav cannot sit over the wording.
    await open({ page: 'fixed', state, width, height: ['overpaid', 'zero-plan'].includes(state) ? 1900 : 1200 });
    const data = await evaluate(`(() => ({
      stripes: document.querySelectorAll('.excess-stripes,.excess-arc,pattern,.chart-warning,.category-extra').length,
      overflow: document.documentElement.scrollWidth,
      ringName: document.querySelector('.summary-ring-name')?.textContent.trim(),
      payButton: !!document.querySelector('[data-pay]'),
      overpaidSlot: document.querySelector('.category-item .review-slot')?.textContent.trim(),
      emptyText: document.querySelector('.empty-state p')?.textContent.trim(),
    }))()`);
    const shot = `${label}-fixed-${state}-${width}.png`;
    await shoot(shot, width);
    const checks = [
      { name: 'no-hatching-on-fixed-page', ok: data.stripes === 0, detail: data.stripes },
      { name: 'no-horizontal-overflow', ok: data.overflow <= width + 1, detail: { scrollWidth: data.overflow, width } },
      ...(state === 'normal' ? [
        { name: 'summary-ring-name-kept', ok: data.ringName === '所选月份已付占比', detail: data.ringName },
        { name: 'pay-button-kept', ok: data.payButton === true, detail: data.payButton },
      ] : state === 'overpaid' ? [
        // The B-03 overpaid candidate is a category-only page: no summary ring / pay rows by design.
        { name: 'b03-overpaid-wording', ok: data.overpaidSlot === 'B-03 已签认 · 超计划 ¥225.00 · 已付/计划 125%', detail: data.overpaidSlot },
      ] : [
        { name: 'b03-zero-plan-wording', ok: data.overpaidSlot === 'B-03 已签认 · 计划 ¥0 · 已付 ¥120.00 · 超计划 ¥120.00', detail: data.overpaidSlot },
      ]),
    ];
    report.push({ label, state: `fixed-${state}`, width, screenshot: shot, checks, pass: checks.every(c => c.ok), data });
  }

  // F-01..F-06 regression probes: unchanged by F-09, re-measured here.
  const regression = [];
  {
    await open({ page: 'home', state: 'roomy', width: 390 });
    const g = await evaluate(`(() => ({ firstModuleY: +document.querySelector('.modules .module').getBoundingClientRect().y.toFixed(1), heroY: +document.querySelector('.hero').getBoundingClientRect().y.toFixed(1), chartY: +document.querySelector('.chart-card').getBoundingClientRect().y.toFixed(1) }))()`);
    regression.push({ name: 'F-05 first module offset at 390', ok: Math.abs(g.firstModuleY - 796.6) <= 2, detail: g });
  }
  {
    await open({ page: 'fixed', state: 'normal', width: 390 });
    const r = await evaluate(`(() => {
      document.querySelector('[data-pay]').click();
      const sheet = document.querySelector('.payment-sheet');
      const toggle = sheet.querySelector('[data-toggle-details]');
      const collapsed = toggle.querySelector('[data-detail-text]').textContent.trim();
      const controls = toggle.getAttribute('aria-controls');
      const target = document.getElementById(controls);
      toggle.click();
      const expandedHidden = target ? target.hidden : null;
      const expandedAria = toggle.getAttribute('aria-expanded');
      toggle.click();
      const collapsedHidden = target ? target.hidden : null;
      return { collapsed, controls, targetExists: !!target, expandedHidden, expandedAria, collapsedHidden,
        ariaLabel: toggle.getAttribute('aria-label') };
    })()`);
    regression.push({ name: 'F-01 collapsed summary from real values', ok: r.collapsed === '支付日期 2026-10-27 · 备注 地铁月卡', detail: r.collapsed });
    regression.push({ name: 'F-03 aria-controls points at a real container', ok: r.controls === 'payment-details' && r.targetExists, detail: { controls: r.controls, targetExists: r.targetExists } });
    regression.push({ name: 'F-03 expanded target visible / collapsed target hidden', ok: r.expandedHidden === false && r.expandedAria === 'true' && r.collapsedHidden === true, detail: r });
  }
  {
    await open({ page: 'fixed', state: 'normal', width: 390, height: 320 });
    const f6 = await evaluate(`(() => { document.querySelector('[data-pay]').click(); const b = document.querySelector('.payment-actions .button.primary').getBoundingClientRect(); return { bottom: +b.bottom.toFixed(1), vh: innerHeight }; })()`);
    regression.push({ name: 'F-06 submit reachable at 320px height', ok: f6.bottom <= 320 && f6.vh === 320, detail: f6 });
  }

  const contrast = (() => {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = hex => { const [r, g, b] = hex.match(/\w\w/g).map(h => parseInt(h, 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    return { markOnWhite: ratio('c2503c', 'ffffff'), markOnPage: ratio('c2503c', 'f4f6f6'), amountOnWhite: ratio('1b292a', 'ffffff'), shareOnWhite: ratio('637372', 'ffffff'), tealEdgeOnWhite: ratio('286d65', 'ffffff') };
  })();

  const summary = {
    label, asset, generatedAt: new Date().toISOString(),
    widths, states: stateList,
    contrast, regression,
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
