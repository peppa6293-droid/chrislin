// F-01~F-07 rework verification harness (reference asset only).
// Usage: node verify.mjs --root <asset dir> --out <evidence subdir> --label before|after
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

const profile = await mkdtemp(resolve(tmpdir(), 'xqj-rework-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let socket;
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
    const timer = setTimeout(() => { waiting.delete(id); rej(new Error(`CDP timeout ${method}`)); }, 15000);
    waiting.set(id, { resolve: res, reject: rej, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.addEventListener('error',e=>{window.__err=(window.__err||'')+e.message});"});

  async function open({ page = 'home', state = 'roomy', width = 390, height = 844, panel = '', review = false, notes = false }) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 760, screenWidth: width, screenHeight: height,
    });
    await send('Emulation.setEmulatedMedia', { features: [] });
    const q = new URLSearchParams({ state });
    if (review) q.set('view', 'review');
    if (notes) q.set('notes', 'open');
    if (panel) q.set('panel', panel);
    const file = page === 'fixed' ? 'fixed-v3-source.html' : 'index.html';
    const url = pathToFileURL(resolve(asset, file)); url.search = q.toString();
    await send('Page.navigate', { url: url.href });
    const expectedSearch = '?' + q.toString();
    for (let i = 0; i < 80; i++) {
      try {
        const ready = await evaluate(`document.readyState==='complete' && !!window.visualReference && window.visualReference.state===${JSON.stringify(state)} && location.search===${JSON.stringify(expectedSearch)}`);
        if (ready) break;
      } catch { /* document replaced mid-navigation */ }
      await new Promise(r => setTimeout(r, 40));
    }
    await evaluate('document.fonts.ready');
    await new Promise(r => setTimeout(r, 60));
    return url.href;
  }

  const measureExpr = `(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) }; };
    const cs = el => el ? getComputedStyle(el) : null;
    const dialog = document.querySelector('dialog.payment-sheet');
    const actions = document.querySelector('.payment-actions');
    const confirm = document.querySelector('[data-confirm-preview]');
    const toggle = document.querySelector('[data-toggle-details]');
    const controls = toggle?.getAttribute('aria-controls');
    const target = controls ? document.getElementById(controls) : null;
    const fields = document.querySelector('.payment-fields');
    const hero = document.querySelector('.hero-grid');
    const modules = document.querySelector('.modules');
    const firstModule = modules?.querySelector('.module');
    return {
      innerWidth, innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      content: box(document.querySelector('.content')),
      sidebar: box(document.querySelector('.side')),
      hero: box(document.querySelector('.hero')),
      chart: box(document.querySelector('.chart-card')),
      heroGrid: hero ? { columns: getComputedStyle(hero).gridTemplateColumns, box: box(hero) } : null,
      modules: box(modules),
      firstModule: box(firstModule),
      docHeight: document.documentElement.scrollHeight,
      dialogOpen: !!dialog?.open,
      dialog: box(dialog),
      dialogClientHeight: dialog?.clientHeight ?? null,
      dialogScrollHeight: dialog?.scrollHeight ?? null,
      fields: box(fields),
      fieldsScrollHeight: fields?.scrollHeight ?? null,
      fieldsClientHeight: fields?.clientHeight ?? null,
      fieldsOverflow: fields ? getComputedStyle(fields).overflowY : null,
      actions: box(actions),
      confirm: box(confirm),
      confirmBottomVisible: confirm ? confirm.getBoundingClientRect().bottom <= innerHeight + 0.5 : null,
      confirmTop: confirm ? +confirm.getBoundingClientRect().top.toFixed(1) : null,
      toggleText: toggle?.textContent.trim() ?? null,
      ariaExpanded: toggle?.getAttribute('aria-expanded') ?? null,
      ariaControls: controls,
      ariaControlsExists: !!target,
      ariaControlsHasFields: !!target && target.contains(document.querySelector('.date-field input')) && target.contains(document.querySelector('.note-field input')),
      ariaControlsHidden: target ? target.hasAttribute('hidden') : null,
      summaryName: document.querySelector('.summary-ring-name')?.textContent.trim() ?? null,
      detailGrid: cs(document.querySelector('.detail-fields'))?.gridTemplateColumns ?? null,
      detailDisplay: cs(document.querySelector('.detail-fields'))?.display ?? null,
      noteGridColumn: cs(document.querySelector('.note-field'))?.gridColumn ?? null,
      noteDisplay: cs(document.querySelector('.note-field'))?.display ?? null,
      dateBox: box(document.querySelector('.date-field')),
      summaryAria: document.querySelector('.summary-ring')?.getAttribute('aria-label') ?? null,
      categoriesVisible: [...document.querySelectorAll('.category-item')].map(item => item.innerText.replace(/\\s+/g, ' ').trim()),
      colors: {
        card: cs(document.querySelector('.card'))?.backgroundColor,
        ringEdge: cs(document.querySelector('.ring-edge'))?.stroke,
        ringProgress: cs(document.querySelector('.ring-progress'))?.stroke,
        innerEdge: cs(document.querySelector('.ring-edge.inner'))?.stroke,
        innerProgress: cs(document.querySelector('.ring-progress.inner'))?.stroke,
        track: cs(document.querySelector('.track'))?.stroke,
        trackEdge: cs(document.querySelector('.track-edge'))?.stroke,
        categoryFillBorder: cs(document.querySelector('.category-fill'))?.borderRightColor,
        categoryFillBg: cs(document.querySelector('.category-fill'))?.backgroundColor,
        categoryTrackShadow: cs(document.querySelector('.category-track'))?.boxShadow,
        categoryTrackBg: cs(document.querySelector('.category-track'))?.backgroundColor,
        summaryEdge: cs(document.querySelector('.summary-ring-edge'))?.stroke,
        summaryProgress: cs(document.querySelector('.summary-ring-progress'))?.stroke,
        focusOutline: (() => { const b = document.querySelector('.button, button'); if (!b) return null; b.focus(); return getComputedStyle(b).outlineColor; })(),
      },
      copy: document.querySelector('#state-copy')?.textContent ?? null,
    };
  })()`;

  const cases = [
    { page: 'home', state: 'roomy', width: 390, height: 844 },
    { page: 'home', state: 'overload', width: 390, height: 844 },
    { page: 'home', state: 'zero-burden', width: 390, height: 844 },
    { page: 'home', state: 'tight', width: 390, height: 844 },
    { page: 'home', state: 'roomy', width: 760, height: 1100 },
    { page: 'home', state: 'roomy', width: 1000, height: 1100 },
    { page: 'home', state: 'overload', width: 1000, height: 1100 },
    { page: 'home', state: 'roomy', width: 1440, height: 1050 },
    { page: 'home', state: 'pending', width: 1000, height: 1100, review: true, notes: true },
    { page: 'fixed', state: 'normal', width: 390, height: 844 },
    { page: 'fixed', state: 'normal', width: 760, height: 1100 },
    { page: 'fixed', state: 'normal', width: 1000, height: 1100 },
    { page: 'fixed', state: 'normal', width: 1440, height: 1050 },
    { page: 'fixed', state: 'overpaid', width: 1000, height: 1100, review: true },
    { page: 'fixed', state: 'zero-plan', width: 1000, height: 1100, review: true },
    { page: 'fixed', state: 'empty', width: 390, height: 844 },
    { page: 'fixed', state: 'normal', width: 390, height: 520, panel: 'collapsed' },
    { page: 'fixed', state: 'normal', width: 390, height: 520, panel: 'note' },
    { page: 'fixed', state: 'normal', width: 760, height: 900, panel: 'note' },
  ];

  const rows = [];
  for (const item of cases) {
    const url = await open(item);
    const m = await evaluate(measureExpr);
    const name = `${label}-${item.page}-${item.state}${item.panel ? '-payment-' + item.panel : ''}-${item.width}x${item.height}.png`;
    let screenshot = null;
    if (item.panel) {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(shot.data, 'base64');
      await writeFile(resolve(out, name), bytes);
      screenshot = { file: name, sha256: createHash('sha256').update(bytes).digest('hex') };
    } else {
      const fullHeight = Math.max(m.docHeight, item.height);
      if (fullHeight > item.height) {
        await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: fullHeight, deviceScaleFactor: 1, mobile: item.width <= 760, screenWidth: item.width, screenHeight: fullHeight });
      }
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(shot.data, 'base64');
      await writeFile(resolve(out, name), bytes);
      screenshot = { file: name, sha256: createHash('sha256').update(bytes).digest('hex') };
      if (fullHeight > item.height) {
        await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: item.width <= 760, screenWidth: item.width, screenHeight: item.height });
      }
    }
    rows.push({ ...item, url, metrics: m, screenshot });
  }

  // ---------- interaction assertions ----------
  const interactions = {};

  // F-01 / F-03 at 390x844
  await open({ page: 'fixed', state: 'normal', width: 390, height: 844 });
  interactions.f03_default = await evaluate(`(() => {const t=document.querySelector('[data-toggle-details]');const id=t.getAttribute('aria-controls');const el=id&&document.getElementById(id);return {ariaControls:id,targetExists:!!el,targetHasDate:!!el&&!!el.querySelector('.date-field input'),targetHasNote:!!el&&!!el.querySelector('.note-field input'),expanded:t.getAttribute('aria-expanded'),targetHidden:el?el.hasAttribute('hidden'):null};})()`);
  interactions.f01_placeholder = await evaluate(`(() => {const t=document.querySelector('[data-toggle-details]');return {text:t.textContent.trim(),note:document.querySelector('.note-field input').value,date:document.querySelector('.date-field input').value};})()`);
  await evaluate("document.querySelector('[data-pay]').click()");
  interactions.f01_open_collapsed = await evaluate("document.querySelector('[data-toggle-details]').textContent.trim()");
  await evaluate("document.querySelector('[data-toggle-details]').click()");
  interactions.f03_expanded = await evaluate(`(() => {const t=document.querySelector('[data-toggle-details]');const el=document.getElementById(t.getAttribute('aria-controls'));return {expanded:t.getAttribute('aria-expanded'),targetHidden:el?el.hasAttribute('hidden'):null,targetVisible:el?el.getBoundingClientRect().height>0:null};})()`);
  interactions.f03_order = await evaluate(`(() => {const s=sel=>{const e=document.querySelector(sel);const r=e.getBoundingClientRect();return {y:+r.y.toFixed(1),bottom:+r.bottom.toFixed(1)};};return {amount:s('.amount-field'),toggle:s('.detail-toggle'),date:s('.date-field'),note:s('.note-field'),actions:s('.payment-actions')};})()`);
  interactions.f01_fields_default = await evaluate(`({date:document.querySelector('[data-pay]')?document.querySelector('.date-field input').value:null,note:document.querySelector('.note-field input').value})`);
  // change note then collapse
  await evaluate(`(() => {const n=document.querySelector('.note-field input');n.value='地铁月卡·补充';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-toggle-details]').click();})()`);
  interactions.f01_collapsed_summary = await evaluate("document.querySelector('[data-toggle-details]').textContent.trim()");
  interactions.f01_collapsed_includes_note = await evaluate("document.querySelector('[data-toggle-details]').textContent.includes('地铁月卡·补充')");
  interactions.f01_collapsed_aria = await evaluate("document.querySelector('[data-toggle-details]').getAttribute('aria-label')");
  await evaluate("document.querySelector('[data-toggle-details]').click()");
  interactions.f01_reopen_value = await evaluate("document.querySelector('.note-field input').value");
  // only date filled
  await evaluate(`(() => {const n=document.querySelector('.note-field input');n.value='';const d=document.querySelector('.date-field input');d.value='2026-10-26';document.querySelector('[data-toggle-details]').click();})()`);
  interactions.f01_date_only_summary = await evaluate("document.querySelector('[data-toggle-details]').textContent.trim()");
  // nothing filled
  await evaluate(`(() => {document.querySelector('[data-toggle-details]').click();const d=document.querySelector('.date-field input');d.value='';document.querySelector('[data-toggle-details]').click();})()`);
  interactions.f01_empty_summary = await evaluate("document.querySelector('[data-toggle-details]').textContent.trim()");
  // cancel does not write: reopen and cancel, compare summary text of page
  await evaluate(`(() => {const before=document.querySelector('.fixed-summary').innerText;window.__beforeSummary=before;document.querySelector('[data-close-sheet]').click();})()`);
  interactions.f01_cancel_no_write = await evaluate("document.querySelector('.fixed-summary').innerText===window.__beforeSummary || !document.querySelector('dialog').open");

  // F-03 keyboard: expand details, then Tab date -> note -> actions
  await open({ page: 'fixed', state: 'normal', width: 390, height: 844 });
  await evaluate("document.querySelector('[data-pay]').click()");
  await evaluate("document.querySelector('[data-toggle-details]').click()");
  await evaluate("document.querySelector('.date-field input').focus()");
  interactions.f03_tab_order = [];
  for (let i = 0; i < 4; i++) {
    if (i) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, text: '\t', unmodifiedText: '\t' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    }
    interactions.f03_tab_order.push(await evaluate(`(() => {const b=document.activeElement;return {tag:b.tagName,cls:(b.className||'').toString().split(' ')[0]||null,label:(b.getAttribute('aria-label')||b.value||b.textContent||'').trim().slice(0,24)};})()`));
  }
  interactions.f03_tab_order_dom = await evaluate(`(() => {const d=document.querySelector('dialog.payment-sheet');const vis=el=>el.getBoundingClientRect().height>0&&!el.disabled&&el.tabIndex>=0;return [...d.querySelectorAll('a,button,input,select,textarea,[tabindex]')].filter(vis).map(el=>({tag:el.tagName,cls:(el.className||'').toString().split(' ')[0]||null,label:(el.getAttribute('aria-label')||el.value||el.textContent||'').trim().slice(0,24)}));})()`);
  // F-01 Esc closes without writing
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  interactions.f01_esc_closes = await evaluate("!document.querySelector('dialog.payment-sheet')?.open");

  // F-06: 390x520 and keyboard-shrunk 390x320
  await open({ page: 'fixed', state: 'normal', width: 390, height: 520, panel: 'collapsed' });
  interactions.f06_520 = await evaluate(`(() => {const c=document.querySelector('[data-confirm-preview]');const a=document.querySelector('.payment-actions');const f=document.querySelector('.payment-fields');const r=c.getBoundingClientRect();return {innerHeight,confirmBottom:+r.bottom.toFixed(1),confirmVisibleWithinViewport:r.bottom<=innerHeight+0.5,actionsBottom:+a.getBoundingClientRect().bottom.toFixed(1),fieldsOverflow:getComputedStyle(f).overflowY,fieldsScrollable:f.scrollHeight>f.clientHeight+1};})()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 320, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 320 });
  await new Promise(r => setTimeout(r, 120));
  interactions.f06_320_keyboard = await evaluate(`(() => {const c=document.querySelector('[data-confirm-preview]');const f=document.querySelector('.payment-fields');const r=c.getBoundingClientRect();return {innerHeight,confirmBottom:+r.bottom.toFixed(1),confirmVisibleWithinViewport:r.bottom<=innerHeight+0.5,fieldsScrollable:f.scrollHeight>f.clientHeight+1,fieldsClientHeight:f.clientHeight,fieldsScrollHeight:f.scrollHeight,activeTag:document.activeElement?.tagName};})()`);
  const kbShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(resolve(out, `${label}-fixed-payment-keyboard-390x320.png`), Buffer.from(kbShot.data, 'base64'));
  // expand details in shrunk viewport, date picker field visible & focusable
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
  await evaluate("document.querySelector('[data-toggle-details]')?.click()");
  interactions.f06_date_field = await evaluate(`(() => {const d=document.querySelector('.date-field input');d.focus();const r=d.getBoundingClientRect();return {type:d.type,visible:r.height>0,width:+r.width.toFixed(1),focusable:document.activeElement===d};})()`);
  // text scaling emulation
  interactions.f06_text_scaling = await evaluate(`(() => {const h=document.querySelector('#payment-title');const before=parseFloat(getComputedStyle(h).fontSize);document.documentElement.style.webkitTextSizeAdjust='150%';const after=parseFloat(getComputedStyle(h).fontSize);const c=document.querySelector('[data-confirm-preview]').getBoundingClientRect();const f=document.querySelector('.payment-fields');return {applied:after>before,before,after,confirmBottomAfterScale:+c.bottom.toFixed(1),innerHeight,confirmVisible:c.bottom<=innerHeight+0.5,fieldsScrollable:f.scrollHeight>f.clientHeight+1};})()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 520, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 520 });
  await new Promise(r => setTimeout(r, 100));
  interactions.f06_text_scaling_520 = await evaluate(`(() => {const c=document.querySelector('[data-confirm-preview]').getBoundingClientRect();const f=document.querySelector('.payment-fields');return {confirmVisible:c.bottom<=innerHeight+0.5,confirmBottom:+c.bottom.toFixed(1),innerHeight,fieldsScrollable:f.scrollHeight>f.clientHeight+1};})()`);
  const scaleShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(resolve(out, `${label}-fixed-payment-textscale-390x520.png`), Buffer.from(scaleShot.data, 'base64'));
  await evaluate("document.documentElement.style.webkitTextSizeAdjust=''");

  // F-04 color samples on clean normal page (1000) & home
  await open({ page: 'fixed', state: 'normal', width: 1000, height: 1100 });
  interactions.f04_colors_fixed = await evaluate(`(() => {const gs=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null;};return {card:gs('.card','backgroundColor'),summaryEdge:gs('.summary-ring-edge','stroke'),summaryProgress:gs('.summary-ring-progress','stroke'),summaryTrack:gs('.summary-ring circle','stroke'),categoryTrackBg:gs('.category-track','backgroundColor'),categoryTrackShadow:gs('.category-track','boxShadow'),categoryFillBorder:gs('.category-fill','borderRightColor'),categoryFillBg:gs('.category-fill','backgroundColor')};})()`);
  await open({ page: 'home', state: 'roomy', width: 1000, height: 1100 });
  interactions.f04_colors_home = await evaluate(`(() => {const gs=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null;};return {card:gs('.chart-card','backgroundColor'),ringProgress:gs('.ring-progress','stroke'),ringEdge:gs('.ring-edge','stroke'),innerProgress:gs('.ring-progress.inner','stroke'),innerEdge:gs('.ring-edge.inner','stroke'),track:gs('.track','stroke'),trackEdge:gs('.track-edge','stroke')};})()`);
  await evaluate("document.body.focus();document.activeElement.blur();");
  for (let i = 0; i < 2; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  interactions.f04_focus = await evaluate(`(() => {const b=document.activeElement;if(!b)return null;const s=getComputedStyle(b);return {tag:b.tagName,label:(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,40),outlineColor:s.outlineColor,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,focusVisible:b.matches(':focus-visible')};})()`);

  // F-05: 390x844 first module position (also captured as case above)
  await open({ page: 'home', state: 'roomy', width: 390, height: 844 });
  interactions.f05_390 = await evaluate(`(() => {const m=document.querySelector('.modules');const h=document.querySelector('.hero');const c=document.querySelector('.chart-card');const r=el=>{const b=el.getBoundingClientRect();return {y:+b.y.toFixed(1),height:+b.height.toFixed(1),bottom:+b.bottom.toFixed(1)};};return {firstModuleY:r(m).y,hero:r(h),chart:r(c),docHeight:document.documentElement.scrollHeight};})()`);

  const report = {
    label, generatedAt: new Date().toISOString(), assetRoot: asset,
    screenshots: rows.length, cases: rows, interactions,
    exceptions, remoteRequests,
    failures: [],
  };
  for (const r of rows) {
    if (!r.metrics.noHorizontalOverflow) report.failures.push(`${r.screenshot.file}: horizontal overflow`);
    if (/\bNaN\b|Infinity/.test(JSON.stringify(r.metrics))) report.failures.push(`${r.screenshot.file}: NaN/Infinity`);
  }
  if (exceptions.length) report.failures.push(`runtime exceptions: ${exceptions.length}`);
  if (remoteRequests.length) report.failures.push(`remote requests: ${remoteRequests.length}`);
  await writeFile(resolve(out, `${label}-metrics.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label, screenshots: rows.length, failures: report.failures, f05: interactions.f05_390, f06_520: interactions.f06_520, f06_320: interactions.f06_320_keyboard, f01: { collapsed: interactions.f01_collapsed_summary, empty: interactions.f01_empty_summary, dateOnly: interactions.f01_date_only_summary }, f03: interactions.f03_default, summaryName: rows.find(r=>r.page==='fixed'&&r.state==='normal'&&r.width===1000)?.metrics.summaryName }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
}
