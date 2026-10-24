import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileCss } from '../stylesheets.js';
import { Ticker } from '../objects/motion.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { isRenderer } from '../scene/renderer.js';
import { KINDS } from './kinds.js';
import { RopeRenderer, ropePath, HIT_PX } from './ropes.js';

function fakeTicker() {
  let t = 0;
  const queue = [];
  const ticker = new Ticker({ now: () => t, raf: (fn) => queue.push(fn), cancel: () => { queue.length = 0; }, reduced: false });
  ticker.advance = (ms = 16) => { t += ms; for (const fn of queue.splice(0)) fn(t); };
  return ticker;
}

// Just enough of the DOM for the renderer: it makes SVG elements, sets
// attributes and appends them. Every element remembers any listener it was
// given, so a test can say none was.
function fakeDoc() {
  const made = [];
  const el = (tag) => {
    const e = {
      tag, attrs: {}, style: {}, children: [], parent: null, listeners: 0, sets: 0,
      setAttribute(k, v) { this.attrs[k] = String(v); this.sets++; },
      getAttribute(k) { return this.attrs[k] ?? null; },
      append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } },
      replaceChildren(...c) { for (const x of this.children) x.parent = null; this.children = []; this.append(...c); },
      remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } },
      addEventListener() { this.listeners++; },
      getBoundingClientRect() { return { left: 10, top: 20, width: 800, height: 600 }; },
    };
    made.push(e);
    return e;
  };
  return { made, el, createElementNS: (ns, tag) => el(tag), querySelectorAll: () => [] };
}

function rig(cables) {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const doc = fakeDoc();
  const svg = doc.el('svg');
  const sockets = {};
  const r = new RopeRenderer({ doc, twinOf: (id) => (sockets[id] ||= { sock: id }) });
  for (const [id, s] of Object.entries(cables)) scene.add(new SceneObject(id, 'cable', s));
  r.mount(svg, scene);
  scene.start();
  ticker.advance(16);
  return { ticker, scene, doc, svg, r };
}

const rope = (svg, id) => svg.children.find((g) => g.attrs['data-cable'] === id);
const lines = (g) => g.children.filter((c) => c.tag === 'path');
const plugs = (g) => g.children.filter((c) => c.tag !== 'path');

test('it is a renderer on the scene contract', () => {
  assert.ok(isRenderer(new RopeRenderer({ doc: fakeDoc() })));
});

test('a rope’s path runs smoothly through its points, from the first to the last', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 25 }, { x: 50, y: 0 }];
  const d = ropePath(pts);
  assert.match(d, /^M0 0 L5 10 Q/);
  assert.match(d, / L50 0$/);
  assert.equal((d.match(/Q/g) || []).length, 2);
  assert.equal(ropePath([]), '');
});

test('every kind keeps P6’s width and dash, so kinds are told apart without colour', () => {
  const cables = {};
  Object.keys(KINDS).forEach((kind, i) => {
    cables[`cable:${kind}`] = { from: `x.${i}`, to: `y.${i}`, kind, a: { x: 20 + i * 60, y: 40 }, b: { x: 60 + i * 60, y: 200 } };
  });
  const { svg } = rig(cables);
  for (const [kind, k] of Object.entries(KINDS)) {
    const g = rope(svg, `cable:${kind}`);
    assert.ok(g, kind);
    const [p] = lines(g);
    assert.equal(p.attrs['stroke-width'], String(k.width), `${kind}'s width`);
    assert.equal(p.attrs['stroke-dasharray'] ?? '', k.dash, `${kind}'s dash`);
    assert.equal(p.style.stroke, k.ink);
    assert.match(p.attrs.class, new RegExp(`rig-wire-${kind}\\b`));
    assert.match(p.attrs.d, /^M\d/);
  }
});

test('a cable waiting for a restart is hollow, with open square plugs; a jack you drew has none', () => {
  const { svg } = rig({
    'cable:clock': { from: 'kit.clock-out', to: 'bento.midi-in', kind: 'clock', pending: 'plug', a: { x: 20, y: 20 }, b: { x: 200, y: 60 } },
    'cable:jack': { from: 'label:ep-136.in1', to: 'ep-136.in1', kind: 'jack', declared: true, a: { x: 300, y: 20 }, b: { x: 300, y: 60 } },
    'cable:live': { from: 'kit.tap.ch1', to: 'kit.track.2', kind: 'patch', a: { x: 20, y: 300 }, b: { x: 200, y: 300 } },
  });
  const pend = rope(svg, 'cable:clock');
  assert.equal(lines(pend).length, 2, 'ink, and the desk down its middle');
  assert.match(lines(pend)[1].attrs.class, /rig-wire-core/);
  assert.deepEqual(plugs(pend).map((p) => p.tag), ['rect', 'rect']);
  assert.equal(plugs(pend)[0].attrs.x, '14', 'centred on the end');
  assert.deepEqual(plugs(rope(svg, 'cable:jack')), []);
  const live = rope(svg, 'cable:live');
  assert.deepEqual(plugs(live).map((p) => p.tag), ['circle', 'circle']);
  assert.equal(plugs(live)[1].attrs.cx, '200');
});

test('only a rope that moved is redrawn, and a still rig draws nothing', () => {
  const { svg, scene, ticker, r } = rig({
    'cable:a': { kind: 'patch', a: { x: 20, y: 20 }, b: { x: 200, y: 20 } },
    'cable:b': { kind: 'usb', a: { x: 20, y: 300 }, b: { x: 200, y: 300 } },
  });
  const still = rope(svg, 'cable:b');
  const sets = lines(still)[0].sets;
  const before = r.redrawn;
  scene.get('cable:a').set({ b: { x: 260, y: 60 } });
  let frames = 0;
  while (ticker.running && frames < 400) { ticker.advance(1000 / 60); frames++; }
  assert.ok(r.redrawn - before >= frames - 1, 'the moving rope drew every frame');
  assert.equal(lines(still)[0].sets, sets, 'the still one never');
  const after = r.redrawn;
  ticker.advance(16);
  scene.step(16);
  assert.equal(r.redrawn, after, 'and nothing once it settled');
});

test('a rope whose cable has gone is taken away', () => {
  const { svg, scene, ticker } = rig({ 'cable:a': { kind: 'patch', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } } });
  assert.ok(rope(svg, 'cable:a'));
  scene.remove('cable:a');
  ticker.advance(16);
  assert.equal(rope(svg, 'cable:a'), undefined);
});

test('nothing it draws takes input: the sockets underneath are the controls', () => {
  const { doc } = rig({
    'cable:a': { kind: 'patch', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    'cable:p': { kind: 'clock', pending: 'plug', a: { x: 0, y: 50 }, b: { x: 100, y: 50 } },
  });
  assert.ok(doc.made.length > 4);
  assert.equal(doc.made.reduce((n, e) => n + e.listeners, 0), 0);
  assert.ok(doc.made.every((e) => !('tabindex' in e.attrs) && !('role' in e.attrs)));
});

test('the layer the ropes are drawn in takes no pointer events, so the sockets under it get every touch', () => {
  const css = fileCss('styles.css');
  const rules = [...css.matchAll(/(^|\n)\s*([^{}]*\.rig-(?:wires|rope)\b[^{}]*)\{([^}]*)\}/g)];
  const wires = rules.filter((m) => /^\s*\.rig-wires\s*$/.test(m[2]));
  assert.ok(wires.length, 'a .rig-wires rule');
  assert.ok(wires.some((m) => /pointer-events:\s*none/.test(m[3])));
  assert.ok(!rules.some((m) => /pointer-events:\s*(?!none)\w/.test(m[3])), 'and no rule gives a rope them back');
  const html = readFileSync(new URL('../../rig.html', import.meta.url), 'utf8');
  assert.match(html, /<svg class="rig-wires" aria-hidden="true">/, 'hidden from screen readers too: the sockets say it all');
});

test('a tap near a rope’s run finds that cable; the rope in the hand is never one', () => {
  const { r, scene } = rig({
    'cable:low': { kind: 'patch', a: { x: 100, y: 400 }, b: { x: 400, y: 400 } },
    'cable:high': { kind: 'patch', a: { x: 100, y: 100 }, b: { x: 400, y: 100 } },
    'cable:drag': { kind: 'patch', drawing: true, a: { x: 100, y: 250 }, b: { x: 400, y: 250 } },
  });
  // The fake SVG sits at (10, 20) in the viewport.
  const at = (id, i) => { const p = scene.get(id).view.points[i]; return [p.x + 10, p.y + 20]; };
  assert.equal(r.hit(...at('cable:high', 8)), 'cable:high');
  assert.equal(r.hit(...at('cable:low', 3)), 'cable:low');
  const [x, y] = at('cable:high', 8);
  assert.equal(r.hit(x, y + HIT_PX + 2.4), 'cable:high', 'within reach of its edge');
  assert.equal(r.hit(x, y + HIT_PX + 2.6 + 1), null, 'and not beyond');
  assert.equal(r.hit(...at('cable:drag', 8)), null);
  assert.equal(r.hit(5, 5), null);
});

test('a cable’s twin is the socket button at its from end, or its socket for a label', () => {
  const { r } = rig({
    'cable:input:2': { from: 'kit.tap.ch1', to: 'kit.track.2', kind: 'patch', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } },
    'cable:jack': { from: 'label:ep-136.in1', to: 'ep-136.in1', kind: 'jack', declared: true, a: { x: 0, y: 0 }, b: { x: 0, y: 30 } },
  });
  assert.deepEqual(r.twin('cable:input:2'), { sock: 'kit.tap.ch1' });
  assert.deepEqual(r.twin('cable:jack'), { sock: 'ep-136.in1' });
  assert.equal(r.twin('nothing'), null);
});

test('destroy takes every rope down and leaves the scene', () => {
  const { r, svg, scene } = rig({ 'cable:a': { kind: 'patch', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } } });
  r.destroy();
  assert.deepEqual(svg.children, []);
  assert.equal(scene.renderers.size, 0);
});
