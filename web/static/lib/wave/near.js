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
  constructor({ file, sampleRate, total, fetchFn = defaultFetch, urlFor }) {
    this.file = file;
    this.sr = sampleRate;
    this.total = total;
    this.fetchFn = fetchFn;
    // urlFor(from, to) is the URL of a stretch of audio; the default is the
    // take's /api/slice, the tape page hands in /api/tapes/slice.
    this.urlFor = urlFor || ((f, t) => `/api/slice?file=${encodeURIComponent(file)}&from=${f}&to=${t}`);
    this.half = Math.round((sampleRate * SPAN_MS) / 1000);
    this.kept = null; // { from, x }
  }

  /** around answers { x, from }: mono samples x[k] at frame from + k, reaching SPAN_MS either side of frame where the take allows. */
  async around(frame) {
    const k = this.kept;
    // A span cut off by the take's start or end covers everything up to there.
    if (k && (k.from === 0 || frame - k.from >= this.half / 2) &&
        (k.from + k.x.length === this.total || k.from + k.x.length - frame >= this.half / 2)) return k;
    const from = Math.max(0, Math.round(frame) - this.half);
    const to = Math.min(this.total, Math.round(frame) + this.half);
    const res = await this.fetchFn(this.urlFor(from, to));
    if (!res.ok) throw new Error(`the audio there didn't load (${res.status})`);
    const { mono } = parseWav16(await res.arrayBuffer());
    this.kept = { from, x: mono };
    return this.kept;
  }
}
