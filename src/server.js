/**
 * 面板服务：静态页面 + JSON API + SSE 实时推送。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, relative } from 'node:path';
import { config } from './config.js';
import { openStore, localDay, monthStart } from './store.js';
import { TrafficRelay } from './relay.js';
import {
  readSystemProxy,
  captureSystemProxy,
  restoreSystemProxy,
  probeUpstream,
  isV2RayNRunning,
} from './systemproxy.js';

const store = openStore(config.dbFile);
const relay = new TrafficRelay({
  port: config.relayPort,
  upstreamHost: config.upstreamHost,
  upstreamPort: config.upstreamPort,
  maxConnections: config.maxConnections,
});

const sseClients = new Set();
const startedAt = Date.now();
const publicDir = join(config.root, 'public');
const pidFile = join(config.root, 'data', 'panel.pid');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

relay.on('conn', (record) => {
  try {
    store.record(record);
    store.purgeRaw(config.rawRetentionDays);
  } catch (err) {
    console.error('[store] 写入失败:', err.message);
  }
  broadcast('conn', record);
});
relay.on('tick', (tick) => broadcast('tick', tick));
relay.on('error', (err) => console.error('[relay]', err.message));
relay.on('debug', (info) => {
  if (process.env.TRAFFIC_DEBUG) console.error('[relay:debug]', info);
});

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function zeroFillSeries(rows, days) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = localDay(d.getTime());
    const row = map.get(day);
    out.push({ day, up: row?.up ?? 0, down: row?.down ?? 0, conns: row?.conns ?? 0 });
  }
  return out;
}

async function buildOverview() {
  const month = monthStart();
  const today = localDay();
  const monthTotals = store.totals(month);
  const todayTotals = store.totals(today);
  const proxy = await readSystemProxy();
  const captured = Boolean(store.meta.get('proxy.original'));
  const [reachable, v2rayN] = await Promise.all([probeUpstream(), isV2RayNRunning()]);
  const relayTarget = `127.0.0.1:${config.relayPort}`;

  return {
    now: Date.now(),
    startedAt,
    status: {
      relay: {
        running: relay.running,
        port: config.relayPort,
        target: relayTarget,
        active: relay.active,
        totalUp: relay.totalUp,
        totalDown: relay.totalDown,
      },
      upstream: {
        host: config.upstreamHost,
        port: config.upstreamPort,
        reachable,
      },
      v2rayN,
      proxy: {
        ...proxy,
        captured,
        pointingAtRelay: proxy.server === relayTarget,
        original: safeParse(store.meta.get('proxy.original')),
      },
    },
    month: { label: month.slice(0, 7), ...monthTotals },
    today: { label: today, ...todayTotals },
    series: zeroFillSeries(store.series(store.since(30)), 30),
    topMonth: store.top(month, 60),
    topToday: store.top(today, 60),
    recent: store.recent(40),
    db: relative(config.root, config.dbFile).replaceAll('\\', '/'),
  };
}

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(publicDir, rel));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

const server = http.createServer(async (req, res) => {  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/overview' && req.method === 'GET') {
      return json(res, await buildOverview());
    }

    if (pathname === '/api/live' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(heartbeat);
          sseClients.delete(res);
        }
      }, 25_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (pathname === '/api/relay' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'start') {
        await relay.start().catch((err) => {
          throw new Error(`中转启动失败：${err.message}`);
        });
      } else if (body.action === 'stop') {
        // 先还原系统代理再停，否则本机应用会指向一个已关闭的端口
        if (store.meta.get('proxy.original')) {
          await restoreSystemProxy(store).catch(() => {});
          broadcast('status', { proxy: 'restored' });
        }
        await relay.stop();
      } else {
        return json(res, { ok: false, error: 'action 必须是 start 或 stop' }, 400);
      }
      broadcast('status', { relay: { running: relay.running } });
      return json(res, { ok: true, running: relay.running });
    }

    if (pathname === '/api/proxy' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'capture') {
        if (!relay.running) await relay.start();
        const result = await captureSystemProxy(store, config.relayPort);
        broadcast('status', { proxy: 'captured' });
        return json(res, { ok: true, ...result });
      }
      if (body.action === 'restore') {
        const result = await restoreSystemProxy(store);
        broadcast('status', { proxy: 'restored' });
        return json(res, { ok: true, ...result });
      }
      return json(res, { ok: false, error: 'action 必须是 capture 或 restore' }, 400);
    }

    if (pathname === '/api/shutdown' && req.method === 'POST') {
      json(res, { ok: true, shuttingDown: true });
      setTimeout(() => shutdown(), 80);
      return;
    }

    if (pathname.startsWith('/api/')) return json(res, { ok: false, error: 'not found' }, 404);
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[http]', err);
    return json(res, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function main() {
  try {
    await relay.start();
  } catch (err) {
    console.error(`[relay] 端口 ${config.relayPort} 启动失败：${err.message}`);
  }
  server.listen(config.port, config.bindHost, async () => {
    mkdirSync(join(config.root, 'data'), { recursive: true });
    writeFileSync(pidFile, String(process.pid), 'utf8');
    console.log(`V2RayN 流量面板已启动: http://${config.bindHost}:${config.port}`);
    console.log(`计数中转: 127.0.0.1:${config.relayPort} -> ${config.upstreamHost}:${config.upstreamPort} (${relay.running ? '运行中' : '未运行'})`);
    if (process.env.TRAFFIC_AUTO_CAPTURE === '1') {
      // 等 V2RayN 自己先把系统代理写好，再接管，避免刚起来就被它覆盖
      setTimeout(async () => {
        try {
          await captureSystemProxy(store, config.relayPort);
          console.log('已自动接管系统代理（面板退出时还原）');
        } catch (err) {
          console.error(`[proxy] 自动接管失败：${err.message}`);
        }
      }, 4000);
      startProxyGuard();
    }
    if (process.env.TRAFFIC_OPEN === '1') {
      spawn('cmd.exe', ['/c', 'start', '', `http://${config.bindHost}:${config.port}`], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
  });
}

/**
 * 接管状态下，V2RayN 可能又把系统代理改回 10808。
 * 只在「当前值正好是 V2RayN 的入站地址」时重新接管：用户主动还原（备份被删）
 * 或改成别的代理时不抢。
 */
function startProxyGuard() {
  const upstream = `${config.upstreamHost}:${config.upstreamPort}`;
  setInterval(async () => {
    if (!store.meta.get('proxy.original')) return;
    try {
      const proxy = await readSystemProxy();
      if (proxy.enabled && proxy.server === upstream) {
        await captureSystemProxy(store, config.relayPort);
        console.log('[guard] 系统代理被改回 V2RayN，已重新接管');
      }
    } catch {
      /* 忽略单次失败 */
    }
  }, 8000).unref();
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\n正在关闭…');
  if (store.meta.get('proxy.original')) {
    await restoreSystemProxy(store).catch(() => {});
    console.log('系统代理已还原');
  }
  for (const res of sseClients) res.end();
  sseClients.clear();
  await relay.stop().catch(() => {});
  try {
    unlinkSync(pidFile);
  } catch {
    /* 文件可能已不在 */
  }
  server.close();
  store.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

// 端口被占用（例如已经有一个面板在跑）时给出明确提示，而不是抛栈
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${config.port} 已被占用：可能已经有一个面板在运行。`);
  } else {
    console.error('[http]', err.message);
  }
  process.exit(1);
});

main();
