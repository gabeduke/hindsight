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
