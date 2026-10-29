// Evidence-correction probe (C-2): measure fixed-page vertical offsets per viewport.
// Documentation-only helper; it does not modify assets.
// Usage: node probe-vertical-offset.mjs --root <asset dir> --label before|after
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
  return acc;
}, []));
const asset = resolve(args.root);
const label = args.label || 'run';

const profile = await mkdtemp(resolve(tmpdir(), 'xqj-probe-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

try {
  let port;
  for (let i = 0; i < 120; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await new Promise(r => setTimeout(r, 50)); }
  }
  if (!port) throw new Error('Chrome did not expose its debugging port');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const waiting = new Map();
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; waiting.set(id, { res, rej });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  const rows = [];
  for (const [width, height] of [[760, 1100], [1000, 1100], [1440, 1050]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 760, screenWidth: width, screenHeight: height });
    const url = pathToFileURL(resolve(asset, 'fixed-v3-source.html')); url.search = 'state=normal';
    await send('Page.navigate', { url: url.href });
    for (let i = 0; i < 80; i++) {
      try { if (await evaluate(`document.readyState==='complete' && !!window.visualReference`)) break; } catch {}
      await new Promise(r => setTimeout(r, 40));
    }
    await evaluate('document.fonts.ready'); await new Promise(r => setTimeout(r, 60));
    rows.push(await evaluate(`(() => {
      const y = s => { const el = document.querySelector(s); return el ? +el.getBoundingClientRect().top.toFixed(1) : null; };
      const h = s => { const el = document.querySelector(s); return el ? +el.getBoundingClientRect().height.toFixed(1) : null; };
      return { viewport: innerWidth + 'x' + innerHeight, docHeight: document.documentElement.scrollHeight,
        summary: y('.fixed-summary'), summaryH: h('.fixed-summary'),
        list: y('.fixed-list'), categories: y('.categories'),
        ringName: document.querySelector('.summary-ring-name')?.textContent.trim() ?? null };
    })()`));
  }
  console.log(JSON.stringify({ label, root: asset, rows }, null, 1));
} finally {
  chrome.kill('SIGKILL');
}
