// web/static/lib/wave/draw.js
// One waveform renderer for every place a take is drawn: a row in the list,
// the overview strip, and the take page. They used to disagree -- the list on
// a dB scale, the take page linear with a "fit quiet takes" gain -- so the
// same take looked loud in one place and silent in the other.
//
// Two scales live here. drawColumns draws on the dB scale the meters and the
// buffer ribbon use (meter.js ampToFrac: -60..0 dBFS, sign kept): below about
// -20 dBFS linear amplitude looks like silence, and a home recording mostly
// lives there. But on that scale a whole take reads as one flat block, so the
// Reel-to-reel bars and trace use levels instead: the loudest moment of each
// slice, scaled by the take's own peak (takeGain, at most x8 so a near-silent
// take still looks quiet) and lifted by a 0.85 power. Every view of a take
// uses the same gain, so it looks the same everywhere. Pure apart from the
// canvas context it's handed.

import { ampToFrac } from '../meter.js';

/** shape maps a linear sample (-1..1) onto the drawn scale (-1..1). */
export const shape = ampToFrac;

/**
 * peakColumns folds whole-take peaks (PeakData: per channel, min,max pairs)
 * into `width` columns over buckets [b0, b1). Returns a Float32Array of
 * width*channels min,max pairs -- the same layout TileCache.columns gives the
 * take page -- with NaN where a column has no data.
 */
export function peakColumns(pd, width, b0 = 0, b1 = pd.buckets) {
  const ch = pd.channels;
  const out = new Float32Array(Math.max(0, width) * ch * 2).fill(NaN);
  const span = b1 - b0;
  if (!(span > 0) || width <= 0) return out;
  for (let x = 0; x < width; x++) {
    const lo = b0 + Math.floor((x / width) * span);
    const hi = Math.max(lo + 1, b0 + Math.floor(((x + 1) / width) * span));
    for (let c = 0; c < ch; c++) {
      let mn = Infinity, mx = -Infinity;
      const d = pd.data[c];
      for (let b = lo; b < hi && b < pd.buckets; b++) {
        if (d[b * 2] < mn) mn = d[b * 2];
        if (d[b * 2 + 1] > mx) mx = d[b * 2 + 1];
      }
      if (mx >= mn) { out[(x * ch + c) * 2] = mn; out[(x * ch + c) * 2 + 1] = mx; }
    }
  }
  return out;
}

/**
 * foldChannels turns per-channel columns into one lane: the widest extent of
 * any channel in each column. The overview and list rows draw one lane.
 */
export function foldChannels(cols, channels) {
  if (channels === 1) return cols;
  const width = cols.length / (channels * 2);
  const out = new Float32Array(width * 2).fill(NaN);
  for (let x = 0; x < width; x++) {
    let mn = Infinity, mx = -Infinity;
    for (let c = 0; c < channels; c++) {
      const a = cols[(x * channels + c) * 2], b = cols[(x * channels + c) * 2 + 1];
      if (b >= a) { if (a < mn) mn = a; if (b > mx) mx = b; }
    }
    if (mx >= mn) { out[x * 2] = mn; out[x * 2 + 1] = mx; }
  }
  return out;
}

/**
 * levelsFor folds whole-take peaks into `n` levels over buckets [b0, b1):
 * for each slice, the largest absolute sample on one channel, or on all of
 * them when `channel` is negative. Slices map onto buckets as in
 * peakColumns, so every slice has at least one bucket.
 */
export function levelsFor(pd, n, { b0 = 0, b1 = pd.buckets, channel = -1 } = {}) {
  const out = new Float32Array(Math.max(0, n));
  b0 = Math.floor(b0);
  b1 = Math.floor(b1);
  const span = b1 - b0;
  if (!(span > 0) || n <= 0) return out;
  // A channel the take doesn't have reads as silence.
  const chans = channel < 0 ? [...Array(pd.channels).keys()] : channel < pd.channels ? [channel] : [];
  for (let i = 0; i < n; i++) {
    const lo = b0 + Math.floor((i / n) * span);
    const hi = Math.max(lo + 1, b0 + Math.floor(((i + 1) / n) * span));
    let v = 0;
    for (const c of chans) {
      const d = pd.data[c];
      for (let b = lo; b < hi && b < pd.buckets; b++) {
        const a = Math.max(-d[b * 2], d[b * 2 + 1]);
        if (a > v) v = a;
      }
    }
    out[i] = v;
  }
  return out;
}

/**
 * takeGain is the gain that brings a take's loudest peak to full scale,
 * clamped to [1, max]: a clipped take is not shrunk, and a near-silent one is
 * not blown up into a loud-looking one. Hand it the whole take's peaks (the
 * file's, from /api/peaks), never a tile or a clip's range, or the gain would
 * change from one piece of the same take to the next.
 */
export function takeGain(pd, max = 8) {
  let peak = 0;
  for (let c = 0; c < pd.channels; c++) {
    const d = pd.data[c];
    for (let i = 0; i < pd.buckets * 2; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak > 0 ? Math.min(max, Math.max(1, 1 / peak)) : 1;
}

/**
 * lift maps a level to a drawn height fraction (0..1): scaled by the take's
 * gain, then bent by `gamma` -- 0.85 for the bars, as the design draws them;
 * the trace is drawn straight (gamma 1). No data (NaN) is silence.
 */
export function lift(v, gain = 1, gamma = 0.85) {
  return v > 0 ? Math.min(1, v * gain) ** gamma : 0;
}

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
 * barSegments places one bar per level, `pitch` px apart from x0: a vertical
 * stroke centred on cy, `min` px either side at the least so silence still
 * shows as a dot.
 */
export function barSegments(levels, { x0 = 0, pitch, cy, half, gain = 1, min = 0.6 }) {
  return Array.from(levels, (v, i) => {
    const a = Math.max(min, lift(v, gain) * half);
    return { i, x: x0 + i * pitch, y0: cy - a, y1: cy + a };
  });
}

/**
 * drawBars draws the cassette window's waveform: rounded bars, one path per
 * run of one colour, so a played/unplayed split costs two strokes. `color` is
 * a colour or a function of the bar's index. The boards draw bars from
 * smoothed levels: pass smooth(levelsFor(...)). The context comes back as it
 * was handed over.
 */
export function drawBars(ctx, levels, { color, width = 2.2, ...opts }) {
  const colorAt = typeof color === 'function' ? color : () => color;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  let run = null;
  for (const s of barSegments(levels, opts)) {
    const c = colorAt(s.i);
    if (c !== run) {
      if (run !== null) ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = c;
      run = c;
    }
    ctx.moveTo(s.x, s.y0);
    ctx.lineTo(s.x, s.y1);
  }
  if (run !== null) ctx.stroke();
  ctx.restore();
}

/**
 * drawColumns paints columns (from peakColumns or TileCache.columns) as
 * lanes stacked top to bottom inside {top, height}. `color` may be a
 * function of x, for a played/unplayed split.
 */
export function drawColumns(ctx, cols, channels, { top = 0, height, color = '#268bd2', fill = 0.95 }) {
  const width = cols.length / (channels * 2);
  const laneH = height / channels;
  const colorAt = typeof color === 'function' ? color : null;
  if (!colorAt) ctx.fillStyle = color;
  for (let x = 0; x < width; x++) {
    if (colorAt) ctx.fillStyle = colorAt(x);
    for (let c = 0; c < channels; c++) {
      const raw0 = cols[(x * channels + c) * 2], raw1 = cols[(x * channels + c) * 2 + 1];
      if (!(raw1 >= raw0)) continue;
      const mn = shape(Math.max(-1, Math.min(1, raw0)));
      const mx = shape(Math.max(-1, Math.min(1, raw1)));
      const mid = top + laneH * c + laneH / 2;
      const half = (laneH / 2) * fill;
      const y0 = mid - mx * half, y1 = mid - mn * half;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
}
