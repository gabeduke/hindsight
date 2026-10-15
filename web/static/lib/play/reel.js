// web/static/lib/play/reel.js
// The strip's reel, as numbers: how fast it should turn for what the tape
// is doing now, and how heavily it gets there
// (docs/superpowers/specs/2026-10-15-instrument-strip-design.md, "The reel
// is the ring"). The ticker steps it with motion.js's spin() toward this.
//
// It answers the Pi's `at`, not the touch: `mode` is the trick that is
// sounding (the last head trick to fire, by anyone's hand), so the reel
// moves when the sound does. The pad's dim state is what answers the touch.
//
//   REV        runs backwards
//   STOP       winds down with inertia over the beat
//   ½× · 2×    changes speed
//   CHOP       rocks: a slice forward, a slice back
//   BREAK      keeps turning while the sound cuts
//
// Pure, so it's tested as arithmetic.

/** BASE is how fast the reel turns at 1×, in turns a second: a picture, not the tape's speed. */
export const BASE = 0.5;

/** The tricks that move the read head, in the order a hand finds them. */
export const HEAD_TRICKS = ['break', 'reverse', 'chop', 'stop', 'half', 'double'];

/**
 * modeOf is the head trick sounding now: the newest in `sounding` (pads in
 * the order they fired), or '' for none. Track keys don't move the head.
 */
export function modeOf(sounding) {
  for (let i = sounding.length - 1; i >= 0; i--) if (HEAD_TRICKS.includes(sounding[i])) return sounding[i];
  return '';
}

// spin()'s time constant is inertia / drag × 10 ms, drag 1.8: so an inertia
// of 18 is about 100 ms.
const inertiaFor = (ms) => Math.max(1, (ms * 1.8) / 10);

/**
 * target is {rate, inertia} for spin(): the rate in turns a second, and the
 * inertia that gets it there over the right time. `beatMs` is a beat at the
 * tape's tempo, `sliceMs` CHOP's slice; `now` (ms) rocks CHOP.
 */
export function target({ playing, mode = '', now = 0, beatMs = 500, sliceMs = 125 }) {
  if (!playing) return { rate: 0, inertia: inertiaFor(400) }; // coasts down
  switch (mode) {
    case 'reverse': return { rate: -BASE, inertia: inertiaFor(80) };
    case 'stop': return { rate: 0, inertia: inertiaFor(beatMs / 3) }; // most of the way over the beat
    case 'half': return { rate: BASE / 2, inertia: inertiaFor(120) };
    case 'double': return { rate: BASE * 2, inertia: inertiaFor(120) };
    case 'chop': {
      const back = Math.floor(now / Math.max(20, sliceMs)) % 2 === 1;
      return { rate: back ? -BASE : BASE, inertia: inertiaFor(sliceMs / 4) };
    }
    case 'break': // the tape runs on underneath: so does the reel
    default: return { rate: BASE, inertia: inertiaFor(100) };
  }
}
