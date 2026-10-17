// web/static/lib/edit/curves.js
// Shared curve mathematics, fade presets, and gain formatting across
// the Studio's multitrack tape reel and the standalone waveform editor.

/**
 * FADE_SHAPES are the curves a fade can take, by the name a clip keeps:
 * '' is equal power, every fade's curve before there was a choice.
 */
export const FADE_SHAPES = [
  { id: '', label: 'Equal power' },
  { id: 'linear', label: 'Linear' },
  { id: 's', label: 'S-curve' },
  { id: 'exp', label: 'Exponential' },
];

/**
 * fadeCurve is a fade's gain x of the way up from silence, 0 to 1, on the
 * curve `shape` names; a fall is the same read backwards. The same sums as
 * internal/tape fadeCurve, so what's drawn is what plays.
 */
export function fadeCurve(shape, x) {
  switch (shape) {
    case 'linear': return x;
    case 's': return (1 - Math.cos(x * Math.PI)) / 2;
    case 'exp': return (1000 ** x - 1) / 999; // 60 dB, straight in decibels
    default: return Math.sin((x * Math.PI) / 2);
  }
}

/**
 * fadeOptions are the clip and waveform fade lengths: off, 10 ms, and with a
 * tempo an eighth of a beat, a quarter, a beat and a bar. Each is {id,
 * label, frames}; frames is null for one that cannot be evaluated without tempo.
 */
export function fadeOptions(grid, sampleRate) {
  const bar = grid && grid.frames > 0 && grid.bars > 0 ? grid.frames / grid.bars : 0;
  const beat = bar / 4;
  const of = (f) => (bar ? Math.round(f) : null);
  return [
    { id: 'off', label: 'off', frames: 0 },
    { id: '10ms', label: '10 ms', frames: Math.round(0.01 * sampleRate) },
    { id: 'b8', label: '⅛ beat', frames: of(beat / 8) },
    { id: 'b4', label: '¼ beat', frames: of(beat / 4) },
    { id: 'beat', label: '1 beat', frames: of(beat) },
    { id: 'bar', label: '1 bar', frames: of(bar) },
  ];
}

/** fadeOption is the option a fade of `frames` is, or null for another length. */
export function fadeOption(frames, grid, sampleRate) {
  return fadeOptions(grid, sampleRate).find((o) => o.frames !== null && Math.abs(o.frames - (frames || 0)) <= 1) || null;
}

/** gainText is a Level gain as the UI displays it: "+6.2 dB", "−1.0 dB", "0 dB". */
export function gainText(db) {
  if (!db) return '0 dB';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}
