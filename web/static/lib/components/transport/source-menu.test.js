// What the display's source key's menu offers (source-menu.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentTakes, sourceRows, RECENT } from './source-menu.js';

test('the source menu: the tape and the feed, the one playing checked, then the newest takes and the shelf', () => {
  const takes = [
    { name: 'jam_2026-10-24_100000.wav', duration_seconds: 65 },
    { name: 'jam_2026-10-24_120000.wav', duration_seconds: 8, label: 'Blue bridge' },
    { name: 'jam_2026-10-23_090000.wav', duration_seconds: 30 },
    { name: 'jam_2026-10-24_110000.wav', duration_seconds: 12 },
  ];
  const recent = recentTakes(takes);
  assert.equal(recent.length, RECENT);
  assert.deepEqual(recent.map((t) => t.name), ['jam_2026-10-24_120000.wav', 'jam_2026-10-24_110000.wav', 'jam_2026-10-24_100000.wav']);
  const r = sourceRows({ kind: 'take', takeName: 'jam_2026-10-24_110000.wav', tape: 'Song sketch', recent });
  assert.deepEqual(r.rows.map((x) => [x.id, x.checked, x.disabled]), [['tape', false, false], ['feed', false, false]]);
  assert.equal(r.rows[0].sub, 'Song sketch');
  assert.deepEqual(r.takes.map((x) => [x.word, x.sub, x.checked]), [['Blue bridge', '0:08', false], ['11:00:00', '0:12', true], ['10:00:00', '1:05', false]]);
  assert.deepEqual(r.shelf, { id: 'shelf', word: 'Go to the shelf', href: '/takes.html' });
  // No tape on the Pi: the tape can't be chosen, and says why.
  const bare = sourceRows({ kind: 'feed', tape: null, recent: [] });
  assert.deepEqual(bare.rows.map((x) => [x.id, x.checked, x.disabled]), [['tape', false, true], ['feed', true, false]]);
  assert.equal(bare.rows[0].sub, 'no tape is loaded');
  assert.deepEqual(bare.takes, []);
});
