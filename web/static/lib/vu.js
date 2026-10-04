// web/static/lib/vu.js
// VU meters for the main page: a needle per saved channel, on the scale an
// analog VU meter draws -- −20 to +3 VU, 0 VU two thirds of the way over.
//
// The needle shows the level the meters already get (RMS, in dBFS) with
// 0 VU at REF_DBFS, the usual line-up for digital audio. The dBFS number
// stays under each meter, so nothing the bars told you is lost; the PEAK
// lamp lights for a clip or a peak within 1 dB of full scale.

/** The needle's swing either side of upright, in degrees. */
export const VU_SWING = 48;
const REF_DBFS = -18;
const TOP_VU = 3;

// Geometry of the face, in its viewBox (160 x 96): the pivot sits below the
// face, as on the real thing.
const CX = 80, CY = 112, R = 80;

/**
 * vuAngle is the needle's angle for a level in dBFS, 0 VU at ref. The VU
 * law is linear in voltage, so the low end crowds to the left. Anything off
 * the scale, or not a number, pins to its end stop.
 */
export function vuAngle(dbfs, ref = REF_DBFS) {
  if (!Number.isFinite(dbfs)) return -VU_SWING;
  const v = Math.pow(10, (dbfs - ref) / 20);
  const lo = Math.pow(10, -20 / 20), hi = Math.pow(10, TOP_VU / 20);
  const f = (v - lo) / (hi - lo);
  return Math.max(-VU_SWING, Math.min(VU_SWING, -VU_SWING + 2 * VU_SWING * f));
}

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

/** VUMeters draws one meter per label into container and moves them. */
export class VUMeters {
  constructor(container, { labels }) {
    const scale = vuScale();
    this.peakUntil = labels.map(() => 0);
    this.meters = labels.map((label) => {
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
      return { box, needle, peak, val };
    });
  }

  /** update moves each needle to rms (dBFS); peak and clip light the lamp. */
  update(rms, peak, clip) {
    const now = performance.now();
    this.meters.forEach((m, i) => {
      const db = rms?.[i];
      m.needle.style.transform = `rotate(${vuAngle(db).toFixed(1)}deg)`;
      m.val.textContent = !Number.isFinite(db) || db <= -60 ? '−∞' : db.toFixed(1);
      // Held a moment, so a single loud hit is still seen.
      if (clip?.[i] || (peak?.[i] ?? -Infinity) >= -1) this.peakUntil[i] = now + 700;
      m.peak.classList.toggle('on', now < this.peakUntil[i]);
    });
  }
}
