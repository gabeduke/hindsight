// web/static/lib/buffer/lanes.js
// The buffer over the tape's lanes: which lane a drag is over, the ghosts
// that show where a drop lands, a drop's flight there, and the glow on a
// block just dropped. All of
// it is drawn in a layer of its own over the page, from the lanes' boxes and
// the view the tape page says they show (the `hindsight:tape-state` event):
// nothing here draws on, or reaches into, the lanes themselves.

import { snapFrame } from '../tape/geometry.js';
import { setTarget } from './fold.js';
import { landsWords, overwritten } from './model.js';
import { T, EASES } from '../objects/motion.js';

/** rows are the tape's lanes, a row per track, in order. */
export const rows = (doc) => [...doc.querySelectorAll('#lanes > .tape-track')];

/** frameAtX is the tape frame at x on a lane drawn in rect, showing view. */
export function frameAtX(rect, view, x) {
  return view.from + ((x - rect.left) / rect.width) * (view.to - view.from);
}

/** spanBox is where tape frames [at, at + frames) are drawn on a lane in rect. */
export function spanBox(rect, view, at, frames) {
  const w = view.to - view.from;
  const left = rect.left + ((at - view.from) / w) * rect.width;
  const right = rect.left + ((at + frames - view.from) / w) * rect.width;
  const l = Math.max(rect.left, left), r = Math.min(rect.right, right);
  return { left: l, top: rect.top, width: Math.max(0, r - l), height: rect.height };
}

/**
 * landing is where a drag at (x, y) puts a buffer: the track under it, and
 * the frame under the finger snapped as the ruler snaps, never past the
 * tape's end. null off the lanes.
 */
export function landing({ row, rowIndex, x, rect, view, tape, snap, frames }) {
  if (!row || !rect || !(rect.width > 0)) return null;
  const f = frameAtX(rect, view, x);
  const at = Math.min(Math.max(0, snapFrame(tape.grid, f, snap)), Math.max(0, tape.length - frames));
  return { track: rowIndex + 1, at };
}

/** The layer over the page that the ghosts and the glow are drawn in. */
export class Overlay {
  constructor(doc) {
    this.doc = doc;
    this.el = doc.createElement('div');
    this.el.className = 'buffer-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    doc.body.append(this.el);
  }

  box(cls, b, text) {
    const d = this.doc.createElement('div');
    d.className = cls;
    Object.assign(d.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    if (text) {
      const s = this.doc.createElement('span');
      s.textContent = text;
      d.append(s);
    }
    this.el.append(d);
    return d;
  }

  /** ghosts shows where a drop lands, a box on each of its lanes. */
  ghosts(boxes, label, replace = false) {
    for (const g of this.el.querySelectorAll('.buffer-ghost')) g.remove();
    boxes.forEach((b, i) => this.box(`buffer-ghost${replace ? ' buffer-ghost-replace' : ''}`, b, i === 0 ? label : ''));
  }

  /**
   * fly carries a drop from where it was (`from`, a box: the drawer's
   * window) to the blocks it became, by transform and opacity alone, then
   * lights them (glow). With reduced motion, or no Web Animations, it is
   * the glow alone: nothing teleports, and nothing travels either.
   */
  fly(from, boxes, { reduced = false } = {}) {
    if (!from || reduced || !boxes.length || typeof this.el.animate !== 'function') { this.glow(boxes); return; }
    const [b] = boxes;
    const d = this.box('buffer-flight', b);
    const sx = from.width / Math.max(1, b.width), sy = from.height / Math.max(1, b.height);
    const run = d.animate([
      { transform: `translate(${from.left - b.left}px, ${from.top - b.top}px) scale(${sx}, ${sy})`, opacity: 0.9 },
      { transform: 'none', opacity: 1 },
    ], { duration: T.flight, easing: `cubic-bezier(${EASES.flight.join(',')})` });
    const land = () => { d.remove(); this.glow(boxes); };
    run.onfinish = land;
    run.oncancel = land;
  }

  /** glow lights a block just dropped, once. */
  glow(boxes) {
    for (const b of boxes) {
      const d = this.box('buffer-glow', b);
      setTimeout(() => d.remove(), 1600);
    }
  }

  clear() {
    for (const g of this.el.querySelectorAll('.buffer-ghost')) g.remove();
  }
}

/**
 * boxesFor are a drop's boxes, one per lane, from track on: where it lands
 * on each lane as the page lays it out now.
 */
export function boxesFor(doc, { track, count, at, frames, view }) {
  const rs = rows(doc);
  const out = [];
  for (let k = 0; k < count; k++) {
    const row = rs[track - 1 + k];
    const cv = row && row.querySelector('.tt-lane');
    if (!cv) break;
    const b = clip(spanBox(cv.getBoundingClientRect(), view, at, frames), row.closest('main'), doc.getElementById('np'));
    if (b) out.push(b);
  }
  return out;
}

// clip keeps a box to what shows of its lane: inside the lanes' scroller,
// and above the now-playing bar, which is docked over a phone's page -- a
// lane scrolled out of sight has no ghost over the page's foot.
function clip(b, scroller, bar) {
  let lo = 0, hi = Infinity;
  if (scroller) { const v = scroller.getBoundingClientRect(); lo = v.top; hi = v.bottom; }
  if (bar && bar.getClientRects().length) hi = Math.min(hi, bar.getBoundingClientRect().top);
  const top = Math.max(b.top, lo), bottom = Math.min(b.top + b.height, hi);
  if (bottom - top < 2 || b.width <= 0) return null;
  return { ...b, top, height: bottom - top };
}

/**
 * Lift is a drag of the buffer onto a lane: a chip under the finger, the
 * lane under it opened, ghosts on it and the tracks after it for every lane
 * of the buffer, and on release a drop there. `get()` is the tape state and
 * the buffer as they are now; `onDrop({track, at})` drops; `onEnd()` tidies.
 */
export class Lift {
  constructor({ doc, overlay, get, onDrop, onEnd, label = 'Buffer' }) {
    this.doc = doc;
    this.overlay = overlay;
    this.get = get;
    this.onDrop = onDrop;
    this.onEnd = onEnd;
    this.at = null;
    this.chip = doc.createElement('div');
    this.chip.className = 'buffer-chip';
    this.chip.textContent = label;
    overlay.el.append(this.chip);
    doc.body.classList.add('buffer-lifting');
  }

  move(x, y) {
    Object.assign(this.chip.style, { left: `${x}px`, top: `${y}px` });
    const { tape, view, snap, board } = this.get();
    const rs = rows(this.doc);
    // The chip and the layer are out of the way of the hit test.
    const hit = this.doc.elementFromPoint(x, y);
    const row = hit && hit.closest ? hit.closest('#lanes > .tape-track') : null;
    setTarget(rs, row);
    if (!row || !tape || !view || !board) { this.at = null; this.overlay.clear(); return; }
    const count = board.tracks.length;
    const i = rs.indexOf(row);
    if (i + count > rs.length) { // its lanes don't fit from this track
      this.at = null;
      this.overlay.ghosts([], '');
      return;
    }
    const rect = row.querySelector('.tt-lane').getBoundingClientRect();
    this.at = landing({ row, rowIndex: i, x, rect, view, tape, snap, frames: board.frames });
    const boxes = boxesFor(this.doc, { track: this.at.track, count, at: this.at.at, frames: board.frames, view });
    // Over a clip the drop lays the buffer on it: the ghost says so before it happens.
    const lands = { first: this.at.track, count, at: this.at.at, frames: board.frames, board };
    this.overlay.ghosts(boxes, `Lands · ${landsWords(tape.grid, lands, tape)}`, overwritten(tape, lands).clips > 0);
  }

  end(drop) {
    this.chip.remove();
    this.overlay.clear();
    setTarget(rows(this.doc), null);
    this.doc.body.classList.remove('buffer-lifting');
    const at = this.at;
    this.onEnd();
    if (drop && at) this.onDrop(at);
  }
}
