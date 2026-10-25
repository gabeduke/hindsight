// web/static/lib/bar/display.js
// What the bar's display says beside where it is (docs/plan/the-studio-
// space.md, "The display says what plays"): the tempo, the source and where
// it plays, each a value on the LCD over its legend, and each a key that
// opens its menu (lib/bar/bar.js). A value has a short form, for the display
// as wide as a tablet leaves it, and a long one for the widest. Pure.

import { bpm as bpmOf } from '../tape/geometry.js';

/** OUT_WORDS are where the tape plays, as the display says it. */
export const OUT_WORDS = Object.freeze({ jam: 'JAM ROOM', phone: 'PHONE', both: 'BOTH' });
const OUT_SAID = Object.freeze({ jam: 'the jam room', phone: 'a phone', both: 'the jam room and a phone' });

/** tempoWords is a tempo as the display writes it: 96, or 129.9. */
export function tempoWords(bpm) {
  if (!(bpm > 0)) return '';
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const NONE = Object.freeze({ short: '–', long: 'NO TEMPO' });

/**
 * tapeDisplay is the display for tape `t` (the Pi's state: name, grid,
 * sample_rate, loop) where it plays now (`mode`, the live output_mode):
 * { tempo, source, out, said }. Each of tempo and source is {short, long};
 * out is a word, and said is what each key tells a screen reader.
 */
export function tapeDisplay(t, mode = null) {
  const name = t?.name || 'the tape';
  let tempo = NONE;
  let tempoSaid = 'no tempo yet';
  if (t?.grid) {
    const per = t.grid.frames / t.grid.bars;
    const bars = t.loop && t.loop.out > t.loop.in ? Math.round((t.loop.out - t.loop.in) / per) : t.grid.bars;
    const b = tempoWords(bpmOf(t.grid, t.sample_rate));
    tempo = { short: b, long: `${b} BPM · ${bars} BAR${bars === 1 ? '' : 'S'}` };
    tempoSaid = `${b} BPM, ${bars} bar${bars === 1 ? '' : 's'}`;
  }
  const m = OUT_WORDS[mode] ? mode : 'jam';
  return {
    tempo,
    source: { short: 'TAPE', long: `TAPE · ${name}` },
    out: OUT_WORDS[m],
    said: {
      tempo: `Tempo: ${tempoSaid}`,
      source: `Plays the tape, ${name}: choose what plays`,
      out: `Plays in ${OUT_SAID[m]}: choose where`,
    },
  };
}

/** takeDisplay is the display for a take, `title` at `bpm` (or none), played `here` (hereWord's). */
export function takeDisplay({ title, bpm = null }, here) {
  const b = tempoWords(bpm);
  return {
    tempo: b ? { short: b, long: `${b} BPM` } : NONE,
    source: { short: title, long: `TAKE · ${title}` },
    out: here,
    said: {
      tempo: b ? `Tempo: ${b} BPM` : 'Tempo: none',
      source: `Plays the take ${title}: choose what plays`,
      out: `Plays on ${here.toLowerCase()}: choose where the tape plays`,
    },
  };
}

/** feedDisplay is the display for the live feed, played `here`. */
export function feedDisplay(here) {
  return {
    tempo: NONE,
    source: { short: 'FEED', long: 'THE LIVE FEED' },
    out: here,
    said: {
      tempo: 'Tempo: none',
      source: 'Plays the live feed: choose what plays',
      out: `Plays on ${here.toLowerCase()}: choose where the tape plays`,
    },
  };
}
