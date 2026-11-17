/**
 * Windows 系统代理接管 / 还原（HKCU，无需管理员）。
 *
 * 只做三件事：
 *  1. 把 ProxyServer 指向本面板的中转端口；
 *  2. 保证 ProxyEnable=1，并把本机地址加进 ProxyOverride，避免面板自身流量绕圈；
 *  3. 记下原始值，随时可以原样还原。
 *
 * V2RayN 自己的「系统代理」开关会覆盖这些值 —— 面板检测到会提示，不会反复争抢。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { config } from './config.js';

const run = promisify(execFile);
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const NOTIFY_SCRIPT = join(config.root, 'scripts', 'notify-proxy.ps1');

async function regQuery(name) {
  try {
    const { stdout } = await run('reg.exe', ['query', REG_KEY, '/v', name], { windowsHide: true });
    const line = stdout
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s+${name}\\s+REG_`, 'i').test(l));
    if (!line) return null;
    const m = /^\s+\S+\s+(REG_\w+)\s+(.*)$/.exec(line);
    if (!m) return null;
    const [, type, raw] = m;
    if (type === 'REG_DWORD') return Number.parseInt(raw, 16);
    return raw;
  } catch {
    return null;
  }
}

async function regSet(name, type, value) {
  const args = ['add', REG_KEY, '/v', name, '/t', type, '/d', String(value), '/f'];
  await run('reg.exe', args, { windowsHide: true });
}

async function regDelete(name) {
  try {
    await run('reg.exe', ['delete', REG_KEY, '/v', name, '/f'], { windowsHide: true });
  } catch {
    /* 不存在即视为已删除 */
  }
}

async function notifyWinINet() {
  try {
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', NOTIFY_SCRIPT], {
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    /* 通知失败不影响注册表值本身 */
  }
}

/** 读取当前系统代理状态 */
export async function readSystemProxy() {
  const [enabled, server, override, autoConfig] = await Promise.all([
    regQuery('ProxyEnable'),
    regQuery('ProxyServer'),
    regQuery('ProxyOverride'),
    regQuery('AutoConfigURL'),
  ]);
  return {
    enabled: enabled === 1,
    server: typeof server === 'string' ? server : '',
    override: typeof override === 'string' ? override : '',
    autoConfig: typeof autoConfig === 'string' ? autoConfig : '',
  };
}

const LOOPBACK_OVERRIDE = ['<local>', 'localhost', '127.*', '::1', '10.*', '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*', '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*', '192.168.*'];

/** 备份同时落盘一份，面板没跑着也能用脚本还原 */
export const PROXY_BACKUP_FILE = join(config.root, 'data', 'proxy-original.json');

function writeBackupFile(value) {
  try {
    writeFileSync(PROXY_BACKUP_FILE, JSON.stringify(value, null, 2), 'utf8');
  } catch {
    /* 备份文件写不了不影响存库 */
  }
}

export function readBackupFile() {
  try {
    if (!existsSync(PROXY_BACKUP_FILE)) return null;
    return JSON.parse(readFileSync(PROXY_BACKUP_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function mergeOverride(existing, extra = []) {
  const parts = String(existing || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const item of [...LOOPBACK_OVERRIDE, ...extra]) {
    if (!item) continue;
    if (!parts.some((p) => p.toLowerCase() === item.toLowerCase())) parts.push(item);
  }
  return parts.join(';');
}

/** 接管系统代理，原值存入 store.meta 并落盘备份 */
export async function captureSystemProxy(store, relayPort, extraBypass = []) {
  const before = await readSystemProxy();
  const saved = JSON.stringify(before);
  store.meta.set('proxy.original', saved);
  writeBackupFile(before);

  await regSet('ProxyServer', 'REG_SZ', `127.0.0.1:${relayPort}`);
  await regSet('ProxyEnable', 'REG_DWORD', 1);
  await regSet('ProxyOverride', 'REG_SZ', mergeOverride(before.override, extraBypass));
  if (before.autoConfig) await regDelete('AutoConfigURL');
  await notifyWinINet();
  return { before, after: await readSystemProxy() };
}

/**
 * 只重写系统代理的「跳过列表」，不动 ProxyServer / 备份。
 * 以接管前的原始 override 为基准重建，这样从列表里删掉域名也能生效。
 */
export async function updateProxyOverride(store, extraBypass = []) {
  const saved = store.meta.get('proxy.original');
  let base = null;
  try {
    base = saved ? JSON.parse(saved).override : null;
  } catch {
    base = null;
  }
  if (base === null) base = (await readSystemProxy()).override;
  await regSet('ProxyOverride', 'REG_SZ', mergeOverride(base, extraBypass));
  await notifyWinINet();
  return await readSystemProxy();
}

/** 按接管前记录的值还原 */
export async function restoreSystemProxy(store) {
  const saved = store.meta.get('proxy.original') ?? (readBackupFile() ? JSON.stringify(readBackupFile()) : null);
  if (!saved) return { restored: false, reason: '没有接管前的备份' };
  const before = JSON.parse(saved);
  await regSet('ProxyServer', 'REG_SZ', before.server || '');
  await regSet('ProxyEnable', 'REG_DWORD', before.enabled ? 1 : 0);
  if (before.override) await regSet('ProxyOverride', 'REG_SZ', before.override);
  if (before.autoConfig) await regSet('AutoConfigURL', 'REG_SZ', before.autoConfig);
  await notifyWinINet();
  store.meta.del('proxy.original');
  return { restored: true, proxy: await readSystemProxy() };
}

/**
 * 用已保存的原值重新接管（幂等）：
 * 已有备份时只改 ProxyServer/ProxyEnable/Override，不会覆盖备份。
 */
export async function applyCapture(store, relayPort, extraBypass = []) {
  const saved = store.meta.get('proxy.original');
  if (!saved) return captureSystemProxy(store, relayPort, extraBypass);
  let before = null;
  try {
    before = JSON.parse(saved);
  } catch {
    before = null;
  }
  if (!before) return captureSystemProxy(store, relayPort, extraBypass);
  await regSet('ProxyServer', 'REG_SZ', `127.0.0.1:${relayPort}`);
  await regSet('ProxyEnable', 'REG_DWORD', 1);
  await regSet('ProxyOverride', 'REG_SZ', mergeOverride(before.override, extraBypass));
  if (before.autoConfig) await regDelete('AutoConfigURL');
  await notifyWinINet();
  return { applied: true, proxy: await readSystemProxy() };
}

/** 关闭系统代理但保留备份：代理软件退出时让系统直连，面板端口仍在监听 */
export async function disableSystemProxy() {
  await regSet('ProxyEnable', 'REG_DWORD', 0);
  await notifyWinINet();
  return { disabled: true, proxy: await readSystemProxy() };
}

/** 上游（V2RayN SOCKS 入站）是否可连 */
export function probeUpstream({ host = config.upstreamHost, port = config.upstreamPort, timeout = 800 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const socket = new net.Socket();
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.connect({ host, port });
  });
}

/** V2RayN 主程序是否在运行 */
export async function isV2RayNRunning() {
  try {
    const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq v2rayN.exe', '/NH'], { windowsHide: true });
    return /v2rayN\.exe/i.test(stdout);
  } catch {
    return false;
  }
}
