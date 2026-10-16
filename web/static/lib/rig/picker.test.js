import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { desk, allSockets } from './desk.js';
import { choose, letGo } from './picker.js';
import { writeFor } from './patch.js';

const g = JSON.parse(readFileSync(new URL('./testdata/sidekick.json', import.meta.url), 'utf8'));
const all = allSockets(desk(g));

// Every socket is a button: choosing one, then one it lights, plugs the
// cable a drag would -- the same request, from the keyboard.
test('every socket is reachable and patchable by keyboard', () => {
  let patched = 0;
  for (const s of all) {
    const r = choose(g, all, letGo(), s.id);
    assert.equal(r.state.sel, s.id, `${s.id} can't be chosen`);
    assert.equal(r.write, null, 'choosing writes nothing');
    for (const t of r.state.targets) {
      const r2 = choose(g, all, r.state, t);
      assert.deepEqual(r2.write, writeFor(g, s.id, t), `${s.id} → ${t}`);
      assert.ok(r2.write, `${t} was lit for ${s.id} but plugs nothing`);
      patched++;
    }
  }
  assert.ok(patched > 20, `only ${patched} patches reachable`);
});

test('each kind of cable can be plugged from the keyboard', () => {
  const lit = (from) => choose(g, all, letGo(), from).state.targets;
  assert.ok(lit('kit.tap.aux').includes('kit.track.1'), 'tap → track');
  assert.ok(lit('kit.track.1').includes('kit.bus.B'), 'track → bus');
  assert.ok(lit('kit.out').includes('phones.in'), 'OUT → a listener');
  assert.ok(lit('kit.clock-out').includes('ep-136.midi-in'), 'kit → a device clock in');
  assert.ok(lit('midi-demo-sequencer.midi-out').includes('kit.clock-in'), 'a device clock → kit');
  assert.ok(lit('kit.tap.ch2').includes('kit.keep'), 'what a KEEP writes');
  assert.ok(lit('ep-136.usb').includes('kit.keep'), 'KEEP all');
  assert.ok(!lit('kit.track.1').includes('kit.bus.A'), 'its own bus is no patch');
});

test('choosing again lets go; choosing elsewhere chooses that', () => {
  const a = choose(g, all, letGo(), 'kit.tap.aux');
  assert.deepEqual(choose(g, all, a.state, 'kit.tap.aux').state, letGo());
  const b = choose(g, all, a.state, 'kit.tap.main');
  assert.equal(b.state.sel, 'kit.tap.main');
  assert.equal(b.write, null, 'a tap into a tap plugs nothing');
});
