// The engine (lib/bar/engine.js): the bar's audio and its sources -- the tape,
// its player on this device, the feed, a take -- lifted out of the page so
// the shell can make it once and hand it to each room
// (docs/superpowers/plans/2026-10-17-phase1-shell.md, step 1). Run on the real
// NowPlaying and takes.html's markup (bar-harness.js), with the Pi a stub.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { barPage, aTake } from './bar-harness.js';

const SR = 48000;
const BAR = 2.5 * SR;
const TAPE = { id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR, grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 0, out: 0, on: false }, tracks: [] };

// The Pi: tape t1 loaded and stopped at the top, out of the jam room; the
// ring full and the input healthy.
const pi = (url) => {
  if (url.startsWith('/api/tapes/state?id=t1')) return { tape: TAPE, loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo', output_mode: 'jam' } };
  if (url === '/api/tapes') return { loaded: 't1', tapes: [] };
  if (url === '/api/status') return { ring_seconds: 120, buffered_seconds: 120, capture_healthy: true, channel_rms: [-20, -20] };
  if (url === '/api/envelope') return { bins: [] };
  return undefined;
};

let page = null;
// The tape asks the Pi every half second and the feed every two: neither may
// outlive its test.
afterEach(() => {
  page?.engine?.tape?.destroy();
  page?.engine?.feed?.destroy();
  page = null;
});

async function open({ tape = true } = {}) {
  page = await barPage({ engine: true, tapes: tape ? { loaded: 't1' } : null, answer: pi });
  page.frames();
  return page;
}

test('with no tape on the Pi the engine holds nothing, and the bar waits hidden', async () => {
  const { engine, bar, $ } = await open({ tape: false });
  assert.equal(engine.tape, null);
  assert.equal(engine.stream, null);
  assert.equal(engine.feed, null, 'the feed is not made until it is chosen');
  assert.equal(engine.np.src, null);
  assert.equal(bar.sourceKind, null);
  assert.equal($('np').hidden, true);
});

test('with a tape on the Pi the bar holds it, and the engine has the tape and its player on this device', async () => {
  const { engine, bar, $, frames } = await open();
  assert.equal(engine.tape.kind, 'tape');
  assert.equal(engine.np.src, engine.tape, 'the bar NowPlaying draws is the engine’s');
  assert.equal(bar.sourceKind, 'tape');
  assert.equal(engine.stream.active, false, 'not listening here until asked');
  assert.equal($('np').hidden, false);
  frames();
  assert.equal($('np-open').textContent, 'Open Tape 1 ›');
  assert.equal($('np-open').getAttribute('href'), '/tape.html');
});

test('a take in the bar quiets the tape’s player here, and ⏏ gives the tape back', async () => {
  const { engine, bar, $, click } = await open();
  const take = aTake();
  bar.loadTake(take.t, take.player);
  assert.equal(bar.sourceKind, 'take');
  assert.equal(bar.takeName, 'jam_x.wav');
  assert.equal(engine.stream.quiet, true, 'the lock screen and a headset are the take’s');
  assert.equal($('np-eject').hidden, false, '⏏ is there while a take is in the bar and a tape is loaded');
  click($('np-eject'));
  assert.equal(bar.sourceKind, 'tape');
  assert.equal(bar.takeName, null);
  assert.equal(bar.ejected, true);
  assert.equal(engine.stream.quiet, false);
  assert.equal($('np-eject').hidden, true);
});

// The feed's continuity in the shell is its own state, so it must be one feed.
test('the feed is made the first time it is chosen, and keeps its place over a trip to the tape and back', async () => {
  const { engine, bar, $, frames } = await open();
  bar.setSource('feed');
  const feed = engine.feed;
  assert.equal(feed.kind, 'feed');
  assert.equal(bar.sourceKind, 'feed');
  assert.equal(feed.playing(), true);
  feed.seek(feed.length - 20 * SR); // scrubbed 20 s back into the ring
  assert.equal(feed.offsetSeconds, 20);
  bar.setSource('tape');
  assert.equal(bar.sourceKind, 'tape');
  assert.equal(feed.playing(), false, 'left, it stops asking the Pi');
  bar.setSource('feed');
  assert.equal(engine.feed, feed, 'the same feed');
  assert.equal(feed.offsetSeconds, 20, 'still 20 s back');
  frames();
  assert.equal($('position').textContent, '-0:20');
  bar.setSource('tape');
});
