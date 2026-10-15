// web/static/lib/objects/grease.js
// A grease-pencil mark: the line an editor drew on tape at an edit point.
// The take page draws its selection's In and Out this way (drawGrease, from
// lib/wave/view.js), and the cassette its window's (lib/objects/cassette.js,
// with a hook at each end). The geometry is pure, so the wobble is tested:
// the same seed (the edge's frame) gives the same stroke every frame, so a
// mark stays put on the audio instead of shimmering as the view pans and
// zooms.
//
// The pencil on black is --grease-mark, the same in both schemes, in
// objects.css. --grease, the darker legend the take page writes In and Out
// in on its panels, follows the scheme and stays in styles.css.

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

const GAP = 7;    // px between a mark and its label
const LINE = 20;  // px down to a second line of labels
const MARGIN = 2; // px kept clear of the canvas's edges

/**
 * labelPlaces is where IN and OUT are written, beside marks at sx0 and sx1
 * on a canvas W wide, given each label's width: inside a selection wide
 * enough to hold both, else outside, each by its own mark; and where one
 * side has no room -- at the take's start or end -- both on the side that
 * has, one above the other, so they never print over each other or across
 * a mark. y is 0 or LINE, below the labels' top. A mark off the canvas has
 * no label (null).
 */
export function labelPlaces(sx0, sx1, wIn, wOut, W) {
  let inAt, outAt;
  if (sx1 - sx0 >= wIn + wOut + 4 * GAP) {
    inAt = { x: sx0 + GAP, y: 0 };
    outAt = { x: sx1 - GAP - wOut, y: 0 };
  } else {
    const left = sx0 - GAP, right = sx1 + GAP;
    const inFits = left - wIn >= MARGIN, outFits = right + wOut <= W - MARGIN;
    if (inFits && outFits) {
      inAt = { x: left - wIn, y: 0 };
      outAt = { x: right, y: 0 };
    } else if (outFits) {
      inAt = { x: right, y: 0 };
      outAt = { x: right, y: LINE };
    } else {
      inAt = { x: left - wIn, y: 0 };
      outAt = { x: left - wOut, y: LINE };
    }
  }
  return {
    in: sx0 >= 0 && sx0 <= W ? inAt : null,
    out: sx1 >= 0 && sx1 <= W ? outAt : null,
  };
}

/**
 * drawGrease draws a selection's In and Out as grease-pencil marks on a
 * canvas W wide, at sx0 and sx1, from markTop to markBottom -- each mark's
 * wobble seeded by its frame (start, end) -- and writes IN and OUT beside
 * them in marker from labelTop, with a halo of the window behind the words
 * so they read over loud audio. A mark well off the canvas is not drawn.
 * `ink` is the pencil, `halo` the window, `font` the face to fall back to
 * while the marker loads.
 */
export function drawGrease(ctx, { sx0, sx1, start, end, W, markTop, markBottom, labelTop, ink, halo, font }) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [x, frame] of [[sx0, start], [sx1, end]]) {
    if (x < -4 || x > W + 4) continue;
    const pts = greaseStroke(x, markTop, markBottom, frame);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
  ctx.font = `18px "Permanent Marker", ${font}`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 4;
  ctx.strokeStyle = halo;
  ctx.fillStyle = ink;
  const wIn = ctx.measureText('IN').width, wOut = ctx.measureText('OUT').width;
  const at = labelPlaces(sx0, sx1, wIn, wOut, W);
  for (const [text, p] of [['IN', at.in], ['OUT', at.out]]) {
    if (!p) continue;
    ctx.strokeText(text, p.x, labelTop + p.y);
    ctx.fillText(text, p.x, labelTop + p.y);
  }
  ctx.restore();
}
