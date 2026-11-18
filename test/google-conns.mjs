import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/traffic.db', { readOnly: true });
const rows = db
  .prepare("SELECT ts, host, route, down, dur FROM conns WHERE host LIKE '%google%' OR host LIKE '%gstatic%' ORDER BY id DESC LIMIT 15")
  .all();
for (const r of rows) {
  console.log(new Date(r.ts).toLocaleTimeString(), String(r.route).padEnd(7), `${String(r.dur).padStart(6)}ms`, String(r.down).padStart(8), r.host);
}
console.log('\n按路由统计今天:');
const agg = db
  .prepare("SELECT route, COUNT(*) n, SUM(down) down FROM conns WHERE host LIKE '%google%' OR host LIKE '%gstatic%' GROUP BY route")
  .all();
console.log(agg);
db.close();
