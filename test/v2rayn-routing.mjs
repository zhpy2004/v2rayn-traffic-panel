/**
 * 读取 V2RayN 的路由规则（只读），汇总每条规则的出站与匹配条件。
 * 用法: node test/v2rayn-routing.mjs [db路径]
 */
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2] ?? 'C:/Users/zhpy/Downloads/v2rayN-windows-64/v2rayN-windows-64/guiConfigs/guiNDB.db';
const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 3000 });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('tables:', tables.join(', '));

if (!tables.includes('RoutingItem')) {
  console.log('no RoutingItem table');
  process.exit(0);
}

const rows = db.prepare('SELECT * FROM RoutingItem').all();
console.log(`RoutingItem rows: ${rows.length}`);

for (const row of rows) {
  const { id, remarks, url, rules, locking } = row;
  console.log(`\n=== #${id} ${remarks ?? ''} slug=${url ?? ''} locked=${locking} ===`);
  let parsed;
  try {
    parsed = JSON.parse(rules);
  } catch (err) {
    console.log('  rules parse failed:', err.message, String(rules).slice(0, 100));
    continue;
  }
  const list = parsed.rules ?? parsed;
  if (!Array.isArray(list)) {
    console.log('  unexpected shape:', JSON.stringify(parsed).slice(0, 200));
    continue;
  }
  for (const [i, rule] of list.entries()) {
    const domains = rule.domain ?? [];
    const ips = rule.ip ?? [];
    const others = Object.entries(rule)
      .filter(([k]) => !['domain', 'ip', 'outboundTag'].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    const preview = (arr, n = 6) => (arr.length <= n ? arr.join(' ') : `${arr.slice(0, n).join(' ')} …(+${arr.length - n})`);
    console.log(`  [${i}] -> ${rule.outboundTag}  domain(${domains.length}): ${preview(domains)}  ip(${ips.length}): ${preview(ips)}  ${others}`);
  }
}

db.close();
