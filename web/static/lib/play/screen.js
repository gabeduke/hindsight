// web/static/lib/play/screen.js
// The instrument strip (docs/superpowers/specs/2026-10-15-instrument-strip-design.md):
// Play mode as one more drawer on the tape page, not a screen over it.
//
// Folded, it's one row above the bar: INSTRUMENT ▴, the KEYS lamp, and the
// track keys and tricks as small pads with their legends, still live --
// whatever plays them, they light. Unfolded, the row becomes the strip's
// head (playing from, quantise, the lead, MIDI LEARN) and under it:
//
//   - the reel as the loop's ring: bar ticks round the flange, the playhead
//     sweeping in orange, bar.beat in the hub's LCD; it turns as the sound
//     does (reel.js);
//   - the four track keys, held to drop a track out;
//   - the six tricks;
//   - an empty place for P4's punch-in FX and tape mods (`slot()`);
//   - with the two rooms on, the Studio's verbs, and what else the bus has.
//
// The pads draw two states, and the gap between them is the point: a pad is
// *armed* the instant you touch it and *fires* when the Pi says it sounds.
// A pad lit by another hand -- a phone, the controller in the Pi -- shows
// only the bright state: the dim one is this hand's.
//
// This draws and wires; mount.js decides. Everything hangs off a `play-`
// class (styles.css, "Rooms P3"), and the strip is drawn in the pad
// controller's own materials, the same in both schemes.

import { TRACK_PADS, TRICK_PADS, VERBS, control, legendFor } from './controls.js';
import { bindTouch } from './keymap.js';
import { ARMED, ON } from './surface.js';
import { spin } from '../objects/motion.js';
import { target } from './reel.js';

const SVG = 'http://www.w3.org/2000/svg';

const DIVISIONS = [['off', 'off'], ['16th', '16'], ['8th', '8'], ['beat', 'beat'], ['bar', 'bar']];

/** Where the ring is drawn, in the reel's 300 × 300 box. */
const C = 150;
const RING = 138;

/** arcPath is the sweep: from the top, clockwise, `frac` of the way round. */
export function arcPath(frac, r = RING, c = C) {
  const f = Math.max(0, Math.min(0.9999, frac));
  if (f <= 0) return '';
  const a = -Math.PI / 2 + f * 2 * Math.PI;
  const x = (c + r * Math.cos(a)).toFixed(1);
  const y = (c + r * Math.sin(a)).toFixed(1);
  return `M${c} ${c - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}`;
}

/** lcdText is what the hub says: bar.beat, or a dash with no tempo. */
export function lcdText({ bar = null, beat = null } = {}) {
  if (bar == null) return '–';
  return beat == null ? String(bar) : `${bar}.${beat}`;
}

/**
 * mountStrip builds the strip into `root` and wires it to `surface`. The
 * callbacks are mount.js's: onCommand(id) for a verb's pad, onFold(open),
 * onKeys(own) for the lamp, onFrom(id), onQuant(division), onLearn(on),
 * onPick(id) for the pad MIDI LEARN is to bind. `has(need)` says whether
 * the rooms are on, for the verbs.
 */
export function mountStrip(root, surface, {
  onCommand = () => {}, onFold = () => {}, onKeys = () => {}, onFrom = () => {}, onQuant = () => {},
  onLearn = () => {}, onPick = () => {}, has = () => false, doc = globalThis.document,
} = {}) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = doc.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const button = (cls, text, tip) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (tip) b.dataset.tip = tip;
    return b;
  };

  root.classList.add('play-strip');
  root.dataset.fold = 'folded';
  root.setAttribute('aria-label', 'The instrument');
  const unbinds = [];
  const pads = new Map();     // id → [the pad's buttons, small and large]
  const remote = new Set();   // pads lit by another hand
  let learning = false;
  let picked = null;
  let from = 'keys';
  let bindings = null;

  // --- the row: the drawer's key, the lamp, the small pads, the head ----------
  const row = el('div', 'play-row');
  const fold = button('play-fold', null, 'play-fold');
  fold.setAttribute('aria-expanded', 'false');
  fold.append(el('span', 'play-fold-word', 'Instrument'), el('span', 'play-chev', '▴'));
  fold.setAttribute('aria-label', 'The instrument: unfold it');
  fold.addEventListener('click', () => onFold(root.dataset.fold !== 'open'));

  const keys = button('play-keys', null, 'play-keys');
  keys.setAttribute('aria-pressed', 'false');
  keys.append(el('span', 'play-lamp'), el('span', 'play-keys-word', 'Keys'));
  keys.addEventListener('click', () => onKeys(keys.getAttribute('aria-pressed') !== 'true'));

  const mini = el('div', 'play-mini');
  mini.setAttribute('role', 'group');
  mini.setAttribute('aria-label', 'Pads');

  const head = el('div', 'play-head');
  const fromSeg = el('div', 'play-from');
  fromSeg.setAttribute('role', 'group');
  fromSeg.setAttribute('aria-label', 'Playing from');
  fromSeg.dataset.tip = 'play-from';
  const quant = el('div', 'play-quant');
  quant.dataset.tip = 'play-quant';
  quant.append(el('span', 'play-quant-label', '⌗'));
  const seg = el('div', 'play-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Quantise');
  for (const [d, label] of DIVISIONS) {
    const b = button(null, label);
    b.dataset.division = d;
    b.setAttribute('aria-pressed', String(d === surface.division));
    b.addEventListener('click', () => {
      for (const k of seg.querySelectorAll('button')) k.setAttribute('aria-pressed', String(k === b));
      surface.setGrid({ division: d });
      onQuant(d);
    });
    seg.append(b);
  }
  quant.append(seg);
  const lead = el('span', 'play-lead', 'lead –');
  lead.dataset.tip = 'play-lead';
  const learn = button('play-learn', 'MIDI learn', 'play-learn');
  learn.setAttribute('aria-pressed', 'false');
  learn.addEventListener('click', () => onLearn(!learning));
  head.append(fromSeg, quant, lead, learn);

  const noteEl = el('p', 'play-note');
  noteEl.hidden = true;
  noteEl.setAttribute('role', 'status');
  row.append(fold, keys, mini, head, noteEl);

  // --- the panel ------------------------------------------------------------
  const panel = el('div', 'play-panel');
  panel.id = 'play-panel';
  panel.hidden = true;
  fold.setAttribute('aria-controls', panel.id);
  const fromLine = el('p', 'play-from-line');
  // The lines under the head, unfolded: where it's played from, and the
  // note (which sits at the row's end while folded).
  const lines = el('div', 'play-lines');
  lines.append(fromLine);

  // The reel, and the loop as its ring.
  const reelWrap = el('div', 'play-reel');
  const svg = svgEl('svg', { viewBox: '0 0 300 300', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { class: 'play-ring-track', cx: C, cy: C, r: RING }));
  const ticks = svgEl('g', { class: 'play-ring-ticks' });
  const sweep = svgEl('path', { class: 'play-ring-sweep', d: '' });
  const head0 = svgEl('circle', { class: 'play-ring-head', cx: C, cy: C - RING, r: 7 });
  const turn = svgEl('g', { class: 'play-reel-turn' });
  turn.append(svgEl('circle', { class: 'play-reel-flange', cx: C, cy: C, r: 104 }));
  turn.append(svgEl('circle', { class: 'play-reel-pack', cx: C, cy: C, r: 84 }));
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 - 90) * Math.PI) / 180;
    turn.append(svgEl('line', {
      class: 'play-reel-spoke',
      x1: (C + 46 * Math.cos(a)).toFixed(1), y1: (C + 46 * Math.sin(a)).toFixed(1),
      x2: (C + 82 * Math.cos(a)).toFixed(1), y2: (C + 82 * Math.sin(a)).toFixed(1),
    }));
  }
  turn.style.transformOrigin = `${C}px ${C}px`;
  const hub = svgEl('circle', { class: 'play-reel-hub', cx: C, cy: C, r: 46 });
  const lcd = svgEl('text', { class: 'play-reel-lcd', x: C, y: C + 6, 'text-anchor': 'middle' });
  lcd.textContent = '–';
  const unit = svgEl('text', { class: 'play-reel-unit', x: C, y: C + 26, 'text-anchor': 'middle' });
  unit.textContent = 'BAR · BEAT';
  svg.append(ticks, sweep, head0, turn, hub, lcd, unit);
  reelWrap.append(svg);

  /** One pad: its face, the legend under it, and the touch that plays it. */
  function pad(parent, id, cls) {
    const c = control(id);
    const b = button(`play-pad ${cls}`, null, 'play-pad');
    b.dataset.pad = id;
    b.setAttribute('aria-label', `${c.face}: ${c.what}`);
    b.append(el('span', 'play-face', c.face), el('kbd', 'play-key', ''));
    parent.append(b);
    if (!pads.has(id)) pads.set(id, []);
    pads.get(id).push(b);
    unbinds.push(bindTouch(surface, b, id, { instead: () => { if (!learning) return false; onPick(id); return true; } }));
    return b;
  }

  const group = (cls, title) => {
    const g = el('section', `play-group ${cls}`);
    g.append(el('h3', 'play-group-title', title));
    return g;
  };
  const tracksG = group('play-tracks-group', 'Tracks · hold to drop out');
  const tracks = el('div', 'play-tracks');
  TRACK_PADS.forEach((id, i) => pad(tracks, id, `play-track t${i + 1}`));
  tracksG.append(tracks);
  const tricksG = group('play-tricks-group', 'Tricks · held, on the grid');
  const tricks = el('div', 'play-tricks');
  for (const id of TRICK_PADS) pad(tricks, id, 'play-trick');
  tricksG.append(tricks);
  // P4's punch-in FX and tape mods go here (slot('fx'), slot('mods')).
  const slots = { fx: el('div', 'play-slot play-slot-fx'), mods: el('div', 'play-slot play-slot-mods') };
  for (const s of Object.values(slots)) s.hidden = true;

  // The rest of the bus, under the tricks: the Studio's verbs (with the
  // rooms), and the keys with no pad of their own.
  const bus = el('div', 'play-bus');
  bus.append(el('span', 'play-bus-title', 'Also on the bus'));
  const verbs = new Map();
  if (has('rooms')) {
    for (const id of VERBS) {
      const c = control(id);
      const b = button('play-verb', null, 'play-verb');
      b.dataset.pad = id;
      b.setAttribute('aria-label', `${c.face}: ${c.what}`);
      b.append(el('span', 'play-face', c.face), el('kbd', 'play-key', ''));
      b.addEventListener('click', () => { if (learning) onPick(id); else onCommand(id); });
      verbs.set(id, b);
      bus.append(b);
    }
  }
  bus.append(el('span', 'play-bus-hint', '⇧ latches · Esc lets go'));
  bus.title = '⇧ held, or a sustain pedal, keeps what is let go held until it lifts. Esc lets go of everything';
  const side = el('div', 'play-side');
  side.append(tricksG, bus);
  const body = el('div', 'play-body');
  body.append(reelWrap, tracksG, side, slots.fx, slots.mods);
  panel.append(lines, body);

  // The small pads of the folded row: the same pads, smaller.
  TRACK_PADS.forEach((id, i) => pad(mini, id, `play-track play-small t${i + 1}`));
  for (const id of TRICK_PADS) pad(mini, id, 'play-trick play-small');

  root.append(row, panel);

  // --- lighting ----------------------------------------------------------------
  // Dim the instant it's touched, bright when it sounds; another hand's pad
  // bright only. The classes do the work; motion lives in styles.css so
  // reduced motion can turn it off in one place.
  const paint = (id) => {
    const s = surface.state(id);
    const far = remote.has(id);
    for (const b of pads.get(id) || []) {
      b.classList.toggle('armed', s === ARMED);
      b.classList.toggle('on', s === ON || far);
      b.classList.toggle('play-far', far && s !== ON && s !== ARMED);
    }
  };
  for (const name of ['arm', 'fire', 'end', 'idle']) {
    unbinds.push(surface.on(name, ({ pad: id }) => paint(id)));
  }

  function legends() {
    const shown = learning ? 'midi' : from;
    const all = [...pads.entries(), ...[...verbs.entries()].map(([id, b]) => [id, [b]])];
    for (const [id, bs] of all) {
      const text = legendFor(id, shown === 'touch' || shown === 'keys' ? shown : 'midi', { bindings, has });
      const face = control(id)?.face;
      for (const b of bs) {
        const k = b.querySelector('.play-key');
        if (k.textContent !== text) k.textContent = text;
        k.hidden = !text || text === face; // track 1's key is 1: once is enough
      }
    }
  }
  legends();

  // --- the reel's motion -----------------------------------------------------
  const reel = { angle: 0, rate: 0 };

  return {
    root,
    paint,
    /** remoteOn lights or darkens a pad another hand plays. */
    remote(id, on) {
      if (on) remote.add(id); else remote.delete(id);
      paint(id);
    },
    remoteHeld: () => [...remote],
    setFold(open) {
      root.dataset.fold = open ? 'open' : 'folded';
      panel.hidden = !open;
      if (open) lines.append(noteEl); else row.append(noteEl);
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-label', open ? 'The instrument: fold it' : 'The instrument: unfold it');
      fold.querySelector('.play-chev').textContent = open ? '▾' : '▴';
    },
    setKeys(own, why = '') {
      keys.setAttribute('aria-pressed', String(own));
      keys.title = own ? 'The keys play the instrument. Tap to give them back to editing' : (why || 'The keys edit the tape. Tap to play the instrument with them');
    },
    /** setLoop moves the ring: `frac` round it, bar.beat in the hub, and its bars as ticks. */
    setLoop({ frac = 0, bar = null, bars = null, beat = null } = {}) {
      sweep.setAttribute('d', arcPath(frac));
      const a = -Math.PI / 2 + Math.max(0, Math.min(1, frac)) * 2 * Math.PI;
      head0.setAttribute('cx', (C + RING * Math.cos(a)).toFixed(1));
      head0.setAttribute('cy', (C + RING * Math.sin(a)).toFixed(1));
      const text = lcdText({ bar, beat });
      if (lcd.textContent !== text) lcd.textContent = text;
      if (bars != null && ticks.childElementCount !== bars && bars > 0 && bars <= 64) {
        ticks.replaceChildren();
        for (let i = 0; i < bars; i++) {
          const t = (i / bars) * 2 * Math.PI - Math.PI / 2;
          ticks.append(svgEl('line', {
            x1: (C + (RING - 9) * Math.cos(t)).toFixed(1), y1: (C + (RING - 9) * Math.sin(t)).toFixed(1),
            x2: (C + (RING + 9) * Math.cos(t)).toFixed(1), y2: (C + (RING + 9) * Math.sin(t)).toFixed(1),
          }));
        }
      }
    },
    /** stepReel turns the reel `dt` ms toward what's sounding (reel.js); says whether it's still moving. */
    stepReel(dt, now, state) {
      const t = target({ ...state, now });
      const next = spin(reel.angle, reel.rate, t.rate, t.inertia, dt);
      reel.angle = next.angle;
      reel.rate = next.rate;
      turn.style.transform = `rotate(${reel.angle.toFixed(1)}deg)`;
      return Math.abs(reel.rate) > 0.002 || t.rate !== 0;
    },
    get reelRate() { return reel.rate; },
    setLead(ms) {
      lead.textContent = Number.isFinite(ms) && ms > 0 ? `lead ${Math.round(ms)} ms` : 'lead –';
    },
    /** setFrom draws where it's played from: [{id, label, live}], the one picked, and the line under it. */
    setFrom(options, picked0, line) {
      from = picked0.startsWith('pi:') || picked0.startsWith('web:') ? 'midi' : picked0;
      fromSeg.replaceChildren(el('span', 'play-from-label', 'Playing from'));
      for (const o of options) {
        const b = button('play-from-opt', null);
        b.dataset.from = o.id;
        b.setAttribute('aria-pressed', String(o.id === picked0));
        if (o.live != null) {
          const lamp = el('span', 'play-lamp');
          lamp.classList.toggle('play-lit', !!o.live);
          b.append(lamp);
        }
        b.append(el('span', null, o.label));
        b.addEventListener('click', () => onFrom(o.id));
        fromSeg.append(b);
      }
      fromLine.textContent = line || '';
      fromLine.hidden = !line;
      legends();
    },
    /** setBindings is the map the pads' legends show for a controller. */
    setBindings(map) { bindings = map; legends(); },
    setLearning(on, canWhy = '') {
      learning = on;
      root.classList.toggle('play-learning', on);
      learn.setAttribute('aria-pressed', String(on));
      if (canWhy != null) learn.title = canWhy;
      if (!on) this.setPick(null);
      legends();
    },
    canLearn(ok, why = '') {
      learn.disabled = !ok;
      learn.title = ok ? 'Bind a pad to a key or knob on the controller' : why;
    },
    /** setPick blinks the pad MIDI LEARN is waiting on, or none. */
    setPick(id) {
      for (const [pid, bs] of [...pads.entries(), ...[...verbs.entries()].map(([k, b]) => [k, [b]])]) {
        for (const b of bs) b.classList.toggle('play-pick', pid === id);
      }
      picked = id;
    },
    get picked() { return picked; },
    note(text) {
      if (noteEl.textContent !== (text || '')) noteEl.textContent = text || '';
      noteEl.hidden = !text;
    },
    /** slot is the place P4's FX ('fx') or tape mods ('mods') draw into. */
    slot(name) { return slots[name] || null; },
    /**
     * addPad draws one more pad into `parent`, wired as the strip's own are:
     * played by touch, lit by the surface and by other hands, its legend
     * drawn, picked by MIDI LEARN. P4's FX are drawn with it.
     */
    addPad(parent, id, cls) {
      const b = pad(parent, id, cls);
      legends();
      paint(id);
      return b;
    },
    destroy() {
      for (const off of unbinds) off();
      root.replaceChildren();
      root.classList.remove('play-strip', 'play-learning');
    },
  };
}

/**
 * mountToggle is the phone's EDIT | PLAY, made for the mini player: PLAY
 * unfolds the strip as the bottom panel, EDIT gives the drawers back.
 */
export function mountToggle(parent, { onPlay = () => {}, doc = globalThis.document } = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'play-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Edit or play');
  const mk = (word, play) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'play-toggle-opt';
    b.dataset.tip = 'play-toggle';
    b.dataset.play = play ? '1' : '0';
    if (play) {
      const lamp = doc.createElement('span');
      lamp.className = 'play-lamp';
      b.append(lamp);
    }
    b.append(doc.createTextNode(word));
    b.addEventListener('click', () => onPlay(play));
    wrap.append(b);
    return b;
  };
  const edit = mk('Edit', false);
  const play = mk('Play', true);
  parent.prepend(wrap);
  return {
    el: wrap,
    set(isPlay) {
      edit.setAttribute('aria-pressed', String(!isPlay));
      play.setAttribute('aria-pressed', String(isPlay));
    },
    /** lit says a pad is sounding: PLAY's lamp shows it even in EDIT. */
    lit(on) { play.querySelector('.play-lamp').classList.toggle('play-lit', on); },
    destroy() { wrap.remove(); },
  };
}
