// web/static/lib/wave/near.js
// The audio round a point, for the boundary editor's Attack and Zero: a
// short stretch from /api/slice (16-bit, which the browser caches as
// immutable), mixed to mono. One stretch is kept; a point inside its middle
// half reuses it.
import { parseWav16 } from './onset.js';

/** How far either side of the point a stretch reaches. */
export const SPAN_MS = 250;

const defaultFetch = (...args) => globalThis.fetch(...args);

export class NearAudio {
  constructor({ file, sampleRate, total, fetchFn = defaultFetch }) {
    this.file = file;
    this.sr = sampleRate;
    this.total = total;
    this.fetchFn = fetchFn;
    this.half = Math.round((sampleRate * SPAN_MS) / 1000);
    this.kept = null; // { from, x }
  }

  /** around answers { x, from }: mono samples x[k] at frame from + k, reaching SPAN_MS either side of frame where the take allows. */
  async around(frame) {
    const k = this.kept;
    if (k && frame - k.from >= this.half / 2 && k.from + k.x.length - frame >= this.half / 2) return k;
    const from = Math.max(0, Math.round(frame) - this.half);
    const to = Math.min(this.total, Math.round(frame) + this.half);
    const res = await this.fetchFn(`/api/slice?file=${encodeURIComponent(this.file)}&from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`the audio there didn't load (${res.status})`);
    const { mono } = parseWav16(await res.arrayBuffer());
    this.kept = { from, x: mono };
    return this.kept;
  }
}
