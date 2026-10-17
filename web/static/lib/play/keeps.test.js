// web/static/lib/play/keeps.test.js
// KEEP names what it keeps, on the instrument's pad (F1 of the flow spec):
// the Studio and the buffer say what K will keep with `hindsight:keeps`, and
// the strip's KEEP pad shows it. Built for real, on a stand-in document.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startStrip } from './strip.js';
import { mountStrip } from './screen.js';
import { Surface } from './surface.js';
import { fakeDoc } from './fake-dom.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// Play mode on, and a Pi that never answers: the strip's link is a socket
// that stays closed.
class Silent { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} }
const made = []; // strips a test built: let go of in the end, so a red test does not leave timers running
async function withPlayOn(fn) {
  const keep = ['localStorage', 'location', 'WebSocket', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map((k) => [k, Object.prototype.hasOwnProperty.call(globalThis, k), globalThis[k]]);
  Object.assign(globalThis, { localStorage: memory({ 'hindsight.play': '1' }), location: { protocol: 'http:', host: 'pi.test' }, WebSocket: Silent, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  try { await fn(); } finally {
    for (const st of made.splice(0)) { try { st.destroy(); } catch { /* already let go */ } }
    for (const [k, had, v] of keep) { if (had) globalThis[k] = v; else delete globalThis[k]; }
  }
}

// The page the strip is built on: a dock and the bar in it.
function page() {
  const doc = fakeDoc();
  const dock = doc.createElement('div'); dock.id = 'np-dock';
  const np = doc.createElement('div'); np.id = 'np';
  dock.append(np);
  doc.body.append(dock);
  globalThis.document = doc; // the keys bind to the global one
  return doc;
}

const down = async () => ({ ok: false, status: 404, json: async () => ({}) });
const start = (doc) => { const st = startStrip({ doc, fetchImpl: down, nav: {} }); if (st) made.push(st); return st; };
const keepPad = (doc) => doc.querySelector('.play-verb[data-pad="keep"]');
const face = (doc) => keepPad(doc).querySelector('.play-face').textContent;
const say = (doc, detail) => doc.dispatchEvent(new CustomEvent('hindsight:keeps', { detail }));

test('the KEEP pad starts as the bare word', async () => {
  await withPlayOn(async () => {
    const doc = page();
    const strip = start(doc);
    assert.ok(strip, 'the strip was built');
    assert.equal(face(doc), 'KEEP');
    strip.destroy();
  });
});

test('the pad says what the feed keeps', async () => {
  await withPlayOn(async () => {
    const doc = page();
    const strip = start(doc);
    say(doc, { feed: '30s' });
    assert.equal(face(doc), 'KEEP 30s');
    assert.match(keepPad(doc).getAttribute('aria-label'), /^KEEP 30s: /, 'the name contains what is written on it');
    say(doc, { feed: '2m' });
    assert.equal(face(doc), 'KEEP 2m');
    strip.destroy();
  });
});

test('an open buffer is what K keeps: its length wins, and the feed’s is back when it shuts', async () => {
  await withPlayOn(async () => {
    const doc = page();
    const strip = start(doc);
    say(doc, { feed: '30s' });
    say(doc, { buffer: '4 BARS' });
    assert.equal(face(doc), 'KEEP 4 BARS');
    say(doc, { feed: '2m' }); // the feed's poll goes on while the buffer is open
    assert.equal(face(doc), 'KEEP 4 BARS');
    say(doc, { buffer: '' });
    assert.equal(face(doc), 'KEEP 2m');
    strip.destroy();
  });
});

test('the length keeps the case it was written in', async () => {
  await withPlayOn(async () => {
    const doc = page();
    const strip = start(doc);
    say(doc, { feed: '30s' });
    const words = keepPad(doc).querySelector('.play-face-words');
    assert.ok(words, 'the length is its own span, which the stylesheet leaves in lower case');
    assert.equal(words.textContent, '30s');
    strip.destroy();
  });
});

test('after teardown the strip no longer listens', async () => {
  await withPlayOn(async () => {
    const doc = page();
    const strip = start(doc);
    assert.equal(doc.listenerCount('hindsight:keeps'), 1, 'it listens while it is up');
    say(doc, { feed: '30s' });
    strip.destroy();
    assert.equal(doc.listenerCount('hindsight:keeps'), 0, 'its listener went with it');
  });
});

test('setVerbWords on the pad: words after the face, none puts the bare face back', () => {
  const doc = fakeDoc();
  const root = doc.createElement('section');
  doc.body.append(root);
  const ui = mountStrip(root, new Surface({ bpm: 120, originMs: 0, division: '16th' }), { doc, has: (n) => n === 'rooms' });
  const pad = root.querySelector('.play-verb[data-pad="keep"]');
  ui.setVerbWords('keep', '4 BARS');
  assert.equal(pad.querySelector('.play-face').textContent, 'KEEP 4 BARS');
  ui.setVerbWords('keep', '');
  assert.equal(pad.querySelector('.play-face').textContent, 'KEEP');
  assert.match(pad.getAttribute('aria-label'), /^KEEP: /);
  assert.doesNotThrow(() => ui.setVerbWords('nosuch', 'x'), 'a verb with no pad is nothing');
  assert.doesNotThrow(() => ui.setVerbWords('grab', 'x'), 'GRAB’s pad is drawn and takes words too');
});
