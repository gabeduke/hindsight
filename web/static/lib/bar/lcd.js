// web/static/lib/bar/lcd.js
// What the now-playing bar's LCD says, apart from any drawing: the position
// (large), the line beside it (small), the status lamp, and the line that
// scrolls under them naming what's loaded. Pure, so every state is tested.
//
// The tape's messages -- the count-in, a mixdown and its tail, saving, no
// output -- are the ones #position used to show, word for word.

import { barBeat, fmtSecs, bpm } from '../tape/geometry.js';

const OUT_WORDS = { jam: 'IN THE JAM ROOM', phone: 'ON A PHONE', both: 'IN THE JAM ROOM AND ON A PHONE' };

/**
 * tapeCounter is the LCD for the tape at one poll. md is the live mixdown
 * when it is this tape's (else null).
 */
export function tapeCounter(tape, live, md) {
  const sr = tape.sample_rate;
  const rec = live && live.record && live.record.tape === tape.id ? live.record : null;
  const counting = !!(live && live.count_in > 0);
  const mixing = !!(md && (md.state === 'playing' || md.state === 'tail'));
  const playing = !!(live && (live.playing || counting)) || mixing;
  const status = rec && rec.state === 'on' && !counting ? 'rec' : rec && rec.state === 'armed' ? 'armed' : playing ? 'play' : 'stop';
  const unit = tape.grid ? 'BAR' : '';
  if (!live) return { big: '', small: '', status, unit };
  const heard = live.heard;
  if (counting && tape.grid) {
    // The render head is ahead of what's heard by what's rendered ahead.
    const beat = tape.grid.frames / tape.grid.bars / 4;
    const left = Math.min(tape.grid.frames / tape.grid.bars, live.count_in + Math.max(0, live.out - live.delivered));
    return { big: `count-in ${Math.min(4, Math.max(1, 4 - Math.floor((left - 1) / beat)))} of 4`, small: '', status, unit: '' };
  }
  if (md && md.state === 'playing') {
    return { big: 'mixing down', small: `${fmtSecs(Math.max(0, heard - md.from), sr)} of ${fmtSecs(md.to - md.from, sr)} · ■ cancels`, status, unit: '' };
  }
  if (md && md.state === 'tail') return { big: 'mixing down', small: 'letting it ring out · ■ cancels', status, unit: '' };
  if (md && md.state === 'saving') return { big: 'saving', small: 'the mixdown, as a take…', status, unit: '' };
  const time = fmtSecs(heard, sr);
  const big = tape.grid ? barBeat(heard, tape.grid) : time;
  const small = !live.output ? 'no output' : tape.grid ? time : '';
  return { big, small, status, unit };
}

/** tapeMarquee is the scrolling line: the tape, its tempo and loop, where it plays, and a punch. */
export function tapeMarquee(tape, live) {
  const parts = [tape.name.toUpperCase()];
  if (tape.grid) {
    const barLen = tape.grid.frames / tape.grid.bars;
    parts.push(`${bpm(tape.grid, tape.sample_rate).toFixed(1)} BPM`, '4/4');
    if (tape.loop.out > tape.loop.in && tape.loop.on) {
      const a = Math.floor(tape.loop.in / barLen + 1e-9) + 1;
      const b = Math.ceil(tape.loop.out / barLen - 1e-9);
      parts.push(a === b ? `LOOP BAR ${a}` : `LOOP BARS ${a}–${b}`);
    } else if (tape.loop.out > tape.loop.in) {
      parts.push('LOOP OFF');
    }
  } else {
    parts.push('NO TEMPO YET');
  }
  parts.push(OUT_WORDS[(live && live.output_mode) || 'jam'] || OUT_WORDS.jam);
  const rec = live && live.record && live.record.tape === tape.id ? live.record : null;
  if (rec) parts.push(rec.state === 'on' ? `RECORDING TRACK ${rec.track}` : `TRACK ${rec.track} ARMED`);
  return parts.join(' · ');
}
