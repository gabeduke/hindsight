// The bar with the rooms on (docs/superpowers/plans/2026-10-15-f5b.md): the
// real pageBar and NowPlaying on takes.html's own markup, on a stand-in
// document. A take in the bar shows its name (a tap opens it) and ✎; the strip
// seeks; ⟲ is Repeat; and with the rooms off the bar is exactly what it was.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { barPage, aTake } from './bar-harness.js';
import { FRAME_KEY, pageCarry } from './carry.js';
import { tipFor } from '../help/tips.js';

const SR = 48000;
// The ids in the bar: what the markup has, and nothing the script adds.
const ids = (doc) => doc.getElementById('np').descendants().map((e) => e.id).filter(Boolean).sort();

async function withTake(opts = {}, take = aTake('jam_2026-10-15_204500.wav', { seconds: 120 })) {
  const p = await barPage(opts);
  p.bar.loadTake(take.t, take.player);
  p.frames();
  return { ...p, ...take };
}

test('rooms on: a take in the bar shows its name, which opens it, and ✎', async () => {
  const p = await withTake();
  const name = p.$('np-name'), note = p.$('np-note');
  assert.ok(name && note, 'the name and ✎ are in the bar');
  assert.equal(name.hidden, false);
  assert.equal(note.hidden, false);
  assert.equal(name.tagName, 'A', 'the name is a link: a tap, a middle-click and the keyboard all open it');
  assert.equal(name.getAttribute('href'), '/wave.html?file=jam_2026-10-15_204500.wav');
  assert.equal(name.textContent, '2026-10-15_204500');
  assert.match(name.getAttribute('aria-label'), /^Open 2026-10-15_204500\b/);
  assert.equal(note.tagName, 'BUTTON');
  assert.equal(note.getAttribute('type'), 'button');
  assert.ok(p.$('np').classList.contains('np-take'), 'the bar says it holds a take: every rule of the strip, name and ✎ hangs on it');
});

test('rooms on: a take with a label shows the label', async () => {
  const p = await withTake({}, aTake('jam_x.wav', { label: 'Blue bridge' }));
  assert.equal(p.$('np-name').textContent, 'Blue bridge');
});

test('rooms on: ✎ names the frame it will take, as m:ss, and follows the playhead', async () => {
  const p = await withTake();
  assert.equal(p.$('np-note').getAttribute('aria-label'), 'Note at 0:00');
  p.audio.currentTime = 83.4;
  p.audio.emit('seeked');
  p.frames();
  assert.equal(p.$('np-note').getAttribute('aria-label'), 'Note at 1:23');
});

test('rooms on: with nothing in the bar there is no name and no ✎, and ejecting the take takes them away', async () => {
  const p = await barPage();
  assert.equal(p.$('np-name').hidden, true);
  assert.equal(p.$('np-note').hidden, true);
  const t = aTake();
  p.bar.loadTake(t.t, t.player);
  p.frames();
  assert.equal(p.$('np-note').hidden, false);
  p.bar.backToTape();
  p.frames();
  assert.equal(p.$('np-name').hidden, true);
  assert.equal(p.$('np-note').hidden, true);
  assert.equal(p.$('np').classList.contains('np-take'), false);
});

test('rooms on: ✎ takes the frame it is held at, keeps it for the next page, and opens the take', async () => {
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

test('rooms on: ✎ on a take that has ended keeps its last frame, not one past it', async () => {
  const p = await withTake();
  p.audio.currentTime = 100000; // past the end: the bar counts it at the take's length
  p.click(p.$('np-note'));
  const kept = JSON.parse(p.w.session.getItem(FRAME_KEY));
  assert.equal(kept.frame, 120 * SR - 1, 'the last frame of a two-minute take');
});

test('rooms on: the frame ✎ kept is used once, and not after two minutes', async () => {
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

test('rooms on: ✎ with the take gone from the bar does nothing', async () => {
  const p = await withTake();
  p.bar.backToTape();
  p.click(p.$('np-note'));
  assert.deepEqual(p.w.navigated, []);
  assert.equal(p.w.session.getItem(FRAME_KEY), null);
});

test('the strip: a tap moves the playhead there, a drag scrubs it and lets go where it ends', async () => {
  for (const rooms of [true, false]) {
    const p = await withTake({ rooms });
    const sc = p.$('np-scrub');
    p.pointer('pointerdown', sc, 160); // half way along a 300 px strip that starts at 10
    assert.equal(p.audio.currentTime, 60, 'a tap');
    p.pointer('pointermove', sc, 235);
    assert.equal(p.audio.currentTime, 90, 'a drag');
    p.pointer('pointerup', sc, 310);
    assert.ok(p.audio.currentTime > 119.9, 'let go at the end');
  }
});

test('⟲ is Repeat for a take with the rooms on, and Loop with them off', async () => {
  const on = await withTake();
  assert.equal(on.$('np-loop').textContent, '⟲ Repeat');
  assert.equal(on.$('np-loop').dataset.tip, 'np-repeat');
  on.click(on.$('np-loop'));
  on.frames();
  assert.equal(on.$('np-loop').getAttribute('aria-pressed'), 'true', 'it still repeats the take');
  assert.equal(on.audio.loop, true);
  const off = await withTake({ rooms: false });
  assert.equal(off.$('np-loop').textContent, '⟲ Loop');
  assert.equal(off.$('np-loop').dataset.tip, 'np-loop');
});

test('flag off: the bar has no name, no ✎ and no class of its own, with a take in it', async () => {
  const fresh = await barPage({ rooms: false });
  const before = ids(fresh.doc);
  const p = await withTake({ rooms: false });
  p.frames();
  assert.deepEqual(ids(p.doc), before, 'the same elements as the markup has');
  assert.equal(p.$('np-name'), null);
  assert.equal(p.$('np-note'), null);
  assert.equal(p.$('np').classList.contains('np-take'), false);
  assert.equal(p.w.session.getItem(FRAME_KEY), null, 'nothing is written');
});

test('everything the bar adds has a tip, and says its tip by the same name', async () => {
  const p = await withTake();
  for (const [id, tip] of [['np-name', 'np-name'], ['np-note', 'np-note'], ['np-loop', 'np-repeat']]) {
    assert.equal(p.$(id).dataset.tip, tip);
    assert.ok(tipFor(tip), `${tip} has a tip`);
  }
});
