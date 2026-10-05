import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav16, findZero, findAttack } from './onset.js';

const sr = 48000;
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1; }

test('a click after silence starts where it starts', () => {
  const x = new Float32Array(sr / 2);
  const at = 12000;
  for (let n = at; n < x.length; n++) x[n] = 0.6 * Math.exp(-(n - at) / 480) * Math.sin((2 * Math.PI * 180 * (n - at)) / sr + 0.8);
  const got = findAttack(x, sr, at + 1200, 2880); // asked 25 ms late, ±60 ms
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

function kickOverBass(at, phase) {
  const rnd = seeded(3);
  const x = new Float32Array(sr);
  for (let n = 0; n < x.length; n++) {
    const t = n / sr;
    const bass = 0.45 * Math.sin(2 * Math.PI * 82.41 * t);
    const k = n - at;
    const kick = k >= 0 ? 0.55 * Math.exp(-k / (0.07 * sr)) * Math.sin(2 * Math.PI * 55 * k / sr + phase) : 0;
    x[n] = Math.tanh(bass + kick + 0.002 * rnd()) * 0.5;
  }
  return x;
}

test('a kick with an edge over a held bass is found to the millisecond', () => {
  const at = 24000;
  const got = findAttack(kickOverBass(at, Math.PI / 2), sr, at - 1500, 2880); // starts at full height: a click
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

test('a soft low kick over a held bass, starting from zero, is found to the millisecond too', () => {
  const at = 24000;
  const got = findAttack(kickOverBass(at, 0), sr, at - 1500, 2880); // starts from zero: no edge
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

test('nothing rises in silence, a held sine, or steady noise', () => {
  const rnd = seeded(5);
  const silence = new Float32Array(sr / 4);
  const sine = Float32Array.from({ length: sr / 4 }, (_, n) => 0.5 * Math.sin((2 * Math.PI * 82.41 * n) / sr));
  const noise = Float32Array.from({ length: sr / 4 }, () => 0.3 * rnd());
  for (const [name, x] of [['silence', silence], ['sine', sine], ['noise', noise]]) {
    assert.equal(findAttack(x, sr, 6000, 2880), -1, name);
  }
});

test('the nearest zero crossing, either side, and none in a DC stretch', () => {
  // Half a sample off, so no sample is exactly zero: it crosses between 99 and 100, 199 and 200, ...
  const x = Float32Array.from({ length: 1000 }, (_, n) => Math.sin((2 * Math.PI * (n + 0.5)) / 200));
  assert.equal(findZero(x, 97, 50), 100);
  assert.equal(findZero(x, 203, 50), 200);
  assert.equal(findZero(new Float32Array(500).fill(0.2), 250, 100), -1);
});

test('a 16-bit WAV from the slice endpoint reads back as mono', () => {
  const frames = 4, ch = 2;
  const buf = new ArrayBuffer(44 + frames * ch * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + frames * ch * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, 48000, true); dv.setUint32(28, 48000 * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, frames * ch * 2, true);
  [[16384, 16384], [-16384, 0], [0, 0], [32767, -32768]].forEach(([l, r], f) => { dv.setInt16(44 + f * 4, l, true); dv.setInt16(46 + f * 4, r, true); });
  const got = parseWav16(buf);
  assert.equal(got.sampleRate, 48000);
  assert.equal(got.channels, 2);
  assert.deepEqual([...got.mono].map((v) => Math.round(v * 1000) / 1000 + 0), [0.5, -0.25, 0, 0]);
});

test('a hit near the start of the array is found, or declined, and never guessed from reads before index 0', () => {
  // The soft kick's one-cycle residual reads up to 25 ms behind each sample, so
  // within that of index 0 it would read undefined. 5760 (~120 ms in) was fine
  // before the fix; 3000 and 3500 returned 1771 and 2271.
  for (const early of [3000, 3500, 5760]) {
    const x = kickOverBass(24000, 0).subarray(24000 - early);
    const got = findAttack(x, sr, early - 1500, 2880);
    assert.ok(got === -1 || Math.abs(got - early) <= 48, `hit at ${early}: found ${got}, want ${early} ± 1 ms, or -1`);
  }
});
