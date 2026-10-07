// web/static/lib/tape/clipgestures.test.js
// A clip under a finger: its zones, what's hit, and the press, hold and drag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zonesOf, hitClip, ClipGesture, HOLD_MS, SLOP_PX, HANDLE_PX, MIN_GRIPS_PX, CLICK_GRACE_MS,
} from './clipgestures.js';
import { xOf } from './geometry.js';

const ALL = ['in', 'out', 'repeat'];
const zone = (zs, name) => zs.find((z) => z.zone === name);

// A 2-second clip at tape frame 96000, on a lane 800 px wide and 100 tall,
// as page.js places it at three zooms: the whole minute, ten seconds, and
// one second around its start.
const clip = { id: 'c1', at: 96000, frames: 96000 };
const blockAt = (view, W = 800) => ({ x0: xOf(clip.at, view, W), x1: xOf(clip.at + clip.frames, view, W), top: 2, h: 96, clip });

test('zonesOf: with no grips asked for, a block is all body', () => {
  const b = { x0: 100, x1: 400, top: 2, h: 96 };
  assert.deepEqual(zonesOf(b), [{ zone: 'body', x0: 100, x1: 400 }]);
});

test('zonesOf: grips are HANDLE_PX wide at any zoom', () => {
  for (const view of [{ from: 0, to: 48000 * 6 }, { from: 0, to: 48000 * 10 }, { from: 90000, to: 138000 }]) {
    const b = blockAt(view);
    const zs = zonesOf(b, ALL);
    if (b.x1 - b.x0 < MIN_GRIPS_PX) continue;
    assert.equal(zone(zs, 'in').x1 - zone(zs, 'in').x0, HANDLE_PX, JSON.stringify(view));
    assert.equal(zone(zs, 'out').x1 - zone(zs, 'out').x0, HANDLE_PX);
    assert.equal(zone(zs, 'repeat').x1 - zone(zs, 'repeat').x0, HANDLE_PX);
    assert.equal(zone(zs, 'in').x0, b.x0);
    assert.equal(zone(zs, 'out').x1, b.x1);
  }
});

test('zonesOf: a block too narrow for its grips gets none, at any zoom out', () => {
  // A minute on 800 px: the two-second clip is ~27 px.
  const b = blockAt({ from: 0, to: 48000 * 60 });
  assert.ok(b.x1 - b.x0 < MIN_GRIPS_PX);
  assert.deepEqual(zonesOf(b, ALL).map((z) => z.zone), ['body']);
  // Just wide enough: grips, and a body of HANDLE_PX between them.
  const w = { x0: 0, x1: MIN_GRIPS_PX, top: 0, h: 60 };
  assert.deepEqual(zonesOf(w, ALL).map((z) => z.zone), ['repeat', 'in', 'out', 'body']);
});

test('zonesOf: the corner is the top of the right edge, no more than half the block', () => {
  const zs = zonesOf({ x0: 0, x1: 300, top: 2, h: 30 }, ['repeat']);
  const r = zone(zs, 'repeat');
  assert.deepEqual([r.x0, r.x1, r.y0, r.y1], [276, 300, 2, 17]);
  const tall = zone(zonesOf({ x0: 0, x1: 300, top: 2, h: 96 }, ['repeat']), 'repeat');
  assert.equal(tall.y1 - tall.y0, HANDLE_PX);
});

test('hitClip: nothing on an empty stretch', () => {
  const blocks = [{ x0: 100, x1: 200, top: 2, h: 96, clip: { id: 'a' } }];
  assert.equal(hitClip(blocks, 50, 50), null);
  assert.equal(hitClip(blocks, 201, 50), null);
  assert.equal(hitClip([], 50, 50), null);
  assert.equal(hitClip(undefined, 50, 50), null);
});

test('hitClip: where blocks overlap, the one drawn last (the layer on top) is hit', () => {
  const base = { x0: 0, x1: 400, top: 2, h: 96, clip: { id: 'base' } };
  const over = { x0: 100, x1: 200, top: 5, h: 93, clip: { id: 'over' } };
  assert.equal(hitClip([base, over], 150, 50).clip.id, 'over');
  assert.equal(hitClip([base, over], 300, 50).clip.id, 'base');
  // Two clips end to end share a pixel: the later one has it, as before.
  const next = { x0: 400, x1: 500, top: 2, h: 96, clip: { id: 'next' } };
  assert.equal(hitClip([base, next], 400, 50).clip.id, 'next');
});

test('hitClip: any height in the lane hits the block, as before', () => {
  const b = { x0: 100, x1: 300, top: 8, h: 80, clip: { id: 'a' } };
  assert.equal(hitClip([b], 150, 0).zone, 'body');
  assert.equal(hitClip([b], 150, 99).zone, 'body');
});

test('hitClip: the grips a clip offers, and only those', () => {
  const b = { x0: 100, x1: 400, top: 2, h: 96, clip: { id: 'a' } };
  const none = () => [];
  const edges = (c) => (c.id === 'a' ? ['in', 'out'] : []);
  const all = () => ALL;
  assert.equal(hitClip([b], 105, 50, none).zone, 'body');
  assert.equal(hitClip([b], 105, 50, edges).zone, 'in');
  assert.equal(hitClip([b], 395, 50, edges).zone, 'out');
  assert.equal(hitClip([b], 250, 50, edges).zone, 'body');
  // The corner is above the out grip; below it, the edge.
  assert.equal(hitClip([b], 395, 10, all).zone, 'repeat');
  assert.equal(hitClip([b], 395, 60, all).zone, 'out');
});

// --- the gestures -------------------------------------------------------------

const clock = () => { let t = 1000; const now = () => t; now.add = (ms) => { t += ms; }; return now; };
const bodyHit = { clip: { id: 'a', at: 0 }, zone: 'body' };
const P = (x, y = 50, id = 1) => ({ id, x, y });

test('a press and lift is a tap: no slide, and the click is the tap', () => {
  const now = clock();
  const g = new ClipGesture({ now });
  assert.deepEqual(g.down(P(100), bodyHit), { type: 'press', hold: HOLD_MS });
  assert.equal(g.move(P(103, 52)), null); // a wobble inside the slop
  assert.deepEqual(g.up(P(103)), { type: 'release' });
  assert.equal(g.dragging, false);
  assert.equal(g.clickIsTap(), true);
});

test('a drag before the hold is a swipe: the clip lets go and the lanes pan', () => {
  const g = new ClipGesture({ now: clock() });
  g.down(P(100), bodyHit);
  assert.deepEqual(g.move(P(100 + SLOP_PX + 1)), { type: 'swipe' });
  assert.equal(g.hold(), null, 'the hold comes too late');
  assert.equal(g.move(P(200)), null);
  assert.equal(g.up(P(200)), null);
  assert.equal(g.clickIsTap(), true);
});

test('hold, then drag, slides; the click after it is not a tap', () => {
  const now = clock();
  const g = new ClipGesture({ now });
  g.down(P(100), bodyHit);
  assert.deepEqual(g.hold(), { type: 'slideStart', clip: bodyHit.clip, id: 1 });
  assert.equal(g.held, true);
  assert.equal(g.dragging, true);
  assert.equal(g.move(P(104)), null, 'inside the slop nothing moves yet');
  assert.deepEqual(g.move(P(100 + SLOP_PX + 2)), { type: 'slide', clip: bodyHit.clip, dx: SLOP_PX + 2 });
  // Once moved, it follows back inside the slop too.
  assert.deepEqual(g.move(P(102)), { type: 'slide', clip: bodyHit.clip, dx: 2 });
  assert.deepEqual(g.move(P(160)), { type: 'slide', clip: bodyHit.clip, dx: 60 });
  assert.deepEqual(g.up(P(160)), { type: 'slideEnd', clip: bodyHit.clip, dx: 60, commit: true });
  assert.equal(g.dragging, false);
  assert.equal(g.clickIsTap(), false, 'the click that ends a slide');
  assert.equal(g.clickIsTap(), true, 'the next one is a tap');
});

test('the click grace runs out', () => {
  const now = clock();
  const g = new ClipGesture({ now });
  g.down(P(100), bodyHit); g.hold(); g.move(P(150)); g.up(P(150));
  now.add(CLICK_GRACE_MS + 1);
  assert.equal(g.clickIsTap(), true);
});

test('a hold that never moved commits nothing, and its click opens the sheet', () => {
  const g = new ClipGesture({ now: clock() });
  g.down(P(100), bodyHit);
  g.hold();
  assert.deepEqual(g.up(P(103)), { type: 'slideEnd', clip: bodyHit.clip, dx: 3, commit: false });
  assert.equal(g.clickIsTap(), true);
});

test('a cancelled or lost pointer rolls a slide back', () => {
  for (const how of ['cancel', 'lost']) {
    const g = new ClipGesture({ now: clock() });
    g.down(P(100), bodyHit); g.hold(); g.move(P(150));
    assert.deepEqual(g[how](P(150)), { type: 'slideEnd', clip: bodyHit.clip, dx: 50, commit: false }, how);
    assert.equal(g.dragging, false);
  }
});

test('a lost capture before the hold leaves the press alone', () => {
  const g = new ClipGesture({ now: clock() });
  g.down(P(100), bodyHit);
  assert.equal(g.lost(P(100)), null);
  assert.deepEqual(g.hold(), { type: 'slideStart', clip: bodyHit.clip, id: 1 });
});

test('one pointer at a time, followed by its id', () => {
  const g = new ClipGesture({ now: clock() });
  g.down(P(100, 50, 1), bodyHit);
  assert.equal(g.down(P(300, 50, 2), bodyHit), null, 'a second finger is not the clip’s');
  g.hold();
  assert.equal(g.move(P(400, 50, 2)), null);
  assert.equal(g.up(P(400, 50, 2)), null);
  assert.equal(g.dragging, true, 'the first is still sliding');
  assert.deepEqual(g.move(P(130, 50, 1)), { type: 'slide', clip: bodyHit.clip, dx: 30 });
});

test('nothing under the press: not the clip’s', () => {
  const g = new ClipGesture({ now: clock() });
  assert.equal(g.down(P(100), null), null);
  assert.equal(g.hold(), null);
  assert.equal(g.move(P(200)), null);
});

test('a grip drags as soon as it moves, with no hold', () => {
  const g = new ClipGesture({ now: clock() });
  const hit = { clip: { id: 'a' }, zone: 'out' };
  assert.deepEqual(g.down(P(100), hit), { type: 'grip', zone: 'out', clip: hit.clip });
  assert.equal(g.dragging, false, 'not until it moves');
  assert.equal(g.move(P(104)), null);
  assert.deepEqual(g.move(P(90, 55)), { type: 'gripMove', zone: 'out', clip: hit.clip, dx: -10, dy: 5 });
  assert.equal(g.dragging, true);
  assert.equal(g.hold(), null, 'a hold is the body’s');
  assert.deepEqual(g.up(P(80)), { type: 'gripEnd', zone: 'out', clip: hit.clip, dx: -20, commit: true });
  assert.equal(g.clickIsTap(), false);
});

test('a grip pressed and let go is a tap on the clip', () => {
  const g = new ClipGesture({ now: clock() });
  g.down(P(100), { clip: { id: 'a' }, zone: 'in' });
  assert.deepEqual(g.up(P(102)), { type: 'release' });
  assert.equal(g.clickIsTap(), true);
});

test('a grip cancelled mid-drag commits nothing', () => {
  const g = new ClipGesture({ now: clock() });
  const hit = { clip: { id: 'a' }, zone: 'repeat' };
  g.down(P(100), hit); g.move(P(150));
  assert.deepEqual(g.cancel(P(150)), { type: 'gripEnd', zone: 'repeat', clip: hit.clip, dx: 50, commit: false });
});
