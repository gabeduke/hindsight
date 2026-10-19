// The engine (lib/bar/engine.js): the bar's audio and its sources -- the tape,
// its player on this device, the feed, a take -- lifted out of the page so
// the shell can make it once and hand it to each room
// (docs/architecture.md, The shell, step 1). Run on the real
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

test('a tape made after the engine was (a Pi'+"'"+'s first) is mounted by setTapes, so the Studio has a tape to drive', async () => {
  const { engine } = await open({ tape: false });
  assert.equal(engine.tape, null);
  engine.setTapes({ loaded: 't1' });
  assert.equal(engine.tape.kind, 'tape');
  assert.equal(typeof engine.tape.delegate, 'function');
  const held = engine.tape;
  engine.setTapes({ loaded: 't1' });
  assert.equal(engine.tape, held, 'asking again keeps the tape it has');
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

// A room in the shell listens to the engine's sources while it is shown, and
// has to stop when it is done with them (the shell plan, §1: "What gets in
// the way").
test('a source subscription can be removed', async () => {
  const { engine, bar } = await open();
  const heard = { tape: 0, take: 0, feed: 0, kept: 0 };
  const tape = engine.tape;
  tape.on(() => heard.kept++); // someone else's, which stays
  const offTape = tape.on(() => heard.tape++);
  assert.equal(typeof offTape, 'function', 'the tape’s on() answers an off');
  tape.changed();
  assert.deepEqual([heard.tape, heard.kept], [1, 1]);
  offTape();
  tape.changed();
  assert.deepEqual([heard.tape, heard.kept], [1, 2], 'let go, it hears no more; the others still do');

  const take = aTake();
  bar.loadTake(take.t, take.player);
  const offTake = engine.np.src.on(() => heard.take++);
  assert.equal(typeof offTake, 'function', 'a take’s on() answers an off');
  take.audio.emit('seeked');
  assert.equal(heard.take, 1);
  offTake();
  take.audio.emit('seeked');
  assert.equal(heard.take, 1);

  bar.setSource('feed');
  const offFeed = engine.feed.on(() => heard.feed++);
  assert.equal(typeof offFeed, 'function', 'the feed’s on() answers an off');
  engine.feed.seek(0);
  assert.equal(heard.feed, 1);
  offFeed();
  engine.feed.seek(0);
  assert.equal(heard.feed, 1);
  bar.setSource('tape');
});

// The shell's CSS and its smoke check key on what the bar holds (the shell
// plan's amendments; spikes D and E).
test('#np[data-source] says what the bar holds, and keeps in step with it', async () => {
  const { bar, $, click } = await open();
  const np = $('np');
  assert.equal(np.dataset.source, 'tape');
  const take = aTake();
  bar.loadTake(take.t, take.player);
  assert.equal(np.dataset.source, 'take');
  click(np.querySelector('button[data-source="feed"]')); // the bar's own Feed key
  assert.equal(np.dataset.source, 'feed');
  bar.setSource('take');
  assert.equal(np.dataset.source, 'take', 'the take, still in the bar');
  click($('np-eject'));
  assert.equal(np.dataset.source, 'tape');
});

test('#np[data-source] goes when the bar empties', async () => {
  const { bar, $ } = await open({ tape: false });
  const np = $('np');
  assert.equal(np.getAttribute('data-source'), null, 'nothing in the bar yet');
  const take = aTake();
  bar.loadTake(take.t, take.player);
  assert.equal(np.dataset.source, 'take');
  bar.backToTape(); // with no tape there is nothing to go back to
  assert.equal(np.hidden, true);
  assert.equal(np.getAttribute('data-source'), null);
});

// Step 2: the engine owns the take in the bar's audio, so a shelf row destroyed
// while its take plays in the bar leaves it playing, and a rebuilt row reuses
// the same element; loadTakeByName loads a take without a TakesList.
test('a shelf row destroyed while its take is in the bar leaves it playing, and a rebuilt row shares the same audio', async () => {
  const { RowWave } = await import('../wave/rowwave.js');
  const { engine, bar, doc, click, $ } = await open();
  assert.ok(engine.audio, 'the engine exposes its audio ownership API');
  const take = aTake('jam_x.wav');
  // Ask the engine for the take's audio as a shelf row does.
  const audio = engine.audio.audioFor(take.t);
  assert.equal(engine.audio.owns(audio), false, 'not adopted until it is in the bar');
  const box1 = doc.createElement('div');
  const ws1 = new RowWave({ container: box1, peaks: take.player.peaks, duration: 120, audio, look: 'spine' });
  const player1 = { audio, peaks: take.player.peaks, toggle: () => ws1.playPause() };
  bar.loadTake(take.t, player1);
  assert.equal(engine.audio.owns(audio), true, 'adopted while in the bar');
  await ws1.playPause();
  assert.equal(audio.paused, false);
  assert.equal(bar.playing(), true);

  // Filter the take off the shelf: its row is destroyed.
  ws1.destroy();
  assert.equal(audio.paused, false, 'the take keeps playing in the bar');
  assert.equal(bar.sourceKind, 'take');
  assert.equal(bar.takeName, 'jam_x.wav');
  assert.equal(bar.playing(), true);

  // Even after the row is gone, the bar's ▶/❚❚ still pauses and plays it.
  click($('np-play'));
  assert.equal(audio.paused, true);
  click($('np-play'));
  assert.equal(audio.paused, false);

  // A second shelf (or the row rebuilt) asks audioFor and gets the same element.
  assert.equal(engine.audio.audioFor(take.t), audio);

  // Once the bar lets the take go (⏏), a row destroying it does empty it.
  bar.backToTape();
  assert.equal(engine.audio.owns(audio), false, 'released when the bar leaves the take');
  const box2 = doc.createElement('div');
  const ws2 = new RowWave({ container: box2, peaks: take.player.peaks, duration: 120, audio, look: 'spine' });
  ws2.destroy();
  assert.equal(audio.getAttribute('src'), null);
});

test('loadTakeByName loads and plays a take from the Pi without a TakesList', async () => {
  const jams = [
    { name: 'jam_solo.wav', label: 'Solo', preview_name: 'jam_solo.mp3', has_preview: true, has_peaks: true, sample_rate: SR, duration_seconds: 30, bpm: 120, trim: null },
  ];
  const peaks = { buckets: 4, channels: 2, duration: 30, data: [new Float32Array(8), new Float32Array(8)] };
  page = await barPage({
    engine: true,
    tapes: { loaded: 't1' },
    answer: (url) => {
      if (url === '/api/jams') return jams;
      if (url === '/api/peaks?file=jam_solo.wav') return peaks;
      return pi(url);
    },
  });
  page.frames();
  const { engine, bar, $, click } = page;
  assert.equal(typeof bar.loadTakeByName, 'function');
  const src = await bar.loadTakeByName('jam_solo.wav');
  assert.ok(src, 'the take is loaded into the bar');
  assert.equal(bar.sourceKind, 'take');
  assert.equal(bar.takeName, 'jam_solo.wav');
  assert.equal($('np').dataset.source, 'take');
  assert.equal(engine.audio.owns(src.audio), true);
  click($('np-play'));
  assert.equal(bar.playing(), true);
  click($('np-play'));
  assert.equal(bar.playing(), false);
  assert.equal(await bar.loadTakeByName('jam_missing.wav'), null);
});

// Step 5a: the Studio feeds engine.tape with ingest/setLevels and delegates
// ▶/■, Loop and |◂ through its own transport() so stopping while recording
// toasts the kept take.
test('■ in the Studio while recording goes through the delegated transport() and toasts the kept take', async () => {
  const { engine, $, click, frames, w } = await open();
  const tape = engine.tape;
  assert.equal(typeof tape.ingest, 'function', 'tape.ingest exists');
  assert.equal(typeof tape.delegate, 'function', 'tape.delegate exists');
  assert.equal(typeof tape.setLevels, 'function', 'tape.setLevels exists');

  const calls = [];
  tape.delegate({
    play: () => calls.push(['play']),
    stop: () => {
      calls.push(['stop']);
      w.toasts.push('Kept 4 bars from aux on track 1');
    },
    locate: (pos) => calls.push(['locate', pos]),
    setLoop: (on) => calls.push(['loop', on]),
  });
  tape.setLevels(['#e05a47', '#d89b2b'], () => [-12, -18]);

  // The Studio's 200 ms poll feeds the tape state while recording bar 2.
  const recTape = { ...TAPE, loop: { in: BAR, out: 5 * BAR, on: true } };
  tape.ingest({
    tape: recTape,
    live: {
      playing: true,
      heard: BAR,
      count_in: 0,
      output: 'demo',
      output_mode: 'jam',
      record: { tape: 't1', track: 1, state: 'on', from: BAR, source: 'aux' },
    },
  });
  frames();
  assert.equal($('np-play').textContent, '■');
  assert.equal($('np-status').getAttribute('data-state'), 'rec');
  assert.equal($('position').textContent, '2.1');
  assert.equal($('np-levels').children.length, 2, 'per-track reel level bars are drawn');

  // Pressing ■ in the Studio calls the delegate's stop(), which toasts the kept take.
  click($('np-play'));
  assert.deepEqual(calls, [['stop']]);
  assert.ok(w.toasts.includes('Kept 4 bars from aux on track 1'));

  // |◂ and Loop also go through the delegate.
  click($('np-start'));
  click($('np-loop'));
  assert.deepEqual(calls, [['stop'], ['locate', BAR], ['loop', false]]);
});

// Step 5b: the engine owns the one StreamPlayer; output-ui.js renders over
// engine.output instead of constructing a second StreamPlayer of its own.
test('the engine and the output UI make one StreamPlayer', async () => {
  const { engine, doc, w } = await open();
  for (const id of ['out-strip', 'out-strip-led', 'out-strip-text', 'out-strip-right', 'out-strip-resume', 'out-jam', 'out-banner', 'out-banner-what', 'out-banner-delay']) {
    if (!doc.getElementById(id)) {
      const el = doc.createElement('div');
      el.id = id;
      doc.body.appendChild(el);
    }
  }
  const pagehideBefore = (w.windowListeners.pagehide || []).length;
  const { initOutput } = await import('../tape/output-ui.js');
  const out = initOutput({
    engine,
    toast: (m) => w.toasts.push(m),
    poll: () => {},
    transport: () => {},
    getTape: () => TAPE,
  });
  assert.equal((w.windowListeners.pagehide || []).length, pagehideBefore, 'initOutput does not construct a second StreamPlayer');
  assert.equal(out.player, engine.stream, 'output-ui shares engine.stream');
  assert.equal(engine.output.player, engine.stream, 'engine.output exposes the same StreamPlayer');
});


