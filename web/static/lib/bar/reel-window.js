// web/static/lib/bar/reel-window.js
// The bar's reel window: two reels either side of the LCD, turning with the
// playhead (lib/tape/reels.js), their packs filling and emptying over the
// tape, and the LCD's level bars, one per track. A picture of the
// transport, like the deck it replaces: hidden from assistive tech, sized by
// CSS.

import { ReelMotion } from '../tape/reels.js';

const NS = 'http://www.w3.org/2000/svg';
const C = 80, FLANGE = 74;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const circ = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z `;

/** levelFrac is how full a level bar is for dBFS: empty at −40, full 3 dB over ref. */
export function levelFrac(db, ref = -10) {
  if (!(db > -40)) return 0;
  return clamp((db + 40) / (ref + 3 + 40), 0, 1);
}

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
}

// One reel: the well, the pack, and the flange that turns, with three
// windows the pack shows through.
function reel(svg) {
  el('circle', { class: 'np-well', cx: C, cy: C, r: FLANGE + 4 }, svg);
  const pack = el('circle', { class: 'np-pack', cx: C, cy: C, r: 40 }, svg);
  const turn = el('g', { class: 'np-turn' }, svg);
  let d = circ(C, C, FLANGE);
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 - 90) * Math.PI) / 180;
    d += circ(+(C + 42 * Math.cos(a)).toFixed(1), +(C + 42 * Math.sin(a)).toFixed(1), 21);
  }
  el('path', { class: 'np-flange', d, 'fill-rule': 'evenodd' }, turn);
  el('circle', { class: 'np-hub', cx: C, cy: C, r: 15 }, turn);
  turn.style.transformOrigin = `${C}px ${C}px`;
  return { pack, turn };
}

export class ReelWindow {
  constructor({ left, right, levels }) {
    this.left = reel(left);
    this.right = reel(right);
    this.levelsEl = levels;
    this.bars = [];
    this.levels = () => [];
    this.motion = null;
    this.raf = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /** setLevels makes one bar per colour; fn(frame) gives each one's dBFS. */
  setLevels(colours, fn) {
    this.levels = fn;
    if (this.bars.length !== colours.length) {
      this.bars = colours.map(() => document.createElement('i'));
      this.levelsEl.replaceChildren(...this.bars);
    }
    // color too: the glow is currentColor.
    colours.forEach((c, i) => { this.bars[i].style.background = c; this.bars[i].style.color = c; });
  }

  poll({ heard, playing, length, sampleRate }) {
    if (!this.motion || this.motion.sr !== sampleRate) this.motion = new ReelMotion({ sampleRate, length, reduced: this.reduced });
    this.motion.setLength(length);
    this.motion.poll(heard, playing, performance.now());
    this.start();
  }

  start() {
    if (this.raf || document.hidden || !this.motion) return;
    const tick = (now) => {
      this.raf = 0;
      if (this.draw(now) && !document.hidden) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** draw paints the reels and the levels at `now`; it says whether anything still moves. */
  draw(now) {
    const m = this.motion.frame(now);
    this.left.pack.setAttribute('r', m.left.toFixed(1));
    this.right.pack.setAttribute('r', m.right.toFixed(1));
    this.left.turn.style.transform = `rotate(${m.angleL.toFixed(1)}deg)`;
    this.right.turn.style.transform = `rotate(${m.angleR.toFixed(1)}deg)`;
    const lv = m.moving === 'play' ? this.levels(m.pos) : [];
    this.bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.08, levelFrac(lv[i])).toFixed(3)})`; });
    return m.moving !== 'stop';
  }
}
