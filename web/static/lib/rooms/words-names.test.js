// What a person typed is theirs, and the words layer must not touch it; and
// the Settings labels the Pi sends are said in the rooms' words. words.js's
// own table is read by words.test.js; this reads what it must leave alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rename, renameToast, quoted } from './words.js';

const NAMES = ['Spring clips', 'Big Ring', 'Ring-a-ling', 'my clip', 'Mix down take', 'flag day', 'Clipboard Blues', 'sub-clip', 'ring-tone'];

test('a name comes out of a toast as it was typed: quoted by its caller, or after the Pi’s “Could not …:”, or as a bare error', () => {
  for (const n of NAMES) {
    assert.equal(renameToast(`Deleted “${n}”`, 'ok'), `Deleted “${n}”`);
    assert.equal(renameToast(`Made “${n}”, 4 bars: tap it`, 'ok'), `Made “${n}”, 4 bars: tap it`);
    assert.equal(renameToast(`Could not rename: ${n} is taken`, 'bad'), `Could not rename: ${n} is taken`);
    assert.equal(renameToast(`${n} is taken`, 'bad'), `${n} is taken`);
  }
});

test('a hyphenated word is one word: Ring-a-ling is not Feed-a-ling', () => {
  assert.equal(rename('Ring-a-ling'), 'Ring-a-ling');
  assert.equal(rename('sub-clip and ring-tone'), 'sub-clip and ring-tone');
  assert.equal(rename('the ring'), 'the feed', 'a bare word still is renamed');
  assert.equal(rename('2 clips, 1 flag'), '2 parts, 1 note');
});

test('quoted names survive whatever the message says', () => {
  for (const n of NAMES) {
    assert.equal(renameToast(`Kept ${quotedFor(n)} in the ring`, 'ok'), `Kept ${quotedFor(n)} in the feed`);
  }
});
const quotedFor = (n) => `“${n}”`;

test('what the Pi said after “Could not …:” is left as it came, and so is a bare error', () => {
  assert.equal(renameToast('Could not read the clip’s audio: no such clip Spring clips', 'bad'), 'Could not read the part’s audio: no such clip Spring clips');
  assert.equal(renameToast('Couldn’t keep it: the Ring-a-ling take clip is gone', 'bad'), 'Couldn’t keep it: the Ring-a-ling take clip is gone');
  assert.equal(renameToast('take Spring clips was not found', 'bad'), 'take Spring clips was not found');
});

test('quoted() quotes only with the rooms on; node has no flag, so it is the name as it was', () => {
  assert.equal(quoted('Big Ring'), 'Big Ring');
});

// ---- the Settings labels the Pi sends, said in the rooms' words ----------
test('each Settings label the rooms rename is pinned: take a rule out and this fails', () => {
  assert.equal(rename('Buffer length'), 'Feed length');
  assert.equal(rename('Inputs to keep'), 'Inputs in TAKES');
  assert.equal(rename('Keep every input'), 'Every input in TAKES');
  assert.equal(rename('Keep free'), 'Leave free');
  assert.equal(rename('Mixdown tail'), 'Bounce tail');
});
