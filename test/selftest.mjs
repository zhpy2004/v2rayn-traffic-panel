/**
 * 自检：不依赖 V2RayN，用本地假 SOCKS5 上游 + 回显服务器验证中转的
 * SOCKS5 / HTTP CONNECT / 普通 HTTP 三条路径与字节计数。
 */
import net from 'node:net';
import assert from 'node:assert/strict';
import { TrafficRelay } from '../src/relay.js';

const ECHO_PORT = 18801;
const SOCKS_PORT = 18802;
const RELAY_PORT = 18803;
const HTTP_PORT = 18804;

function startEcho(port) {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function startHttp(port) {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      const body = 'hello-from-origin';
      socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** 最小可用的 SOCKS5 服务端，充当 V2RayN 的 10808 */
function startFakeSocks(port) {
  const server = net.createServer((client) => {
    let stage = 'greet';
    let buf = Buffer.alloc(0);
    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greet') {
        if (buf.length < 2) return;
        const n = buf[1];
        if (buf.length < 2 + n) return;
        buf = buf.subarray(2 + n);
        client.write(Buffer.from([5, 0]));
        stage = 'request';
        handle();
        return;
      }
      handle();
    });
    client.on('error', () => {});

    function handle() {
      if (stage !== 'request' || buf.length < 5) return;
      const atyp = buf[3];
      let host;
      let offset;
      if (atyp === 1) {
        if (buf.length < 10) return;
        host = [...buf.subarray(4, 8)].join('.');
        offset = 8;
      } else if (atyp === 3) {
        const len = buf[4];
        if (buf.length < 5 + len + 2) return;
        host = buf.subarray(5, 5 + len).toString();
        offset = 5 + len;
      } else {
        client.destroy();
        return;
      }
      const targetPort = buf.readUInt16BE(offset);
      buf = buf.subarray(offset + 2);
      stage = 'pipe';
      const upstream = net.connect({ host, port: targetPort }, () => {
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (buf.length) upstream.write(buf);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function socksHandshake(socket, host, port) {
  return new Promise((resolve, reject) => {
    let stage = 'greet';
    let buf = Buffer.alloc(0);
    socket.on('error', reject);
    socket.write(Buffer.from([5, 1, 0]));
    socket.on('data', function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greet') {
        if (buf.length < 2) return;
        buf = buf.subarray(2);
        const name = Buffer.from(host);
        const req = Buffer.alloc(5 + name.length + 2);
        req[0] = 5;
        req[1] = 1;
        req[3] = 3;
        req[4] = name.length;
        name.copy(req, 5);
        req.writeUInt16BE(port, 5 + name.length);
        socket.write(req);
        stage = 'reply';
        return;
      }
      if (buf.length >= 10) {
        socket.off('data', onData);
        const rest = buf.subarray(10);
        socket.unshift(rest);
        resolve();
      }
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const echo = await startEcho(ECHO_PORT);
  const httpOrigin = await startHttp(HTTP_PORT);
  const fakeSocks = await startFakeSocks(SOCKS_PORT);
  const relay = new TrafficRelay({
    port: RELAY_PORT,
    upstreamHost: '127.0.0.1',
    upstreamPort: SOCKS_PORT,
  });
  await relay.start();

  const records = [];
  relay.on('conn', (rec) => records.push(rec));

  // --- 1. SOCKS5 ---
  {
    const socket = net.connect({ host: '127.0.0.1', port: RELAY_PORT });
    await new Promise((r) => socket.once('connect', r));
    await socksHandshake(socket, '127.0.0.1', ECHO_PORT);
    const payload = Buffer.alloc(1024, 0x41);
    let received = 0;
    socket.on('data', (chunk) => {
      received += chunk.length;
    });
    socket.write(payload);
    await wait(250);
    socket.end();
    await wait(150);
    assert.equal(received, payload.length, 'socks5 回显长度不符');
    const rec = records.find((r) => r.proto === 'socks5');
    assert.ok(rec, 'socks5 连接未被记录');
    assert.ok(rec.up >= payload.length, `socks5 上行计数偏小: ${rec.up}`);
    assert.ok(rec.down >= payload.length, `socks5 下行计数偏小: ${rec.down}`);
    console.log(`  ✓ SOCKS5    host=${rec.host}:${rec.port} up=${rec.up} down=${rec.down}`);
  }

  // --- 2. HTTP CONNECT ---
  {
    const socket = net.connect({ host: '127.0.0.1', port: RELAY_PORT });
    await new Promise((r) => socket.once('connect', r));
    socket.write(`CONNECT 127.0.0.1:${ECHO_PORT} HTTP/1.1\r\nHost: 127.0.0.1:${ECHO_PORT}\r\n\r\n`);
    let head = Buffer.alloc(0);
    await new Promise((resolve) => {
      socket.on('data', function onHead(chunk) {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf('\r\n\r\n');
        if (idx >= 0) {
          socket.off('data', onHead);
          socket.unshift(head.subarray(idx + 4));
          resolve();
        }
      });
    });
    assert.match(head.toString('latin1'), /^HTTP\/1\.1 200/);
    const payload = Buffer.alloc(2048, 0x42);
    let received = 0;
    socket.on('data', (chunk) => {
      received += chunk.length;
    });
    socket.write(payload);
    await wait(250);
    socket.end();
    await wait(150);
    assert.equal(received, payload.length, 'http-connect 回显长度不符');
    const rec = records.find((r) => r.proto === 'http-connect');
    assert.ok(rec, 'http-connect 连接未被记录');
    assert.ok(rec.down >= payload.length, `http-connect 下行计数偏小: ${rec.down}`);
    console.log(`  ✓ CONNECT   host=${rec.host}:${rec.port} up=${rec.up} down=${rec.down}`);
  }

  // --- 3. 普通 HTTP 代理 ---
  {
    const socket = net.connect({ host: '127.0.0.1', port: RELAY_PORT });
    await new Promise((r) => socket.once('connect', r));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
    });
    socket.write(`GET http://127.0.0.1:${HTTP_PORT}/hello HTTP/1.1\r\nHost: 127.0.0.1:${HTTP_PORT}\r\n\r\n`);
    await wait(300);
    socket.end();
    await wait(150);
    assert.match(data, /hello-from-origin/, '普通 HTTP 代理响应不正确');
    const rec = records.find((r) => r.proto === 'http');
    assert.ok(rec, '普通 http 连接未被记录');
    assert.ok(rec.up > 0 && rec.down > 0, 'http 计数为 0');
    console.log(`  ✓ HTTP      host=${rec.host}:${rec.port} up=${rec.up} down=${rec.down}`);
  }

  await relay.stop();
  echo.close();
  httpOrigin.close();
  fakeSocks.close();
  console.log('\n全部自检通过 ✅');
}

main().catch((err) => {
  console.error('\n自检失败 ❌', err);
  process.exit(1);
});
