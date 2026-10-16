import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navTabs, studioRedirect } from './nav.js';

const current = (tabs) => tabs.filter((t) => t.current).map((t) => t.id);

test('each page lights its own tab; a take belongs to the takes', () => {
  assert.deepEqual(current(navTabs('/', true)), ['capture']);
  assert.deepEqual(current(navTabs('/index.html', true)), ['capture']);
  assert.deepEqual(current(navTabs('/takes.html', true)), ['takes']);
  assert.deepEqual(current(navTabs('/wave.html', true)), ['takes']);
  assert.deepEqual(current(navTabs('/tape.html', true)), ['tape']);
  assert.deepEqual(current(navTabs('/guide.html', true)), []);
});

test('the tabs go where they say, Capture first', () => {
  assert.deepEqual(navTabs('/', true).map((t) => [t.id, t.href, t.label]), [
    ['capture', '/', 'Capture'], ['takes', '/takes.html', 'Takes'], ['tape', '/tape.html', 'Tape'],
  ]);
});

test('with the tape off there is no Tape tab', () => {
  assert.deepEqual(navTabs('/', false).map((t) => t.id), ['capture', 'takes']);
  assert.deepEqual(current(navTabs('/tape.html', false)), []);
});

// The two rooms (lib/rooms/flag.js): two tabs in place of three.

const ids = (tabs) => tabs.map((t) => t.id);
const PAGES = ['/', '/index.html', '/takes.html', '/wave.html', '/tape.html', '/guide.html'];

test('with the rooms off, every page has the three tabs it always had', () => {
  for (const p of PAGES) {
    assert.deepEqual(ids(navTabs(p, true)), ['capture', 'takes', 'tape'], p);
    assert.deepEqual(ids(navTabs(p, true, false)), ['capture', 'takes', 'tape'], p);
    assert.deepEqual(ids(navTabs(p, false, false)), ['capture', 'takes'], p);
  }
  assert.deepEqual(navTabs('/tape.html', true, false).map((t) => t.href), ['/', '/takes.html', '/tape.html']);
});

test('with the rooms on, every page has two tabs, the Studio first', () => {
  for (const p of PAGES) {
    for (const tapeOn of [true, false]) {
      assert.deepEqual(navTabs(p, tapeOn, true).map((t) => [t.id, t.label]),
        [['studio', 'Studio'], ['room', 'Listening Room']], `${p}, tape ${tapeOn}`);
    }
  }
});

test('the Studio is the tape page with the tape on, and Capture with it off', () => {
  assert.deepEqual(navTabs('/takes.html', true, true).map((t) => t.href), ['/tape.html', '/takes.html']);
  assert.deepEqual(navTabs('/takes.html', false, true).map((t) => t.href), ['/', '/takes.html']);
});

test('with the rooms on, each page lights its room; a take is in the Listening Room', () => {
  for (const tapeOn of [true, false]) {
    assert.deepEqual(current(navTabs('/', tapeOn, true)), ['studio']);
    assert.deepEqual(current(navTabs('/index.html', tapeOn, true)), ['studio']);
    assert.deepEqual(current(navTabs('/tape.html', tapeOn, true)), ['studio']);
    assert.deepEqual(current(navTabs('/takes.html', tapeOn, true)), ['room']);
    assert.deepEqual(current(navTabs('/wave.html', tapeOn, true)), ['room']);
    assert.deepEqual(current(navTabs('/guide.html', tapeOn, true)), []);
  }
});

test('with the rooms on, a stale cache is put right once the Pi answers', () => {
  // Capture with the tape on is not a room: the Studio is the tape page.
  assert.equal(studioRedirect('/', true, true), '/tape.html');
  assert.equal(studioRedirect('/index.html', true, true), '/tape.html');
  // The tape page with the tape off has nothing to show: the Studio is Capture.
  assert.equal(studioRedirect('/tape.html', false, true), '/');
  // Already in the right place, or a room that doesn't move.
  assert.equal(studioRedirect('/tape.html', true, true), null);
  assert.equal(studioRedirect('/', false, true), null);
  assert.equal(studioRedirect('/takes.html', true, true), null);
  assert.equal(studioRedirect('/wave.html', false, true), null);
  // No answer (the Pi unreachable, a 500) moves nothing.
  assert.equal(studioRedirect('/', null, true), null);
  assert.equal(studioRedirect('/tape.html', null, true), null);
});

test('with the rooms off, nothing is ever redirected', () => {
  for (const p of PAGES) for (const tapeOn of [true, false, null]) assert.equal(studioRedirect(p, tapeOn, false), null);
});
