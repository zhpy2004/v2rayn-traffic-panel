import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/traffic.db', { readOnly: true });
const rows = db
  .prepare("SELECT host, SUM(up + down) AS bytes, SUM(conns) AS conns FROM route_daily WHERE route = 'direct' GROUP BY host ORDER BY bytes DESC LIMIT 40")
  .all();

const fmt = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

console.log(`直连主机数：${rows.length}`);
for (const r of rows) {
  console.log(`${fmt(r.bytes).padStart(9)}  ${String(r.conns).padStart(4)} 次  ${r.host}`);
}

const risky = rows.filter((r) => /azureedge|azurefd|cloudfront|akamai/i.test(r.host));
console.log('\n共享 CDN 域名（可能被第三方站点引用）：');
for (const r of risky) console.log(`  ${r.host}  ${fmt(r.bytes)}`);

db.close();
