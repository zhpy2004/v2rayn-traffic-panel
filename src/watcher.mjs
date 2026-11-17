/**
 * 看护进程：盯着 V2RayN 的进程，跟着它启动/停止面板。
 *
 *  - V2RayN 起来   → 拉起面板（面板会自动接管系统代理）
 *  - V2RayN 退出   → 先还原系统代理，再关掉面板
 *  - 面板被误杀    → 2 秒内重新拉起
 *
 * 由 install-autostart.cmd 注册成登录任务，平时无窗口运行。
 */
import { spawn, execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const logFile = join(dataDir, 'watcher.log');
const pidFile = join(dataDir, 'panel.pid');
const watcherPidFile = join(dataDir, 'watcher.pid');
const trayPidFile = join(dataDir, 'tray.pid');
const trayOffMarker = join(dataDir, 'tray.off');
const trayVbs = join(root, 'scripts', 'tray-hidden.vbs');

const PROC = process.env.TRAFFIC_WATCH_PROC || 'v2rayN.exe';
const INTERVAL = Number(process.env.TRAFFIC_WATCH_INTERVAL || 2000);
const PANEL_PORT = Number(process.env.TRAFFIC_PORT || 8787);
const AUTO_CAPTURE = process.env.TRAFFIC_AUTO_CAPTURE !== '0';
const SERVER = join(root, 'src', 'server.js');

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch {
    /* 日志写不了不影响主流程 */
  }
}

function isProcessRunning() {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${PROC}`, '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(new RegExp(PROC.replace('.', '\\.'), 'i').test(stdout));
    });
  });
}

async function probePanel(timeout = 1200) {
  try {
    const res = await fetch(`http://127.0.0.1:${PANEL_PORT}/api/overview`, {
      signal: AbortSignal.timeout(timeout),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readPanelPidFrom(file) {
  try {
    if (!existsSync(file)) return null;
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

const readPanelPid = () => readPanelPidFrom(pidFile);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startPanel() {
  log(`启动面板 (autoCapture=${AUTO_CAPTURE})`);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, TRAFFIC_AUTO_CAPTURE: AUTO_CAPTURE ? '1' : '0' },
  });
  child.unref();
  for (let i = 0; i < 25; i += 1) {
    await sleep(400);
    if (await probePanel()) {
      log('面板已就绪');
      return true;
    }
  }
  log('面板启动超时');
  return false;
}

async function stopPanel(reason) {
  log(`停止面板：${reason}`);
  try {
    await fetch(`http://127.0.0.1:${PANEL_PORT}/api/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* 面板可能已经退出 */
  }
  for (let i = 0; i < 15; i += 1) {
    await sleep(200);
    if (!(await probePanel(600))) return;
  }
  const pid = readPanelPid();
  if (pid) {
    try {
      process.kill(pid);
      log(`强制结束面板 pid=${pid}`);
    } catch {
      /* 已不存在 */
    }
  }
}

async function tick(state) {
  const running = await isProcessRunning();
  const up = await probePanel();

  if (running && !up) {
    await startPanel();
    return { ...state, running, up: true };
  }
  if (!running && up) {
    await stopPanel(`${PROC} 已退出`);
    return { ...state, running, up: false };
  }
  if (!running && !up && state.running === true) {
    log(`${PROC} 已退出，面板未运行`);
  }
  return { ...state, running, up };
}

/** 托盘是否还活着（进程在不在） */
function isTrayAlive() {
  const pid = readPanelPidFrom(trayPidFile);
  return pid ? isAlive(pid) : false;
}

/** 拉起托盘图标（隐藏窗口） */
function startTray() {
  try {
    const child = spawn('wscript.exe', [trayVbs], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log('拉起托盘');
  } catch (err) {
    log(`托盘启动失败：${err.message}`);
  }
}

/**
 * 托盘守护：用户主动「退出托盘」会写 data/tray.off，此时不再拉起；
 * 其它情况（崩溃、被杀）每 30 秒补一次。
 */
function ensureTray() {
  if (existsSync(trayOffMarker)) return;
  if (isTrayAlive()) return;
  startTray();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`收到 ${signal}，退出看护`);
  if (await probePanel()) await stopPanel('看护进程退出');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  // 单实例：避免重复点 start-watch.cmd 拉起多个看护
  const existing = readPanelPidFrom(watcherPidFile);
  if (existing && isAlive(existing)) {
    console.log(`看护已在运行 pid=${existing}，本次退出`);
    process.exit(0);
  }
  writeFileSync(watcherPidFile, String(process.pid), 'utf8');
  process.on('exit', () => {
    try {
      if (readPanelPidFrom(watcherPidFile) === process.pid) unlinkSync(watcherPidFile);
    } catch {
      /* 忽略 */
    }
  });

  log(`看护启动 | 目标进程=${PROC} | 面板端口=${PANEL_PORT} | 自动接管=${AUTO_CAPTURE}`);
  let state = { running: null, up: null };
  // 先对齐一次当前状态，避免启动日志刷屏
  const running = await isProcessRunning();
  const up = await probePanel();
  if (running && !up) await startPanel();
  if (!running && up) await stopPanel('启动时对齐状态');
  state = { running, up };

  ensureTray();

  let ticks = 0;
  setInterval(async () => {
    if (stopping) return;
    ticks += 1;
    if (ticks % 15 === 0) ensureTray();
    try {
      state = await tick(state);
    } catch (err) {
      log(`轮询异常：${err.message}`);
    }
  }, INTERVAL);
}

main();
