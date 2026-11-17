/**
 * 存储层：SQLite（Node 内置 node:sqlite，无第三方依赖）。
 *
 * 两类数据：
 *  - daily：按 (日期, 域名) 聚合，长期保留，所有总量/排行查询都走它；
 *  - conns：逐条连接明细，只用于"最近连接"列表，按保留天数清理。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS daily (
    day   TEXT    NOT NULL,
    host  TEXT    NOT NULL,
    up    INTEGER NOT NULL DEFAULT 0,
    down  INTEGER NOT NULL DEFAULT 0,
    conns INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, host)
  );
  CREATE INDEX IF NOT EXISTS daily_day ON daily(day);

  CREATE TABLE IF NOT EXISTS conns (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts    INTEGER NOT NULL,
    host  TEXT    NOT NULL,
    port  INTEGER NOT NULL DEFAULT 0,
    proto TEXT    NOT NULL DEFAULT '',
    up    INTEGER NOT NULL DEFAULT 0,
    down  INTEGER NOT NULL DEFAULT 0,
    dur   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS conns_ts ON conns(ts);

  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
`;

/** 本地时区的 YYYY-MM-DD */
export function localDay(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地时区当月第一天 YYYY-MM-01 */
export function monthStart(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

/** 往前 n 天的日期（含今天） */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d.getTime());
}

export function openStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const stmtInsertConn = db.prepare(
    'INSERT INTO conns (ts, host, port, proto, up, down, dur) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const stmtUpsertDaily = db.prepare(`
    INSERT INTO daily (day, host, up, down, conns) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(day, host) DO UPDATE SET
      up = up + excluded.up,
      down = down + excluded.down,
      conns = conns + 1
  `);
  const stmtTotals = db.prepare(
    'SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down, COALESCE(SUM(conns), 0) AS conns FROM daily WHERE day >= ?'
  );
  const stmtSeries = db.prepare(
    'SELECT day, SUM(up) AS up, SUM(down) AS down, SUM(conns) AS conns FROM daily WHERE day >= ? GROUP BY day ORDER BY day'
  );
  const stmtTop = db.prepare(
    'SELECT host, SUM(up) AS up, SUM(down) AS down, SUM(conns) AS conns FROM daily WHERE day >= ? GROUP BY host ORDER BY (SUM(up) + SUM(down)) DESC LIMIT ?'
  );
  const stmtRecent = db.prepare(
    'SELECT ts, host, port, proto, up, down, dur FROM conns ORDER BY id DESC LIMIT ?'
  );
  const stmtMetaGet = db.prepare('SELECT v FROM meta WHERE k = ?');
  const stmtMetaSet = db.prepare(
    'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  );
  const stmtMetaDel = db.prepare('DELETE FROM meta WHERE k = ?');
  const stmtPurge = db.prepare('DELETE FROM conns WHERE ts < ?');

  let lastPurge = 0;

  return {
    /** 记录一条已完成连接 */
    record({ ts, host, port = 0, proto = '', up = 0, down = 0, dur = 0 }) {
      stmtInsertConn.run(ts, host, port, proto, up, down, dur);
      stmtUpsertDaily.run(localDay(ts), host, up, down);
    },

    /** 某个起始日期（本地 YYYY-MM-DD）以来的合计 */
    totals(sinceDay) {
      return stmtTotals.get(sinceDay) ?? { up: 0, down: 0, conns: 0 };
    },

    /** 日序列 */
    series(sinceDay) {
      return stmtSeries.all(sinceDay);
    },

    /** 站点排行（按 up+down 降序） */
    top(sinceDay, limit = 20) {
      return stmtTop.all(sinceDay, limit);
    },

    /** 最近连接明细 */
    recent(limit = 30) {
      return stmtRecent.all(limit);
    },

    meta: {
      get(k) {
        const row = stmtMetaGet.get(k);
        return row ? row.v : null;
      },
      set(k, v) {
        stmtMetaSet.run(k, String(v));
      },
      del(k) {
        stmtMetaDel.run(k);
      },
    },

    /** 定期清理过期明细（每小时最多一次） */
    purgeRaw(retentionDays) {
      const now = Date.now();
      if (now - lastPurge < 3600_000) return 0;
      lastPurge = now;
      const cutoff = now - retentionDays * 86400_000;
      const res = stmtPurge.run(cutoff);
      return Number(res.changes ?? 0);
    },

    /** 最近 N 天的日期边界（含今天） */
    since(days) {
      return daysAgo(days - 1);
    },

    close() {
      db.close();
    },
  };
}
