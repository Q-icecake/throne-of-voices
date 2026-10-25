/**
 * Temporary hand-built court scene (structure study, not final art).
 * One-point perspective, 1920×1080 design space, vanishing point at (960, 400).
 * Three depth layers share the same coordinate space so they can be swapped for painted art
 * one slot at a time (see assets.ts). Nothing here reads or changes game state.
 */
export const VIEW_W = 1920;
export const VIEW_H = 1080;
const VP = { x: 960, y: 400 };

// Depth helpers: k = 1 at the back wall, larger toward the viewer.
const floorY = (k: number) => VP.y + 250 * k;
const ceilY = (k: number) => VP.y - 290 * k;
const sideX = (k: number, side: -1 | 1, inset = 430) => VP.x + side * inset * k;

const svgOpen = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`;

function pillar(k: number, side: -1 | 1): string {
  const cx = sideX(k, side);
  const w = 34 * k;
  const top = Math.max(ceilY(k) - 40, -60);
  const bottom = floorY(k);
  const x = cx - w / 2;
  const baseW = w * 1.5;
  return `
    <g class="pillar">
      <rect x="${x}" y="${top}" width="${w}" height="${bottom - top}" fill="url(#lacquer)"/>
      <rect x="${x + w * 0.18}" y="${top}" width="${w * 0.1}" height="${bottom - top}" fill="#c4614a" opacity=".22"/>
      <rect x="${x}" y="${bottom - w * 0.9}" width="${w}" height="${w * 0.12}" fill="#b49a63" opacity=".55"/>
      <path d="M${cx - baseW / 2} ${bottom} L${cx - w / 2} ${bottom - w * 0.45} L${cx + w / 2} ${bottom - w * 0.45} L${cx + baseW / 2} ${bottom} Z" fill="#3a332b"/>
      <ellipse cx="${cx}" cy="${bottom + 2}" rx="${baseW * 0.62}" ry="${w * 0.12}" fill="#000" opacity=".35"/>
    </g>`;
}

function beam(k: number, y: number, h: number): string {
  const x1 = sideX(k, -1) - 40 * k;
  const x2 = sideX(k, 1) + 40 * k;
  return `
    <g class="beam">
      <rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" fill="#2a1f19"/>
      <rect x="${x1}" y="${y + h * 0.18}" width="${x2 - x1}" height="${h * 0.16}" fill="#6e2a22"/>
      <rect x="${x1}" y="${y + h * 0.38}" width="${x2 - x1}" height="${h * 0.24}" fill="url(#cloudband)"/>
      <rect x="${x1}" y="${y + h * 0.66}" width="${x2 - x1}" height="${h * 0.1}" fill="#b49a63" opacity=".55"/>
    </g>`;
}

function sideHanging(k1: number, k2: number, side: -1 | 1, fill: string): string {
  // A silk hanging on the side wall between two depths, with vertical folds.
  const at = (t: number) => {
    const k = k1 + (k2 - k1) * t;
    return { x: sideX(k, side, 455), top: ceilY(k) + 110 * k, bottom: floorY(k) - 150 * k };
  };
  const folds: string[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const p = at(i / n), q = at((i + 1) / n);
    const shade = i % 2 ? '#000' : '#fff';
    folds.push(`<path d="M${p.x} ${p.top} L${q.x} ${q.top} L${q.x} ${q.bottom} L${p.x} ${p.bottom} Z" fill="${shade}" opacity="${i % 2 ? 0.28 : 0.05}"/>`);
  }
  const p0 = at(0), p1 = at(1);
  return `
    <path d="M${p0.x} ${p0.top} L${p1.x} ${p1.top} L${p1.x} ${p1.bottom} L${p0.x} ${p0.bottom} Z" fill="${fill}"/>
    ${folds.join('')}
    <path d="M${p0.x} ${p0.top} L${p1.x} ${p1.top} L${p1.x} ${p1.top + 14 * k2} L${p0.x} ${p0.top + 14 * k1} Z" fill="#b49a63" opacity=".45"/>
    <path d="M${p0.x} ${p0.bottom - 26 * k1} L${p1.x} ${p1.bottom - 26 * k2} L${p1.x} ${p1.bottom} L${p0.x} ${p0.bottom} Z" fill="#0d0a08" opacity=".5"/>`;
}

function latticeWindow(x: number, y: number, w: number, h: number): string {
  const bars: string[] = [];
  for (let i = 1; i < 6; i++) bars.push(`<rect x="${x + (w * i) / 6 - 2}" y="${y}" width="4" height="${h}" fill="#2a1f19"/>`);
  for (let j = 1; j < 9; j++) bars.push(`<rect x="${x}" y="${y + (h * j) / 9 - 2}" width="${w}" height="4" fill="#2a1f19"/>`);
  return `
    <rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" fill="#2a1f19"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#windowlight)"/>
    ${bars.join('')}`;
}

function bronzeLamp(cx: number, baseY: number, s: number): string {
  return `
    <g class="lamp">
      <ellipse cx="${cx}" cy="${baseY}" rx="${34 * s}" ry="${8 * s}" fill="#000" opacity=".35"/>
      <path d="M${cx - 30 * s} ${baseY} Q${cx} ${baseY - 26 * s} ${cx + 30 * s} ${baseY} Z" fill="#5d4a2c"/>
      <rect x="${cx - 4 * s}" y="${baseY - 170 * s}" width="${8 * s}" height="${150 * s}" fill="#6b5631"/>
      <path d="M${cx - 26 * s} ${baseY - 170 * s} Q${cx} ${baseY - 150 * s} ${cx + 26 * s} ${baseY - 170 * s} Z" fill="#8a7040"/>
      <ellipse cx="${cx}" cy="${baseY - 186 * s}" rx="${120 * s}" ry="${120 * s}" fill="url(#flameglow)"/>
      <path d="M${cx} ${baseY - 200 * s} q${6 * s} ${12 * s} 0 ${20 * s} q${-6 * s} ${-8 * s} 0 ${-20 * s} Z" fill="#ffd58a"/>
    </g>`;
}

const DEFS = `
  <defs>
    <linearGradient id="lacquer" x1="0" x2="1">
      <stop offset="0" stop-color="#3d1712"/><stop offset=".3" stop-color="#7a2e22"/>
      <stop offset=".7" stop-color="#5e2219"/><stop offset="1" stop-color="#2a0f0b"/>
    </linearGradient>
    <linearGradient id="backwall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1713"/><stop offset=".55" stop-color="#33271e"/><stop offset="1" stop-color="#241b15"/>
    </linearGradient>
    <linearGradient id="sidewallL" x1="0" x2="1">
      <stop offset="0" stop-color="#0f0c0a"/><stop offset="1" stop-color="#2a2019"/>
    </linearGradient>
    <linearGradient id="sidewallR" x1="1" x2="0">
      <stop offset="0" stop-color="#0f0c0a"/><stop offset="1" stop-color="#2a2019"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b2c20"/><stop offset=".5" stop-color="#2a1f17"/><stop offset="1" stop-color="#140f0b"/>
    </linearGradient>
    <linearGradient id="ceiling" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#1f1813"/><stop offset="1" stop-color="#0b0807"/>
    </linearGradient>
    <linearGradient id="windowlight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6dfaa"/><stop offset="1" stop-color="#c99a58"/>
    </linearGradient>
    <linearGradient id="shaft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe7b0" stop-opacity=".22"/><stop offset="1" stop-color="#ffe7b0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="runner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a4a2e"/><stop offset="1" stop-color="#3c3020"/>
    </linearGradient>
    <linearGradient id="screenpanel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9c9a0"/><stop offset="1" stop-color="#b8a47a"/>
    </linearGradient>
    <linearGradient id="curtain" x1="0" x2="1">
      <stop offset="0" stop-color="#3a1714"/><stop offset=".5" stop-color="#6a2620"/><stop offset="1" stop-color="#3a1714"/>
    </linearGradient>
    <radialGradient id="flameglow">
      <stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset=".4" stop-color="#ff9e4a" stop-opacity=".14"/>
      <stop offset="1" stop-color="#ff9e4a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="daislight" cx=".5" cy=".55" r=".5">
      <stop offset="0" stop-color="#f3c77e" stop-opacity=".32"/><stop offset="1" stop-color="#f3c77e" stop-opacity="0"/>
    </radialGradient>
    <pattern id="cloudband" width="60" height="20" patternUnits="userSpaceOnUse">
      <rect width="60" height="20" fill="#1f3a34"/>
      <path d="M0 14 q10 -12 20 0 t20 0 t20 0" stroke="#b49a63" stroke-width="2" fill="none" opacity=".7"/>
    </pattern>
    <pattern id="mat" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="#4a3c25"/>
      <path d="M0 6h24M0 18h24" stroke="#5a4a2e" stroke-width="3"/>
    </pattern>
  </defs>`;

function screenPanels(): string {
  // Three-panel folding screen (屛風) with a simple ink-wash landscape.
  const panels: string[] = [];
  const x0 = 800, w = 106, gap = 6, y0 = 300, h = 270;
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * (w + gap);
    panels.push(`<rect x="${x}" y="${y0}" width="${w}" height="${h}" fill="url(#screenpanel)"/>`);
  }
  return `
    <rect x="${x0 - 14}" y="${y0 - 14}" width="${3 * w + 2 * gap + 28}" height="${h + 28}" fill="#1a1210"/>
    ${panels.join('')}
    <g fill="none" stroke="#3b3a33" stroke-linecap="round" opacity=".75">
      <path d="M806 520 L846 430 L872 470 L910 380 L944 450 L972 410 L1010 480 L1046 400 L1080 470 L1114 440" stroke-width="4"/>
      <path d="M806 545 L860 500 L900 525 L960 480 L1020 520 L1070 495 L1114 520" stroke-width="2.5" opacity=".6"/>
    </g>
    <circle cx="1070" cy="345" r="16" fill="#9b3b2e" opacity=".8"/>
    ${[0, 1, 2].map(i => `<rect x="${x0 + i * (w + gap)}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#5c4428" stroke-width="3"/>`).join('')}`;
}

function canopy(): string {
  // Silk canopy (帷帳) draped over the dais: frames the ruler's seat as the focal point.
  return `
    <path d="M720 118 L1200 118 L1200 150 Q1080 210 960 170 Q840 210 720 150 Z" fill="url(#curtain)"/>
    <path d="M720 150 Q840 210 960 170 Q1080 210 1200 150" fill="none" stroke="#b49a63" stroke-width="3" opacity=".7"/>
    <path d="M720 118 L770 118 Q760 300 752 470 Q744 540 730 600 L702 600 Q716 420 720 118 Z" fill="url(#curtain)"/>
    <path d="M1200 118 L1150 118 Q1160 300 1168 470 Q1176 540 1190 600 L1218 600 Q1204 420 1200 118 Z" fill="url(#curtain)"/>
    <rect x="740" y="455" width="30" height="8" fill="#b49a63"/>
    <rect x="1150" y="455" width="30" height="8" fill="#b49a63"/>`;
}

function dais(): string {
  return `
    <ellipse cx="960" cy="520" rx="330" ry="220" fill="url(#daislight)"/>
    <path d="M700 650 L1220 650 L1236 676 L684 676 Z" fill="#3a2a1f"/>
    <rect x="684" y="676" width="552" height="14" fill="#1d1510"/>
    <path d="M740 600 L1180 600 L1200 650 L720 650 Z" fill="#4a3627"/>
    <rect x="720" y="638" width="480" height="12" fill="#22180f"/>
    <rect x="740" y="596" width="440" height="6" fill="#b49a63" opacity=".55"/>
    <!-- low couch (榻) -->
    <path d="M846 584 L1074 584 L1084 604 L836 604 Z" fill="#1c1210"/>
    <rect x="836" y="604" width="248" height="16" fill="#6e2a22"/>
    <rect x="842" y="620" width="10" height="16" fill="#1c1210"/><rect x="1068" y="620" width="10" height="16" fill="#1c1210"/>`;
}

function floorDetail(): string {
  const lines: string[] = [];
  for (let i = -12; i <= 12; i++) {
    const xb = VP.x + i * 46;
    const k = (VIEW_H - VP.y) / 250;
    const xf = VP.x + (xb - VP.x) * k;
    lines.push(`<path d="M${xb} 650 L${xf} ${VIEW_H}" stroke="#1a130e" stroke-width="2" opacity=".55"/>`);
  }
  // Central mat runner (席) leading to the dais; lines converge on the vanishing point.
  const half = (k: number) => 90 * k;
  const kf = (VIEW_H - VP.y) / 250;
  return `
    ${lines.join('')}
    <path d="M${960 - half(1.1)} ${floorY(1.1)} L${960 + half(1.1)} ${floorY(1.1)} L${960 + half(kf)} ${VIEW_H} L${960 - half(kf)} ${VIEW_H} Z" fill="url(#mat)" opacity=".9"/>
    <path d="M${960 - half(1.1)} ${floorY(1.1)} L${960 - half(kf)} ${VIEW_H}" stroke="#b49a63" stroke-width="4" opacity=".5"/>
    <path d="M${960 + half(1.1)} ${floorY(1.1)} L${960 + half(kf)} ${VIEW_H}" stroke="#b49a63" stroke-width="4" opacity=".5"/>
    <path d="M${960 - half(1.1)} ${floorY(1.1)} L${960 + half(1.1)} ${floorY(1.1)} L${960 + half(kf)} ${VIEW_H} L${960 - half(kf)} ${VIEW_H} Z" fill="url(#runner)" opacity=".35"/>
    <!-- speaker's place: a single square mat in front of the dais -->
    <path d="M880 772 L1040 772 L1068 828 L852 828 Z" fill="#5a2a22" opacity=".85"/>
    <path d="M880 772 L1040 772 L1068 828 L852 828 Z" fill="none" stroke="#b49a63" stroke-width="2" opacity=".6"/>`;
}

export function backLayerSvg(): string {
  return `${svgOpen('scene-svg')}${DEFS}
    <path d="M326 0 L1594 0 L1420 110 L500 110 Z" fill="url(#ceiling)"/>
    ${[-3, -2, -1, 0, 1, 2, 3].map(i => `<path d="M${960 + i * 130} 110 L${960 + i * 330} 0" stroke="#2a1f19" stroke-width="10"/>`).join('')}
    <path d="M0 0 L326 0 L500 110 L500 650 L0 922 Z" fill="url(#sidewallL)"/>
    <path d="M1920 0 L1594 0 L1420 110 L1420 650 L1920 922 Z" fill="url(#sidewallR)"/>
    <rect x="500" y="110" width="920" height="540" fill="url(#backwall)"/>
    ${[560, 740, 1180, 1360].map(x => `<rect x="${x - 6}" y="110" width="12" height="540" fill="#1a130f" opacity=".7"/>`).join('')}
    <rect x="500" y="610" width="920" height="40" fill="#1a130f"/>
    <path d="M0 922 L500 650 L1420 650 L1920 922 L1920 1080 L0 1080 Z" fill="url(#floor)"/>
    ${floorDetail()}
    ${latticeWindow(574, 230, 140, 300)}
    ${latticeWindow(1206, 230, 140, 300)}
    <path d="M574 230 L714 230 L1000 1080 L560 1080 Z" fill="url(#shaft)"/>
    <path d="M1206 230 L1346 230 L1380 1080 L980 1080 Z" fill="url(#shaft)" opacity=".7"/>
    ${sideHanging(1.18, 1.42, -1, '#22302b')}
    ${sideHanging(1.18, 1.42, 1, '#22302b')}
    ${sideHanging(1.6, 1.95, -1, '#3a1d1a')}
    ${sideHanging(1.6, 1.95, 1, '#3a1d1a')}
    ${screenPanels()}
    ${dais()}
    ${canopy()}
    ${beam(1.12, 88, 34)}
    ${pillar(1.12, -1)}${pillar(1.12, 1)}
    ${bronzeLamp(660, 700, 0.9)}${bronzeLamp(1275, 700, 0.9)}
    ${pillar(1.5, -1)}${pillar(1.5, 1)}
    ${beam(1.5, -6, 44)}
  </svg>`;
}

// ---- figures (mid layer) ----

interface RobeStyle { robe: string; inner: string; trim: string; sash: string; cap: string }

/** Standing official in a crossed-collar robe with wide sleeves; faces left when `faceLeft`. */
function standingFigure(cx: number, feetY: number, h: number, style: RobeStyle, faceLeft: boolean, extra = ''): string {
  const s = h / 360;
  const dir = faceLeft ? -1 : 1;
  const T = (x: number, y: number) => `${cx + x * s * dir} ${feetY - y * s}`;
  return `
    <g class="figure">
      <ellipse cx="${cx}" cy="${feetY + 3 * s}" rx="${70 * s}" ry="${12 * s}" fill="#000" opacity=".45"/>
      <path d="M${T(-62, 0)} L${T(-44, 210)} Q${T(-40, 262)} ${T(-20, 282)} L${T(22, 282)} Q${T(44, 262)} ${T(46, 210)} L${T(66, 0)} Z" fill="${style.robe}"/>
      <path d="M${T(-62, 0)} L${T(66, 0)} L${T(64, 14)} L${T(-60, 14)} Z" fill="${style.trim}"/>
      <path d="M${T(-22, 282)} L${T(14, 150)} L${T(30, 160)} L${T(18, 282)} Z" fill="${style.inner}"/>
      <path d="M${T(-24, 282)} L${T(16, 146)}" stroke="${style.trim}" stroke-width="${7 * s}"/>
      <rect x="${Math.min(cx - 46 * s, cx + 46 * s * dir) - (dir < 0 ? 0 : 0)}" y="${feetY - 168 * s}" width="${92 * s}" height="${14 * s}" fill="${style.sash}"/>
      <path d="M${T(-40, 262)} Q${T(-92, 210)} ${T(-80, 120)} L${T(-44, 112)} Q${T(-30, 180)} ${T(-10, 210)} Z" fill="${style.robe}" opacity=".92"/>
      <path d="M${T(36, 262)} Q${T(86, 214)} ${T(70, 128)} L${T(28, 122)} Q${T(18, 190)} ${T(4, 214)} Z" fill="${style.robe}"/>
      <path d="M${T(70, 128)} L${T(28, 122)} L${T(30, 112)} L${T(74, 116)} Z" fill="${style.trim}"/>
      <path d="M${T(-80, 120)} L${T(-44, 112)} L${T(-46, 102)} L${T(-84, 108)} Z" fill="${style.trim}"/>
      <rect x="${cx - 9 * s}" y="${feetY - 298 * s}" width="${18 * s}" height="${18 * s}" fill="#b98c6a"/>
      <ellipse cx="${cx + 4 * s * dir}" cy="${feetY - 318 * s}" rx="${21 * s}" ry="${25 * s}" fill="#c99b76"/>
      <path d="M${T(-18, 330)} Q${T(4, 344)} ${T(24, 326)} L${T(22, 340)} Q${T(0, 356)} ${T(-20, 340)} Z" fill="#1b1714"/>
      <path d="M${T(-16, 340)} L${T(-14, 368)} L${T(20, 362)} L${T(18, 338)} Z" fill="${style.cap}"/>
      <path d="M${T(-14, 368)} L${T(-30, 380)} L${T(-26, 384)} L${T(-8, 370)} Z" fill="${style.cap}"/>
      ${extra}
    </g>`;
}

/** Seated ruler (正坐) on the couch; small because of distance. */
function seatedRuler(cx: number, seatY: number, h: number): string {
  const s = h / 130;
  const P = (x: number, y: number) => `${cx + x * s} ${seatY - y * s}`;
  return `
    <g class="figure ruler">
      <path d="M${P(-52, 0)} Q${P(-56, 30)} ${P(-36, 70)} L${P(-20, 92)} L${P(20, 92)} L${P(36, 70)} Q${P(56, 30)} ${P(52, 0)} Z" fill="#2c2238"/>
      <path d="M${P(-52, 0)} L${P(52, 0)} L${P(50, 6)} L${P(-50, 6)} Z" fill="#b49a63" opacity=".8"/>
      <path d="M${P(-14, 92)} L${P(6, 52)} L${P(14, 56)} L${P(10, 92)} Z" fill="#d8c8a0"/>
      <rect x="${cx - 30 * s}" y="${seatY - 50 * s}" width="${60 * s}" height="${6 * s}" fill="#9b3b2e"/>
      <ellipse cx="${cx}" cy="${seatY - 104 * s}" rx="${11 * s}" ry="${13 * s}" fill="#c99b76"/>
      <path d="M${P(-10, 110)} L${P(-12, 132)} L${P(12, 132)} L${P(10, 110)} Z" fill="#141010"/>
      <rect x="${cx - 18 * s}" y="${seatY - 134 * s}" width="${36 * s}" height="${4 * s}" fill="#141010"/>
    </g>`;
}

function guard(cx: number, feetY: number, h: number, faceLeft: boolean): string {
  const s = h / 360;
  const halberdX = cx + (faceLeft ? -60 : 60) * s;
  const extra = `
    <rect x="${halberdX - 3 * s}" y="${feetY - 430 * s}" width="${6 * s}" height="${430 * s}" fill="#3a2a1a"/>
    <path d="M${halberdX} ${feetY - 470 * s} L${halberdX + 8 * s} ${feetY - 430 * s} L${halberdX - 8 * s} ${feetY - 430 * s} Z" fill="#8f8a7a"/>
    <path d="M${halberdX} ${feetY - 420 * s} L${halberdX + (faceLeft ? -34 : 34) * s} ${feetY - 410 * s} L${halberdX} ${feetY - 398 * s} Z" fill="#8f8a7a"/>`;
  return `<g class="guard">${standingFigure(cx, feetY, h,
    { robe: '#2b2a26', inner: '#4a2a22', trim: '#5c4b32', sash: '#4a2a22', cap: '#1b1714' }, faceLeft, extra)}</g>`;
}

export function midLayerSvg(): string {
  // 장굉 stands at the ruler's left hand, just in front of the dais, turned toward the seat.
  const zhangHong = standingFigure(1130, 780, 285,
    { robe: '#2f4a44', inner: '#d8c8a0', trim: '#1c2a27', sash: '#7a5a2e', cap: '#151311' }, true,
    `<g transform="translate(1080 625) scale(.79)"><rect width="30" height="54" rx="3" fill="#a9915c"/>${[6, 12, 18, 24].map(x => `<rect x="${x}" y="0" width="1.5" height="54" fill="#6e5a34"/>`).join('')}<rect x="-2" y="18" width="34" height="5" fill="#5c3a22"/></g>
     <path d="M1121 546 q-3 20 5 34 q8 -12 5 -34 Z" fill="#d4d0c8" opacity=".85"/>`);
  return `${svgOpen('scene-svg')}
    ${guard(530, 690, 190, false)}
    ${guard(1390, 690, 190, true)}
    <g class="ruler-placement">${seatedRuler(960, 600, 132)}</g>
    <g class="figure-zhang-hong">${zhangHong}</g>
  </svg>`;
}

// ---- foreground (front layer) ----

export function frontLayerSvg(): string {
  return `${svgOpen('scene-svg')}
    <defs>
      <linearGradient id="desktop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a1714"/><stop offset="1" stop-color="#1e0b09"/>
      </linearGradient>
      <radialGradient id="vignette" cx=".5" cy=".45" r=".75">
        <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/>
      </radialGradient>
    </defs>
    <!-- low lacquered document table (案) at lower left -->
    <g class="desk">
      <path d="M-20 900 L520 872 L600 948 L-20 990 Z" fill="url(#desktop)"/>
      <path d="M-20 990 L600 948 L600 966 L-20 1012 Z" fill="#120706"/>
      <path d="M-20 900 L520 872" stroke="#b49a63" stroke-width="3" opacity=".6"/>
      <rect x="520" y="958" width="22" height="100" fill="#120706"/>
      <!-- bamboo slips (documents) -->
      <g class="prop-documents">
        <path d="M150 912 L300 900 L310 930 L160 944 Z" fill="#b59d66"/>
        ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<path d="M${160 + i * 18} ${911 - i * 1.4} L${170 + i * 18} ${942 - i * 1.4}" stroke="#7a6436" stroke-width="2"/>`).join('')}
        <path d="M152 922 L304 910" stroke="#5c3a22" stroke-width="4"/>
        <ellipse cx="350" cy="912" rx="34" ry="14" fill="#a8905a"/><ellipse cx="350" cy="912" rx="12" ry="6" fill="#6e5a34"/>
      </g>
      <!-- rolled silk map in a case -->
      <g class="prop-map">
        <rect x="380" y="880" width="150" height="26" rx="12" transform="rotate(-6 455 893)" fill="#d8c8a0"/>
        <rect x="380" y="880" width="150" height="26" rx="12" transform="rotate(-6 455 893)" fill="none" stroke="#6e5a34" stroke-width="2"/>
        <rect x="372" y="884" width="16" height="30" rx="4" transform="rotate(-6 455 893)" fill="#5c3a22"/>
      </g>
      <!-- inkstone and brush -->
      <rect x="40" y="928" width="70" height="40" rx="6" fill="#1a1a1a"/>
      <ellipse cx="74" cy="944" rx="22" ry="9" fill="#0b0b0b"/>
      <path d="M90 960 L230 950" stroke="#3a2a1a" stroke-width="6" stroke-linecap="round"/>
      <path d="M230 950 L250 948" stroke="#111" stroke-width="7" stroke-linecap="round"/>
    </g>
    <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#vignette)"/>
  </svg>`;
}

