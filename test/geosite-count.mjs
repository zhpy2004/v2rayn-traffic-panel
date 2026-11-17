/**
 * 极简 protobuf 读取 geosite.dat，统计各分类的规则条数与类型。
 * GeoSiteList { repeated GeoSite entry = 1 }
 * GeoSite { string country_code = 1; repeated Domain domain = 2 }
 * Domain { Type type = 1; string value = 2 }
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'C:/Users/zhpy/Downloads/v2rayN-windows-64/v2rayN-windows-64/bin/geosite.dat';
const buf = readFileSync(file);

let pos = 0;
function varint() {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return result;
}
function bytes() {
  const len = varint();
  const start = pos;
  pos += len;
  return buf.subarray(start, start + len);
}
function skip(wire) {
  if (wire === 0) varint();
  else if (wire === 2) bytes();
  else if (wire === 5) pos += 4;
  else if (wire === 1) pos += 8;
  else throw new Error(`wire ${wire}`);
}

const TYPE = ['keyword', 'regex', 'domain(suffix)', 'full'];
const sites = [];

while (pos < buf.length) {
  const tag = varint();
  const field = tag >> 3;
  const wire = tag & 7;
  if (field !== 1 || wire !== 2) {
    skip(wire);
    continue;
  }
  const chunk = bytes();
  // 解析单个 GeoSite
  let p = 0;
  const saved = pos;
  const end = pos; // chunk 已经切片
  let code = '';
  const counts = [0, 0, 0, 0];
  let q = 0;
  const save = pos;
  // 用局部读取器
  const local = {
    varint() {
      let r = 0;
      let s = 0;
      for (;;) {
        const b = chunk[q++];
        r += (b & 0x7f) * 2 ** s;
        if ((b & 0x80) === 0) break;
        s += 7;
      }
      return r;
    },
    bytes() {
      const len = this.varint();
      const st = q;
      q += len;
      return chunk.subarray(st, st + len);
    },
  };
  while (q < chunk.length) {
    const t = local.varint();
    const f = t >> 3;
    const w = t & 7;
    if (f === 1 && w === 2) code = local.bytes().toString('utf8');
    else if (f === 2 && w === 2) {
      const d = local.bytes();
      let r = 0;
      let type = 2;
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
          r += len;
        } else if (dw === 0) r++;
        else if (dw === 2) r += 1 + d[r];
        else break;
      }
      counts[Math.min(type, 3)] += 1;
    } else if (w === 0) local.varint();
    else if (w === 2) local.bytes();
    else break;
  }
  pos = end;
  if (code) sites.push({ code, counts });
}

sites.sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0));
console.log(`分类总数: ${sites.length}`);
const total = sites.reduce((a, s) => a + s.counts.reduce((x, y) => x + y, 0), 0);
console.log(`规则总条数: ${total.toLocaleString()}`);
for (const s of sites.slice(0, 8)) {
  const n = s.counts.reduce((x, y) => x + y, 0);
  console.log(`  ${s.code.padEnd(10)} ${String(n).padStart(7)}  (keyword ${s.counts[0]}, regex ${s.counts[1]}, suffix ${s.counts[2]}, full ${s.counts[3]})`);
}
const cn = sites.find((s) => s.code === 'cn');
if (cn) console.log(`\ncn 分类: ${cn.counts.reduce((x, y) => x + y, 0)} 条  (suffix ${cn.counts[2]}, full ${cn.counts[3]}, keyword ${cn.counts[0]}, regex ${cn.counts[1]})`);
