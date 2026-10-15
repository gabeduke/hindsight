// web/static/lib/objects/pennant.js
// A flag stuck in the tape: a small yellow pennant on a stem, and a line
// down through the audio where it was planted. The take page draws one in
// its ruler for every flag on the take (lib/wave/view.js), with the flag's
// name beside it when there is room before the next.
//
// The ribbon on Capture plants the same flag in the ring, but as an element
// rather than on a canvas, because it is a thing to tap (it backs undo of a
// mistap): its shape is .rb-flag in styles.css, a swallowtail rather than
// this pointed pennant. The bench shows the two side by side.
//
// The colour is --flag, which follows the scheme, so it is passed in.

/** PENNANT_TOP is how far below the ruler's top edge the pennant hangs, px. */
export const PENNANT_TOP = 2;

/**
 * pennant is the cloth's three corners for a stem at x: it flies right of
 * the stem, 8 px out and 8 px deep, from `top`.
 */
export function pennant(x, top = PENNANT_TOP) {
  return [[x + 2, top], [x + 10, top + 4], [x + 2, top + 8]];
}

/**
 * drawPennant plants a flag at x: its line from pinH down to bottom --
 * thicker when it's the flag selected -- and its stem and pennant in the
 * pinH px above. `ink` is the flag's colour.
 */
export function drawPennant(ctx, x, { pinH, bottom, selected = false, ink }) {
  ctx.fillStyle = ink;
  ctx.fillRect(Math.round(x) - (selected ? 1 : 0), pinH, selected ? 3 : 1, bottom - pinH);
  // The pin: a small pennant on a stem.
  ctx.fillRect(Math.round(x), PENNANT_TOP, 2, pinH - PENNANT_TOP);
  const [a, b, c] = pennant(x);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill();
}

/**
 * drawPennantName writes a flag's name beside its pennant, in the font the
 * caller has set, at most 140 px wide. It answers where the name ends,
 * with a gap after it, so the next flag's name can tell whether it fits.
 */
export function drawPennantName(ctx, x, label, { pinH, ink }) {
  const w = Math.min(140, ctx.measureText(label).width);
  ctx.fillStyle = ink;
  ctx.fillText(label, x + 12, pinH - 4, 140);
  return x + 12 + w + 6;
}
