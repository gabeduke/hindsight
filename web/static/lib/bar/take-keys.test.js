// What the bar's ✎, the feed's GRAB and ⟲ say and do for each thing the bar
// can hold -- a take, the tape, the feed, nothing -- on a stand-in document
// (take-keys.js); bar-room.test.js runs them in the real bar, and
// shape.test.js reads which of them shows for which source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { takeKeys, clock, noteHere } from './take-keys.js';
import { icon, iconOf } from '../ui/icons.js';

function bar() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, `<section id="np" class="np">
    <div data-slot="verb"><button id="np-feed-grab" data-for="feed"></button></div>
    <div data-slot="modes"><button id="np-loop" data-tip="np-loop"><span class="loop-face">${icon('repeat', { size: 14 })}<span class="loop-word">Loop</span></span></button></div>
    <div data-slot="end"><button id="np-eject" data-for="take feed"></button><a id="np-open" data-for="take away"></a><button id="np-note" data-for="take">${icon('note')}</button></div>
  </section>`).children);
  const root = doc.getElementById('np');
  const said = [];
  const keys = takeKeys({ doc, onNote: () => said.push('✎'), onGrabFeed: () => said.push('GRAB') });
  const $ = (id) => doc.getElementById(id);
  return { doc, root, keys, said, $ };
}
const aTake = (pos = 0) => ({ kind: 'take', title: 'Blue bridge', href: '/wave.html?file=a.wav', pos: () => pos, sampleRate: 48000 });
const aTape = { kind: 'tape', title: 'Tuesday groove', href: '/tape.html', pos: () => 0, sampleRate: 48000 };

test('it makes no key: ✎ and GRAB are the page’s, each in its slot, where they were', () => {
  const b = bar();
  const end = b.doc.querySelector('[data-slot="end"]');
  assert.deepEqual(end.children.map((e) => e.id), ['np-eject', 'np-open', 'np-note']);
  assert.equal(b.$('np-feed-grab').parent.getAttribute('data-slot'), 'verb');
});

test('with a take, ✎ names the frame it will take and ⟲ is Repeat; with the tape, ⟲ is Loop again', () => {
  const b = bar();
  b.keys.paint(aTake(83 * 48000));
  assert.equal(b.$('np-note').getAttribute('aria-label'), 'A note at 1:23');
  assert.equal(iconOf(b.$('np-note')), 'note', '✎ is drawn, not typed');
  assert.equal(b.$('np-loop').textContent, 'Repeat');
  assert.equal(iconOf(b.$('np-loop')), 'repeat', 'the word changes, ⟲ beside it stays');
  assert.equal(b.$('np-loop').dataset.tip, 'np-repeat');
  b.keys.paint(aTape);
  assert.equal(b.$('np-loop').textContent, 'Loop', 'the tape’s loop is another thing');
  assert.equal(iconOf(b.$('np-loop')), 'repeat');
  assert.equal(b.$('np-loop').dataset.tip, 'np-loop');
  b.keys.paint(null);
  assert.equal(b.$('np-loop').textContent, 'Loop');
});

test('✎ asks the page for its note, and the feed’s GRAB for its grab, when pressed', () => {
  const b = bar();
  b.keys.paint(aTake());
  b.$('np-note').dispatchEvent({ type: 'click' });
  b.$('np-feed-grab').dispatchEvent({ type: 'click' });
  assert.deepEqual(b.said, ['✎', 'GRAB']);
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
