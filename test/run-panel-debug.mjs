/**
 * 起一个带计时的调试实例（独立端口/数据库），避免影响正式面板。
 * 用法: node test/run-panel-debug.mjs
 */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const log = openSync('data/debug-panel.log', 'a');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    TRAFFIC_DEBUG: '1',
    TRAFFIC_PORT: '8795',
    TRAFFIC_RELAY_PORT: '10815',
    TRAFFIC_UPSTREAM_PORT: '10808',
    TRAFFIC_DB: `${process.cwd()}\\data\\debug.db`,
    TRAFFIC_AUTO_CAPTURE: '0',
  },
  detached: true,
  stdio: ['ignore', log, log],
  windowsHide: true,
});
child.unref();
console.log(`debug panel pid=${child.pid} port=8795 relay=10815`);
