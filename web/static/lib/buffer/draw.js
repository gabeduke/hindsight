// web/static/lib/buffer/draw.js
// The buffer's window, drawn: a strip of oxide per lane, the audio grabbed
// with its handles either side, the handles shaded, the bar lines, IN and
// OUT in grease pencil, the fades on the window's top corners, and the
// audition's playhead. Everything is in the grab's frames (model.js): x 0 is
// the first handle frame, W the last.

import { drawGrease } from '../objects/grease.js';

export const RULER_H = 16; // px: the bar numbers over the oxide
export const FADE_BOX = 9; // px: a fade handle's square

/** xOf is where a grab frame is on a window W wide showing [lo, hi). */
export const xOf = (f, lo, hi, W) => ((f - lo) / (hi - lo)) * W;

/** frameOf is the grab frame at x. */
export const frameOf = (x, lo, hi, W) => lo + (x / W) * (hi - lo);

/** levelsOf turns a range of peaks into one level per column, 0..1. */
export function levelsOf(pd) {
  if (!pd || !pd.data || !pd.data.length) return null;
  const n = pd.buckets;
  const out = new Float32Array(n);
  for (const ch of pd.data) {
    for (let i = 0; i < n; i++) out[i] = Math.max(out[i], -ch[2 * i], ch[2 * i + 1]);
  }
  return out;
}

/**
 * fadeHandles are where the window's two fade squares sit: at the top
 * corners, in by each fade's length.
 */
export function fadeHandles({ lo, hi, W, win, fadeIn = 0, fadeOut = 0 }) {
  return {
    in: { x: xOf(win.in + fadeIn, lo, hi, W), y: RULER_H + 1 },
    out: { x: xOf(win.out - fadeOut, lo, hi, W), y: RULER_H + 1 },
  };
}

/**
 * drawWindow paints the buffer on ctx, W × H css px: grab frames [lo, hi),
 * the grab itself [0, frames). lanes: [{levels, name, gain}]
 * (levels per column, or null while they load); lines: model.js bufferLines;
 * win: {in, out}; fades: {in, out} frames; playAt: a grab frame, or null.
 */
export function drawWindow(ctx, { W, H, lo, hi, frames, lanes, lines, win, fades = { in: 0, out: 0 }, playAt = null, colors, grabbing = false }) {
  ctx.clearRect(0, 0, W, H);
  const x = (f) => xOf(f, lo, hi, W);
  const n = Math.max(1, lanes.length);
  const top = RULER_H;
  const gap = 2;
  const laneH = (H - top - gap * (n - 1)) / n;
  // The ruler: the grab's bars numbered, the handles named.
  ctx.fillStyle = colors.ruler;
  ctx.fillRect(0, 0, W, top);
  ctx.font = `600 10px ${colors.mono}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colors.label;
  if (x(0) > 44) ctx.fillText('before', 4, top / 2);
  if (W - x(frames) > 40) ctx.fillText('after', x(frames) + 4, top / 2);
  for (const l of lines) {
    if (!l.label) continue;
    ctx.fillText(l.label, x(l.frame) + 3, top / 2);
  }
  // Each lane: oxide, its audio, the handles shaded, the bar lines.
  for (let i = 0; i < lanes.length || i < 1; i++) {
    const y = top + i * (laneH + gap);
    const g = ctx.createLinearGradient(0, y, 0, y + laneH);
    g.addColorStop(0, colors.oxide);
    g.addColorStop(1, colors.oxideLo);
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, laneH);
    const lane = lanes[i];
    const lv = lane && lane.levels;
    if (lv && lv.length) {
      ctx.fillStyle = colors.trace;
      const mid = y + laneH / 2;
      const cw = W / lv.length;
      for (let c = 0; c < lv.length; c++) {
        const a = Math.min(1, lv[c] * (lane.gain || 1)) ** 0.85 * (laneH / 2 - 2);
        if (a < 0.4) continue;
        ctx.fillRect(c * cw, mid - a, Math.max(1, cw - 0.4), 2 * a);
      }
    } else if (grabbing || !lv) {
      ctx.fillStyle = colors.shade;
      ctx.fillRect(0, y + laneH / 2 - 0.5, W, 1);
    }
    if (lane && lane.name) {
      ctx.font = `500 10px ${colors.mono}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = colors.label;
      ctx.fillText(lane.name.toUpperCase(), 5, y + 4);
    }
  }
  // Bar lines, faint, over the oxide.
  ctx.fillStyle = colors.tick;
  for (const l of lines) ctx.fillRect(Math.round(x(l.frame)), top, 1, H - top);
  // What isn't in the window: the handles, shaded.
  ctx.fillStyle = colors.shade;
  const wi = x(win.in), wo = x(win.out);
  if (wi > 0) ctx.fillRect(0, top, wi, H - top);
  if (wo < W) ctx.fillRect(wo, top, W - wo, H - top);
  // The fades: a ramp from each top corner, with its square to drag.
  const fh = fadeHandles({ lo, hi, W, win, fadeIn: fades.in, fadeOut: fades.out });
  ctx.strokeStyle = colors.fade;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (fades.in > 0) { ctx.moveTo(wi, H); ctx.lineTo(fh.in.x, top + 1); }
  if (fades.out > 0) { ctx.moveTo(fh.out.x, top + 1); ctx.lineTo(wo, H); }
  ctx.stroke();
  ctx.fillStyle = colors.fade;
  for (const p of [fh.in, fh.out]) ctx.fillRect(p.x - FADE_BOX / 2, p.y, FADE_BOX, FADE_BOX);
  // The audition's playhead.
  if (playAt != null) {
    ctx.fillStyle = colors.play;
    ctx.fillRect(Math.round(x(playAt)) - 1, top, 2, H - top);
  }
  // IN and OUT, in grease pencil, written at the window's foot.
  drawGrease(ctx, {
    sx0: wi, sx1: wo, start: Math.round(win.in), end: Math.round(win.out), W,
    markTop: top - 2, markBottom: H, labelTop: H - 24, ink: colors.grease, halo: colors.oxideLo, font: colors.font,
  });
}
