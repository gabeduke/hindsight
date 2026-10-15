import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armedOf, toggled, pairsFor, recordBody, catchSays, onWords, spanWords, armClick } from './arm.js';

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

test('● with the rooms on adds the track to what is armed, or takes it off', () => {
  assert.deepEqual(armClick([2], 3, true), { next: [2, 3], label: 'Arm track 3 as well' });
  assert.deepEqual(armClick([2, 3], 3, true), { next: [2], label: 'Track 3 is armed: take it off what’s armed' });
  assert.deepEqual(armClick([], 1, true), { next: [1], label: 'Arm track 1' });
});
