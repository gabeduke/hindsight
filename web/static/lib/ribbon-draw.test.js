// web/static/lib/ribbon-draw.test.js
// The ribbon on tape: its levels, its tier pills and its ruler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ribbonLevels, tierPills, rulerTicks, drawRibbon } from './ribbon-draw.js';
import { leftPct } from './ribbonmath.js';

test('ribbonLevels reads the envelope bytes as levels, 0 to 1', () => {
  assert.deepEqual([...ribbonLevels(Uint8Array.from([0, 255, 51]))], [0, 1, Math.fround(0.2)]);
});

test('tierPills puts a pill at each capture length, the chosen one lit', () => {
  const at = (age) => leftPct(age, 1, 900);
  const pills = tierPills([30, 120, 0], 120, 900, at);
  assert.deepEqual(pills.map((p) => [p.label, p.on]), [['30s', false], ['2m', true], ['15m', false]]);
  assert.equal(pills[2].x, 0);
  assert.ok(pills[0].x > pills[1].x);
});

test('rulerTicks labels the ring from its oldest end to now, in order, inside the strip', () => {
  const at = (age) => leftPct(age, 1, 900);
  const ticks = rulerTicks(900, at);
  assert.equal(ticks[0].label, '15m');
  assert.equal(ticks.at(-1).label, 'now');
  assert.equal(ticks.at(-1).x, 100);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].x > ticks[i - 1].x, `${ticks[i].label} after ${ticks[i - 1].label}`);
  for (const t of ticks) assert.ok(t.x >= 0 && t.x <= 100);
});

test('rulerTicks keeps only the marks a short ring holds, and none crowding another', () => {
  const at = (age) => leftPct(age, 1, 120);
  const labels = rulerTicks(120, at).map((t) => t.label);
  assert.deepEqual(labels.slice(0, 1), ['2m']);
  assert.ok(!labels.includes('15m') && !labels.includes('5m'));
  const ticks = rulerTicks(120, at, 30);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].x - ticks[i - 1].x >= 30 || ticks[i].label === 'now');
});

test('rulerTicks keeps labels apart in pixels on a narrow ribbon', () => {
  const at = (age) => leftPct(age, 1, 900);
  const ticks = rulerTicks(900, at, { width: 390, minPx: 44 });
  for (let i = 1; i < ticks.length; i++) {
    const gap = ((ticks[i].x - ticks[i - 1].x) / 100) * 390;
    assert.ok(gap >= 44, `${ticks[i - 1].label} and ${ticks[i].label} are ${gap.toFixed(0)} px apart`);
  }
});

// A context that records clips and strokes.
function recorder() {
  const calls = [];
  const ctx = { calls, globalAlpha: 1, getTransform: () => ({ a: 1, b: 0 }) };
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'clip'])
    ctx[m] = (...a) => calls.push([m, ...a]);
  ctx.rect = (...a) => calls.push(['rect', ...a]);
  return ctx;
}
const COLORS = { oxide: { edge: 'e', lo: 'l', mid: 'm', sheen: 's', shade: 'd', grain: 'g' }, centre: 'c', trace: 't', hot: 'h', glow: 'g', haze: 'z', halo: 'o' };

test('drawRibbon draws no trace over time the ring never recorded', () => {
  const ctx = recorder();
  drawRibbon(ctx, { W: 400, H: 100, levels: new Float32Array(40).fill(0.5), lit: [300, 400], recordedFrom: 120, colors: COLORS });
  const clips = ctx.calls.filter((c) => c[0] === 'rect');
  assert.ok(clips.length >= 2, 'both passes are clipped');
  for (const c of clips) assert.ok(c[1] >= 120, `a pass starts at ${c[1]}, before the recording`);
});
