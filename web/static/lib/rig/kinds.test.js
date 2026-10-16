import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, PENDING, styleOf, legend } from './kinds.js';

// The legend's promise: a cable's kind can be read without its colour.
test('every kind of cable differs from every other in width or dash, not colour alone', () => {
  const ks = Object.entries(KINDS);
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const [a, ka] = ks[i], [b, kb] = ks[j];
      assert.ok(ka.width !== kb.width || ka.dash !== kb.dash, `${a} and ${b} differ only in colour`);
    }
  }
});

// Review: two kinds of one width must differ in their dash's shape, not by
// a pixel: MIDI (3 4) and a return (1 6) were both a 7 px beat in near
// yellows. Solid against dashed, or beats at least 4 px apart.
const period = (d) => (d ? d.split(/[ ,]+/).map(Number).reduce((a, b) => a + b, 0) : 0);
test('kinds of one width are told apart by the dash itself', () => {
  const ks = Object.entries(KINDS);
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const [a, ka] = ks[i], [b, kb] = ks[j];
      if (ka.width !== kb.width) continue;
      assert.ok(!ka.dash !== !kb.dash || Math.abs(period(ka.dash) - period(kb.dash)) >= 4,
        `${a} (${ka.dash}) and ${b} (${kb.dash}) are the same width with dashes too alike`);
    }
  }
});

// Review: pending was told from a live clock cable only by its colour and a
// marching animation, which reduced motion turns off. It's drawn hollow --
// a tube with nothing in it yet -- and its plugs are open squares.
test('a cable waiting for a restart is hollow, whatever its kind: not just another colour', () => {
  for (const kind of Object.keys(KINDS)) {
    assert.equal(styleOf({ kind, pending: 'plug' }).hollow, true, kind);
    assert.equal(styleOf({ kind, pending: 'unplug' }).hollow, true, kind);
    assert.equal(styleOf({ kind }).hollow, false, `${kind} looks pending when it isn't`);
  }
  assert.equal(legend().find((k) => k.kind === 'pending').hollow, true, 'and so is its legend');
});

test('a restart cable is drawn dashed, in amber, whatever its kind, until the restart', () => {
  for (const kind of Object.keys(KINDS)) {
    const s = styleOf({ kind, pending: 'plug' });
    assert.equal(s.dash, PENDING.dash);
    assert.equal(s.ink, 'var(--cable-pending)');
    assert.equal(s.faded, false);
    assert.notEqual(styleOf({ kind }).dash, PENDING.dash, `${kind} looks pending when it isn't`);
  }
  assert.equal(styleOf({ kind: 'clock', pending: 'unplug' }).faded, true, 'unplugged and still on: faded');
});

test('a label waiting for signal is faded; the legend names every kind and pending', () => {
  assert.equal(styleOf({ kind: 'jack', waiting: true }).faded, true);
  assert.equal(styleOf({ kind: 'jack' }).faded, false);
  const l = legend();
  assert.equal(l.length, Object.keys(KINDS).length + 1);
  assert.ok(l.every((k) => k.legend && k.width > 0));
});
