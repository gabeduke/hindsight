// web/static/lib/wave/tape-strip.js
// Trace on tape: the take's envelope as a thin cream line, glowing where it
// has played, on a strip of brown oxide with a sheen along the top and a fine
// grain. The ribbon, the take page and its overview draw with it. Colours are
// passed in; callers read them from the --oxide-* and --trace-* tokens, which
// are the same in both schemes because tape is an object, not a theme.

import { lift } from './draw.js';
import { withAlpha } from '../theme.js';

/** smooth weights each point twice its neighbours: (a + 2b + c) / 4. */
export function smooth(a) {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = a[i];
    out[i] = ((i > 0 ? a[i - 1] : v) + 2 * v + (i < n - 1 ? a[i + 1] : v)) / 4;
  }
  return out;
}

/**
 * traceLines turns per-pixel levels (top above the centre line, bot below;
 * the same array twice for a symmetric lane) into the two polylines of the
 * trace, each point on its pixel's centre.
 */
export function traceLines(top, bot, { cy, half, gain = 1 }) {
  const up = smooth(Array.from(top, (v) => lift(v, gain)));
  const dn = smooth(Array.from(bot, (v) => lift(v, gain)));
  return {
    upper: Array.from(up, (v, i) => [i + 0.5, cy - v * half]),
    lower: Array.from(dn, (v, i) => [i + 0.5, cy + v * half]),
  };
}

/**
 * drawTrace fills the envelope faintly, then strokes its top and bottom
 * edges in one path, glowing when `glow` is given. The context comes back as
 * it was handed over.
 */
export function drawTrace(ctx, top, bot, { cy, half, gain = 1, line, fill = line, fillAlpha = 0.07, width = 1, glow = null, blur = 3 }) {
  const { upper, lower } = traceLines(top, bot, { cy, half, gain });
  const n = upper.length;
  if (!n) return;
  ctx.save();
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * fillAlpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  for (const [x, y] of upper) ctx.lineTo(x, y);
  ctx.lineTo(n, cy);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(lower[i][0], lower[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha;
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const pts of [upper, lower]) pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

/** grainXs are the x positions of the oxide's grain lines. */
export function grainXs(w, step = 5) {
  const out = [];
  for (let x = 0; x < w; x += step) out.push(x);
  return out;
}

/** oxideColors reads the tape's colours through `token(name, fallback)`. */
export function oxideColors(token) {
  const t = (name) => token(name, 'transparent');
  return {
    edge: t('--oxide-edge'), lo: t('--oxide-lo'), mid: t('--oxide'),
    sheen: t('--oxide-sheen'), shade: t('--oxide-shade'), grain: t('--oxide-grain'),
  };
}

/** paintOxide paints a w x h strip of tape: base, sheen, shade and grain. */
export function paintOxide(ctx, w, h, { edge, lo, mid, sheen, shade, grain }) {
  const base = ctx.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of [[0, edge], [0.14, lo], [0.5, mid], [0.86, lo], [1, edge]]) base.addColorStop(o, c);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Fade to the same colour at zero alpha, not to 'transparent' (black), so
  // the edge of the sheen doesn't go grey.
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, sheen);
  top.addColorStop(0.3, withAlpha(sheen, 0));
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h);
  const bottom = ctx.createLinearGradient(0, 0, 0, h);
  bottom.addColorStop(0.7, withAlpha(shade, 0));
  bottom.addColorStop(1, shade);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = grain;
  for (const x of grainXs(w)) ctx.fillRect(x, 0, 1, h);
}
