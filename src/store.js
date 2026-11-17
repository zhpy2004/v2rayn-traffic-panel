/**
 * 存储层：SQLite（Node 内置 node:sqlite，无第三方依赖）。
 *
 *  - route_daily：按 (日期, 域名, 路由) 聚合，route 为 proxy / direct，长期保留；
 *  - daily：历史遗留的合并表（保留兼容，迁移后不再写入统计口径）；
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

  CREATE TABLE IF NOT EXISTS route_daily (
    day   TEXT    NOT NULL,
    host  TEXT    NOT NULL,
    route TEXT    NOT NULL,
    up    INTEGER NOT NULL DEFAULT 0,
    down  INTEGER NOT NULL DEFAULT 0,
    conns INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, host, route)
  );
  CREATE INDEX IF NOT EXISTS route_daily_day ON route_daily(day, route);

  CREATE TABLE IF NOT EXISTS conns (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts    INTEGER NOT NULL,
    host  TEXT    NOT NULL,
    port  INTEGER NOT NULL DEFAULT 0,
    proto TEXT    NOT NULL DEFAULT '',
    route TEXT    NOT NULL DEFAULT 'proxy',
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

  // 老库补 route 列
  const connCols = db.prepare('PRAGMA table_info(conns)').all();
  if (!connCols.some((c) => c.name === 'route')) {
    db.exec("ALTER TABLE conns ADD COLUMN route TEXT NOT NULL DEFAULT 'proxy'");
  }

  // 历史合并数据迁移成 proxy 口径（只做一次）
  const migrated = db.prepare("SELECT v FROM meta WHERE k = 'route_migrated'").get();
  if (!migrated) {
    db.exec(`
      INSERT OR IGNORE INTO route_daily (day, host, route, up, down, conns)
      SELECT day, host, 'proxy', up, down, conns FROM daily
    `);
    db.prepare("INSERT INTO meta (k, v) VALUES ('route_migrated', '1') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run();
  }

  const stmtInsertConn = db.prepare(
    'INSERT INTO conns (ts, host, port, proto, route, up, down, dur) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const stmtUpsertDaily = db.prepare(`
    INSERT INTO daily (day, host, up, down, conns) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(day, host) DO UPDATE SET
      up = up + excluded.up,
      down = down + excluded.down,
      conns = conns + 1
  `);
  const stmtUpsertRoute = db.prepare(`
    INSERT INTO route_daily (day, host, route, up, down, conns) VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(day, host, route) DO UPDATE SET
      up = up + excluded.up,
      down = down + excluded.down,
      conns = conns + 1
  `);
  const stmtTotals = db.prepare(
    'SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down, COALESCE(SUM(conns), 0) AS conns FROM route_daily WHERE day >= ? AND route = ?'
  );
  const stmtRouteTotals = db.prepare(
    'SELECT route, COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down, COALESCE(SUM(conns), 0) AS conns FROM route_daily WHERE day >= ? GROUP BY route'
  );
  const stmtSeries = db.prepare(
    'SELECT day, SUM(up) AS up, SUM(down) AS down, SUM(conns) AS conns FROM route_daily WHERE day >= ? AND route = ? GROUP BY day ORDER BY day'
  );
  const stmtTop = db.prepare(
    'SELECT host, SUM(up) AS up, SUM(down) AS down, SUM(conns) AS conns FROM route_daily WHERE day >= ? AND route = ? GROUP BY host ORDER BY (SUM(up) + SUM(down)) DESC LIMIT ?'
  );
  const stmtRecent = db.prepare(
    'SELECT ts, host, port, proto, route, up, down, dur FROM conns ORDER BY id DESC LIMIT ?'
  );
  const stmtMetaGet = db.prepare('SELECT v FROM meta WHERE k = ?');
  const stmtMetaSet = db.prepare(
    'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  );
  const stmtMetaDel = db.prepare('DELETE FROM meta WHERE k = ?');
  const stmtPurge = db.prepare('DELETE FROM conns WHERE ts < ?');

  let lastPurge = 0;

  return {
    /** 记录一条已完成连接；route 为 proxy / direct */
    record({ ts, host, port = 0, proto = '', route = 'proxy', up = 0, down = 0, dur = 0 }) {
      stmtInsertConn.run(ts, host, port, proto, route, up, down, dur);
      stmtUpsertDaily.run(localDay(ts), host, up, down);
      stmtUpsertRoute.run(localDay(ts), host, route, up, down);
    },

    /** 某个起始日期以来的合计（默认只算代理流量） */
    totals(sinceDay, route = 'proxy') {
      return stmtTotals.get(sinceDay, route) ?? { up: 0, down: 0, conns: 0 };
    },

    /** 按路由分组的合计：{ proxy: {...}, direct: {...} } */
    routeTotals(sinceDay) {
      const out = {
        proxy: { up: 0, down: 0, conns: 0 },
        direct: { up: 0, down: 0, conns: 0 },
      };
      for (const row of stmtRouteTotals.all(sinceDay)) {
        if (out[row.route]) out[row.route] = { up: row.up, down: row.down, conns: row.conns };
      }
      return out;
    },

    /** 日序列（默认代理口径） */
    series(sinceDay, route = 'proxy') {
      return stmtSeries.all(sinceDay, route);
    },

    /** 站点排行（默认代理口径） */
    top(sinceDay, limit = 20, route = 'proxy') {
      return stmtTop.all(sinceDay, route, limit);
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
