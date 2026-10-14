import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Surface, DIVISIONS, IDLE, ARMED, ON, RELEASING } from './surface.js';

// 120 bpm: a beat is 500 ms, a sixteenth is 125 ms. Bar lines at origin 0.
const at120 = (over = {}) => new Surface({ bpm: 120, originMs: 0, division: '16th', ...over });

/** log collects the musical events in order, as a player would hear them. */
function log(s) {
  const out = [];
  for (const name of ['arm', 'fire', 'end', 'idle']) s.on(name, (d) => out.push([name, d.pad, d.at]));
  return out;
}

test('a sixteenth at 120 bpm is 125 ms', () => {
  assert.equal(at120().gridMs(), 125);
  assert.equal(at120({ division: 'beat' }).gridMs(), 500);
  assert.equal(at120({ division: 'bar' }).gridMs(), 2000);
  assert.equal(at120({ division: 'off' }).gridMs(), 0);
});

test('nextGrid rounds up, and a press on the line fires on that line', () => {
  const s = at120();
  assert.equal(s.nextGrid(0), 0);
  assert.equal(s.nextGrid(1), 125);
  assert.equal(s.nextGrid(124), 125);
  assert.equal(s.nextGrid(125), 125, 'exactly on the line should not wait for the next one');
  assert.equal(s.nextGrid(126), 250);
});

test('a press arms now and fires on the next grid line', () => {
  const s = at120();
  const events = log(s);
  s.press('break', 40);
  assert.equal(s.state('break'), ARMED);
  assert.deepEqual(events, [['arm', 'break', 40]]);

  s.tick(100);
  assert.equal(s.state('break'), ARMED, 'not yet: the line is at 125');

  s.tick(130);
  assert.equal(s.state('break'), ON);
  assert.deepEqual(events[1], ['fire', 'break', 125], 'it fires at the line, not when the frame ran');
});

test('the gesture ends on a grid line too, so it comes back in time', () => {
  const s = at120();
  const events = log(s);
  s.press('break', 0);
  s.tick(0);
  s.release('break', 300); // between 250 and 375
  assert.equal(s.state('break'), RELEASING);
  s.tick(400);
  assert.deepEqual(events.filter((e) => e[0] === 'end'), [['end', 'break', 375]]);
  assert.equal(s.state('break'), IDLE);
});

test('a tap shorter than a grid unit still gets a whole one', () => {
  // The player hit something and heard themselves hit it. Ending on the line
  // it started on would be a gesture of zero length.
  const s = at120();
  const events = log(s);
  s.press('chop', 0);
  s.tick(0);
  assert.equal(s.state('chop'), ON);
  s.release('chop', 30); // same grid line it fired on
  s.tick(200);
  const end = events.find((e) => e[0] === 'end');
  assert.deepEqual(end, ['end', 'chop', 125], 'pushed to the following line');
});

test('letting go before it ever fired still fires, then ends', () => {
  // A stab played early. The press was real and the player is committed to
  // hearing it, so it lands on the beat and lasts one unit.
  const s = at120();
  const events = log(s);
  s.press('rev', 40);   // arms, will fire at 125
  s.release('rev', 60); // let go before 125
  s.tick(500);
  const names = events.map((e) => e[0]);
  assert.deepEqual(names, ['arm', 'fire', 'end', 'idle']);
  assert.deepEqual(events[1], ['fire', 'rev', 125]);
  assert.deepEqual(events[2], ['end', 'rev', 250]);
});

test('with quantise off a press fires at once, with no tick needed', () => {
  const s = at120({ division: 'off' });
  const events = log(s);
  s.press('break', 37);
  assert.deepEqual(events, [['arm', 'break', 37], ['fire', 'break', 37]]);
  assert.equal(s.state('break'), ON);
  s.release('break', 90);
  assert.deepEqual(events[2], ['end', 'break', 90]);
});

test('holding a key that repeats is still one press', () => {
  // keydown autorepeat fires over and over; the surface must not re-arm.
  const s = at120();
  const events = log(s);
  s.press('break', 10);
  s.press('break', 20);
  s.press('break', 30);
  assert.equal(events.filter((e) => e[0] === 'arm').length, 1);
});

test('a release with no press is ignored', () => {
  const s = at120();
  const events = log(s);
  s.release('never-pressed', 10);
  assert.deepEqual(events, []);
});

test('held lists what is sounding, and not what is merely armed', () => {
  const s = at120();
  s.press('a', 0);
  s.press('b', 40);
  s.tick(0);
  assert.deepEqual(s.held(), ['a'], 'b is armed for 125, not sounding yet');
  s.tick(130);
  assert.deepEqual(s.held().sort(), ['a', 'b']);
});

test('releaseAll clears everything, sounding or not', () => {
  const s = at120();
  const events = log(s);
  s.press('a', 0);
  s.tick(0);        // a is ON
  s.press('b', 40); // b is ARMED
  s.releaseAll(200);
  assert.deepEqual(s.held(), []);
  assert.equal(s.state('a'), IDLE);
  assert.equal(s.state('b'), IDLE);
  // The sounding one gets a real end; the armed one just goes away.
  assert.ok(events.some((e) => e[0] === 'end' && e[1] === 'a'));
  assert.ok(!events.some((e) => e[0] === 'end' && e[1] === 'b'));
});

test('several pads are independent', () => {
  const s = at120();
  const events = log(s);
  s.press('break', 0);
  s.press('rev', 0);
  s.tick(0);
  s.release('break', 300);
  s.tick(400);
  assert.deepEqual(s.held(), ['rev'], 'releasing one leaves the other held');
  assert.ok(events.some((e) => e[0] === 'end' && e[1] === 'break'));
});

test('a listener that throws does not cost the others their event', () => {
  const s = at120();
  let got = 0;
  s.on('fire', () => { throw new Error('drawing bug'); });
  s.on('fire', () => { got++; });
  s.press('a', 0);
  s.tick(0);
  assert.equal(got, 1, 'a drawing bug must not take the sound with it');
});

test('the grid follows the tape', () => {
  // The tape gives bpm and a time a bar line passed, so the pads land on its
  // bars rather than on a grid of their own.
  const s = at120();
  s.setGrid({ bpm: 90, originMs: 1000, division: 'beat' });
  assert.equal(s.gridMs(), 60000 / 90);
  assert.equal(s.nextGrid(1000), 1000);
  assert.equal(Math.round(s.nextGrid(1100)), Math.round(1000 + 60000 / 90));
});

test('off returns a zero grid, and unknown divisions do not divide by surprise', () => {
  assert.equal(DIVISIONS.off, 0);
  assert.equal(at120({ division: 'nonsense' }).gridMs(), 0);
  assert.equal(at120({ bpm: 0 }).gridMs(), 0);
});

test('a tick that jumps a long way still fires and ends in the right order', () => {
  // A backgrounded tab, or a slow frame. The events must be the ones the
  // player would have heard, at the times they would have heard them.
  const s = at120();
  const events = log(s);
  s.press('break', 10);
  s.release('break', 600);
  s.tick(5000);
  assert.deepEqual(events.map((e) => e[0]), ['arm', 'fire', 'end', 'idle']);
  assert.deepEqual(events[1], ['fire', 'break', 125]);
  assert.deepEqual(events[2], ['end', 'break', 625]);
});
