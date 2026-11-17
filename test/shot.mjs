/**
 * 用 Chrome DevTools Protocol 截图并读回页面状态。
 * 需要先启动带 --remote-debugging-port=9222 的 headless Edge/Chrome。
 * 用法: node test/shot.mjs <url> <输出png>
 */
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:8787/';
const out = process.argv[3] ?? 'shot.png';
const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('DevTools 端口没有响应');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message ?? 'unknown'}`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  return {
    ready,
    events,
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const version = await waitForDevtools();
  const target = await fetch(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((r) => r.json());
  const client = cdp(target.webSocketDebuggerUrl);
  await client.ready;

  const errors = [];
  const ws = client;
  ws.events.length = 0;

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1600,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await client.send('Page.navigate', { url });

  // 等页面加载 + 数据请求完成
  for (let i = 0; i < 40; i += 1) {
    await sleep(150);
    const ready = ws.events.some((e) => e.method === 'Page.loadEventFired');
    if (ready) break;
  }
  await sleep(1500);

  const probe = await client.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      month: document.querySelector('#month-total')?.textContent,
      today: document.querySelector('#today-total')?.textContent,
      rankRows: document.querySelectorAll('#rank-list .rank-item').length,
      rankFirst: document.querySelector('#rank-list .rank-item .h')?.textContent ?? null,
      recentRows: document.querySelectorAll('#recent-body tr:not(.empty)').length,
      pills: [...document.querySelectorAll('.pill')].map(p => p.textContent.trim()),
      trendBars: (() => { const c = document.querySelector('#trend'); return c ? c.width + 'x' + c.height : null; })(),
      hint: document.querySelector('#hint')?.textContent,
    })`,
    returnByValue: true,
  });

  const jsErrors = ws.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);

  const clipSelector = process.env.CLIP;
  let clip;
  if (clipSelector) {
    const rectRes = await client.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(clipSelector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height }; })()`,
      returnByValue: true,
    });
    const r = rectRes.result.value;
    if (r) clip = { ...r, scale: 2 };
  }

  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {}),
  });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  console.log('PAGE_STATE ' + probe.result.value);
  if (jsErrors.length) console.log('JS_ERRORS ' + JSON.stringify(jsErrors));
  console.log(`SAVED ${out}`);
  client.close();
}

main().catch((err) => {
  console.error('SHOT_FAILED', err.message);
  process.exit(1);
});
