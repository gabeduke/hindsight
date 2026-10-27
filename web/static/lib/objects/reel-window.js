// web/static/lib/objects/reel-window.js
// The bar's reel window: two reels either side of the LCD, turning with the
// playhead, their packs filling and emptying over the tape, and the LCD's
// level bars, one per track. A picture of the transport, like the deck it
// replaces: hidden from assistive tech, sized by CSS.
//
// The reels are a scene object (lib/scene): the page's polls are its state,
// the reels model (lib/scene/reels.js, by way of ReelMotion) turns them, and
// reelsDrawer below draws what it derived. A reel's flange is rendered, in
// Blender (spin.js): drawn until its sheet has loaded, then the sheet's
// cell for its angle, and blurred while it winds.

import { ticker } from './motion.js';
import { REEL, spinCell, blurFor, sheetReady } from './spin.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { DomRenderer } from '../scene/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const C = 80, FLANGE = 74;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const setAttrIf = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const circ = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z `;

/** levelFrac is how full a level bar is for dBFS: empty at −40, full 3 dB over ref. */
export function levelFrac(db, ref = -10) {
  if (!(db > -40)) return 0;
  return clamp((db + 40) / (ref + 3 + 40), 0, 1);
}

/**
 * peakDbAt is a take's level at `frac` of the way through it, one value per
 * channel, in dBFS: the loudest edge of that bucket of its peaks (the
 * {buckets, channels, data} that /api/peaks returns, min/max pairs per
 * bucket), times `gain`.
 */
export function peakDbAt(pd, frac, gain = 1) {
  const b = clamp(Math.floor(frac * pd.buckets), 0, pd.buckets - 1);
  const out = [];
  for (let c = 0; c < pd.channels; c++) {
    const d = pd.data[c];
    const a = Math.max(Math.abs(d[2 * b]), Math.abs(d[2 * b + 1])) * gain;
    out.push(a > 0 ? 20 * Math.log10(a) : -Infinity);
  }
  return out;
}

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
}

// One reel: the well, the pack, and the flange that turns, with three
// windows the pack shows through. The flange is two: `drawn`, a path, and
// `frames`, a box one cell of the rendered sheet big, showing the cell for
// the reel's angle. `turn` turns either the rest of the way. The svg's
// `rendered` class says which shows: the drawn one until the sheet has
// loaded (bar.css).
function reel(svg) {
  el('circle', { class: 'np-well', cx: C, cy: C, r: FLANGE + 4 }, svg);
  const pack = el('circle', { class: 'np-pack', cx: C, cy: C, r: 40 }, svg);
  const turn = el('g', { class: 'np-turn' }, svg);
  const drawn = el('g', { class: 'np-drawn' }, turn);
  let d = circ(C, C, FLANGE);
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 - 90) * Math.PI) / 180;
    d += circ(+(C + 42 * Math.cos(a)).toFixed(1), +(C + 42 * Math.sin(a)).toFixed(1), 21);
  }
  el('path', { class: 'np-flange', d, 'fill-rule': 'evenodd' }, drawn);
  el('circle', { class: 'np-hub', cx: C, cy: C, r: 15 }, drawn);
  const frames = el('svg', { class: 'np-frames', width: 2 * C, height: 2 * C, viewBox: `0 0 ${2 * C} ${2 * C}` }, turn);
  const sheet = el('image', { width: REEL.cols * REEL.cell, height: REEL.rows * REEL.cell, x: 0, y: 0, preserveAspectRatio: 'none' }, frames);
  turn.style.transformOrigin = `${C}px ${C}px`;
  drawn.style.transformOrigin = `${C}px ${C}px`;
  return { svg, pack, turn, drawn, sheet, cell: null, base: null };
}

/**
 * turnReel turns one reel to `angle`, drawn as `set` (spin.js): the cell,
 * by where the sheet sits in its box, set only when it changes, as the
 * drawn flange's own turn is; then the rest of the way, every frame.
 */
function turnReel(R, angle, set) {
  const c = spinCell(REEL, angle, set);
  const cell = `${c.col},${c.row}`;
  if (cell !== R.cell) {
    R.cell = cell;
    setAttrIf(R.sheet, 'x', String(-c.col * REEL.cell));
    setAttrIf(R.sheet, 'y', String(-c.row * REEL.cell));
  }
  // The drawn flange stands in until the sheet has loaded, at the cell's angle.
  const base = `rotate(${c.base}deg)`;
  if (base !== R.base) { R.base = base; R.drawn.style.transform = base; }
  R.turn.style.transform = `rotate(${c.rest.toFixed(1)}deg)`;
}

/**
 * The mini player's hairline of how far along the bar is (styles.css,
 * `.np::before`, as wide as --np-progress) is drawn only on a screen this
 * small. Anywhere else nothing reads --np-progress, and setting it each
 * frame restyled the whole bar, being inherited and set on #np: 13-17 ms a
 * frame on a throttled tablet while the tape played. So it's written only
 * where it's drawn, and at once when the screen becomes one where it is.
 * reel-window.test.js holds this to the stylesheet's query.
 */
export const HAIRLINE_MEDIA = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/**
 * progressWriter answers write(fraction) for the bar `np`: --np-progress
 * set while `mq` (HAIRLINE_MEDIA) matches, and the last one set when it
 * comes to. Without matchMedia, always.
 */
export function progressWriter(np, mq = typeof matchMedia === 'function' ? matchMedia(HAIRLINE_MEDIA) : null) {
  let last = null;
  const put = () => { if (np && last !== null) np.style.setProperty('--np-progress', last); };
  mq?.addEventListener?.('change', () => { if (mq.matches) put(); });
  return (v) => { last = String(v); if (!mq || mq.matches) put(); };
}

/**
 * reelsDrawer draws a reels object into the two reel SVGs and the level bars
 * between them: the packs, each reel's turn, the bar's hairline of how far
 * along it is, and -- while it plays -- each track's level at the playhead.
 */
export function reelsDrawer({ left, right, levels }) {
  const L = reel(left), R = reel(right);
  // The rendered flanges, once their sheet is here: until then, the drawn.
  sheetReady(REEL).then(() => {
    for (const r of [L, R]) {
      r.sheet.setAttribute('href', REEL.src);
      r.svg.classList.add('rendered');
    }
  }, () => {});
  // The bar, for the mini player's hairline of how far along it is.
  const np = typeof left.closest === 'function' ? left.closest('.np') : null;
  const progress = np ? progressWriter(np) : null;
  let bars = [];
  let levelsAt = () => [];
  return {
    // The reels themselves, for hit(); a picture, so no twin.
    els: [left, right],
    /** setLevels makes one bar per colour; fn(frame) gives each one's dBFS. */
    setLevels(colours, fn) {
      levelsAt = fn;
      if (bars.length !== colours.length) {
        bars = colours.map(() => document.createElement('i'));
        levels.replaceChildren(...bars);
      }
      // color too: the glow is currentColor.
      colours.forEach((c, i) => { bars[i].style.background = c; bars[i].style.color = c; });
    },
    draw(m, state) {
      if (!m) return; // no poll yet: the reels stay as drawn
      // The packs only when they change, a tenth of a pixel in a while:
      // setting an SVG attribute, to what it was or not, is a style
      // recalculation and a layout of its picture, and this is every frame.
      setAttrIf(L.pack, 'r', m.left.toFixed(1));
      setAttrIf(R.pack, 'r', m.right.toFixed(1));
      // Sharp at the speed it plays, blurred as it winds to a jump.
      const set = blurFor(m.spin);
      turnReel(L, m.angleL, set);
      turnReel(R, m.angleR, set);
      if (progress && state.length > 0) progress(clamp(m.pos / state.length, 0, 1));
      const lv = m.moving === 'play' ? levelsAt(m.pos) : [];
      bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.08, levelFrac(lv[i])).toFixed(3)})`; });
    },
  };
}

/**
 * ReelWindow is the reel window as the pages use it: poll() with what the
 * Pi said, setLevels() with the tracks, and the reels turn -- on the shared
 * ticker, parked while the tape is still.
 */
export class ReelWindow {
  constructor(parts, { ticker: clock = ticker } = {}) {
    this.drawer = reelsDrawer(parts);
    this.scene = new Scene({ ticker: clock });
    this.reels = this.scene.add(new SceneObject('reels', 'reels'));
    this.renderer = new DomRenderer();
    this.renderer.mount(parts.left.parentNode, this.scene);
    this.renderer.part('reels', this.drawer);
    this.scene.start();
  }

  /** setLevels makes one bar per colour; fn(frame) gives each one's dBFS. */
  setLevels(colours, fn) {
    this.drawer.setLevels(colours, fn);
    this.renderer.invalidate('reels');
  }

  /** poll hands the reels what the Pi said: a poll, stamped with the scene's time. */
  poll({ heard, playing, length, sampleRate }) {
    this.reels.set({ pos: heard, playing, length, sampleRate, at: this.scene.now() });
  }
}
