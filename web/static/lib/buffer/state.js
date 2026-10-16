// web/static/lib/buffer/state.js
// When the buffer's keys mean something, how long the window is, and which
// of the Pi's answers the buffer takes: the rules of buffer.js's state,
// kept pure so they're tested.

/** HELD_MS is how long ↵ drops a buffer again after a drop, with nothing else done. */
export const HELD_MS = 6000;

/**
 * keyState is what the buffer's keys may do now (keys.js): `open` while it
 * shows a grab and isn't grabbing, `held` just after a drop. `selecting`:
 * clips are selected on the tape, whose ↵ opens the clip.
 */
export function keyState(st, now, selecting = false) {
  const g = st.board && st.board.grab;
  if (!g || st.grabbing) return { open: false, held: false };
  return {
    open: !!st.open,
    held: !!(st.dropped && st.dropped === st.board.created && now - (st.droppedAt || 0) < HELD_MS && !selecting),
  };
}

/** windowFrames is how long the buffer is now: as the marks stand, held or sent. */
export function windowFrames(st) {
  const b = st.board;
  if (!b) return 0;
  const g = b.grab;
  if (st.local && g) return (st.local.out ?? g.out) - (st.local.in ?? g.in);
  return g ? g.out - g.in : b.frames;
}

/**
 * takesPoll says whether a fetch of the clipboard begun at gen is to be
 * taken: not if a change went out since, nor while a mark is held, nor
 * while a grab is on its way -- the grab's own answer is the clipboard then.
 */
export function takesPoll(st, gen) {
  return gen === st.gen && !st.local && !st.grabbing;
}

/**
 * pulledTo is the height a sheet settles at when its grip is let go with the
 * sheet `f` of the screen's height: peek, half or full. Pulled right down it
 * is a peek still -- it never closes (the ✕ closes it): a pull to see the
 * lanes that lost the buffer was a surprise, and only Buffer ▴ brought it back.
 */
export function pulledTo(f) {
  return f < 0.25 ? 'peek' : f < 0.62 ? 'half' : 'full';
}
