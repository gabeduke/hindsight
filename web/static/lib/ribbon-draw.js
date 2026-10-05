// web/static/lib/ribbon-draw.js
// The ribbon on tape: the last stretch of the ring as a glowing trace on
// brown oxide, the chosen length lit, passing the record head at "now". The
// envelope is mono and dB-coded (0..255 on the meters' scale), and it is
// drawn straight on that scale -- the ribbon is a meter of the ring, read
// beside the VU meters, not a picture of a take. Pure apart from the canvas
// context drawRibbon is handed.

import { fmtDur } from './meter.js';
import { paintOxide, drawTrace, oxideColors } from './wave/tape-strip.js';
import { withAlpha } from './theme.js';

/** ribbonLevels reads the envelope's bytes as levels, 0 to 1. */
export function ribbonLevels(bytes) {
  return Float32Array.from(bytes, (b) => b / 255);
}

/**
 * tierPills places a pill at each capture length (`spans` in seconds; 0 is the
 * whole ring, `T` long), lit when it's the `selected` one. `at(age)` is the
 * ribbon's axis, in percent.
 */
export function tierPills(spans, selected, T, at) {
  return spans.map((s) => {
    const age = s === 0 ? T : s;
    return { s, x: at(age), label: fmtDur(age), on: s === selected };
  });
}

const TICKS = [900, 600, 300, 120, 60, 30, 10];

/**
 * rulerTicks labels the strip under the ribbon: the ring's oldest end, the
 * round ages it holds, and "now", dropping any mark closer than `minGap`
 * percent to the one before it.
 */
export function rulerTicks(T, at, minGap = 6) {
  const ages = [T, ...TICKS.filter((a) => a < T)];
  const out = [];
  for (const age of ages) {
    const x = at(age);
    if (x < 0 || x > 100 - minGap) continue;
    if (out.length && x - out.at(-1).x < minGap) continue;
    out.push({ x, label: fmtDur(age) });
  }
  out.push({ x: 100, label: 'now' });
  return out;
}

/** ribbonColors reads the ribbon's colours through `token(name, fallback)`. */
export function ribbonColors(token) {
  const glow = token('--trace-glow', 'transparent');
  return {
    oxide: oxideColors(token),
    centre: token('--oxide-edge', 'transparent'),
    trace: token('--trace', 'transparent'),
    hot: token('--trace-hot', 'transparent'),
    glow, haze: withAlpha(glow, 0.25), halo: withAlpha(glow, 0.35),
  };
}

/**
 * drawRibbon paints a W x H ribbon: the oxide, a dark centre line, the
 * whole trace unlit, then the part from `lit[0]` to `lit[1]` (px) hot and
 * glowing -- the chosen length, or a span held on the ribbon.
 */
export function drawRibbon(ctx, { W, H, levels, lit = null, colors }) {
  paintOxide(ctx, W, H, colors.oxide);
  ctx.save();
  ctx.fillStyle = colors.centre;
  ctx.fillRect(0, H / 2 - 1, W, 2);
  ctx.restore();
  const n = levels.length;
  if (!n) return;
  const opts = { cy: H / 2, half: H / 2 - 6, x0: 0, dx: W / n };
  ctx.save();
  ctx.globalAlpha = 0.6;
  drawTrace(ctx, levels, levels, { ...opts, line: colors.trace, glow: [{ color: colors.haze, blur: 3 }] });
  ctx.restore();
  if (lit && lit[1] > lit[0]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(lit[0], 0, lit[1] - lit[0], H);
    ctx.clip();
    drawTrace(ctx, levels, levels, {
      ...opts, line: colors.hot, fillAlpha: 0.14, width: 1.2,
      glow: [{ color: colors.glow, blur: 2 }, { color: colors.halo, blur: 8 }],
    });
    ctx.restore();
  }
}
