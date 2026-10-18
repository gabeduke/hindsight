// web/static/lib/tape/cuelane.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAtX, trackAtY, formatClipLen } from './cuelane.js';

test('formatClipLen formats seconds correctly', () => {
  assert.equal(formatClipLen(48000, 48000), '1.0s');
  assert.equal(formatClipLen(24000, 48000), '0.5s');
  assert.equal(formatClipLen(480000, 48000), '10s');
  assert.equal(formatClipLen(960000, 48000), '20s');
});

test('frameAtX calculates timeline position with clamping', () => {
  // width = 1000, left = 100, span = 0 to 480000
  assert.equal(frameAtX(100, 100, 1000, 0, 480000), 0);
  assert.equal(frameAtX(600, 100, 1000, 0, 480000), 240000);
  assert.equal(frameAtX(1100, 100, 1000, 0, 480000), 480000);
  // Clamped bounds
  assert.equal(frameAtX(50, 100, 1000, 0, 480000), 0);
  assert.equal(frameAtX(1200, 100, 1000, 0, 480000), 480000);
  // Zero width safety
  assert.equal(frameAtX(200, 100, 0, 1000, 2000), 1000);
});

test('trackAtY maps vertical pointer coordinate to track index', () => {
  const rects = [
    { top: 100, bottom: 180 }, // Track 1
    { top: 190, bottom: 270 }, // Track 2
    { top: 280, bottom: 360 }, // Track 3
    { top: 370, bottom: 450 }, // Track 4
  ];

  assert.equal(trackAtY(120, rects), 1);
  assert.equal(trackAtY(200, rects), 2);
  assert.equal(trackAtY(300, rects), 3);
  assert.equal(trackAtY(400, rects), 4);
  assert.equal(trackAtY(50, rects), null);
  assert.equal(trackAtY(500, rects), null);
  assert.equal(trackAtY(185, rects), null); // in gap
});
