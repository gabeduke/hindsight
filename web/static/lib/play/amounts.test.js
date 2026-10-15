import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Amounts, EVERY_MS, HOLD_MS, clampFor } from './amounts.js';

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + ms, fn }; timers.push(x); return x; },
    clearTimer: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      t += ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

test('a drag of a hundred moves a second is sent no more than 30 times, and its last always', () => {
  const clock = fakeTime();
  const sent = [];
  const a = new Amounts({ send: (id, v) => sent.push([clock.now(), id, v]), ...clock });
  for (let i = 1; i <= 100; i++) {
    a.move('filter', i / 100);
    clock.advance(10);
  }
  clock.advance(100);
  assert.ok(sent.length <= Math.ceil(1000 / EVERY_MS) + 1, `${sent.length} sends in a second`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i][0] - sent[i - 1][0] >= EVERY_MS - 1e-9, 'two sends too close');
  assert.deepEqual(sent.at(-1).slice(1), ['filter', 1], 'the last move gets out');
  assert.equal(a.get('filter'), 1);
});

test('the Pi’s echo of a move doesn’t pull a knob back while the hand is on it', () => {
  const clock = fakeTime();
  const a = new Amounts({ ...clock });
  a.move('mod.wow', 0.8);
  clock.advance(50);
  a.heard('mod.wow', 0.4); // the echo of an older move
  assert.equal(a.get('mod.wow'), 0.8);
  clock.advance(HOLD_MS);
  a.heard('mod.wow', 0.3); // another hand, later
  assert.equal(a.get('mod.wow'), 0.3);
});

test('defaults, ranges, and a velocity noted without a send', () => {
  const sent = [];
  const a = new Amounts({ send: (...x) => sent.push(x) });
  assert.equal(a.get('echo'), 0.5);
  assert.equal(a.get('bend'), 0);
  assert.equal(a.get('mod.age'), 0);
  assert.equal(clampFor('bend', -3), -1);
  assert.equal(clampFor('crush', 1.4), 1);
  assert.equal(clampFor('crush', NaN), null);
  const seen = [];
  a.on((id, v, here) => seen.push([id, v, here]));
  a.note('crush', 0.9);
  assert.deepEqual(sent, []);
  assert.deepEqual(seen, [['crush', 0.9, false]]);
});

test('the timers are called as a browser’s must be: not as this one’s methods', () => {
  // A browser's own setTimeout throws "Illegal invocation" called with any
  // `this` but the window; Node's doesn't, so this one stands in for it.
  let t = 0;
  const timers = [];
  function strict(fn, ms) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    timers.push(fn);
    return ms;
  }
  const sent = [];
  const a = new Amounts({ send: (id, v) => sent.push(v), now: () => t, setTimer: strict, clearTimer: strict });
  a.move('echo', 0.2);
  t += 5;
  assert.doesNotThrow(() => a.move('echo', 0.4)); // too soon: it waits
  timers.shift()();
  assert.deepEqual(sent, [0.2, 0.4]);
  assert.doesNotThrow(() => a.close());
});
