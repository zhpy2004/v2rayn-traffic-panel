const $ = (sel) => document.querySelector(sel);

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const DEFAULT_BYPASS = [
  'microsoft.com',
  '*.microsoft.com',
  '*.windowsupdate.com',
  '*.windows.com',
  '*.msn.com',
  'cn.bing.com',
  '*.cn.bing.com',
  '*.live.com',
  '*.office.com',
  '*.skype.com',
  '*.msftconnecttest.com',
  '*.msftncsi.com',
  '*.msedge.net',
  '*.azureedge.net',
];

const PRESETS = {
  compact: {
    name: 'compact',
    size: 66,
    shape: 'circle',
    opacity: 0.92,
    edgeSnap: true,
    nubSize: 18,
    bg: '#121722',
    ring: { enabled: true, width: 3, track: '#2a3346', color: '#5b8cff', alert: '#ff6b6b' },
    modules: [
      { type: 'speed.down', y: 0.36, font: 11, color: '#3fd6a2' },
      { type: 'speed.up', y: 0.56, font: 8.5, color: '#ff8f5c' },
      { type: 'usage.today', y: 0.73, font: 8, color: '#9fb0cc' },
    ],
  },
  pill: {
    name: 'pill',
    size: 44,
    shape: 'pill',
    opacity: 0.9,
    edgeSnap: true,
    nubSize: 14,
    bg: '#121722',
    ring: { enabled: true, width: 2, track: '#2a3346', color: '#5b8cff', alert: '#ff6b6b' },
    modules: [
      { type: 'speed.down', y: 0.34, font: 10, color: '#3fd6a2' },
      { type: 'usage.today', y: 0.68, font: 8, color: '#9fb0cc' },
    ],
  },
};

const state = {
  usage: { today: 0, month: 0 },
  settings: { ballEnabled: true, ballOpacity: 0.92, ballAppearance: null, dailyLimit: 0, monthlyLimit: 0 },
};

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function toInput(bytes) {
  if (!bytes) return { value: 0, unit: 'gb' };
  if (bytes >= GB) return { value: Number((bytes / GB).toFixed(2)), unit: 'gb' };
  return { value: Number((bytes / MB).toFixed(1)), unit: 'mb' };
}

function readInput(prefix) {
  const value = Math.max(0, Number($(`#${prefix}-value`).value) || 0);
  const unit = $(`#${prefix}-unit`).value === 'gb' ? GB : MB;
  return Math.round(value * unit);
}

function setStatus(text, ok = true, target = '#save-status') {
  const el = $(target);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '' : '#ffb3b3';
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}

function fillAppearanceText() {
  $('#appearance').value = JSON.stringify(state.settings.ballAppearance, null, 2);
}

function fillBypassText() {
  const list = Array.isArray(state.settings.bypassDomains) ? state.settings.bypassDomains : DEFAULT_BYPASS;
  $('#bypass').value = list.join('\n');
}

function renderBars() {
  const dailyLimit = readInput('daily');
  const monthlyLimit = readInput('monthly');

  const dailyRatio = dailyLimit > 0 ? Math.min(state.usage.today / dailyLimit, 1) : 0;
  const monthlyRatio = monthlyLimit > 0 ? Math.min(state.usage.month / monthlyLimit, 1) : 0;

  const dailyBar = $('#daily-bar');
  dailyBar.style.width = `${(dailyRatio * 100).toFixed(1)}%`;
  dailyBar.classList.toggle('over', dailyLimit > 0 && state.usage.today >= dailyLimit);

  const monthlyBar = $('#monthly-bar');
  monthlyBar.style.width = `${(monthlyRatio * 100).toFixed(1)}%`;
  monthlyBar.classList.toggle('over', monthlyLimit > 0 && state.usage.month >= monthlyLimit);

  const dailyUsage = $('#daily-usage');
  dailyUsage.textContent = `今日 ${fmtBytes(state.usage.today)}${dailyLimit > 0 ? ` / ${fmtBytes(dailyLimit)}` : ' · 不限'}`;
  dailyUsage.classList.toggle('over', dailyLimit > 0 && state.usage.today >= dailyLimit);

  const monthlyUsage = $('#monthly-usage');
  monthlyUsage.textContent = `本月 ${fmtBytes(state.usage.month)}${monthlyLimit > 0 ? ` / ${fmtBytes(monthlyLimit)}` : ' · 不限'}`;
  monthlyUsage.classList.toggle('over', monthlyLimit > 0 && state.usage.month >= monthlyLimit);
}

async function load() {
  const [settingsRes, overviewRes] = await Promise.all([
    fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json()),
    fetch('/api/overview', { cache: 'no-store' }).then((r) => r.json()),
  ]);

  state.settings = settingsRes.settings;
  state.usage.today = overviewRes.today.up + overviewRes.today.down;
  state.usage.month = overviewRes.month.up + overviewRes.month.down;

  $('#ball-enabled').checked = Boolean(state.settings.ballEnabled);

  const opacity = Number(state.settings.ballOpacity ?? 0.92);
  $('#opacity').value = opacity;
  $('#opacity-value').textContent = `${Math.round(opacity * 100)}%`;
  $('#appearance').value = JSON.stringify(state.settings.ballAppearance, null, 2);

  const daily = toInput(state.settings.dailyLimit);
  $('#daily-value').value = daily.value;
  $('#daily-unit').value = daily.unit;

  const monthly = toInput(state.settings.monthlyLimit);
  $('#monthly-value').value = monthly.value;
  $('#monthly-unit').value = monthly.unit;

  fillBypassText();
  renderBars();
}

async function save(patch, message, target) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  state.settings = data.settings;
  if (message) setStatus(message, true, target);
  renderBars();
  return data.settings;
}

async function refreshUsage() {
  try {
    const o = await fetch('/api/overview', { cache: 'no-store' }).then((r) => r.json());
    state.usage.today = o.today.up + o.today.down;
    state.usage.month = o.month.up + o.month.down;
    renderBars();
  } catch {
    /* 面板重启期间忽略 */
  }
}

$('#ball-enabled').addEventListener('change', async (ev) => {
  const enabled = ev.target.checked;
  try {
    await save({ ballEnabled: enabled }, enabled ? '悬浮球已开启' : '悬浮球已关闭');
  } catch (err) {
    ev.target.checked = !enabled;
    setStatus(`保存失败：${err.message}`, false);
  }
});

let opacityTimer = null;
$('#opacity').addEventListener('input', (ev) => {
  const value = Number(ev.target.value);
  $('#opacity-value').textContent = `${Math.round(value * 100)}%`;
  clearTimeout(opacityTimer);
  opacityTimer = setTimeout(async () => {
    try {
      await save({ ballOpacity: value }, '');
    } catch (err) {
      setStatus(`透明度保存失败：${err.message}`, false, '#appearance-status');
    }
  }, 250);
});

$('#apply').addEventListener('click', async () => {
  let parsed;
  try {
    parsed = JSON.parse($('#appearance').value);
  } catch (err) {
    setStatus(`JSON 解析失败：${err.message}`, false, '#appearance-status');
    return;
  }
  try {
    await save({ ballAppearance: parsed }, '外观已导入', '#appearance-status');
    state.settings.ballAppearance = state.settings.ballAppearance;
    fillAppearanceText();
  } catch (err) {
    setStatus(`导入失败：${err.message}`, false, '#appearance-status');
  }
});

$('#export').addEventListener('click', () => {
  const text = JSON.stringify(state.settings.ballAppearance, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ball-appearance-${state.settings.ballAppearance?.name || 'custom'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('已导出当前配置', true, '#appearance-status');
});

$('#default').addEventListener('click', async () => {
  try {
    await save({ ballAppearance: null }, '已恢复默认外观', '#appearance-status');
    fillAppearanceText();
  } catch (err) {
    setStatus(`恢复失败：${err.message}`, false, '#appearance-status');
  }
});

for (const [id, preset] of [['#preset-compact', PRESETS.compact], ['#preset-pill', PRESETS.pill]]) {
  $(id).addEventListener('click', async () => {
    try {
      await save({ ballAppearance: preset }, `已应用预设：${preset.name}`, '#appearance-status');
      fillAppearanceText();
    } catch (err) {
      setStatus(`应用失败：${err.message}`, false, '#appearance-status');
    }
  });
}

$('#save').addEventListener('click', async () => {
  try {
    await save({ dailyLimit: readInput('daily'), monthlyLimit: readInput('monthly') }, '上限已保存');
  } catch (err) {
    setStatus(`保存失败：${err.message}`, false);
  }
});

$('#reset').addEventListener('click', async () => {
  $('#daily-value').value = 0;
  $('#monthly-value').value = 0;
  try {
    await save({ dailyLimit: 0, monthlyLimit: 0 }, '已清零，不再提醒');
  } catch (err) {
    setStatus(`保存失败：${err.message}`, false);
  }
});

$('#bypass-save').addEventListener('click', async () => {
  const list = $('#bypass').value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await save({ bypassDomains: list }, '直连例外已保存，立即生效', '#bypass-status');
    fillBypassText();
  } catch (err) {
    setStatus(`保存失败：${err.message}`, false, '#bypass-status');
  }
});

$('#bypass-default').addEventListener('click', async () => {
  try {
    await save({ bypassDomains: DEFAULT_BYPASS }, '已恢复默认例外（微软系）', '#bypass-status');
    fillBypassText();
  } catch (err) {
    setStatus(`恢复失败：${err.message}`, false, '#bypass-status');
  }
});

for (const id of ['#daily-value', '#daily-unit', '#monthly-value', '#monthly-unit']) {
  $(id).addEventListener('input', renderBars);
  $(id).addEventListener('change', renderBars);
}

load().catch((err) => setStatus(`加载失败：${err.message}`, false));
setInterval(refreshUsage, 5000);
