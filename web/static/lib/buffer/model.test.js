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

test('the DROP key names the track and the bars, or why it can’t', () => {
  const t = tape({ clips: [[], [[0, 8]], [], []] });
  const k = dropKey({ tape: t, armed: 1, frames: 4 * BAR, pos: 8 * BAR - 5 });
  assert.equal(k.word, 'Drop on track 1');
  assert.equal(k.sub, 'bars 1–4'); // round the loop from its In
  assert.equal(k.at, 0);
  assert.equal(k.can, true);
  assert.equal(dropKey({ tape: t, armed: 3, count: 2, frames: BAR, pos: 0 }).word, 'Drop on tracks 3–4');
  assert.equal(spanWords(t.grid, 8 * BAR, BAR, SR), 'bar 9');
  assert.equal(spanWords(null, 12 * SR, BAR, SR), 'at 0:12');
});

test('with several tracks armed, DROP goes on the first of them, and says so', () => {
  // Multi-arm (lib/rig/arm.js) arms several tracks; the buffer still drops
  // on one, the first, and the key says which it chose.
  const t = tape({ clips: [[], [], [], []] });
  const k = dropKey({ tape: t, armed: 2, armedAll: [2, 4], frames: BAR, pos: 0 });
  assert.equal(k.word, 'Drop on track 2');
  assert.equal(k.sub, 'the first armed track · bar 1');
  assert.equal(k.can, true);
  // One armed, as before: no word about it.
  assert.equal(dropKey({ tape: t, armed: 2, armedAll: [2], frames: BAR, pos: 0 }).sub, 'bar 1');
});

// "NO ROOM ON TRACK 2 · drag it to a lane" was the whole answer when the first
// armed track was full -- and a phone in PLAY mode, or a laptop with the
// strip unfolded, has no lane on screen to drag to. DROP now goes where there
// is room (another armed track, then any other), says it did, and when there
// is none anywhere it says why in terms of what is on screen.
test('the first armed track is full: DROP takes the next armed track with room, and says why', () => {
  const t = tape({ clips: [[], [[0, 8]], [], []] });
  const k = dropKey({ tape: t, armed: 2, armedAll: [2, 4], frames: BAR, pos: 0 });
  assert.equal(k.can, true);
  assert.equal(k.track, 4);
  assert.equal(k.word, 'Drop on track 4');
  assert.match(k.sub, /^track 2 is full · bar 1$/);
});

test('every armed track is full: the first track with room, named, and the full one too', () => {
  const t = tape({ clips: [[], [[0, 8]], [], []] });
  const k = dropKey({ tape: t, armed: 2, armedAll: [2], frames: 4 * BAR, pos: 0 });
  assert.deepEqual([k.can, k.track, k.word, k.sub, k.at], [true, 1, 'Drop on track 1', 'track 2 is full · bars 1–4', 0]);
  const two = tape({ clips: [[[0, 8]], [[0, 8]], [], []] });
  assert.match(dropKey({ tape: two, armed: 1, armedAll: [1, 2], frames: BAR, pos: 0 }).sub, /^tracks 1, 2 are full · /);
});

test('no track armed: DROP takes the first track with room, and says none is armed', () => {
  const t = tape({ clips: [[[0, 8]], [], [], []] });
  const k = dropKey({ tape: t, armed: 0, frames: BAR, pos: 0 });
  assert.deepEqual([k.can, k.track, k.word], [true, 2, 'Drop on track 2']);
  assert.match(k.sub, /no track is armed/);
});

test('the first armed track with room is still the one it drops on', () => {
  const t = tape();
  assert.equal(dropKey({ tape: t, armed: 3, armedAll: [3, 1], frames: BAR, pos: 0 }).track, 3);
});

test('a buffer of two lanes starts where two fit, when the armed track is the last', () => {
  const t = tape();
  const k = dropKey({ tape: t, armed: 4, count: 2, frames: BAR, pos: 0 });
  assert.deepEqual([k.can, k.track, k.word], [true, 1, 'Drop on tracks 1–2']);
  assert.match(k.sub, /2 lanes don’t fit from track 4/);
});

test('every track is full: it says so, and points only at what the caller says is on screen', () => {
  const t = tape({ clips: [[[0, 8]], [[0, 8]], [[0, 8]], [[0, 8]]] });
  const blind = dropKey({ tape: t, armed: 2, frames: BAR, pos: 0 });
  assert.equal(blind.can, false);
  assert.equal(blind.word, 'No room on any track');
  assert.ok(!/lane|drag/i.test(blind.sub), `points at a lane it can't see: ${blind.sub}`);
  assert.match(blind.sub, /loop/);
  const sees = dropKey({ tape: t, armed: 2, frames: BAR, pos: 0, way: 'drag it onto a lane to replace what’s under it' });
  assert.match(sees.sub, /drag it onto a lane to replace what’s under it$/);
  // A function is asked only when it is needed: it looks at the page.
  let asked = 0;
  dropKey({ tape: tape(), armed: 2, frames: BAR, pos: 0, way: () => { asked++; return 'x'; } });
  assert.equal(asked, 0, 'asked although a track had room');
  assert.match(dropKey({ tape: t, armed: 2, frames: BAR, pos: 0, way: () => 'switch to EDIT' }).sub, /switch to EDIT$/);
});

test('longer than the loop: it says how long, and to trim it with the marks that are on the buffer', () => {
  const t = tape();
  const k = dropKey({ tape: t, armed: 1, frames: 9 * BAR, pos: 0 });
  assert.equal(k.can, false);
  assert.match(k.word, /Longer than the loop/);
  assert.match(k.sub, /IN and OUT/);
  assert.ok(!/lane|drag/i.test(k.sub), k.sub);
  // With the loop off the tape's own length is the limit, and it fits.
  assert.equal(dropKey({ tape: tape({ loop: { in: 0, out: 8 * BAR, on: false } }), armed: 1, frames: 9 * BAR, pos: 0 }).can, true);
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
