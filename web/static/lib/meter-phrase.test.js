// web/static/lib/meter-phrase.test.js
// What the Capture key says it will catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierPhrase, captureTiers, frameLevels, FLOOR_DB } from './meter.js';

test('tierPhrase says how much the Capture key catches', () => {
  assert.equal(tierPhrase(30, 900), 'the last 30 seconds');
  assert.equal(tierPhrase(60, 900), 'the last minute');
  assert.equal(tierPhrase(120, 900), 'the last 2 minutes');
  assert.equal(tierPhrase(90, 900), 'the last 1.5 minutes');
  assert.equal(tierPhrase(0, 900), 'the last 15 minutes');
  assert.equal(tierPhrase(0, 120), 'the last 2 minutes');
});

// Capture's lengths, which the Studio's Keep offers too: one list, so the
// two keys can't drift apart.

test('captureTiers offers what the ring holds, then all of it', () => {
  assert.deepEqual(captureTiers(900), [
    { s: 30, label: '30s' }, { s: 120, label: '2m' }, { s: 420, label: '7m' }, { s: 0, label: 'Full 15m' },
  ]);
  assert.deepEqual(captureTiers(120).map((t) => t.label), ['30s', '2m', 'Full 2m']);
  assert.deepEqual(captureTiers(30).map((t) => t.label), ['30s', 'Full 30s']);
  assert.deepEqual(captureTiers(20).map((t) => t.s), [0]);
});

test('frameLevels takes the saved channels from a live frame, in their order', () => {
  const f = {
    bins: [{ rms: [-50, -40, -30] }, { rms: [-20, -10, -5] }],
    peak: [-3, -2, -1],
    clip: [false, true, false],
  };
  assert.deepEqual(frameLevels(f, [2, 1]), { rms: [-5, -10], peak: [-1, -2], clip: [false, true] });
});

test('frameLevels is at the floor where a frame says nothing', () => {
  assert.deepEqual(frameLevels({}, [0, 1]), { rms: [FLOOR_DB, FLOOR_DB], peak: [FLOOR_DB, FLOOR_DB], clip: [false, false] });
  assert.deepEqual(frameLevels({ bins: [], peak: [-6] }, [0, 1]).peak, [-6, FLOOR_DB]);
});
