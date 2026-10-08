// 経路探索と案内文の生成（three.js に依存しない。Node でもテストできる）
export const KIND = { WALK: 0, STAIRS: 1, BRIDGE: 2 };
export const WALK_SPEED = 1.15; // m/秒（混雑した園内の目安）

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const isWagon = (n) => /ワゴン|ポップコーン|販売機|コインロッカー/.test(n);

export class Graph {
  constructor(data, vec = (x, y, z) => ({ x, y, z })) {
    this.d = data;
    this.vec = vec;
    const N = data.nodes, E = data.edges;
    const n = (this.n = N.length / 3);
    const m = E.length / 3;
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < E.length; i += 3) { deg[E[i]]++; deg[E[i + 1]]++; }
    const off = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
    const fill = off.slice();
    const to = new Int32Array(off[n]), eid = new Int32Array(off[n]);
    for (let i = 0, e = 0; i < E.length; i += 3, e++) {
      const a = E[i], b = E[i + 1];
      to[fill[a]] = b; eid[fill[a]++] = e;
      to[fill[b]] = a; eid[fill[b]++] = e;
    }
    this.off = off; this.to = to; this.eid = eid;
    this.kind = new Uint8Array(m);
    this.len = new Float32Array(m);
    this.cm = new Float32Array(m);
    for (let i = 0, e = 0; i < E.length; i += 3, e++) {
      const a = E[i], b = E[i + 1];
      this.kind[e] = E[i + 2];
      this.cm[e] = data.cost ? data.cost[e] : 1;
      this.len[e] = Math.hypot(N[a * 3] - N[b * 3], N[a * 3 + 1] - N[b * 3 + 1], N[a * 3 + 2] - N[b * 3 + 2]);
    }
    this.poiBy = Object.fromEntries(data.pois.map((p) => [p.id, p]));
    this.ports = data.ports;
    // 案内に使う目印（名前のある施設）
    this.marks = data.pois.filter((p) => ['attr', 'show', 'food', 'shop'].includes(p.c) && !isWagon(p.n) && !p.sub?.includes('ホテル'));
  }

  P(i) { const N = this.d.nodes; return this.vec(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); }

  // 1 辺を歩く秒数
  edgeTime(e, bf) {
    const L = this.len[e];
    if (this.kind[e] === KIND.STAIRS) return (L / 0.55 + 2) * (bf ? 60 : 1);
    return (L / WALK_SPEED) * this.cm[e];
  }

  nearest(x, z) {
    const N = this.d.nodes;
    let best = -1, bd = 1e18;
    for (let i = 0; i < this.n; i++) {
      if (N[i * 3 + 1] > 0.3) continue;
      const dd = (N[i * 3] - x) ** 2 + (N[i * 3 + 2] - z) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    return { n: best, d: Math.sqrt(bd) };
  }

  endpoint(key) {
    if (typeof key === 'object' && key) {   // 現在地など {x, z, name}
      const { n } = this.nearest(key.x, key.z);
      return { nodes: [n], name: key.name || '現在地', poi: null, x: key.x, z: key.z };
    }
    const p = this.poiBy[key];
    if (!p) return null;
    return { nodes: [p.g], name: p.n, poi: p, x: p.x, z: p.z };
  }

  // ある地点から、すべての点までの時間（最寄りのトイレ探しなど）
  costsFrom(key, bf = false) {
    const A = this.endpoint(key);
    const dist = new Float64Array(this.n).fill(Infinity);
    const h = new Heap();
    for (const s of A.nodes) { dist[s] = 0; h.push(0, s); }
    while (h.size) {
      const u = h.pop();
      const du = dist[u];
      for (let j = this.off[u]; j < this.off[u + 1]; j++) {
        const v = this.to[j], e = this.eid[j];
        const nd = du + this.edgeTime(e, bf);
        if (nd < dist[v]) { dist[v] = nd; h.push(nd, v); }
      }
    }
    return dist;
  }
  nearestOf(key, cat, k = 3) {
    const dist = this.costsFrom(key);
    return this.d.pois.filter((p) => p.c === cat && p.id !== key && isFinite(dist[p.g]))
      .map((p) => ({ p, t: dist[p.g] })).sort((a, b) => a.t - b.t).slice(0, k);
  }

  _search(A, B, opt) {
    const n = this.n;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevE = new Int32Array(n).fill(-1);
    const target = new Set(B.nodes);
    const h = new Heap();
    for (const s of A.nodes) { dist[s] = 0; h.push(0, s); }
    const bf = !!opt.bf, pen = opt.pen;
    while (h.size) {
      const u = h.pop();
      if (target.has(u)) return { end: u, prev, prevE };
      const du = dist[u];
      for (let j = this.off[u]; j < this.off[u + 1]; j++) {
        const v = this.to[j], e = this.eid[j];
        let c = this.edgeTime(e, bf);
        if (pen) c *= pen[e];
        const nd = du + c;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevE[v] = e; h.push(nd, v); }
      }
    }
    return null;
  }

  // ルート候補: 最短・段差なし（ベビーカー・車いす）・別ルート
  routes(fromKey, toKey, max = 3) {
    const A = this.endpoint(fromKey), B = this.endpoint(toKey);
    if (!A || !B) return [];
    const r0 = this._search(A, B, {});
    if (!r0) return [];
    const best = this._build(r0, A, B, {});
    best.label = 'ルート1（最短）';
    best.kind = 'best';
    const out = [best];
    if (best.stairs > 0) {
      const rb = this._search(A, B, { bf: true });
      if (rb) {
        const b = this._build(rb, A, B, { bf: true });
        if (b.edges.join() !== best.edges.join()) {
          b.label = b.stairs ? 'ベビーカー・車いす（階段が少ない）' : 'ベビーカー・車いす（階段なし）';
          b.kind = 'bf';
          out.push(b);
        }
      }
    } else {
      best.label = 'ルート1（最短・階段なし）';
    }
    const pen = new Float32Array(this.kind.length).fill(1);
    const used = [new Set(best.edges)];
    for (const e of best.edges) pen[e] *= 2.5;
    const alts = [];
    for (let k = 0; k < 6 && alts.length < max - 1; k++) {
      const r = this._search(A, B, { pen });
      if (!r) break;
      const c = this._build(r, A, B, {});
      for (const e of c.edges) pen[e] *= 2.5;
      if (c.time > best.time * 1.5 + 60) continue;
      const share = (S) => { let s = 0, t = 0; for (const e of c.edges) { t += this.len[e]; if (S.has(e)) s += this.len[e]; } return t ? s / t : 1; };
      if (used.some((S) => share(S) > 0.6)) continue;
      used.push(new Set(c.edges));
      c.kind = 'alt';
      alts.push(c);
    }
    alts.sort((a, b) => a.time - b.time).forEach((r, i) => { r.label = `ルート${i + 2}`; });
    return [...out, ...alts];
  }

  _build(r, A, B, opt) {
    const path = [], es = [];
    for (let u = r.end; u !== -1; u = r.prev[u]) { path.push(u); if (r.prevE[u] >= 0) es.push(r.prevE[u]); }
    path.reverse(); es.reverse();
    const N = this.d.nodes;
    // 表示・POV 用の点列（角を少し丸める）。始点・終点は施設の位置まで伸ばす
    let raw = path.map((i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2], i]);
    const startXZ = A.poi || A.x != null ? [A.x, 0, A.z, -1] : null, endXZ = B.poi || B.x != null ? [B.x, 0, B.z, -1] : null;
    if (startXZ && Math.hypot(startXZ[0] - raw[0][0], startXZ[2] - raw[0][2]) > 1.5) raw.unshift(startXZ);
    if (endXZ && Math.hypot(endXZ[0] - raw[raw.length - 1][0], endXZ[2] - raw[raw.length - 1][2]) > 1.5) raw.push(endXZ);
    // ほぼ同じ場所の点を間引く
    const pts0 = [raw[0]];
    for (const p of raw.slice(1)) { const q = pts0[pts0.length - 1]; if (Math.hypot(p[0] - q[0], p[2] - q[2]) > 0.4) pts0.push(p); }
    const pts = chaikin(pts0, 2);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    let stairs = 0, time = 0;
    for (const e of es) { if (this.kind[e] === KIND.STAIRS) stairs += this.len[e]; time += this.edgeTime(e, false); }
    const dist = cum[cum.length - 1];
    time += Math.max(0, dist - es.reduce((s, e) => s + this.len[e], 0)) / WALK_SPEED;
    const res = { nodes: path, edges: es, pts: pts.map((p) => this.vec(p[0], p[1], p[2])), raw: pts, cum, A, B, dist, time, stairs };
    // 各点の「グラフ上の点」（エリア判定・階段判定用）。丸めた点は元の点の近くの番号を使う
    const self = this;
    const seg = (s) => { let lo = 0, hi = cum.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lo; };
    res.seg = seg;
    res.at = (s) => {
      s = Math.max(0, Math.min(dist, s));
      const i = seg(s), L = cum[i + 1] - cum[i] || 1, f = Math.min(1, (s - cum[i]) / L);
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      return self.vec(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    };
    res.dirAt = (s) => {
      const a = res.at(Math.max(0, s - 3)), b = res.at(Math.min(dist, s + 3));
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      return self.vec(dx / L, 0, dz / L);
    };
    // POV の再生時間（歩く速さ一定。階段は少しゆっくり）
    res.vtime = Math.max(1, time);
    res.sAtVtime = (t) => (Math.max(0, Math.min(res.vtime, t)) / res.vtime) * dist;
    this._describe(res, opt);
    res.navAt = (s) => {
      const segs = res.segs;
      let k = segs.findIndex((g) => s < g.s1 - 0.01);
      if (k < 0) k = segs.length - 1;
      const g = segs[k];
      return { ...g, d: Math.max(0, g.s1 - s), next: segs[k + 1] || null, k };
    };
    return res;
  }

  // 案内: segs（POV 用の区間）/ steps（一覧用）/ tagline
  _describe(res) {
    const d = this.d, N = d.nodes, path = res.nodes, es = res.edges;
    const portName = (k) => d.ports[k]?.name || '';
    // グラフの辺ごとの距離（丸めた線の距離に近い値。案内の位置合わせ用に元の点の位置で出す）
    const gcum = [0];
    for (const e of es) gcum.push(gcum[gcum.length - 1] + this.len[e]);
    const scale = gcum[gcum.length - 1] ? (res.dist - (res.cum.length > 1 ? 0 : 0)) / gcum[gcum.length - 1] : 1;
    const startOff = Math.hypot(res.raw[0][0] - N[path[0] * 3], res.raw[0][2] - N[path[0] * 3 + 2]) > 1.5 ? Math.hypot(res.raw[0][0] - N[path[0] * 3], res.raw[0][2] - N[path[0] * 3 + 2]) : 0;
    const S = (q) => Math.min(res.dist, startOff + gcum[q] * Math.min(1, scale));
    const events = [];
    // 1) エリアに入る
    const np = d.nodePort;
    let curPort = np[path[0]], q0 = 0;
    for (let q = 1; q < path.length; q++) {
      const p = np[path[q]];
      if (p === curPort) continue;
      // 25m 以上続くときだけ
      let L = 0, k = q;
      while (k < path.length - 1 && np[path[k]] === p && L < 25) { L += this.len[es[k]] || 0; k++; }
      if (L >= 25 || k === path.length - 1) {
        const parent = d.ports[p]?.parent;
        const prevParent = d.ports[curPort]?.parent;
        if (!(parent && d.ports[curPort]?.key === parent) && !(prevParent && d.ports[p]?.key === prevParent)) {
          events.push({ s: S(q), type: 'port', text: `${portName(p)}に入る`, icon: '◆', cls: 'port' });
        }
        curPort = p;
      }
    }
    // 2) 階段・名前のある橋・通り
    let q = 0;
    while (q < es.length) {
      const e = es[q];
      if (this.kind[e] === KIND.STAIRS) {
        let k = q, L = 0;
        while (k < es.length && this.kind[es[k]] === KIND.STAIRS) { L += this.len[es[k]]; k++; }
        if (L > 1.5) events.push({ s: S(q), s1: S(k), type: 'stairs', text: '階段を通る', icon: '⇵', cls: 'vert', sub: `約${Math.max(1, Math.round(L))}m` });
        q = k;
        continue;
      }
      if (this.kind[e] === KIND.BRIDGE) {
        let k = q, L = 0;
        const ni = d.ename[e];
        while (k < es.length && this.kind[es[k]] === KIND.BRIDGE) { L += this.len[es[k]]; k++; }
        if (L > 6) events.push({ s: S(q), s1: S(k), type: 'bridge', text: ni ? `${d.names[ni]}（橋）を渡る` : '橋を渡る', icon: '≋', cls: 'bridge' });
        q = k;
        continue;
      }
      const ni = d.ename[e];
      if (ni) {
        let k = q, L = 0;
        while (k < es.length && d.ename[es[k]] === ni && this.kind[es[k]] === KIND.WALK) { L += this.len[es[k]]; k++; }
        if (L > 40) events.push({ s: S(q), s1: S(q) + 4, type: 'name', text: `${d.names[ni]}を進む`, icon: '↑', cls: 'street' });
        q = Math.max(k, q + 1);
        continue;
      }
      q++;
    }
    // 3) 曲がり角（丸めた線の向きの変化）
    const turnAt = (s) => {
      const p0 = res.at(s - 6), p1 = res.at(s), p2 = res.at(s + 6);
      const ax = p1.x - p0.x, az = p1.z - p0.z, bx = p2.x - p1.x, bz = p2.z - p1.z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 3 || lb < 3) return 0;
      return (Math.atan2((ax * bz - az * bx) / (la * lb), (ax * bx + az * bz) / (la * lb)) * 180) / Math.PI;
    };
    let last = null;
    for (let s = 8; s < res.dist - 8; s += 2) {
      const a = turnAt(s);
      if (Math.abs(a) < 50) continue;
      if (last && s - last.s < 12) { if (Math.abs(a) > Math.abs(last.ang)) { last.s = s; last.ang = a; } continue; }
      last = { s, type: 'turn', ang: a };
      events.push(last);
    }
    for (const e of events) {
      if (e.type !== 'turn') continue;
      const u = Math.abs(e.ang) > 145, right = e.ang > 0;
      e.icon = u ? '↶' : right ? '↱' : '↰';
      e.text = u ? '折り返す' : right ? '右へ曲がる' : '左へ曲がる';
      const p = res.at(e.s), m = this._markNear(p.x, p.z, 28);
      if (m) e.sub = `${m.n}のあたり`;
    }
    events.sort((a, b) => a.s - b.s);
    // 4) POV の区間
    const segs = [];
    const walkText = (s) => {
      const p = res.at(s);
      return 'まっすぐ進む';
    };
    let cur = 0;
    const firstPort = portName(np[path[0]]);
    for (const ev of events) {
      if (ev.type === 'port') {
        // エリアに入るのは区間の切れ目にしない（案内文の下に出す）
        if (ev.s > cur + 0.5) segs.push({ s0: cur, s1: ev.s, icon: '↑', text: walkText(cur), cls: '', type: 'w' });
        segs.push({ s0: ev.s, s1: ev.s + 4, icon: ev.icon, text: ev.text, cls: 'port', type: 'p' });
        cur = ev.s + 4;
        continue;
      }
      const pre = ev.type === 'turn' ? 6 : 3;
      if (ev.s - pre > cur + 0.5) segs.push({ s0: cur, s1: ev.s - pre, icon: '↑', text: walkText(cur), cls: '', type: 'w' });
      const a = Math.max(cur, ev.s - pre);
      const b = Math.max(a + 0.5, ev.s1 ?? ev.s + 3);
      segs.push({ s0: a, s1: b, icon: ev.icon, text: ev.text, sub: ev.sub, cls: ev.cls || '', type: ev.type[0] });
      cur = b;
    }
    if (res.dist > cur + 0.3) segs.push({ s0: cur, s1: res.dist, icon: '↑', text: walkText(cur), cls: '', type: 'w' });
    const merged = [];
    for (const g of segs) {
      const l = merged[merged.length - 1];
      if (l && l.type === 'w' && g.type === 'w') { l.s1 = g.s1; continue; }
      if (g.s1 - g.s0 < 0.05 && g.type === 'w') continue;
      merged.push(g);
    }
    const endText = `${res.B.name}に到着`;
    merged.push({ s0: res.dist, s1: res.dist + 0.001, icon: '◎', text: endText, cls: 'end', type: 'e', sub: res.B.poi?.sub || '' });
    res.segs = merged;
    // 5) 一覧（曲がり角は目印のあるものだけ。エリア・階段・橋はすべて）
    const steps = [{ icon: '●', text: `${res.A.name}から出発`, sub: res.A.poi?.sub || firstPort, s: 0, cls: 'start' }];
    let prevS = 0;
    for (const ev of events) {
      if (ev.type === 'turn' && !ev.sub) continue;
      steps.push({ icon: ev.icon, text: ev.text, sub: ev.sub || '', s: ev.s, cls: ev.cls || '', dist: ev.s - prevS });
      prevS = ev.s;
    }
    steps.push({ icon: '◎', text: endText, sub: res.B.poi?.sub || '', s: res.dist, cls: 'end', dist: res.dist - prevS });
    res.steps = steps;
    // 6) タグライン（通るエリア・階段）
    const seen = [];
    for (let k = 0; k < path.length; k++) { const nm = portName(np[path[k]]); if (seen[seen.length - 1] !== nm) seen.push(nm); }
    const uniq = [...new Set(seen)];
    const parts = [];
    parts.push(uniq.length > 3 ? `${uniq.slice(0, 2).join('・')} ほか${uniq.length - 2}エリア経由` : uniq.join(' → '));
    parts.push(res.stairs > 1.5 ? `階段 約${Math.round(res.stairs)}m` : '階段なし');
    res.tagline = parts.join(' / ');
  }

  _markNear(x, z, r) {
    let best = null, bd = r;
    for (const p of this.marks) { const dd = Math.hypot(p.x - x, p.z - z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
}

// 角を丸める（チャイキン法。始点・終点はそのまま）
function chaikin(P, it) {
  let pts = P;
  for (let k = 0; k < it; k++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (L < 1.2) { if (i + 1 < pts.length - 1) out.push(b); continue; }
      const f = Math.min(0.25, 2.5 / L);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
      out.push([a[0] + (b[0] - a[0]) * (1 - f), a[1] + (b[1] - a[1]) * (1 - f), a[2] + (b[2] - a[2]) * (1 - f)]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
