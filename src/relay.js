/**
 * 计数中转：一个极小的混合代理（SOCKS5 + HTTP/HTTPS 代理），
 * 接住本机应用的代理流量，按目标域名统计上下行字节，再转发给 V2RayN 的 SOCKS5 入站。
 *
 * 只统计经过本中转的连接 —— 也就是系统代理（或被手动指到本端口的应用）的流量。
 * 直接连 V2RayN 10808 的应用不经过这里，这是设计上的取舍（见 README）。
 */
import net from 'node:net';
import { EventEmitter } from 'node:events';

const HANDSHAKE_TIMEOUT_MS = 35_000;
const IDLE_TIMEOUT_MS = 300_000;

/** 带缓冲的 socket 读取器：SOCKS/HTTP 握手期间按需读取，结束后把剩余字节交还。 */
class SockReader {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiter = null;
    this.closed = false;
    this.onData = (chunk) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.pump();
    };
    this.onClose = () => {
      this.closed = true;
      this.pump();
    };
    socket.on('data', this.onData);
    socket.on('close', this.onClose);
    socket.on('error', this.onClose);
  }

  pump() {
    const w = this.waiter;
    if (!w) return;
    if (w.until) {
      const idx = this.buf.indexOf(w.until);
      if (idx >= 0) {
        const out = Buffer.from(this.buf.subarray(0, idx + w.until.length));
        this.buf = this.buf.subarray(idx + w.until.length);
        this.waiter = null;
        w.resolve(out);
      } else if (this.buf.length > w.max) {
        this.waiter = null;
        w.reject(new Error('handshake header too large'));
      } else if (this.closed) {
        this.waiter = null;
        w.reject(new Error('client closed during handshake'));
      }
      return;
    }
    if (this.buf.length >= w.n) {
      const out = Buffer.from(this.buf.subarray(0, w.n));
      this.buf = this.buf.subarray(w.n);
      this.waiter = null;
      w.resolve(out);
    } else if (this.closed) {
      this.waiter = null;
      w.reject(new Error('client closed during handshake'));
    }
  }

  readExactly(n) {
    if (this.closed && this.buf.length < n) return Promise.reject(new Error('client closed'));
    if (this.buf.length >= n) {
      const out = Buffer.from(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
      return Promise.resolve(out);
    }
    return new Promise((resolve, reject) => {
      this.waiter = { n, resolve, reject };
      this.pump();
    });
  }

  readUntil(delim, max = 64 * 1024) {
    const idx = this.buf.indexOf(delim);
    if (idx >= 0) {
      const out = Buffer.from(this.buf.subarray(0, idx + delim.length));
      this.buf = this.buf.subarray(idx + delim.length);
      return Promise.resolve(out);
    }
    if (this.closed) return Promise.reject(new Error('client closed'));
    return new Promise((resolve, reject) => {
      this.waiter = { until: delim, max, resolve, reject };
      this.pump();
    });
  }

  /** 停止干预，把已缓冲但未消费的字节交还调用方 */
  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('close', this.onClose);
    this.socket.off('error', this.onClose);
    const rest = this.buf;
    this.buf = Buffer.alloc(0);
    return rest;
  }
}

function formatIPv6(buf) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(i).toString(16));
  return parts.join(':');
}

function splitHostPort(target, defaultPort) {
  const s = String(target).trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) throw new Error(`bad authority: ${s}`);
    const host = s.slice(1, end);
    const rest = s.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : defaultPort;
    return { host, port };
  }
  const idx = s.lastIndexOf(':');
  if (idx > 0 && s.indexOf(':') === idx) {
    const port = Number(s.slice(idx + 1));
    if (Number.isInteger(port) && port > 0) return { host: s.slice(0, idx), port };
  }
  return { host: s, port: defaultPort };
}

/** 与上游 V2RayN SOCKS5 入站握手，返回已连通的 socket */
function socksConnectUpstream({ host, port, upstreamHost, upstreamPort, timeoutMs = 20_000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: upstreamHost, port: upstreamPort });
    const reader = new SockReader(sock);
    let timer = null;
    const fail = (err) => {
      if (timer) clearTimeout(timer);
      reader.detach();
      sock.destroy();
      reject(err);
    };
    const onError = (err) => fail(err);
    timer = setTimeout(() => fail(new Error('upstream socks handshake timeout')), timeoutMs);
    sock.once('error', onError);
    sock.once('connect', async () => {
      try {
        sock.write(Buffer.from([0x05, 0x01, 0x00]));
        const greeting = await reader.readExactly(2);
        if (greeting[0] !== 0x05 || greeting[1] !== 0x00) throw new Error('upstream socks auth rejected');

        const ipVer = net.isIP(host);
        let head;
        if (ipVer === 4) {
          const b = Buffer.from(host.split('.').map(Number));
          head = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), b]);
        } else if (ipVer === 6) {
          const b = Buffer.alloc(16);
          const groups = host.split(':');
          groups.forEach((g, i) => b.writeUInt16BE(parseInt(g, 16) || 0, i * 2));
          head = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x04]), b]);
        } else {
          const name = Buffer.from(String(host), 'utf8');
          head = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name]);
        }
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(Number(port) || 0, 0);
        sock.write(Buffer.concat([head, portBuf]));

        const reply = await reader.readExactly(4);
        if (reply[0] !== 0x05 || reply[1] !== 0x00) throw new Error(`upstream socks connect failed (code ${reply[1]})`);
        const atyp = reply[3];
        if (atyp === 0x01) await reader.readExactly(4);
        else if (atyp === 0x04) await reader.readExactly(16);
        else {
          const len = (await reader.readExactly(1))[0];
          await reader.readExactly(len);
        }
        await reader.readExactly(2);
        clearTimeout(timer);
        sock.off('error', onError);
        const rest = reader.detach();
        if (rest.length) sock.unshift(rest);
        resolve(sock);
      } catch (err) {
        clearTimeout(timer);
        fail(err);
      }
    });
  });
}

/** 直连：自己解析 DNS 并连目标（不走 V2RayN） */
function directConnect(host, port, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let settled = false;
    let timer = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      sock.destroy();
      reject(err);
    };
    const onError = (err) => fail(err);
    timer = setTimeout(() => fail(new Error('direct connect timeout')), timeoutMs);
    sock.once('error', onError);
    sock.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.off('error', onError);
      resolve(sock);
    });
  });
}

function relayPipe(src, dst, onBytes) {
  src.on('data', (chunk) => {
    onBytes(chunk.length);
    if (!dst.write(chunk)) src.pause();
  });
  dst.on('drain', () => {
    if (src.isPaused()) src.resume();
  });
  src.on('end', () => dst.end());
  src.on('error', () => dst.destroy());
  src.on('close', () => dst.destroy());
}

export class TrafficRelay extends EventEmitter {
  constructor({ port, upstreamHost, upstreamPort, maxConnections = 512, decideRoute, failOpen, probeUpstream }) {
    super();
    this.port = port;
    this.upstreamHost = upstreamHost;
    this.upstreamPort = upstreamPort;
    this.maxConnections = maxConnections;
    this.decideRoute = typeof decideRoute === 'function' ? decideRoute : () => 'proxy';
    this.failOpen = typeof failOpen === 'function' ? failOpen : () => false;
    this.probeUpstream = typeof probeUpstream === 'function' ? probeUpstream : async () => true;
    this.server = null;
    this.running = false;
    this.active = 0;
    this.sockets = new Set();
    this.tickUp = 0;
    this.tickDown = 0;
    this.totalUp = 0;
    this.totalDown = 0;
    this.timer = null;
  }

  start() {
    if (this.running) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handle(socket));
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        server.off('error', reject);
        server.on('error', (err) => this.emit('error', err));
        this.server = server;
        this.running = true;
        this.timer = setInterval(() => {
          const up = this.tickUp;
          const down = this.tickDown;
          this.tickUp = 0;
          this.tickDown = 0;
          this.emit('tick', { up, down, active: this.active });
        }, 1000);
        this.timer.unref?.();
        resolve();
      });
    });
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }

  /** 结束一次连接：写库并通知观察者 */
  finish(record, client, upstream) {
    if (record.done) return;
    record.done = true;
    this.active = Math.max(0, this.active - 1);
    this.sockets.delete(client);
    if (upstream) this.sockets.delete(upstream);
    const dur = Date.now() - record.startedAt;
    const out = { ...record, dur };
    delete out.done;
    delete out.startedAt;
    if (out.host) this.emit('conn', out);
  }

  async handle(client) {
    if (this.active >= this.maxConnections) {
      client.destroy();
      return;
    }
    this.active += 1;
    this.sockets.add(client);
    client.setNoDelay(true);
    client.setTimeout(HANDSHAKE_TIMEOUT_MS, () => client.destroy());

    const record = {
      ts: Date.now(),
      startedAt: Date.now(),
      host: '',
      port: 0,
      proto: 'unknown',
      route: 'proxy',
      up: 0,
      down: 0,
      done: false,
    };
    let upstream = null;
    let hs = null;

    try {
      const reader = new SockReader(client);
      const first = await reader.readExactly(1);
      hs = first[0] === 0x05
        ? await this.handshakeSocks5(client, reader)
        : await this.handshakeHttp(client, reader, first);

      record.host = hs.host;
      record.port = hs.port;
      record.proto = hs.proto;

      // 面板内分流：直连自己拨号，否则交给 V2RayN
      let route = this.decideRoute(hs.host, hs.port);
      try {
        upstream = route === 'direct'
          ? await directConnect(hs.host, hs.port)
          : await socksConnectUpstream({
            host: hs.host,
            port: hs.port,
            upstreamHost: this.upstreamHost,
            upstreamPort: this.upstreamPort,
          });
      } catch (err) {
        if (route === 'direct') {
          // 直连失败 → 退回代理
          this.emit('debug', { message: `direct failed for ${hs.host}: ${err.message}; fallback to proxy` });
          route = 'proxy';
          upstream = await socksConnectUpstream({
            host: hs.host,
            port: hs.port,
            upstreamHost: this.upstreamHost,
            upstreamPort: this.upstreamPort,
          });
        } else {
          // 只有确认上游真的不可用才回退直连；上游只是慢就不回退，否则「慢」会变成「卡死」
          const upstreamAlive = this.failOpen() ? await this.probeUpstream() : true;
          if (upstreamAlive) throw err;
          this.emit('debug', { message: `upstream down for ${hs.host}: ${err.message}; fail-open to direct` });
          route = 'direct';
          upstream = await directConnect(hs.host, hs.port);
        }
      }
      record.route = route;
      this.sockets.add(upstream);
      upstream.setNoDelay(true);
      if (process.env.TRAFFIC_DEBUG === '1') {
        this.emit('debug', {
          message: `conn ${hs.host}:${hs.port} route=${route} setup=${Date.now() - record.startedAt}ms`,
        });
      }

      // 连通后再回握手成功
      if (hs.kind === 'socks5') {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      } else if (hs.kind === 'connect') {
        client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: v2rayn-traffic-panel\r\n\r\n');
      }

      client.setTimeout(IDLE_TIMEOUT_MS, () => {
        client.destroy();
        upstream.destroy();
      });
      upstream.setTimeout(IDLE_TIMEOUT_MS, () => {
        client.destroy();
        upstream.destroy();
      });

      const leftover = reader.detach();
      if (leftover.length) {
        upstream.write(leftover);
        record.up += leftover.length;
        this.tickUp += leftover.length;
        this.totalUp += leftover.length;
      }
      if (hs.preface?.length) {
        upstream.write(hs.preface);
        record.up += hs.preface.length;
        this.tickUp += hs.preface.length;
        this.totalUp += hs.preface.length;
      }

      relayPipe(client, upstream, (n) => {
        record.up += n;
        this.tickUp += n;
        this.totalUp += n;
      });
      relayPipe(upstream, client, (n) => {
        record.down += n;
        this.tickDown += n;
        this.totalDown += n;
      });

      const done = () => this.finish(record, client, upstream);
      client.once('close', done);
      upstream.once('close', done);
      client.once('error', done);
      upstream.once('error', done);
    } catch (err) {
      this.emit('debug', { message: err instanceof Error ? err.message : String(err), proto: record.proto });
      try {
        if (hs?.kind === 'socks5') client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        else if (hs?.kind === 'connect') client.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      } catch {
        /* 客户端已断开 */
      }
      upstream?.destroy();
      client.destroy();
      this.finish(record, client, upstream);
    }
  }

  async handshakeSocks5(client, reader) {
    const nmethods = (await reader.readExactly(1))[0];
    await reader.readExactly(nmethods);
    client.write(Buffer.from([0x05, 0x00]));

    const head = await reader.readExactly(4);
    const cmd = head[1];
    const atyp = head[3];
    let host;
    if (atyp === 0x01) host = [...(await reader.readExactly(4))].join('.');
    else if (atyp === 0x03) {
      const len = (await reader.readExactly(1))[0];
      host = (await reader.readExactly(len)).toString('utf8');
    } else if (atyp === 0x04) host = formatIPv6(await reader.readExactly(16));
    else throw new Error(`unsupported socks atyp ${atyp}`);

    const port = (await reader.readExactly(2)).readUInt16BE(0);
    if (cmd !== 0x01) {
      client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      throw new Error(`unsupported socks command ${cmd}`);
    }

    // 先不连，交给 handle() 按路由决定直连还是走 V2RayN
    return { kind: 'socks5', host, port, proto: 'socks5' };
  }

  async handshakeHttp(client, reader, firstByte) {
    const headerBuf = await reader.readUntil(Buffer.from('\r\n\r\n'), 64 * 1024);
    const header = firstByte.toString('latin1') + headerBuf.toString('latin1');
    const requestLine = header.split('\r\n')[0];
    const m = /^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/.exec(requestLine);
    if (!m) throw new Error(`bad http request line: ${requestLine.slice(0, 80)}`);
    const method = m[1];
    const target = m[2];

    if (method === 'CONNECT') {
      const { host, port } = splitHostPort(target, 443);
      return { kind: 'connect', host, port, proto: 'http-connect' };
    }

    let url;
    try {
      url = new URL(target);
    } catch {
      throw new Error(`http proxy target is not absolute: ${target.slice(0, 80)}`);
    }
    const host = url.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);

    // 绝对 URI 改写成 origin-form，并去掉代理专用头；连接建立后再发给上游
    const lines = header.split('\r\n');
    lines[0] = `${method} ${url.pathname}${url.search} HTTP/1.1`;
    const forwarded = lines
      .filter((line) => !/^proxy-(connection|authorization):/i.test(line))
      .join('\r\n');
    const preface = Buffer.from(forwarded, 'latin1');
    return { kind: 'http', host, port, proto: 'http', preface };
  }
}
