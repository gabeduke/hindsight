// web/static/lib/wave/cut-label.js
// What Save as take offers to call the new take: the name the server gives a
// cut that has none (internal/audio/cut.go: spanLabel, cutLabelBase), so the
// field shows exactly what leaving it empty would save. Pure, tested against
// the Go tests' cases.

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * spanLabel names a region for a cut's label: "0:42–1:10", with tenths of a
 * second when the region is under ten seconds long, where whole seconds would
 * often read the same at both ends.
 */
export function spanLabel(from, to, sampleRate) {
  if (!(sampleRate > 0)) return '';
  const tenths = to - from < 10 * sampleRate;
  const f = (frame) => {
    if (tenths) {
      const d = Math.floor((frame * 10) / sampleRate);
      return `${Math.floor(d / 600)}:${pad2(Math.floor(d / 10) % 60)}.${d % 10}`;
    }
    const s = Math.floor(frame / sampleRate);
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  };
  return `${f(from)}–${f(to)}`;
}

// What spanLabel writes, and nothing else: a label the owner typed that
// merely ends in something like " · 1–2" is left alone.
const SPAN = /^\d+:\d{2}(\.\d)?–\d+:\d{2}(\.\d)?$/;

/**
 * cutLabelBase is the part of a label a cut builds on: everything before a
 * trailing " · <span>" a previous cut added, so a cut of a cut reads
 * "riff · 0:05–0:10" rather than piling spans up.
 */
export function cutLabelBase(label) {
  const l = (label || '').trim();
  const i = l.lastIndexOf(' · ');
  return i >= 0 && SPAN.test(l.slice(i + 3)) ? l.slice(0, i) : l;
}

/** cutLabel is the name a cut of [from, to) of the take gets by default. */
export function cutLabel(take, from, to, sampleRate) {
  const base = cutLabelBase(take.label) || (take.name || '').replace(/\.wav$/, '');
  return `${base} · ${spanLabel(from, to, sampleRate)}`;
}
