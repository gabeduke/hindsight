// web/static/lib/objects/vu.js
// VU meters for the main page: a needle per saved channel, on the scale an
// analog VU meter draws -- −20 to +3 VU, 0 VU two thirds of the way over.
//
// The needle is a scene object (lib/scene): the page sets its level, the vu
// model (lib/scene/vu.js) swings it with motion.js's `ballistic`, the real VU
// movement -- 300 ms to 99 % of a step with about 1 % of overshoot -- rather
// than a CSS transition, which arrives and stops dead. This file is the
// drawing: the face, and a drawer that puts the needle where the model says.
//
// The needle shows the level the meters already get (RMS, in dBFS) with
// 0 VU at REF_DBFS, the usual line-up for digital audio. The dBFS number
// stays under each meter, so nothing the bars told you is lost; the PEAK
// lamp lights for a clip or a peak within 1 dB of full scale.

import { ticker } from './motion.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { DomRenderer } from '../scene/dom.js';
import { vuAngle, VU_SWING, REF_DBFS } from '../scene/vu.js';

// The needle's law lives with its model; the face and the bench read it here.
export { vuAngle, VU_SWING };

// Geometry of the face, in its viewBox (160 x 96): the pivot sits below the
// face, as on the real thing.
const CX = 80, CY = 112, R = 80;

const pt = (deg, r) => {
  const t = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)];
};
const xy = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
const arc = (a0, a1, r) => `M${xy(pt(a0, r))} A${r} ${r} 0 0 1 ${xy(pt(a1, r))}`;

/** vuScale is the face's printing: arcs, ticks, and the numbered marks. */
export function vuScale() {
  const at = (vu) => vuAngle(REF_DBFS + vu);
  const named = { '-20': '20', '-10': '10', '-7': '7', '-5': '5', '-3': '3', '0': '0', '3': '+3' };
  let ticks = '', redTicks = '';
  const labels = [];
  for (const vu of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
    const a = at(vu), big = named[vu] !== undefined;
    const seg = `M${xy(pt(a, R))} L${xy(pt(a, big ? R + 8 : R + 5))} `;
    if (vu >= 0) redTicks += seg; else ticks += seg;
    if (big) {
      const [x, y] = pt(a, R + 16);
      labels.push({ t: named[vu], x: +x.toFixed(1), y: +y.toFixed(1), red: vu >= 0 });
    }
  }
  return { arc: arc(-VU_SWING, at(0), R), redArc: arc(at(0), VU_SWING, R + 1.5), ticks, redTicks, labels };
}

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/**
 * vuFace builds one meter in `container` -- the face, the needle, the peak
 * lamp and the readout under it -- and returns its drawer for the DOM
 * renderer: the needle from the model's view, the readout and the lamp from
 * the state. It writes only what changed, so a resting meter costs nothing.
 */
export function vuFace(container, label) {
  const scale = vuScale();
  const box = document.createElement('div');
  box.className = 'vu';
  const svg = el('svg', { class: 'vu-face', viewBox: '0 0 160 96', 'aria-hidden': 'true' });
  svg.append(
    el('path', { class: 'vu-ink', d: scale.arc }),
    el('path', { class: 'vu-red vu-red-arc', d: scale.redArc }),
    el('path', { class: 'vu-ink', d: scale.ticks }),
    el('path', { class: 'vu-red', d: scale.redTicks }),
  );
  for (const l of scale.labels) {
    const t = el('text', { x: l.x, y: l.y, class: l.red ? 'vu-num red' : 'vu-num' });
    t.textContent = l.t;
    svg.append(t);
  }
  const word = el('text', { x: 80, y: 74, class: 'vu-word' });
  word.textContent = 'VU';
  const needle = el('g', { class: 'vu-needle' });
  needle.append(el('line', { x1: CX, y1: CY, x2: CX, y2: CY - R - 6 }));
  svg.append(word, needle, el('rect', { class: 'vu-base', x: 0, y: 86, width: 160, height: 10 }));

  const peak = document.createElement('span');
  peak.className = 'vu-peak';
  peak.textContent = 'peak';
  const foot = document.createElement('div');
  foot.className = 'vu-foot';
  const name = document.createElement('b');
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'vu-val';
  val.textContent = '−∞';
  foot.append(name, val);
  box.append(svg, peak, foot);
  container.appendChild(box);
  needle.style.transform = `rotate(${-VU_SWING}deg)`;

  let angle = -VU_SWING;
  return {
    el: box,
    draw(view, state) {
      if (view && view.angle !== angle) {
        angle = view.angle;
        needle.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      }
      const db = state.level;
      const text = !Number.isFinite(db) || db <= -60 ? '−∞' : db.toFixed(1);
      if (val.textContent !== text) val.textContent = text;
      peak.classList.toggle('on', !!state.peak);
    },
  };
}

/**
 * VUMeters is the main page's row of meters: one vu scene object per label,
 * drawn by vuFace, on its own scene. ref is the level that reads 0 VU: the
 * main page feeds RMS and keeps the usual −18 dBFS; a feed of peaks wants a
 * higher one, or it reads hot.
 */
export class VUMeters {
  /**
   * ticker: the clock the needles are stepped by. Pages take the shared one;
   * a test or the bench can pass its own.
   */
  constructor(container, { labels, ref = REF_DBFS, ticker: clock = ticker }) {
    this.ref = ref;
    this.scene = new Scene({ ticker: clock });
    this.renderer = new DomRenderer();
    this.renderer.mount(container, this.scene);
    this.peakUntil = labels.map(() => 0);
    this.needles = labels.map((label, i) => {
      const obj = this.scene.add(new SceneObject(`vu:${i}`, 'vu', { ref }));
      this.renderer.part(obj.id, vuFace(container, label));
      return obj;
    });
    // The scene asks the shared ticker for frames only while a needle is
    // still moving, so a silent room costs nothing.
    this.scene.start();
  }

  /**
   * destroy takes these needles off the ticker. Call it before replacing
   * them: the main page builds a new set of meters whenever the saved
   * channels change, and without this the old set would stay on the ticker,
   * stepping needles in detached DOM -- on a page meant to be left running
   * in a jam space, that accumulates.
   */
  destroy() {
    this.scene.stop();
    this.renderer.destroy();
  }

  /** update sets each needle's level to rms (dBFS); peak and clip light the lamp. */
  update(rms, peak, clip) {
    const now = performance.now();
    this.needles.forEach((obj, i) => {
      // Held a moment, so a single loud hit is still seen.
      if (clip?.[i] || (peak?.[i] ?? -Infinity) >= -1) this.peakUntil[i] = now + 700;
      obj.set({ level: rms?.[i], peak: now < this.peakUntil[i] });
    });
  }
}
