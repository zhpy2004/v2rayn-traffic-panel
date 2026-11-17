/**
 * 用 CDP 打开 WebRTC 探针页面，等 ICE 收集完成后打印候选。
 * 用法: node test/rtc-check.mjs [url] [等待毫秒]
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = process.argv[2] ?? pathToFileURL(resolve('test/webrtc-probe.html')).href;
const waitMs = Number(process.argv[3] ?? 11000);
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
    const { resolve: ok, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else ok(msg.result);
  }
});
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((ok, reject) => pending.set(mid, { resolve: ok, reject }));
};

await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

const out = await send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.getElementById('out');
    return el ? el.textContent : 'no probe page';
  })()`,
  returnByValue: true,
});

const text = out.result.value ?? '';
let parsed = null;
try { parsed = JSON.parse(text); } catch { /* 保留原文 */ }

if (parsed) {
  const cands = parsed.candidates ?? [];
  const srflx = cands.filter((c) => c.includes('srflx'));
  const host = cands.filter((c) => c.includes('host'));
  const relay = cands.filter((c) => c.includes('relay'));
  console.log(`CANDIDATES total=${cands.length} host=${host.length} srflx=${srflx.length} relay=${relay.length}`);
  for (const c of srflx) console.log(`  SRFLX ${c}`);
  for (const c of host.slice(0, 4)) console.log(`  HOST  ${c}`);
  if (!cands.length) console.log(`  (no candidates) raw=${text.slice(0, 300)}`);
} else {
  console.log(text);
}
ws.close();
process.exit(0);
