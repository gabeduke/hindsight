import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navTabs } from './nav.js';

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
