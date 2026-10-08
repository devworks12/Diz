// 手続き的に作るテクスチャ（画像ファイルを使わずに、石畳・芝・壁の窓などを canvas で描く）
import * as THREE from 'three';

// 決まった種から作る乱数（毎回同じ見た目になるように）
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const shade = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
// 小さな粒のざらつき
function grain(g, w, h, r, amt = 18, n = 9000, size = 1.6) {
  for (let i = 0; i < n; i++) {
    const v = 128 + (r() - 0.5) * amt * 2;
    g.fillStyle = shade(Math.round(v), 0.18);
    g.fillRect(r() * w, r() * h, size, size);
  }
}

// ---------------------------------------------------------------- 地面
// 石畳（白っぽい灰色で描き、頂点の色で広場ごとの色をつける）。1 枚 = 4m 四方
export function pavingTex(kind = 'stone') {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(kind === 'stone' ? 11 : 23);
  g.fillStyle = '#cbc7bf';
  g.fillRect(0, 0, S, S);
  if (kind === 'stone') {
    // 大きさのそろわない四角い敷石を段違いに並べる
    const rowH = S / 8;
    for (let row = 0; row < 8; row++) {
      let x = -r() * 60;
      while (x < S) {
        const w = rowH * (0.9 + r() * 0.9);
        const v = 214 + (r() - 0.5) * 22;
        g.fillStyle = `rgb(${v},${v - 3},${v - 7})`;
        g.fillRect(x + 1.5, row * rowH + 1.5, w - 3, rowH - 3);
        // 石の表情
        g.fillStyle = shade(Math.round(v - 20), 0.25);
        g.fillRect(x + 2 + r() * (w - 20), row * rowH + 4 + r() * (rowH - 20), 10 + r() * 20, 6 + r() * 10);
        x += w;
      }
    }
  } else if (kind === 'brick') {
    // ヘリンボーン風のれんが
    const bw = 64, bh = 32;
    for (let y = 0; y < S; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = -bw; x < S + bw; x += bw) {
        const v = 208 + (r() - 0.5) * 28;
        g.fillStyle = `rgb(${v},${v - 5},${v - 10})`;
        g.fillRect(x + off + 1.5, y + 1.5, bw - 3, bh - 3);
      }
    }
  } else if (kind === 'cobble') {
    // 丸い玉石
    for (let i = 0; i < 900; i++) {
      const x = r() * S, y = r() * S, rad = 9 + r() * 9;
      const v = 200 + (r() - 0.5) * 34;
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.beginPath(); g.ellipse(x, y, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'dirt') {
    g.fillStyle = '#c9bca2'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const v = 175 + (r() - 0.5) * 70;
      g.fillStyle = `rgba(${v},${v - 8},${v - 22},0.5)`;
      g.beginPath(); g.arc(r() * S, r() * S, 1 + r() * 5, 0, 7); g.fill();
    }
  }
  grain(g, S, S, r, 16, 14000);
  return toTex(c);
}

export function grassTex() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(5);
  g.fillStyle = '#6f9a48'; g.fillRect(0, 0, S, S);
  // まだらな濃淡
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(52,86,34,0.35)' : 'rgba(150,180,90,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 草の筋
  for (let i = 0; i < 26000; i++) {
    const x = r() * S, y = r() * S;
    const v = r();
    g.strokeStyle = v < 0.5 ? `rgba(60,100,40,${0.35 + r() * 0.3})` : `rgba(150,190,100,${0.25 + r() * 0.3})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4); g.stroke();
  }
  return toTex(c);
}

export function soilTex() {
  // 植え込み・林の地面（落ち葉と下草）
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(9);
  g.fillStyle = '#4c5a32'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    g.fillStyle = v < 0.4 ? `rgba(90,70,40,${0.4 + r() * 0.4})` : v < 0.8 ? `rgba(70,110,45,${0.5})` : `rgba(130,150,70,0.5)`;
    g.beginPath(); g.ellipse(r() * S, r() * S, 2 + r() * 5, 1 + r() * 3, r() * 3, 0, 7); g.fill();
  }
  return toTex(c);
}

export function sandTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(3);
  g.fillStyle = '#e6d3a4'; g.fillRect(0, 0, S, S);
  grain(g, S, S, r, 40, 16000, 1.2);
  return toTex(c);
}

export function asphaltTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(4);
  g.fillStyle = '#8d8a84'; g.fillRect(0, 0, S, S);
  grain(g, S, S, r, 50, 20000, 1.3);
  return toTex(c);
}

export function rockTex() {
  // 岩肌（頂点の色に掛ける。割れ目と層）
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(17);
  g.fillStyle = '#c8c0b4'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const y = r() * S;
    g.strokeStyle = `rgba(80,70,60,${0.15 + r() * 0.25})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) g.lineTo(x, y + (r() - 0.5) * 18);
    g.stroke();
  }
  for (let i = 0; i < 400; i++) {
    const x = r() * S, y = r() * S;
    g.strokeStyle = `rgba(60,50,45,${0.2 + r() * 0.3})`;
    g.lineWidth = 0.8 + r() * 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 50); g.stroke();
  }
  grain(g, S, S, r, 40, 20000, 1.6);
  return toTex(c);
}

export function waterNormals() {
  // 水面のさざ波（法線マップ）。いくつかの波を重ねて、継ぎ目なく並ぶように作る
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(21);
  const waves = [];
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((r() - 0.5) * 12), ky = Math.round((r() - 0.5) * 12);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 0.4 + r(), p: r() * 6.28 });
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const w of waves) {
      const ph = ((w.kx * x + w.ky * y) / S) * 6.283 + w.p;
      const cph = Math.cos(ph) * w.a;
      dx += cph * w.kx; dy += cph * w.ky;
    }
    const nx = -dx * 0.05, ny = -dy * 0.05, nz = 1;
    const L = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    img.data[i] = ((nx / L) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((ny / L) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((nz / L) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, { srgb: false });
}

// ---------------------------------------------------------------- 建物の壁
// 1 枚 = 幅 4m（1 スパン）。下半分が 1 階（店の入口・アーチ）、上半分が 2 階以上の 1 階分。
// 壁は白っぽく描き、頂点の色（建物ごとの壁の色）を掛ける。夜は窓だけ光らせる（emissive）
const FW = 256, FH = 512;
export function facadeTex(style) {
  const [c, g] = canvas(FW, FH);
  const [ce, ge] = canvas(FW, FH);
  const r = rng(style.length * 31 + 7);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, FW, FH);
  const S = STYLES[style] || STYLES.med;
  // 壁
  g.fillStyle = S.wall; g.fillRect(0, 0, FW, FH);
  S.surface?.(g, r);
  grain(g, FW, FH, r, 14, 5000, 1.5);
  // 上の階（上半分: y 0..256）
  S.upper(g, ge, r);
  // 1 階（下半分: y 256..512）
  S.ground(g, ge, r);
  // 階の境の帯
  if (S.band) {
    g.fillStyle = S.band;
    g.fillRect(0, 248, FW, 10);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 258, FW, 3);
  }
  return { map: toTex(c), emissive: toTex(ce) };
}

// 窓を描く小道具
function win(g, ge, x, y, w, h, o = {}) {
  const { frame = '#f4efe6', glass = '#2b3440', shape = 'rect', shutters = null, sill = true, mull = true, lit = 0.8 } = o;
  const path = (ctx, pad = 0) => {
    ctx.beginPath();
    if (shape === 'arch') {
      ctx.moveTo(x + pad, y + h - pad); ctx.lineTo(x + pad, y + w / 2);
      ctx.arc(x + w / 2, y + w / 2, w / 2 - pad, Math.PI, 0);
      ctx.lineTo(x + w - pad, y + h - pad); ctx.closePath();
    } else if (shape === 'pointed') {
      ctx.moveTo(x + pad, y + h - pad); ctx.lineTo(x + pad, y + w * 0.6);
      ctx.quadraticCurveTo(x + pad, y + pad, x + w / 2, y + pad - w * 0.15);
      ctx.quadraticCurveTo(x + w - pad, y + pad, x + w - pad, y + w * 0.6);
      ctx.lineTo(x + w - pad, y + h - pad); ctx.closePath();
    } else if (shape === 'round') {
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 - pad, 0, Math.PI * 2);
    } else {
      ctx.rect(x + pad, y + pad, w - pad * 2, h - pad * 2);
    }
  };
  if (shutters) {
    g.fillStyle = shutters;
    g.fillRect(x - w * 0.42, y + (shape === 'arch' ? w * 0.3 : 0), w * 0.38, h - (shape === 'arch' ? w * 0.3 : 0));
    g.fillRect(x + w * 1.04, y + (shape === 'arch' ? w * 0.3 : 0), w * 0.38, h - (shape === 'arch' ? w * 0.3 : 0));
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
    for (let k = 1; k < 8; k++) {
      const yy = y + (h * k) / 8;
      g.beginPath(); g.moveTo(x - w * 0.42, yy); g.lineTo(x - w * 0.04, yy); g.moveTo(x + w * 1.04, yy); g.lineTo(x + w * 1.42, yy); g.stroke();
    }
  }
  g.fillStyle = frame; path(g, -4); g.fill();
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, glass); grd.addColorStop(0.55, '#4b5b6b'); grd.addColorStop(1, glass);
  g.fillStyle = grd; path(g, 0); g.fill();
  // 空の映り込み
  g.fillStyle = 'rgba(200,220,240,0.18)'; g.beginPath(); g.moveTo(x + 3, y + h * 0.15); g.lineTo(x + w * 0.5, y + h * 0.15); g.lineTo(x + 3, y + h * 0.6); g.fill();
  if (mull && shape !== 'round') {
    g.strokeStyle = frame; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x + w / 2, y + 2); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h * 0.45); g.lineTo(x + w, y + h * 0.45); g.stroke();
  }
  if (sill) { g.fillStyle = frame; g.fillRect(x - 6, y + h, w + 12, 6); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 6, y + h + 6, w + 12, 3); }
  if (lit > 0 && ge) {
    const v = Math.round(160 + 90 * lit);
    ge.fillStyle = `rgb(${v},${Math.round(v * 0.78)},${Math.round(v * 0.48)})`;
    path(ge, 1); ge.fill();
  }
}
function door(g, ge, x, y, w, h, o = {}) {
  const { color = '#4a3424', shape = 'arch', awning = null, glass = true } = o;
  if (awning) {
    g.fillStyle = awning;
    g.beginPath(); g.moveTo(x - 14, y - 30); g.lineTo(x + w + 14, y - 30); g.lineTo(x + w + 22, y + 6); g.lineTo(x - 22, y + 6); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let k = 0; k < 6; k++) g.fillRect(x - 14 + k * ((w + 28) / 6), y - 30, (w + 28) / 12, 36);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 22, y + 6, w + 44, 8);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 5, y - 5, w + 10, h + 5);
  if (glass) {
    win(g, ge, x, y, w, h, { frame: color, glass: '#38302a', shape, sill: false, mull: true, lit: 1 });
  } else {
    g.fillStyle = color; g.fillRect(x, y, w, h);
  }
}

const STYLES = {
  // メディテレーニアンハーバー: 漆喰の壁・緑の鎧戸・1 階はアーチの店先
  med: {
    wall: '#f3eee4', band: '#e9dfcc',
    upper(g, ge, r) {
      win(g, ge, 92, 70, 72, 120, { shutters: '#5d8a6e', frame: '#efe6d5', shape: r() < 0.5 ? 'rect' : 'arch' });
      // 小さなバルコニー
      g.fillStyle = '#3c3a38'; g.fillRect(78, 192, 100, 5);
      for (let x = 80; x < 178; x += 9) g.fillRect(x, 168, 2, 26);
      g.fillRect(78, 166, 100, 3);
      // 軒下の飾り
      g.fillStyle = 'rgba(160,120,80,0.35)'; g.fillRect(0, 0, FW, 10);
    },
    ground(g, ge, r) {
      g.fillStyle = '#e8dccb'; g.fillRect(0, 440, FW, 72);
      door(g, ge, 68, 330, 120, 182, { shape: 'arch', color: '#6a4a30', awning: r() < 0.5 ? '#2e6b6a' : null });
    },
    surface(g, r) {
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(150,120,90,${0.05 + r() * 0.06})`; g.fillRect(r() * FW, r() * FH, 20 + r() * 60, 10 + r() * 40); }
    },
  },
  // アメリカンウォーターフロント（ニューヨーク）: れんが・白い窓枠・1 階はショーウインドー
  ny: {
    wall: '#f0e9e4', band: '#d8d2c8',
    surface(g, r) {
      const bh = 10, bw = 26;
      for (let y = 0; y < FH; y += bh) {
        const off = (y / bh) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < FW + bw; x += bw) {
          const v = 0.82 + r() * 0.18;
          g.fillStyle = `rgb(${Math.round(198 * v)},${Math.round(130 * v)},${Math.round(110 * v)})`;
          g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
        }
      }
    },
    upper(g, ge, r) {
      // 石のまぐさ
      g.fillStyle = '#e8e2d6';
      g.fillRect(40, 52, 70, 12); g.fillRect(146, 52, 70, 12);
      win(g, ge, 46, 64, 58, 130, { frame: '#f2efe8' });
      win(g, ge, 152, 64, 58, 130, { frame: '#f2efe8' });
      g.fillStyle = '#d8d0c2'; g.fillRect(0, 0, FW, 12);
    },
    ground(g, ge, r) {
      g.fillStyle = '#3a3532'; g.fillRect(0, 268, FW, 244);
      g.fillStyle = '#e4dccd'; g.fillRect(0, 268, FW, 26);
      g.fillStyle = r() < 0.5 ? '#7a2a28' : '#2d4a3a';
      g.fillRect(6, 294, FW - 12, 18);
      win(g, ge, 18, 330, 100, 150, { frame: '#24201e', mull: true, sill: false, lit: 1 });
      win(g, ge, 138, 330, 100, 182, { frame: '#24201e', mull: true, sill: false, lit: 1 });
    },
  },
  // ケープコッド: 下見板（横の板張り）・白い窓枠
  capecod: {
    wall: '#f6f4ef', band: null,
    surface(g, r) {
      for (let y = 0; y < FH; y += 14) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, y + 11, FW, 3); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, y, FW, 2); }
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 8, FH); g.fillRect(FW - 8, 0, 8, FH);
    },
    upper(g, ge) { win(g, ge, 88, 70, 80, 120, { frame: '#ffffff', shutters: '#2f4a64' }); },
    ground(g, ge, r) {
      if (r() < 0.6) door(g, ge, 92, 360, 72, 152, { shape: 'rect', color: '#ffffff', glass: true });
      else win(g, ge, 70, 340, 116, 110, { frame: '#ffffff' });
    },
  },
  // ポートディスカバリー: 金属パネル・丸窓
  pd: {
    wall: '#eef0ee', band: '#c9d4d2',
    surface(g) {
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
      for (let y = 0; y < FH; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(FW, y); g.stroke(); }
      for (let x = 0; x < FW; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, FH); g.stroke(); }
      g.fillStyle = 'rgba(80,90,90,0.35)';
      for (let y = 8; y < FH; y += 64) for (let x = 8; x < FW; x += 16) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    },
    upper(g, ge) { win(g, ge, 78, 60, 100, 100, { shape: 'round', frame: '#9aa8a4', glass: '#1f3a44', sill: false }); },
    ground(g, ge) {
      g.fillStyle = '#2a6a6c'; g.fillRect(0, 286, FW, 14);
      win(g, ge, 30, 330, 196, 120, { frame: '#5a6a68', glass: '#203038', sill: false });
    },
  },
  // ロストリバーデルタ: 古びた漆喰と石・木の窓
  lrd: {
    wall: '#efe6d6', band: '#d6c4a2',
    surface(g, r) {
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(120,90,50,${0.06 + r() * 0.1})`; g.beginPath(); g.ellipse(r() * FW, r() * FH, 10 + r() * 40, 6 + r() * 30, r() * 3, 0, 7); g.fill(); }
      // はがれた漆喰から石が見える
      for (let i = 0; i < 6; i++) {
        const x = r() * FW, y = r() * FH;
        for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(140,110,80,0.5)'; g.fillRect(x + (k % 3) * 16, y + Math.floor(k / 3) * 9, 14, 7); }
      }
    },
    upper(g, ge) { win(g, ge, 90, 70, 76, 108, { frame: '#6e4e30', glass: '#2a241c', shutters: '#7a5a38' }); },
    ground(g, ge) { door(g, ge, 80, 340, 96, 172, { shape: 'rect', color: '#5a3c22' }); },
  },
  // アラビアンコースト: 白い漆喰・尖頭アーチ・格子
  arab: {
    wall: '#fbf6ec', band: '#e3c78f',
    surface(g, r) {
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(200,160,100,${0.04 + r() * 0.06})`; g.fillRect(r() * FW, r() * FH, 30 + r() * 60, 20 + r() * 50); }
    },
    upper(g, ge) {
      win(g, ge, 92, 56, 72, 132, { shape: 'pointed', frame: '#d9b26a', glass: '#2a3640', mull: false });
      // 格子（マシュラビーヤ）
      g.strokeStyle = 'rgba(120,80,40,0.8)'; g.lineWidth = 2;
      for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(96 + k * 10, 100); g.lineTo(96 + k * 10, 186); g.stroke(); }
      g.fillStyle = '#d9b26a'; g.fillRect(0, 0, FW, 14);
      for (let x = 0; x < FW; x += 32) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 16, 30); g.lineTo(x + 32, 14); g.fill(); }
    },
    ground(g, ge) { door(g, ge, 70, 320, 116, 192, { shape: 'pointed', color: '#3a6a8a' }); },
  },
  // マーメイドラグーン: 貝がらのようなパステル・丸い窓
  mermaid: {
    wall: '#fbf1ee', band: '#f0c8b8',
    surface(g) {
      g.strokeStyle = 'rgba(200,120,120,0.25)'; g.lineWidth = 3;
      for (let y = 30; y < FH; y += 60) { g.beginPath(); for (let x = 0; x <= FW; x += 8) g.lineTo(x, y + Math.sin(x / 20) * 8); g.stroke(); }
    },
    upper(g, ge) { win(g, ge, 88, 70, 80, 80, { shape: 'round', frame: '#f6d8a8', glass: '#2a4a60', sill: false }); },
    ground(g, ge) { door(g, ge, 80, 340, 96, 172, { shape: 'arch', color: '#c98a5a' }); },
  },
  // ミステリアスアイランド: 鉄と石
  mi: {
    wall: '#e2dcd4', band: '#8a6a50',
    surface(g, r) {
      for (let y = 0; y < FH; y += 32) for (let x = (y / 32) % 2 ? -24 : 0; x < FW; x += 48) {
        const v = 0.8 + r() * 0.2;
        g.fillStyle = `rgb(${Math.round(190 * v)},${Math.round(170 * v)},${Math.round(150 * v)})`;
        g.fillRect(x + 1, y + 1, 46, 30);
      }
    },
    upper(g, ge) { win(g, ge, 96, 70, 64, 110, { frame: '#5a4a3a', glass: '#1e2a2a', shape: 'arch' }); },
    ground(g, ge) { door(g, ge, 80, 340, 96, 172, { shape: 'arch', color: '#4a3a2a' }); },
  },
  // ファンタジースプリングス: 北欧の木組み・石の土台
  fs: {
    wall: '#f7f3ea', band: '#7a5a3a',
    upper(g, ge) {
      g.fillStyle = '#6e4e32';
      g.fillRect(0, 0, 12, 256); g.fillRect(FW - 12, 0, 12, 256); g.fillRect(0, 0, FW, 12); g.fillRect(0, 236, FW, 14);
      g.save(); g.translate(0, 0);
      g.lineWidth = 10; g.strokeStyle = '#6e4e32';
      g.beginPath(); g.moveTo(12, 236); g.lineTo(70, 130); g.moveTo(FW - 12, 236); g.lineTo(FW - 70, 130); g.stroke();
      g.restore();
      win(g, ge, 90, 60, 76, 110, { frame: '#ffffff', glass: '#26303a', shutters: '#2e5a8a' });
    },
    ground(g, ge, r) {
      for (let y = 262; y < FH; y += 28) for (let x = (y / 28) % 2 ? -20 : 0; x < FW; x += 40) {
        const v = 0.78 + r() * 0.22;
        g.fillStyle = `rgb(${Math.round(176 * v)},${Math.round(170 * v)},${Math.round(160 * v)})`;
        g.fillRect(x + 1, y + 1, 38, 26);
      }
      door(g, ge, 84, 340, 88, 172, { shape: 'arch', color: '#5a3a24' });
    },
  },
  // 奥の大きな建物（ショービル）: 窓のないパネル
  plain: {
    wall: '#ece6dc', band: null,
    surface(g) {
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
      for (let x = 0; x < FW; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, FH); g.stroke(); }
    },
    upper() {}, ground() {},
  },
};
export const FACADE_STYLES = Object.keys(STYLES);
