/**
 * 面板内分流：决定一条连接是「直连」还是「交给 V2RayN 走节点」。
 *
 * 优先级（与 V2RayN 的写法习惯一致）：
 *   1. proxyDomains（显式走代理，如 anthropic / cursor）
 *   2. directDomains（显式直连，如微软系）
 *   3. proxyCategories（geosite 分类，如 google）
 *   4. directCategories（geosite 分类，如 cn / private）
 *   5. 默认走代理
 */
import { statSync } from 'node:fs';
import { loadGeosite, buildMatcher } from './geo.js';

const CACHE = { file: '', mtime: 0, size: 0, sites: null };

function loadCached(file) {
  const stat = statSync(file);
  if (CACHE.sites && CACHE.file === file && CACHE.mtime === stat.mtimeMs && CACHE.size === stat.size) {
    return CACHE.sites;
  }
  const sites = loadGeosite(file);
  CACHE.file = file;
  CACHE.mtime = stat.mtimeMs;
  CACHE.size = stat.size;
  CACHE.sites = sites;
  return sites;
}

/** 匹配显式域名列表：`example.com` 与 `*.example.com` 都按后缀匹配 */
export function matchDomainList(list, host) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  for (const raw of list) {
    const pat = String(raw).trim().toLowerCase();
    if (!pat) continue;
    const base = pat.startsWith('*.') ? pat.slice(2) : pat;
    if (h === base || h.endsWith(`.${base}`)) return true;
  }
  return false;
}

export class Router {
  constructor() {
    this.settings = null;
    this.directMatcher = null;
    this.proxyMatcher = null;
    this.file = '';
    this.error = null;
    this.loadedAt = 0;
  }

  /** 按设置（重新）加载规则；解析失败只记录错误，不影响走代理的兜底 */
  configure(settings) {
    const routing = settings?.routing ?? {};
    this.settings = routing;
    this.error = null;

    if (!routing.enabled) {
      this.directMatcher = null;
      this.proxyMatcher = null;
      return this.status();
    }

    const file = routing.geositePath;
    if (!file) {
      this.error = '未找到 geosite.dat，跳过分类规则（只按显式域名列表分流）';
      this.directMatcher = null;
      this.proxyMatcher = null;
      return this.status();
    }

    try {
      const sites = loadCached(file);
      this.directMatcher = buildMatcher(sites, routing.directCategories ?? []);
      this.proxyMatcher = buildMatcher(sites, routing.proxyCategories ?? []);
      this.file = file;
      this.loadedAt = Date.now();
    } catch (err) {
      this.error = `加载 geosite 失败：${err.message}`;
      this.directMatcher = null;
      this.proxyMatcher = null;
    }
    return this.status();
  }

  decide(host) {
    const routing = this.settings;
    if (!routing || !routing.enabled) return 'proxy';

    if (matchDomainList(routing.proxyDomains, host)) return 'proxy';
    if (matchDomainList(routing.directDomains, host)) return 'direct';
    if (this.proxyMatcher?.match(host)) return 'proxy';
    if (this.directMatcher?.match(host)) return 'direct';
    return 'proxy';
  }

  /** 上游不可用时是否允许回退直连 */
  canFailOpen() {
    return Boolean(this.settings?.failOpen);
  }

  status() {
    return {
      enabled: Boolean(this.settings?.enabled),
      file: this.file,
      error: this.error,
      loaded: Boolean(this.directMatcher || this.proxyMatcher),
      loadedAt: this.loadedAt,
      direct: this.directMatcher
        ? { categories: this.directMatcher.categories, size: this.directMatcher.size, counts: this.directMatcher.counts }
        : null,
      proxy: this.proxyMatcher
        ? { categories: this.proxyMatcher.categories, size: this.proxyMatcher.size, counts: this.proxyMatcher.counts }
        : null,
    };
  }
}
