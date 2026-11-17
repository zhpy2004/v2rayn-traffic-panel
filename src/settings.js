/**
 * 面板设置：悬浮球开关 + 月/日流量上限（字节，0 表示不限制）。
 * 存在 SQLite 的 meta 表里，随数据库一起持久化。
 */
export const DEFAULT_SETTINGS = {
  ballEnabled: true,
  dailyLimit: 0,
  monthlyLimit: 0,
};

const MAX_LIMIT = 10 * 1024 ** 4; // 10 TB 封顶，防止误填
const KEY = 'settings';

export function readSettings(store) {
  const raw = store.meta.get(KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return {
      ballEnabled: typeof parsed.ballEnabled === 'boolean' ? parsed.ballEnabled : DEFAULT_SETTINGS.ballEnabled,
      dailyLimit: Number.isFinite(parsed.dailyLimit) && parsed.dailyLimit >= 0 ? parsed.dailyLimit : 0,
      monthlyLimit: Number.isFinite(parsed.monthlyLimit) && parsed.monthlyLimit >= 0 ? parsed.monthlyLimit : 0,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(store, patch) {
  const next = readSettings(store);

  if (patch.ballEnabled !== undefined) {
    if (typeof patch.ballEnabled !== 'boolean') throw new Error('ballEnabled 必须是布尔值');
    next.ballEnabled = patch.ballEnabled;
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
