// web/static/lib/buffer/cueclip.js
// A cue clip as the drawer reads it (docs/architecture/tape.md, The cue
// lane): the Pi keeps a GRAB on the lane as a cue clip with a lane per input
// and its handles (internal/tape/cuegrab.go), and the drawer is the buffer's
// own code, which reads boards. boardOf turns the one into the other, so
// model.js, draw.js and the drop's arithmetic read a cue clip unchanged.

/**
 * boardOf is a cue clip as a board: a track per lane, each lane the clip's
 * length at frame 0 with the clip's level and fades (the Pi applies them to
 * every lane alike), its grab its window and handles. `created` is the
 * clip's id: what names it to the audition and the drop's Undo. A clip from
 * before clips kept their inputs is one lane, its file, with no grab.
 */
export function boardOf(clip) {
  if (!clip) return null;
  const lanes = clip.lanes && clip.lanes.length ? clip.lanes : [{ file: clip.file, src: clip.src, source: clip.source }];
  return {
    created: clip.id,
    frames: clip.frames,
    bpm: clip.bpm || 0,
    from: clip.name || '',
    grab: clip.grab || null,
    touched: !!clip.touched,
    tracks: lanes.map((l) => [{
      ...l, at: 0, frames: clip.frames,
      gain_db: clip.gain_db || 0,
      fade_in: clip.fade_in || 0, fade_out: clip.fade_out || 0,
      fade_in_shape: clip.fade_in_shape || '', fade_out_shape: clip.fade_out_shape || '',
    }]),
  };
}

/** clipOn is the cue clip with that id on a tape's lane, or null. */
export function clipOn(tape, id) {
  if (!tape || !id) return null;
  return (tape.cue?.clips || []).find((c) => c.id === id) || null;
}

/**
 * ringOf is how far through its bar the tape is at frame pos: 0 on a bar
 * line, nearly 1 just before the next. A clip waiting for that line draws it
 * as its ring. null with no tempo, nothing to count to.
 */
export function ringOf(pos, grid) {
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0) || !Number.isFinite(pos)) return null;
  const bar = grid.frames / grid.bars;
  const f = ((pos % bar) + bar) % bar;
  return f / bar;
}

/**
 * replacedNote is what a GRAB that took an untouched clip's place says of
 * it, for its Undo: '' when it took nobody's.
 */
export function replacedNote(edit) {
  const r = edit?.cue_replaced;
  return r ? `In place of “${r.name || 'the last grab'}”, which you hadn’t used` : '';
}

/**
 * grabbedWords is a GRAB's toast: what it took, and, when it took the
 * place of an untouched clip, which, for its Undo.
 */
export function grabbedWords(what, edit) {
  const replaced = edit?.cue_replaced;
  if (!replaced) return `Grabbed ${what} onto the cue lane`;
  return `Grabbed ${what} in place of “${replaced.name || 'the last grab'}”, which you hadn’t used`;
}
