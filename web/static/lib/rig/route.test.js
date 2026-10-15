import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CableModel } from '../scene/cable.js';
import { KINDS } from './kinds.js';
import { routeAll, CELL } from './route.js';

// The desk as the demo draws it, measured in a browser (testdata/desk-*.json):
// where every jack's hole is, every name and title, the desk's size, and the
// three cables the demo has -- the Sidekick's USB-C to the kit's USB, the
// demo sequencer's MIDI OUT to the kit's MIDI IN, and MAIN to KEEP. Laptop is
// 1440 wide, phone 390. Nothing here is a made-up position.
const load = (name) => JSON.parse(readFileSync(new URL(`./testdata/desk-${name}.json`, import.meta.url), 'utf8'));
const DESKS = { laptop: load('laptop'), phone: load('phone') };

const cablesOf = (f, extra = []) => [...f.cables, ...extra].map((c) => ({ ...c, a: f.holes[c.from], b: f.holes[c.to] }));

/**
 * settle is where a cable's rope comes to rest on the desk: the page's own
 * pipeline -- lead it (route.js), pin the rope to that (lib/scene/cable.js),
 * land it -- or, with `led` false, the rope between its two ends alone, as it
 * was drawn before.
 */
function settle(f, cables, { led = true } = {}) {
  const routes = routeAll({ cables, obstacles: f.obstacles, size: f.size });
  return new Map(cables.map((c) => {
    const m = new CableModel();
    m.step({ a: c.a, b: c.b, via: led ? routes.get(c.id) : [] }, Infinity);
    return [c.id, m.view.points];
  }));
}

/** over lists what a rope runs over: the holes and names it must not cross, but not its own sockets' holes. */
function over(f, c, pts) {
  const half = (KINDS[c.kind] || KINDS.patch).width / 2;
  const out = [];
  for (const o of f.obstacles) {
    if (o.type === 'hole' && (o.owner === c.from || o.owner === c.to)) continue;
    let hit = false;
    for (let i = 1; i < pts.length && !hit; i++) {
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
        const y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
        if (x > o.x - half && x < o.x + o.w + half && y > o.y - half && y < o.y + o.h + half) hit = true;
      }
    }
    if (hit) out.push(`${o.type} ${o.owner || '(a name)'} at ${o.x},${o.y}`);
  }
  return out;
}

const centreOf = (f, id) => f.holes[id];
const nearest = (pts, p) => Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));

test('the cause: a rope between its two ends alone knows nothing of the desk, and runs over the sockets', () => {
  // This is how the cables were drawn. It is what the rest of this file is
  // not: the baseline that crosses, on the laptop desk (the USB cable
  // through CH1) and the phone's (all three, through names).
  const lap = DESKS.laptop;
  const plain = settle(lap, cablesOf(lap), { led: false });
  assert.ok(nearest(plain.get('usb:ep-136'), centreOf(lap, 'kit.tap.ch1')) < 14, 'the USB rope goes through CH1');
  const ph = DESKS.phone;
  const phPlain = settle(ph, cablesOf(ph), { led: false });
  for (const c of cablesOf(ph)) assert.ok(over(ph, c, phPlain.get(c.id)).length > 0, `${c.id} crosses something on the phone`);
});

test('the Sidekick’s USB cable no longer runs through CH1, MAIN, or the names in the kit’s row', () => {
  const f = DESKS.laptop;
  const usb = settle(f, cablesOf(f)).get('usb:ep-136');
  for (const id of ['kit.tap.ch1', 'kit.tap.main', 'kit.tap.ch2', 'kit.tap.aux']) {
    assert.ok(nearest(usb, centreOf(f, id)) > 20, `${id} is ${nearest(usb, centreOf(f, id)).toFixed(1)} px from the USB rope`);
  }
  assert.deepEqual(over(f, { from: 'ep-136.usb', to: 'kit.usb', kind: 'usb' }, usb), []);
});

test('the KEEP cable does not run through the word KEEP, nor the MIDI cable through MIDI IN or the KEEP socket', () => {
  const f = DESKS.laptop;
  const ropes = settle(f, cablesOf(f));
  const keepWord = f.obstacles.find((o) => o.type === 'text' && o.owner === 'kit.keep');
  const midiWord = f.obstacles.find((o) => o.type === 'text' && o.owner === 'kit.midi');
  assert.ok(keepWord && midiWord, 'the fixture has both names');
  const inside = (pts, o, m) => pts.some((p) => p.x > o.x - m && p.x < o.x + o.w + m && p.y > o.y - m && p.y < o.y + o.h + m);
  assert.equal(inside(ropes.get('keep:main'), keepWord, 3), false, 'KEEP');
  assert.equal(inside(ropes.get('midi:midi-demo-sequencer'), midiWord, 3), false, 'MIDI IN');
  assert.ok(nearest(ropes.get('midi:midi-demo-sequencer'), centreOf(f, 'kit.keep')) > 20, 'and well clear of the KEEP socket');
});

test('on both desks no rope crosses a jack’s hole or a name that is not its own', () => {
  for (const [name, f] of Object.entries(DESKS)) {
    const cables = cablesOf(f);
    const ropes = settle(f, cables);
    for (const c of cables) assert.deepEqual(over(f, c, ropes.get(c.id)), [], `${name}: ${c.id}`);
  }
});

test('cables between the same two sockets run side by side, not one on the other', () => {
  const f = DESKS.laptop;
  const twin = { id: 'usb:twin', from: 'ep-136.usb', to: 'kit.usb', kind: 'usb' };
  const cables = cablesOf(f, [twin]);
  for (const led of [false, true]) {
    const ropes = settle(f, cables, { led });
    const a = ropes.get('usb:ep-136'), b = ropes.get('usb:twin');
    // How far apart the two are along the run, away from the plugs they share.
    const mid = a.filter((_, i) => i > 3 && i < a.length - 4);
    const gap = Math.min(...mid.map((p) => nearest(b, p)));
    if (!led) assert.ok(gap < 1, 'as drawn before, two cables between the same sockets were one thick cable');
    else assert.ok(gap >= 8, `they are ${gap.toFixed(1)} px apart at the nearest`);
  }
});

test('three cables into one socket keep to lanes of their own', () => {
  const f = DESKS.laptop;
  const extra = [
    { id: 'keep:ch1', from: 'kit.tap.ch1', to: 'kit.keep', kind: 'keep' },
    { id: 'keep:ch2', from: 'kit.tap.ch2', to: 'kit.keep', kind: 'keep' },
  ];
  const cables = cablesOf(f, extra);
  const ropes = settle(f, cables);
  for (const c of cables) assert.deepEqual(over(f, c, ropes.get(c.id)), [], c.id);
  // Where they run beside each other, between the sockets they leave and the one they go into.
  const keeps = ['keep:main', 'keep:ch1', 'keep:ch2'].map((id) => ropes.get(id));
  for (let i = 0; i < keeps.length; i++) {
    for (let j = i + 1; j < keeps.length; j++) {
      // Skip the stretch at the shared plug: the last four points of each rope.
      const run = keeps[i].filter((_, k) => k > 3 && k < keeps[i].length - 5);
      const gap = Math.min(...run.map((p) => nearest(keeps[j], p)));
      assert.ok(gap >= 6, `ropes ${i} and ${j} are ${gap.toFixed(1)} px apart at the nearest`);
    }
  }
});

test('a route leaves its first socket and enters its second along a straight leg, exactly from hole to hole', () => {
  for (const f of Object.values(DESKS)) {
    const cables = cablesOf(f);
    const routes = routeAll({ cables, obstacles: f.obstacles, size: f.size });
    assert.ok(routes.get('usb:ep-136').length >= 2, 'the USB cable is led down, along, and down again');
    for (const c of cables) {
      const via = routes.get(c.id);
      assert.ok(Array.isArray(via), c.id);
      if (!via.length) continue;
      const first = via[0], last = via[via.length - 1];
      // The first leg is up or down, or across, from the hole itself: a corner shares one coordinate with it.
      assert.ok(Math.abs(first.x - c.a.x) < 0.2 || Math.abs(first.y - c.a.y) < 0.2, `${c.id} leaves a hole at a slant`);
      assert.ok(Math.abs(last.x - c.b.x) < 0.2 || Math.abs(last.y - c.b.y) < 0.2, `${c.id} enters a hole at a slant`);
      assert.ok(via.length <= 8, 'and goes round no more than it must');
    }
  }
});

test('the same desk is led the same way, and a declared cable, a jack you drew, is left alone', () => {
  const f = DESKS.laptop;
  const cables = [...cablesOf(f), { id: 'jack:x', from: 'label:x', to: 'kit.tap.ch1', kind: 'jack', declared: true, a: { x: 100, y: 300 }, b: f.holes['kit.tap.ch1'] }];
  const one = routeAll({ cables, obstacles: f.obstacles, size: f.size });
  const two = routeAll({ cables: [...cables].reverse(), obstacles: f.obstacles, size: f.size });
  assert.deepEqual([...one.keys()].sort(), [...two.keys()].sort());
  for (const id of one.keys()) assert.deepEqual(one.get(id), two.get(id), `${id}: the order they are listed in does not matter`);
  assert.equal(one.has('jack:x'), false, 'a label is taut, not led');
});

test('a cable boxed in on every side is still led, round as little as it can', () => {
  // A socket walled in by names: nothing can be avoided, and nothing throws.
  const walls = [
    { type: 'text', owner: '', x: 90, y: 90, w: 20, h: 8 },
    { type: 'text', owner: '', x: 90, y: 122, w: 20, h: 8 },
    { type: 'text', owner: '', x: 70, y: 98, w: 8, h: 24 },
    { type: 'text', owner: '', x: 122, y: 98, w: 8, h: 24 },
  ];
  const cables = [{ id: 'c', from: 'a', to: 'b', kind: 'patch', a: { x: 100, y: 110 }, b: { x: 300, y: 110 } }];
  const routes = routeAll({ cables, obstacles: walls, size: { w: 400, h: 220 } });
  assert.ok(Array.isArray(routes.get('c')));
  // Two ends in one cell have nothing to lead.
  const same = routeAll({ cables: [{ id: 'd', from: 'a', to: 'b', a: { x: 10, y: 10 }, b: { x: 11, y: 11 } }], obstacles: [], size: { w: 40, h: 40 } });
  assert.deepEqual(same.get('d'), []);
});

test('the search is quick enough to run when the desk is laid out, on a long phone desk too', () => {
  const f = DESKS.phone;
  const cables = [...cablesOf(f)];
  for (let i = 0; i < 9; i++) cables.push({ id: `extra${i}`, from: 'kit.tap.ch1', to: 'kit.keep', kind: 'keep', a: f.holes['kit.tap.ch1'], b: f.holes['kit.keep'] });
  const t = performance.now();
  routeAll({ cables, obstacles: f.obstacles, size: f.size });
  const ms = performance.now() - t;
  assert.ok(ms < 400, `twelve cables took ${ms.toFixed(0)} ms`);
  assert.ok(CELL >= 2);
});
