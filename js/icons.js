// オリジナルのアイコン（SVG）。24×24 の白い線画で、色の付いた下地の上に置く
const S = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
const L = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';

export const ICON = {
  // 入口: アーチの門
  entrance: S(`<path ${L} d="M4 20V10a8 8 0 0 1 16 0v10"/><path ${L} d="M8 20v-8a4 4 0 0 1 8 0v8"/><path ${L} d="M2.5 20h19"/>`),
  // アトラクション: ループのあるコースター
  attr: S(`<path ${L} d="M2.5 18.5c3 0 4-9 8-9 3 0 3.6 3.8 1.6 4.6-2.2.9-3.6-2.3-.8-4.8C13.8 7 17 5 21.5 5"/><path ${L} d="M5 18.5V21M10 12v9M18 6.2V21"/>`),
  // ショー: 幕のあるステージ
  show: S(`<path ${L} d="M3 4h18"/><path ${L} d="M4 4c0 6 2 10 5 11M20 4c0 6-2 10-5 11"/><path ${L} d="M3 20h18"/><path ${F} d="M12 9.5l1.2 2.3 2.5.4-1.8 1.8.4 2.5-2.3-1.2-2.3 1.2.4-2.5-1.8-1.8 2.5-.4z"/>`),
  // フード: フォークとナイフ
  food: S(`<path ${L} d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6"/><path ${L} d="M17 21V3c-2.2 1.2-3 3.8-3 7 0 2 1 3 3 3"/>`),
  // ショップ: 手さげ袋
  shop: S(`<path ${L} d="M5 8h14l-1 13H6z"/><path ${L} d="M9 10V7a3 3 0 0 1 6 0v3"/>`),
  // トイレ: 男女のピクト
  toilet: S(`<circle ${F} cx="7" cy="4.2" r="2"/><circle ${F} cx="17" cy="4.2" r="2"/><path ${F} d="M5 7.5h4a1 1 0 0 1 1 1V14H8.6v7H5.4v-7H4V8.5a1 1 0 0 1 1-1z"/><path ${F} d="M15.5 7.5h3l2.5 8h-2.3V21h-3.4v-5.5H13z"/><path stroke="currentColor" stroke-width="1.2" opacity=".6" d="M12 3v18"/>`),
  // サービス: 案内の i
  service: S(`<circle ${L} cx="12" cy="12" r="9"/><path ${L} d="M12 11v6"/><circle ${F} cx="12" cy="7.6" r="1.3"/>`),
  // 現在地
  here: S(`<circle ${F} cx="12" cy="12" r="4"/><circle ${L} cx="12" cy="12" r="8"/><path ${L} d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>`),
  moon: S(`<path ${F} d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>`),
  sun: S(`<circle ${F} cx="12" cy="12" r="4.2"/><path ${L} d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>`),
  close: S(`<path ${L} d="M6 6l12 12M18 6L6 18"/>`),
  swap: S(`<path ${L} d="M7 4v16M7 4L3.5 7.5M7 4l3.5 3.5M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5"/>`),
  play: S(`<path ${F} d="M7 4.5v15l12.5-7.5z"/>`),
  list: S(`<path ${L} d="M8 6h13M8 12h13M8 18h13"/><circle ${F} cx="3.5" cy="6" r="1.5"/><circle ${F} cx="3.5" cy="12" r="1.5"/><circle ${F} cx="3.5" cy="18" r="1.5"/>`),
  // 案内（POV・道順）
  straight: S(`<path ${L} stroke-width="2.6" d="M12 20V4M5.5 10.5L12 4l6.5 6.5"/>`),
  right: S(`<path ${L} stroke-width="2.6" d="M6 21V12a4 4 0 0 1 4-4h10M14 2l6 6-6 6"/>`),
  left: S(`<path ${L} stroke-width="2.6" d="M18 21V12a4 4 0 0 0-4-4H4M10 2L4 8l6 6"/>`),
  uturn: S(`<path ${L} stroke-width="2.6" d="M8 21V9a5 5 0 0 1 10 0v4M14 9.5l4 4 4-4"/>`),
  stairs: S(`<path ${L} stroke-width="2.4" d="M3 20h5v-5h5v-5h5V5h3"/>`),
  bridge: S(`<path ${L} stroke-width="2.2" d="M2 15h20M3 15c3-7 15-7 18 0M7 11.5V15M12 10v5M17 11.5V15"/><path ${L} stroke-width="1.6" opacity=".7" d="M2 19c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 6 0"/>`),
  area: S(`<path ${L} d="M5 21V4"/><path ${F} d="M5 4h13l-3 4 3 4H5z"/>`),
  start: S(`<circle ${F} cx="12" cy="12" r="6"/>`),
  goal: S(`<circle ${L} cx="12" cy="12" r="8.5"/><circle ${F} cx="12" cy="12" r="4"/>`),
};

// 案内の矢印（route.js の icon 文字）→ アイコン名
export const NAV_ICON = { '↑': 'straight', '↱': 'right', '↰': 'left', '↶': 'uturn', '⇵': 'stairs', '≋': 'bridge', '◆': 'area', '●': 'start', '◎': 'goal' };
export const navIcon = (ch) => ICON[NAV_ICON[ch]] || ICON.straight;
