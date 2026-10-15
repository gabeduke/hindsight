import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../objects/motion.js';
import { Scene } from './scene.js';
import { SceneObject } from './object.js';
import { vuAngle } from './vu.js';

// A fake ticker: frames run when the test says, `ms` apart.
function fakeTicker({ reduced = false } = {}) {
  let t = 0;
  const queue = [];
  const ticker = new Ticker({ now: () => t, raf: (fn) => queue.push(fn), cancel: () => { queue.length = 0; }, reduced });
  ticker.advance = (ms = 16) => { t += ms; for (const fn of queue.splice(0)) fn(t); };
  ticker.pending = () => queue.length;
  return ticker;
}

const quiet = () => {
  const errors = [];
  return { errors, onError: (e) => errors.push(e) };
};

test('add derives a first view, and get, objects and remove do what they say', () => {
  const scene = new Scene({ ticker: fakeTicker() });
  const o = scene.add(new SceneObject('vu:0', 'vu', { level: -18 }));
  assert.equal(o.scene, scene);
  assert.ok(o.view, 'a renderer mounted next has something to draw');
  assert.equal(o.view.target, vuAngle(-18));
  assert.equal(scene.get('vu:0'), o);
  assert.deepEqual(scene.objects().map((x) => x.id), ['vu:0']);
  assert.throws(() => scene.add(new SceneObject('vu:0', 'vu')), /already/);
  assert.equal(scene.remove('vu:0'), true);
  assert.equal(scene.get('vu:0'), null);
  assert.equal(o.scene, null);
  assert.equal(scene.remove('vu:0'), false);
});

test('an object of a kind with no model is refused', () => {
  const scene = new Scene({ ticker: fakeTicker() });
  assert.throws(() => scene.add(new SceneObject('d', 'dragon')), /no model for a dragon/);
});

test('models step before renderers draw, so every renderer sees this frame', () => {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const o = scene.add(new SceneObject('vu:0', 'vu'));
  const seen = [];
  scene.attach({ frame: () => seen.push(o.view.angle) });
  scene.start();
  o.set({ level: -6 });
  ticker.advance(16);
  const after = o.view.angle;
  assert.ok(after > -48, 'the needle moved this frame');
  assert.equal(seen.at(-1), after, 'and the renderer drew where it moved to, not where it was');
});

test('the ticker parks once every model settles, and a set wakes it', () => {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const o = scene.add(new SceneObject('vu:0', 'vu'));
  scene.start();
  o.set({ level: -10 });
  let frames = 0;
  while (ticker.running && frames < 1000) { ticker.advance(16); frames++; }
  assert.ok(!ticker.running, 'parked');
  assert.ok(frames > 20 && frames < 200, `settled in ${frames} frames`);
  assert.equal(o.view.angle, vuAngle(-10), 'exactly on target');
  ticker.advance(16);
  assert.ok(!ticker.running, 'stays parked with nothing to do');

  o.set({ level: -30 });
  assert.ok(ticker.running, 'a new level wakes it');
  o.set({ level: -30 });
  ticker.advance(16);
  assert.ok(o.view.angle < vuAngle(-10));
});

test('a still scene costs nothing: no frames while nothing moves', () => {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  scene.add(new SceneObject('c', 'cassette', { played: 0.5 }));
  scene.start();
  ticker.advance(16);
  assert.ok(!ticker.running);
});

test('a renderer that writes state is stopped, and the state is untouched', () => {
  const ticker = fakeTicker();
  const q = quiet();
  const scene = new Scene({ ticker, onError: q.onError });
  const o = scene.add(new SceneObject('c', 'cassette', { played: 0.25 }));
  let other = 0;
  scene.attach({ frame: () => { o.set({ played: 0.9 }); } });
  scene.attach({ frame: () => { other++; } });
  scene.start();
  ticker.advance(16);
  assert.equal(q.errors.length, 1);
  assert.match(q.errors[0].message, /renderers read state/);
  assert.equal(o.state.played, 0.25);
  assert.equal(other, 1, 'the other renderer still drew');
  assert.equal(scene.drawing, false);
  // Outside the draw, the page may set it.
  assert.equal(o.set({ played: 0.9 }), true);
});

test('one model throwing does not stop the others', () => {
  const ticker = fakeTicker();
  const q = quiet();
  const models = {
    // Fine on its first step (add), broken after.
    bad: () => ({ view: null, n: 0, step() { if (this.n++) throw new Error('bad model'); return true; } }),
    vu: () => ({ view: 1, step() { this.view++; return true; } }),
  };
  const scene = new Scene({ ticker, models, onError: q.onError });
  scene.add(new SceneObject('ok', 'vu'));
  scene.add(new SceneObject('x', 'bad'));
  scene.start();
  ticker.advance(16);
  assert.equal(scene.get('ok').view, 3);
  assert.equal(q.errors.length, 1);
});

test('reduced motion lands every model in one frame', () => {
  const ticker = fakeTicker({ reduced: true });
  const scene = new Scene({ ticker });
  const o = scene.add(new SceneObject('vu:0', 'vu'));
  scene.start();
  o.set({ level: -6 });
  ticker.advance(16);
  assert.equal(o.view.angle, vuAngle(-6));
  ticker.advance(16);
  assert.ok(!ticker.running);
});

test('stop takes the scene off its ticker', () => {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const o = scene.add(new SceneObject('vu:0', 'vu'));
  scene.start();
  assert.ok(scene.running);
  scene.stop();
  assert.ok(!scene.running);
  o.set({ level: 0 });
  assert.ok(!ticker.running, 'a stopped scene is not woken');
  assert.equal(ticker.steps.size, 0);
});

test('a page can step a scene by hand, to land a still', () => {
  const scene = new Scene({ ticker: fakeTicker() });
  const o = scene.add(new SceneObject('vu:0', 'vu', { level: -18 }));
  let drew = 0;
  scene.attach({ frame: () => { drew++; } });
  scene.step(Infinity);
  assert.equal(o.view.angle, vuAngle(-18));
  assert.equal(drew, 1);
  assert.equal(scene.step(16), false, 'and it has arrived');
});

test('two scenes on one ticker share its one loop', () => {
  const ticker = fakeTicker();
  const a = new Scene({ ticker });
  const b = new Scene({ ticker });
  const x = a.add(new SceneObject('x', 'vu'));
  const y = b.add(new SceneObject('y', 'vu'));
  a.start();
  b.start();
  x.set({ level: -6 });
  y.set({ level: -6 });
  assert.equal(ticker.pending(), 1);
  ticker.advance(16);
  assert.equal(ticker.pending(), 1);
  assert.equal(x.view.angle, y.view.angle);
});

test('add is all or nothing: a model that throws on its first step leaves no trace', () => {
  const ticker = fakeTicker();
  const models = { bad: () => ({ view: null, step() { throw new Error('bad model'); } }) };
  const scene = new Scene({ ticker, models, onError: () => {} });
  scene.start();
  const o = new SceneObject('x', 'bad');
  assert.throws(() => scene.add(o), /bad model/);
  assert.equal(scene.get('x'), null);
  assert.equal(o.scene, null);
  assert.equal(scene.objects().length, 0);
  ticker.advance(16);
  assert.ok(!ticker.running);
  o.set({ a: 1 });
  assert.ok(!ticker.running, 'and it no longer wakes the scene');
});

test('a model that keeps failing is reported once, and rests until its state changes', () => {
  const ticker = fakeTicker();
  const errors = [];
  let badSteps = 0;
  const models = {
    bad: () => ({ view: null, n: 0, step() { badSteps++; if (this.n++) throw new Error('bad model'); return false; } }),
    vu: () => ({ view: 0, step() { this.view++; return true; } }),
  };
  const scene = new Scene({ ticker, models, onError: (e) => errors.push(e.message) });
  const bad = scene.add(new SceneObject('bad', 'bad'));
  const ok = scene.add(new SceneObject('ok', 'vu'));
  scene.start();
  for (let i = 0; i < 60; i++) ticker.advance(16);
  assert.deepEqual(errors, ['bad model'], 'once, not sixty times');
  assert.equal(badSteps, 2, 'its first step, and the one that failed: then it rests');
  assert.ok(ok.view > 60, 'the other kept moving');
  bad.set({ again: true });
  ticker.advance(16);
  assert.equal(badSteps, 3, 'new state: it is tried again');
  assert.equal(errors.length, 1, 'still the same failure, still reported once');
});

test('a renderer that keeps failing is reported once', () => {
  const ticker = fakeTicker();
  const errors = [];
  const scene = new Scene({ ticker, onError: (e) => errors.push(e.message) });
  scene.add(new SceneObject('vu:0', 'vu'));
  scene.attach({ frame: () => { throw new Error('bad renderer'); } });
  scene.attach({ frame: () => {} });
  scene.start();
  scene.get('vu:0').set({ level: -6 });
  for (let i = 0; i < 30; i++) ticker.advance(16);
  assert.deepEqual(errors, ['bad renderer']);
});
