// web/static/lib/cassette-geom.js
// A take as a cassette, in numbers: the stripe printed on its J-card, the date
// stamped on its label, how much tape sits on each reel, and where every part
// of the face sits. Pure, so the spine, the face and their tests share one
// source; the numbers are the design canvas's (cassette.py, takes2.py).

import { greaseStroke } from './wave/grease.js';

/** stripeOf gives a take one of the five printed stripes, by its name. */
export function stripeOf(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 5) + 1;
}

/**
 * packRadii is the radius of the tape on the left and right reels with
 * `frac` of the take played: tape moves from left to right, and a pack's area
 * is its length of tape, so the radii trade area for area.
 */
export function packRadii(frac, rMin, rMax) {
  const f = Math.min(1, Math.max(0, frac));
  const span = rMax * rMax - rMin * rMin;
  return [Math.sqrt(rMin * rMin + span * (1 - f)), Math.sqrt(rMin * rMin + span * f)];
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** stampOf is the label's date stamp, 'SUN 4 OCT · 20:15', from the take's name. */
export function stampOf(take) {
  const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(take.name || '');
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const day = new Date(Number(y), Number(mo) - 1, Number(d)).getDay();
  return `${DAYS[day]} ${Number(d)} ${MONTHS[Number(mo) - 1]} · ${hh}:${mm}`;
}

// The two cassettes the design draws: a desk one 786 wide, a phone one 358.
const KINDS = {
  desk: { H: 300, lx: 34, ly: 22, lh: 218, band: 34, titleTop: 46, titleSize: 25, wx: 40, wy: 98, wh: 104, rc: 60, hub: 1,
    pitch: 4, half: 40, rMin: 22, rMax: 44, gap: 14, markTop: 13, markBottom: 12, hook: 6, bw: 340, bh: 50, sr: 6, si: 16, stamp: 12, brand: 14, side: 26, radius: 20, marks: 12 },
  phone: { H: 228, lx: 14, ly: 14, lh: 168, band: 26, titleTop: 33, titleSize: 19, wx: 14, wy: 72, wh: 84, rc: 40, hub: 0.72,
    pitch: 3.5, half: 30, rMin: 15, rMax: 30, gap: 6, markTop: 10, markBottom: 10, hook: 5, bw: 196, bh: 34, sr: 4.5, si: 9, stamp: 10.5, brand: 11.5, side: 20, radius: 14, marks: 10.5 },
};

/**
 * windowLayout places a cassette face `W` px wide: its label, its window, and
 * in the window the hubs, the packs and the bars. The bars fill the window
 * between the fullest packs, so a wider cassette holds more of them.
 */
export function windowLayout(W, kind = 'desk') {
  const k = KINDS[kind] || KINDS.desk;
  const lw = W - 2 * k.lx;
  const ww = lw - 2 * k.wx;
  const x0 = k.rc + k.rMax + k.gap;
  const n = Math.max(1, Math.floor((ww - 2 * x0) / k.pitch) + 1);
  return {
    kind, W, H: k.H, radius: k.radius,
    label: { x: k.lx, y: k.ly, w: lw, h: k.lh, band: k.band, titleTop: k.titleTop, titleSize: k.titleSize, stamp: k.stamp, brand: k.brand, side: k.side },
    win: { x: k.wx, y: k.wy, w: ww, h: k.wh, rc: k.rc, hub: k.hub, cy: k.wh / 2, half: k.half, x0, n, pitch: k.pitch, rMin: k.rMin, rMax: k.rMax, marks: k.marks,
      markTop: k.markTop, markBottom: k.wh - k.markBottom, hook: k.hook },
    screws: { r: k.sr, inset: k.si },
    foot: { w: k.bw, h: k.bh },
  };
}

/** playedX is where `frac` of the take sits along the window's bars. */
export function playedX(frac, L) {
  const f = Math.min(1, Math.max(0, frac));
  return L.win.x0 + f * (L.win.n - 1) * L.win.pitch;
}

/** fracAt reads an x in the window back as a place in the take (0..1). */
export function fracAt(x, L) {
  const span = (L.win.n - 1) * L.win.pitch;
  return span > 0 ? Math.min(1, Math.max(0, (x - L.win.x0) / span)) : 0;
}

/**
 * inOutLabels places IN and OUT just inside a selection ({start, end} as
 * fractions), or gives null when it's too narrow to hold them (64 px, as the
 * design) or there is none.
 */
export function inOutLabels(sel, L) {
  if (!sel) return null;
  const x0 = playedX(sel.start, L), x1 = playedX(sel.end, L);
  if (x1 - x0 <= 64) return null;
  return { inX: Math.round(x0 + 2), outX: Math.round(x1 - 2) };
}

/**
 * greaseMark is an edit point's grease-pencil stroke down the window at x: a
 * wobbling line (seeded, so it stays put) with a short hook at each end
 * pointing `dir` (+1 for IN, into the selection; -1 for OUT).
 */
export function greaseMark(x, dir, seed, L) {
  const { markTop: top, markBottom: bottom, hook } = L.win;
  return [[x + dir * hook, top + 1], ...greaseStroke(x, top, bottom, seed), [x + dir * hook, bottom - 1]];
}
