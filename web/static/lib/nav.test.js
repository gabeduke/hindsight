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
