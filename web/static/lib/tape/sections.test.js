// web/static/lib/tape/sections.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionHit, newName, isLooped, barsText, colorOf, makeSpan, edgeTo, SECTION_NAMES, EDGE_HIT_PX } from './sections.js';

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
  assert.equal(colorOf(verse).id, 'blue');
});

// 84 BPM at 48 kHz: a bar is 137142.857… frames, so bar lines are rounded.
const g84 = { frames: 548571, bars: 4 };
const bl = (n) => Math.round((n * 548571) / 4);

test('makeSpan covers the bars dragged across, on whole frames', () => {
  assert.deepEqual(makeSpan(0.6 * 137142, 3.4 * 137142, g84), { from: bl(0), to: bl(4) });
  assert.deepEqual(makeSpan(3.4 * 137142, 0.6 * 137142, g84), { from: bl(0), to: bl(4) }, 'either way');
  assert.deepEqual(makeSpan(bl(2) + 10, bl(2) + 20, g84), { from: bl(2), to: bl(3) });
  assert.deepEqual(makeSpan(100.4, 900.6, null), { from: 100, to: 901 });
  assert.equal(makeSpan(500, 500, null), null, 'a tap with no tempo makes nothing');
});

test('edgeTo: whole frames on bar lines, a bar from the other edge, short of the neighbours', () => {
  const sc = { id: 'v', at: bl(2), end: bl(4) };
  const next = { id: 'c', at: bl(6), end: bl(8) };
  const prev = { id: 'p', at: bl(0), end: bl(1) };
  const all = [prev, sc, next];
  const len = 48000 * 60;
  // Dragged past its start: a bar long, and a whole frame.
  const r = edgeTo(sc, 'out', bl(1), all, g84, len);
  assert.deepEqual(r, { at: bl(2), end: bl(3) });
  assert.ok(Number.isInteger(r.end));
  assert.deepEqual(edgeTo(sc, 'out', bl(9), all, g84, len), { at: bl(2), end: bl(6) }, 'stops at the next');
  assert.deepEqual(edgeTo(sc, 'in', 0, all, g84, len), { at: bl(1), end: bl(4) }, 'stops at the one before');
  assert.deepEqual(edgeTo(sc, 'in', bl(9), all, g84, len), { at: bl(3), end: bl(4) }, 'a bar short of its end');
  // The last bar line on the tape, not its last frame.
  const lone = { id: 'z', at: bl(1), end: bl(2) };
  const e = edgeTo(lone, 'out', 10 * len, [lone], g84, len).end;
  assert.ok(e <= len && Number.isInteger(e));
});
