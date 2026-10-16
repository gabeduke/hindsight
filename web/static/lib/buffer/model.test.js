import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barStart, barAt, nextBar, nextFreeSpan, spanWords, dropKey, grabKey, grabSeconds, overwritten, landsWords,
  clampWindow, windowLimits, gridOf, snapNear, edgeStep, bufferLines, bufferMeta, bufferNote, barsText, boardKey, chipsFor,
} from './model.js';

const SR = 48000;
// A tape at 120 BPM: a bar is 96000 frames; 32 bars long.
const BAR = 96000;
function tape({ clips = [[], [], [], []], loop = { in: 0, out: 8 * BAR, on: true }, grid = { frames: 8 * BAR, bars: 8 }, length = 32 * BAR } = {}) {
  return {
    sample_rate: SR, length, grid, loop,
    tracks: clips.map((cs, i) => ({ n: i + 1, clips: cs.map(([a, b]) => ({ at: a * BAR, frames: (b - a) * BAR })) })),
  };
}

test('bar lines fall where the Pi puts them, at an awkward tempo too', () => {
  const bar = 137142.857; // 84 BPM
  assert.equal(barStart(3, bar), 411429);
  assert.equal(barAt(411428, bar), 2);
  assert.equal(barAt(411429, bar), 3);
  assert.equal(nextBar(411429, bar), 411429);
  assert.equal(nextBar(411430, bar), barStart(4, bar));
  assert.equal(Object.is(barStart(0, bar), -0), false);
});

test('the next free span is the first gap long enough after the next bar line', () => {
  // Track 2 has bars 1–2 and 5–6 taken; a 2-bar buffer, the playhead in bar 1.
  const t = tape({ clips: [[], [[0, 2], [4, 6]], [], []] });
  assert.deepEqual(nextFreeSpan(t, { first: 2, frames: 2 * BAR, pos: BAR / 2 }), { at: 2 * BAR });
  // A 3-bar one doesn't fit in bars 3–4, nor in the loop's bars 7–8: with
  // the loop off, it goes after bar 6.
  assert.equal(nextFreeSpan(t, { first: 2, frames: 3 * BAR, pos: BAR / 2 }), null);
  const off = { ...t, loop: { ...t.loop, on: false } };
  assert.deepEqual(nextFreeSpan(off, { first: 2, frames: 3 * BAR, pos: BAR / 2 }), { at: 6 * BAR });
});

test('it starts at the next bar line after the playhead, not under it', () => {
  const t = tape();
  // Mid-bar 3: bar 4's line. On a bar line: that line.
  assert.deepEqual(nextFreeSpan(t, { first: 1, frames: BAR, pos: 2 * BAR + 1000 }), { at: 3 * BAR });
  assert.deepEqual(nextFreeSpan(t, { first: 1, frames: BAR, pos: 3 * BAR }), { at: 3 * BAR });
});

test('it wraps round the loop: a span free only before the playhead is found', () => {
  // The 8-bar loop; track 1 full from bar 3 to the loop's end. The playhead
  // in bar 6: nothing after it fits, so it comes round to bar 1.
  const t = tape({ clips: [[[2, 8]], [], [], []] });
  assert.deepEqual(nextFreeSpan(t, { first: 1, frames: 2 * BAR, pos: 5 * BAR + 10 }), { at: 0 });
  // It never runs past the loop's Out, even with tape after it.
  assert.equal(nextFreeSpan(tape({ clips: [[[0, 7]], [], [], []] }), { first: 1, frames: 2 * BAR, pos: 0 }), null);
  // A buffer longer than the loop has nowhere to go.
  assert.equal(nextFreeSpan(t, { first: 2, frames: 9 * BAR, pos: 0 }), null);
});

test('with the loop off it runs to the tape’s end, then round from its start', () => {
  const t = tape({ clips: [[[0, 1], [10, 32]], [], [], []], loop: { in: 0, out: 8 * BAR, on: false } });
  assert.deepEqual(nextFreeSpan(t, { first: 1, frames: 4 * BAR, pos: 9 * BAR }), { at: 1 * BAR });
  assert.deepEqual(nextFreeSpan(t, { first: 1, frames: 2 * BAR, pos: 3 * BAR }), { at: 3 * BAR });
});

test('several lanes need the span free on each of their tracks', () => {
  // Track 2 free in bars 1–4, track 3 busy in bars 2–3: two lanes from track
  // 2 go to bar 4.
  const t = tape({ clips: [[], [], [[1, 3]], []] });
  assert.deepEqual(nextFreeSpan(t, { first: 2, count: 2, frames: BAR, pos: 0 }), { at: 0 });
  assert.deepEqual(nextFreeSpan(t, { first: 2, count: 2, frames: 2 * BAR, pos: 0 }), { at: 3 * BAR });
  // Lanes past the last track don't fit.
  assert.equal(nextFreeSpan(t, { first: 4, count: 2, frames: BAR, pos: 0 }), null);
});

test('with no tempo it lands at the playhead or after a clip; an empty tape takes it at 0', () => {
  const none = tape({ grid: null, loop: { in: 0, out: 0, on: false }, clips: [[[1, 2]], [], [], []] });
  assert.deepEqual(nextFreeSpan(none, { first: 1, frames: BAR / 2, pos: BAR / 4 }), { at: BAR / 4 });
  assert.deepEqual(nextFreeSpan(none, { first: 1, frames: BAR, pos: BAR / 2 }), { at: 2 * BAR });
  const empty = tape({ grid: null, loop: { in: 0, out: 0, on: false } });
  assert.deepEqual(nextFreeSpan(empty, { first: 3, frames: 5 * BAR, pos: 7 * BAR }), { at: 0 });
});

test('spanWords names bars, or the clock with no tempo', () => {
  assert.equal(spanWords(tape().grid, 8 * BAR, BAR, SR), 'bar 9');
  assert.equal(spanWords(null, 12 * SR, BAR, SR), 'at 0:12');
});

// F7 (flow spec, decision 10). DROP lands on the armed track at the next bar
// line inside the loop, over what is there; its key says so first, and it
// is never refused for room. The old rule looked for the next free span and
// said NO ROOM when a full loop left none.
const key = (over = {}) => dropKey({ tape: tape(), armed: 2, frames: 4 * BAR, pos: 0, ...over });

test('the DROP key names the track and the bars, and says "replaces" when something is there', () => {
  const full = tape({ clips: [[], [[0, 4]], [], []] });
  const k = key({ tape: full });
  assert.deepEqual([k.can, k.track, k.at, k.word, k.sub, k.replaces], [true, 2, 0, 'Drop on track 2', 'bars 1–4 · replaces', true]);
  const empty = key();
  assert.deepEqual([empty.can, empty.word, empty.sub, empty.replaces], [true, 'Drop on track 2', 'bars 1–4', false]);
});

test('"replaces" is said exactly when the span lies over a clip on a lane it lands on', () => {
  const sub = (clips, over) => key({ tape: tape({ clips }), ...over }).sub;
  assert.equal(sub([[], [[4, 8]], [], []]), 'bars 1–4', 'a clip after the span');
  assert.equal(sub([[], [[0, 4]], [], []]), 'bars 1–4 · replaces', 'a clip exactly under it');
  assert.equal(sub([[], [[3, 5]], [], []]), 'bars 1–4 · replaces', 'a clip that only overlaps its end');
  assert.equal(sub([[[0, 8]], [], [[0, 8]], [[0, 8]]]), 'bars 1–4', 'full everywhere but the armed track');
  // A clip touching the span's last frame, and one starting on its end.
  const t = tape({ clips: [[], [], [], []] });
  t.tracks[1].clips.push({ at: 4 * BAR - 1, frames: 10 });
  assert.equal(key({ tape: t }).sub, 'bars 1–4 · replaces', 'one frame in');
  t.tracks[1].clips = [{ at: 4 * BAR, frames: 10 }];
  assert.equal(key({ tape: t }).sub, 'bars 1–4', 'one frame out');
  // A buffer of two lanes replaces if either lane has something there.
  const two = tape({ clips: [[], [], [[0, 2]], []] });
  assert.equal(key({ tape: two, armed: 2, count: 2, frames: 2 * BAR }).sub, 'bars 1–2 · replaces');
  assert.equal(key({ tape: two, armed: 1, count: 2, frames: 2 * BAR }).sub, 'bars 1–2', 'lanes 1–2 are clear');
});

test('it lands on the next bar line at or after the playhead, inside the loop', () => {
  assert.equal(key({ frames: 2 * BAR, pos: 2.5 * BAR }).at, 3 * BAR);
  assert.equal(key({ frames: 2 * BAR, pos: 3 * BAR }).at, 3 * BAR, 'on a bar line it is that line');
  assert.equal(key({ frames: 2 * BAR, pos: 3 * BAR + 1 }).at, 4 * BAR);
  assert.equal(key({ frames: 2 * BAR, pos: 2.5 * BAR }).sub, 'bars 4–5');
});

test('it wraps at the loop’s end: a part that would run out of the loop starts at its In', () => {
  assert.equal(key({ frames: 2 * BAR, pos: 6 * BAR }).at, 6 * BAR, 'it just fits');
  assert.equal(key({ frames: 2 * BAR, pos: 6.5 * BAR }).at, 0, 'the next bar line would run out of the loop');
  assert.equal(key({ frames: 2 * BAR, pos: 7 * BAR + 10 }).at, 0);
  assert.equal(key({ frames: 2 * BAR, pos: 9 * BAR }).at, 0, 'a playhead outside the loop: its In');
  const shifted = tape({ loop: { in: 2 * BAR, out: 6 * BAR, on: true } });
  assert.equal(key({ tape: shifted, frames: 2 * BAR, pos: 0 }).at, 2 * BAR, 'before the loop: its first bar line');
  assert.equal(key({ tape: shifted, frames: 2 * BAR, pos: 5.5 * BAR }).at, 2 * BAR, 'wraps to the In, not to 0');
});

test('a loop that is full is no reason to refuse: it lands over what is there', () => {
  const clips = [[[0, 8]], [[0, 8]], [[0, 8]], [[0, 8]]];
  const t = tape({ clips });
  for (const frames of [BAR, 2 * BAR, 4 * BAR, 8 * BAR]) {
    for (const pos of [0, BAR / 2, 3 * BAR, 7.9 * BAR, 20 * BAR]) {
      for (const armed of [1, 2, 3, 4]) {
        const k = key({ tape: t, armed, frames, pos });
        assert.equal(k.can, true, `${frames / BAR} bars at ${pos / BAR} on ${armed}: ${k.word} ${k.sub}`);
        assert.equal(k.replaces, true);
        assert.equal(k.track, armed);
        assert.ok(k.at >= 0 && k.at + frames <= 8 * BAR, `${k.at / BAR} + ${frames / BAR} inside the loop`);
        assert.doesNotMatch(`${k.word} ${k.sub}`, /no room|full/i);
      }
    }
  }
});

test('a part as long as the loop starts at its In, wherever the playhead is', () => {
  for (const pos of [0, 3 * BAR, 7.5 * BAR]) assert.equal(key({ frames: 8 * BAR, pos }).at, 0);
  assert.equal(key({ frames: 8 * BAR, pos: 0 }).long, false, 'it fits the loop exactly: not "past" it');
});

test('a part longer than the loop starts at its In and runs past it, and says so', () => {
  const k = key({ frames: 10 * BAR, pos: 3 * BAR });
  assert.deepEqual([k.can, k.at, k.long], [true, 0, true]);
  assert.equal(k.sub, 'bars 1–10 · runs past the loop');
  const shifted = tape({ loop: { in: 2 * BAR, out: 6 * BAR, on: true } });
  assert.equal(key({ tape: shifted, frames: 5 * BAR }).at, 2 * BAR);
  assert.match(key({ tape: shifted, frames: 5 * BAR }).sub, /runs past the loop$/);
});

test('only a part longer than the tape itself is refused, and it says to trim it', () => {
  const k = key({ tape: tape({ length: 12 * BAR }), frames: 13 * BAR });
  assert.equal(k.can, false);
  assert.match(k.word, /Longer than the tape/);
  assert.match(k.sub, /IN and OUT/);
  // From the loop's In it would run past the tape's end, but the tape can hold it:
  const nearly = key({ tape: tape({ length: 8 * BAR, loop: { in: 2 * BAR, out: 6 * BAR, on: true } }), frames: 7 * BAR });
  assert.deepEqual([nearly.can, nearly.at, nearly.fitted], [true, BAR, true], 'it fits the tape, so it lands, moved back');
});

test('with the loop off it is the next bar line from the playhead, wrapping only at the tape’s end', () => {
  const off = tape({ loop: { in: 0, out: 8 * BAR, on: false } });
  assert.equal(key({ tape: off, frames: 2 * BAR, pos: 10.5 * BAR }).at, 11 * BAR);
  assert.equal(key({ tape: off, frames: 4 * BAR, pos: 30 * BAR }).at, 0, 'it would run past the tape’s end');
  assert.equal(key({ tape: off, frames: 2 * BAR, pos: 10.5 * BAR }).long, false);
});

test('with no tempo it lands at the playhead; an empty tape takes it at 0', () => {
  const none = tape({ grid: null, loop: { in: 0, out: 8 * BAR, on: false }, clips: [[], [[0, 1]], [], []] });
  assert.equal(key({ tape: none, frames: BAR / 2, pos: BAR / 4 }).at, BAR / 4);
  assert.equal(key({ tape: none, frames: BAR / 2, pos: BAR / 4 }).sub, 'at 0:01 · replaces');
  const empty = tape({ grid: null, loop: { in: 0, out: 0, on: false } });
  assert.equal(key({ tape: empty, frames: 5 * BAR, pos: 7 * BAR }).at, 0);
});

test('no track armed: the key is off and says to arm one', () => {
  for (const armed of [0, undefined]) {
    const k = key({ armed, armedAll: [] });
    assert.deepEqual([k.can, k.word, k.sub], [false, 'Drop', 'arm a track']);
  }
});

test('with several tracks armed, DROP goes on the first of them, and says so', () => {
  const k = key({ armed: 2, armedAll: [2, 4], frames: BAR });
  assert.deepEqual([k.can, k.track, k.word, k.sub], [true, 2, 'Drop on track 2', 'the first armed track · bar 1']);
  assert.equal(key({ armed: 2, armedAll: [2], frames: BAR }).sub, 'bar 1');
});

test('a buffer of two lanes starts where two fit, when the armed track is the last', () => {
  const k = key({ armed: 4, count: 2, frames: BAR });
  assert.deepEqual([k.can, k.track, k.word], [true, 3, 'Drop on tracks 3–4']);
  assert.match(k.sub, /^2 lanes don’t fit from track 4 · bar 1$/);
  assert.equal(key({ armed: 1, count: 5, frames: BAR }).can, false);
  assert.match(key({ armed: 1, count: 5, frames: BAR }).word, /Too many lanes/);
  assert.equal(key({ armed: 3, count: 2, frames: BAR }).word, 'Drop on tracks 3–4');
});

test('there is no tape yet', () => {
  assert.equal(dropKey({ tape: null, armed: 1, frames: BAR }).can, false);
});

// F7 review: "replaces" must follow the Pi's own rule. A buffer copied from
// several picked clips (board.clips) is laid down clearing only the span under
// each copied clip (internal/tape clipboard.go, dropBoard), not the whole
// window, so a clip in the gap between two of them is left alone.
test('a buffer copied from several clips replaces only under each of them, not in the gaps between', () => {
  // Track 3's two 1-bar clips, at 0 and 3.75 bars, were copied together; track 2 has a clip in the gap.
  const board = { clips: true, frames: 4.75 * BAR, tracks: [[{ at: 0, frames: BAR }, { at: 3.75 * BAR, frames: BAR }]] };
  const t = tape();
  t.tracks[1].clips.push({ at: 1.875 * BAR, frames: 1.25 * BAR });
  const k = dropKey({ tape: t, armed: 2, count: 1, frames: board.frames, pos: 0, board });
  assert.equal(k.can, true);
  assert.equal(k.at, 0);
  assert.equal(k.replaces, false, 'the clip in the gap is not touched');
  assert.equal(k.sub, 'bars 1–5');
  // Under one of the copied clips it does replace.
  t.tracks[1].clips.push({ at: 0.5 * BAR, frames: BAR });
  assert.equal(dropKey({ tape: t, armed: 2, count: 1, frames: board.frames, pos: 0, board }).replaces, true);
  // Without the Pi's `clips` mark it is a span, and the whole window is cleared.
  assert.equal(dropKey({ tape: tape({ clips: [[], [[2, 3]], [], []] }), armed: 2, count: 1, frames: board.frames, pos: 0, board: { ...board, clips: false } }).replaces, true);
});

test('overwritten and landsWords follow the copied clips too, lane by lane', () => {
  const board = { clips: true, frames: 3 * BAR, tracks: [[{ at: 0, frames: BAR }], [{ at: 2 * BAR, frames: BAR }]] };
  const t = tape({ clips: [[[1, 2]], [[0, 2]], [], []] });
  // Lane 1 of the copy lands on track 1 (clip at 0–1 bar: the tape's clip at 1–2 is clear of it);
  // lane 2 lands on track 2 under bar 3 (the tape's clip at 0–2 is clear of that).
  assert.deepEqual(overwritten(t, { first: 1, count: 2, at: 0, frames: 3 * BAR, board }), { clips: 0, frames: 0 });
  assert.deepEqual(overwritten(t, { first: 1, count: 2, at: -BAR, frames: 3 * BAR, board }), { clips: 1, frames: BAR }, 'moved a bar back, lane 2 now lies over track 2’s clip');
  assert.equal(landsWords(t.grid, { first: 1, count: 2, at: 0, frames: 3 * BAR, board }, t), 'bars 1–3');
});

// A property check against the rule written out the way the Pi's clearRange
// reads, for boards of one span or of picked clips, any armed track and playhead.
test('"replaces" agrees with what the Pi would clear, for spans and for picked clips, over many tapes', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  let replacing = 0, clear = 0, picked = 0;
  for (let i = 0; i < 400; i++) {
    const clips = [0, 1, 2, 3].map(() => Array.from({ length: ri(0, 3) }, () => { const a = ri(0, 14); return [a, a + ri(1, 3)]; }));
    const t = tape({ clips });
    const lanes = ri(1, 2);
    const multi = rnd() < 0.5;
    const board = multi
      ? { clips: true, tracks: Array.from({ length: lanes }, () => Array.from({ length: ri(1, 3) }, () => ({ at: ri(0, 8) * (BAR / 2) | 0, frames: ri(1, 3) * (BAR / 2) }))) }
      : { tracks: Array.from({ length: lanes }, () => [{ at: 0, frames: 2 * BAR }]) };
    if (multi) { board.frames = Math.max(...board.tracks.flat().map((c) => c.at + c.frames)); picked++; }
    const frames = multi ? board.frames : ri(1, 6) * BAR;
    const armed = ri(1, 4);
    const k = dropKey({ tape: t, armed, count: lanes, frames, pos: ri(0, 12) * BAR, board });
    if (!k.can) continue;
    // The Pi: each lane's span(s) are cleared on tape track first + lane.
    let want = false;
    for (let l = 0; l < lanes; l++) {
      const spans = multi ? board.tracks[l].map((c) => [k.at + c.at, k.at + c.at + c.frames]) : [[k.at, k.at + frames]];
      for (const c of t.tracks[k.track - 1 + l].clips) if (spans.some(([a, b]) => c.at < b && c.at + c.frames > a)) want = true;
    }
    assert.equal(k.replaces, want, `case ${i}: ${JSON.stringify({ clips, board, armed, at: k.at, track: k.track })}`);
    if (want) replacing++; else clear++;
  }
  assert.ok(replacing > 40 && clear > 40 && picked > 100, `the cases cover both answers and picked clips: ${replacing} ${clear} ${picked}`);
});

// A part that fits the tape but not from the loop's In to the tape's end is
// never refused: it starts at the latest bar line that fits inside the tape,
// and the key says it moved back. Only a part longer than the tape is refused.
test('a loop near the tape’s end does not refuse a part the tape can hold: it starts back so it fits', () => {
  const t = tape({ length: 10 * BAR, loop: { in: 8 * BAR, out: 10 * BAR, on: true } });
  const k = key({ tape: t, frames: 4 * BAR, pos: 0 });
  assert.equal(k.can, true);
  assert.equal(k.at, 6 * BAR, 'the latest bar line from which 4 bars fit before the tape ends');
  assert.equal(k.fitted, true);
  assert.equal(k.sub, 'bars 7–10 · moved back to fit the tape');
  // Not on a bar line: the latest bar line that still fits.
  const odd = tape({ length: 10 * BAR + 500, loop: { in: 8 * BAR, out: 10 * BAR, on: true } });
  assert.equal(key({ tape: odd, frames: 4 * BAR }).at, 6 * BAR);
  // As long as the tape: its start. Longer: the one refusal.
  assert.equal(key({ tape: t, frames: 10 * BAR }).at, 0);
  assert.equal(key({ tape: t, frames: 10 * BAR }).can, true);
  assert.equal(key({ tape: t, frames: 11 * BAR }).can, false);
  // With no tempo, the tape's end less the part.
  const none = tape({ grid: null, length: 10 * BAR, loop: { in: 8 * BAR, out: 10 * BAR, on: true }, clips: [[[0, 1]], [], [], []] });
  assert.deepEqual([key({ tape: none, frames: 4 * BAR }).can, key({ tape: none, frames: 4 * BAR }).at], [true, 6 * BAR]);
  // A part that fits where it starts is not "moved".
  assert.equal(key({ frames: 2 * BAR }).fitted, false);
});

// dropPlace's own branches: where the playhead is, and a loop whose In is not on a bar line.
test('the playhead outside the loop, or at its end, does not move where DROP lands from the loop’s In', () => {
  const t = tape({ loop: { in: 2 * BAR, out: 6 * BAR, on: true } });
  const at = (pos, frames = 2 * BAR) => key({ tape: t, frames, pos }).at;
  assert.equal(at(0.5 * BAR), 2 * BAR, 'before the loop: its first bar line, not the bar line after the playhead');
  assert.equal(at(1.5 * BAR, BAR), 2 * BAR);
  assert.equal(at(6 * BAR), 2 * BAR, 'at its Out: round to its In');
  assert.equal(at(7 * BAR), 2 * BAR, 'after its Out');
  assert.equal(at(5 * BAR, BAR), 5 * BAR, 'inside it, where the playhead is');
});

test('7.5 bars into an 8-bar loop: the next bar line is the loop’s end, so it wraps', () => {
  assert.equal(key({ frames: BAR, pos: 7.5 * BAR }).at, 0);
  assert.equal(key({ frames: BAR / 2, pos: 7.5 * BAR }).at, 0);
  assert.equal(key({ frames: BAR, pos: 6.5 * BAR }).at, 7 * BAR, 'one bar still fits before the end');
});

test('a loop whose In is not on a bar line wraps to the first bar line inside it, or to the In if no part fits from one', () => {
  const t = tape({ loop: { in: 2 * BAR + 777, out: 6 * BAR + 777, on: true } });
  assert.equal(key({ tape: t, frames: 2 * BAR, pos: 5.9 * BAR }).at, 3 * BAR, 'wraps to the first bar line after the In');
  assert.equal(key({ tape: t, frames: 2 * BAR, pos: 0 }).at, 3 * BAR);
  // A part as long as the loop fits from no bar line: it starts at the In.
  assert.equal(key({ tape: t, frames: 4 * BAR, pos: 0 }).at, 2 * BAR + 777);
  assert.equal(key({ tape: t, frames: 4 * BAR, pos: 5 * BAR }).at, 2 * BAR + 777);
  assert.equal(key({ tape: t, frames: 4 * BAR, pos: 0 }).long, false);
});

test('with no tempo and the loop on, it is the playhead if the part fits before the loop’s Out, else the loop’s In', () => {
  const none = tape({ grid: null, clips: [[[0, 1]], [], [], []] }); // loop 0 to 8 bars
  assert.equal(key({ tape: none, frames: 2 * BAR, pos: 3 * BAR }).at, 3 * BAR);
  assert.equal(key({ tape: none, frames: 2 * BAR, pos: 7 * BAR }).at, 0, 'it would run out of the loop');
  assert.equal(key({ tape: none, frames: 2 * BAR, pos: 9 * BAR }).at, 0, 'a playhead past the loop');
  assert.equal(key({ tape: none, frames: 10 * BAR, pos: 3 * BAR }).at, 0, 'longer than the loop: its In');
  assert.equal(key({ tape: none, frames: 10 * BAR, pos: 3 * BAR }).long, true);
});


test('a drag over a clip says what it will do: it replaces what is under it', () => {
  const t = tape({ clips: [[], [[0, 4]], [], []] });
  assert.deepEqual(overwritten(t, { first: 2, at: 3 * BAR, frames: 2 * BAR }), { clips: 1, frames: BAR });
  assert.deepEqual(overwritten(t, { first: 2, at: 4 * BAR, frames: 2 * BAR }), { clips: 0, frames: 0 }, 'next to it');
  assert.deepEqual(overwritten(t, { first: 1, at: 0, frames: 4 * BAR }), { clips: 0, frames: 0 }, 'another track');
  const two = tape({ clips: [[[0, 2]], [[1, 3]], [], []] });
  assert.deepEqual(overwritten(two, { first: 1, count: 2, at: BAR, frames: BAR }), { clips: 2, frames: 2 * BAR });
  assert.equal(landsWords(t.grid, { first: 2, at: 3 * BAR, frames: 2 * BAR }, t), 'bars 4–5 · replaces what’s under it');
  assert.equal(landsWords(t.grid, { first: 2, at: 4 * BAR, frames: 2 * BAR }, t), 'bars 5–6');
});

test('GRAB takes bars with a tempo and twice as many seconds without', () => {
  assert.equal(grabSeconds(4), 8);
  assert.equal(grabKey(4, true).word, 'Grab');
  assert.equal(grabKey(4, true).pick(8), '8');
  assert.equal(grabKey(4, false).word, 'Grab 8 s');
  assert.equal(grabKey(4, false).pick(1), '2 s');
});

// A grab of 4 bars at 120 BPM with a bar of handle either side.
const grab = { in: 0, out: 4 * BAR, frames: 4 * BAR, before: BAR, after: BAR, bar_frames: BAR, downbeat: 0 };

test('the window keeps inside its handles, less the overhang, and never shrinks to nothing', () => {
  const over = 480;
  assert.deepEqual(windowLimits(grab, SR), { lo: -BAR + over, hi: 5 * BAR - over, min: over });
  assert.deepEqual(clampWindow(grab, -10 * BAR, 10 * BAR, SR), { in: -BAR + over, out: 5 * BAR - over });
  assert.deepEqual(clampWindow(grab, 2 * BAR, BAR, SR), { in: 2 * BAR, out: 2 * BAR + over });
});

test('IN and OUT step on the snap, from the grab’s first bar line', () => {
  const g = gridOf(grab, 1); // bars
  assert.equal(edgeStep(g, 0, 1, SR), BAR);
  assert.equal(edgeStep(g, 0, -1, SR), -BAR);
  assert.equal(edgeStep(g, 1000, -1, SR), 0); // off the grid: to the line behind it
  assert.equal(edgeStep(gridOf(grab, 4), 0, 1, SR), BAR / 4); // beats
  // Where the grab didn't start on a bar line, the lines are the tape's.
  const off = gridOf({ ...grab, downbeat: 30000 }, 1);
  assert.equal(edgeStep(off, 0, 1, SR), 30000);
  assert.equal(snapNear(off, 50000), 30000);
  // The snap off, or no tempo: a tenth of a second.
  assert.equal(gridOf(grab, 0), null);
  assert.equal(edgeStep(null, 1000, 1, SR), 1000 + 4800);
  assert.equal(snapNear(null, 1234.4), 1234);
});

test('the window’s ruler numbers the grab’s bars and leaves the handles blank', () => {
  const lines = bufferLines(grab);
  assert.deepEqual(lines.map((l) => l.frame), [-BAR, 0, BAR, 2 * BAR, 3 * BAR, 4 * BAR, 5 * BAR]);
  assert.deepEqual(lines.map((l) => l.label), ['', '1', '2', '3', '4', '', '']);
  assert.deepEqual(bufferLines({ ...grab, bar_frames: 0 }), []);
});

test('the buffer’s line and its notes', () => {
  const board = { frames: 4 * BAR, created: 'x', tracks: [[{}]], grab };
  assert.equal(bufferMeta(board, SR), '4 bars · 8.00 s · 120 BPM');
  assert.equal(barsText(3.5 * BAR, BAR), '3.5 bars');
  assert.equal(barsText(BAR, BAR), '1 bar');
  assert.equal(bufferMeta({ ...board, grab: { ...grab, bar_frames: 0 } }, SR), '8.00 s');
  assert.equal(bufferNote(board), '');
  assert.match(bufferNote({ grab: { ...grab, wall: true, bars: 4, why: 'the tape isn’t playing' } }), /last 4 bars of time.*isn’t playing/);
  assert.match(bufferNote({ grab: { ...grab, clamped: true } }), /clamped to what the ring still had/);
  assert.match(bufferNote({ grab: { ...grab, stale: true } }), /before Hindsight restarted/);
  assert.notEqual(boardKey(board), boardKey({ ...board, grab: { ...grab, in: 5 } }));
  assert.equal(boardKey(null), '');
});

test('a grab of a take’s span shows the take as its one source, fixed', () => {
  // The Listening Room's "to the studio": the buffer is the take's own
  // sound, so there are no inputs to pick, and it says so.
  const take = { ...grab, take: 'jam_2026-10-15_090000.wav', sources: ['Tuesday jam'] };
  assert.deepEqual(chipsFor(take, ['main', 'ch1', 'ch2', 'aux'], ['aux']),
    [{ name: 'take:jam_2026-10-15_090000.wav', label: 'Tuesday jam', on: true, fixed: true }]);
  assert.match(bufferNote({ grab: take }), /from a take.*sources can’t change/);
  // From the feed: the tape's sources, the buffer's pressed.
  const feed = chipsFor({ ...grab, sources: ['ch1'] }, ['main', 'ch1'], ['aux']);
  assert.deepEqual(feed.map((c) => [c.name, c.on, c.fixed]), [['main', false, false], ['ch1', true, false]]);
  // Nothing grabbed yet: the ones picked for the next GRAB.
  assert.deepEqual(chipsFor(null, ['main', 'aux'], ['aux']).map((c) => c.on), [false, true]);
  // A stale grab's can't change either.
  assert.equal(chipsFor({ ...grab, sources: ['aux'], stale: true }, ['aux'], []).every((c) => c.fixed), true);
});
