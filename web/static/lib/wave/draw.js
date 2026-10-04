// web/static/lib/wave/draw.js
// One waveform renderer for every place a take is drawn: a row in the list,
// the overview strip, and the take page. They used to disagree -- the list on
// a dB scale, the take page linear with a "fit quiet takes" gain -- so the
// same take looked loud in one place and silent in the other.
//
// Everything is drawn on the dB scale the meters and the buffer ribbon use
// (meter.js ampToFrac: -60..0 dBFS, sign kept), because below about -20 dBFS
// linear amplitude looks like silence and a home recording mostly lives
// there. Pure apart from the canvas context it's handed.

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
