import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothTime, MAX_EXTRAPOLATE_S } from './clock.js';

test('between two reports the time advances with the wall clock, scaled by the rate', () => {
  const s = { t: -1, at: 0 };
  assert.equal(smoothTime(s, 10, 1000, 1), 10);          // first report: resync
  assert.equal(smoothTime(s, 10, 1100, 1), 10.1);        // same report 100 ms later
  assert.equal(smoothTime(s, 10, 1200, 0.5), 10.1);      // half speed
  assert.equal(smoothTime(s, 10, 1200, 2), 10.4);        // double
});

test('a new report resyncs exactly, forwards or backwards', () => {
  const s = { t: -1, at: 0 };
  smoothTime(s, 10, 1000, 1);
  smoothTime(s, 10, 1240, 1);
  assert.equal(smoothTime(s, 10.25, 1250, 1), 10.25);    // the element caught up
  assert.equal(smoothTime(s, 2, 1300, 1), 2);            // loop wrap or seek: no extrapolation carried over
  assert.equal(smoothTime(s, 2, 1350, 1), 2.05);
});

test('extrapolation is capped so a stalled element cannot run ahead', () => {
  const s = { t: -1, at: 0 };
  smoothTime(s, 10, 0, 1);
  assert.equal(smoothTime(s, 10, 5000, 1), 10 + MAX_EXTRAPOLATE_S);
  assert.equal(smoothTime(s, 10, 5000, 2), 10 + MAX_EXTRAPOLATE_S);
});

test('a loop too long to slice still plays at 1×, and practice speed comes back after', async () => {
  const saved = globalThis.Audio;
  class FakeAudio {
    constructor() { this.currentTime = 0; this.playbackRate = 1; this.defaultPlaybackRate = 1; }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() {}
  }
  globalThis.Audio = FakeAudio;
  try {
    const { Clock, SLICE_CAP_SECONDS } = await import('./clock.js');
    const c = new Clock({ previewUrl: '', sampleRate: 1000, file: 'x.wav' });
    c.setRate(0.5);
    assert.equal(c.audio.playbackRate, 0.5);
    await c.setLoop({ start: 0, end: (SLICE_CAP_SECONDS + 1) * 1000 }); // over the cap: the preview loops it
    assert.equal(c.engine, 'preview');
    assert.equal(c.audio.playbackRate, 1);
    c.setRate(2); // the speed buttons are off while looping, but the clock must hold anyway
    assert.equal(c.audio.playbackRate, 1);
    await c.setLoop(null);
    assert.equal(c.audio.playbackRate, 2);
  } finally {
    globalThis.Audio = saved;
  }
});
