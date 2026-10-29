// web/static/lib/room/space.test.js
// The Listening Room as data (space.js), the art that draws it (art/), and
// the renderer that lays the page's controls over it (stage.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ROOM, project, face, inFrame, lit, diffuse, floorShadow, wallShadow, drawOrder, viewFor, keyLight } from './space.js';
import { ART } from './art/index.js';
import { drawRoom, roomScene, RoomRenderer } from './stage.js';
import { Ticker } from '../objects/motion.js';
import { cssOf, fileCss } from '../stylesheets.js';

const objects = fileCss('objects.css');
const declared = new Set([...cssOf().matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const byId = (id) => ROOM.objects.find((o) => o.id === id);

test('a point on the wall is drawn where it is; a nearer one spreads from the eye', () => {
  const v = ROOM.views.wide;
  assert.deepEqual(project({ x: 100, y: 50, z: 0 }, v), { x: 100, y: -50, k: 1 });
  const near = project({ x: 100, y: 50, z: 300 }, v);
  assert.ok(near.k > 1);
  assert.ok(near.x < 100, 'left of the eye, nearer, is further left');
  assert.ok(near.y > -50, 'below the eye, nearer, is lower');
});

test('every object has a box, an art that draws it, and a unique id; the controls have their twins', () => {
  const ids = new Set();
  for (const o of ROOM.objects) {
    assert.ok(!ids.has(o.id), `${o.id} twice`);
    ids.add(o.id);
    assert.equal(typeof ART[o.art], 'function', `${o.id}: no art "${o.art}"`);
    for (const k of ['w', 'h', 'd']) assert.ok(o.size[k] >= 0, `${o.id}.size.${k}`);
    if (o.mount?.startsWith('on:')) {
      const base = byId(o.mount.slice(3));
      assert.ok(base, `${o.id} stands on ${o.mount}`);
      assert.equal(o.at.y, base.at.y + base.size.h, `${o.id} sits on top of ${base.id}`);
    }
  }
  assert.deepEqual(ROOM.objects.filter((o) => o.twin).map((o) => o.twin).sort(), ['deck', 'shelves']);
});

test('every colour the room names is a token that exists', () => {
  // A typo in a token paints nothing, silently, at night and by day.
  const named = new Set();
  for (const o of ROOM.objects) for (const t of Object.values(o.material || {})) named.add(t);
  for (const L of ROOM.lights) named.add(L.color);
  const dir = new URL('./art/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/'(--[a-z0-9-]+)'|var\((--[a-z0-9-]+)\)/g)) named.add(m[1] || m[2]);
  }
  const missing = [...named].filter((t) => !declared.has(t));
  assert.deepEqual(missing, []);
});

test('the room’s own colours are materials: in objects.css, the same in both schemes', () => {
  const dir = new URL('./art/', import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/'(--room-[a-z0-9-]+)'|var\((--room-[a-z0-9-]+)\)/g)) used.add(m[1] || m[2]);
  }
  const inObjects = new Set([...objects.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((t) => !inObjects.has(t)), []);
});

test('light: a face turned to the lamp is lit, one turned away is not, and the lamp is the key', () => {
  const L = keyLight();
  const p = { x: L.at.x + 60, y: 40, z: L.at.z };
  const toward = diffuse({ x: -1, y: 0, z: 0 }, p);
  const away = diffuse({ x: 1, y: 0, z: 0 }, p);
  assert.ok(toward.key > 0.2, `toward: ${toward.key}`);
  assert.equal(away.key, 0);
  // Further off, less light.
  const far = diffuse({ x: -1, y: 0, z: 0 }, { ...p, x: L.at.x + 400 });
  assert.ok(far.key < toward.key);
  // The window lights what faces it, and nothing behind the wall.
  assert.ok(diffuse({ x: 0, y: 0, z: -1 }, { x: 100, y: 150, z: 40 }).fill > 0);
  assert.equal(diffuse({ x: 0, y: 0, z: 1 }, { x: 100, y: 150, z: 40 }).fill, 0);
  assert.equal(diffuse({ x: 0, y: 0, z: 1 }, { x: 100, y: 150, z: -20 }).fill, 0);
});

test('light: which side an object is lit from follows the lamp, wherever it is moved', () => {
  const chair = byId('chair');
  assert.equal(lit(chair).lamp.side, 1, 'the lamp is to the chair’s right');
  const moved = ROOM.lights.map((l) => (l.kind === 'key' ? { ...l, at: { ...l.at, x: 10 } } : l));
  assert.equal(lit(chair, moved).lamp.side, -1, 'moved to its left, the light comes from the left');
});

test('shadows fall away from the lamp, and no further than the light allows', () => {
  const L = keyLight();
  const t = byId('table');
  const poly = floorShadow(t, L);
  const cx = poly.reduce((n, p) => n + p.x, 0) / poly.length, cz = poly.reduce((n, p) => n + p.z, 0) / poly.length;
  const ox = t.at.x + t.size.w / 2, oz = t.at.z + t.size.d / 2;
  assert.ok(Math.hypot(cx - L.at.x, cz - L.at.z) > Math.hypot(ox - L.at.x, oz - L.at.z), 'the shadow lies beyond the table, seen from the lamp');
  const sh = byId('shelves');
  const w = wallShadow(sh, L);
  assert.ok(w.dx > 0, 'the lamp is left of the shelves: their shadow is to the right');
  assert.ok(Math.abs(w.dx) <= sh.size.d && Math.abs(w.dy) <= sh.size.d);
});

test('drawn in order: the shell, then the wall’s things, then back to front, a thing after what it stands on', () => {
  const order = drawOrder().map((o) => o.id);
  assert.deepEqual(order.slice(0, 2).sort(), ['floor', 'wall']);
  const at = (id) => order.indexOf(id);
  assert.ok(at('window') < at('console'));
  assert.ok(at('rug') < at('chair') && at('rug') < at('table'));
  assert.ok(at('table') < at('glass'));
  assert.ok(at('console') < at('deck'));
});

test('the picture draws every object, in either view, with nothing left unworked out', () => {
  for (const name of Object.keys(ROOM.views)) {
    const svg = drawRoom(ROOM.objects, name);
    assert.match(svg, /^<svg class="room-art"/);
    for (const o of ROOM.objects) assert.ok(svg.includes(`data-object="${o.id}"`), `${name}: ${o.id}`);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    assert.ok(svg.length < 600_000, `${name} is ${svg.length} bytes`);
  }
  assert.equal(viewFor(1.6), 'wide');
  assert.equal(viewFor(0.76), 'tall');
});

test('the controls are laid over their objects in the frame, and taken back off on a phone', () => {
  const style = () => {
    const m = new Map();
    return { m, setProperty: (k, v) => m.set(k, v), removeProperty: (k) => m.delete(k), set left(v) { m.set('left', v); }, set top(v) { m.set('top', v); }, set width(v) { m.set('width', v); }, set height(v) { m.set('height', v); }, set bottom(v) { m.set('bottom', v); }, set minHeight(v) { m.set('min-height', v); } };
  };
  const twins = { shelves: { style: style() }, deck: { style: style() } };
  const el = { innerHTML: '' };
  const r = new RoomRenderer({ twins });
  const scene = roomScene(ROOM, { ticker: new Ticker({ raf: () => 0, now: () => 0 }) });
  r.mount(el, scene);
  assert.equal(r.setView('wide'), true);
  assert.match(el.innerHTML, /data-object="chair"/);
  const pct = (s) => Number(String(s).replace('%', ''));
  const v = ROOM.views.wide;
  const deck = inFrame(face(byId('deck'), v), v);
  assert.ok(Math.abs(pct(twins.deck.style.m.get('left')) - deck.left * 100) < 0.01, 'the deck’s twin is where the deck is');
  for (const k of ['left', 'width', 'bottom', 'min-height']) {
    const n = pct(twins.shelves.style.m.get(k));
    assert.ok(n >= 0 && n <= 100, `shelves ${k} ${n}`);
  }
  assert.ok(twins.deck.style.m.has('--lamp-x') && twins.shelves.style.m.has('--cast-dir'), 'with what the light says about them');
  assert.equal(r.setView('wide'), false, 'drawn once per view');
  assert.equal(r.twin('deck'), twins.deck);
  assert.equal(r.twin('chair'), null, 'a picture has no twin');
  // A phone: the page lays the shelves out as rows again.
  r.unplace();
  for (const t of Object.values(twins)) assert.deepEqual([...t.style.m.keys()], []);
  assert.equal(r.setView('wide'), true, 'and draws again when there is room');
  r.destroy();
});

test('the room never asks the ticker for a frame: its props stand still', () => {
  let asked = 0;
  const ticker = new Ticker({ raf: () => { asked++; return 0; }, now: () => 0 });
  const scene = roomScene(ROOM, { ticker });
  scene.start();
  assert.equal(scene.step(16), false, 'nothing moves');
  scene.stop();
  assert.ok(asked <= 1);
});
