const $ = (sel) => document.querySelector(sel);

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const state = {
  usage: { today: 0, month: 0 },
  settings: { ballEnabled: true, dailyLimit: 0, monthlyLimit: 0 },
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

function setStatus(text, ok = true) {
  const el = $('#save-status');
  el.textContent = text;
  el.style.color = ok ? '' : '#ffb3b3';
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
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

  const daily = toInput(state.settings.dailyLimit);
  $('#daily-value').value = daily.value;
  $('#daily-unit').value = daily.unit;

  const monthly = toInput(state.settings.monthlyLimit);
  $('#monthly-value').value = monthly.value;
  $('#monthly-unit').value = monthly.unit;

  renderBars();
}

async function save(patch, message) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  state.settings = data.settings;
  setStatus(message ?? '已保存');
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

for (const id of ['#daily-value', '#daily-unit', '#monthly-value', '#monthly-unit']) {
  $(id).addEventListener('input', renderBars);
  $(id).addEventListener('change', renderBars);
}

load().catch((err) => setStatus(`加载失败：${err.message}`, false));
setInterval(refreshUsage, 5000);
