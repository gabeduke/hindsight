// The name, ✎ and Repeat the bar shows for a take with the rooms on
// (take-keys.js), for each thing the bar can hold -- a take, the tape, nothing
// -- on a stand-in document; bar-room.test.js runs them in the real bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { takeKeys, clock, noteHere } from './take-keys.js';
import { icon, iconOf } from '../ui/icons.js';

function bar() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, `<section id="np" class="np"><div class="np-own"><button id="np-eject"></button><a id="np-open"></a></div><button id="np-loop" data-tip="np-loop"><span class="loop-face">${icon('repeat', { size: 14 })}<span class="loop-word">Loop</span></span></button></section>`).children);
  const root = doc.getElementById('np');
  const notes = [];
  const keys = takeKeys({ doc, root, onNote: () => notes.push('✎') });
  const $ = (id) => doc.getElementById(id);
  return { doc, root, keys, notes, $ };
}
const aTake = (pos = 0) => ({ kind: 'take', title: 'Blue bridge', href: '/wave.html?file=a.wav', pos: () => pos, sampleRate: 48000 });
const aTape = { kind: 'tape', title: 'Tuesday groove', href: '/tape.html', pos: () => 0, sampleRate: 48000 };

test('the name and ✎ stand after ⏏ in the bar’s own keys, hidden until a take is in the bar', () => {
  const b = bar();
  const own = b.$('np-eject').parent;
  assert.deepEqual(own.children.map((e) => e.id), ['np-eject', 'np-open', 'np-name', 'np-note']);
  assert.equal(b.$('np-name').hidden, true);
  assert.equal(b.$('np-note').hidden, true);
});

test('a take shows its name (the link) and ✎; the tape shows neither, and ⟲ is Loop again', () => {
  const b = bar();
  b.keys.paint(aTake(83 * 48000));
  assert.equal(b.$('np-name').hidden, false);
  assert.equal(b.$('np-name').getAttribute('href'), '/wave.html?file=a.wav');
  assert.equal(b.$('np-note').getAttribute('aria-label'), 'Note at 1:23');
  assert.equal(iconOf(b.$('np-note')), 'note', '✎ is drawn, not typed');
  assert.equal(b.$('np-loop').textContent, 'Repeat');
  assert.equal(iconOf(b.$('np-loop')), 'repeat', 'the word changes, ⟲ beside it stays');
  assert.equal(b.$('np-loop').dataset.tip, 'np-repeat');
  assert.ok(b.root.classList.contains('np-take'));
  b.keys.paint(aTape);
  assert.equal(b.$('np-name').hidden, true, 'the tape’s name is not a link to a take');
  assert.equal(b.$('np-note').hidden, true, '✎ is for a take');
  assert.equal(b.$('np-loop').textContent, 'Loop', 'the tape’s loop is another thing');
  assert.equal(iconOf(b.$('np-loop')), 'repeat');
  assert.equal(b.$('np-loop').dataset.tip, 'np-loop');
  assert.equal(b.root.classList.contains('np-take'), false);
  b.keys.paint(null);
  assert.equal(b.$('np-note').hidden, true);
});

test('✎ asks the page for its note when pressed', () => {
  const b = bar();
  b.keys.paint(aTake());
  b.$('np-note').dispatchEvent({ type: 'click' });
  assert.deepEqual(b.notes, ['✎']);
});

test('clock says minutes and whole seconds, never ahead of the playhead', () => {
  assert.equal(clock(0, 48000), '0:00');
  assert.equal(clock(59.9 * 48000, 48000), '0:59');
  assert.equal(clock(60 * 48000, 48000), '1:00');
  assert.equal(clock(600 * 48000 + 5, 48000), '10:00');
  assert.equal(clock(-5, 48000), '0:00');
});

test('✎ takes the frame first, then keeps it, then goes: in that order, and not at all with no take', () => {
  const order = [];
  const frame = { take: 'a b.wav', frame: 100, sr: 48000, playing: true, at: 1 };
  const got = noteHere({ frameNow: () => { order.push('frame'); return frame; }, stash: (f) => order.push(`stash ${f.frame}`), go: (u) => order.push(`go ${u}`) });
  assert.deepEqual(order, ['frame', 'stash 100', 'go /wave.html?file=a%20b.wav']);
  assert.equal(got, frame);
  const none = [];
  assert.equal(noteHere({ frameNow: () => null, stash: () => none.push('stash'), go: () => none.push('go') }), null);
  assert.deepEqual(none, []);
});
