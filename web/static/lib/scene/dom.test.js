import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../objects/motion.js';
import { Scene } from './scene.js';
import { SceneObject } from './object.js';
import { DomRenderer } from './dom.js';
import { isRenderer, RENDERER_METHODS } from './renderer.js';

function fakeTicker() {
  let t = 0;
  const queue = [];
  const ticker = new Ticker({ now: () => t, raf: (fn) => queue.push(fn), cancel: () => { queue.length = 0; }, reduced: false });
  ticker.advance = (ms = 16) => { t += ms; for (const fn of queue.splice(0)) fn(t); };
  return ticker;
}

/** A drawer that remembers what it was asked to draw, over a box at `rect`. */
function drawer(rect) {
  const d = {
    draws: [],
    draw(view, state) { d.draws.push({ view, state }); },
    el: rect && { getBoundingClientRect: () => rect },
    destroyed: false,
    destroy() { d.destroyed = true; },
  };
  return d;
}

function setup() {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const r = new DomRenderer();
  r.mount({}, scene);
  scene.start();
  return { ticker, scene, r };
}

test('it is a renderer', () => {
  assert.deepEqual(RENDERER_METHODS, ['mount', 'frame', 'hit', 'twin', 'destroy']);
  assert.ok(isRenderer(new DomRenderer()));
  assert.ok(!isRenderer({ mount() {}, frame() {} }));
});

test('a part is drawn once, then only when its view or state changes', () => {
  const { ticker, scene, r } = setup();
  const o = scene.add(new SceneObject('c', 'cassette', { played: 0.2 }));
  const d = drawer();
  r.part('c', d);
  ticker.advance();
  assert.equal(d.draws.length, 1);
  assert.equal(d.draws[0].view.played, 0.2);
  ticker.advance();
  assert.equal(d.draws.length, 1, 'nothing new, nothing drawn');
  o.set({ played: 0.6 });
  ticker.advance();
  assert.equal(d.draws.length, 2);
  assert.equal(d.draws[1].view.played, 0.6);
  assert.equal(d.draws[1].state, o.state, 'and it is handed the state, to read');
});

test('a moving needle is drawn every frame until it parks, then the ticker stops', () => {
  const { ticker, scene, r } = setup();
  const o = scene.add(new SceneObject('vu:0', 'vu'));
  const d = drawer();
  r.part('vu:0', d);
  o.set({ level: -10 });
  let frames = 0;
  while (ticker.running && frames < 1000) { ticker.advance(); frames++; }
  assert.equal(d.draws.length, frames, 'once a frame while it moved');
  assert.equal(d.draws.at(-1).view.angle, o.view.angle);
  assert.ok(!ticker.running);
});

test('invalidate redraws with the same view: for a resize, a font, the scheme', () => {
  const { ticker, scene, r } = setup();
  scene.add(new SceneObject('c', 'cassette'));
  const a = drawer(), b = drawer();
  r.part('c', a);
  ticker.advance();
  r.invalidate('c');
  assert.ok(ticker.running, 'it asks for a frame');
  ticker.advance();
  assert.equal(a.draws.length, 2);
  assert.equal(a.draws[0].view, a.draws[1].view);
  scene.add(new SceneObject('d', 'cassette'));
  r.part('d', b);
  ticker.advance();
  r.invalidate();
  ticker.advance();
  assert.equal(a.draws.length, 3);
  assert.equal(b.draws.length, 2);
});

test('a drawer that writes state is refused, and the frame goes on', () => {
  const ticker = fakeTicker();
  const errors = [];
  const scene = new Scene({ ticker, onError: (e) => errors.push(e) });
  const r = new DomRenderer();
  r.mount({}, scene);
  scene.start();
  const o = scene.add(new SceneObject('c', 'cassette', { played: 0.1 }));
  r.part('c', { draw: () => o.set({ played: 1 }) });
  ticker.advance();
  assert.equal(errors.length, 1);
  assert.equal(o.state.played, 0.1);
});

test('hit finds the object under a point, the last drawn on top', () => {
  const { scene, r } = setup();
  scene.add(new SceneObject('a', 'cassette'));
  scene.add(new SceneObject('b', 'cassette'));
  r.part('a', drawer({ left: 0, top: 0, right: 100, bottom: 50 }));
  r.part('b', drawer({ left: 50, top: 0, right: 150, bottom: 50 }));
  assert.equal(r.hit(10, 10), 'a');
  assert.equal(r.hit(60, 10), 'b');
  assert.equal(r.hit(10, 60), null);
  r.part('c', drawer()); // no element: never hit
  assert.equal(r.hit(10, 10), 'a');
});

test('twin is the object\'s own control, and null where its markup is the control', () => {
  const { scene, r } = setup();
  scene.add(new SceneObject('a', 'cassette'));
  const button = { tagName: 'BUTTON' };
  r.part('a', { draw() {}, twin: () => button });
  r.part('b', drawer());
  assert.equal(r.twin('a'), button);
  assert.equal(r.twin('b'), null);
  assert.equal(r.twin('nobody'), null);
});

test('destroy leaves the scene and takes every part down', () => {
  const { ticker, scene, r } = setup();
  const o = scene.add(new SceneObject('a', 'cassette'));
  const d = drawer();
  r.part('a', d);
  ticker.advance();
  r.destroy();
  assert.ok(d.destroyed);
  o.set({ played: 1 });
  ticker.advance();
  assert.equal(d.draws.length, 1, 'not drawn after destroy');
  assert.equal(scene.renderers.size, 0);
});
