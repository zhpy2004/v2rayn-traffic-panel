/**
 * 检查面板在指定窗口尺寸下是否一屏放得下（页面不出现纵向滚动）。
 * 用法: node test/fit-check.mjs <url> <宽> <高> [截图路径]
 */
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:8787/';
const width = Number(process.argv[3] ?? 1280);
const height = Number(process.argv[4] ?? 900);
const out = process.argv[5];
const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(2600);

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    return {
      viewport: [innerWidth, innerHeight],
      docScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      overflowPx: document.documentElement.scrollHeight - innerHeight,
      content: r('.content'),
      chart: r('.chart-card'),
      table: r('.table-card'),
      rank: r('.rank-card'),
      footer: r('footer'),
      rankRows: document.querySelectorAll('#rank-list .rank-item').length,
      recentRows: document.querySelectorAll('#recent-body tr:not(.empty)').length,
      month: document.querySelector('#month-total')?.textContent,
    };
  })())`,
  returnByValue: true,
});

console.log(probe.result.value);

if (out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`SAVED ${out}`);
}
ws.close();
process.exit(0);
