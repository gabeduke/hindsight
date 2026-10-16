import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightModel, TARGETS } from './flight.js';
import { HOLD, SEAT_AT, SEATED, EJECT_MS } from './choreo.js';

const from = { x: 1000, y: 330, w: 30, h: 112 };
const to = { x: 400, y: 390, w: 180, h: 90 };

/** run steps `m` at `hz` for `ms` on `state`; answers how many steps still moved, and the views. */
function run(m, state, ms, hz = 60) {
  const dt = 1000 / hz, views = [];
  let moving = 0;
  for (let i = 0; i < Math.round((ms / 1000) * hz); i++) {
    if (m.step(state, dt)) moving++;
    views.push(m.view);
  }
  return { moving, views };
}

test('the goals are places on the timeline', () => {
  assert.deepEqual(TARGETS, { out: HOLD, deck: SEAT_AT, shelf: 0 });
});

test('a pick runs PICK and PULL, then holds pulled out and parks', () => {
  const m = new FlightModel();
  const s = { goal: 'out', from, to: null, turn: true, t0: 0 };
  assert.equal(m.step(s, 0), true, 'just picked, it has somewhere to go');
  assert.equal(m.view.t, 0);
  run(m, s, 280);
  assert.ok(m.view.t > 260 && m.view.t < HOLD, `still pulling at ${m.view.t}`);
  assert.equal(m.view.phase, 'pull');
  run(m, s, 100);
  assert.equal(m.view.t, HOLD);
  assert.equal(m.view.arrived, true);
  assert.equal(m.step(s, 16), false, 'held, it parks');
});

test('PUT IT ON from the hold reaches the window at SEAT, 620 ms later, and hands over', () => {
  const m = new FlightModel();
  let s = { goal: 'out', from, turn: true, t0: 0 };
  run(m, s, 400);
  s = { ...s, goal: 'deck', to };
  const { views } = run(m, s, 1000, 100);
  const phases = [...new Set(views.map((v) => v.phase))];
  assert.deepEqual(phases, ['turn', 'fly', 'seat'], 'SEAT itself is the deck’s');
  const at = views.findIndex((v) => v.t === SEAT_AT);
  assert.equal(at + 1, (SEAT_AT - HOLD) / 10, 'at 1× real time');
  assert.equal(views[at].x, to.x + to.w / 2);
  assert.equal(m.step(s, 10), false);
});

test('a reel box dissolves into the deck as it arrives; ejected, it appears from it', () => {
  const m = new FlightModel();
  const s = { goal: 'deck', from, to, turn: true, vanish: true, t0: 0 };
  const { views } = run(m, s, 1000, 100);
  assert.equal(views.find((v) => v.t === 700).face.o, 1);
  assert.ok(views.find((v) => v.t === 860).face.o < 1);
  assert.equal(views.at(-1).face.o, 0);
});

test('a card closed mid-pull turns it round, back at the eject’s speed', () => {
  const m = new FlightModel();
  let s = { goal: 'out', from, turn: true, t0: 0 };
  run(m, s, 200);
  const was = m.view.t;
  s = { ...s, goal: 'shelf' };
  m.step(s, 10);
  assert.ok(m.view.t < was, 'reversed at once');
  run(m, s, 400);
  assert.equal(m.view.t, 0);
  assert.equal(m.view.phase, 'shelf');
  assert.equal(m.view.arrived, true);
});

test('ejected from the deck, it is back on the shelf in 700 ms', () => {
  const m = new FlightModel();
  const s = { goal: 'shelf', from, to, turn: true, t0: SEATED };
  m.step(s, 0);
  assert.equal(m.view.t, SEATED);
  assert.equal(m.view.phase, 'seated');
  const { views } = run(m, s, 800, 100);
  const home = views.findIndex((v) => v.t === 0);
  assert.ok(Math.abs((home + 1) * 10 - EJECT_MS) <= 10, `home after ${(home + 1) * 10} ms`);
  // Backwards through the same frames.
  assert.deepEqual([...new Set(views.map((v) => v.phase))], ['seat', 'fly', 'turn', 'pull', 'pick', 'shelf']);
});

test('a dropped frame jumps the playhead on rather than slowing the move', () => {
  const m = new FlightModel();
  const s = { goal: 'deck', from, to, turn: true, t0: 0 };
  m.step(s, 0);
  m.step(s, 16);
  m.step(s, 900); // the phone was busy
  assert.equal(m.view.t, 916);
  m.step(s, 16);
  assert.ok(m.view.t >= SEAT_AT, 'in SEAT on time, not 900 ms late');
});

test('reduced motion: an infinite step lands on the goal and parks', () => {
  const m = new FlightModel();
  const s = { goal: 'deck', from, to, turn: true, t0: 0 };
  assert.equal(m.step(s, Infinity), false);
  assert.equal(m.view.t, SEAT_AT);
  assert.equal(m.view.arrived, true);
  const back = new FlightModel();
  assert.equal(back.step({ goal: 'shelf', from, to, t0: SEATED }, Infinity), false);
  assert.equal(back.view.t, 0);
});

test('the view is the same object until something changes, so a still flight draws nothing', () => {
  const m = new FlightModel();
  const s = { goal: 'out', from, t0: 0 };
  run(m, s, 400);
  const v = m.view;
  m.step(s, 16);
  assert.equal(m.view, v);
  // A deck that scrolled: new geometry, a new view at the same time.
  m.step({ ...s, from: { ...from, y: 100 } }, 16);
  assert.notEqual(m.view, v);
  assert.equal(m.view.t, HOLD);
});

test('without a slot to start from it draws nothing', () => {
  const m = new FlightModel();
  assert.equal(m.step({ goal: 'deck' }, 16), false);
  assert.equal(m.view, null);
});
