// web/static/lib/play/screen.js
// The Play surface: one screen, one purpose, nothing to navigate.
//
// Everything on it is momentary. You hold a key and it does a thing; you let
// go and it stops. There are no dialogs, no inspector, no library, and the
// only non-musical gesture is the one that leaves.
//
// The pads draw two states, and the gap between them is the point: a pad is
// *armed* the instant you touch it and *fires* on the next grid line. Seeing
// that gap is what lets someone play ahead of the beat on purpose, which is
// the difference between quantise helping and quantise feeling like lag.

import { TRACK_PADS, TRICK_PADS, bindTouch, KEYMAP } from './keymap.js';
import { ARMED, ON } from './surface.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/** The legend printed on each pad, and the key that plays it. */
const FACE = {
  track1: '1', track2: '2', track3: '3', track4: '4',
  break: 'BREAK', reverse: 'REV', chop: 'CHOP', stop: 'STOP',
  half: '½×', double: '2×',
};
const KEY_FOR = Object.fromEntries(
  Object.entries(KEYMAP).map(([code, pad]) => [pad, code.replace(/^(Key|Digit)/, '')]),
);

const DIVISION_KEYS = ['off', '16th', '8th', 'beat', 'bar'];

/**
 * mountPlay builds the surface into `root` and wires it to `surface`.
 * Returns {destroy, setGrid, setLoop} -- the page drives the last two from
 * whatever the tape is doing.
 */
export function mountPlay(root, surface, { onCommand = () => {} } = {}) {
  root.classList.add('play-mode');
  const unbinds = [];
  const pads = new Map();

  /** One pad: a key legend, a face, and the letter that plays it. */
  function pad(parent, id, cls) {
    const b = el('button', `play-pad ${cls}`);
    b.type = 'button';
    b.dataset.pad = id;
    b.setAttribute('aria-label', FACE[id]);
    b.append(el('span', 'play-face', FACE[id]));
    if (KEY_FOR[id]) b.append(el('kbd', 'play-key', KEY_FOR[id]));
    parent.append(b);
    pads.set(id, b);
    unbinds.push(bindTouch(surface, b, id));
    return b;
  }

  // --- the top strip: quantise, and the way out -------------------------------
  const top = el('div', 'play-top');
  const quant = el('div', 'play-quant');
  quant.append(el('span', 'play-quant-label', 'QUANTISE'));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Quantise');
  for (const d of DIVISION_KEYS) {
    const b = el('button', null, d === '16th' ? '16' : d === '8th' ? '8' : d);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(d === surface.division));
    b.addEventListener('click', () => {
      for (const k of seg.querySelectorAll('button')) k.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      surface.setGrid({ division: d });
    });
    seg.append(b);
  }
  quant.append(seg);
  const exit = el('button', 'play-exit', 'Done');
  exit.type = 'button';
  exit.addEventListener('click', () => onCommand('exit'));
  top.append(quant, exit);

  // --- the ring: the loop, and where the playhead is in it --------------------
  // The one readout you can follow from across the room with your hands on an
  // instrument. Bars tick round the outside.
  const ringWrap = el('div', 'play-ring');
  const ring = svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  ring.append(svgEl('circle', { class: 'play-ring-track', cx: 60, cy: 60, r: 50 }));
  const sweep = svgEl('circle', {
    class: 'play-ring-sweep', cx: 60, cy: 60, r: 50,
    transform: 'rotate(-90 60 60)',
  });
  const C = 2 * Math.PI * 50;
  sweep.setAttribute('stroke-dasharray', String(C));
  sweep.setAttribute('stroke-dashoffset', String(C));
  const ticks = svgEl('g', { class: 'play-ring-ticks' });
  ring.append(sweep, ticks);
  const barText = svgEl('text', { class: 'play-ring-bar', x: 60, y: 66, 'text-anchor': 'middle' });
  barText.textContent = '–';
  ring.append(barText);
  ringWrap.append(ring);

  // --- the tracks: four full-height keys -------------------------------------
  const tracks = el('div', 'play-tracks');
  TRACK_PADS.forEach((id, i) => pad(tracks, id, `play-track t${i + 1}`));

  // --- the tricks ------------------------------------------------------------
  const tricks = el('div', 'play-tricks');
  for (const id of TRICK_PADS) pad(tricks, id, 'play-trick');

  const stage = el('div', 'play-stage');
  stage.append(tracks, ringWrap);
  root.append(top, stage, tricks);

  // --- pad lighting ----------------------------------------------------------
  // Dim the instant it is touched, bright on the line where it lands. The
  // classes do the work; motion lives in styles.css so reduced motion can
  // turn it off in one place.
  const paint = (id) => {
    const b = pads.get(id);
    if (!b) return;
    const s = surface.state(id);
    b.classList.toggle('armed', s === ARMED);
    b.classList.toggle('on', s === ON);
  };
  for (const name of ['arm', 'fire', 'end', 'idle']) {
    unbinds.push(surface.on(name, ({ pad: id }) => paint(id)));
  }

  /** setLoop moves the ring: `frac` round it, and which bar is showing. */
  function setLoop({ frac = 0, bar = null, bars = null } = {}) {
    const f = Math.max(0, Math.min(1, frac));
    sweep.setAttribute('stroke-dashoffset', String(C * (1 - f)));
    barText.textContent = bar == null ? '–' : String(bar);
    if (bars != null && ticks.childElementCount !== bars && bars > 0 && bars <= 64) {
      ticks.replaceChildren();
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * 2 * Math.PI - Math.PI / 2;
        ticks.append(svgEl('line', {
          x1: (60 + 55 * Math.cos(a)).toFixed(1), y1: (60 + 55 * Math.sin(a)).toFixed(1),
          x2: (60 + 59 * Math.cos(a)).toFixed(1), y2: (60 + 59 * Math.sin(a)).toFixed(1),
        }));
      }
    }
  }

  return {
    setLoop,
    setGrid: (g) => surface.setGrid(g),
    destroy() {
      for (const off of unbinds) off();
      root.replaceChildren();
      root.classList.remove('play-mode');
    },
  };
}
