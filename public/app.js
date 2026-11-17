const $ = (sel) => document.querySelector(sel);

const state = {
  overview: null,
  period: 'month',
  groupDomain: true,
  speedSamples: new Array(60).fill(0),
  live: { up: 0, down: 0, active: 0 },
  recent: [],
};

/* ---------------- 格式化 ---------------- */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

const fmtRate = (n) => `${fmtBytes(n)}/s`;

function fmtClock(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms) {
  if (!ms || ms < 1000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/* ---------------- 域名归并 ---------------- */

const MULTI_SUFFIX = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'com.hk', 'com.tw', 'com.sg', 'com.au',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.nz', 'co.za', 'com.br', 'co.in',
  'com.ru', 'com.tr', 'com.mx', 'co.il', 'com.ar', 'com.my', 'com.ph', 'com.vn', 'com.pk', 'com.eg',
]);

const CDN_SUFFIX = [
  'googlevideo.com', 'googleusercontent.com', 'ggpht.com', 'googleapis.com', 'gstatic.com',
  'cloudfront.net', 'akamaized.net', 'akamaihd.net', 'fastly.net', 'fbcdn.net', 'twimg.com',
  'cloudflare.com', 'jsdelivr.net', 'unpkg.com', 'githubusercontent.com', 'ytimg.com',
];

function registrable(host) {
  if (!host) return '(unknown)';
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  for (const suffix of CDN_SUFFIX) {
    if (h === suffix || h.endsWith(`.${suffix}`)) return suffix;
  }
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

/* ---------------- 数据 ---------------- */

async function loadOverview() {
  const res = await fetch('/api/overview', { cache: 'no-store' });
  if (!res.ok) throw new Error(`概览加载失败: HTTP ${res.status}`);
  state.overview = await res.json();
  state.recent = state.overview.recent ?? [];
  render();
}

async function post(path, action) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  await loadOverview();
  return data;
}

/* ---------------- 渲染 ---------------- */

function setPill(role, text, level) {
  const el = document.querySelector(`.pill[data-role="${role}"]`);
  if (!el) return;
  el.className = `pill ${level ?? ''}`.trim();
  el.innerHTML = `<i></i>${text}`;
}

function renderStatus() {
  const o = state.overview;
  if (!o) return;
  const { status } = o;

  setPill('relay', `中转 ${status.relay.running ? '运行中' : '已停止'}`, status.relay.running ? 'ok' : 'warn');
  setPill(
    'v2rayn',
    `V2RayN ${status.upstream.reachable ? '已连接' : '未连接'}`,
    status.upstream.reachable ? 'ok' : 'bad',
  );
  const pointing = status.proxy.pointingAtRelay;
  setPill(
    'proxy',
    `系统代理 ${pointing ? '已接管' : status.proxy.enabled ? '未接管' : '未启用'}`,
    pointing ? 'ok' : status.proxy.captured ? 'warn' : '',
  );

  const quotaPill = document.querySelector('.pill[data-role="quota"]');
  if (quotaPill) {
    if (o.alerts?.any) {
      quotaPill.hidden = false;
      quotaPill.className = 'pill bad';
      quotaPill.innerHTML = `<i></i>${o.alerts.daily ? '今日超限' : '本月超限'}`;
    } else {
      quotaPill.hidden = true;
    }
  }

  $('#relay-desc').textContent = `${status.relay.target} → ${status.upstream.host}:${status.upstream.port}`;
  $('#proxy-desc').textContent = status.proxy.enabled
    ? `当前指向 ${status.proxy.server || '(空)'}${status.proxy.captured ? ' · 已备份原值' : ''}`
    : `未启用${status.proxy.server ? ` · 记录值 ${status.proxy.server}` : ''}`;

  const btnRelay = $('#btn-relay');
  btnRelay.textContent = status.relay.running ? '停止' : '启动';
  btnRelay.classList.toggle('primary', !status.relay.running);
  $('#btn-restore').disabled = !status.proxy.captured;

  let hint;
  if (!status.upstream.reachable) {
    hint = '没有连上 V2RayN 的 10808 入站，请先启动 V2RayN 并连上一个节点。';
  } else if (!status.proxy.captured) {
    hint = '点「接管系统代理」，把系统流量引到中转端口，面板才开始按站点计数。';
  } else if (!pointing) {
    hint = `系统代理已被改成 ${status.proxy.server || '(空)'}（通常是 V2RayN 重新接管了）。在 V2RayN 里关闭「系统代理」或选「不改变系统代理」，再点一次接管。`;
  } else {
    hint = '正在统计。建议在 V2RayN 设置 → 系统代理 里选「不改变系统代理」，避免它把系统代理改回 10808。';
  }
  $('#hint').textContent = hint;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderTotals() {
  const o = state.overview;
  if (!o) return;
  setText('month-label', o.month.label);
  setText('month-total', fmtBytes(o.month.up + o.month.down));
  setText('month-up', fmtBytes(o.month.up));
  setText('month-down', fmtBytes(o.month.down));
  setText('month-conns', String(o.month.conns ?? 0));
  setText('month-direct', fmtBytes((o.directMonth?.up ?? 0) + (o.directMonth?.down ?? 0)));

  setText('today-label', o.today.label);
  setText('today-total', fmtBytes(o.today.up + o.today.down));
  setText('today-up', fmtBytes(o.today.up));
  setText('today-down', fmtBytes(o.today.down));
  setText('today-direct', fmtBytes((o.directToday?.up ?? 0) + (o.directToday?.down ?? 0)));

  setText('live-down', fmtRate(state.live.down));
  setText('live-up', fmtRate(state.live.up));
  setText('live-active', String(state.live.active));
  $('#live-dot').textContent = state.live.active > 0 ? '传输中' : '待机';

  setText('footer-db', `数据文件 ${o.db}`);
}

function aggregate(list, group) {
  if (!group) return list.map((r) => ({ ...r, key: r.host }));
  const map = new Map();
  for (const row of list) {
    const key = registrable(row.host);
    const cur = map.get(key) ?? { key, host: key, up: 0, down: 0, conns: 0, hosts: new Set() };
    cur.up += row.up;
    cur.down += row.down;
    cur.conns += row.conns;
    cur.hosts.add(row.host);
    map.set(key, cur);
  }
  return [...map.values()]
    .map((r) => ({ ...r, hosts: r.hosts.size }))
    .sort((a, b) => b.up + b.down - (a.up + a.down));
}

function renderRank() {
  const o = state.overview;
  if (!o) return;
  const rows = aggregate(state.period === 'month' ? o.topMonth : o.topToday, state.groupDomain);
  const list = $('#rank-list');
  list.replaceChildren();
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'rank-item muted';
    li.textContent = '暂无数据';
    list.append(li);
    setText('rank-summary', '');
    return;
  }
  const max = Math.max(...rows.map((r) => r.up + r.down), 1);
  const limit = rows.slice(0, 24);
  const total = rows.reduce((acc, r) => acc + r.up + r.down, 0);
  setText('rank-summary', `${rows.length} 个站点 · 合计 ${fmtBytes(total)}`);

  limit.forEach((row, i) => {
    const li = document.createElement('li');
    li.className = 'rank-item';
    const totalRow = row.up + row.down;
    const share = total > 0 ? ((totalRow / total) * 100).toFixed(1) : '0.0';
    li.innerHTML = `
      <span class="rank-bar" style="width:${(totalRow / max) * 100}%"></span>
      <span class="rank-idx">${i + 1}</span>
      <span class="rank-host">
        <span class="h" title="${escapeHtml(row.host)}">${escapeHtml(row.host)}</span>
        <span class="meta">${share}% · ${row.conns} 次${state.groupDomain && row.hosts > 1 ? ` · ${row.hosts} 个子域` : ''}</span>
      </span>
      <span class="rank-bytes">
        <span class="b-down">↓ ${fmtBytes(row.down)}</span>
        <span class="b-up">↑ ${fmtBytes(row.up)}</span>
      </span>`;
    list.append(li);
  });
}

function renderRecent() {
  const body = $('#recent-body');
  body.replaceChildren();
  if (!state.recent.length) {
    body.innerHTML = '<tr class="empty"><td colspan="6">暂无数据</td></tr>';
    return;
  }
  for (const row of state.recent.slice(0, 40)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted">${fmtClock(row.ts)}</td>
      <td><span class="host">${escapeHtml(row.host)}</span><span class="sub">:${row.port}</span></td>
      <td class="muted">${escapeHtml(row.proto)}${row.route === 'direct' ? ' <span class="tag">直连</span>' : ''}</td>
      <td class="num up">${fmtBytes(row.up)}</td>
      <td class="num down">${fmtBytes(row.down)}</td>
      <td class="num muted">${fmtDuration(row.dur)}</td>`;
    body.append(tr);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------------- 图表 ---------------- */

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawSpark(canvas, values, color) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!values.length) return;
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `${color}66`);
  grad.addColorStop(1, `${color}00`);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawTrend() {
  const canvas = $('#trend');
  const series = state.overview?.series ?? [];
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 20, right: 12, bottom: 22, left: 48 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  if (!series.length) return;

  const max = Math.max(...series.map((d) => d.up + d.down), 1);
  const step = innerW / series.length;
  const barW = Math.max(3, step * 0.58);

  // 网格线
  ctx.strokeStyle = 'rgba(34,44,64,0.75)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (innerH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y + 0.5);
    ctx.lineTo(w - pad.right, y + 0.5);
    ctx.stroke();
  }

  // 纵轴：只标峰值与 0，避免堆太多字
  ctx.fillStyle = '#5f6c85';
  ctx.font = '10.5px "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtBytes(max), pad.left - 8, pad.top + 1);
  ctx.fillText('0', pad.left - 8, pad.top + innerH);

  series.forEach((d, i) => {
    const x = pad.left + step * i + (step - barW) / 2;
    const total = d.up + d.down;
    const hTotal = (total / max) * innerH;
    const hDown = (d.down / max) * innerH;
    const hUp = (d.up / max) * innerH;
    const baseY = pad.top + innerH;

    ctx.fillStyle = 'rgba(63,214,162,0.85)';
    ctx.fillRect(x, baseY - hDown, barW, hDown);
    ctx.fillStyle = 'rgba(255,143,92,0.85)';
    ctx.fillRect(x, baseY - hDown - hUp, barW, hUp);

    if (total === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, baseY - 2, barW, 2);
    }
  });

  // 日期刻度
  ctx.fillStyle = '#5f6c85';
  ctx.font = '11px "Cascadia Mono", Consolas, monospace';
  ctx.textBaseline = 'top';
  series.forEach((d, i) => {
    if (i % 5 !== 0 && i !== series.length - 1) return;
    const x = pad.left + step * i + step / 2;
    const label = d.day.slice(5);
    ctx.textAlign = i === 0 ? 'left' : i === series.length - 1 ? 'right' : 'center';
    ctx.fillText(label, i === 0 ? pad.left : i === series.length - 1 ? w - pad.right : x, h - 16);
  });

  canvas._series = series;
  canvas._geom = { pad, step, innerW, innerH, max };
}

function drawAll() {
  const series = state.overview?.series ?? [];
  drawTrend();
  drawSpark($('#month-spark'), series.map((d) => d.up + d.down), '#5b8cff');
  drawSpark($('#speed-spark'), state.speedSamples, '#3fd6a2');
}

/* 趋势图悬浮提示 */
function bindTrendTooltip() {
  const canvas = $('#trend');
  const tip = $('#trend-tip');
  canvas.addEventListener('mousemove', (ev) => {
    const series = canvas._series;
    const geom = canvas._geom;
    if (!series || !geom) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const idx = Math.min(series.length - 1, Math.max(0, Math.floor((x - geom.pad.left) / geom.step)));
    const d = series[idx];
    if (!d) return;
    tip.hidden = false;
    tip.innerHTML = `<b>${d.day}</b><br>↓ ${fmtBytes(d.down)} · ↑ ${fmtBytes(d.up)}<br><span class="muted">合计 ${fmtBytes(d.down + d.up)} · ${d.conns} 次</span>`;
    tip.style.left = `${geom.pad.left + geom.step * idx + geom.step / 2}px`;
    tip.style.top = `${ev.clientY - rect.top + 12}px`;
  });
  canvas.addEventListener('mouseleave', () => {
    tip.hidden = true;
  });
}

/* ---------------- 事件 ---------------- */

function bindControls() {
  $('#btn-relay').addEventListener('click', async () => {
    const running = state.overview?.status.relay.running;
    try {
      await post('/api/relay', running ? 'stop' : 'start');
    } catch (err) {
      alert(`操作失败：${err.message}`);
    }
  });

  $('#btn-capture').addEventListener('click', async () => {
    try {
      await post('/api/proxy', 'capture');
    } catch (err) {
      alert(`接管失败：${err.message}`);
    }
  });

  $('#btn-restore').addEventListener('click', async () => {
    try {
      await post('/api/proxy', 'restore');
    } catch (err) {
      alert(`还原失败：${err.message}`);
    }
  });

  $('#rank-period').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    for (const b of $('#rank-period').children) b.classList.toggle('active', b === btn);
    renderRank();
  });

  $('#group-domain').addEventListener('change', (ev) => {
    state.groupDomain = ev.target.checked;
    renderRank();
  });

  window.addEventListener('resize', () => drawAll());

  // 容器尺寸变化（窗口拉伸、列表滚动条出现/消失）时重绘图表
  if (typeof ResizeObserver !== 'undefined') {
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => drawAll());
    });
    ro.observe(document.querySelector('.content'));
  }
}

function connectLive() {
  const es = new EventSource('/api/live');
  es.addEventListener('tick', (ev) => {
    const tick = JSON.parse(ev.data);
    state.live = tick;
    state.speedSamples.push(tick.down);
    state.speedSamples.shift();
    setText('live-down', fmtRate(tick.down));
    setText('live-up', fmtRate(tick.up));
    setText('live-active', String(tick.active));
    $('#live-dot').textContent = tick.active > 0 ? '传输中' : '待机';
    drawSpark($('#speed-spark'), state.speedSamples, '#3fd6a2');
  });
  es.addEventListener('conn', (ev) => {
    const row = JSON.parse(ev.data);
    state.recent.unshift(row);
    state.recent = state.recent.slice(0, 40);
    renderRecent();
  });
  es.addEventListener('status', () => loadOverview().catch(() => {}));
  es.onerror = () => {
    /* EventSource 自带重连 */
  };
}

function render() {
  renderStatus();
  renderTotals();
  renderRank();
  renderRecent();
  drawAll();
}

async function main() {
  bindControls();
  bindTrendTooltip();
  try {
    await loadOverview();
  } catch (err) {
    console.error(err);
    setText('hint', `面板数据加载失败：${err.message}`);
  }
  connectLive();
  setInterval(() => loadOverview().catch(() => {}), 15_000);
}

main();
