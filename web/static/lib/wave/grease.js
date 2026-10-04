// web/static/lib/wave/grease.js
// A grease-pencil mark: the line an editor drew on tape at an edit point.
// The take page draws its selection's In and Out this way. Pure, so the
// wobble is tested: the same seed (the edge's frame) gives the same stroke
// every frame, so a mark stays put on the audio instead of shimmering as
// the view pans and zooms.

const WANDER = 1.5; // px either side of the line, at most
const STEP = 10;    // px between the stroke's points

// phases turns a seed into two fixed phases, so the stroke's shape is the
// seed's and nobody else's.
function phases(seed) {
  let h = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return [(h & 0xffff) / 0xffff * Math.PI * 2, (h >>> 16) / 0xffff * Math.PI * 2];
}

/**
 * greaseStroke is the points of a mark at x from top to bottom: never more
 * than WANDER px off the line, the same for the same seed.
 */
export function greaseStroke(x, top, bottom, seed) {
  if (!(bottom > top)) return [[x, top]];
  const [p1, p2] = phases(seed);
  const pts = [];
  for (let y = top; ; y = Math.min(bottom, y + STEP)) {
    const d = 0.9 * Math.sin(y * 0.045 + p1) + 0.6 * Math.sin(y * 0.13 + p2);
    pts.push([x + Math.max(-WANDER, Math.min(WANDER, d)), y]);
    if (y >= bottom) break;
  }
  return pts;
}
