import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navTabs, studioRedirect } from './nav.js';

const current = (tabs) => tabs.filter((t) => t.current).map((t) => t.id);
const PAGES = ['/', '/index.html', '/takes.html', '/wave.html', '/tape.html', '/guide.html', '/rig.html'];

test('every page has the two rooms, the Studio first', () => {
  for (const p of PAGES) {
    for (const tapeOn of [true, false]) {
      assert.deepEqual(navTabs(p, tapeOn).map((t) => [t.id, t.label]),
        [['studio', 'Studio'], ['room', 'Listening Room']], `${p}, tape ${tapeOn}`);
    }
  }
});

test('the Studio is the tape page with the tape on, and `/` with it off', () => {
  assert.deepEqual(navTabs('/takes.html', true).map((t) => t.href), ['/tape.html', '/takes.html']);
  assert.deepEqual(navTabs('/takes.html', false).map((t) => t.href), ['/', '/takes.html']);
});

test('each page lights its room; a take is in the Listening Room', () => {
  for (const tapeOn of [true, false]) {
    assert.deepEqual(current(navTabs('/', tapeOn)), ['studio']);
    assert.deepEqual(current(navTabs('/index.html', tapeOn)), ['studio']);
    assert.deepEqual(current(navTabs('/tape.html', tapeOn)), ['studio']);
    assert.deepEqual(current(navTabs('/takes.html', tapeOn)), ['room']);
    assert.deepEqual(current(navTabs('/wave.html', tapeOn)), ['room']);
    assert.deepEqual(current(navTabs('/guide.html', tapeOn)), []);
    assert.deepEqual(current(navTabs('/rig.html', tapeOn)), []);
  }
});

test('a stale cache is put right once the Pi answers', () => {
  // `/` with the tape on is not the Studio: the tape page is.
  assert.equal(studioRedirect('/', true), '/tape.html');
  assert.equal(studioRedirect('/index.html', true), '/tape.html');
  // The tape page with the tape off has nothing to show: the Studio is `/`.
  assert.equal(studioRedirect('/tape.html', false), '/');
  // Already in the right place, or a room that doesn't move.
  assert.equal(studioRedirect('/tape.html', true), null);
  assert.equal(studioRedirect('/', false), null);
  assert.equal(studioRedirect('/takes.html', true), null);
  assert.equal(studioRedirect('/wave.html', false), null);
  // No answer (the Pi unreachable, a 500) moves nothing.
  assert.equal(studioRedirect('/', null), null);
  assert.equal(studioRedirect('/tape.html', null), null);
});

// ☰ on the page's one stack of open things (lib/ui/layers.js), where the
// browser has CloseWatcher: Escape and Android's Back are a close request to
// the newest watcher, and the router closes the menus before a switch.
test('☰ is on the page’s stack: a close request shuts it and gives its button the focus, and so does a switch of rooms', async () => {
  const { fakeDoc, parseHTML } = await import('./play/fake-dom.js');
  const { createLayers } = await import('./ui/layers.js');
  const { mountHeaderTools } = await import('./nav.js');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, '<header class="appbar"><nav class="appnav"></nav></header><main id="page"></main>').nodes);
  const live = [];
  class CloseWatcher { constructor() { live.push(this); } destroy() { live.splice(live.indexOf(this), 1); } }
  const layers = createLayers({ doc, win: doc, CloseWatcher });
  mountHeaderTools(doc, { layers });
  const btn = doc.getElementById('app-menu-btn');
  const menu = doc.getElementById('app-menu');
  const open = () => !menu.hidden && btn.getAttribute('aria-expanded') === 'true';
  btn.dispatchEvent({ type: 'click' });
  assert.ok(open());
  assert.equal(layers.top()?.kind, 'menu');
  assert.equal(live.length, 1, 'one watcher, made in the press that opened it');
  menu.children[0].focus();
  live.pop().onclose(); // Android's Back: the newest watcher's, and it is spent
  assert.ok(!open(), 'Back shuts it, and stays in the room');
  assert.equal(doc.activeElement, btn);
  assert.equal(live.length, 0);
  btn.dispatchEvent({ type: 'click' });
  layers.closeAll({ kinds: ['menu', 'popover'], reason: 'navigate' }); // the router, before a switch
  assert.ok(!open(), 'a switch of rooms shuts it');
  btn.dispatchEvent({ type: 'click' });
  assert.ok(open(), 'and it opens again after');
  // Open's own menus hide every .menu as one opens: ☰ still opens after.
  menu.hidden = true;
  btn.dispatchEvent({ type: 'click' });
  assert.ok(open());
});

// Play mode went on 2026-10-30, but a phone that had it on kept
// `hindsight.play` = '1', and a release older than that, picked from
// Releases, would read it and draw the strip and EDIT | PLAY again over the
// mini player. Every page forgets the retired keys as it loads.
test('a page forgets Play mode’s retired keys as it loads, and keeps this device’s others', async () => {
  const { fakeDoc, parseHTML } = await import('./play/fake-dom.js');
  const { initNav } = await import('./nav.js');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, '<header class="appbar"><nav class="appnav"></nav></header><main id="page"></main>').nodes);
  const kept = {
    'hindsight.play': '1', 'hindsight.play.strip': 'open', 'hindsight.play.from': 'keys',
    'hindsight.play.webmidi': '1', 'hindsight.play.midi': '{}', 'hindsight.latency': '0', 'hindsight.library': 'list',
  };
  const localStorage = { getItem: (k) => kept[k] ?? null, setItem: (k, v) => { kept[k] = String(v); }, removeItem: (k) => { delete kept[k]; } };
  await initNav(doc, {
    localStorage, location: { pathname: '/tape.html' }, setInterval: () => 0,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.deepEqual(Object.keys(kept).sort(), ['hindsight.latency', 'hindsight.library']);
});
