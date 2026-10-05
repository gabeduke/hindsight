// web/static/lib/wave/tape-strip.js
// Trace on tape: the take's envelope as a thin cream line, glowing where it
// has played, on a strip of brown oxide with a sheen along the top and a fine
// grain. The ribbon, the take page and its overview draw with it. Colours are
// passed in; callers read them from the --oxide-* and --trace-* tokens, which
// are the same in both schemes because tape is an object, not a theme.
//
// The boards draw a lit trace in two passes: everything at 55 % alpha with a
// faint 3 px glow (--trace-glow at .25), then, clipped to [0, playhead], the
// hot line (--trace-hot, 1.3 px, fill 14 %) with a 2 px glow at .75 and an
// 8 px halo at .35. drawTrace is one pass; the caller sets the alpha and clip.

import { lift, smooth } from './draw.js';
import { withAlpha } from '../theme.js';

/**
 * traceLines turns levels (top above the centre line, bot below; the same
 * array twice for a symmetric lane) into the trace's two edges: point i at
 * x0 + (i + 0.5) * dx, so fewer points than pixels spread across a strip.
 * Levels are scaled by the gain and drawn straight (gamma 1), then smoothed.
 */
export function traceLines(top, bot, { cy, half, gain = 1, gamma = 1, x0 = 0, dx = 1 }) {
  const n = Math.min(top.length, bot.length);
  const up = new Float32Array(n), dn = new Float32Array(n), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    up[i] = lift(top[i], gain, gamma);
    dn[i] = lift(bot[i], gain, gamma);
  }
  const su = smooth(up), sd = smooth(dn);
  for (let i = 0; i < n; i++) {
    x[i] = x0 + (i + 0.5) * dx;
    su[i] = cy - su[i] * half;
    sd[i] = cy + sd[i] * half;
  }
  return { x, upper: su, lower: sd };
}

// A canvas shadow is in device pixels whatever the transform; the design's
// glows are in CSS pixels.
function deviceScale(ctx) {
  const t = ctx.getTransform?.();
  return t ? Math.hypot(t.a, t.b) || 1 : 1;
}

/**
 * drawTrace fills the envelope faintly, then strokes its top and bottom
 * edges once per glow (once, unglowing, with none): `glow` is a list of
 * {color, blur}, blur in CSS px. The fill follows the edges from x0 to
 * x0 + n * dx. The context comes back as it was handed over.
 */
export function drawTrace(ctx, top, bot, { cy, half, gain = 1, gamma = 1, x0 = 0, dx = 1, line, fill = line, fillAlpha = 0.07, width = 1, glow = [] }) {
  const { x, upper, lower } = traceLines(top, bot, { cy, half, gain, gamma, x0, dx });
  const n = x.length;
  if (!n) return;
  ctx.save();
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * fillAlpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  for (let i = 0; i < n; i++) ctx.lineTo(x[i], upper[i]);
  ctx.lineTo(x0 + n * dx, cy);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(x[i], lower[i]);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = line;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const ys of [upper, lower]) {
    ctx.moveTo(x[0], ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(x[i], ys[i]);
  }
  const k = deviceScale(ctx);
  for (const g of glow.length ? glow : [null]) {
    ctx.shadowColor = g ? g.color : 'transparent';
    ctx.shadowBlur = g ? g.blur * k : 0;
    ctx.stroke();
  }
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

/**
 * paintOxide paints a w x h strip of tape: base, sheen, shade and grain. The
 * context comes back as it was handed over.
 */
export function paintOxide(ctx, w, h, { edge, lo, mid, sheen, shade, grain }) {
  ctx.save();
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
  ctx.restore();
}
