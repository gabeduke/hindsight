import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armedOf, toggled, pairsFor, recordBody, catchSays, onWords, spanWords, armClick, armedNote, tapArm, holdArm } from './arm.js';

test('what is armed: rec_tracks, or rec_track from a Pi before multi-arm', () => {
  assert.deepEqual(armedOf({ rec_tracks: [3, 2], rec_track: 2 }), [2, 3]);
  assert.deepEqual(armedOf({ rec_tracks: [], rec_track: -1 }), []);
  assert.deepEqual(armedOf({ rec_track: 3 }), [3]);
  assert.deepEqual(armedOf({ rec_track: -1 }), []);
  assert.deepEqual(armedOf({}), [1], 'never chosen: track 1, as before');
});

test('● adds a track to what is armed, or takes it off', () => {
  assert.deepEqual(toggled([2], 3), [2, 3]);
  assert.deepEqual(toggled([2, 3], 2), [3]);
  assert.deepEqual(toggled([3], 3), []);
});

test('a recording sends every armed track with its own input, and the first as before', () => {
  const inputOf = (n) => ({ 2: 'ch1', 3: 'ch2' })[n];
  assert.deepEqual(pairsFor([2, 3], inputOf), [{ track: 2, source: 'ch1' }, { track: 3, source: 'ch2' }]);
  assert.deepEqual(recordBody([2, 3], inputOf, { replace: false, bars: 4 }), {
    track: 2, source: 'ch1', pairs: [{ track: 2, source: 'ch1' }, { track: 3, source: 'ch2' }], replace: false, bars: 4,
  });
});

test('CATCH says what it did', () => {
  assert.equal(catchSays({ bars: 4 }, [2, 3]), 'last 4 bars → 2, 3');
  assert.equal(catchSays({ bars: 1 }, [1]), 'last 1 bar → 1');
  assert.equal(catchSays({ pass: 1 }, [2]), 'the last pass → 2');
  assert.equal(spanWords({ out: 96000 }), 'that pass');
  assert.equal(onWords([2]), 'track 2');
  assert.equal(onWords([2, 3]), 'tracks 2, 3');
});

// Review: with the rooms off, a lit ● must do what it says. Another device
// may have armed several; ● on one of them takes just it off.
test('● with the rooms off: an armed track comes off, an unarmed one is armed alone', () => {
  assert.deepEqual(armClick([2, 3], 3, false), { next: [2], label: 'Track 3 is armed: disarm it' });
  assert.deepEqual(armClick([3], 3, false), { next: [], label: 'Track 3 is the record track: disarm it' });
  assert.deepEqual(armClick([2, 3], 1, false), { next: [1], label: 'Record onto track 1' });
  assert.deepEqual(armClick([], 1, false), { next: [1], label: 'Record onto track 1' });
});

// F7 (flow spec, decision 11): with the rooms on a tap on ● moves the arm to
// that track, as 1–4 do; holding it (or ⇧-click) arms it as well. Multi-arm
// stays; it is just not what a tap does. Before, a tap toggled.
test('a tap on ● leaves exactly one track armed: this one', () => {
  for (const armed of [[], [1], [2], [1, 2], [1, 2, 3], [2, 4]]) {
    for (const n of [1, 2, 3, 4]) {
      assert.deepEqual(tapArm(armed, n), [n], `${JSON.stringify(armed)} + tap ${n}`);
      assert.deepEqual(armClick(armed, n, true).next, [n]);
    }
  }
});

test('a tap on the only armed track leaves it armed: a tap moves the arm, it does not take it off', () => {
  assert.deepEqual(tapArm([3], 3), [3]);
});

test('a hold on ● arms the track as well, or takes an armed one off', () => {
  assert.deepEqual(holdArm([2], 3), [2, 3]);
  assert.deepEqual(holdArm([2, 3], 3), [2]);
  assert.deepEqual(holdArm([3], 3), [], 'the way to none armed');
  assert.deepEqual(holdArm([], 1), [1]);
  assert.deepEqual(holdArm([4, 1], 2), [1, 2, 4], 'in track order, as the Pi keeps them');
});

test('the label names both gestures, and says what Catch and Rec then use', () => {
  assert.equal(armClick([], 1, true).label, 'Arm track 1: Catch and Rec then use track 1');
  assert.equal(armClick([2], 3, true).label,
    'Arm only track 3: Catch and Rec then use track 3. Hold (Shift-click, Shift+Enter) to arm it as well (tracks 2, 3)');
  assert.equal(armClick([2], 2, true).label, 'Track 2 is armed. Hold (Shift-click, Shift+Enter) to take it off, leaving none armed');
  assert.equal(armClick([2, 3], 3, true).label,
    'Track 3 is armed: tap to arm only track 3, hold (Shift-click, Shift+Enter) to take it off (leaving track 2)');
  assert.equal(armClick([2, 3], 1, true).label,
    'Arm only track 1: Catch and Rec then use track 1. Hold (Shift-click, Shift+Enter) to arm it as well (tracks 1, 2, 3)');
});

test('the label and the result agree: what a tap or a hold makes is what the label says Catch will use', () => {
  for (const armed of [[], [1], [2], [1, 2], [1, 2, 3]]) {
    for (const n of [1, 2, 3, 4]) {
      const { next, label } = armClick(armed, n, true);
      if (armed.length === 1 && armed[0] === n) { assert.match(label, /take it off, leaving none armed/); continue; }
      assert.ok(label.includes(onWords(next)), `${JSON.stringify(armed)} + ${n}: ${label} names ${onWords(next)}`);
      const held = holdArm(armed, n);
      if (held.length && !armed.includes(n)) assert.ok(label.includes(onWords(held)), `${label} names the hold's ${onWords(held)}`);
    }
  }
});

test('arming a track as well says what Catch, Rec and DROP then do, and how to go back to one', () => {
  assert.deepEqual(armedNote([1], 2, [1, 2]), {
    text: 'Tracks 1, 2 are armed: Catch and Rec record onto all of them, DROP onto the first. Tap a ● to arm just that track.',
  });
  assert.equal(armedNote([1, 2], 3, [1, 2, 3]).text,
    'Tracks 1, 2, 3 are armed: Catch and Rec record onto all of them, DROP onto the first. Tap a ● to arm just that track.');
});

test('nothing to say when the arm just starts, or a track comes off', () => {
  assert.equal(armedNote([], 1, [1]), null, 'the first arm');
  assert.equal(armedNote([1, 2], 2, [1]), null, 'taking one off');
  assert.equal(armedNote([1], 1, []), null, 'taking the last off');
});
