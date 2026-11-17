import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/traffic.db', { readOnly: true });
const rows = db.prepare('SELECT host, up, down, dur, ts FROM conns ORDER BY down DESC LIMIT 10').all();

for (const r of rows) {
  const d = new Date(r.ts);
  const mb = (r.down / 1048576).toFixed(1);
  console.log(`${mb.padStart(7)} MB  ${String(r.dur).padStart(7)} ms  ${d.toLocaleTimeString()}  ${r.host}`);
}

db.close();
