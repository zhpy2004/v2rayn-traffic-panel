/**
 * V2RayN 相关的探测：可执行文件位置、当前启用的路由模式。
 * 只读，不修改 V2RayN 的任何配置。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const run = promisify(execFile);

let exeCache = { value: '', at: 0 };
let modeCache = { value: '', at: 0 };
const CACHE_MS = 60_000;

/** 找到 v2rayN.exe 的完整路径（缓存 60 秒） */
export async function findV2RayNExe() {
  if (Date.now() - exeCache.at < CACHE_MS) return exeCache.value;
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process v2rayN -ErrorAction SilentlyContinue | Select-Object -First 1).Path'],
      { windowsHide: true, timeout: 4000 },
    );
    exeCache = { value: stdout.trim(), at: Date.now() };
  } catch {
    exeCache = { value: '', at: Date.now() };
  }
  return exeCache.value;
}

/** 读取 V2RayN 当前启用的路由规则名（如「V4-全局(Global)」） */
export async function readRoutingMode() {
  if (Date.now() - modeCache.at < CACHE_MS) return modeCache.value;
  const exe = await findV2RayNExe();
  if (!exe) {
    modeCache = { value: '', at: Date.now() };
    return '';
  }
  const dbFile = join(dirname(exe), 'guiConfigs', 'guiNDB.db');
  if (!existsSync(dbFile)) {
    modeCache = { value: '', at: Date.now() };
    return '';
  }
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true, timeout: 1000 });
    const row = db.prepare('SELECT Remarks FROM RoutingItem WHERE IsActive = 1').get();
    db.close();
    modeCache = { value: row?.Remarks ?? '', at: Date.now() };
  } catch {
    modeCache = { value: '', at: Date.now() };
  }
  return modeCache.value;
}
