/**
 * 悬浮球进程管理：启动 / 停止 / 存活检测。
 * 面板与看护进程共用，保证「设置里一开就出现、一关就消失」。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export const ballPidFile = join(config.root, 'data', 'ball.pid');
const ballVbs = join(config.root, 'scripts', 'ball-hidden.vbs');

export function readBallPid() {
  try {
    if (!existsSync(ballPidFile)) return null;
    const pid = Number(readFileSync(ballPidFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isBallAlive() {
  const pid = readBallPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startBall() {
  if (isBallAlive()) return false;
  try {
    const child = spawn('wscript.exe', [ballVbs], {
      cwd: config.root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function stopBall() {
  const pid = readBallPid();
  if (!pid) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}
