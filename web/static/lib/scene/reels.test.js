import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReelsModel } from './reels.js';
import { packRadii, EASE_MS } from '../objects/reels.js';

const SR = 48000, LEN = 600 * SR;

/** play runs a playing tape at `hz` for `ms`, polled every 200 ms as the pages poll. */
function play(hz, ms) {
  const m = new ReelsModel();
  const dt = 1000 / hz;
  let t = 0, state = { pos: 10 * SR, playing: true, length: LEN, sampleRate: SR, at: 0 };
  m.step(state, 0, 0);
  for (let i = 1; i <= Math.round((ms / 1000) * hz); i++) {
    t = i * dt;
    if (Math.floor(t / 200) > Math.floor((t - dt) / 200)) {
      const at = Math.floor(t / 200) * 200;
      state = { ...state, pos: 10 * SR + (at / 1000) * SR, at };
    }
    m.step(state, dt, t);
  }
  return m.view;
}

test('nothing to show before the first poll', () => {
  const m = new ReelsModel();
  assert.equal(m.step({}, 16, 0), false);
  assert.equal(m.view, null);
});

test('a playing tape is in the same place at 20 Hz and 120 Hz', () => {
  // Where the tape is, and so the packs, is a function of time. The reels'
  // angle sums each frame's travel over a pack that changes as it goes
  // at the frame's end (ReelMotion never promised more), so after three
  // seconds of play the two agree within a tenth of a degree rather than
  // exactly: one 50 ms frame's turn is twenty-odd degrees.
  const a = play(20, 3000), b = play(120, 3000);
  assert.equal(a.pos, b.pos);
  assert.equal(a.left, b.left);
  assert.equal(a.right, b.right);
  assert.ok(Math.abs(a.angleL - b.angleL) < 0.1, `${a.angleL} vs ${b.angleL}`);
  assert.ok(Math.abs(a.angleR - b.angleR) < 0.1, `${a.angleR} vs ${b.angleR}`);
  assert.equal(a.moving, 'play');
  assert.deepEqual([a.left, a.right], Object.values(packRadii(a.pos, LEN)));
});

test('a stopped tape parks, and keeps its view', () => {
  const m = new ReelsModel();
  const s = { pos: 5 * SR, playing: false, length: LEN, sampleRate: SR, at: 0 };
  assert.equal(m.step(s, 0, 0), false);
  const v = m.view;
  assert.equal(m.step(s, 16, 16), false);
  assert.equal(m.view, v);
});

test('each poll is news, even with the same position', () => {
  // A playing tape no longer polled stops after two seconds; one polled
  // with the same values keeps playing, because the Pi is still answering.
  const polled = new ReelsModel(), silent = new ReelsModel();
  const s = { pos: SR, playing: true, length: LEN, sampleRate: SR, at: 0 };
  polled.step(s, 0, 0);
  silent.step(s, 0, 0);
  for (let t = 16; t <= 3000; t += 16) {
    polled.step({ ...s, at: Math.floor(t / 200) * 200 }, 16, t);
    silent.step(s, 16, t);
  }
  assert.equal(polled.view.moving, 'play');
  assert.equal(silent.view.moving, 'stop');
});

test('a jump winds over EASE_MS, and with reduced motion lands at once', () => {
  const s = { pos: 0, playing: false, length: LEN, sampleRate: SR, at: 0 };
  const m = new ReelsModel();
  m.step(s, 0, 0);
  m.step({ ...s, pos: 60 * SR, at: 10 }, 16, 16);
  assert.equal(m.view.moving, 'wind');
  m.step({ ...s, pos: 60 * SR, at: 10 }, 16, 10 + EASE_MS + 1);
  assert.equal(m.view.pos, 60 * SR);

  const r = new ReelsModel();
  r.step(s, Infinity, 0);
  r.step({ ...s, pos: 60 * SR, at: 10 }, Infinity, 16);
  assert.equal(r.view.pos, 60 * SR);
  assert.equal(r.view.moving, 'stop');
  assert.equal(r.view.angleL, 0, 'and the reels did not turn');
});

test('a new sample rate starts the motion again', () => {
  const m = new ReelsModel();
  m.step({ pos: SR, playing: false, length: LEN, sampleRate: SR, at: 0 }, 0, 0);
  m.step({ pos: 44100, playing: false, length: 600 * 44100, sampleRate: 44100, at: 0 }, 16, 16);
  assert.equal(m.motion.sr, 44100);
  assert.equal(m.view.pos, 44100);
});

test('two polls in the same millisecond are still two polls', () => {
  // Safari's clock counts whole milliseconds, so `at` alone can't tell them apart.
  const m = new ReelsModel();
  const first = { pos: 0, playing: false, length: LEN, sampleRate: SR, at: 5 };
  m.step(first, 0, 5);
  m.step({ ...first, pos: 0.1 * SR }, 0, 5);
  assert.equal(m.view.pos, 0.1 * SR);
});
