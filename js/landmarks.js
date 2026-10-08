// ランドマーク（火山・ホテルのタワー・蒸気船・地球儀・城・神殿・要塞・宮殿・帆船）を手続き的に作る
// どれも実在の建物の大まかな形・大きさ・色に合わせた「模型」で、細部やキャラクターは再現しない
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Acc, heightfield, fbm, obb, ringArea, centroid, distToRing, offsetRing, flatGeo, WATER_Y } from './model.js?v=202610090047';

const ring = (f) => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const col = (h) => new THREE.Color(h);
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const M = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().makeRotationY(ry).scale(new THREE.Vector3(s, s, s)).setPosition(x, y, z);

export function buildLandmarks(model) {
  const d = model.d;
  const A = {
    stone: new Acc(), plaster: new Acc(), metal: new Acc(), wood: new Acc(), sail: new Acc(), glow: new Acc(),
    ny: new Acc(), fs: new Acc(), pd: new Acc(),
  };
  const out = { spin: [] };
  // ランドマークのそばの建物（向き・高さを合わせる）
  const hostB = (x, z, maxd = 45) => {
    let best = null, bd = maxd;
    for (const b of d.buildings) {
      const r = ring(b.r);
      const [cx, cz] = centroid(r);
      const dd = Math.hypot(cx - x, cz - z);
      if (dd < bd && ringArea(r) > 150) { bd = dd; best = { b, r, cx, cz }; }
    }
    return best;
  };
  // 窓のある壁（建物と同じテクスチャ）
  const facadeWalls = (acc, r, y0, y1, c, floor = 3.6) => {
    if (ringArea(r) < 0) r = r.slice().reverse();
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
      const nb = Math.max(1, Math.round(L / 4));
      for (let y = y0; y < y1 - 0.01; y += floor) {
        const yt = Math.min(y1, y + floor), v1 = 0.5 + 0.5 * ((yt - y) / floor);
        acc.quad([a[0], y, a[1]], [b[0], y, b[1]], [b[0], yt, b[1]], [a[0], yt, a[1]], [nx, 0, nz], [0, 0.5], [nb, 0.5], [nb, v1], [0, v1], c);
      }
    }
  };
  const box = (acc, x, y, z, w, h, dpt, c, ry = 0) => acc.add(new THREE.BoxGeometry(w, h, dpt), M(x, y + h / 2, z, ry), c, 1 / 4);
  const cyl = (acc, x, y, z, r0, r1, h, c, seg = 16) => acc.add(new THREE.CylinderGeometry(r1, r0, h, seg), M(x, y + h / 2, z), c, 1 / 4);
  const cone = (acc, x, y, z, r, h, c, seg = 12) => acc.add(new THREE.ConeGeometry(r, h, seg), M(x, y + h / 2, z), c, 1 / 4);
  const dome = (acc, x, y, z, r, c, onion = false) => {
    if (!onion) { acc.add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(x, y, z), c); return; }
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const rr = r * (t < 0.55 ? 1 + 0.25 * Math.sin((t / 0.55) * Math.PI) : (1 - (t - 0.55) / 0.45) ** 1.4 * 1.0);
      pts.push(new THREE.Vector2(Math.max(0.01, rr), t * r * 2.2));
    }
    acc.add(new THREE.LatheGeometry(pts, 24), M(x, y, z), c);
  };

  for (const L of d.landmarks) {
    const r = L.ring ? ring(L.ring) : null;
    switch (L.k) {
      // ---------------------------------------------------------------- プロメテウス火山
      case 'volcano': {
        const outer = r, holes = (L.holes || []).map(ring);
        const px = L.px ?? L.x, pz = L.pz ?? L.z;
        const hfn = (x, z) => {
          const dO = distToRing(x, z, outer);
          const dH = holes.length ? Math.min(...holes.map((h) => distToRing(x, z, h))) : 1e9;
          const rp = Math.hypot(x - px, z - pz);
          // 外側はなだらか、カルデラ（内側の穴）側は切り立った崖
          const base = 26 * sm(dO / 34) * sm(dH / 6);
          const peak = L.h * Math.exp(-(rp * rp) / (2 * 25 * 25)) * sm(dO / 12) * sm(dH / 5);
          let h = Math.max(base, peak);
          if (rp < 11) h -= (1 - rp / 11) * 10;           // 火口
          h += (fbm(x * 0.05, z * 0.05) - 0.5) * 12 * sm(dO / 10) * sm(dH / 4) + (fbm(x * 0.22 + 9, z * 0.22) - 0.5) * 3;
          const dp = model.pathIdx.dist(x, z);
          if (dp < 4) h = Math.min(h, Math.max(0, (dp - 1.9) * 5.0)); // 通路は切り通し（谷）に
          return h;
        };
        const cLow = col('#6f6250'), cGreen = col('#55703a'), cMid = col('#7b5444'), cHigh = col('#5e463e'), cTop = col('#35302e');
        const colfn = (x, z, h, ny) => {
          const n = fbm(x * 0.15, z * 0.15, 3);
          let c = h < 8 ? cLow.clone().lerp(cMid, h / 8) : h < 30 ? cMid.clone().lerp(cHigh, (h - 8) / 22) : cHigh.clone().lerp(cTop, Math.min(1, (h - 30) / 20));
          if (ny > 0.6 && h < 20 && n > 0.4) c.lerp(cGreen, 0.8);
          return c.multiplyScalar(0.82 + n * 0.35);
        };
        const g = heightfield(outer, holes, model.mobile ? 2.2 : 1.5, hfn, colfn, -0.2);
        A.stone.append(g);
        // 火口の赤い光と、斜面を流れる溶岩（夜に強く光る）
        A.glow.add(new THREE.CircleGeometry(6, 20).rotateX(-Math.PI / 2), M(px, hfn(px, pz) + 0.3, pz), col('#ff6a20'));
        const lava = col('#ff5a14');
        for (const a0 of [0.6, 2.1, 3.4, 4.7, 5.6]) {
          let x = px + Math.cos(a0) * 10, z = pz + Math.sin(a0) * 10, w = 1.4;
          let prev = null;
          for (let k = 0; k < 40; k++) {
            const h = hfn(x, z);
            if (h < 9) break;
            // 下り坂の向きへ（少しゆらす）
            const e = 1.2, gx = hfn(x + e, z) - hfn(x - e, z), gz = hfn(x, z + e) - hfn(x, z - e);
            const gl = Math.hypot(gx, gz) || 1;
            const dx = -gx / gl + (fbm(x * 0.3, z * 0.3) - 0.5) * 0.5, dz = -gz / gl + (fbm(z * 0.3, x * 0.3) - 0.5) * 0.5;
            const dl = Math.hypot(dx, dz) || 1;
            const nx = (-dz / dl) * w, nz = (dx / dl) * w;
            const cur = [[x + nx, h + 0.2, z + nz], [x - nx, h + 0.2, z - nz]];
            if (prev) A.glow.quad(prev[0], prev[1], cur[1], cur[0], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], lava);
            prev = cur;
            x += (dx / dl) * 1.6; z += (dz / dl) * 1.6;
            w = Math.max(0.5, w * 0.97);
          }
        }
        model.labels.push({ text: L.n, pos: new THREE.Vector3(px, L.h + 6, pz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- タワー・オブ・テラー（ホテル・ハイタワー）
      case 'tower_of_terror': {
        let rr = r;
        if (ringArea(rr) < 0) rr = rr.slice().reverse();
        const o = obb(rr, L.a || 0);
        const brick = col('#c98d78'), stone = col('#e6d8c0'), copper = col('#5f9a86'), roof = col('#6a3a30');
        facadeWalls(A.ny, rr, 0, 34, brick, 3.8);
        model.cornice?.(A.stone, rr, offsetRing(rr, 0.5), 33.6, 34.4, stone);
        // 上の段（長方形を少し内側に）
        const ins = (k) => { const u0 = o.u0 + k, u1 = o.u1 - k, v0 = o.v0 + k, v1 = o.v1 - k; return [o.P(u0, v0), o.P(u1, v0), o.P(u1, v1), o.P(u0, v1)]; };
        const s1 = ins(Math.min(o.L, o.W) * 0.18);
        facadeWalls(A.ny, s1, 34.4, 44, brick, 3.8);
        A.stone.add(flatGeo(s1, [], 44, 0.25), new THREE.Matrix4(), stone);
        A.stone.add(flatGeo(ins(0.2), [], 34.4, 0.25), new THREE.Matrix4(), roof);
        // 中央の塔
        const [cx, cz] = o.cx;
        const tw = Math.min(o.L, o.W) * 0.3;
        box(A.ny, cx, 44, cz, tw, 8, tw, brick, -(L.a || 0));
        A.stone.add(new THREE.ConeGeometry(tw * 0.78, L.h - 52, 4), M(cx, 52 + (L.h - 52) / 2, cz, -(L.a || 0) + Math.PI / 4), roof);
        cyl(A.metal, cx, L.h - 0.5, cz, 0.15, 0.1, 3, col('#c9a040'), 6);
        // 角の小塔（ドーム）
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          // 外接長方形の角にいちばん近い、建物の角に置く（宙に浮かないように）
          const [qx, qz] = o.P(o.u0 + o.L * u, o.v0 + o.W * v);
          let best = rr[0], bd = 1e9;
          for (const p of rr) { const dd = Math.hypot(p[0] - qx, p[1] - qz); if (dd < bd) { bd = dd; best = p; } }
          const [cx2, cz2] = o.cx;
          const k = 2.0 / (Math.hypot(best[0] - cx2, best[1] - cz2) || 1);
          const x = best[0] + (cx2 - best[0]) * k, z = best[1] + (cz2 - best[1]) * k;
          cyl(A.ny, x, 24, z, 2.4, 2.4, 16, brick, 12);
          dome(A.metal, x, 40, z, 2.6, copper, true);
        }
        model.labels.push({ text: L.n, pos: new THREE.Vector3(cx, L.h + 5, cz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- S.S.コロンビア号
      case 'ship': {
        let rr = r;
        if (ringArea(rr) < 0) rr = rr.slice().reverse();
        const o = obb(rr, L.a || 0);
        const navy = col('#1d2836'), red = col('#8c2b22'), white = col('#f3f1ea'), deck = col('#a07c58'), cream = col('#eadbb4');
        const deckY = 7;
        const hullBand = (y0, y1, c) => {
          for (let i = 0; i < rr.length; i++) {
            const a = rr[i], b = rr[(i + 1) % rr.length];
            const Lh = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (Lh < 0.05) continue;
            A.plaster.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [(b[1] - a[1]) / Lh, 0, -(b[0] - a[0]) / Lh], [0, 0], [1, 0], [1, 1], [0, 1], c);
          }
        };
        hullBand(WATER_Y - 0.5, 0.6, red);
        hullBand(0.6, deckY - 0.6, navy);
        hullBand(deckY - 0.6, deckY, white);
        A.wood.add(flatGeo(rr, [], deckY, 0.5), new THREE.Matrix4(), deck);
        const along = o.L >= o.W;
        const Lx = along ? o.L : o.W, Wx = along ? o.W : o.L;
        const P = (t, s) => (along ? o.P(o.u0 + o.L * t, (o.v0 + o.v1) / 2 + s) : o.P((o.u0 + o.u1) / 2 + s, o.v0 + o.W * t));
        const rect = (t0, t1, w) => [P(t0, -w / 2), P(t1, -w / 2), P(t1, w / 2), P(t0, w / 2)];
        const tiers = [[0.22, 0.8, Wx * 0.72, deckY, deckY + 3.4], [0.3, 0.72, Wx * 0.6, deckY + 3.4, deckY + 6.6], [0.38, 0.62, Wx * 0.42, deckY + 6.6, deckY + 9.4]];
        for (const [t0, t1, w, y0, y1] of tiers) {
          const q = rect(t0, t1, w);
          facadeWalls(A.pd, q, y0, y1, white, y1 - y0);
          A.plaster.add(flatGeo(ringArea(q) > 0 ? q : q.slice().reverse(), [], y1, 0.3), new THREE.Matrix4(), white);
        }
        // 3本の煙突（赤に黒い帯）
        for (const t of [0.36, 0.5, 0.64]) {
          const [x, z] = P(t, 0);
          cyl(A.plaster, x, deckY + 9.4, z, 2.2, 2.0, 9.5, col('#b3261e'), 20);
          cyl(A.plaster, x, deckY + 18.9, z, 2.0, 2.0, 2.6, col('#141414'), 20);
        }
        for (const t of [0.1, 0.9]) {
          const [x, z] = P(t, 0);
          cyl(A.wood, x, deckY, z, 0.3, 0.18, L.h - deckY, col('#d8d0c0'), 8);
        }
        const [mx, mz] = P(0.5, 0);
        model.labels.push({ text: L.n, pos: new THREE.Vector3(mx, L.h + 4, mz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- アクアスフィア（地球儀の噴水）
      case 'aquasphere': {
        const [cx, cz] = r ? centroid(r) : [L.x, L.z];
        cyl(A.stone, cx, 0, cz, 3.2, 2.4, 1.4, col('#d8cfbe'), 24);
        const R = 4.2;
        const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshStandardMaterial({ map: globeTex(), roughness: 0.25, metalness: 0.2 }));
        globe.position.set(cx, 1.4 + R + 0.2, cz);
        globe.castShadow = true;
        model.root.add(globe);
        out.spin.push(globe);
        model.labels.push({ text: 'アクアスフィア', pos: new THREE.Vector3(cx, 13, cz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- 灯台（ケープコッド）
      case 'lighthouse': {
        const [cx, cz] = r ? centroid(r) : [L.x, L.z];
        cyl(A.plaster, cx, 0, cz, 2.8, 1.9, L.h - 4, col('#f4f2ec'), 20);
        cyl(A.plaster, cx, L.h - 4, cz, 2.5, 2.5, 0.4, col('#2a2a2a'), 20);
        cyl(A.glow, cx, L.h - 3.6, cz, 1.5, 1.5, 2.2, col('#fff1c0'), 16);
        cone(A.plaster, cx, L.h - 1.4, cz, 1.9, 2.2, col('#9c2b23'), 16);
        model.labels.push({ text: '灯台', pos: new THREE.Vector3(cx, L.h + 3, cz), cls: 'lm small' });
        break;
      }
      // ---------------------------------------------------------------- アレンデール城
      case 'castle_arendelle': {
        const hb = hostB(L.x, L.z, 40);
        const cx = hb ? hb.cx : L.x, cz = hb ? hb.cz : L.z, a = hb ? hb.b.a || 0 : 0;
        const wall = col('#efe6d4'), roofC = col('#3d6a5c'), gold = col('#c9a040');
        const R = (u, v) => [cx + u * Math.cos(a) - v * Math.sin(a), cz + u * Math.sin(a) + v * Math.cos(a)];
        const hall = [R(-13, -7), R(13, -7), R(13, 7), R(-13, 7)];
        facadeWalls(A.fs, hall, 0, 15, wall, 5);
        // 急な切妻屋根
        const rh = 9;
        const P3 = (u, v, y) => { const [x, z] = R(u, v); return [x, y, z]; };
        const roofQ = (p) => A.metal.quad(p[0], p[1], p[2], p[3], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], roofC);
        roofQ([P3(-13.6, -7.6, 15), P3(13.6, -7.6, 15), P3(13.6, 0, 15 + rh), P3(-13.6, 0, 15 + rh)]);
        roofQ([P3(13.6, 7.6, 15), P3(-13.6, 7.6, 15), P3(-13.6, 0, 15 + rh), P3(13.6, 0, 15 + rh)]);
        A.plaster.tri(P3(-13, -7, 15), P3(-13, 7, 15), P3(-13, 0, 15 + rh), null, [0, 0], [1, 0], [0.5, 1], wall);
        A.plaster.tri(P3(13, 7, 15), P3(13, -7, 15), P3(13, 0, 15 + rh), null, [0, 0], [1, 0], [0.5, 1], wall);
        // 塔
        const towers = [[0, -9, 4.2, 22, 13], [-14, -8, 3.0, 17, 11], [14, -8, 3.0, 17, 11], [-14, 8, 2.6, 15, 9], [14, 8, 2.6, 15, 9]];
        for (const [u, v, rad, h, sp] of towers) {
          const [x, z] = R(u, v);
          cyl(A.fs, x, 0, z, rad, rad, h, wall, 14);
          cyl(A.plaster, x, h - 0.6, z, rad + 0.35, rad + 0.35, 0.8, col('#8a6a48'), 14);
          cone(A.metal, x, h, z, rad + 0.4, sp, roofC, 14);
          cyl(A.metal, x, h + sp, z, 0.12, 0.06, 2.2, gold, 6);
        }
        model.labels.push({ text: L.n, pos: new THREE.Vector3(...P3(0, -9, 0).slice(0, 1), 38, P3(0, -9, 0)[2]), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- キング・トリトンズ・キャッスル（貝がらの塔）
      case 'castle_triton': {
        const cx = L.x, cz = L.z;
        const cs = ['#ee8f73', '#f4c58e', '#d2759a', '#8ccac2', '#f0a66e', '#e6d0a0'];
        const spires = [[0, 0, 4.2, L.h], [6, 3, 2.8, L.h * 0.72], [-6, 2, 3.0, L.h * 0.78], [3, -6, 2.4, L.h * 0.6], [-4, -5, 2.6, L.h * 0.66], [8, -3, 2.0, L.h * 0.5], [-9, -2, 1.9, L.h * 0.48]];
        spires.forEach(([u, v, rad, h], i) => {
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const t = k / 24;
            const rr = rad * (1 - t) ** 1.3 * (1 + 0.1 * Math.sin(t * 40));
            pts.push(new THREE.Vector2(Math.max(0.05, rr), t * h));
          }
          const g = new THREE.LatheGeometry(pts, 14);
          A.plaster.add(g, M(cx + u, 0, cz + v, i), col(cs[i % cs.length]));
          cone(A.metal, cx + u, h - 0.2, cz + v, 0.35, 1.6, col('#d8b050'), 8);
        });
        // 土台の岩
        const base = [];
        for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2; base.push([cx + Math.cos(t) * 14 * (0.85 + 0.25 * fbm(k, 3)), cz + Math.sin(t) * 12 * (0.85 + 0.25 * fbm(k, 7))]); }
        const g = heightfield(base, [], 1.5, (x, z) => 6 * sm(distToRing(x, z, base) / 6) * (0.7 + 0.6 * fbm(x * 0.2, z * 0.2)), (x, z, h) => col('#d98a72').multiplyScalar(0.85 + fbm(x * 0.3, z * 0.3) * 0.3), 0);
        A.stone.append(g);
        model.labels.push({ text: L.n, pos: new THREE.Vector3(cx, L.h + 4, cz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- クリスタルスカルの魔宮（階段ピラミッド）
      case 'pyramid': {
        const hb = hostB(L.x, L.z, 60);
        const cx = hb ? hb.cx * 0.5 + L.x * 0.5 : L.x, cz = hb ? hb.cz * 0.5 + L.z * 0.5 : L.z, a = hb ? hb.b.a || 0 : 0;
        const stone = col('#b39a72');
        const tiers = 4, base = 32, th = 4.6;
        for (let k = 0; k < tiers; k++) {
          const s = base - k * 6.4;
          A.stone.add(new THREE.BoxGeometry(s, th, s), M(cx, k * th + th / 2, cz, -a), stone.clone().multiplyScalar(0.92 + 0.08 * (k % 2)), 1 / 5);
        }
        // 正面の大階段
        A.stone.add(new THREE.BoxGeometry(6, tiers * th, 10), M(cx + Math.cos(a + Math.PI / 2) * (base / 2), tiers * th / 2 - 1.5, cz + Math.sin(a + Math.PI / 2) * (base / 2), -a), stone.clone().multiplyScalar(0.85), 1 / 5);
        // 頂上の神殿
        box(A.stone, cx, tiers * th, cz, 9, 5.6, 9, col('#a88e68'), -a);
        A.stone.add(new THREE.ConeGeometry(6.6, 3.2, 4), M(cx, tiers * th + 5.6 + 1.6, cz, -a + Math.PI / 4), col('#8e7656'));
        // 苔とつる（緑の帯）
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * Math.PI * 2;
          A.stone.add(new THREE.BoxGeometry(2 + (k % 3), 0.5, 1.2), M(cx + Math.cos(ang) * (base / 2 - 1 - (k % 3) * 3), (k % 4) * th + th, cz + Math.sin(ang) * (base / 2 - 1 - (k % 3) * 3), ang), col('#4f6a34'));
        }
        model.labels.push({ text: L.n, pos: new THREE.Vector3(cx, L.h + 6, cz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- フォートレス（要塞と天文台の塔）
      case 'fortress': {
        const cx = L.x, cz = L.z;
        const stone = col('#cdb48c'), roofC = col('#9a5a3a'), copper = col('#5f9a86');
        const n = 9, R = 17;
        const wallR = [];
        for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; wallR.push([cx + Math.cos(t) * R, cz + Math.sin(t) * R]); }
        facadeWalls(A.ny, wallR, 0, 9, col('#efe0c8'), 4.5);
        // 胸壁
        for (let k = 0; k < n; k++) {
          const [ax, az] = wallR[k], [bx, bz] = wallR[(k + 1) % n];
          for (let t = 0.1; t < 1; t += 0.2) box(A.stone, ax + (bx - ax) * t, 9, az + (bz - az) * t, 1.2, 1.1, 1.2, stone, Math.atan2(bz - az, bx - ax));
        }
        A.stone.add(flatGeo(wallR, [], 8.8, 0.25), new THREE.Matrix4(), col('#b8a07a'));
        cyl(A.stone, cx + 4, 0, cz - 3, 5.6, 5.2, 21, stone, 20);
        dome(A.metal, cx + 4, 21, cz - 3, 5.4, col('#d4a640'));
        cyl(A.metal, cx + 4, 26.4, cz - 3, 0.2, 0.1, 2.8, col('#c9a040'), 6);
        cyl(A.stone, cx - 9, 0, cz + 7, 3.2, 3.0, 14, stone, 14);
        cone(A.plaster, cx - 9, 14, cz + 7, 3.6, 5, roofC, 14);
        model.labels.push({ text: L.n, pos: new THREE.Vector3(cx, L.h + 5, cz), cls: 'lm' });
        break;
      }
      // ---------------------------------------------------------------- アラビアンコーストの宮殿（玉ねぎ形のドームと尖塔）
      case 'palace': {
        const hb = hostB(L.x, L.z, 40);
        const cx = hb ? hb.cx : L.x, cz = hb ? hb.cz : L.z, a = hb ? hb.b.a || 0 : 0;
        const top = hb ? hb.b.h + 0.9 : 12;
        const gold = col('#d6a63a'), white = col('#f8f0de');
        cyl(A.plaster, cx, top, cz, 7.2, 7.2, 4, white, 28);
        dome(A.metal, cx, top + 4, cz, 7, gold, true);
        cyl(A.metal, cx, top + 4 + 15.4, cz, 0.2, 0.08, 3, gold, 6);
        for (const s of [-1, 1]) {
          const x = cx + Math.cos(a) * 19 * s, z = cz + Math.sin(a) * 19 * s;
          cyl(A.plaster, x, 0, z, 1.7, 1.4, 22, white, 12);
          cyl(A.plaster, x, 16, z, 2.2, 2.2, 1.0, col('#c9a060'), 12);
          dome(A.metal, x, 22, z, 1.8, col('#3f8f9a'), true);
        }
        model.labels.push({ text: 'アラビアンコースト', pos: new THREE.Vector3(cx, top + 22, cz), cls: 'lm small' });
        break;
      }
      // ---------------------------------------------------------------- 帆船（ルネサンス号・海賊船）
      case 'galleon':
      case 'pirate_ship': {
        if (!r) break;
        let rr = ringArea(r) < 0 ? r.slice().reverse() : r;
        const o = obb(rr, L.a || 0);
        const pirate = L.k === 'pirate_ship';
        const hullC = col(pirate ? '#3c2c22' : '#6e4a2c'), trim = col(pirate ? '#8a6a3a' : '#c9a040'), sailC = col(pirate ? '#cfc6b2' : '#f2ead6');
        const dY = 4.2;
        for (let i = 0; i < rr.length; i++) {
          const a2 = rr[i], b2 = rr[(i + 1) % rr.length];
          const Lh = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
          if (Lh < 0.05) continue;
          const nrm = [(b2[1] - a2[1]) / Lh, 0, -(b2[0] - a2[0]) / Lh];
          A.wood.quad([a2[0], WATER_Y - 0.4, a2[1]], [b2[0], WATER_Y - 0.4, b2[1]], [b2[0], dY, b2[1]], [a2[0], dY, a2[1]], nrm, [0, 0], [Lh / 2, 0], [Lh / 2, 2], [0, 2], hullC);
          A.wood.quad([a2[0], dY - 0.5, a2[1]], [b2[0], dY - 0.5, b2[1]], [b2[0], dY + 0.1, b2[1]], [a2[0], dY + 0.1, a2[1]], nrm, [0, 0], [1, 0], [1, 1], [0, 1], trim);
        }
        A.wood.add(flatGeo(rr, [], dY, 0.5), new THREE.Matrix4(), col('#a07c58'));
        const along = o.L >= o.W;
        const P = (t, s = 0) => (along ? o.P(o.u0 + o.L * t, (o.v0 + o.v1) / 2 + s) : o.P((o.u0 + o.u1) / 2 + s, o.v0 + o.W * t));
        const len = along ? o.L : o.W, wid = along ? o.W : o.L;
        // 船尾の楼
        const q = [P(0.0, -wid * 0.42), P(0.2, -wid * 0.42), P(0.2, wid * 0.42), P(0.0, wid * 0.42)];
        facadeWalls(A.pd, q, dY, dY + 3.2, hullC, 3.2);
        A.wood.add(flatGeo(ringArea(q) > 0 ? q : q.slice().reverse(), [], dY + 3.2, 0.5), new THREE.Matrix4(), col('#8a6a48'));
        const ang = Math.atan2(P(1)[1] - P(0)[1], P(1)[0] - P(0)[0]);
        const masts = [[0.3, L.h * 0.85], [0.52, L.h], [0.74, L.h * 0.8]];
        for (const [t, h] of masts) {
          const [x, z] = P(t);
          cyl(A.wood, x, dY, z, 0.32, 0.18, h - dY, col('#5a4030'), 8);
          for (const [yy, w] of [[0.45, 0.55], [0.72, 0.42], [0.92, 0.3]]) {
            const y = dY + (h - dY) * yy, sw = len * w * 0.5;
            // 帆（少しふくらんだ面）
            const sg = new THREE.PlaneGeometry(sw, (h - dY) * 0.2, 6, 2);
            const Pp = sg.attributes.position;
            for (let i = 0; i < Pp.count; i++) Pp.setZ(i, Math.cos((Pp.getX(i) / sw) * Math.PI) * 0.7);
            sg.computeVertexNormals();
            A.sail.add(sg, new THREE.Matrix4().makeRotationY(-ang + Math.PI / 2).setPosition(x, y - (h - dY) * 0.1, z), sailC);
          }
        }
        const [bx, bz] = P(1.0);
        model.labels.push({ text: L.n, pos: new THREE.Vector3(...P(0.5).slice(0, 1), L.h + 3, P(0.5)[1]), cls: 'lm small' });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- メッシュにまとめる
  const add = (acc, mat, cast = true) => { if (!acc.count) return null; return model.mesh(acc.geo(), mat, { cast }); };
  add(A.stone, model.mat({ map: model.tex.rock, vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
  add(A.plaster, model.mat({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  add(A.metal, model.mat({ vertexColors: true, roughness: 0.35, metalness: 0.65, side: THREE.DoubleSide }));
  add(A.wood, model.mat({ map: model.tex.soil, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  add(A.sail, model.mat({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  for (const st of ['ny', 'fs', 'pd']) {
    if (!A[st].count) continue;
    const F = model.facades[st];
    const m = model.mat({ map: F.map, emissiveMap: F.emissive, emissive: 0x000000, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    model.nightMats.push([m, 'emissive', 1]);
    add(A[st], m);
  }
  if (A.glow.count) {
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xff6a20, emissiveIntensity: 0.7, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    model.nightMats.push([gm, 'glow', 1]);
    add(A.glow, gm, false);
  }
  return out;
}

// 地球儀の模様（海と大陸風のまだら。実在の地図ではない）
function globeTex() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lon = (x / W) * Math.PI * 2, lat = (y / H) * Math.PI;
    const px = Math.sin(lat) * Math.cos(lon), pz = Math.sin(lat) * Math.sin(lon), py = Math.cos(lat);
    const n = fbm(px * 2.2 + 5 + py * 1.3, pz * 2.2 + py * 1.7, 5);
    const land = n > 0.52;
    const i = (y * W + x) * 4;
    const shade = 0.85 + 0.15 * Math.cos(lat * 2);
    if (land) { img.data[i] = 214 * shade; img.data[i + 1] = 186 * shade; img.data[i + 2] = 120 * shade; }
    else { img.data[i] = 40; img.data[i + 1] = 92 + 40 * n; img.data[i + 2] = 150 + 50 * n; }
    // 経線・緯線
    if (x % 32 === 0 || y % 32 === 0) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 230; }
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
