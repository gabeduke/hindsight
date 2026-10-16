// web/static/lib/room/deck.test.js
// The room's deck is a picture of the bar (docs/superpowers/specs/2026-10-15-
// flow-design.md, "What happens to today's surfaces"): what the bar holds and
// how far it has got, with no keys of its own, and a tap on it is Open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckOf, deckWords, readBar, fmtLen } from './deck.js';
import { fakeDoc } from '../play/fake-dom.js';

const take = { name: 'jam_a.wav', label: 'Funk', created: '2026-10-15T12:43:00', duration_seconds: 119 };
const tape = { id: 't1', name: 'Tuesday groove' };
const list = { loaded: 't1', tapes: [tape] };

test('the deck holds what the bar holds: its take, else the tape the Pi has loaded, else nothing', () => {
  assert.deepEqual(deckOf({ takeName: 'jam_a.wav', takes: [take], tapes: list }), { kind: 'take', take });
  assert.deepEqual(deckOf({ takeName: null, takes: [take], tapes: list }), { kind: 'tape', tape });
  assert.equal(deckOf({ takeName: null, takes: [take], tapes: { loaded: '', tapes: [] } }), null);
  assert.equal(deckOf({ takeName: null, takes: [take], tapes: null }), null, 'the tape off');
});

test('a take the list no longer holds (deleted) is not on the deck: the bar’s tape is', () => {
  assert.deepEqual(deckOf({ takeName: 'gone.wav', takes: [take], tapes: list }), { kind: 'tape', tape });
  assert.equal(deckOf({ takeName: 'gone.wav', takes: [take], tapes: null }), null);
});

test('a loaded tape the list does not name still stands on the deck, as "the tape"', () => {
  assert.deepEqual(deckOf({ takeName: null, takes: [], tapes: { loaded: 'x', tapes: [] } }), { kind: 'tape', tape: { id: 'x', name: 'the tape' } });
});

test('the words: a take says its name, its length and whether it plays; Open is its take page', () => {
  const w = deckWords(deckOf({ takeName: take.name, takes: [take], tapes: null }), { playing: true, pos: '0:42' });
  assert.equal(w.place, 'In the bar: Funk');
  assert.equal(w.meta, 'take · 1:59 · playing');
  assert.equal(w.lcd, '0:42');
  assert.equal(w.href, '/wave.html?file=jam_a.wav');
  assert.equal(w.forTape, false);
  assert.match(w.label, /In the bar: Funk, a take, playing\. Open it/);
  const paused = deckWords(deckOf({ takeName: take.name, takes: [take], tapes: null }), { playing: false, pos: '0:42' });
  assert.equal(paused.meta, 'take · 1:59');
});

test('the words: a tape in the bar opens in the Studio, and says it is for the tape', () => {
  const w = deckWords({ kind: 'tape', tape }, { playing: false, pos: '1.1' });
  assert.equal(w.place, 'In the bar: Tuesday groove');
  assert.equal(w.meta, 'tape · in the Studio');
  assert.equal(w.href, '/tape.html');
  assert.equal(w.forTape, true);
  assert.match(w.label, /Open it in the Studio/);
});

test('the words: an empty bar, and no key anywhere in them', () => {
  const w = deckWords(null, { playing: false, pos: '' });
  assert.equal(w.place, 'The bar · empty');
  assert.equal(w.lcd, '--:--');
  assert.equal(w.href, null);
  assert.match(w.label, /tap a take on the shelves/i);
  for (const d of [null, { kind: 'take', take }, { kind: 'tape', tape }]) {
    const all = JSON.stringify(deckWords(d, { playing: true, pos: '1' }));
    assert.doesNotMatch(all, /PUT IT ON|SIT DOWN|Sit down|Play from|on the deck/i, 'a retired word');
  }
});

test('an LCD with nothing read from the bar shows 00:00 while something is in it', () => {
  assert.equal(deckWords({ kind: 'take', take }, { playing: false, pos: '' }).lcd, '00:00');
});

test('lengths', () => {
  assert.equal(fmtLen(119), '1:59');
  assert.equal(fmtLen(0), '0:00');
  assert.equal(fmtLen(59.6), '0:59');
});

// readBar reads the bar's own face -- its ▶, its strip, its clock -- so the
// deck is of the bar as it is now, whichever page or hand moved it.
test('readBar: playing from ▶, how far from the strip, the clock from the LCD', () => {
  const doc = fakeDoc();
  const play = doc.createElement('button'); play.id = 'np-play';
  const scrub = doc.createElement('canvas'); scrub.id = 'np-scrub';
  const pos = doc.createElement('span'); pos.id = 'position';
  doc.body.append(play, scrub, pos);
  assert.deepEqual(readBar(doc), { playing: false, frac: 0, pos: '' });
  play.classList.add('playing');
  scrub.setAttribute('aria-valuemax', '200');
  scrub.setAttribute('aria-valuenow', '50');
  pos.textContent = '0:12';
  assert.deepEqual(readBar(doc), { playing: true, frac: 0.25, pos: '0:12' });
  scrub.setAttribute('aria-valuenow', '999');
  assert.equal(readBar(doc).frac, 1, 'clamped');
});
