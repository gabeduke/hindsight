// web/static/lib/tape/reels.js
// How the tape machine's reels move, apart from any drawing: where the
// tape is between the page's polls, how much tape is on each reel, and how
// far each reel has turned.
//
// The page polls the Pi about five times a second. Between polls a playing
// tape is run on at its sample rate, never more than AHEAD_S past the last
// poll, so a late poll can't send the reels spinning off. When the tape
// jumps -- the loop coming round, a tap on the ruler, an undo -- the reels
// don't snap: they wind or rewind to it over EASE_MS, the way a machine
// would, then play on.

/** How long a jump takes to wind or rewind, in ms. */
export const EASE_MS = 450;
const AHEAD_S = 0.5; // the furthest a playing tape is run on past a poll
const JUMP_S = 0.5;  // a poll this far from where the tape was is a jump
const SPEED = 45;    // tape travel per second of audio, in reel-radius units
const STALE_MS = 2000; // no poll for this long: the Pi isn't answering, so stop

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * packRadii is how much tape is on each reel, as radii: all of it on the
 * left at the start, all on the right at the end. The area of tape is
 * conserved, so the reels fill and empty the way real packs do.
 */
export function packRadii(pos, length, hub = 17, full = 64) {
  const f = length > 0 ? clamp(pos / length, 0, 1) : 0;
  const span = full * full - hub * hub;
  return { left: Math.sqrt(full * full - f * span), right: Math.sqrt(hub * hub + f * span) };
}

export class ReelMotion {
  /** reduced: the device asks for less motion, so jumps land at once and the reels don't turn. */
  constructor({ sampleRate, length, reduced = false }) {
    this.sr = sampleRate;
    this.length = length;
    this.reduced = reduced;
    this.base = null;   // the last poll: {pos, playing, at}
    this.ease = null;   // a jump being wound: {from, start}
    this.pos = 0;       // where the reels show the tape
    this.angleL = 0;
    this.angleR = 0;
  }

  setLength(length) { this.length = length; }

  // runAt is where the last poll puts the tape at `now`.
  runAt(now) {
    const b = this.base;
    if (!b) return this.pos;
    let p = b.pos;
    if (b.playing) p += clamp((now - b.at) / 1000, 0, AHEAD_S) * this.sr;
    return clamp(p, 0, this.length);
  }

  /** poll takes what the Pi said: the tape at pos, playing or not, at time `at` (ms). */
  poll(pos, playing, at) {
    if (!this.base) {
      this.base = { pos, playing, at };
      this.pos = clamp(pos, 0, this.length);
      return;
    }
    const expected = this.runAt(at);
    this.base = { pos, playing, at };
    if (!this.reduced && Math.abs(pos - expected) > JUMP_S * this.sr) {
      this.ease = { from: this.pos, start: at };
    } else if (this.reduced) {
      this.ease = null;
    }
  }

  /** frame is the reels at time `now` (ms): call it once per animation frame. */
  frame(now) {
    const target = this.runAt(now);
    let pos = target;
    // A playing tape with no word from the Pi for a while is shown stopped
    // where it got to, rather than animated forever on a guess.
    const fresh = this.base && now - this.base.at < STALE_MS;
    let moving = this.base && this.base.playing && fresh ? 'play' : 'stop';
    if (this.ease) {
      const t = (now - this.ease.start) / EASE_MS;
      if (t >= 1) {
        this.ease = null;
      } else {
        const k = 1 - Math.pow(1 - clamp(t, 0, 1), 3);
        pos = this.ease.from + (target - this.ease.from) * k;
        moving = target < this.ease.from ? 'rewind' : 'wind';
      }
    }
    const r = packRadii(pos, this.length);
    if (!this.reduced) {
      // Both reels turn the same way: the tape leaves one as it arrives on
      // the other. A smaller pack turns faster for the same tape.
      const ds = ((pos - this.pos) / this.sr) * SPEED;
      this.angleL = (this.angleL - (ds / r.left) * (180 / Math.PI)) % 360;
      this.angleR = (this.angleR - (ds / r.right) * (180 / Math.PI)) % 360;
    }
    this.pos = pos;
    return { pos, left: r.left, right: r.right, angleL: this.angleL, angleR: this.angleR, moving };
  }
}
