/**
 * 运行配置。所有值都可用环境变量覆盖，默认值适配本机 V2RayN 的默认布局。
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  /** 项目根目录 */
  root,
  /** 面板 HTTP 端口 */
  port: num(process.env.TRAFFIC_PORT, 8787),
  /** 计数中转监听端口（面板接管系统代理时指向这里） */
  relayPort: num(process.env.TRAFFIC_RELAY_PORT, 10810),
  /** 上游：V2RayN 的本地 SOCKS5 入站 */
  upstreamHost: process.env.TRAFFIC_UPSTREAM_HOST || '127.0.0.1',
  upstreamPort: num(process.env.TRAFFIC_UPSTREAM_PORT, 10808),
  /** SQLite 数据库文件 */
  dbFile: process.env.TRAFFIC_DB || join(root, 'data', 'traffic.db'),
  /** 面板绑定地址：默认只监听本机 */
  bindHost: process.env.TRAFFIC_BIND || '127.0.0.1',
  /** 中转并发上限 */
  maxConnections: num(process.env.TRAFFIC_MAX_CONN, 512),
  /** 原始连接明细保留天数（日聚合长期保留） */
  rawRetentionDays: num(process.env.TRAFFIC_RAW_DAYS, 30),
};
