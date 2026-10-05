// web/static/lib/wave/rowwave-look.test.js
// A spine's printed bars: as many as fit, 4 px apart, with room for the caps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spineBarCount } from './rowwave.js';

test('spineBarCount fits bars 4 px apart with a 2 px margin each side', () => {
  assert.equal(spineBarCount(150), 37); // x 2 to 146, the caps inside 148
  assert.equal(spineBarCount(3), 0);
  assert.equal(spineBarCount(4), 1);
  assert.equal(spineBarCount(0), 0);
});
