import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PiClock } from './piclock.js';

test('the offset comes from the quickest round trip, its two legs taken apart', () => {
  const c = new PiClock();
  assert.equal(c.ready, false);
  assert.equal(c.toPi(100), undefined, 'nothing to go on yet');
  // The Pi's clock runs 5000 ms ahead. A slow trip, its way back held up 40 ms:
  c.take({ c: 100, pi_in: 5105, pi_out: 5106 }, 150);
  // and a quick one, 4 ms each way and 1 ms on the Pi.
  c.take({ c: 200, pi_in: 5204, pi_out: 5205 }, 209);
  assert.equal(c.ready, true);
  assert.equal(c.rttMs, 8);
  assert.equal(c.toPi(1000), 6000);
});

test('a trip that makes no sense is not taken, and a new socket forgets the old Pi', () => {
  const c = new PiClock();
  c.take({ c: 100, pi_in: 5, pi_out: 4 }, 110); // answered before it was read
  c.take({ c: 100, pi_in: 5, pi_out: 6 }, 90); // back before it was sent
  c.take({ c: 100 }, 110);
  assert.equal(c.ready, false);
  c.take({ c: 0, pi_in: 10, pi_out: 10 }, 2);
  c.reset();
  assert.equal(c.ready, false);
});

test('it keeps the latest trips, so an old quick one does not hold the offset for ever', () => {
  const c = new PiClock({ keep: 2 });
  c.take({ c: 0, pi_in: 1001, pi_out: 1001 }, 2); // quick: offset 1000
  c.take({ c: 10, pi_in: 2015, pi_out: 2015 }, 20); // the clocks have moved: 2000
  c.take({ c: 20, pi_in: 2025, pi_out: 2025 }, 30);
  assert.equal(c.toPi(0), 2000);
});
