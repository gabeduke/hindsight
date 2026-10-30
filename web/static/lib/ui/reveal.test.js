// web/static/lib/ui/reveal.test.js
// What a sheet over the foot of a phone's page would cover, scrolled up
// above it (lib/ui/reveal.js): as far as it takes, no further than the
// header lets the topmost go, and not at all when it is in sight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { revealAbove } from './reveal.js';

const box = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) });
const win = () => { const asked = []; return { asked, scrollBy: (o) => asked.push(o) }; };

test('it scrolls the page until what the sheet covers is above it, by the gap', () => {
  const w = win();
  assert.equal(revealAbove([box(300, 380)], box(340, 718), { win: w }), 48);
  assert.deepEqual(w.asked, [{ top: 48, behavior: 'smooth' }]);
});

test('several things: until the lowest is clear, and never the topmost under the header', () => {
  const w = win();
  // The cue lane at 299 and track 4 at 451, the drawer from 338, the header's foot at 55.
  assert.equal(revealAbove([box(299, 345), box(429, 451)], box(338, 718), { win: w, ceiling: 55 }), 121);
  const short = win();
  // Not room for both: the topmost stops 8 px under the header.
  assert.equal(revealAbove([box(100, 140), box(600, 700)], box(338, 718), { win: short, ceiling: 55 }), 37);
});

test('what is in sight already does not move, and with less motion it jumps', () => {
  const w = win();
  assert.equal(revealAbove([box(100, 200)], box(338, 718), { win: w }), 0);
  assert.equal(revealAbove([], box(338, 718), { win: w }), 0);
  assert.equal(revealAbove([box(300, 380)], null, { win: w }), 0);
  assert.deepEqual(w.asked, []);
  revealAbove([box(300, 380)], box(340, 718), { win: w, reduced: true });
  assert.deepEqual(w.asked, [{ top: 48, behavior: 'auto' }]);
});
