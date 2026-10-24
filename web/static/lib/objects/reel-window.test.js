// web/static/lib/bar/reel-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levelFrac, peakDbAt, progressWriter, HAIRLINE_MEDIA } from './reel-window.js';

test('a level bar is empty at −40 dBFS and full 3 dB over the reference', () => {
  assert.equal(levelFrac(-Infinity), 0);
  assert.equal(levelFrac(-60), 0);
  assert.equal(levelFrac(-40), 0);
  assert.equal(levelFrac(-7), 1);          // ref −10, +3
  assert.equal(levelFrac(0), 1);
  assert.ok(Math.abs(levelFrac(-23.5) - 0.5) < 1e-9);
  assert.equal(levelFrac(NaN), 0);
});

test('a take\'s level at a point: each channel\'s loudest edge in that bucket, in dBFS', () => {
  // Two buckets of min/max pairs per channel.
  const pd = { buckets: 2, channels: 2, data: [new Float32Array([-0.1, 0.1, -0.5, 0.25]), new Float32Array([0, 0, -1, 1])] };
  const [l0, r0] = peakDbAt(pd, 0.2);
  assert.ok(Math.abs(l0 - -20) < 1e-6);
  assert.equal(r0, -Infinity);
  const [l1, r1] = peakDbAt(pd, 0.99);
  assert.ok(Math.abs(l1 - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(Math.abs(r1 - 0) < 1e-6);
  // The end of the take reads the last bucket; a gain lifts it.
  assert.ok(Math.abs(peakDbAt(pd, 1)[0] - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(Math.abs(peakDbAt(pd, 0.2, 2)[0] - 20 * Math.log10(0.2)) < 1e-6);
});

test('the bar\'s progress is written only where the mini player draws it, and at once when it comes to', () => {
  const set = [];
  const np = { style: { setProperty: (k, v) => set.push([k, v]) } };
  let onChange = null;
  const mq = { matches: false, addEventListener: (type, fn) => { if (type === 'change') onChange = fn; } };
  const write = progressWriter(np, mq);
  write(0.25);
  write(0.5);
  assert.deepEqual(set, [], 'a tablet: nothing reads it, so nothing restyles the bar each frame');
  mq.matches = true;
  onChange();
  assert.deepEqual(set, [['--np-progress', '0.5']], 'turned into a phone: the last one, at once');
  write(0.75);
  assert.deepEqual(set.at(-1), ['--np-progress', '0.75']);
  const always = [];
  progressWriter({ style: { setProperty: (k, v) => always.push(v) } }, null)(0.1);
  assert.deepEqual(always, ['0.1'], 'no matchMedia: as it always was');
});

test('the query is the stylesheet\'s own: --np-progress is read only by the mini player\'s hairline, under it', () => {
  const css = fs.readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
  const at = css.indexOf(`@media ${HAIRLINE_MEDIA} {`);
  assert.ok(at >= 0, `styles.css has @media ${HAIRLINE_MEDIA}`);
  // The block: to the brace that closes it.
  let depth = 0, end = css.indexOf('{', at);
  for (; end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}' && --depth === 0) break; }
  const block = css.slice(at, end);
  const uses = [...css.matchAll(/var\(--np-progress/g)].map((m) => m.index);
  assert.ok(uses.length > 0);
  for (const i of uses) assert.ok(i > at && i < end, 'every reader of --np-progress is inside that query');
  assert.match(block, /\.np::before\s*\{[^}]*--np-progress/);
});
