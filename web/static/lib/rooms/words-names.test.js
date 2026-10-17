// What a person typed is theirs, and the words layer must not touch it: a name
// goes into a message through named(), whose markers (private-use characters
// nobody can type) say "leave this". The sinks take them off again.
// words.js's own table is read by words.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rename, renameToast, named, unmark, say, sayToast } from './words.js';

const NAMES = ['Spring clips', 'Big Ring', "Gabe's clip", 'Re: the ring clip', 'say “clip” and ”flag“', "'my clip'", '"flag"',
  'Ring-a-ling', 'Mix down take', 'Clipboard Blues', '🎸 ring clip', 'a: b: c clip', 'with  and  typed'];
const typedOf = (n) => n.replace(/[]/g, '');

test('a name comes out of a toast as it was typed, whatever it holds, with the words around it said', () => {
  for (const n of NAMES) {
    const t = typedOf(n);
    assert.equal(renameToast(`Deleted ${named(n)}: it can come back from the ring`, 'ok'), `Deleted ${t}: it can come back from the feed`);
    assert.equal(renameToast(`Could not rename ${named(n)}: it is a clip`, 'bad'), `Could not rename ${t}: it is a clip`, 'the Pi’s text after the colon is left');
    assert.equal(renameToast(`Made ${named(n)}, 4 bars`, 'ok'), `Made ${t}, 4 bars`);
    assert.equal(renameToast(`Kept ${named(n)} from the flag`, 'ok'), `Kept ${t} from the note`);
  }
});

test('a colon inside a name does not end what is ours to reword', () => {
  assert.equal(renameToast(`Could not take ${named('Re: the clip')}: the ring is empty`, 'bad'), 'Could not take Re: the clip: the ring is empty');
  assert.equal(renameToast(`Could not take ${named('a: b')} from the flag: the clip is gone`, 'bad'), 'Could not take a: b from the note: the clip is gone');
});

test('say() and the toast sink take the markers off, leaving the name as it was typed', () => {
  for (const n of NAMES) {
    const t = typedOf(n);
    assert.equal(say(`Deleted ${named(n)}`), `Deleted ${t}`);
    assert.equal(sayToast(`Deleted ${named(n)}`, 'ok'), `Deleted ${t}`);
  }
  assert.equal(unmark(named('x')), 'x');
});

test('a hyphenated word is one word: Ring-a-ling is not Feed-a-ling', () => {
  assert.equal(rename('Ring-a-ling'), 'Ring-a-ling');
  assert.equal(rename('sub-clip and ring-tone'), 'sub-clip and ring-tone');
  assert.equal(rename('the ring'), 'the feed');
  assert.equal(rename('2 clips, 1 flag'), '2 parts, 1 note');
});

test('a failure with no colon outside a name is the Pi’s whole, and is left', () => {
  assert.equal(renameToast('take Spring clips was not found', 'bad'), 'take Spring clips was not found');
});

// ---- the Settings labels the Pi sends, said in the rooms' words ----------
test('each Settings label the rooms rename is pinned: take a rule out and this fails', () => {
  assert.equal(rename('Buffer length'), 'Feed length');
  assert.equal(rename('Inputs to keep'), 'Inputs in TAKES');
  assert.equal(rename('Keep every input'), 'Every input in TAKES');
  assert.equal(rename('Keep free'), 'Leave free');
  assert.equal(rename('Mixdown tail'), 'Bounce tail');
});
