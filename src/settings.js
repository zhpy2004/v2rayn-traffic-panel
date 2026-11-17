/**
 * 面板设置：悬浮球开关 / 透明度 / 外观模块 / 月日上限。
 * 外观（appearance）是一份可以整体导入的 JSON，决定尺寸、形状、配色和显示模块。
 */
export const DEFAULT_APPEARANCE = {
  name: 'compact',
  size: 66,
  shape: 'circle', // circle | pill
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
};

export const MODULE_TYPES = ['speed.down', 'speed.up', 'usage.today', 'usage.month', 'limit.percent'];

/** 默认直连（不走系统代理）的域名：Edge 更新、遥测、资讯流等，国内直连即可 */
export const DEFAULT_BYPASS = [
  'microsoft.com',
  '*.microsoft.com',
  '*.windowsupdate.com',
  '*.windows.com',
  '*.msn.com',
  '*.live.com',
  '*.office.com',
  '*.skype.com',
  '*.msftconnecttest.com',
  '*.msftncsi.com',
  '*.msedge.net',
  '*.azureedge.net',
];

export const DEFAULT_SETTINGS = {
  ballEnabled: true,
  ballOpacity: 0.92,
  ballAppearance: DEFAULT_APPEARANCE,
  dailyLimit: 0,
  monthlyLimit: 0,
  bypassDomains: DEFAULT_BYPASS,
};

const MAX_LIMIT = 10 * 1024 ** 4;
const KEY = 'settings';
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** 校验直连例外：去重、转小写、丢弃非法项 */
export function normalizeBypass(input) {
  if (!Array.isArray(input)) return [...DEFAULT_BYPASS];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim().toLowerCase();
    if (!item || item.length > 253) continue;
    if (!DOMAIN_RE.test(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= 60) break;
  }
  return out;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function color(value, fallback) {
  return typeof value === 'string' && COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

/** 校验并补全外观配置；任何非法字段都回落到默认值，不抛错 */
export function normalizeAppearance(input) {
  const base = DEFAULT_APPEARANCE;
  const src = input && typeof input === 'object' ? input : {};
  const ring = src.ring && typeof src.ring === 'object' ? src.ring : {};

  const modules = Array.isArray(src.modules) ? src.modules : base.modules;
  const cleanModules = modules
    .filter((m) => m && MODULE_TYPES.includes(m.type))
    .slice(0, 6)
    .map((m, index) => ({
      type: m.type,
      y: clamp(m.y, 0.05, 0.95, 0.3 + index * 0.18),
      font: clamp(m.font, 7, 22, 9),
      color: color(m.color, '#9fb0cc'),
    }));

  const size = Math.round(clamp(src.size, 40, 200, base.size));

  return {
    name: typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 32) : base.name,
    size,
    shape: src.shape === 'pill' ? 'pill' : 'circle',
    opacity: clamp(src.opacity, 0.2, 1, base.opacity),
    edgeSnap: src.edgeSnap === undefined ? base.edgeSnap : Boolean(src.edgeSnap),
    nubSize: Math.round(clamp(src.nubSize, 8, Math.max(8, Math.floor(size / 2)), base.nubSize)),
    bg: color(src.bg, base.bg),
    ring: {
      enabled: ring.enabled === undefined ? base.ring.enabled : Boolean(ring.enabled),
      width: Math.round(clamp(ring.width, 1, 8, base.ring.width)),
      track: color(ring.track, base.ring.track),
      color: color(ring.color, base.ring.color),
      alert: color(ring.alert, base.ring.alert),
    },
    modules: cleanModules.length ? cleanModules : base.modules,
  };
}

export function readSettings(store) {
  const raw = store.meta.get(KEY);
  if (!raw) {
    return { ...DEFAULT_SETTINGS, ballAppearance: normalizeAppearance(DEFAULT_APPEARANCE) };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ballEnabled: typeof parsed.ballEnabled === 'boolean' ? parsed.ballEnabled : DEFAULT_SETTINGS.ballEnabled,
      ballOpacity: clamp(parsed.ballOpacity, 0.2, 1, DEFAULT_SETTINGS.ballOpacity),
      ballAppearance: normalizeAppearance(parsed.ballAppearance),
      dailyLimit: Number.isFinite(parsed.dailyLimit) && parsed.dailyLimit >= 0 ? parsed.dailyLimit : 0,
      monthlyLimit: Number.isFinite(parsed.monthlyLimit) && parsed.monthlyLimit >= 0 ? parsed.monthlyLimit : 0,
      bypassDomains: normalizeBypass(parsed.bypassDomains ?? DEFAULT_BYPASS),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, ballAppearance: normalizeAppearance(DEFAULT_APPEARANCE) };
  }
}

export function writeSettings(store, patch) {
  const next = readSettings(store);

  if (patch.ballEnabled !== undefined) {
    if (typeof patch.ballEnabled !== 'boolean') throw new Error('ballEnabled 必须是布尔值');
    next.ballEnabled = patch.ballEnabled;
  }

  if (patch.ballOpacity !== undefined) {
    const n = Number(patch.ballOpacity);
    if (!Number.isFinite(n) || n < 0.2 || n > 1) throw new Error('ballOpacity 必须在 0.2 ~ 1 之间');
    next.ballOpacity = n;
  }

  if (patch.ballAppearance !== undefined) {
    if (patch.ballAppearance === null) {
      next.ballAppearance = normalizeAppearance(DEFAULT_APPEARANCE);
    } else {
      if (typeof patch.ballAppearance !== 'object') throw new Error('ballAppearance 必须是对象');
      const normalized = normalizeAppearance(patch.ballAppearance);
      if (!Array.isArray(patch.ballAppearance.modules) || patch.ballAppearance.modules.length === 0) {
        throw new Error('ballAppearance.modules 至少要有一个模块');
      }
      if (!patch.ballAppearance.modules.every((m) => m && MODULE_TYPES.includes(m.type))) {
        throw new Error(`模块 type 只能是：${MODULE_TYPES.join(', ')}`);
      }
      next.ballAppearance = normalized;
    }
  }

  if (patch.bypassDomains !== undefined) {
    if (!Array.isArray(patch.bypassDomains)) throw new Error('bypassDomains 必须是字符串数组');
    next.bypassDomains = normalizeBypass(patch.bypassDomains);
  }

  for (const key of ['dailyLimit', 'monthlyLimit']) {
    if (patch[key] === undefined) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} 必须是非负数字（单位：字节）`);
    next[key] = Math.min(Math.round(n), MAX_LIMIT);
  }

  store.meta.set(KEY, JSON.stringify(next));
  return next;
}

/** 按当前用量计算是否超限；limit 为 0 表示不提醒 */
export function computeAlerts(settings, { monthTotal = 0, todayTotal = 0 } = {}) {
  const daily = settings.dailyLimit > 0 && todayTotal >= settings.dailyLimit;
  const monthly = settings.monthlyLimit > 0 && monthTotal >= settings.monthlyLimit;
  const ratio = (used, limit) => (limit > 0 ? Math.min(used / limit, 1) : 0);
  return {
    daily,
    monthly,
    any: daily || monthly,
    dailyRatio: ratio(todayTotal, settings.dailyLimit),
    monthlyRatio: ratio(monthTotal, settings.monthlyLimit),
  };
}
