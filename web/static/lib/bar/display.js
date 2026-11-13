// web/static/lib/bar/display.js
// What the bar's display says beside where it is (docs/architecture/
// bar.md, "The display says what plays"): two keys on the LCD, each a value
// over its legend -- what plays (the source), and how: its tempo over where
// it plays, one key (the calm Studio's decision 5), or with no tempo, where
// it plays over OUT. A value has a short form, for the display as wide as a
// tablet leaves it, and a long one for the widest. What a press on each
// opens is the bar's (lib/components/transport/bar.js); Open draws the same
// two as cells. Pure.

import { bpm as bpmOf } from '../tape/geometry.js';

/** OUT_WORDS are where the tape plays, as the display says it. */
export const OUT_WORDS = Object.freeze({ jam: 'JAM ROOM', phone: 'PHONE', both: 'BOTH' });
const PLAYS = Object.freeze({ jam: 'Plays in the jam room', phone: 'Plays on a phone', both: 'Plays in the jam room and on a phone' });

/**
 * playsWords is where the tape plays (`mode`, the live output_mode), in
 * words: "Plays in the jam room", "Plays on a phone", "Plays in the jam room
 * and on a phone"; the jam room before the Pi says. The display's, to a
 * screen reader, and the tempo's panel's last row (lib/tape/page.js).
 */
export const playsWords = (mode) => PLAYS[mode] || PLAYS.jam;

/** tempoWords is a tempo as the display writes it: 96, or 129.9. */
export function tempoWords(bpm) {
  if (!(bpm > 0)) return '';
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// tempoKey is the display's one key for the tempo and where it plays: the
// tempo (`bpm`, tempoWords', and `long`, with the bars) over where it plays
// (`out`, the display's word), or with no tempo, where it plays over OUT.
// `alone` is the tempo by itself, under BPM, for the phone's player pulled
// up, whose foot says where it plays (the template's legend there).
function tempoKey(bpm, long, out) {
  if (!bpm) return { short: out, long: out, leg: 'OUT', alone: '–' };
  return { short: `${bpm} BPM`, long, leg: out, alone: bpm };
}

/**
 * tapeDisplay is the display for tape `t` (the Pi's state: name, grid,
 * sample_rate, loop) where it plays now (`mode`, the live output_mode):
 * { tempo, source, out, said }. tempo is the tempo's key, {short, long,
 * leg, alone}; source is {short, long}; out is where it plays, a word (the
 * phone's player's foot); said is what each tells a screen reader (the
 * tempo's: tempoLabel adds what a press on it does).
 */
export function tapeDisplay(t, mode = null) {
  const name = t?.name || 'the tape';
  const m = OUT_WORDS[mode] ? mode : 'jam';
  const plays = playsWords(m);
  let bpm = '';
  let long = '';
  let tempoSaid = 'No tempo yet';
  if (t?.grid) {
    const per = t.grid.frames / t.grid.bars;
    const bars = t.loop && t.loop.out > t.loop.in ? Math.round((t.loop.out - t.loop.in) / per) : t.grid.bars;
    bpm = tempoWords(bpmOf(t.grid, t.sample_rate));
    long = `${bpm} BPM · ${bars} BAR${bars === 1 ? '' : 'S'}`;
    tempoSaid = `Tempo ${bpm} BPM, ${bars} bar${bars === 1 ? '' : 's'}`;
  }
  return {
    tempo: tempoKey(bpm, long, OUT_WORDS[m]),
    source: { short: 'TAPE', long: `TAPE · ${name}` },
    out: OUT_WORDS[m],
    said: {
      tempo: `${tempoSaid}; ${plays.toLowerCase()}`,
      source: `Plays the tape, ${name}: choose what plays`,
      out: `${plays}: choose where`,
    },
  };
}

// hereSaid is a take or the feed played on this device, `here` (hereWord's).
const hereSaid = (here) => `plays on ${here.toLowerCase()}`;

/** takeDisplay is the display for a take, `title` at `bpm` (or none), played `here` (hereWord's). */
export function takeDisplay({ title, bpm = null }, here) {
  const b = tempoWords(bpm);
  return {
    tempo: tempoKey(b, `${b} BPM`, here),
    source: { short: title, long: `TAKE · ${title}` },
    out: here,
    said: {
      tempo: `${b ? `Tempo ${b} BPM` : 'No tempo'}; ${hereSaid(here)}`,
      source: `Plays the take ${title}: choose what plays`,
      out: `Plays on ${here.toLowerCase()}: choose where the tape plays`,
    },
  };
}

/** feedDisplay is the display for the live feed, played `here`. */
export function feedDisplay(here) {
  return {
    tempo: tempoKey('', '', here),
    source: { short: 'FEED', long: 'THE LIVE FEED' },
    out: here,
    said: {
      tempo: `No tempo; ${hereSaid(here)}`,
      source: 'Plays the live feed: choose what plays',
      out: `Plays on ${here.toLowerCase()}: choose where the tape plays`,
    },
  };
}

/**
 * tempoLabel is what the tempo's key says to a screen reader, from display
 * `d` (tapeDisplay's, takeDisplay's or feedDisplay's) and what a press on
 * it opens (`opens`): 'tempo', the Studio's tempo panel, in the Studio with
 * the tape; 'output', the Output sheet, anywhere else; null, nothing (no
 * tape to send).
 */
export function tempoLabel(d, opens) {
  if (opens === 'tempo') return `${d.said.tempo}: change the tempo, or where it plays`;
  if (opens === 'output') return `${d.said.tempo}: choose where the tape plays`;
  return d.said.tempo;
}

/**
 * syncState is SYNC on the display, the tape's annunciator in the Studio:
 * how its playback and recording line up (the Pi's live.aligned, `lock`).
 * { state, words }: 'ok' to the sample (exact or locked), 'wait' by the
 * clocks (estimated: nudge a catch if it's off), 'bad' playing and not
 * lined up yet, and 'off' -- not lit at all -- while the tape is stopped
 * (`idle`) or plays on a phone (`phoneOut`), when there is nothing to line
 * up. It was a dot beside ↶ in the header, which a touch screen couldn't
 * read without help mode.
 */
export function syncState(lock, { phoneOut = false, idle = false } = {}) {
  if (phoneOut) return { state: 'off', words: 'no lock: the tape is playing on a phone' };
  if (idle) return { state: 'off', words: 'stopped: nothing to line up yet' };
  if (lock === 'exact' || lock === 'locked') return { state: 'ok', words: `lined up to the sample (${lock})` };
  if (lock === 'estimated') return { state: 'wait', words: 'lined up by the clocks: nudge a catch if it’s off' };
  return { state: 'bad', words: 'not lined up yet: catches wait' };
}
