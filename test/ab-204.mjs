/**
 * 交替对比面板(10815 调试实例)与 socks(10808)，固定小目标，各 8 次。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const url = 'https://www.google.com/generate_204';

async function once(proxy) {
  const t = Date.now();
  try {
    const { stdout } = await run('curl.exe', ['-s', '-o', 'NUL', '--ssl-no-revoke', '--max-time', '20', '-x', proxy, '-w', '%{http_code}', url], { timeout: 25_000 });
    return { code: stdout.trim(), ms: Date.now() - t };
  } catch {
    return { code: 'ERR', ms: Date.now() - t };
  }
}

const panel = [];
const socks = [];
for (let i = 0; i < 8; i += 1) {
  const order = i % 2 === 0 ? ['panel', 'socks'] : ['socks', 'panel'];
  for (const kind of order) {
    const res = kind === 'panel' ? await once('http://127.0.0.1:10815') : await once('socks5h://127.0.0.1:10808');
    (kind === 'panel' ? panel : socks).push(res.ms);
    console.log(`${i} ${kind.padEnd(5)} ${res.code} ${res.ms}ms`);
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`\npanel median=${med(panel)}ms  socks median=${med(socks)}ms`);
console.log(`panel all=${panel.join(',')}`);
console.log(`socks all=${socks.join(',')}`);
