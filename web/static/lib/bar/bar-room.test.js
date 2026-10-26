// The bar in the two rooms (docs/superpowers/plans/2026-10-15-f5b.md): the
// real pageBar and NowPlaying on takes.html's own markup, on a stand-in
// document. A take in the bar shows its name (a tap opens it) and ✎; the strip
// seeks; ⟲ is Repeat.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { barPage, aTake } from './bar-harness.js';
import { FRAME_KEY, pageCarry } from './carry.js';
import { tipFor } from '../help/tips.js';
import { iconOf } from '../ui/icons.js';

const SR = 48000;

async function withTake(opts = {}, take = aTake('jam_2026-10-15_204500.wav', { seconds: 120 })) {
  const p = await barPage(opts);
  p.bar.loadTake(take.t, take.player);
  p.frames();
  return { ...p, ...take };
}

test('a take in the bar has Open ›, to its page, and ✎, at the bar’s end', async () => {
  const p = await withTake();
  const open = p.$('np-open'), note = p.$('np-note');
  assert.equal(p.$('np').dataset.source, 'take', 'the bar says it holds a take: the stylesheet shows Open › and ✎ by it');
  assert.equal(open.tagName, 'A', 'Open › is a link: a tap, a middle-click and the keyboard all open it');
  assert.equal(open.getAttribute('href'), '/wave.html?file=jam_2026-10-15_204500.wav');
  assert.match(open.getAttribute('aria-label'), /^Open 20:45:00\b/);
  // Called as its spine calls it (lib/rooms/takename.js), never by its file's date stamp.
  assert.equal(note.tagName, 'BUTTON');
  assert.equal(note.getAttribute('type'), 'button');
  for (const k of [open, note]) assert.equal(k.parent.getAttribute('data-slot'), 'end');
  assert.ok(open.getAttribute('data-for').split(' ').includes('take'));
  assert.ok(note.getAttribute('data-for').split(' ').includes('take'));
});

test('the display names the take, by its label when it has one', async () => {
  const p = await withTake({}, aTake('jam_x.wav', { label: 'Blue bridge' }));
  assert.equal(p.$('np-source-short').textContent, 'Blue bridge');
  assert.equal(p.$('np-source-long').textContent, 'TAKE · Blue bridge');
  assert.match(p.$('np-source').getAttribute('aria-label'), /Blue bridge/);
});

test('✎ names the frame it will take, as m:ss, and follows the playhead', async () => {
  const p = await withTake();
  assert.equal(p.$('np-note').getAttribute('aria-label'), 'A note at 0:00');
  p.audio.currentTime = 83.4;
  p.audio.emit('seeked');
  p.frames();
  assert.equal(p.$('np-note').getAttribute('aria-label'), 'A note at 1:23');
});

test('ejecting the take puts the bar back to the tape, where Open › and ✎ are not for it', async () => {
  const p = await barPage();
  const t = aTake();
  p.bar.loadTake(t.t, t.player);
  p.frames();
  assert.equal(p.$('np').dataset.source, 'take');
  p.bar.backToTape();
  p.frames();
  assert.notEqual(p.$('np').dataset.source, 'take');
});

test('✎ takes the frame it is held at, keeps it for the next page, and opens the take', async () => {
  const p = await withTake();
  p.audio.currentTime = 83.4;
  p.audio.paused = false;
  // The page changes the moment it is told to, and the take moves on in the
  // gap: the frame is the one at the tap.
  p.w.onNavigate = () => { p.audio.currentTime += 5; };
  p.click(p.$('np-note'));
  assert.deepEqual(p.w.navigated, ['/wave.html?file=jam_2026-10-15_204500.wav']);
  const kept = JSON.parse(p.w.session.getItem(FRAME_KEY));
  assert.equal(kept.take, 'jam_2026-10-15_204500.wav');
  assert.equal(kept.frame, Math.round(83.4 * SR), 'the frame at the tap, not at the page change');
  assert.equal(kept.sr, SR);
});

test('✎ on a take that has ended keeps its last frame, not one past it', async () => {
  const p = await withTake();
  p.audio.currentTime = 100000; // past the end: the bar counts it at the take's length
  p.click(p.$('np-note'));
  const kept = JSON.parse(p.w.session.getItem(FRAME_KEY));
  assert.equal(kept.frame, 120 * SR - 1, 'the last frame of a two-minute take');
});

test('the frame ✎ kept is used once, and not after two minutes', async () => {
  const p = await withTake();
  p.audio.currentTime = 12;
  p.click(p.$('np-note'));
  let carry = pageCarry();
  assert.equal(carry.takeStashedFrame('jam_other.wav'), null, 'another take\'s page does not take it');
  const got = carry.takeStashedFrame('jam_2026-10-15_204500.wav');
  assert.equal(got.frame, 12 * SR);
  assert.equal(carry.takeStashedFrame('jam_2026-10-15_204500.wav'), null, 'once');
  // A frame nobody picked up (until F6 the take page does not) goes stale.
  p.click(p.$('np-note'));
  const real = Date.now;
  mock.method(Date, 'now', () => real() + 2 * 60 * 1000 + 1000);
  carry = pageCarry();
  assert.equal(carry.takeStashedFrame('jam_2026-10-15_204500.wav'), null, 'two minutes later it is nobody\'s');
  mock.restoreAll();
});

test('✎ with the take gone from the bar does nothing', async () => {
  const p = await withTake();
  p.bar.backToTape();
  p.click(p.$('np-note'));
  assert.deepEqual(p.w.navigated, []);
  assert.equal(p.w.session.getItem(FRAME_KEY), null);
});

test('the strip: a tap moves the playhead there, a drag scrubs it and lets go where it ends', async () => {
  const p = await withTake();
  const sc = p.$('np-scrub');
  p.pointer('pointerdown', sc, 160); // half way along a 300 px strip that starts at 10
  assert.equal(p.audio.currentTime, 60, 'a tap');
  p.pointer('pointermove', sc, 235);
  assert.equal(p.audio.currentTime, 90, 'a drag');
  p.pointer('pointerup', sc, 310);
  assert.ok(p.audio.currentTime > 119.9, 'let go at the end');
});

test('▶ draws ❚❚ while a take plays, and the key says it is playing whatever it draws', async () => {
  const p = await withTake();
  const play = p.$('np-play');
  assert.equal(iconOf(play), 'play');
  assert.equal(play.classList.contains('playing'), false);
  assert.equal(play.textContent, '', 'drawn, not a glyph in some fallback font');
  p.click(play);
  await new Promise((r) => setTimeout(r, 0));
  p.frames();
  assert.equal(iconOf(play), 'pause');
  assert.equal(play.getAttribute('aria-label'), 'Pause');
  assert.ok(play.classList.contains('playing'), 'the state the flows and the stylesheet read');
  p.click(play);
  await new Promise((r) => setTimeout(r, 0));
  p.frames();
  assert.equal(iconOf(play), 'play');
  assert.equal(play.classList.contains('playing'), false);
});

test('⟲ is Repeat for a take', async () => {
  const on = await withTake();
  assert.equal(on.$('np-loop').textContent, 'Repeat');
  assert.equal(iconOf(on.$('np-loop')), 'repeat', 'the word changes; ⟲ beside it stays');
  assert.equal(on.$('np-loop').dataset.tip, 'np-repeat');
  on.click(on.$('np-loop'));
  on.frames();
  assert.equal(on.$('np-loop').getAttribute('aria-pressed'), 'true', 'it still repeats the take');
  assert.equal(on.audio.loop, true);
});

test('everything the bar shows for a take has a tip, and says its tip by the same name', async () => {
  const p = await withTake();
  for (const [id, tip] of [['np-open', 'np-open'], ['np-note', 'np-note'], ['np-loop', 'np-repeat'], ['np-source', 'np-source'], ['np-output', 'np-output']]) {
    assert.equal(p.$(id).dataset.tip, tip);
    assert.ok(tipFor(tip), `${tip} has a tip`);
  }
});

test('a frame of the bar playing measures nothing and reads no style: the strip is drawn at the size and in the colours it kept', async () => {
  // Every frame something plays, the bar writes its counter and then draws
  // its strip; a measure or a style read after that write is a forced
  // layout, a frame. The strip's size comes from its ResizeObserver, its
  // colours from a cache cleared when the scheme flips (lib/bar/bar.js).
  const p = await withTake();
  await p.player.toggle();
  p.frames(3);
  const scrub = p.$('np-scrub');
  let measured = 0, styled = 0;
  const gbcr = scrub.getBoundingClientRect;
  scrub.getBoundingClientRect = () => { measured++; return gbcr(); };
  const gcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (...a) => { styled++; return gcs(...a); };
  try {
    const shown = [];
    for (let s = 1; s <= 5; s++) {
      p.audio.currentTime = s * 7;
      p.frames(1);
      shown.push(p.$('position').textContent);
    }
    assert.equal(new Set(shown).size, 5, `the bar drew each frame: ${shown}`);
    assert.equal(measured, 0, 'no measure in a frame');
    assert.equal(styled, 0, 'no style read in a frame');
  } finally {
    globalThis.getComputedStyle = gcs;
  }
});
