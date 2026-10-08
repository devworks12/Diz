// 経路のテスト: node tools/test/routes.mjs [出発の名前] [到着の名前]
// 引数なしなら、入口・アトラクション・ショーのすべての組み合わせで経路が出るかを調べる
import { readFileSync } from 'node:fs';
import { Graph } from '../../js/route.js';

const data = JSON.parse(readFileSync(new URL('../../data/park.json', import.meta.url)));
const g = new Graph(data);
const find = (q) => data.pois.find((p) => p.n.includes(q) || p.id === q);
const [, , a, b] = process.argv;
if (a && b) {
  const A = find(a), B = find(b);
  const rs = g.routes(A.id, B.id);
  for (const r of rs) {
    console.log(`${r.label}  ${Math.round(r.dist)}m  ${Math.round(r.time / 60)}分  ${r.tagline}`);
    for (const s of r.steps) console.log(`   ${s.icon} ${s.text}${s.sub ? '（' + s.sub + '）' : ''}  ${s.dist ? Math.round(s.dist) + 'm' : ''}`);
  }
  process.exit(0);
}
const keys = data.pois.filter((p) => ['attr', 'show', 'entrance'].includes(p.c));
let fail = 0, n = 0, worst = [];
const t0 = Date.now();
for (const A of keys) for (const B of keys) {
  if (A === B) continue;
  n++;
  const r = g.routes(A.id, B.id, 1)[0];
  if (!r) { fail++; console.log('経路なし:', A.n, '→', B.n); continue; }
  const crow = Math.hypot(A.x - B.x, A.z - B.z);
  worst.push([r.dist / Math.max(60, crow), A.n, B.n, Math.round(r.dist), Math.round(crow)]);
}
worst.sort((x, y) => y[0] - x[0]);
console.log(`${n} 組  経路なし ${fail}  ${((Date.now() - t0) / n).toFixed(1)}ms/組`);
console.log('遠回りの大きい組（経路 / 直線）:');
for (const w of worst.slice(0, 12)) console.log('  ', w[0].toFixed(2), w[1], '→', w[2], w[3] + 'm', '直線' + w[4] + 'm');
