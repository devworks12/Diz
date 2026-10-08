// 東京ディズニーシー 3D園内マップ — 画面・カメラ・POV
import * as THREE from 'three';
import { MapNav } from './nav.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { ParkModel } from './model.js';
import { Graph } from './route.js';

const $ = (s) => document.querySelector(s);
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// ---------------------------------------------------------------- アプリらしい操作（ページ全体のズームを止める）
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', ';'].includes(e.key)) e.preventDefault(); });

const EYE = 1.6;
const SPEED = { 1: 3, 2: 7, 3: 14 }; // 実時間に対する再生倍率
const state = { from: null, to: null, speed: 2, routes: [], sel: 0, mode: 'plan', pov: null, night: false, cats: new Set(['entrance', 'attr', 'show', 'food', 'shop', 'toilet', 'service']) };

// ---------------------------------------------------------------- データ
let data;
try {
  const res = await fetch('data/park.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status);
  data = await res.json();
} catch (e) {
  $('#loadMsg').textContent = '園内データを読み込めませんでした（' + e.message + '）';
  throw e;
}
const graph = new Graph(data, (x, y, z) => new THREE.Vector3(x, y, z));
const poiBy = Object.fromEntries(data.pois.map((p) => [p.id, p]));
const portBy = Object.fromEntries(data.ports.map((p) => [p.key, p]));
const CATS = {
  entrance: { icon: '🚪', color: '#5f7896', label: '入口', short: '入口' },
  attr: { icon: '🎢', color: '#d9573a', label: 'アトラクション', short: 'アトラク' },
  show: { icon: '🎭', color: '#9a52c8', label: 'ショー・ステージ', short: 'ショー' },
  food: { icon: '🍴', color: '#2f9a5c', label: 'レストラン・フード', short: 'フード' },
  shop: { icon: '🛍', color: '#c74a86', label: 'ショップ', short: 'ショップ' },
  toilet: { icon: '🚻', color: '#2f6fd0', label: 'トイレ', short: 'トイレ' },
  service: { icon: 'ℹ', color: '#56677e', label: 'サービス', short: 'サービス' },
  here: { icon: '📍', color: '#e23d5a', label: '現在地', short: '現在地' },
};

// ---------------------------------------------------------------- three.js
const canvas = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 2 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);

// 空と太陽（午後、南西から）。空は天頂の青から地平線の白っぽい青へのグラデーション
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
function makeSky(top, mid, hor, sunGlow) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, hor: { value: new THREE.Color(hor) }, sunDir: { value: SUN_DIR }, glow: { value: sunGlow } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top, mid, hor; uniform vec3 sunDir; uniform float glow; varying vec3 vD;
      void main(){ float h = max(vD.y, 0.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        if (vD.y < 0.0) c = hor;
        float s = max(dot(normalize(vD), sunDir), 0.0);
        c += glow * (pow(s, 600.0) * 6.0 + pow(s, 24.0) * 0.35) * vec3(1.0, 0.9, 0.7);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
const sky = makeSky(0x2f6fc0, 0x7fb0e0, 0xdbe8f2, 1.0);
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const envDay = (() => { const s = new THREE.Scene(); s.add(makeSky(0x2f6fc0, 0x7fb0e0, 0xdbe8f2, 0.4)); s.add(new THREE.Mesh(new THREE.CircleGeometry(3000, 16).rotateX(-Math.PI / 2).translate(0, -20, 0), new THREE.MeshBasicMaterial({ color: 0x8a8070 }))); return pmrem.fromScene(s, 0.03).texture; })();
scene.environment = envDay;
scene.environmentIntensity = 0.7;
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a7a5a, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const FOG_DAY = new THREE.Color(0xdbe8f2), FOG_NIGHT = new THREE.Color(0x1c2a48);
scene.fog = new THREE.Fog(FOG_DAY, 900, 4200);

// 地図アプリと同じ操作（1本指=移動、2本指=拡大・回転、2本指上下=傾き）。詳しくは js/nav.js
let fly = null;
const controls = new MapNav(camera, canvas, {
  minDistance: 8, maxDistance: 2400, maxPolarAngle: Math.PI * 0.44,
  onStart: () => { fly = null; hideHint(); state.userMoved = true; hidePop(); },
});
const HOME_T = new THREE.Vector3(-60, 0, -10), HOME_P = new THREE.Vector3(260, 720, 860);
// 縦長の画面では引いて全体を入れる
if (innerWidth < innerHeight) HOME_P.sub(HOME_T).multiplyScalar(Math.min(1.9, 1.15 * innerHeight / innerWidth)).add(HOME_T);
controls.target.copy(HOME_T);
camera.position.copy(HOME_P);
{
  const P = data.park;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 1]); z1 = Math.max(z1, P[i + 1]); }
  controls.bounds = { xmin: x0 - 80, xmax: x1 + 80, zmin: z0 - 80, zmax: z1 + 80 };
}

// 後処理: MSAA ＋ ステンシル（水面の部分の地面を抜く）＋ 夜の光のにじみ
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples || 4), stencilBuffer: true });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.12, 0.4, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const hintEl = document.createElement('div');
hintEl.id = 'hint';
hintEl.innerHTML = MOBILE
  ? '<b>1本指</b>で移動　<b>2本指</b>で拡大・回転　<b>2本指で上下</b>に傾き'
  : '<b>ドラッグ</b>で移動　<b>右ドラッグ</b>で回転・傾き　<b>ホイール</b>で拡大';
document.body.appendChild(hintEl);
let hintTimer = setTimeout(hideHint, 7000);
function hideHint() { clearTimeout(hintTimer); hintEl.classList.add('off'); }

// ---------------------------------------------------------------- 模型
$('#loadMsg').textContent = '建物と木を配置しています';
await new Promise((r) => setTimeout(r, 30));
const model = new ParkModel(data, scene, renderer, { mobile: MOBILE });

// ---------------------------------------------------------------- ラベル・施設のピン
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const icon = (c, extra = '') => `<span class="ic${extra}" style="--c:${CATS[c]?.color || '#556'}"><span>${CATS[c]?.icon || ''}</span></span>`;
const labels = model.labels.map((L) => {
  const el = document.createElement('div');
  el.className = 'lbl ' + L.cls;
  el.innerHTML = esc(L.text) + (L.sub ? `<small>${esc(L.sub)}</small>` : '');
  if (L.color) el.style.setProperty('--c', L.color);
  el.style.display = 'none';
  document.body.appendChild(el);
  return { ...L, el, vis: false, w: L.text.length * (L.cls === 'port' ? 16 : 11) + 18, h: L.cls === 'port' ? 34 : 20 };
});
const pins = data.pois.map((p) => {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = icon(p.c) + `<span class="nm">${esc(p.n)}</span>`;
  el.style.display = 'none';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);
  const short = p.n.length > 14 ? p.n.slice(0, 13) + '…' : p.n;
  el.querySelector('.nm').textContent = p.c === 'toilet' ? 'トイレ' : short;
  return { p, el, pos: new THREE.Vector3(p.x, 1.5, p.z), vis: false, named: false, sx: 0, sy: 0, w: short.length * 10.5 + 30 };
});
// 現在地のピン
const herePin = (() => {
  const el = document.createElement('div');
  el.className = 'pin sel';
  el.innerHTML = icon('here') + '<span class="nm">現在地</span>';
  el.style.display = 'none';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);
  return { el, pos: new THREE.Vector3(), on: false };
})();
const PRIO = { entrance: 1, attr: 2, toilet: 3, show: 4, food: 5, shop: 6, service: 7 };
const SHOW_DIST = { entrance: 1000, attr: 760, show: 520, toilet: 640, food: 460, shop: 380, service: 340 };
const NAME_DIST = { entrance: 700, attr: 430, show: 240, toilet: 0, food: 210, shop: 170, service: 150 };
const _v = new THREE.Vector3();
function project(pos) {
  _v.copy(pos).project(camera);
  if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return null;
  return [((_v.x + 1) / 2) * innerWidth, ((1 - _v.y) / 2) * innerHeight];
}
function updateLabels() {
  const pov = state.mode === 'pov';
  const dist = camera.position.distanceTo(controls.target);
  const placed = [];
  const hit = (rc) => placed.some((q) => rc[0] < q[2] && rc[2] > q[0] && rc[1] < q[3] && rc[3] > q[1]);
  // 選んだ施設 → ピン（重要な順）→ ランドマーク → エリア名
  const order = pins.slice().sort((a, b) => (b.sel - a.sel) || (PRIO[a.p.c] - PRIO[b.p.c]));
  for (const P of order) {
    let show = !pov && (P.sel || (state.cats.has(P.p.c) && dist < SHOW_DIST[P.p.c] * (MOBILE ? 0.8 : 1)));
    let xy = null;
    if (show) xy = project(P.pos);
    if (!xy) show = false;
    let named = false;
    if (show) {
      named = P.sel || dist < NAME_DIST[P.p.c] * (MOBILE ? 0.8 : 1);
      const w = named ? P.w : 26;
      const rc = [xy[0] - 13, xy[1] - 28, xy[0] - 13 + w, xy[1]];
      if (!P.sel && hit(rc)) {
        // 名前が入らなければアイコンだけ
        const rc2 = [xy[0] - 13, xy[1] - 28, xy[0] + 13, xy[1]];
        if (named && !hit(rc2)) { named = false; placed.push(rc2); } else show = false;
      } else placed.push(rc);
    }
    P.vis_now = show;
    if (!show) { if (P.vis) { P.el.style.display = 'none'; P.vis = false; } continue; }
    if (!P.vis) { P.el.style.display = ''; P.vis = true; }
    if (P.named !== named) { P.el.classList.toggle('named', named); P.named = named; }
    P.sx = xy[0]; P.sy = xy[1];
    P.el.style.transform = `translate(${xy[0] - 12}px,${xy[1]}px) translate(0,-100%)`;
  }
  if (herePin.on && !pov) {
    const xy = project(herePin.pos);
    herePin.el.style.display = xy ? '' : 'none';
    if (xy) herePin.el.style.transform = `translate(${xy[0] - 16}px,${xy[1]}px) translate(0,-100%)`;
  } else herePin.el.style.display = 'none';
  for (const L of labels) {
    let show = !pov;
    if (show) {
      if (L.cls === 'port') show = dist > 160 && dist < 1500;
      else if (L.cls.startsWith('lm')) show = dist < (L.cls.includes('small') ? 380 : 900) && dist > 40;
    }
    let xy = show ? project(L.pos) : null;
    if (!xy) show = false;
    if (show) {
      const rc = [xy[0] - L.w / 2, xy[1] - L.h - 4, xy[0] + L.w / 2, xy[1] - 4];
      if (hit(rc)) show = false; else placed.push(rc);
    }
    if (!show) { if (L.vis) { L.el.style.display = 'none'; L.vis = false; } continue; }
    if (!L.vis) { L.el.style.display = ''; L.vis = true; }
    L.el.style.transform = `translate(${xy[0]}px,${xy[1]}px) translate(-50%,-120%)`;
  }
}

// ---------------------------------------------------------------- 左のパネル（エリア・施設の表示・夜・現在地）
{
  const box = $('#areas');
  for (const p of data.portLabels) {
    if (p.k === 'CC') continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="dot" style="--c:${p.c}"></span><span class="lg"></span><span class="sh"></span>`;
    b.querySelector('.lg').textContent = p.n;
    b.querySelector('.sh').textContent = p.n.replace(/ー/g, '').slice(0, 4);
    b.title = p.n + 'へ移動';
    b.onclick = () => { hidePop(); flyTo(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x + 120, 190, p.z + 190), 900); };
    box.appendChild(b);
  }
  const cb = $('#cats');
  for (const [k, c] of Object.entries(CATS)) {
    if (k === 'here' || k === 'entrance') continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span>${c.icon}</span>`;
    b.className = 'cat';
    b.title = c.label + 'のピンを表示';
    b.onclick = () => {
      const on = !state.cats.has(k);
      if (on) state.cats.add(k); else state.cats.delete(k);
      b.setAttribute('aria-pressed', String(on));
    };
    cb.appendChild(b);
  }
  $('#nightBtn').onclick = () => setNight(!state.night);
  $('#locBtn').onclick = () => locate(true);
}

// ---------------------------------------------------------------- 昼と夜
function setNight(on) {
  state.night = on;
  $('#nightBtn').setAttribute('aria-pressed', String(on));
  $('#nightBtn').textContent = on ? '☀ 昼' : '🌙 夜';
  const U = sky.material.uniforms;
  U.top.value.set(on ? 0x040914 : 0x2f6fc0); U.mid.value.set(on ? 0x0b1630 : 0x7fb0e0); U.hor.value.set(on ? 0x1c2a48 : 0xdbe8f2); U.glow.value = on ? 0 : 1;
  scene.environmentIntensity = on ? 0.12 : 0.7;
  hemi.intensity = on ? 0.18 : 0.55;
  hemi.color.set(on ? 0x6a86c8 : 0xcfe4ff);
  sun.intensity = on ? 0.35 : 2.6;
  sun.color.set(on ? 0x9ab4ff : 0xfff0d8);
  scene.fog.color.copy(on ? FOG_NIGHT : FOG_DAY);
  bloom.strength = on ? 0.9 : 0.12;
  bloom.threshold = on ? 0.55 : 0.95;
  renderer.toneMappingExposure = on ? 1.0 : 1.0;
  model.setNight(on);
  const wu = model.water.material.uniforms;
  wu.sunColor.value.set(on ? 0x101418 : 0x34342e);
  wu.waterColor.value.set(on ? 0x061a24 : 0x0f6478);
}

// ---------------------------------------------------------------- 現在地（GPS）
const PJ = (() => {
  const [lat0, lon0] = data.meta.origin;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, kz = 110574;
  return (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz];
})();
function locate(asFrom) {
  if (!navigator.geolocation) { $('#err').textContent = 'この端末では現在地を使えません。'; return; }
  $('#err').textContent = '';
  $('#locBtn').textContent = '📍 測位中…';
  navigator.geolocation.getCurrentPosition((pos) => {
    $('#locBtn').textContent = '📍 現在地';
    const [x, z] = PJ(pos.coords.latitude, pos.coords.longitude);
    const nr = graph.nearest(x, z);
    if (nr.d > 120) { $('#err').textContent = `現在地がパークの外のようです（園内の通路から約${Math.round(nr.d)}m）。`; return; }
    herePin.on = true;
    herePin.pos.set(x, 1.5, z);
    state.here = { x, z, name: '現在地', id: 'here' };
    flyTo(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 60, 110, z + 110), 900);
    if (asFrom) setPick('from', 'here');
  }, (err) => {
    $('#locBtn').textContent = '📍 現在地';
    $('#err').textContent = err.code === 1 ? '位置情報の利用が許可されていません。' : '現在地を取得できませんでした。';
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
}

// ---------------------------------------------------------------- 選択（カテゴリ別の一覧＋検索）
const GROUPS = ['here', 'entrance', 'attr', 'show', 'food', 'shop', 'toilet', 'service'];
const portOrder = Object.fromEntries(data.ports.map((p, i) => [p.key, i]));
const ITEMS = data.pois.slice().sort((a, b) => (portOrder[a.p] - portOrder[b.p]) || a.n.localeCompare(b.n, 'ja'));
const keyOf = (k) => (k === 'here' ? state.here : poiBy[k]);
const nameOf = (k) => (k === 'here' ? '現在地' : poiBy[k]?.n || '');
const catOf = (k) => (k === 'here' ? 'here' : poiBy[k]?.c);
const norm = (t) => String(t || '').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・（）()！!：:＆&“”"]/g, '');
const matches = (p, q) => !q || [p.n, p.sub, p.en, portBy[p.p]?.name, CATS[p.c]?.label].some((t) => norm(t).includes(q));
const combos = {};
function setupCombo(side) {
  const input = $(side === 'from' ? '#fromInput' : '#toInput');
  const list = document.createElement('div');
  list.className = 'list';
  list.id = side + 'List';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  document.body.appendChild(list);
  if (MOBILE) { input.readOnly = true; input.setAttribute('inputmode', 'none'); }
  let opts = [], active = -1;
  const mkOpt = (key, cat, name, sub, port, dis, cur) => {
    const o = document.createElement('div');
    o.className = 'opt' + (cur ? ' cur' : '');
    o.setAttribute('role', 'option');
    o.dataset.key = key;
    if (dis) o.setAttribute('aria-disabled', 'true');
    const pc = portBy[port];
    o.innerHTML = `${icon(cat)}<span class="t"><b></b><span></span></span><span class="pt" style="--c:${pc?.color || '#888'}"></span>`;
    o.querySelector('b').textContent = name;
    o.querySelector('.t span').textContent = sub || '';
    o.querySelector('.pt').textContent = pc ? pc.name.replace('アメリカンウォーターフロント', 'AWF').replace('メディテレーニアンハーバー', 'メディテ').replace('ファンタジースプリングス', 'ファンタジー') : '';
    o.addEventListener('mousedown', (ev) => { ev.preventDefault(); if (!dis) choose(key); });
    o.addEventListener('click', () => { if (!dis) choose(key); });
    list.appendChild(o);
    if (!dis) opts.push(o);
  };
  function render(filter) {
    const q = norm(filter);
    list.innerHTML = '';
    opts = [];
    const cur = state[side], other = state[side === 'from' ? 'to' : 'from'];
    for (const g of GROUPS) {
      if (g === 'here') {
        if (q && !norm('現在地げんざいち').includes(q)) continue;
        const h = document.createElement('h3'); h.textContent = '現在地'; list.appendChild(h);
        mkOpt('here', 'here', '現在地（GPS）', state.here ? '測位済み' : 'タップして位置情報を使う', null, other === 'here', cur === 'here');
        continue;
      }
      const its = ITEMS.filter((p) => p.c === g && matches(p, q));
      if (!its.length) continue;
      const h = document.createElement('h3');
      h.innerHTML = `${esc(CATS[g].label)}<em>${its.length}</em>`;
      list.appendChild(h);
      for (const p of its) mkOpt(p.id, p.c, p.n, p.sub || '', p.p, p.id === other, p.id === cur);
    }
    if (!opts.length) list.innerHTML = `<div class="empty">「${esc(filter)}」に一致する場所はありません</div>`;
    active = opts.findIndex((o) => o.dataset.key === cur);
    mark();
  }
  function mark() {
    opts.forEach((o, i) => o.classList.toggle('active', i === active));
    if (opts[active]) opts[active].scrollIntoView({ block: 'nearest' });
  }
  function place() {
    const r = input.getBoundingClientRect();
    const w = Math.min(Math.max(r.width + 60, 360), innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    list.style.left = left + 'px';
    list.style.top = r.bottom + 4 + 'px';
    list.style.width = w + 'px';
    list.style.maxHeight = Math.max(220, Math.min(innerHeight * 0.64, innerHeight - r.bottom - 14)) + 'px';
  }
  function open(filter) {
    for (const k in combos) if (k !== side) combos[k].close();
    hidePop();
    render(filter);
    place();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); show(); }
  function choose(key) {
    close(); input.blur();
    if (key === 'here' && !state.here) { locate(side === 'from'); if (side === 'to') state.pendingTo = true; return; }
    setPick(side, key);
  }
  function show() {
    const k = state[side];
    input.value = k ? nameOf(k) : '';
    const ic = input.parentElement.querySelector('.ic');
    ic.outerHTML = k ? icon(catOf(k), ' sel') : '<span class="ic sel none"></span>';
  }
  input.addEventListener('focus', () => { if (!MOBILE) input.select(); open(''); });
  input.addEventListener('click', () => { if (list.hidden) open(''); });
  input.addEventListener('input', () => { open(input.value); active = opts.length ? 0 : -1; mark(); });
  input.addEventListener('blur', () => setTimeout(() => { if (!list.hidden) close(); }, 150));
  input.addEventListener('keydown', (ev) => {
    if (list.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { open(''); ev.preventDefault(); return; }
    if (ev.key === 'ArrowDown') { active = Math.min(opts.length - 1, active + 1); mark(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); mark(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && !list.hidden && opts[active]) { ev.preventDefault(); choose(opts[active].dataset.key); }
    else if (ev.key === 'Escape') { close(); input.blur(); }
  });
  addEventListener('resize', () => { if (!list.hidden) place(); });
  combos[side] = { open, close, show, input };
}
setupCombo('from');
setupCombo('to');
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.list') || e.target.closest('.combo')) return;
  for (const k in combos) combos[k].close();
});

function setPick(side, key) {
  state[side] = key;
  combos[side].show();
  for (const P of pins) { P.sel = P.p.id === state.from || P.p.id === state.to; P.el.classList.toggle('sel', P.sel); P.el.classList.toggle('from', P.p.id === state.from); }
  $('#goBtn').disabled = !(state.from && state.to && state.from !== state.to);
  $('#err').textContent = '';
  renderQuick();
  if (state.from && state.to && state.from !== state.to) go(false);
  else if (key && keyOf(key)) {
    const p = keyOf(key);
    flyTo(new THREE.Vector3(p.x, 0, p.z), null, 700);
  }
}
combos.from.show();
combos.to.show();
$('#goBtn').disabled = true;
$('#swapBtn').onclick = () => {
  const f = state.from, t = state.to;
  state.from = t; state.to = f;
  combos.from.show(); combos.to.show();
  setPick('from', state.from);
};
for (const b of document.querySelectorAll('#speedSeg button')) {
  b.onclick = () => {
    state.speed = +b.dataset.v;
    for (const x of document.querySelectorAll('#speedSeg button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
  };
}

// 「最寄りの○○」とおすすめの経路
function renderQuick() {
  const q = $('#quick');
  q.innerHTML = '';
  const add = (txt, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.className = cls; b.onclick = fn; q.appendChild(b); };
  const base = state.from;
  for (const [c, txt] of [['toilet', '🚻 最寄りのトイレ'], ['food', '🍴 最寄りのフード'], ['shop', '🛍 最寄りのショップ']]) {
    add(txt, () => nearest(c), 'q');
  }
  if (!base) {
    const sh = (n) => n.replace(/（.*?）|：.*$/g, '').replace('メインエントランス', '入口').replace(/^(.{11}).+$/, '$1…');
    for (const [f, t] of (data.presets || []).slice(0, MOBILE ? 4 : 2)) {
      if (!poiBy[f] || !poiBy[t]) continue;
      add(`${sh(poiBy[f].n)} → ${sh(poiBy[t].n)}`, () => { state.from = f; combos.from.show(); setPick('to', t); });
    }
  }
}
function nearest(cat) {
  const base = state.from || (state.here ? 'here' : null);
  if (!base) { $('#err').textContent = '先に「出発地」を選ぶか、📍 現在地 を押してください。'; combos.from.open(''); return; }
  const key = base === 'here' ? state.here : base;
  const list = graph.nearestOf(key, cat, 4);
  const near = list[0];
  if (!near) return;
  if (!state.from) { state.from = 'here'; combos.from.show(); }
  state.nearList = { cat, from: state.from, list };
  setPick('to', near.p.id);
}
renderQuick();

$('#controls').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.from || !state.to || state.from === state.to) {
    $('#err').textContent = '出発地と目的地を選んでください。';
    return;
  }
  if (state.routes.length && state.routesFor === state.from + '>' + state.to) startPov();
  else go(true);
});
$('#replayBtn').onclick = () => startPov();
$('#replayBtn2').onclick = () => startPov();
$('#overviewBtn').onclick = () => { stopPov(); fitRoute(); };
$('#overviewBtn2').onclick = () => { stopPov(); fitRoute(); };
$('#menuBtn').onclick = () => { stopPov(); fitRoute(); };
$('#closeBtn').onclick = () => resetToStart();
$('#foldBtn').onclick = () => setFold(true);
$('#boardMini').onclick = () => setFold(false);
$('#homeBtn').onclick = () => resetToStart();

function setFold(f) {
  if (!state.routes.length) f = false;
  state.folded = f;
  $('#board').hidden = f || !state.routes.length;
  $('#boardMini').hidden = !f || !state.routes.length;
  document.body.classList.toggle('folded', f);
  renderMini();
  layoutUI();
  if (!state.userMoved && state.mode !== 'pov') fitRoute();
}
function renderMini() {
  const r = state.routes[state.sel];
  if (!r) return;
  const m = $('#boardMini');
  m.classList.toggle('bf', r.kind === 'bf');
  m.querySelector('.mtitle').textContent = r.label;
  m.querySelector('.mmeta').textContent = `約${Math.round(r.dist / 10) * 10}m・約${Math.max(1, Math.round(r.time / 60))}分`;
}
function swipe(el, dir, fn) {
  let y0 = null;
  el.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  el.addEventListener('pointerup', (e) => { if (y0 != null && (e.clientY - y0) * dir > 40) fn(); y0 = null; });
  el.addEventListener('pointercancel', () => { y0 = null; });
}
swipe($('#board .grip'), 1, () => setFold(true));
swipe($('#board .bhead'), 1, () => setFold(true));
swipe($('#boardMini'), -1, () => setFold(false));

function resetToStart() {
  stopPov();
  state.routes = [];
  state.sel = 0;
  state.routesFor = null;
  if (routeObj) { scene.remove(routeObj); routeObj.traverse((o) => o.geometry?.dispose()); routeObj = null; }
  $('#board').hidden = true;
  $('#boardMini').hidden = true;
  state.folded = false;
  document.body.classList.remove('folded', 'routed');
  $('#viewBtns').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
  flyTo(HOME_T.clone(), HOME_P.clone(), 900);
  layoutUI();
}

// ---------------------------------------------------------------- 画面の配置
function layoutUI() {
  const side = $('#side');
  const c = $('#controls').getBoundingClientRect();
  const mobile = innerWidth < 760;
  side.classList.toggle('row', mobile);
  side.style.left = (mobile ? 8 : 14) + 'px';
  side.style.right = mobile ? '8px' : 'auto';
  side.style.top = Math.round(c.bottom + (mobile ? 6 : 10)) + 'px';
  const vbtn = $('#viewBtns');
  if (mobile) {
    const bp = !$('#board').hidden ? $('#board') : (!$('#boardMini').hidden ? $('#boardMini') : null);
    vbtn.style.bottom = bp ? (innerHeight - bp.getBoundingClientRect().top + 8) + 'px' : '';
    return;
  }
  vbtn.style.bottom = '';
  side.style.maxHeight = Math.max(160, (vbtn.hidden ? innerHeight - 30 : vbtn.getBoundingClientRect().top - 10) - (c.bottom + 10)) + 'px';
}
addEventListener('resize', layoutUI);
if (window.ResizeObserver) new ResizeObserver(() => layoutUI()).observe($('#controls'));

// ---------------------------------------------------------------- 施設をタップ
let popFor = null;
function hidePop() { $('#pop').hidden = true; popFor = null; }
function showPop(P) {
  const p = P.p;
  popFor = P;
  const pop = $('#pop');
  pop.querySelector('.ph .ic').outerHTML = icon(p.c);
  $('#popName').textContent = p.n;
  $('#popSub').textContent = [CATS[p.c]?.label, portBy[p.p]?.name, p.sub].filter(Boolean).join(' · ');
  pop.hidden = false;
  placePop();
}
function placePop() {
  if (!popFor) return;
  const xy = project(popFor.pos);
  if (!xy) { hidePop(); return; }
  const pop = $('#pop');
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const x = Math.max(w / 2 + 8, Math.min(innerWidth - w / 2 - 8, xy[0]));
  const y = Math.max(h + 30, xy[1] - 6);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}
$('#popFrom').onclick = () => { const k = popFor.p.id; hidePop(); setPick('from', k); };
$('#popTo').onclick = () => { const k = popFor.p.id; hidePop(); if (!state.from && state.here) { state.from = 'here'; combos.from.show(); } setPick('to', k); };
{
  // 地図をタップ（動かさずに短く押す）したら、いちばん近いピンを開く
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (state.mode !== 'pov') down = { x: e.clientX, y: e.clientY, t: performance.now(), n: (down?.n || 0) }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || state.mode === 'pov') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 350;
    down = null;
    if (moved > 8 || !quick) return;
    let best = null, bd = MOBILE ? 30 : 22;
    for (const P of pins) {
      if (!P.vis_now) continue;
      const d = Math.hypot(P.sx - e.clientX, P.sy - 14 - e.clientY);
      if (d < bd) { bd = d; best = P; }
    }
    setTimeout(() => { if (best) showPop(best); else hidePop(); }, 0);
  });
}

// ---------------------------------------------------------------- 経路
function go(play) {
  if (!state.from || !state.to || state.from === state.to) return;
  const rs = graph.routes(state.from === 'here' ? state.here : state.from, state.to === 'here' ? state.here : state.to);
  if (!rs.length) { $('#err').textContent = 'ルートが見つかりませんでした（地図データ不足の可能性があります）。'; return; }
  state.routes = rs;
  state.sel = 0;
  state.routesFor = state.from + '>' + state.to;
  state.folded = false;
  $('#boardMini').hidden = true;
  document.body.classList.remove('folded');
  if (state.from !== 'here' && state.to !== 'here') history.replaceState(null, '', '#' + encodeURIComponent(state.from) + '>' + encodeURIComponent(state.to));
  document.body.classList.add('routed');
  renderBoard();
  selectRoute(0, !play);
  layoutUI();
  if (play) startPov();
}
function renderBoard() {
  const r0 = state.routes[0];
  const sm = $('#summary');
  sm.innerHTML = `<div class="ln">${icon(catOf(state.from))}<span class="n1"></span> → ${icon(catOf(state.to))}<span class="n2"></span></div>
    <div><span class="big mono"></span>　<span class="meta tm"></span></div>
    <div class="meta cnt"></div>`;
  sm.querySelector('.n1').textContent = nameOf(state.from);
  sm.querySelector('.n2').textContent = nameOf(state.to);
  const toP = poiBy[state.to];
  if (toP?.sub) { const sb = document.createElement('small'); sb.textContent = toP.sub; sm.querySelector('.n2').appendChild(sb); }
  // 「最寄りの○○」で選んだときは、ほかの近い候補も出す
  const nl = state.nearList;
  if (nl && nl.from === state.from && nl.list.some((x) => x.p.id === state.to)) {
    const box = document.createElement('div');
    box.className = 'alts';
    for (const x of nl.list) {
      if (x.p.id === state.to) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${x.p.c === 'toilet' ? 'トイレ（' + (x.p.sub || '') + '）' : x.p.n}・約${Math.max(1, Math.round(x.t / 60))}分`;
      b.onclick = () => setPick('to', x.p.id);
      box.appendChild(b);
    }
    if (box.children.length) { const lab = document.createElement('div'); lab.className = 'meta'; lab.textContent = 'ほかの近い候補'; sm.append(lab, box); }
  }
  sm.querySelector('.big').textContent = `約${Math.round(r0.dist / 10) * 10}m`;
  sm.querySelector('.tm').textContent = `徒歩の目安 約${Math.max(1, Math.round(r0.time / 60))}分`;
  sm.querySelector('.cnt').textContent = state.routes.length > 1 ? `ルート候補 ${state.routes.length} 本（押すと切り替わります）` : '';
  const box = $('#ropts');
  box.innerHTML = '';
  state.routes.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ropt' + (r.kind === 'bf' ? ' bf' : '') + (i === state.sel ? ' on' : '');
    btn.innerHTML = '<b></b><span class="tag"></span><span class="mono"></span>';
    btn.querySelector('b').textContent = r.label;
    btn.querySelector('.tag').textContent = r.tagline || '';
    btn.querySelector('.mono').textContent = `約${Math.round(r.dist / 10) * 10}m・約${Math.max(1, Math.round(r.time / 60))}分`;
    btn.onclick = () => { selectRoute(i, state.mode !== 'pov'); if (state.mode === 'pov') startPov(); };
    box.appendChild(btn);
  });
  $('#board').hidden = !!state.folded;
  $('#viewBtns').hidden = false;
}
function selectRoute(i, fit) {
  state.sel = i;
  for (const [k, b] of [...document.querySelectorAll('.ropt')].entries()) b.classList.toggle('on', k === i);
  const r = state.routes[i];
  buildRouteMesh(r);
  renderSteps(r);
  renderMini();
  if (fit) fitRoute();
}
function renderSteps(r) {
  const ol = $('#steps');
  ol.innerHTML = '';
  for (const s of r.steps) {
    const li = document.createElement('li');
    li.className = s.cls || '';
    li.innerHTML = '<span class="k"></span><span><b></b><small></small></span><em class="mono"></em>';
    li.querySelector('.k').textContent = s.icon;
    li.querySelector('b').textContent = s.text;
    li.querySelector('small').textContent = s.sub || '';
    li.querySelector('em').textContent = s.dist ? Math.round(s.dist) + 'm' : '';
    li.onclick = () => {
      if (state.mode === 'pov') stopPov();
      const p = r.at(s.s);
      flyTo(p.clone(), p.clone().add(new THREE.Vector3(-40, 55, 60)), 700);
    };
    ol.appendChild(li);
  }
}

// 経路の光るライン
let routeObj = null;
const routeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.45, 0.3), toneMapped: false });
const routeMatBf = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 1.5), toneMapped: false });
const routeXray = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, toneMapped: false });
function tubeGeo(pts, rad) {
  const pos = [];
  const add = (g) => {
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const cnt = idx ? idx.length : p.length / 3;
    for (let i = 0; i < cnt; i++) { const k = idx ? idx[i] : i; pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); }
    g.dispose();
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = a.distanceTo(b);
    if (L < 0.02) continue;
    const g = new THREE.CylinderGeometry(rad, rad, L, 8, 1, true);
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z);
    add(g);
    const s = new THREE.SphereGeometry(rad, 8, 6);
    s.translate(b.x, b.y, b.z);
    add(s);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}
const groundY = (p) => p.y + 0.06;
function buildRouteMesh(r) {
  if (routeObj) { scene.remove(routeObj); routeObj.traverse((o) => o.geometry?.dispose()); }
  const g = new THREE.Group();
  const pts = r.pts.map((p) => new THREE.Vector3(p.x, groundY(p) + 0.9, p.z));
  const tube = new THREE.Mesh(tubeGeo(pts, 0.75), r.kind === 'bf' ? routeMatBf : routeMat);
  const xray = new THREE.Mesh(tube.geometry, routeXray);
  xray.renderOrder = 20;
  g.add(tube, xray);
  // 地面の案内線（POV 用）: 矢印の模様
  const fpos = [], fuv = [];
  let acc = 0;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const nx = (-dz / L) * 0.55, nz = (dx / L) * 0.55, ya = groundY(a) + 0.03, yb = groundY(b) + 0.03;
    fpos.push(a.x + nx, ya, a.z + nz, b.x + nx, yb, b.z + nz, b.x - nx, yb, b.z - nz, a.x + nx, ya, a.z + nz, b.x - nx, yb, b.z - nz, a.x - nx, ya, a.z - nz);
    const u0 = acc / 1.6, u1 = (acc + L) / 1.6;
    fuv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    acc += L;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  const floor = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: arrowTex, color: r.kind === 'bf' ? new THREE.Color(1.6, 0.6, 1.1) : new THREE.Color(1.7, 1.15, 0.25), transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12 }));
  floor.renderOrder = 15;
  floor.visible = false;
  g.add(floor);
  const ends = [];
  for (const [p, c] of [[pts[0], 0xffffff], [pts[pts.length - 1], r.kind === 'bf' ? 0xff7ab8 : 0xffb020]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.3, 8, 40), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(p).add(new THREE.Vector3(0, -0.8, 0));
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 40, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, toneMapped: false }));
    pil.position.copy(p).add(new THREE.Vector3(0, 19, 0));
    g.add(ring, pil);
    ends.push(ring, pil);
  }
  const marker = makeMarker(r.kind === 'bf' ? 0xff7ab8 : 0xffb020);
  g.add(marker);
  const lg = new LineGeometry();
  const flat = [];
  for (const p of pts) flat.push(p.x, p.y, p.z);
  lg.setPositions(flat);
  const lm = new LineMaterial({ color: r.kind === 'bf' ? 0xff7ab8 : 0xffb020, linewidth: MOBILE ? 4 : 5, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false });
  lm.resolution.set(innerWidth, innerHeight);
  const overlay = new Line2(lg, lm);
  overlay.computeLineDistances();
  overlay.renderOrder = 30;
  g.add(overlay);
  g.userData = { tube, xray, floor, ends, marker, overlay };
  scene.add(g);
  routeObj = g;
  if (state.mode === 'pov') povRouteVisuals(true);
}
const arrowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(14, 4); g.lineTo(40, 16); g.lineTo(14, 28); g.lineTo(22, 16); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
})();
const ballTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,190,60,0.85)');
  grd.addColorStop(1, 'rgba(255,190,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 30, 0, Math.PI * 2); g.fillStyle = '#1a1206'; g.fill();
  g.beginPath(); g.arc(64, 64, 25, 0, Math.PI * 2); g.fillStyle = '#ffb020'; g.fill();
  g.beginPath(); g.arc(64, 64, 12, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fillStyle = '#1a1206'; g.fill();
  g.beginPath(); g.arc(32, 32, 15, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const TRAIL = 10;
function makeMarker(color) {
  const grp = new THREE.Group();
  const mk = (tex, col, opacity, order) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false }));
    sp.renderOrder = order;
    return sp;
  };
  const trail = [];
  for (let i = 0; i < TRAIL; i++) { const t = mk(dotTex, color, 0.9 * (1 - i / TRAIL), 39); trail.push(t); grp.add(t); }
  const core = mk(ballTex, color === 0xffb020 ? 0xffffff : color, 1, 41);
  grp.add(core);
  grp.userData = { core, trail };
  return grp;
}
const _mp = new THREE.Vector3();
function updateMarker(now, r) {
  const u = routeObj.userData.marker.userData;
  const period = Math.max(3, Math.min(14, r.dist / 70));
  const s = (((now / 1000) / period) % 1) * r.dist;
  _mp.copy(r.at(s)); _mp.y = groundY(_mp) + 0.9;
  const dist = camera.position.distanceTo(_mp);
  const px = (dist * Math.tan((camera.fov * Math.PI) / 360) * 2) / innerHeight;
  const size = (MOBILE ? 46 : 54) * px;
  u.core.position.copy(_mp); u.core.scale.setScalar(size * (1 + 0.08 * Math.sin(now / 140)));
  for (let i = 0; i < u.trail.length; i++) {
    const ss = s - (i + 1) * Math.max(1.5, r.dist * 0.008);
    if (ss < 0) { u.trail[i].visible = false; continue; }
    u.trail[i].visible = true;
    const q = r.at(ss);
    u.trail[i].position.set(q.x, groundY(q) + 0.9, q.z);
    u.trail[i].scale.setScalar(size * (0.42 - i * 0.025));
  }
}
function povRouteVisuals(on) {
  const u = routeObj?.userData;
  if (!u) return;
  u.tube.visible = u.xray.visible = u.marker.visible = u.overlay.visible = !on;
  u.ends.forEach((o) => (o.visible = !on));
  u.floor.visible = on;
}

function fitRoute() {
  const r = state.routes[state.sel];
  if (!r) return;
  state.userMoved = false;
  const box = new THREE.Box3();
  for (const p of r.pts) box.expandByPoint(p);
  const c = box.getCenter(new THREE.Vector3());
  const len = box.getSize(new THREE.Vector3()).length();
  const size = Math.max(170, len);
  const fr = freeRect();
  const k = Math.max(innerHeight / Math.max(120, fr.h), (innerWidth / Math.max(160, fr.w)) * 0.75);
  // 短い経路は真上に近い角度から（手前の建物で隠れないように）
  const dir = len < 250 ? new THREE.Vector3(0.25, 1.7, 0.6) : new THREE.Vector3(0.35, 1.0, 0.85);
  const off = dir.normalize().multiplyScalar(size * 0.9 * Math.min(3.2, Math.max(1, k)));
  flyTo(c, c.clone().add(off), 900);
}
function freeRect() {
  const W = innerWidth, H = innerHeight, mobile = W < 760;
  const vis = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none';
  let x0 = 0, x1 = W, y0 = 0, y1 = H;
  const board = $('#board'), mini = $('#boardMini'), side = $('#side'), ctr = $('#controls');
  if (mobile) {
    y0 = Math.max(ctr.getBoundingClientRect().bottom, vis(side) ? side.getBoundingClientRect().bottom : 0) + 4;
    if (vis(board)) y1 = board.getBoundingClientRect().top;
    else if (vis(mini)) y1 = mini.getBoundingClientRect().top;
  } else {
    if (vis(side)) x0 = side.getBoundingClientRect().right + 8;
    if (vis(board)) x1 = board.getBoundingClientRect().left - 8;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const viewOff = { x: 0, y: 0 };
function updateViewOffset(dt) {
  if (state.mode === 'pov') {
    viewOff.x = viewOff.y = 0;
    if (camera.view && camera.view.enabled) camera.clearViewOffset();
    return;
  }
  let tx = 0, ty = 0;
  if (state.routes.length) { const fr = freeRect(); tx = innerWidth / 2 - fr.cx; ty = innerHeight / 2 - fr.cy; }
  const a = 1 - Math.exp(-dt * 8);
  viewOff.x += (tx - viewOff.x) * a;
  viewOff.y += (ty - viewOff.y) * a;
  if (Math.abs(viewOff.x) < 0.5 && Math.abs(viewOff.y) < 0.5 && tx === 0 && ty === 0) {
    if (camera.view && camera.view.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(innerWidth, innerHeight, viewOff.x, viewOff.y, innerWidth, innerHeight);
}

// ---------------------------------------------------------------- カメラ移動
function flyTo(target, pos, ms) {
  fly = { t0: performance.now(), ms, ft: controls.target.clone(), tt: target, fp: camera.position.clone(), tp: pos || camera.position.clone().add(target.clone().sub(controls.target)) };
}
function stepFly(now) {
  if (!fly) return;
  const t = Math.min(1, (now - fly.t0) / fly.ms);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  controls.target.lerpVectors(fly.ft, fly.tt, e);
  camera.position.lerpVectors(fly.fp, fly.tp, e);
  if (t >= 1) fly = null;
}

// ---------------------------------------------------------------- POV
function startPov() {
  const r = state.routes[state.sel];
  if (!r) return;
  hidePop();
  state.mode = 'pov';
  document.body.classList.add('pov');
  $('#pov').hidden = false;
  controls.enabled = false;
  fly = null;
  const fader = $('#fader');
  fader.style.opacity = 1;
  setTimeout(() => (fader.style.opacity = 0), 250);
  state.pov = { t: 0, paused: false, last: performance.now(), look: null, done: false, port: null, pitch: 0 };
  $('#pauseBtn').textContent = '❚❚';
  povRouteVisuals(true);
  scene.fog.near = 120; scene.fog.far = 1400;
  camera.fov = 68; camera.updateProjectionMatrix();
}
function stopPov() {
  if (state.mode !== 'pov') return;
  state.mode = 'view';
  state.pov = null;
  document.body.classList.remove('pov');
  $('#pov').hidden = true;
  controls.enabled = true;
  povRouteVisuals(false);
  scene.fog.near = 900; scene.fog.far = 4200;
  camera.fov = 42; camera.updateProjectionMatrix();
  requestAnimationFrame(layoutUI);
}
function togglePause() {
  const pv = state.pov;
  if (!pv) return;
  if (pv.done) { pv.t = 0; pv.done = false; pv.paused = false; } else pv.paused = !pv.paused;
  $('#pauseBtn').textContent = pv.paused ? '▶' : '❚❚';
}
$('#pauseBtn').onclick = (e) => { e.stopPropagation(); togglePause(); };
{
  let sx = null, sy = null, st = 0, sp = 0, mode = null;
  canvas.addEventListener('pointerdown', (e) => { if (state.mode !== 'pov') return; sx = e.clientX; sy = e.clientY; st = state.pov.t; sp = state.pov.pitch; mode = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'pov' || sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!mode && Math.hypot(dx, dy) > 10) mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    const r = state.routes[state.sel];
    if (mode === 'h') { state.pov.t = Math.max(0, Math.min(r.vtime, st - (dx / innerWidth) * r.vtime * 0.5)); state.pov.done = false; }
    if (mode === 'v') state.pov.pitch = Math.max(-0.5, Math.min(0.8, sp + (dy / innerHeight) * 1.6));
  });
  canvas.addEventListener('pointerup', () => { if (state.mode !== 'pov') return; if (!mode) togglePause(); sx = null; });
  $('#bar').addEventListener('click', (e) => {
    const r = state.routes[state.sel], rc = e.currentTarget.getBoundingClientRect();
    state.pov.t = ((e.clientX - rc.left) / rc.width) * r.vtime;
    state.pov.done = false;
  });
}
const _tgt = new THREE.Vector3();
function stepPov(now) {
  const pv = state.pov, r = state.routes[state.sel];
  const dt = Math.min(0.1, (now - pv.last) / 1000);
  pv.last = now;
  if (!pv.paused && !pv.done) {
    pv.t += dt * SPEED[state.speed];
    if (pv.t >= r.vtime) { pv.t = r.vtime; pv.done = true; $('#pauseBtn').textContent = '↺'; }
  }
  const s = r.sAtVtime(pv.t);
  const pos = r.at(s);
  _tgt.copy(r.at(Math.min(r.dist, s + 9)));
  if (r.dist - s < 4) _tgt.copy(r.at(r.dist)).add(r.dirAt(r.dist).multiplyScalar(9));
  const hd = Math.hypot(_tgt.x - pos.x, _tgt.z - pos.z) || 1;
  _tgt.y = pos.y + EYE + Math.max(-hd * 0.25, Math.min(hd * 0.25, _tgt.y - pos.y)) + Math.tan(pv.pitch) * hd;
  if (!pv.look) pv.look = _tgt.clone();
  pv.look.lerp(_tgt, 1 - Math.exp(-dt * 3.2));
  camera.position.set(pos.x, groundY(pos) + EYE, pos.z);
  camera.lookAt(pv.look);
  const nav = r.navAt(s);
  $('#navIcon').textContent = nav.icon;
  $('#navIcon').className = nav.cls || '';
  $('#navText').textContent = nav.text;
  $('#navNext').textContent = nav.sub ? nav.sub : nav.next ? '次：' + nav.next.text : '';
  $('#navDist').textContent = nav.type === 'e' ? '' : Math.max(0, Math.round(nav.d)) + 'm';
  $('#bar i').style.width = (pv.t / r.vtime) * 100 + '%';
  $('#prog').textContent = `${Math.round(s)}m / ${Math.round(r.dist)}m`;
  const ni = graph.nearest(pos.x, pos.z);
  const port = data.ports[data.nodePort[ni.n]]?.name || '';
  if (port !== pv.port) { pv.port = port; $('#mapLv').textContent = port; }
  drawMinimap(pos, r.dirAt(s), r);
}

// ミニマップ（進行方向が上）。園の地図は最初に一度だけ描いておく
const mm = $('#minimap'), mctx = mm.getContext('2d');
const base = (() => {
  const S = 1.2; // 1m = 1.2px
  const P = data.park;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 1]); z1 = Math.max(z1, P[i + 1]); }
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0 + 40) * S); c.height = Math.ceil((z1 - z0 + 40) * S);
  const g = c.getContext('2d');
  const X = (x) => (x - x0 + 20) * S, Z = (z) => (z - z0 + 20) * S;
  const poly = (f) => { g.beginPath(); for (let i = 0; i < f.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(f[i]), Z(f[i + 1])); g.closePath(); };
  g.fillStyle = '#2a3446'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#4d5a6e'; poly(P); g.fill();
  for (const [k, col] of [['green', '#3f6a48'], ['wood', '#35583c'], ['plaza', '#8a8270'], ['water', '#2f6f9a'], ['rock', '#7a5a48']]) {
    g.fillStyle = col;
    for (const a of data.ground[k]) { poly(a.o); g.fill(); if (a.h) { g.save(); g.fillStyle = k === 'water' ? '#4d5a6e' : col; for (const h of a.h) { poly(h); g.fill(); } g.restore(); } }
  }
  g.strokeStyle = '#c9c2b0'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const rb of data.ribbons) { g.lineWidth = Math.max(1.5, rb.w * S); g.beginPath(); for (let i = 0; i < rb.p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(rb.p[i]), Z(rb.p[i + 1])); g.stroke(); }
  g.fillStyle = '#b08a70';
  for (const b of data.buildings) { poly(b.r); g.fill(); }
  return { c, X, Z, S };
})();
function drawMinimap(pos, dir, r) {
  const W = mm.width, H = mm.height, sc = 2.6;
  mctx.save();
  mctx.fillStyle = '#1b2433'; mctx.fillRect(0, 0, W, H);
  const ang = Math.atan2(dir.x, -dir.z);
  mctx.translate(W / 2, H / 2 + 30);
  mctx.rotate(-ang);
  mctx.scale(sc / base.S, sc / base.S);
  mctx.translate(-base.X(pos.x), -base.Z(pos.z));
  mctx.drawImage(base.c, 0, 0);
  mctx.strokeStyle = r.kind === 'bf' ? '#ff7ab8' : '#ffb020';
  mctx.lineWidth = 5 * base.S / sc * 1.4;
  mctx.lineCap = 'round';
  mctx.beginPath();
  r.pts.forEach((p, i) => (i ? mctx.lineTo : mctx.moveTo).call(mctx, base.X(p.x), base.Z(p.z)));
  mctx.stroke();
  mctx.restore();
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  mctx.moveTo(W / 2, H / 2 + 15); mctx.lineTo(W / 2 - 11, H / 2 + 42); mctx.lineTo(W / 2 + 11, H / 2 + 42);
  mctx.closePath(); mctx.fill();
}

// ---------------------------------------------------------------- 影（見ている範囲に合わせて影の範囲を動かす）
function updateShadow() {
  const pov = state.mode === 'pov';
  const c = pov ? camera.position : controls.target;
  const dist = pov ? 0 : camera.position.distanceTo(controls.target);
  const half = pov ? 140 : THREE.MathUtils.clamp(dist * 0.85, 90, 620);
  const sc = sun.shadow.camera;
  if (sc.right !== half) {
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 10; sc.far = 2400;
    sc.updateProjectionMatrix();
  }
  // テクセル単位にそろえて、動かしたときのちらつきを抑える
  const texel = (2 * half) / sun.shadow.mapSize.x;
  const cx = Math.round(c.x / texel) * texel, cz = Math.round(c.z / texel) * texel;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 1000);
}

// ---------------------------------------------------------------- ループ
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000) || 1 / 60;
  last = now;
  if (state.mode === 'pov' && state.pov) stepPov(now);
  else {
    stepFly(now);
    controls.update(dt);
    const r = state.routes[state.sel];
    if (routeObj && r) {
      updateMarker(now, r);
      const ov = routeObj.userData.overlay;
      const d = camera.position.distanceTo(controls.target);
      ov.material.opacity = Math.max(0.25, Math.min(0.95, (d - 80) / 400));
      ov.material.resolution.set(innerWidth, innerHeight);
    }
  }
  updateViewOffset(dt);
  updateShadow();
  model.water.material.uniforms.time.value += dt * 0.6;
  for (const s of model.landmarks.spin) s.rotation.y += dt * 0.25;
  const nearWant = state.mode === 'pov' ? 0.2 : THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.015, 0.5, 20);
  if (Math.abs(camera.near - nearWant) > camera.near * 0.15) { camera.near = nearWant; camera.updateProjectionMatrix(); }
  composer.render();
  updateLabels();
  placePop();
}
requestAnimationFrame(loop);
layoutUI();
$('#loading').style.opacity = 0;
setTimeout(() => $('#loading').remove(), 500);

const hash = decodeURIComponent(location.hash.slice(1));
if (hash.includes('>')) {
  const [f, t] = hash.split('>');
  if (poiBy[f] && poiBy[t]) { state.from = f; combos.from.show(); setPick('to', t); }
}
window.__app = { THREE, state, data, camera, controls, scene, renderer, composer, bloom, go, setPick, startPov, stopPov, fitRoute, model, graph, selectRoute, setNight, flyTo, sun };
