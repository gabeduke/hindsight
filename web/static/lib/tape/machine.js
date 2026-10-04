// web/static/lib/tape/machine.js
// The tape machine over the lanes: two reels that turn with the playhead
// (lib/tape/reels.js), the tape running over the heads, and a meter bridge
// with a VU per track (lib/vu.js) reading what each track has under the
// playhead (levelAt in lib/tape/geometry.js).
//
// It's a picture of the transport, not a control: everything here mirrors
// what the page already shows, so it's hidden from assistive tech and its
// sizes come from CSS.

import { ReelMotion } from './reels.js';
import { VUMeters } from '../vu.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

// The reels' geometry, in the drawing's viewBox (600 x 190).
const LX = 110, RX = 490, CY = 88, FLANGE = 74;
const circ = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z `;

// A flange with three windows, so the pack shows through as it turns.
function flange(cx) {
  let d = circ(cx, CY, FLANGE);
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 - 90) * Math.PI) / 180;
    d += circ(+(cx + 42 * Math.cos(a)).toFixed(1), +(CY + 42 * Math.sin(a)).toFixed(1), 21);
  }
  return d;
}

function reel(svg, cx) {
  el('circle', { class: 'tm-well', cx, cy: CY, r: FLANGE + 4 }, svg);
  const pack = el('circle', { class: 'tm-pack', cx, cy: CY, r: 40 }, svg);
  const turn = el('g', { class: 'tm-turn' }, svg);
  el('path', { class: 'tm-flange', d: flange(cx), 'fill-rule': 'evenodd' }, turn);
  el('circle', { class: 'tm-hub', cx, cy: CY, r: 15 }, turn);
  el('path', { class: 'tm-spokes', d: `M${cx} ${CY - 14} V${CY - 8} M${cx - 12.1} ${CY + 7} L${cx - 6.9} ${CY + 4} M${cx + 12.1} ${CY + 7} L${cx + 6.9} ${CY + 4}` }, turn);
  turn.style.transformOrigin = `${cx}px ${CY}px`;
  return { pack, turn };
}

export class TapeMachine {
  constructor(root) {
    this.root = root;
    this.motion = null;
    this.raf = 0;
    this.recording = false;
    this.levels = () => [];
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const deck = document.createElement('div');
    deck.className = 'tm-deck';
    const svg = el('svg', { class: 'tm-reels', viewBox: '0 0 600 190', 'aria-hidden': 'true' });
    this.left = reel(svg, LX);
    this.right = reel(svg, RX);
    // The tape: off the left pack, over a guide, across the heads, over a
    // guide and onto the right pack. Drawn twice: the tape, and its sheen,
    // whose dashes move with it.
    this.tape = el('path', { class: 'tm-tape' }, svg);
    this.sheen = el('path', { class: 'tm-sheen' }, svg);
    el('rect', { class: 'tm-block', x: 250, y: 160, width: 100, height: 24, rx: 3 }, svg);
    this.heads = ['E', 'R', 'P'].map((label, i) => {
      const x = 262 + i * 30;
      const head = el('rect', { class: 'tm-head', x, y: 149, width: 16, height: 13, rx: 3 }, svg);
      const t = el('text', { class: 'tm-head-label', x: x + 8, y: 177 }, svg);
      t.textContent = label;
      return head;
    });
    for (const x of [210, 390]) {
      el('circle', { class: 'tm-guide', cx: x, cy: 163, r: 8 }, svg);
      el('circle', { class: 'tm-guide-pin', cx: x, cy: 163, r: 2 }, svg);
    }
    const plate = el('text', { class: 'tm-plate', x: 300, y: 30 }, svg);
    plate.textContent = 'HINDSIGHT · 4-TRACK';
    this.state = el('text', { class: 'tm-state', x: 300, y: 58 }, svg);
    this.state.textContent = 'STOP';

    this.bridge = document.createElement('div');
    this.bridge.className = 'tm-bridge';
    deck.append(svg, this.bridge);
    root.replaceChildren(deck);
    this.meters = null;
    this.trackCount = 0;

    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /** tracks sets how many meters the bridge has. */
  setTracks(n) {
    if (n === this.trackCount) return;
    this.trackCount = n;
    this.bridge.replaceChildren();
    // The bridge reads the clips' peaks, which run several dB over the RMS
    // a VU is lined up for: 0 VU at −10 dBFS puts a well-recorded part around
    // 0 VU, as the main page's meters do with RMS at −18.
    this.meters = new VUMeters(this.bridge, { labels: Array.from({ length: n }, (_, i) => String(i + 1)), ref: -10 });
  }

  /**
   * poll takes the transport from a poll of the Pi: the tape frame heard
   * now, whether it's playing, whether a punch is recording, the tape's
   * length and rate; levels(frame) gives each track's dBFS at a frame.
   */
  poll({ heard, playing, recording, length, sampleRate, levels }) {
    if (!this.motion || this.motion.sr !== sampleRate) {
      this.motion = new ReelMotion({ sampleRate, length, reduced: this.reduced });
    }
    this.motion.setLength(length);
    this.motion.poll(heard, playing, performance.now());
    this.recording = recording;
    this.levels = levels;
    this.start();
  }

  start() {
    if (this.raf || document.hidden || !this.motion) return;
    const tick = (now) => {
      this.raf = 0;
      // A stopped machine with nothing left to wind needs no more frames;
      // the next poll starts them again.
      if (this.draw(now) && !document.hidden) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** draw paints the machine at `now`; it says whether anything still moves. */
  draw(now) {
    const m = this.motion.frame(now);
    this.left.pack.setAttribute('r', m.left.toFixed(1));
    this.right.pack.setAttribute('r', m.right.toFixed(1));
    this.left.turn.style.transform = `rotate(${m.angleL.toFixed(1)}deg)`;
    this.right.turn.style.transform = `rotate(${m.angleR.toFixed(1)}deg)`;
    // Off the bottom-right of the left pack, onto the bottom-left of the right.
    const lx = LX + m.left * 0.72, ly = CY + m.left * 0.69;
    const rx = RX - m.right * 0.72, ry = CY + m.right * 0.69;
    const d = `M${lx.toFixed(1)} ${ly.toFixed(1)} L203 156 L397 156 L${rx.toFixed(1)} ${ry.toFixed(1)}`;
    this.tape.setAttribute('d', d);
    this.sheen.setAttribute('d', d);
    if (!this.reduced) this.sheen.style.strokeDashoffset = String((-m.pos / this.motion.sr) * 45 % 12);
    // Recording, the machine says so through a loop's wrap too: the sign in
    // the header stays lit, and the two shouldn't disagree.
    const rec = this.recording && m.moving !== 'stop';
    this.heads[1].classList.toggle('on', rec);
    const word = rec ? 'REC' : { play: 'PLAY', wind: 'WIND ▶▶', rewind: '◀◀ REWIND', stop: 'STOP' }[m.moving];
    if (this.state.textContent !== word) this.state.textContent = word;
    if (this.meters) {
      const lv = m.moving === 'play' || rec ? this.levels(m.pos) : [];
      this.meters.update(lv, lv, null);
    }
    return m.moving !== 'stop';
  }
}
