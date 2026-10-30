// web/static/lib/ui/measure.test.js
// A height measured into a custom property (lib/ui/measure.js): written as
// it changes, once per change, and never by a stylesheet. Help mode's tip
// is measured so the page can keep clear of it (J5.1, a phone's List).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cssOf, decls, rules, stripComments } from '../stylesheets.js';
import { measureInto } from './measure.js';

const fake = () => {
  const writes = [];
  const root = { style: { setProperty: (k, v) => writes.push(`${k}=${v}`) } };
  let cb = null;
  class RO { constructor(f) { cb = f; } observe() {} disconnect() {} }
  return { writes, root, RO, resize: (h) => cb([{ borderBoxSize: [{ blockSize: h }] }]) };
};

test('measureInto writes the height into its property on the root as it changes, once per change', () => {
  const { writes, root, RO, resize } = fake();
  measureInto({ ownerDocument: { documentElement: root } }, '--tip-h', { RO });
  resize(150.4);
  resize(150);
  resize(0);
  assert.deepEqual(writes, ['--tip-h=150px', '--tip-h=0px']);
});

test('with no element, no root or no ResizeObserver it measures nothing, and its disconnect is harmless', () => {
  const { root, RO } = fake();
  assert.doesNotThrow(measureInto(null, '--tip-h', { root, RO }));
  assert.doesNotThrow(measureInto({}, '--tip-h', { RO }));
  assert.doesNotThrow(measureInto({ ownerDocument: { documentElement: root } }, '--tip-h', { RO: undefined }));
});

test('help mode’s tip is measured, never written: no stylesheet sets --tip-h, and every read has its fallback', () => {
  const set = rules(cssOf()).flatMap((r) => decls(r.body).filter((d) => d.prop === '--tip-h').map(() => `${r.line}: ${r.sel.join(', ')}`));
  assert.deepEqual(set, []);
  const reads = [...stripComments(cssOf()).matchAll(/var\(--tip-h([^)]*)\)/g)];
  assert.ok(reads.length > 0, 'the page keeps clear of the tip by --tip-h');
  for (const m of reads) assert.equal(m[1], ', 0px');
});
