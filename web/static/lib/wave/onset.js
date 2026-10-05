// web/static/lib/wave/onset.js
// Finding where a hit starts and where the wave crosses zero, in a short
// stretch of a take's audio, for the boundary editor's Attack and Zero.
// Pure; node-tested.

// A hit is found in two passes. First, surely: energy over LONG_MS, which a
// held low note can't ripple, rising by RISE against the LONG_MS before it.
// That says a hit began somewhere in the LONG_MS + SLACK_MS before the rise.
// Then exactly, in two ways. Whatever was sounding before the hit (held
// notes, a pad, silence) is steady, so a short linear predictor fitted to the
// stretch just before predicts it, and its error stays small until the hit's
// first sample, which nothing before predicts. But a new pure tone starting
// from zero (a sine kick) is itself predictable; for that, when what came
// before repeats cycle by cycle, the audio less itself one cycle back is near
// zero until the hit begins.
const LONG_MS = 40;
const RISE = 1.15;       // the long energy's rise on the window before that makes a hit (~1.2 dB: a limited mix rises little)
const SLACK_MS = 25;     // how far before the long window the hit may begin (the rise peaks a little after it fills)
const PRE_MS = 30;       // the stretch read for what was sounding before
const ORDER = 24;        // the predictor's length: enough for a dozen steady tones
const CYCLE_MS = [2, 25];// a held note's cycle: 40–500 Hz
const PERIODIC = 0.9;    // how alike two cycles must be to count as one note held
const ENV_MS = 1;        // the residual's envelope window
const STAND = 4;         // how many times above anything before it the residual must stand
const NOISE = 1.5;       // ... and it began where it last stood within this of it

/**
 * parseWav16 reads the 16-bit PCM WAV /api/slice sends: its rate, channel
 * count, and the samples mixed to mono in -1..1.
 */
export function parseWav16(buf) {
  const dv = new DataView(buf);
  let at = 12, channels = 0, sampleRate = 0, bits = 0;
  while (at + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    const size = dv.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(at + 10, true);
      sampleRate = dv.getUint32(at + 12, true);
      bits = dv.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || channels < 1) throw new Error('not 16-bit PCM');
      const frames = Math.floor(Math.min(size, dv.byteLength - at - 8) / (2 * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += dv.getInt16(at + 8 + (f * channels + c) * 2, true);
        mono[f] = s / channels / 32768;
      }
      return { sampleRate, channels, mono };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no audio in the WAV');
}

/**
 * findZero is the index nearest i, within radius, where the wave crosses
 * zero (the sign changes between it and the sample before), or -1.
 */
export function findZero(x, i, radius) {
  for (let d = 0; d <= radius; d++) {
    for (const j of d ? [i - d, i + d] : [i]) {
      if (j < 1 || j >= x.length) continue;
      if ((x[j - 1] < 0 && x[j] >= 0) || (x[j - 1] >= 0 && x[j] < 0)) return j;
    }
  }
  return -1;
}

/** rms is the RMS of f(n) over the win values ending at each n in [lo, hi). */
function rms(f, lo, hi, win) {
  const out = new Float64Array(Math.max(0, hi - lo));
  let sum = 0;
  for (let n = lo; n < hi; n++) {
    const v = f(n);
    sum += v * v;
    if (n - win >= lo) { const o = f(n - win); sum -= o * o; }
    out[n - lo] = Math.sqrt(Math.max(0, sum) / win);
  }
  return out;
}

/**
 * predictor fits an order-p linear predictor to x[from, to) (autocorrelation
 * method, Levinson-Durbin) and answers its coefficients a[1..p], so that
 * x[n] is predicted as -sum a[k] x[n-k]; null for silence.
 */
function predictor(x, from, to, p) {
  const r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let n = from + k; n < to; n++) s += x[n] * x[n - k];
    r[k] = s;
  }
  if (r[0] < 1e-9) return null;
  r[0] *= 1 + 1e-9; // a hair of white noise keeps it stable
  const a = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
}

/** cycle is the lag, in [minLag, maxLag], at which x[from, to) best repeats, or 0 if it doesn't. */
function cycle(x, from, to, minLag, maxLag) {
  let best = 0, bestR = PERIODIC;
  for (let L = minLag; L <= maxLag; L++) {
    let ab = 0, aa = 0, bb = 0;
    for (let n = Math.max(from, L); n < to; n++) { const a = x[n], b = x[n - L]; ab += a * b; aa += a * a; bb += b * b; }
    if (aa < 1e-12 || bb < 1e-12) return 0;
    const r = ab / Math.sqrt(aa * bb);
    if (r > bestR) { bestR = r; best = L; }
  }
  return best;
}

/**
 * onsetIn is where res's short envelope first stands STAND times above all
 * it reached in [preLo, from), going back to where it last stood within
 * NOISE of that -- or -1 if it never does by best.
 */
function onsetIn(res, preLo, from, best, envN) {
  const R = rms(res, preLo, best + 1, envN);
  const r = (n) => R[n - preLo];
  let before = 0;
  for (let n = preLo + envN; n < from; n++) before = Math.max(before, r(n));
  const thr = Math.max(before * STAND, 1e-4);
  for (let n = from; n <= best; n++) {
    if (r(n) >= thr) {
      let m = n;
      while (m > from && r(m - 1) > before * NOISE) m--;
      return m;
    }
  }
  return -1;
}

/**
 * findAttack is the index where the strongest hit within radius of i starts,
 * or -1 when nothing there rises. See the passes above.
 */
export function findAttack(x, sr, i, radius) {
  const ms = (m) => Math.max(1, Math.round((sr * m) / 1000));
  const long = ms(LONG_MS), slack = ms(SLACK_MS), pre = ms(PRE_MS);
  const lo = Math.max(ORDER + 1, i - radius - 2 * long - slack - pre - ms(CYCLE_MS[1]));
  const hi = Math.min(x.length, i + radius + long);
  if (hi - lo < 3 * long) return -1;
  const E = rms((n) => x[n], lo, hi, long);
  const e = (n) => E[n - lo];
  const tiny = 1e-6;
  // The strongest rise of the long energy, its window ending within reach.
  let best = -1, bestRatio = RISE;
  for (let n = Math.max(lo + 2 * long, i - radius); n < Math.min(hi, i + radius + long); n++) {
    const r = (e(n) + tiny) / (e(n - long) + tiny);
    if (r > bestRatio) { bestRatio = r; best = n; }
  }
  if (best < 0) return -1;
  // The hit began in [from, best]; what sounded before it is in [from - pre, from).
  const from = Math.max(lo + 1, best - long - slack);
  const preLo = Math.max(lo + 1, from - pre);
  const A = predictor(x, preLo, from, Math.min(ORDER, from - preLo - 1));
  const envN = ms(ENV_MS);
  if (A) {
    const err = (n) => { let v = x[n]; for (let k = 1; k < A.length; k++) v += A[k] * x[n - k]; return v; };
    const at = onsetIn(err, preLo, from, best, envN);
    if (at >= 0) return at;
  }
  const L = cycle(x, preLo, from, ms(CYCLE_MS[0]), Math.min(ms(CYCLE_MS[1]), from - preLo - 1));
  const at = onsetIn(L ? (n) => x[n] - x[n - L] : (n) => x[n], preLo, from, best, envN);
  return at >= 0 ? at : from; // it rose, but never stood clear: the earliest it can have begun
}
