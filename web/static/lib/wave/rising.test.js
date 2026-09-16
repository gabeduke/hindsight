import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, PX_PER_BEAT, FALLBACK_BPM, isBlack, keyWindow, keyLayout, padLayout, padWidth, bpmAt,
} from './rising.js';

const mel = (ps, kind = 'notes') => ({ name: 'm', kind, notes: ps.map((p, i) => ({ s: i * 4800, e: i * 4800 + 2400, p, v: 100 })) });

test('isBlack follows the piano', () => {
  assert.equal(isBlack(60), false); // C
  assert.equal(isBlack(61), true);  // C#
  assert.equal(isBlack(64), false); // E
  assert.equal(isBlack(65), false); // F
  assert.equal(isBlack(66), true);  // F#
  assert.equal(isBlack(71), false); // B
});

test('keyWindow: no melodic notes gives C2..B5', () => {
  assert.deepEqual(keyWindow([]), { lo: 36, hi: 83 });
  assert.deepEqual(keyWindow([mel([36, 38, 42], 'drums')]), { lo: 36, hi: 83 });
});

test('keyWindow: a bass range sits on the C at or below lo-2', () => {
  assert.deepEqual(keyWindow([mel([40, 45, 52])]), { lo: 36, hi: 83 });
  assert.deepEqual(keyWindow([mel([84, 90, 96])]), { lo: 72, hi: 119 });
  // lo-2 crossing a C boundary: 49-2 = 47 -> C is 36
  assert.deepEqual(keyWindow([mel([49])]), { lo: 36, hi: 83 });
});

test('keyWindow: a span wider than four octaves centres on the range', () => {
  const w = keyWindow([mel([24, 96])]);
  assert.equal(w.hi - w.lo + 1, KEYS);
  assert.equal(w.lo % 12, 0);
  assert.deepEqual(w, { lo: 36, hi: 83 });
});

test('keyWindow never leaves MIDI range', () => {
  assert.deepEqual(keyWindow([mel([120, 127])]), { lo: 84, hi: 131 }); // keys past G9 are drawn empty
  assert.deepEqual(keyWindow([mel([0, 1])]), { lo: 0, hi: 47 });
});

test('keyLayout: 28 whites across four octaves from a C, blacks between their neighbours', () => {
  const k = keyLayout(36, 280);
  assert.equal(k.whites.length, 28);
  assert.equal(k.blacks.length, 20);
  assert.equal(k.ww, 10);
  const cs = k.xFor(37); // C#2
  const c = k.xFor(36), d = k.xFor(38);
  assert.ok(cs.black);
  assert.ok(cs.x > c.x && cs.x + cs.w < d.x + d.w);
  assert.ok(cs.x + cs.w / 2 > c.x + c.w - 1e-9 && cs.x + cs.w / 2 < d.x + 1e-9);
  assert.equal(k.xFor(83).x + k.xFor(83).w, 280);
});

test('keyLayout: xFor clamps out-of-window pitches to the edge keys', () => {
  const k = keyLayout(36, 280);
  assert.deepEqual(k.xFor(20), k.xFor(36));
  assert.deepEqual(k.xFor(100), k.xFor(83));
});

test('padLayout: pads are the eight most-played pitches, ascending left to right', () => {
  const notes = [];
  const pitches = [36, 38, 42, 46, 41, 43, 45, 49, 51]; // nine
  pitches.forEach((p, i) => { for (let n = 0; n < (p === 51 ? 1 : 3); n++) notes.push({ s: n * 100 + i, e: n * 100 + i + 10, p, v: 100 }); });
  const { pads, colFor } = padLayout([{ name: 'd', kind: 'drums', notes }]);
  assert.equal(pads.length, 8);
  assert.deepEqual(pads.map((p) => p.p), [36, 38, 41, 42, 43, 45, 46, 49]);
  assert.deepEqual(pads.map((p) => p.col), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(colFor(51), 7); // the dropped ride maps to the nearest kept pitch, the crash
  assert.equal(colFor(36), 0);
  assert.equal(pads[0].label, 'kick');
  assert.equal(pads[0].short, 'BD');
  assert.equal(padLayout([{ name: 'd', kind: 'drums', notes: [{ s: 0, e: 1, p: 77, v: 1 }] }]).pads[0].label, '#77');
});

test('padLayout: no drum tracks means no pads', () => {
  const { pads, colFor } = padLayout([mel([60])]);
  assert.equal(pads.length, 0);
  assert.equal(colFor(36), -1);
});

test('padWidth: a fifth of the width shared out, 12..32 each', () => {
  assert.equal(padWidth(640, 8), 16);
  assert.equal(padWidth(390, 8), 12);
  assert.equal(padWidth(1200, 2), 32);
  assert.equal(padWidth(640, 0), 0);
});

test('bpmAt: the entry at or before the frame, the first before any, the fallback when empty or absurd', () => {
  const tempo = [{ frame: 1000, bpm: 90 }, { frame: 5000, bpm: 120 }];
  assert.equal(bpmAt(tempo, 0), 90);
  assert.equal(bpmAt(tempo, 1000), 90);
  assert.equal(bpmAt(tempo, 4999), 90);
  assert.equal(bpmAt(tempo, 5000), 120);
  assert.equal(bpmAt(tempo, 1e9), 120);
  assert.equal(bpmAt([], 0), FALLBACK_BPM);
  assert.equal(bpmAt(null, 0), FALLBACK_BPM);
  assert.equal(bpmAt([{ frame: 0, bpm: 0 }], 10), FALLBACK_BPM);
  assert.equal(bpmAt([{ frame: 0, bpm: 661 }], 10), FALLBACK_BPM);
  assert.equal(PX_PER_BEAT, 44);
});
