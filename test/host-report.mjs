/**
 * 按域名汇总流量，可选正则过滤。
 * 用法: node test/host-report.mjs [过滤正则] [today|month]
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const filter = new RegExp(process.argv[2] ?? '.', 'i');
const period = process.argv[3] ?? 'today';
const dbFile = join(process.cwd(), 'data', 'traffic.db');

const db = new DatabaseSync(dbFile, { readOnly: true });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
const since = period === 'month' ? month : today;

const rows = db
  .prepare('SELECT host, SUM(up) up, SUM(down) down, SUM(conns) conns FROM daily WHERE day >= ? GROUP BY host ORDER BY (SUM(up)+SUM(down)) DESC')
  .all(since);

const total = rows.reduce((a, r) => a + r.up + r.down, 0);
const matched = rows.filter((r) => filter.test(r.host));
const matchedTotal = matched.reduce((a, r) => a + r.up + r.down, 0);

const fmt = (n) => {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < 3) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
};

console.log(`period=${period} since=${since}`);
console.log(`total=${fmt(total)}  matched=${fmt(matchedTotal)}  share=${((matchedTotal / total) * 100).toFixed(1)}%  hosts=${matched.length}/${rows.length}`);
console.log('');

for (const r of matched.slice(0, 40)) {
  const t = r.up + r.down;
  console.log(`${fmt(t).padStart(10)}  ${((t / total) * 100).toFixed(1).padStart(5)}%  ${String(r.conns).padStart(5)} 次  ${r.host}`);
}

db.close();
