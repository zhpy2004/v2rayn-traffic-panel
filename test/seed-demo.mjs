/**
 * 演示数据：给面板塞一批近 30 天的假记录，用来检查界面渲染。
 * 只在 test/ 下使用，不影响正式数据。
 */
import { openStore, localDay } from '../src/store.js';

const dbFile = process.argv[2];
if (!dbFile) {
  console.error('用法: node test/seed-demo.mjs <db 路径>');
  process.exit(1);
}

const store = openStore(dbFile);

const SITES = [
  ['www.youtube.com', 0],
  ['rr1---sn-4g5e6nez.googlevideo.com', 0],
  ['api.github.com', 0],
  ['github.com', 0],
  ['chat.deepseek.com', 0],
  ['api.deepseek.com', 0],
  ['www.google.com', 0],
  ['fonts.gstatic.com', 0],
  ['cdn.jsdelivr.net', 0],
  ['registry.npmjs.org', 0],
  ['x.com', 0],
  ['pbs.twimg.com', 0],
  ['www.bilibili.com', 0],
  ['upos-sz-mirrorcos.bilivideo.com', 0],
  ['discord.com', 0],
  ['cdn.discordapp.com', 0],
];

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
  const base = new Date();
  base.setDate(base.getDate() - dayOffset);
  base.setHours(9, 0, 0, 0);
  const dayTs = base.getTime();
  const dayFactor = 0.45 + rand() * 1.3;

  for (const [host] of SITES) {
    const conns = Math.floor(rand() * 6 * dayFactor);
    for (let i = 0; i < conns; i += 1) {
      const down = Math.floor((200_000 + rand() * 18_000_000) * dayFactor);
      const up = Math.floor(down * (0.02 + rand() * 0.08));
      const ts = dayTs + Math.floor(rand() * 12 * 3600_000);
      if (localDay(ts) !== localDay(base.getTime())) continue;
      store.record({
        ts,
        host,
        port: 443,
        proto: rand() > 0.15 ? 'http-connect' : 'socks5',
        up,
        down,
        dur: Math.floor(1000 + rand() * 90_000),
      });
    }
  }
}

console.log('演示数据已写入', dbFile);
store.close();
