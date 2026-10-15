import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeckModel, RATE, SHUT_MS, OPEN_MS, OVERSHOOT_PX, doorAt } from './deck.js';
import { EASE_MS } from '../objects/reels.js';
import { SEAT_FROM } from './choreo.js';

const TRAVEL = 90;

/** run steps `m` every `dt` ms for `ms`, answering every view. */
function run(m, state, ms, dt = 1) {
  const views = [];
  for (let i = 0; i < Math.round(ms / dt); i++) { m.step(state, dt); views.push(m.view); }
  return views;
}

test('first sight is as the page says, not animated in', () => {
  const shut = new DeckModel();
  assert.equal(shut.step({ door: 'shut', travel: TRAVEL }, 0), false);
  assert.equal(shut.view.door, 0);
  const open = new DeckModel();
  open.step({ door: 'open', travel: TRAVEL }, 0);
  assert.equal(open.view.door, -TRAVEL);
});

test('SEAT: the door shuts in 160 ms, 2 px past shut and back', () => {
  const m = new DeckModel();
  m.step({ door: 'open', travel: TRAVEL }, 0);
  const views = run(m, { door: 'shut', travel: TRAVEL }, SHUT_MS + 20);
  const doors = views.map((v) => v.door);
  const most = Math.max(...doors);
  assert.ok(Math.abs(most - OVERSHOOT_PX) < 0.05, `it goes ${most.toFixed(3)} px past`);
  assert.equal(doors[SHUT_MS - 1], 0, 'and is shut at 160 ms');
  assert.equal(doors.at(-1), 0);
  // The overshoot is 2 px whatever the door's height.
  const tall = new DeckModel();
  tall.step({ door: 'open', travel: 300 }, 0);
  const t = run(tall, { door: 'shut', travel: 300 }, SHUT_MS).map((v) => v.door);
  assert.ok(Math.abs(Math.max(...t) - OVERSHOOT_PX) < 0.05);
  // And what's in the window settles in from where the flight left it.
  assert.ok(Math.abs(views[0].seat - SEAT_FROM) < 0.01);
  assert.equal(views.at(-1).seat, 1);
});

test('the door opens in --t-touch, without going past', () => {
  const m = new DeckModel();
  m.step({ door: 'shut', travel: TRAVEL }, 0);
  const doors = run(m, { door: 'open', travel: TRAVEL }, OPEN_MS + 10).map((v) => v.door);
  assert.ok(Math.max(...doors) <= 0);
  assert.equal(doors[OPEN_MS - 1], -TRAVEL);
  assert.equal(doorAt(0, TRAVEL, true), -TRAVEL);
  assert.equal(doorAt(1, TRAVEL, false), 0);
});

test('SPIN UP: the reels wait for the door, then reach speed in about EASE_MS', () => {
  const m = new DeckModel();
  m.step({ door: 'open', travel: TRAVEL, playing: false }, 0);
  // The sound starts at SEAT, with the door still to shut.
  const s = { door: 'shut', travel: TRAVEL, playing: true };
  const seat = run(m, s, SHUT_MS - 1);
  assert.ok(seat.every((v) => v.rate === 0), 'not a turn until the door is shut');
  const up = run(m, s, EASE_MS + 1);
  const at = up.findIndex((v) => v.rate >= 0.95 * RATE);
  assert.ok(at > EASE_MS * 0.8 && at < EASE_MS * 1.2, `95 % of speed after ${at} ms`);
  assert.ok(up.at(-1).angle !== 0, 'and they turn');
  assert.equal(m.step(s, 16), true, 'turning reels want frames');
});

test('a stop: the reels coast down, the tape takes up its slack, and it parks', () => {
  const m = new DeckModel();
  const playing = { door: 'shut', travel: TRAVEL, playing: true };
  m.step(playing, 0);
  run(m, playing, 1000);
  assert.ok(Math.abs(m.view.rate - RATE) < 1e-3);
  const stopped = { ...playing, playing: false };
  const coast = run(m, stopped, 1500);
  assert.ok(coast[100].rate > 0.2 * RATE, 'it coasts rather than stopping dead');
  const sags = coast.map((v) => v.sag);
  assert.ok(Math.max(...sags) > 2, 'the tape goes slack');
  assert.ok(Math.min(...sags) < 0, 'and is pulled a touch past taut');
  assert.equal(coast.at(-1).rate, 0);
  assert.equal(coast.at(-1).sag, 0);
  assert.equal(m.step(stopped, 16), false, 'then it parks');
});

test('reduced motion: everything lands at once, the reels don’t turn, and it parks', () => {
  const m = new DeckModel();
  m.step({ door: 'open', travel: TRAVEL }, 0);
  const s = { door: 'shut', travel: TRAVEL, playing: true };
  assert.equal(m.step(s, Infinity), false);
  assert.equal(m.view.door, 0);
  assert.equal(m.view.rate, RATE);
  assert.equal(m.view.angle, 0);
  assert.equal(m.step({ ...s, playing: false }, Infinity), false);
  assert.equal(m.view.sag, 0);
});
