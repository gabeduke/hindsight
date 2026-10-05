// web/static/lib/wave/boundary.js
// The boundary editor's pure parts: a view about the point being placed,
// what the ZOOM and POSITION encoders do to it, the step, keeping In before
// Out, how the point reads, and the two halves of the seam view.
// Node-tested.
import { barBeat } from './geometry.js';

/** A full pad's width of ZOOM drag zooms this many times. */
export const ZOOM_PER_PAD = 64;
/** A full pad's width of POSITION drag moves the point by this share of the visible span. */
export const POSITION_PER_PAD = 0.5;

/**
 * viewAbout is a view width px wide at fpp (kept within [minFpp, the whole
 * take]) with frame in the middle -- or as near the middle as the take's
 * ends allow.
 */
export function viewAbout(frame, fpp, width, total, minFpp) {
  const f = Math.min(Math.max(minFpp, total / width), Math.max(minFpp, fpp));
  const span = width * f;
  const start = Math.min(Math.max(0, frame - span / 2), Math.max(0, total - span));
  return { start, fpp: f, width };
}

/** zoomBy is the fpp after a ZOOM drag of dx px on a pad padW wide: right is closer. */
export function zoomBy(fpp, dx, padW) {
  return fpp * Math.pow(ZOOM_PER_PAD, -dx / padW);
}

/** positionBy is how many frames a POSITION drag of dx px on a pad padW wide moves the point. */
export function positionBy(dx, padW, view) {
  return (dx / padW) * view.width * view.fpp * POSITION_PER_PAD;
}

/** stepFrames is one step: a sample when zoomed past a pixel a sample, else a millisecond. */
export function stepFrames(fpp, sampleRate) {
  return fpp < 1 ? 1 : Math.max(1, Math.round(sampleRate / 1000));
}

/** stepLabel names a step. */
export function stepLabel(frames, sampleRate) {
  return frames === 1 ? '1 smp' : `${Math.round((frames * 1000) / sampleRate)} ms`;
}

/**
 * placeEdge is where a boundary may go: a whole frame inside the take, and
 * for In and Out, at least minLen short of the other end. edge is 'start',
 * 'end' or 'downbeat'.
 */
export function placeEdge(edge, frame, { region, total, minLen }) {
  let f = Math.round(Math.min(total - 1, Math.max(0, frame)));
  if (region && edge === 'start') f = Math.max(0, Math.min(f, region.end - minLen));
  if (region && edge === 'end') f = Math.min(total, Math.max(f, region.start + minLen));
  return f;
}

/** fmtSample reads a frame as m:ss.mmm and the samples past that millisecond: "0:02.500 +31". */
export function fmtSample(frame, sampleRate) {
  const ms = Math.floor((frame * 1000) / sampleRate);
  const extra = Math.max(0, frame - Math.ceil((ms * sampleRate) / 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')} +${extra}`;
}

/**
 * beatOffset is how far a frame sits from its nearest beat line, in ms, and
 * that beat as bar.beat; null without a tempo.
 */
export function beatOffset(frame, grid) {
  if (!grid || !grid.bpm) return null;
  const beat = (60 / grid.bpm) * grid.sampleRate;
  const k = Math.round((frame - grid.downbeat) / beat);
  const line = grid.downbeat + k * beat;
  // ceil, not round: a beat that isn't a whole number of frames has its line at
  // a fraction, and barBeat floors, so rounding down would name the beat before.
  return { ms: ((frame - line) * 1000) / grid.sampleRate, at: barBeat(Math.ceil(line), grid) };
}

/** fmtOffset reads beatOffset: "+3.1 ms from 3.1", "on 3.1". */
export function fmtOffset(off) {
  if (!off) return '';
  if (Math.abs(off.ms) < 0.05) return `on ${off.at}`;
  return `${off.ms > 0 ? '+' : '−'}${Math.abs(off.ms).toFixed(1)} ms from ${off.at}`;
}

/**
 * crossedLine says whether moving from a to b crossed a line every step
 * frames from origin: the moments the editor ticks.
 */
export function crossedLine(a, b, origin, step) {
  if (!(step > 0) || a === b) return false;
  return Math.floor((a - origin) / step) !== Math.floor((b - origin) / step);
}

/**
 * seamHalves is the seam view's two halves of a view width px wide at fpp:
 * on the left, the stretch ending at Out; on the right, the stretch from In.
 * Each is a view half as wide.
 */
export function seamHalves(region, fpp, width) {
  const half = width / 2;
  const span = half * fpp;
  return {
    left: { start: region.end - span, fpp, width: half },
    right: { start: region.start, fpp, width: half },
  };
}

/**
 * snapRadius is how far either side of the point Attack or Zero looks, in
 * frames: Attack ±60 ms, or half of what is on screen if that is less; Zero
 * ±5 ms.
 */
export function snapRadius(kind, sampleRate, view) {
  if (kind === 'zero') return Math.round(sampleRate * 0.005);
  return Math.min(Math.round(sampleRate * 0.06), Math.round((view.width * view.fpp) / 2));
}

/**
 * playFrom is where "play from here" starts for a boundary: In and bar 1 at
 * the point itself, Out a second before it, so the edge arrives.
 */
export function playFrom(edge, frame, sampleRate) {
  return edge === 'end' ? Math.max(0, frame - sampleRate) : frame;
}

/**
 * wholeFrames takes the whole frames out of a running total of fractional
 * ones: { whole, rest }, both toward zero, so a small move backwards adds up
 * as a small move forwards does. The encoders and the wheel keep the rest.
 */
export function wholeFrames(acc) {
  const whole = Math.trunc(acc);
  return { whole: whole + 0, rest: acc - whole }; // + 0: never -0
}
