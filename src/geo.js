/**
 * 解析 Xray 的 geosite.dat（protobuf），并按分类构建域名匹配器。
 *
 * GeoSiteList { repeated GeoSite entry = 1 }
 * GeoSite     { string country_code = 1; repeated Domain domain = 2 }
 * Domain      { Type type = 1; string value = 2 }
 *   type: 0 keyword, 1 regex, 2 domain(suffix), 3 full
 */
import { readFileSync, statSync } from 'node:fs';

const TYPE_KEYWORD = 0;
const TYPE_REGEX = 1;
const TYPE_SUFFIX = 2;
const TYPE_FULL = 3;

/** 从 buffer 中解析出 Map<分类, {suffix:Set, full:Set, keyword:[], regex:[], counts}> */
export function parseGeosite(buf) {
  const sites = new Map();
  let pos = 0;

  const readVarint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = buf[pos++];
      if (b === undefined) throw new Error('unexpected EOF');
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 49) throw new Error('varint too long');
    }
    return result;
  };
  const readBytes = () => {
    const len = readVarint();
    const start = pos;
    pos += len;
    if (pos > buf.length) throw new Error('length overflow');
    return buf.subarray(start, pos);
  };
  const skip = (wire) => {
    if (wire === 0) readVarint();
    else if (wire === 2) readBytes();
    else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else throw new Error(`unsupported wire type ${wire}`);
  };

  while (pos < buf.length) {
    const tag = readVarint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field !== 1 || wire !== 2) {
      skip(wire);
      continue;
    }
    const chunk = readBytes();
    const site = { suffix: new Set(), full: new Set(), keyword: [], regex: [], counts: [0, 0, 0, 0] };

    let q = 0;
    const varintIn = () => {
      let result = 0;
      let shift = 0;
      for (;;) {
        const b = chunk[q++];
        result += (b & 0x7f) * 2 ** shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      return result;
    };
    const bytesIn = () => {
      const len = varintIn();
      const start = q;
      q += len;
      return chunk.subarray(start, q);
    };

    let code = '';
    while (q < chunk.length) {
      const t = varintIn();
      const f = t >> 3;
      const w = t & 7;
      if (f === 1 && w === 2) {
        code = bytesIn().toString('utf8');
      } else if (f === 2 && w === 2) {
        const d = bytesIn();
        let type = TYPE_SUFFIX;
        let value = '';
        let r = 0;
        while (r < d.length) {
          const tt = d[r++];
          const df = tt >> 3;
          const dw = tt & 7;
          if (df === 1 && dw === 0) {
            type = 0;
            let shift = 0;
            for (;;) {
              const b = d[r++];
              type += (b & 0x7f) * 2 ** shift;
              if ((b & 0x80) === 0) break;
              shift += 7;
            }
          } else if (df === 2 && dw === 2) {
            const len = d[r++];
            value = d.subarray(r, r + len).toString('utf8');
            r += len;
          } else if (dw === 0) r++;
          else if (dw === 2) r += 1 + d[r];
          else break;
        }
        if (!value) continue;
        const v = value.toLowerCase();
        if (type === TYPE_SUFFIX) site.suffix.add(v);
        else if (type === TYPE_FULL) site.full.add(v);
        else if (type === TYPE_KEYWORD) site.keyword.push(v);
        else if (type === TYPE_REGEX) site.regex.push(v);
        site.counts[Math.min(type, 3)] += 1;
      } else if (w === 0) varintIn();
      else if (w === 2) bytesIn();
      else break;
    }

    if (code) sites.set(code.toUpperCase(), site);
  }

  return sites;
}

/** 按分类列表合并成一个匹配器 */
export function buildMatcher(sites, categories) {
  const suffix = new Set();
  const full = new Set();
  const keyword = [];
  const used = [];

  for (const raw of categories) {
    const key = String(raw).trim().toUpperCase();
    if (!key) continue;
    const site = sites.get(key);
    if (!site) continue;
    used.push(key);
    for (const s of site.suffix) suffix.add(s);
    for (const f of site.full) full.add(f);
    for (const k of site.keyword) keyword.push(k);
  }

  const match = (host) => {
    const h = String(host).toLowerCase().replace(/\.$/, '');
    if (!h || h.includes(':')) return false;
    if (full.has(h)) return true;
    const labels = h.split('.');
    let idx = labels.indexOf('*');
    if (idx >= 0) return false;
    for (let i = 0; i < labels.length; i += 1) {
      if (suffix.has(labels.slice(i).join('.'))) return true;
    }
    for (const k of keyword) if (h.includes(k)) return true;
    return false;
  };

  return {
    match,
    categories: used,
    size: suffix.size + full.size + keyword.length,
    counts: { suffix: suffix.size, full: full.size, keyword: keyword.length },
  };
}

/** 读取 geosite.dat 并解析（带大小保护） */
export function loadGeosite(file) {
  const stat = statSync(file);
  if (stat.size > 64 * 1024 * 1024) throw new Error('geosite 文件过大');
  return parseGeosite(readFileSync(file));
}
