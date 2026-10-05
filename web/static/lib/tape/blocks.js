// web/static/lib/tape/blocks.js
// A clip on a tape lane, drawn as the boards draw it: a rounded block in its
// track's colour with rounded bars inside (lib/wave/draw.js drawBars), and a
// small label saying what it is. Pure: the lane drawing in page.js asks these
// what to draw.

import { levelsFor, smooth } from '../wave/draw.js';
import { clipBuckets } from './geometry.js';

/**
 * clipLabel is what a clip's block says: "reversed" for one playing
 * backwards, "repeat" for one that plays the same audio as an earlier clip on
 * its track (the same file from the same point: a doubled loop, a copy), and
 * otherwise where it came from (aux, main, ch1, take), or nothing.
 */
export function clipLabel(clip, track) {
  if (clip.reversed) return 'reversed';
  const earlier = (o) => o.at < clip.at || (o.at === clip.at && o.id < clip.id);
  if ((track?.clips || []).some((o) => o !== clip && o.file === clip.file && o.src === clip.src && earlier(o))) return 'repeat';
  return clip.source || '';
}

/**
 * blockLevels is the bars of a block `width` px wide: one every `pitch` px,
 * each the loudest moment of its slice of the clip's part of its file,
 * smoothed as the boards draw them.
 */
export function blockLevels(pd, clip, width, pitch = 4) {
  const n = Math.max(1, Math.floor((width - 8) / pitch) + 1);
  const [b0, b1] = clipBuckets(clip, pd);
  return smooth(levelsFor(pd, n, { b0, b1 }));
}

/** labelFits says whether a block is wide enough to carry its label. */
export function labelFits(width) {
  return width >= 64;
}
