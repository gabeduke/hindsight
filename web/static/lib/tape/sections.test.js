// web/static/lib/tape/sections.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionHit, newName, isLooped, barsText, colorOf, SECTION_NAMES, EDGE_HIT_PX } from './sections.js';

const view = { from: 0, to: 1000 }; // 1 frame a pixel on a 1000 px strip
const verse = { id: 'a', name: 'Verse', at: 100, end: 300 };
const chorus = { id: 'b', name: 'Chorus', at: 300, end: 320, color: 'blue' };

test('sectionHit: an edge to drag, the body to tap, or nothing', () => {
  assert.deepEqual(sectionHit([verse], 105, view, 1000), { section: verse, zone: 'in' });
  assert.deepEqual(sectionHit([verse], 295, view, 1000), { section: verse, zone: 'out' });
  assert.deepEqual(sectionHit([verse], 200, view, 1000), { section: verse, zone: 'body' });
  assert.equal(sectionHit([verse], 50, view, 1000), null);
  assert.equal(sectionHit([], 50, view, 1000), null);
});

test('sectionHit: a narrow section is all body', () => {
  assert.equal(chorus.end - chorus.at < 3 * EDGE_HIT_PX, true);
  assert.equal(sectionHit([chorus], 302, view, 1000).zone, 'body');
});

test('newName: the first name not taken, then a number', () => {
  assert.equal(newName([]), 'Intro');
  assert.equal(newName([{ name: 'Intro' }, { name: 'Verse' }]), 'Chorus');
  const all = SECTION_NAMES.map((name) => ({ name }));
  assert.equal(newName(all), 'Section 7');
});

test('isLooped: the loop is exactly the section', () => {
  assert.equal(isLooped(verse, { in: 100, out: 300 }), true);
  assert.equal(isLooped(verse, { in: 100, out: 301 }), false);
  assert.equal(isLooped(verse, null), false);
});

test('barsText: bars from 1, or seconds with no tempo', () => {
  const grid = { frames: 400, bars: 4 }; // a bar is 100
  assert.equal(barsText({ at: 100, end: 400 }, grid, 48000), 'bars 2–4');
  assert.equal(barsText({ at: 0, end: 100 }, grid, 48000), 'bar 1');
  assert.equal(barsText({ at: 0, end: 72000 }, null, 48000), '1.5 s');
});

test('colorOf: a colour by its id, the first for none', () => {
  assert.equal(colorOf(chorus).id, 'blue');
  assert.equal(colorOf(verse).id, 'amber');
});
