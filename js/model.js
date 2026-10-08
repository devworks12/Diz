// 東京ディズニーシーの 3D 模型を組み立てる（地面・水面・岩山・建物・ランドマーク・木・街灯）
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import * as T from './textures.js';
import { buildLandmarks } from './landmarks.js';

export const WATER_Y = -0.6;
const UP = new THREE.Vector3(0, 1, 0);
const ring = (f) => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const col = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- ノイズ（岩肌・火山の起伏）
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- 頂点を貯める入れ物
export class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  get count() { return this.p.length / 3; }
  // 三角形（法線 nrm の向きが表になるように並びを直す）
  tri(a, b, c, nrm, ua = [0, 0], ub = [0, 0], uc = [0, 0], color = WHITE, cb = color, cc = color) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nrm && nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; [cb, cc] = [cc, cb]; nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    const N = nrm || [nx / L, ny / L, nz / L];
    this.p.push(...a, ...b, ...c);
    this.n.push(...N, ...N, ...N);
    this.u.push(...ua, ...ub, ...uc);
    this.c.push(color.r, color.g, color.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  quad(a, b, c, d, nrm, ua, ub, uc, ud, color = WHITE) {
    this.tri(a, b, c, nrm, ua, ub, uc, color);
    this.tri(a, c, d, nrm, ua, uc, ud, color);
  }
  // three.js の形を（変換して）足す
  add(geo, m, color = WHITE, uvScale = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, Cc = g.attributes.color;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize();
      this.n.push(v.x, v.y, v.z);
      if (U) this.u.push(U.getX(i) * uvScale, U.getY(i) * uvScale); else this.u.push(0, 0);
      if (Cc) this.c.push(Cc.getX(i) * color.r, Cc.getY(i) * color.g, Cc.getZ(i) * color.b);
      else this.c.push(color.r, color.g, color.b);
    }
    if (g !== geo) g.dispose();
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// 平らな面（穴あき）。shape は (x, -z) で作り、寝かせて y の高さに置く。uv は 1 m = uvScale
export function flatGeo(o, holes, y, uvScale = 1) {
  const sh = new THREE.Shape(o.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  return g;
}
function colorize(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// 多角形の辺を外へ d m ずらす（角は二等分線の向き。とがった角は伸びすぎないように）
export function offsetRing(r, d) {
  const n = r.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = r[(i - 1 + n) % n], p1 = r[i], p2 = r[(i + 1) % n];
    let ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = az, n1z = -ax, n2x = bz, n2z = -bx; // 外向き（反時計回り前提）
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { out.push([p1[0] + n1x * d, p1[1] + n1z * d]); continue; }
    mx /= ml; mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.33, mx * n1x + mz * n1z));
    out.push([p1[0] + mx * d * k, p1[1] + mz * d * k]);
  }
  return out;
}
export function ringArea(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function centroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f; }
  if (Math.abs(a) < 1e-6) return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  return [cx / (3 * a), cz / (3 * a)];
}
export function pip(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function distToRing(x, z, r) {
  let best = 1e9;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}
// 向きのそろった外接長方形
export function obb(r, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, z] of r) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const P = (u, v) => [u * c - v * s, u * s + v * c];
  return { u0, u1, v0, v1, c, s, P, L: u1 - u0, W: v1 - v0, cx: P((u0 + u1) / 2, (v0 + v1) / 2) };
}

// ---------------------------------------------------------------- 線分の近さを調べる格子（通路から岩を削る）
class SegIndex {
  constructor(cell = 8) { this.cell = cell; this.g = new Map(); }
  add(ax, az, bx, bz) {
    const c = this.cell, seg = [ax, az, bx, bz];
    for (let gx = Math.floor(Math.min(ax, bx) / c) - 1; gx <= Math.floor(Math.max(ax, bx) / c) + 1; gx++)
      for (let gz = Math.floor(Math.min(az, bz) / c) - 1; gz <= Math.floor(Math.max(az, bz) / c) + 1; gz++) {
        const k = gx * 100003 + gz;
        if (!this.g.has(k)) this.g.set(k, []);
        this.g.get(k).push(seg);
      }
  }
  dist(x, z) {
    const a = this.g.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!a) return 1e9;
    let best = 1e9;
    for (const [ax, az, bx, bz] of a) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) best = d;
    }
    return best;
  }
}

// 多角形の上に起伏のある面を作る（格子に分けて、各点の高さを hfn で決める。縁は高さ 0）
export function heightfield(outer, holes, cell, hfn, colfn, y0 = 0) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const H = new Float32Array((nx + 1) * (nz + 1));
  const inside = (x, z) => pip(x, z, outer) && !holes.some((h) => pip(x, z, h));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    H[j * (nx + 1) + i] = inside(x, z) ? Math.max(0, hfn(x, z)) : 0;
  }
  const acc = new Acc();
  const V = (i, j) => [x0 + i * cell, y0 + H[j * (nx + 1) + i], z0 + j * cell];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
    if (!inside(cx, cz)) continue;
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
    const tri = (p, q, r) => {
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (n[1] < 0) n = n.map((v) => -v);
      const L = Math.hypot(...n) || 1;
      n = n.map((v) => v / L);
      const my = (p[1] + q[1] + r[1]) / 3 - y0;
      const c0 = colfn(p[0], p[2], p[1] - y0, n[1]), c1 = colfn(q[0], q[2], q[1] - y0, n[1]), c2 = colfn(r[0], r[2], r[1] - y0, n[1]);
      acc.tri(p, q, r, [0, 1, 0], [p[0] / 6, p[2] / 6 + p[1] / 6], [q[0] / 6, q[2] / 6 + q[1] / 6], [r[0] / 6, r[2] / 6 + r[1] / 6], c0, c1, c2);
      // 法線は面ごと（ごつごつした岩らしく）
      const k = acc.n.length - 9;
      for (let t = 0; t < 3; t++) { acc.n[k + t * 3] = n[0]; acc.n[k + t * 3 + 1] = n[1]; acc.n[k + t * 3 + 2] = n[2]; }
      return my;
    };
    if ((i + j) % 2) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  return acc;
}

// ---------------------------------------------------------------- エリアごとの色
const PAL = {
  med: { walls: ['#efc99c', '#e7ae8a', '#f2dcb4', '#dc9a76', '#ebc3a2', '#f5e6cb', '#d58c66', '#e9bd86', '#f0d0a8'], roof: ['#b25c38', '#c06c42', '#a8553a', '#b9683f'], trim: '#f4ead8', pitch: 0.42, roofKind: 'hip', plaza: '#d8b48c', paving: 'stone' },
  ny: { walls: ['#ffffff', '#f2e4dc', '#e9d6cc', '#d9c9c0', '#f6efe6'], roof: ['#4a4c52', '#5a5c62', '#6a8c80'], trim: '#e2dccf', pitch: 0.55, roofKind: 'flat', plaza: '#b8b0a6', paving: 'brick' },
  capecod: { walls: ['#f6f3ec', '#cdd8de', '#e9e2cf', '#c1ccb8', '#e8d8c8'], roof: ['#5f646c', '#6f6a64', '#585c62'], trim: '#ffffff', pitch: 0.75, roofKind: 'gable', plaza: '#c8beaa', paving: 'cobble' },
  pd: { walls: ['#d7e2df', '#c4d6d2', '#e6dfd0', '#cfd6cc'], roof: ['#4f7474', '#5e7f7a', '#73858a'], trim: '#9fb5b0', pitch: 0.3, roofKind: 'flat', plaza: '#b8b8ae', paving: 'stone' },
  lrd: { walls: ['#d4bb92', '#c4a67a', '#ddc8a4', '#bfa27c'], roof: ['#8a5a3a', '#7a6a50', '#9a6a40'], trim: '#a88a60', pitch: 0.35, roofKind: 'hip', plaza: '#c4ad86', paving: 'dirt' },
  arab: { walls: ['#f6ead0', '#eedcb6', '#fbf4e4', '#e8cfa0', '#f0e0c4'], roof: ['#e8d8b8', '#d8c098'], trim: '#d4a85c', pitch: 0.2, roofKind: 'flat', plaza: '#dcc7a0', paving: 'stone' },
  mermaid: { walls: ['#f4c9c6', '#cfe6e1', '#f2ddb6', '#ddcdf0', '#f6d2b8'], roof: ['#e89a8a', '#8ac8c0', '#e8c070'], trim: '#f6e0b8', pitch: 0.5, roofKind: 'flat', plaza: '#e0c8b8', paving: 'cobble' },
  mi: { walls: ['#9a7a64', '#8a7a6c', '#a88a74'], roof: ['#5a4232', '#4a4a48'], trim: '#6a4e38', pitch: 0.4, roofKind: 'flat', plaza: '#b09276', paving: 'stone' },
  fs: { walls: ['#efe7d8', '#e0d2b4', '#d4dae0', '#ecd8c6', '#f4ecd8'], roof: ['#3f5f58', '#4a5a6a', '#5a4a40', '#3a5070'], trim: '#6e4e32', pitch: 1.0, roofKind: 'gable', plaza: '#b4b0a8', paving: 'cobble' },
};
const ROCK = { MH: '#a89a88', EN: '#a89a88', AW: '#8f8a84', CC: '#8f8a84', PD: '#8a8682', LR: '#b49468', AC: '#c4a47a', ML: '#c8907c', MI: '#8a5440', FS: '#8e9094' };

// ================================================================ 模型
export class ParkModel {
  constructor(d, scene, renderer, opt = {}) {
    this.d = d;
    this.scene = scene;
    this.renderer = renderer;
    this.mobile = !!opt.mobile;
    this.labels = [];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.portBy = Object.fromEntries(d.ports.map((p) => [p.key, p]));
    this.portIx = d.ports.map((p) => p.key);
    this.nightMats = [];   // 夜に光るもの [material, 昼の強さ, 夜の強さ]
    this.noReflect = [];   // 水面の映り込みには描かない細かいもの（軽くするため）
    this.pathIdx = new SegIndex(8);
    const N = d.nodes, E = d.edges;
    for (let i = 0; i < E.length; i += 3) {
      const a = E[i], b = E[i + 1];
      if (N[a * 3 + 1] > 0.3 || N[b * 3 + 1] > 0.3) continue;
      // 広場の見通し線は長いので、削るのは通路の線だけ
      if (d.cost[i / 3] === 1 && d.ename[i / 3] === 0 && Math.hypot(N[a * 3] - N[b * 3], N[a * 3 + 2] - N[b * 3 + 2]) > 6) continue;
      this.pathIdx.add(N[a * 3], N[a * 3 + 2], N[b * 3], N[b * 3 + 2]);
    }
    this.tex = {
      stone: T.pavingTex('stone'), brick: T.pavingTex('brick'), cobble: T.pavingTex('cobble'), dirt: T.pavingTex('dirt'),
      grass: T.grassTex(), soil: T.soilTex(), sand: T.sandTex(), asphalt: T.asphaltTex(), rock: T.rockTex(),
    };
    this.facades = {};
    for (const s of T.FACADE_STYLES) this.facades[s] = T.facadeTex(s);
    this.buildGround();
    this.buildWater();
    this.buildRocks();
    this.buildBuildings();
    this.buildContext();
    this.buildRibbons();
    this.buildLines();
    this.buildTrees();
    this.buildLamps();
    // 映り込みの描画では、木・街灯・柵などの細かいものを省く
    const w = this.water, orig = w.onBeforeRender;
    w.onBeforeRender = (...args) => {
      for (const o of this.noReflect) o.visible = false;
      orig.apply(w, args);
      for (const o of this.noReflect) o.visible = true;
    };
    const lm = buildLandmarks(this);
    this.landmarks = lm;
    for (const L of d.portLabels) {
      if (L.k === 'EN') continue;
      this.labels.push({ text: L.n, sub: L.en, pos: new THREE.Vector3(L.x, 26, L.z), cls: 'port', color: L.c });
    }
  }

  mat(o) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o)); }
  mesh(geo, mat, { cast = true, receive = true, order = 0 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive; m.renderOrder = order;
    m.matrixAutoUpdate = false;
    this.root.add(m);
    return m;
  }
  portAt(x, z) {
    // いちばん近い歩行グラフの点のエリア
    if (!this._pg) {
      this._pg = new Map();
      const N = this.d.nodes;
      for (let i = 0; i < N.length / 3; i++) {
        const k = Math.floor(N[i * 3] / 25) * 100003 + Math.floor(N[i * 3 + 2] / 25);
        if (!this._pg.has(k)) this._pg.set(k, []);
        this._pg.get(k).push(i);
      }
    }
    const N = this.d.nodes, cx = Math.floor(x / 25), cz = Math.floor(z / 25);
    let best = -1, bd = 1e18;
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
        for (const i of this._pg.get(gx * 100003 + gz) || []) { const dd = (N[i * 3] - x) ** 2 + (N[i * 3 + 2] - z) ** 2; if (dd < bd) { bd = dd; best = i; } }
      }
    }
    if (best >= 0) return this.portIx[this.d.nodePort[best]];
    const L = this.d.portLabels;
    let bl = null; bd = 1e18;
    for (const p of L) { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < bd) { bd = dd; bl = p; } }
    return bl?.k || 'MH';
  }

  // ---------------------------------------------------------------- 地面
  buildGround() {
    const d = this.d, G = d.ground;
    const park = ring(d.park);
    // 園の外（周りの街）: 少し暗い平らな地面
    const outMat = this.mat({ color: 0x8a867c, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    this.applyStencilTest(outMat);
    const out = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), outMat);
    out.receiveShadow = true;
    out.renderOrder = 0;
    this.root.add(out);
    this.outside = out;
    // 園の地面（水面のところは描かない: ステンシルで抜く）
    const baseTex = this.tex.asphalt.clone(); baseTex.needsUpdate = true; baseTex.repeat.set(1 / 3, 1 / 3);
    const baseMat = this.mat({ map: this.tex.asphalt, color: 0xd8cfbf, roughness: 0.95 });
    const bg = flatGeo(park, [], 0, 1 / 3);
    this.applyStencilTest(baseMat);
    this.ground = this.mesh(bg, baseMat, { cast: false });
    this.ground.renderOrder = 1;
    const layers = [
      ['lot', this.tex.asphalt, 0.012, 1 / 3, () => col('#9c978e')],
      ['sand', this.tex.sand, 0.02, 1 / 3, () => col('#ead6a6')],
      ['green', this.tex.grass, 0.024, 1 / 5, () => col('#ffffff')],
      ['wood', this.tex.soil, 0.028, 1 / 5, () => col('#ffffff')],
      ['plaza', null, 0.034, 1 / 4, (a) => col(PAL[this.portBy[this.portAt(...centroid(ring(a.o)))]?.style || 'med'].plaza)],
    ];
    let lvl = 1;
    for (const [k, tex, y, uv, cf] of layers) {
      lvl++;
      if (k === 'plaza') {
        // 広場はエリアの舗装に合わせて敷き方を変える
        const byKind = {};
        for (const a of G.plaza) {
          const c = centroid(ring(a.o));
          const st = PAL[this.portBy[this.portAt(...c)]?.style || 'med'];
          (byKind[st.paving] ||= []).push(colorize(flatGeo(ring(a.o), (a.h || []).map(ring), y, 1 / 3), col(st.plaza)));
        }
        for (const [pk, gs] of Object.entries(byKind)) {
          const m = this.mat({ map: this.tex[pk], vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -lvl, polygonOffsetUnits: -lvl });
          this.mesh(mergeGeometries(gs), m, { cast: false, order: lvl });
        }
        continue;
      }
      const gs = (G[k] || []).map((a) => colorize(flatGeo(ring(a.o), (a.h || []).map(ring), y, uv), cf(a)));
      if (!gs.length) continue;
      const m = this.mat({ map: tex, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -lvl, polygonOffsetUnits: -lvl });
      this.mesh(mergeGeometries(gs), m, { cast: false, order: lvl });
    }
  }

  // ---------------------------------------------------------------- 水面
  // 水面は地面より 0.6m 低い。地面の板は、水面の形をステンシルに書いてその部分を抜く
  applyStencilTest(m) {
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilFunc = THREE.NotEqualStencilFunc;
    m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
  }
  buildWater() {
    const d = this.d;
    const gs = [], mask = [], quay = new Acc();
    const qc = col('#9b9282');
    const addQuay = (r) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        // 水面の側（内向き）を表に
        const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
        quay.quad([a[0], 0.02, a[1]], [b[0], 0.02, b[1]], [b[0], WATER_Y - 1.2, b[1]], [a[0], WATER_Y - 1.2, a[1]], [-nx, 0, -nz],
          [0, 0], [L / 3, 0], [L / 3, 0.5], [0, 0.5], qc);
      }
    };
    for (const a of d.ground.water) {
      const o = ring(a.o), hs = (a.h || []).map(ring);
      gs.push(flatGeo(o, hs, WATER_Y, 1 / 30));
      mask.push(flatGeo(o, hs, 0.0, 1));
      addQuay(o);
      for (const h of hs) addQuay(h.slice().reverse());
    }
    // 海（東京湾）
    if (d.sea) {
      let sea = ring(d.sea);
      if (ringArea(sea) < 0) sea = sea.reverse();
      gs.push(flatGeo(sea, [], WATER_Y, 1 / 30));
      mask.push(flatGeo(sea, [], 0, 1));
    }
    // 運河（線で描かれた水路）
    for (const c of d.lines.canal || []) {
      const pts = ring(c.p), w = (c.w || 5) / 2;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / L) * w, nz = ((bx - ax) / L) * w;
        const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
        if (ringArea(q) < 0) q.reverse();
        gs.push(flatGeo(q, [], WATER_Y, 1 / 30));
        mask.push(flatGeo(q, [], 0, 1));
      }
    }
    const strip = (g) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; };
    // 水底（暗い色）。反射の水面が半透明なので、底の色が少し見える
    const geo = mergeGeometries(gs);
    const bed = new THREE.Mesh(geo.clone().translate(0, -1.4, 0), new THREE.MeshBasicMaterial({ color: 0x1d3b44 }));
    this.root.add(bed);
    // 水面
    const normals = T.waterNormals();
    const water = new Water(geo, {
      textureWidth: this.mobile ? 512 : 1024, textureHeight: this.mobile ? 512 : 1024,
      waterNormals: normals, sunDirection: new THREE.Vector3(-0.55, 0.62, 0.56).normalize(), sunColor: 0x34342e,
      waterColor: 0x0f6478, distortionScale: 0.9, fog: true, alpha: 1,
    });
    water.material.uniforms.size.value = 8.0;
    // 映り込みを少し弱め、水の色を濃く（明るい空がそのまま白く映りすぎないように）
    water.material.fragmentShader = water.material.fragmentShader
      .replace('( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight )', '( waterColor * 0.5 + reflectionSample * 0.5 + reflectionSample * specularLight * 0.6 )')
      .replace('float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );', 'float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 ) * 0.75;');
    water.receiveShadow = false;
    water.renderOrder = 0;
    this.root.add(water);
    this.water = water;
    // 地面を抜く型（色は書かない）
    const mk = new THREE.Mesh(mergeGeometries(mask.map(strip)), new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
    mk.renderOrder = -10;
    this.root.add(mk);
    this.mask = mk;
    // 岸壁
    this.mesh(quay.geo(), this.mat({ map: this.tex.stone, vertexColors: true, roughness: 0.95 }), { cast: false });
  }

  // ---------------------------------------------------------------- 岩（ロックワーク）
  buildRocks() {
    const acc = new Acc();
    const d = this.d;
    for (const a of d.ground.rock) {
      const o = ring(a.o), hs = (a.h || []).map(ring);
      const A = Math.abs(ringArea(o));
      if (A < 3) continue;
      const [cx, cz] = centroid(o);
      const port = this.portAt(cx, cz);
      const base = col(ROCK[port] || '#9a9088');
      const seed = (cx * 13.1 + cz * 7.7);
      const hmax = Math.min(14, 2.2 + Math.sqrt(A) * 0.35) * (0.7 + 0.6 * hash2(Math.round(cx), Math.round(cz)));
      const cell = A < 200 ? 1.2 : A < 2000 ? 1.8 : 2.5;
      const hfn = (x, z) => {
        const de = Math.min(distToRing(x, z, o), ...hs.map((h) => distToRing(x, z, h)));
        let h = Math.min(hmax, de * 1.6 + 0.6) * (0.65 + 0.7 * fbm(x * 0.12 + seed, z * 0.12));
        const dp = this.pathIdx.dist(x, z);
        if (dp < 4) h = Math.min(h, Math.max(0, (dp - 1.6) * 1.4));
        return h;
      };
      const colfn = (x, z, h, ny) => {
        const k = 0.8 + 0.3 * fbm(x * 0.3, z * 0.3, 2) + h * 0.012;
        const c = base.clone().multiplyScalar(k);
        if (ny > 0.85 && h < 3 && fbm(x * 0.2 + 5, z * 0.2) > 0.55) c.lerp(col('#5d7040'), 0.6); // 平らな所に草
        return c;
      };
      const part = heightfield(o, hs, cell, hfn, colfn, -0.3);
      acc.p.push(...part.p); acc.n.push(...part.n); acc.u.push(...part.u); acc.c.push(...part.c);
    }
    if (!acc.count) return;
    this.mesh(acc.geo(), this.mat({ map: this.tex.rock, vertexColors: true, roughness: 0.97, flatShading: true }));
  }

  // ---------------------------------------------------------------- 建物
  buildBuildings() {
    const d = this.d;
    const walls = {}, roofs = new Acc(), trims = new Acc(), flats = new Acc(), rockWalls = new Acc();
    const GH = 4.2, FH = 3.6, BAY = 4.0;
    const rnd = T.rng(99);
    this.buildingLabels = [];
    for (const b of d.buildings) {
      if (b.lm) continue;                    // ランドマークは専用の形で作る
      let r = ring(b.r);
      if (ringArea(r) < 0) r = r.reverse();
      const A = ringArea(r);
      const style = b.big ? 'plain' : b.s;
      const pal = PAL[b.s] || PAL.med;
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const wallC = b.big ? col('#b9ad98').multiplyScalar(0.9 + rnd() * 0.1) : col(pick(pal.walls));
      const roofC = col(pick(pal.roof));
      const trimC = col(pal.trim);
      const h = b.h, mh = b.mh || 0;
      // ---- 屋根だけ（ひさし・アーケード）
      if (b.roof) {
        const top = flatGeo(r, [], h, 1 / 3);
        roofs.add(top, new THREE.Matrix4(), roofC);
        const bot = flatGeo(r.slice().reverse(), [], h - 0.35, 1 / 3);
        bot.scale(1, 1, 1);
        // 下面は裏向きなので向きを反転
        const ix = bot.index;
        if (ix) for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
        const nn = bot.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, -1, 0);
        trims.add(bot, new THREE.Matrix4(), trimC);
        this.extrude(trims, r, h - 0.35, h, () => trimC, null);
        // 柱
        for (let i = 0; i < r.length; i++) {
          const [x, z] = r[i];
          const g = new THREE.CylinderGeometry(0.14, 0.16, h - 0.35, 6).translate(x, (h - 0.35) / 2, z);
          trims.add(g, new THREE.Matrix4(), trimC);
        }
        continue;
      }
      // ---- 壁（1 階 + 上の階。テクスチャは 1 スパン 4m）
      // 奥の大きな建物は、通路に面した辺だけ街並みの壁（ほかは窓のないパネル）
      const accThemed = (walls[b.s] ||= new Acc()), accPlain = (walls.plain ||= new Acc());
      const ups = Math.max(0, Math.round((h - GH) / FH));
      const bands = [];
      if (h < GH + 1.6 || ups === 0) bands.push([mh, h, 0, 0.5]);
      else {
        bands.push([mh, GH, 0, 0.5]);
        const fh = (h - GH) / ups;
        for (let k = 0; k < ups; k++) bands.push([GH + k * fh, GH + (k + 1) * fh, 0.5, 1]);
      }
      const plainBands = [[mh, h, 0, h / 16]];
      for (let i = 0; i < r.length; i++) {
        const a = r[i], bq = r[(i + 1) % r.length];
        const L = Math.hypot(bq[0] - a[0], bq[1] - a[1]);
        if (L < 0.05) continue;
        const nx = (bq[1] - a[1]) / L, nz = -(bq[0] - a[0]) / L;
        let plain = style === 'plain';
        if (plain) {
          // 辺の外側 4m の点が通路から 9m 以内なら、街並みの壁にする
          let near = 0;
          for (const t of [0.2, 0.5, 0.8]) if (this.pathIdx.dist(a[0] + (bq[0] - a[0]) * t + nx * 4, a[1] + (bq[1] - a[1]) * t + nz * 4) < 9) near++;
          plain = near < 2;
        }
        // 自然のエリア（ファンタジースプリングス・ロストリバー・ミステリアスアイランド）の大きな建物は、通路側を岩山に見せる
        if (!plain && b.big && (b.s === 'fs' || b.s === 'lrd' || b.s === 'mi')) {
          const rc = col(ROCK[b.p] || '#9a9088');
          const n = Math.max(1, Math.round(L / 3.5));
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n;
            const ax = a[0] + (bq[0] - a[0]) * t0, az = a[1] + (bq[1] - a[1]) * t0, bx = a[0] + (bq[0] - a[0]) * t1, bz = a[1] + (bq[1] - a[1]) * t1;
            const ha = h * (0.78 + 0.22 * hash2(Math.round(ax * 3), Math.round(az * 3))), hb = h * (0.78 + 0.22 * hash2(Math.round(bx * 3), Math.round(bz * 3)));
            const jo = (x, z) => (hash2(Math.round(x * 7), Math.round(z * 7)) - 0.5) * 1.6;
            rockWalls.quad([ax, mh, az], [bx, mh, bz], [bx + nx * jo(bx, bz), hb, bz + nz * jo(bx, bz)], [ax + nx * jo(ax, az), ha, az + nz * jo(ax, az)], [nx, 0, nz],
              [t0 * L / 6, 0], [t1 * L / 6, 0], [t1 * L / 6, hb / 6], [t0 * L / 6, ha / 6], rc.clone().multiplyScalar(0.85 + 0.3 * hash2(k, Math.round(ax))));
          }
          continue;
        }
        const acc = plain ? accPlain : accThemed;
        const C = plain ? wallC : (b.big ? col(pick(pal.walls)) : wallC);
        // スパンの数を整数にして、窓が辺の途中で切れないように
        const nb = plain ? L / 8 : Math.max(1, Math.round(L / BAY));
        const u0 = 0, u1 = L < 2.2 && !plain ? 0.35 : nb;
        for (const [y0, y1, v0, v1] of plain ? plainBands : bands) {
          acc.quad([a[0], y0, a[1]], [bq[0], y0, bq[1]], [bq[0], y1, bq[1]], [a[0], y1, a[1]], [nx, 0, nz],
            [u0, v0], [u1, v0], [u1, v1], [u0, v1], C);
        }
      }
      // ---- 屋根
      const o = obb(r, b.a || 0);
      const rect = A / Math.max(1, o.L * o.W);
      const short = Math.min(o.L, o.W);
      const kind = b.big ? 'flat' : pal.roofKind;
      const pitched = (kind === 'hip' || kind === 'gable') && rect > 0.78 && short < 30 && short > 3 && r.length <= 12;
      // 軒の飾り（コーニス）
      const cor = offsetRing(r, b.big ? 0.15 : 0.32);
      const corY = h;
      if (!b.big) this.cornice(trims, r, cor, corY - 0.25, corY + 0.18, trimC);
      if (pitched) {
        this.pitchedRoof(roofs, trims, o, h + 0.18, kind, pal.pitch, roofC, wallC);
      } else if ((kind === 'hip' || kind === 'gable') && !b.big && A > 30) {
        // 形が複雑な建物: 縁を斜めに上げた屋根（寄棟に見える）
        const inset = Math.min(3.2, Math.max(0.8, short * 0.22));
        const inner = offsetRing(cor, -inset);
        const rise = inset * pal.pitch * (kind === 'gable' ? 0.8 : 1);
        if (ringArea(inner) > ringArea(cor) * 0.15) {
          const y0 = corY + 0.18, y1 = y0 + rise;
          for (let i = 0; i < cor.length; i++) {
            const a = cor[i], bq = cor[(i + 1) % cor.length], ia = inner[i], ib = inner[(i + 1) % cor.length];
            const P = [[a[0], y0, a[1]], [bq[0], y0, bq[1]], [ib[0], y1, ib[1]], [ia[0], y1, ia[1]]];
            const uvs = (p) => [p[0] / 3, p[2] / 3 + p[1] / 3];
            for (const [p0, p1, p2] of [[P[0], P[1], P[2]], [P[0], P[2], P[3]]]) {
              const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
              let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
              if (n[1] < 0) n = n.map((v) => -v);
              const L = Math.hypot(...n) || 1;
              roofs.tri(p0, p1, p2, n.map((v) => v / L), uvs(p0), uvs(p1), uvs(p2), roofC);
            }
          }
          roofs.add(flatGeo(inner, [], y1, 1 / 3), new THREE.Matrix4(), roofC.clone().multiplyScalar(0.92));
        } else {
          roofs.add(flatGeo(cor, [], corY + 0.2, 1 / 3), new THREE.Matrix4(), roofC);
        }
      } else {
        // 平らな屋根: 低い手すり壁（パラペット）
        const par = b.big ? 0.6 : h < 7 ? 0.35 : 0.9;
        this.extrude(trims, cor, corY + 0.18, corY + par, () => (b.big ? wallC : trimC), null);
        const cap = flatGeo(cor, [], corY + par - 0.25, 1 / 4);
        flats.add(cap, new THREE.Matrix4(), b.big ? ((b.s === 'fs' || b.s === 'lrd' || b.s === 'mi') ? col('#5d7448') : col('#c4beb2')) : roofC.clone().lerp(col('#c8c4ba'), 0.55));
        // アラビアンコースト: 中くらいの建物の一部にドーム
        if (b.s === 'arab' && !b.big && A > 50 && A < 1500 && rnd() < 0.45) {
          const rad = Math.min(short * 0.32, 7);
          const [cx, cz] = o.cx;
          const dome = new THREE.SphereGeometry(rad, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
          const drum = new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, rad * 0.4, 20, 1, true);
          const dc = col(rnd() < 0.5 ? '#d8a840' : (rnd() < 0.5 ? '#3f8f9a' : '#f6efe0'));
          roofs.add(drum, new THREE.Matrix4().makeTranslation(cx, corY + par + rad * 0.2, cz), col('#f4ead6'));
          roofs.add(dome, new THREE.Matrix4().makeTranslation(cx, corY + par + rad * 0.4, cz), dc);
          const tip = new THREE.ConeGeometry(rad * 0.08, rad * 0.6, 6);
          roofs.add(tip, new THREE.Matrix4().makeTranslation(cx, corY + par + rad * 1.65, cz), col('#d8a840'));
        }
        // 屋上の設備（大きな建物）
        if (b.big && A > 3000) {
          const n = Math.min(8, Math.floor(A / 2500));
          for (let k = 0; k < n; k++) {
            const [cx, cz] = o.P(o.u0 + o.L * (0.2 + 0.6 * rnd()), o.v0 + o.W * (0.2 + 0.6 * rnd()));
            const box = new THREE.BoxGeometry(3 + rnd() * 4, 1.6, 2 + rnd() * 3);
            flats.add(box, new THREE.Matrix4().makeRotationY(-(b.a || 0)).setPosition(cx, corY + par + 0.5, cz), col('#b8b4ac'));
          }
        }
      }
      if (b.n && A > 120 && !b.big) {
        const [cx, cz] = centroid(r);
        this.buildingLabels.push({ text: b.n, pos: new THREE.Vector3(cx, h + 3, cz) });
      }
    }
    // メッシュにまとめる
    this.wallMats = {};
    for (const [st, acc] of Object.entries(walls)) {
      const F = this.facades[st];
      const m = this.mat({ map: F.map, vertexColors: true, roughness: 0.88, side: THREE.DoubleSide, emissiveMap: F.emissive, emissive: 0x000000 });
      this.wallMats[st] = m;
      this.nightMats.push([m, 'emissive', st === 'plain' ? 0 : 1]);
      this.mesh(acc.geo(), m);
    }
    if (rockWalls.count) this.mesh(rockWalls.geo(), this.mat({ map: this.tex.rock, vertexColors: true, roughness: 0.97, flatShading: true, side: THREE.DoubleSide }));
    const roofTex = this.roofTex();
    this.mesh(roofs.geo(), this.mat({ map: roofTex, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
    this.mesh(trims.geo(), this.mat({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    this.mesh(flats.geo(), this.mat({ map: this.tex.asphalt, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  }
  // 側面だけの帯（壁・手すり壁）
  extrude(acc, r, y0, y1, cf, uvf) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.02) continue;
      const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
      acc.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz], [0, 0], [L / 3, 0], [L / 3, (y1 - y0) / 3], [0, (y1 - y0) / 3], cf(i));
    }
  }
  // 軒の飾り: 外へ張り出した帯（上・下・前の面）
  cornice(acc, r, ro, y0, y1, c) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], A = ro[i], B = ro[(i + 1) % r.length];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.02) continue;
      const nx = (B[1] - A[1]) / L, nz = -(B[0] - A[0]) / L;
      acc.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [nx, 0, nz], [0, 0], [1, 0], [1, 1], [0, 1], c);
      acc.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [B[0], y0, B[1]], [A[0], y0, A[1]], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], c.clone().multiplyScalar(0.8));
    }
  }
  // 寄棟（hip）・切妻（gable）の屋根
  pitchedRoof(roofs, trims, o, y, kind, pitch, rc, wc) {
    const ov = 0.45;
    let { u0, u1, v0, v1 } = o;
    u0 -= ov; u1 += ov; v0 -= ov; v1 += ov;
    const alongU = (u1 - u0) >= (v1 - v0);
    const half = alongU ? (v1 - v0) / 2 : (u1 - u0) / 2;
    const rh = half * pitch;
    const P = (u, v, yy) => { const [x, z] = o.P(u, v); return [x, yy, z]; };
    const uvs = (p) => [p[0] / 3, p[2] / 3 + p[1] / 3];
    // 屋根の面はどれも上向きが表（法線は面から計算）
    const face = (pts) => {
      const t = (a, b, c) => {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (n[1] < 0) n = n.map((v) => -v);
        const L = Math.hypot(...n) || 1;
        roofs.tri(a, b, c, n.map((v) => v / L), uvs(a), uvs(b), uvs(c), rc);
      };
      t(pts[0], pts[1], pts[2]);
      if (pts.length === 4) t(pts[0], pts[2], pts[3]);
    };
    if (alongU) {
      const vm = (v0 + v1) / 2;
      const ins = kind === 'hip' ? Math.min(half, (u1 - u0) / 2 - 0.1) : 0;
      const r0 = P(u0 + ins, vm, y + rh), r1 = P(u1 - ins, vm, y + rh);
      const c0 = P(u0, v0, y), c1 = P(u1, v0, y), c2 = P(u1, v1, y), c3 = P(u0, v1, y);
      face([c0, c1, r1, r0]); face([c2, c3, r0, r1]);
      if (kind === 'hip') { face([c3, c0, r0]); face([c1, c2, r1]); }
      else this.gableEnds(trims, [c3, c0, r0], [c1, c2, r1], wc);
    } else {
      const um = (u0 + u1) / 2;
      const ins = kind === 'hip' ? Math.min(half, (v1 - v0) / 2 - 0.1) : 0;
      const r0 = P(um, v0 + ins, y + rh), r1 = P(um, v1 - ins, y + rh);
      const c0 = P(u0, v0, y), c1 = P(u1, v0, y), c2 = P(u1, v1, y), c3 = P(u0, v1, y);
      face([c1, c2, r1, r0]); face([c3, c0, r0, r1]);
      if (kind === 'hip') { face([c0, c1, r0]); face([c2, c3, r1]); }
      else this.gableEnds(trims, [c0, c1, r0], [c2, c3, r1], wc);
    }
  }
  gableEnds(trims, t1, t2, wc) {
    // 妻壁（三角の壁）は少し内側に
    for (const t of [t1, t2]) trims.tri(t[0], t[1], t[2], null, [0, 0], [1, 0], [0.5, 1], wc);
  }
  roofTex() {
    // 瓦・スレート（横の段）
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const r = T.rng(41);
    g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      const off = (y / 16) % 2 ? 10 : 0;
      for (let x = -20; x < 256; x += 20) {
        const v = 200 + (r() - 0.5) * 50;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath(); g.ellipse(x + off + 10, y + 10, 10, 9, 0, 0, Math.PI); g.fill();
        g.fillRect(x + off + 1, y, 18, 10);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + 14, 256, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }

  // ---------------------------------------------------------------- 園の外の建物（控えめな色の箱）
  buildContext() {
    const acc = new Acc(), top = new Acc();
    const c = col('#b4ada2'), ct = col('#9c968c');
    for (const b of this.d.context || []) {
      let r = ring(b.r);
      if (ringArea(r) < 0) r = r.reverse();
      this.extrude(acc, r, 0, b.h, () => c, null);
      top.add(flatGeo(r, [], b.h, 1 / 4), new THREE.Matrix4(), ct);
    }
    if (!acc.count) return;
    const m = this.mat({ vertexColors: true, roughness: 0.95 });
    const g1 = this.mesh(acc.geo(), m, { cast: false });
    const g2 = this.mesh(top.geo(), m, { cast: false });
    this.noReflect.push(g1, g2);
  }

  // ---------------------------------------------------------------- 通路（線）・橋
  buildRibbons() {
    const acc = new Acc(), deck = new Acc(), rail = new Acc();
    const stair = col('#c4bcae'), brC = col('#c9b9a0'), railC = col('#5a5048');
    for (const rb of this.d.ribbons) {
      const pts = ring(rb.p), w = rb.w / 2;
      if (pts.length < 2) continue;
      const mid = pts[Math.floor(pts.length / 2)];
      const gray = col(PAL[this.portBy[this.portAt(mid[0], mid[1])]?.style || 'med'].plaza).lerp(col('#e2dccf'), 0.45);
      const bridge = rb.k === 2;
      // 橋はゆるいアーチ
      let tot = 0; const S = [0];
      for (let i = 1; i < pts.length; i++) { tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); S.push(tot); }
      const hmax = bridge ? Math.min(2.4, 0.07 * tot) : 0;
      const Y = (s) => (bridge ? hmax * Math.sin(Math.PI * s / (tot || 1)) : 0) + 0.05;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const nx = (-(bz - az) / L) * w, nz = ((bx - ax) / L) * w;
        const ya = Y(S[i]), yb = Y(S[i + 1]);
        const tgt = bridge ? deck : acc;
        const c = rb.k === 1 ? stair : bridge ? brC : gray;
        tgt.quad([ax + nx, ya, az + nz], [bx + nx, yb, bz + nz], [bx - nx, yb, bz - nz], [ax - nx, ya, az - nz], [0, 1, 0],
          [S[i] / 4, 0], [S[i + 1] / 4, 0], [S[i + 1] / 4, rb.w / 4], [S[i] / 4, rb.w / 4], c);
        if (bridge) {
          // 側面と欄干
          for (const sgn of [1, -1]) {
            const px = sgn * nx, pz = sgn * nz;
            deck.quad([ax + px, ya, az + pz], [bx + px, yb, bz + pz], [bx + px, yb - 0.6, bz + pz], [ax + px, ya - 0.6, az + pz], [sgn * nx / w, 0, sgn * nz / w], [0, 0], [L / 3, 0], [L / 3, 0.2], [0, 0.2], brC);
            rail.quad([ax + px, ya, az + pz], [bx + px, yb, bz + pz], [bx + px, yb + 1.0, bz + pz], [ax + px, ya + 1.0, az + pz], [sgn * nx / w, 0, sgn * nz / w], [0, 0], [L, 0], [L, 1], [0, 1], railC);
          }
        }
      }
    }
    const m = this.mat({ map: this.tex.stone, vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.noReflect.push(this.mesh(acc.geo(), m, { cast: false, order: 8 }));
    this.mesh(deck.geo(), this.mat({ map: this.tex.stone, vertexColors: true, roughness: 0.9 }));
    const rm = this.mat({ map: this.railTex(), vertexColors: true, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 });
    this.mesh(rail.geo(), rm);
  }
  railTex() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 6); g.fillRect(0, 58, 64, 6);
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---------------------------------------------------------------- 塀・柵・生け垣・高架の線路
  buildLines() {
    const L = this.d.lines;
    const wall = new Acc(), hedge = new Acc(), fence = new Acc(), track = new Acc();
    const box = (acc, pts, w, y0, y1, c) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const g = new THREE.BoxGeometry(len + w * 0.6, y1 - y0, w);
        const m = new THREE.Matrix4().makeRotationY(-Math.atan2(bz - az, bx - ax)).setPosition((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
        acc.add(g, m, c, 1 / 3);
      }
    };
    for (const p of L.wall || []) box(wall, ring(p), 0.45, 0, 1.4, col('#c8bca8'));
    for (const p of L.hedge || []) box(hedge, ring(p), 0.9, 0, 1.2, col('#4f7a3a'));
    for (const p of L.fence || []) box(fence, ring(p), 0.06, 0, 1.1, col('#3c3a36'));
    // ディズニーシー・エレクトリックレールウェイ（高架）
    for (const r of L.rail || []) {
      const pts = ring(r.p), y = r.y || 0;
      if (y < 1) continue;
      box(track, pts, 3.0, y - 0.9, y, col('#d8cfbd'));
      for (const s of [-0.55, 0.55]) {
        const off = pts.map(([x, z], i) => {
          const q = pts[Math.min(pts.length - 1, i + 1)], p0 = pts[Math.max(0, i - 1)];
          const dx = q[0] - p0[0], dz = q[1] - p0[1], l = Math.hypot(dx, dz) || 1;
          return [x - (dz / l) * s, z + (dx / l) * s];
        });
        box(track, off, 0.1, y, y + 0.15, col('#4a4440'));
      }
      // 橋脚
      let acc = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let s = (14 - acc) % 14; s < len; s += 14) {
          const t = s / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          const g = new THREE.CylinderGeometry(0.45, 0.6, y - 0.9, 10);
          track.add(g, new THREE.Matrix4().makeTranslation(x, (y - 0.9) / 2, z), col('#cfc6b4'));
        }
        acc = (acc + len) % 14;
      }
    }
    if (wall.count) this.mesh(wall.geo(), this.mat({ map: this.tex.stone, vertexColors: true }));
    if (hedge.count) this.mesh(hedge.geo(), this.mat({ map: this.tex.soil, vertexColors: true, roughness: 1 }));
    if (fence.count) this.noReflect.push(this.mesh(fence.geo(), this.mat({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), { cast: false }));
    if (track.count) this.mesh(track.geo(), this.mat({ map: this.tex.stone, vertexColors: true, roughness: 0.85 }));
  }

  // ---------------------------------------------------------------- 木（エリアに合わせた種類。インスタンス描画）
  buildTrees() {
    const mixes = {
      MH: { cypress: 0.4, broad: 0.3, palm: 0.2, pine: 0.1 }, EN: { broad: 0.45, palm: 0.25, cypress: 0.2, pine: 0.1 },
      AW: { broad: 0.8, conifer: 0.2 }, CC: { conifer: 0.55, broad: 0.45 }, PD: { palm: 0.5, broad: 0.5 },
      LR: { palm: 0.45, jungle: 0.55 }, AC: { palm: 0.85, broad: 0.15 }, ML: { palm: 0.6, broad: 0.4 },
      MI: { conifer: 0.45, broad: 0.55 }, FS: { conifer: 0.65, broad: 0.35 },
    };
    const kinds = { palm: [], broad: [], conifer: [], cypress: [], pine: [], jungle: [] };
    const r = T.rng(77);
    const portKeys = this.d.ports.map((p) => p.key);
    for (const t of this.d.trees) {
      const [x, z, s, port] = t;
      const mix = mixes[port] || mixes.MH;
      let u = r(), k = 'broad';
      for (const [kk, w] of Object.entries(mix)) { if ((u -= w) <= 0) { k = kk; break; } }
      kinds[k].push([x, z, s * (0.85 + r() * 0.4), r() * Math.PI * 2]);
    }
    const leafMat = this.mat({ vertexColors: true, roughness: 0.85, flatShading: true });
    leafMat.onBeforeCompile = (sh) => {
      // 葉は光を少し通す（逆光で真っ黒にならないように）
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.18;');
    };
    const barkMat = this.mat({ color: 0x6a5240, roughness: 1 });
    const make = (list, trunkGeo, leafGeo, leafCol, jitter = 0.12) => {
      if (!list.length) return;
      const tm = new THREE.InstancedMesh(trunkGeo, barkMat, list.length);
      const lm = new THREE.InstancedMesh(leafGeo, leafMat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      const c = new THREE.Color();
      list.forEach(([x, z, s, a], i) => {
        q.setFromAxisAngle(UP, a);
        sc.set(s, s * (0.9 + 0.2 * ((i * 7919) % 13) / 13), s);
        p.set(x, 0, z);
        m.compose(p, q, sc);
        tm.setMatrixAt(i, m); lm.setMatrixAt(i, m);
        c.set(leafCol).offsetHSL((((i * 31) % 17) / 17 - 0.5) * 0.04, 0, (((i * 13) % 11) / 11 - 0.5) * jitter * 2);
        lm.setColorAt(i, c);
      });
      for (const im of [tm, lm]) { im.castShadow = true; im.receiveShadow = true; this.root.add(im); this.noReflect.push(im); }
    };
    const DET = this.mobile ? 0 : 1;
    const blob = (rad, det, y, sx = 1, sy = 1) => {
      const g = new THREE.IcosahedronGeometry(rad, det);
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(P, i);
        const k = 1 + (hash2(Math.round(v.x * 10), Math.round(v.y * 10 + v.z * 7)) - 0.5) * 0.35;
        P.setXYZ(i, v.x * k * sx, v.y * k * sy + y, v.z * k * sx);
      }
      g.computeVertexNormals();
      return g;
    };
    const vc = (g, top = '#ffffff', bot = '#c8d0c0') => {
      const P = g.attributes.position;
      g.computeBoundingBox();
      const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
      const a = new Float32Array(P.count * 3), ct = col(top), cb = col(bot), c = new THREE.Color();
      for (let i = 0; i < P.count; i++) { c.copy(cb).lerp(ct, (P.getY(i) - y0) / (y1 - y0 || 1)); a.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    // 広葉樹（丸い葉のかたまり 3 つ）
    const broadLeaf = vc(mergeGeometries([blob(2.6, DET, 5.6), blob(2.0, DET, 4.6).translate(1.6, 0, 0.6), blob(1.9, DET, 4.9).translate(-1.3, 0.3, -1.0)]));
    make(kinds.broad, new THREE.CylinderGeometry(0.18, 0.28, 4.4, 6).translate(0, 2.2, 0), broadLeaf, '#679a44');
    make(kinds.jungle, new THREE.CylinderGeometry(0.2, 0.32, 5, 6).translate(0, 2.5, 0),
      vc(mergeGeometries([blob(3.2, DET, 6.2, 1.2, 0.7), blob(2.4, DET, 4.6, 1.2, 0.7).translate(1.8, 0, 1.0)])), '#4f8f3c');
    // 針葉樹
    const con = vc(mergeGeometries([new THREE.ConeGeometry(2.4, 4.2, 8).translate(0, 4.2, 0), new THREE.ConeGeometry(1.9, 3.6, 8).translate(0, 6.2, 0), new THREE.ConeGeometry(1.2, 3.0, 8).translate(0, 8.0, 0)]));
    make(kinds.conifer, new THREE.CylinderGeometry(0.15, 0.25, 3, 6).translate(0, 1.5, 0), con, '#3f6f42');
    // イトスギ（地中海の細長い木）
    const cyp = vc(blob(1.0, DET, 0, 1, 4.2).translate(0, 5.0, 0));
    make(kinds.cypress, new THREE.CylinderGeometry(0.12, 0.18, 1.6, 5).translate(0, 0.8, 0), cyp, '#456e3a');
    // カサマツ（傘のような松）
    make(kinds.pine, new THREE.CylinderGeometry(0.2, 0.3, 6.5, 6).translate(0, 3.25, 0), vc(blob(3.6, DET, 7.2, 1, 0.38)), '#55803f');
    // ヤシ
    const frond = [];
    for (let k = 0; k < 9; k++) {
      const g = new THREE.PlaneGeometry(0.9, 3.6, 1, 4).translate(0, 1.8, 0);
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setZ(i, -0.12 * y * y); P.setX(i, P.getX(i) * (1 - y / 4.2)); }
      g.rotateX(-Math.PI / 2 + 0.35);
      g.rotateY((k / 9) * Math.PI * 2);
      g.translate(0, 7.6, 0);
      frond.push(g);
    }
    const palmLeaf = vc(mergeGeometries(frond), '#ffffff', '#c8d0b8');
    const pt = new THREE.CylinderGeometry(0.16, 0.26, 7.8, 7, 4);
    { const P = pt.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i) + 3.9; P.setX(i, P.getX(i) + 0.012 * y * y); P.setY(i, y); } pt.computeVertexNormals(); }
    const palmMat = this.mat({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    if (kinds.palm.length) {
      const tm = new THREE.InstancedMesh(pt, barkMat, kinds.palm.length);
      const lm = new THREE.InstancedMesh(palmLeaf, palmMat, kinds.palm.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
      kinds.palm.forEach(([x, z, s, a], i) => {
        q.setFromAxisAngle(UP, a); sc.setScalar(s); p.set(x, 0, z); m.compose(p, q, sc);
        tm.setMatrixAt(i, m); lm.setMatrixAt(i, m);
        lm.setColorAt(i, c.set('#5d8a3a').offsetHSL(0, 0, (((i * 13) % 11) / 11 - 0.5) * 0.12));
      });
      for (const im of [tm, lm]) { im.castShadow = true; im.receiveShadow = true; this.root.add(im); this.noReflect.push(im); }
    }
  }

  // ---------------------------------------------------------------- 街灯（夜に光る）
  buildLamps() {
    const pts = [];
    const r = T.rng(5);
    for (const rb of this.d.ribbons) {
      if (rb.k !== 0 || rb.w < 3) continue;
      const P = ring(rb.p);
      let acc = r() * 20;
      for (let i = 0; i + 1 < P.length; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.1) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let s = 24 - acc; s < L; s += 24) {
          const t = s / L, side = pts.length % 2 ? 1 : -1, off = rb.w / 2 + 0.5;
          pts.push([ax + (bx - ax) * t + nx * off * side, az + (bz - az) * t + nz * off * side]);
        }
        acc = (acc + L) % 24;
      }
    }
    if (!pts.length) return;
    const pole = mergeGeometries([new THREE.CylinderGeometry(0.06, 0.1, 3.6, 6).translate(0, 1.8, 0), new THREE.CylinderGeometry(0.16, 0.12, 0.2, 8).translate(0, 3.6, 0)]);
    const head = new THREE.SphereGeometry(0.24, 10, 8).translate(0, 3.9, 0);
    const pm = new THREE.InstancedMesh(pole, this.mat({ color: 0x2c3a34, roughness: 0.5, metalness: 0.5 }), pts.length);
    const hm = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffc070, emissiveIntensity: 0.05, roughness: 0.3 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); pm.setMatrixAt(i, m); hm.setMatrixAt(i, m); });
    pm.castShadow = true;
    this.root.add(pm, hm);
    this.noReflect.push(pm, hm);
    this.nightMats.push([hm.material, 'lamp', 1]);
    this.lampPts = pts;
  }

  // ---------------------------------------------------------------- 昼と夜
  setNight(on) {
    for (const [m, kind] of this.nightMats) {
      if (kind === 'emissive') { m.emissive.set(on ? 0xffffff : 0x000000); m.emissiveIntensity = on ? 0.9 : 0; }
      else if (kind === 'lamp') m.emissiveIntensity = on ? 3.2 : 0.05;
      else if (kind === 'glow') m.emissiveIntensity = on ? 2.5 : 0.2;
    }
  }
}
