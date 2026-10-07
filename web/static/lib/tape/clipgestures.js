// web/static/lib/tape/clipgestures.js
// A clip on a tape lane under a finger: which part of its block a point is
// on, and what a press there turns into. Pure: page.js draws the blocks and
// sends the edits; it hands each pointer event here and does what comes back.
//
// The parts of a block (zones):
//   body      the block: tap it for its sheet, hold it and drag to slide it
//   in, out   its left and right edges: grips, for the steps that add them
//   repeat    its top-right corner: a grip, for the step that adds it
// Zones are in CSS pixels, so a grip is HANDLE_PX wide at any zoom. A block
// too narrow to hold its grips and still leave a body gets none; its sheet
// does what they would.
//
// The gestures, one pointer at a time, followed by its id:
//   tap              press and lift without moving SLOP_PX: the lane's click
//   hold, then drag  a still press of HOLD_MS on the body, then a drag: slide
//   drag a grip      a press on a grip that moves SLOP_PX: the grip follows
// A press on the body that moves SLOP_PX before the hold is a swipe: the
// lanes pan it, and the clip lets go.

export const HOLD_MS = 300;        // the tape's hold (the take page's is 350)
export const SLOP_PX = 8;          // a finger this still is a press, not a drag
export const HANDLE_PX = 24;       // a grip's width (and the corner's height)
export const MIN_GRIPS_PX = 3 * HANDLE_PX; // two grips and a body between
export const CLICK_GRACE_MS = 600; // a click this soon after a drag ends it, not a tap

/**
 * zonesOf is the zones of one block, the grips first: a block is {x0, x1,
 * top, h} in CSS pixels on its lane, and `kinds` the grips it offers ('in',
 * 'out', 'repeat'). A zone is {zone, x0, x1} and, for the corner, y0 and y1;
 * the others take the lane's whole height. With no kinds, or too narrow a
 * block, it's the body alone.
 */
export function zonesOf(block, kinds = []) {
  const { x0, x1, top = 0, h = 0 } = block;
  const body = { zone: 'body', x0, x1 };
  if (!kinds.length || x1 - x0 < MIN_GRIPS_PX) return [body];
  const zones = [];
  if (kinds.includes('repeat')) zones.push({ zone: 'repeat', x0: x1 - HANDLE_PX, x1, y0: top, y1: top + Math.min(HANDLE_PX, h / 2) });
  if (kinds.includes('in')) zones.push({ zone: 'in', x0, x1: x0 + HANDLE_PX });
  if (kinds.includes('out')) zones.push({ zone: 'out', x0: x1 - HANDLE_PX, x1 });
  zones.push(body);
  return zones;
}

const inZone = (z, x, y) => x >= z.x0 && x <= z.x1 && (z.y0 === undefined || (y >= z.y0 && y <= z.y1));

/**
 * hitClip is what's at (x, y) on a lane: {clip, zone, block}, or null on an
 * empty stretch. `blocks` are the lane's blocks in the order drawn, the base
 * layer first, each {x0, x1, top, h, clip}; where they overlap the one drawn
 * last, on top, is hit. `kindsFor(clip)` names the grips a clip offers now.
 */
export function hitClip(blocks, x, y, kindsFor = () => []) {
  for (let i = (blocks || []).length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (x < b.x0 || x > b.x1) continue;
    const z = zonesOf(b, kindsFor(b.clip)).find((zz) => inZone(zz, x, y));
    return { clip: b.clip, zone: z ? z.zone : 'body', block: b };
  }
  return null;
}

/**
 * ClipGesture follows one pointer on a lane's clips. Each call takes a point
 * {id, x, y} in client pixels and answers what the page should do, or null
 * for nothing:
 *
 *   down(p, hit)  {type: 'press', hold}: call hold() after `hold` ms
 *                 {type: 'grip', zone, clip}: a grip is pressed; capture the
 *                 pointer, so the drag is the grip's
 *   hold()        {type: 'slideStart', clip, id}: the press is a slide now;
 *                 capture pointer `id`
 *   move(p)       {type: 'swipe'}: not the clip's; the lanes pan it
 *                 {type: 'slide', clip, dx}: the slide follows the finger
 *                 {type: 'gripMove', zone, clip, dx, dy}
 *   up(p)         {type: 'slideEnd' | 'gripEnd', clip, zone?, dx, commit}, or
 *                 {type: 'release'} for a press that was neither
 *   cancel(p), lost(p)  the same, with commit false (a lost capture ends only
 *                 a drag: a press never captured the pointer)
 *
 * `dx` is the travel from the press, in pixels. Only a drag commits: a held
 * press that never moved SLOP_PX moves nothing, and its click opens the sheet.
 */
export class ClipGesture {
  constructor({ now = () => performance.now() } = {}) {
    this.now = now;
    this.g = null;
    this.quietUntil = 0;
  }

  /** A slide or a grip is being dragged: the lanes leave the finger alone. */
  get dragging() { return !!this.g && (this.g.phase === 'held' || this.g.phase === 'grip'); }

  /** A slide has been held (moved or not), so the pointer is captured. */
  get held() { return !!this.g && this.g.phase === 'held'; }

  down(p, hit) {
    if (this.g || !hit) return null; // one pointer at a time
    this.g = { id: p.id, x: p.x, y: p.y, clip: hit.clip, zone: hit.zone, moved: false };
    if (hit.zone === 'body') {
      this.g.phase = 'press';
      return { type: 'press', hold: HOLD_MS };
    }
    this.g.phase = 'grip-press';
    return { type: 'grip', zone: hit.zone, clip: hit.clip };
  }

  hold() {
    const g = this.g;
    if (!g || g.phase !== 'press') return null;
    g.phase = 'held';
    return { type: 'slideStart', clip: g.clip, id: g.id };
  }

  move(p) {
    const g = this.g;
    if (!g || p.id !== g.id) return null;
    const far = Math.hypot(p.x - g.x, p.y - g.y) > SLOP_PX;
    const dx = p.x - g.x;
    if (g.phase === 'press') {
      if (!far) return null;
      this.g = null;
      return { type: 'swipe' };
    }
    if (g.phase === 'held') {
      if (far) g.moved = true;
      return g.moved ? { type: 'slide', clip: g.clip, dx } : null;
    }
    if (g.phase === 'grip-press') {
      if (!far) return null;
      g.phase = 'grip';
      g.moved = true;
    }
    return { type: 'gripMove', zone: g.zone, clip: g.clip, dx, dy: p.y - g.y };
  }

  up(p) { return this.end(p, true); }

  cancel(p) { return this.end(p, false); }

  /** A lost capture ends a drag; a press never captured the pointer. */
  lost(p) { return this.dragging ? this.end(p, false) : null; }

  end(p, commit) {
    const g = this.g;
    if (!g || p.id !== g.id) return null;
    this.g = null;
    const dx = p.x === undefined ? 0 : p.x - g.x;
    if (g.phase === 'held') {
      if (g.moved) this.quietUntil = this.now() + CLICK_GRACE_MS;
      return { type: 'slideEnd', clip: g.clip, dx, commit: commit && g.moved };
    }
    if (g.phase === 'grip') {
      this.quietUntil = this.now() + CLICK_GRACE_MS;
      return { type: 'gripEnd', zone: g.zone, clip: g.clip, dx, commit };
    }
    return { type: 'release' }; // a press, or a grip let go unmoved: the click is the tap
  }

  /** clickIsTap: false for the click that ends a drag, true for a tap. */
  clickIsTap() {
    if (this.now() < this.quietUntil) {
      this.quietUntil = 0;
      return false;
    }
    return true;
  }
}
