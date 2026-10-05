// web/static/lib/tape/align.js
// Aligning a clip on the tape: where it sounds, how tape frames map to its
// pool file's frames, the view of its file under a tape view, and the moves
// Hit → Grid and Hit → Track make. Pure; node-tested.
import { snapFrame, nudgeFrames } from './geometry.js';

/** soundingAt is the tape frame a clip's first frame is heard at: its at plus its nudge. */
export function soundingAt(clip, sampleRate) {
  return clip.at + nudgeFrames(clip, sampleRate);
}

/** toFile is the clip's pool-file frame heard at tape frame f. */
export function toFile(clip, f, sampleRate) {
  return f - soundingAt(clip, sampleRate) + clip.src;
}

/** toTape is the tape frame where the clip's pool-file frame k is heard. */
export function toTape(clip, k, sampleRate) {
  return k - clip.src + soundingAt(clip, sampleRate);
}

/**
 * fileView is the view of a clip's pool file under a tape view ({from, to})
 * width px wide: { start, fpp, width } in file frames, for the take page's
 * tile cache.
 */
export function fileView(clip, view, width, sampleRate) {
  const fpp = (view.to - view.from) / width;
  return { start: toFile(clip, view.from, sampleRate), fpp, width };
}

/**
 * gridMove is how far Hit → Grid moves a clip whose hit sounds at tape frame
 * hit: to the nearest line of the snap (the beat with the snap off). 0
 * without a grid.
 */
export function gridMove(hit, grid, snap) {
  if (!grid) return 0;
  return snapFrame(grid, hit, snap === 'off' ? 'beat' : snap) - hit;
}

/** beatGrid is the tape grid as the take page's beat maths wants it. */
export function beatGrid(grid, sampleRate) {
  if (!grid) return { bpm: null, sampleRate, downbeat: 0 };
  return { bpm: (grid.bars * 4 * 60 * sampleRate) / grid.frames, sampleRate, downbeat: 0 };
}

/**
 * clipUnder is the clip on a track heard at tape frame f -- the top layer
 * where several are -- or null.
 */
export function clipUnder(track, f, sampleRate) {
  let best = null;
  for (const c of track.clips || []) {
    const s = soundingAt(c, sampleRate);
    if (f >= s && f < s + c.frames && (!best || c.layer > best.layer)) best = c;
  }
  return best;
}

/**
 * placeAt is where a clip moved by delta may go: a whole frame, not before
 * the tape's start, and starting before its end (as a slide allows).
 */
export function placeAt(clip, delta, length) {
  return Math.min(length - 1, Math.max(0, Math.round(clip.at + delta)));
}
