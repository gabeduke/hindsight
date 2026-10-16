import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cablePath, sag, centreIn } from './cables.js';

test('a cable runs from socket to socket and sags, more the further it reaches', () => {
  const p = cablePath({ x: 10, y: 20 }, { x: 210, y: 20 });
  assert.match(p, /^M10 20 C[\d. ]+ 210 20$/);
  assert.ok(sag({ x: 0, y: 0 }, { x: 400, y: 0 }) > sag({ x: 0, y: 0 }, { x: 40, y: 0 }));
  assert.ok(sag({ x: 0, y: 0 }, { x: 4000, y: 0 }) <= 140, 'never more than a hand’s length');
  const nums = (p) => p.replace(/[MC]/g, '').split(' ').map(Number);
  const side = nums(cablePath({ x: 0, y: 100 }, { x: 100, y: 110 }));
  assert.ok(side[3] > 110, 'side by side, it hangs below the lower end');
  // From one row down to the next: out of the upper downward, into the
  // lower from above, so it never loops back up over the names between.
  const down = nums(cablePath({ x: 0, y: 0 }, { x: 100, y: 100 }));
  assert.equal(down[2], 0, 'it leaves straight down');
  assert.ok(down[3] > 0 && down[5] < 100, 'and arrives from above');
});

test('a socket’s centre is measured from the desk', () => {
  assert.deepEqual(centreIn({ left: 110, top: 220, width: 20, height: 20 }, { left: 100, top: 200 }), { x: 20, y: 30 });
});
