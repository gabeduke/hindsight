// web/static/lib/ribbonmath.js
// The ribbon's axis, as plain functions so they can be tested: age in
// seconds against position in percent, on the logarithmic scale the ribbon
// draws (see lib/ribbon.js), and ages against the ring's absolute frames,
// which is what a span save asks the Pi for.
//
//   left% = (1 - ln(age/A) / ln(T/A)) * 100
//
// A is the edge (the youngest age with its own pixel), T the ring's length.

/** leftPct is where an age (seconds ago) sits, in percent of the width. */
export function leftPct(age, A, T) {
  return (1 - Math.log(Math.max(age, A) / A) / Math.log(T / A)) * 100;
}

/** ageAt is the age at a position in percent: leftPct's inverse. */
export function ageAt(pct, A, T) {
  const p = Math.min(Math.max(pct, 0), 100) / 100;
  return A * Math.exp((1 - p) * Math.log(T / A));
}

/** frameAt is the absolute ring frame `age` seconds before `total`. */
export function frameAt(age, total, sampleRate) {
  return Math.max(0, Math.round(total - age * sampleRate));
}

/** ageOf is how long before `total` an absolute frame was, in seconds. */
export function ageOf(frame, total, sampleRate) {
  return Math.max(0, (total - frame) / sampleRate);
}

/** fmtAge is an age as m:ss (or h:mm:ss), for the selection's readout. */
export function fmtAge(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
