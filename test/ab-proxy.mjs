/**
 * 同一时刻交替对比：经面板 10810 vs 直连 V2RayN socks 10808。
 * 用法: node test/ab-proxy.mjs [轮数]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const rounds = Number(process.argv[2] ?? 3);
const urls = [
  'https://accounts.google.com/ServiceLogin',
  'https://ogs.google.com/',
  'https://ssl.gstatic.com/',
  'https://www.googleapis.com/',
];

async function fetchVia(proxy, url) {
  const started = Date.now();
  try {
    const { stdout } = await run('curl.exe', [
      '-s', '-o', 'NUL', '--ssl-no-revoke', '--max-time', '25',
      '-x', proxy, '-w', '%{http_code}', url,
    ], { timeout: 30_000 });
    return { ok: stdout.trim(), ms: Date.now() - started };
  } catch (err) {
    return { ok: 'ERR', ms: Date.now() - started };
  }
}

const stats = { panel: [], socks: [] };

for (let r = 1; r <= rounds; r += 1) {
  for (const url of urls) {
    // 交替顺序，避免总是面板先跑
    const order = r % 2 === 0
      ? [['panel', 'http://127.0.0.1:10810'], ['socks', 'socks5h://127.0.0.1:10808']]
      : [['socks', 'socks5h://127.0.0.1:10808'], ['panel', 'http://127.0.0.1:10810']];

    const line = [];
    for (const [kind, proxy] of order) {
      const res = await fetchVia(proxy, url);
      stats[kind].push(res.ms);
      line.push(`${kind}=${res.ok}/${res.ms}ms`);
    }
    console.log(`[r${r}] ${url.padEnd(42)} ${line.join('  ')}`);
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
console.log(`\n中位耗时: 10810=${median(stats.panel)}ms  socks=${median(stats.socks)}ms  (n=${stats.panel.length})`);
