import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayWindow } from './playwindow.js';

const clipped = new PlayWindow({ start: 100, end: 200 });
const whole = new PlayWindow(null);

test('a take with no selection plays whole: it opens at 0, contains everything and never finishes', () => {
  assert.equal(whole.clipped, false);
  assert.equal(whole.opening, 0);
  assert.equal(whole.entry(5000), 5000);
  assert.equal(whole.finished(1e9), false);
});

test('a take with a selection opens at In and plays In to Out', () => {
  assert.equal(clipped.clipped, true);
  assert.equal(clipped.opening, 100);
  assert.equal(clipped.entry(150), 150);   // inside: carry on from here
  assert.equal(clipped.entry(0), 100);     // before In: start at In
  assert.equal(clipped.entry(200), 100);   // at Out: start over at In
  assert.equal(clipped.entry(900), 100);   // past Out
  assert.equal(clipped.finished(199), false);
  assert.equal(clipped.finished(200), true);
});

test('an empty or backwards selection is no selection', () => {
  assert.equal(new PlayWindow({ start: 50, end: 50 }).clipped, false);
  assert.equal(new PlayWindow({ start: 90, end: 10 }).clipped, false);
});

test('of reads the API trim', () => {
  assert.deepEqual(PlayWindow.of({ trim: { start_frame: 3, end_frame: 9 } }).region, { start: 3, end: 9 });
  assert.equal(PlayWindow.of({ trim: null }).clipped, false);
  assert.equal(PlayWindow.of({}).clipped, false);
});
