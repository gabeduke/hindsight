import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, PX_PER_BEAT, FALLBACK_BPM, isBlack, keyWindow, keyLayout, padLayout, padWidth, bpmAt,
  newCursor, activeNotes, noteBars, glow, yAt, MIN_DRUM_PX, KEY_H,
} from './rising.js';
import { alphaFor, laneColors } from './lanes.js';

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

// 48 kHz, 120 bpm: 24000 frames per beat. Canvas 640 wide, keyboard top at
// y=400 (so riseH = 400 ≈ 9.09 beats), 8 drum pads 16px each = 128px column.
function geoFor(tracks) {
  const pads = padLayout(tracks);
  const padW = padWidth(640, pads.pads.length);
  const padCol = padW * pads.pads.length;
  return {
    fpb: 24000, keyTop: 400, riseH: 400,
    keys: keyLayout(keyWindow(tracks).lo, 640 - padCol), pads, padW, padCol,
    muted: new Set(), colors: laneColors(tracks), cursors: new Map(),
  };
}
const melodic = { name: 'bento ch2', kind: 'notes', notes: [
  { s: 0, e: 24000, p: 60, v: 127 },       // one beat, C4
  { s: 48000, e: 72000, p: 64, v: 64 },    // E4, beats 2..3
  { s: 96000, e: 480000, p: 20, v: 100 },  // below the window, held 16 beats
  { s: 500000, e: 524000, p: 62, v: 100 }, // in the future for every `now` below
] };
const drums = { name: 'bento ch1', kind: 'drums', notes: [
  { s: 0, e: 480, p: 36, v: 127 },
  { s: 24000, e: 24480, p: 38, v: 64 },
] };

test('yAt: the keyboard top is now, one beat ago is PX_PER_BEAT above it', () => {
  assert.equal(yAt(24000, 24000, 24000, 400), 400);
  assert.equal(yAt(0, 24000, 24000, 400), 400 - PX_PER_BEAT);
});

test('activeNotes: forward, each note is visited once as it starts and dropped once past the floor', () => {
  const cur = newCursor();
  const horizon = 24000; // 1 beat
  let active = activeNotes(melodic, cur, 0, horizon);
  assert.equal(cur.i, 1); // only the note starting at 0 has begun
  assert.deepEqual(active.map((n) => n.p), [60]);
  active = activeNotes(melodic, cur, 48000, horizon); // E4 starts, C4 (ended exactly at the floor) still active
  assert.equal(cur.i, 2);
  assert.deepEqual(active.map((n) => n.p), [60, 64]);
  active = activeNotes(melodic, cur, 96000, horizon); // the long low note starts; C4 is past the floor, E4 (ended exactly at it) is not
  assert.equal(cur.i, 3);
  assert.deepEqual(active.map((n) => n.p), [64, 20]);
});

test('activeNotes: a backward seek rebuilds from the start', () => {
  const cur = newCursor();
  activeNotes(melodic, cur, 100000, 24000);
  assert.ok(cur.i > 0);
  const active = activeNotes(melodic, cur, 0, 24000);
  assert.equal(cur.i, 1);
  assert.deepEqual(active.map((n) => n.p), [60]);
});

test('activeNotes: a note spanning the whole take is visited once and stays active without rescanning', () => {
  const track = { name: 'x', kind: 'notes', notes: [{ s: 0, e: 480000, p: 60, v: 100 }] };
  const cur = newCursor();
  const horizon = 24000;
  activeNotes(track, cur, 240000, horizon);
  assert.equal(cur.i, 1);
  const active = activeNotes(track, cur, 480000, horizon);
  assert.equal(cur.i, 1);
  assert.ok(active.length <= 2);
  const geo = { ...geoFor([track]), cursors: new Map() };
  const bars = noteBars([track], 480000, geo).filter((b) => !b.drum);
  assert.ok(bars.some((b) => b.y1 === 400)); // still sounding, drawn to keyTop
});

test('noteBars: a sounding note is anchored to the keyboard and grows with time', () => {
  const geo = geoFor([melodic]);
  const at = (now) => noteBars([melodic], now, geo).filter((b) => !b.drum);
  const half = at(12000);
  assert.equal(half.length, 1);
  assert.equal(half[0].y1, 400);
  assert.ok(Math.abs(half[0].y0 - (400 - PX_PER_BEAT / 2)) < 1e-9);
  assert.equal(half[0].alpha, alphaFor(127));
  assert.equal(half[0].clamp, 0);
  assert.equal(half[0].color, laneColors([melodic])[0]);
  const c4 = geo.keys.xFor(60);
  assert.equal(half[0].x, c4.x + geo.padCol);
  assert.equal(half[0].w, c4.w);
});

test('noteBars: a finished note lifts off and fades as it rises', () => {
  const geo = geoFor([melodic]);
  const bars = noteBars([melodic], 48000, geo).filter((b) => !b.drum); // C4 ended one beat ago; E4 starts now
  const c4 = bars.find((b) => b.x === geo.keys.xFor(60).x + geo.padCol);
  assert.ok(c4);
  assert.ok(c4.y1 < 400);
  assert.ok(Math.abs(c4.y1 - (400 - PX_PER_BEAT)) < 1e-9);
  assert.ok(Math.abs((c4.y1 - c4.y0) - PX_PER_BEAT) < 1e-9);
  assert.ok(c4.alpha < alphaFor(127) && c4.alpha > 0);
  const e4 = bars.find((b) => b.x === geo.keys.xFor(64).x + geo.padCol);
  assert.ok(e4 && e4.y1 === 400);
});

test('noteBars: nothing from the future, nothing past the top, nothing from a muted track', () => {
  const geo = geoFor([melodic]);
  assert.equal(noteBars([melodic], 100000, geo).some((b) => b.x === geo.keys.xFor(62).x + geo.padCol), false);
  // 30 beats later the C4 bar (ended at beat 1) is far above the top and gone
  const late = noteBars([melodic], 24000 * 31, geo);
  assert.equal(late.some((b) => b.x === geo.keys.xFor(60).x + geo.padCol), false);
  const muted = { ...geo, muted: new Set(['bento ch2']) };
  assert.equal(noteBars([melodic], 12000, muted).length, 0);
});

test('noteBars: a long note whose start has risen off the top is still drawn from y=0', () => {
  const geo = geoFor([melodic]);
  const bars = noteBars([melodic], 96000 + 24000 * 12, geo); // 12 beats into the 16-beat low note
  const low = bars.find((b) => b.clamp === -1);
  assert.ok(low, 'the below-window note is present, clamped to the low edge');
  assert.equal(low.y0, 0);
  assert.equal(low.y1, 400);
  assert.equal(low.x, geo.keys.xFor(geo.keys.lo).x + geo.padCol);
});

test('noteBars: a note above the window draws on the top edge key with clamp: 1', () => {
  const high = { name: 'high', kind: 'notes', notes: [{ s: 0, e: 24000, p: 60, v: 100 }, { s: 0, e: 24000, p: 200, v: 100 }] };
  const geo = geoFor([high]);
  const bars = noteBars([high], 12000, geo);
  const top = bars.find((b) => b.clamp === 1);
  assert.ok(top, 'the above-window note is present, clamped to the high edge');
  assert.equal(top.x, geo.keys.xFor(geo.keys.hi).x + geo.padCol);
});

test('noteBars: drum hits rise from their pad column and are never thinner than MIN_DRUM_PX', () => {
  const tracks = [drums, melodic];
  const geo = geoFor(tracks);
  const hit = noteBars(tracks, 240, geo).filter((b) => b.drum); // kick sounding, 240 of 480 frames in
  assert.equal(hit.length, 1);
  assert.equal(hit[0].x, 0 * geo.padW);
  assert.equal(hit[0].w, geo.padW);
  assert.equal(hit[0].y1, 400);
  assert.equal(hit[0].y1 - hit[0].y0, MIN_DRUM_PX);
  const snare = noteBars(tracks, 24480, geo).filter((b) => b.drum).find((b) => b.x === 1 * geo.padW);
  assert.ok(snare);
  assert.equal(snare.color, laneColors(tracks)[0]);
});

test('glow: full at note-off, gone one beat later, the stronger of two wins; pads flash 0.3 beat', () => {
  const tracks = [drums, melodic];
  const geo = geoFor(tracks);
  const on = glow(tracks, 12000, geo);
  assert.equal(on.keys.get(60).alpha, alphaFor(127));
  assert.ok(Math.abs(glow(tracks, 24000, geo).keys.get(60).alpha - alphaFor(127)) < 1e-9);
  assert.ok(Math.abs(glow(tracks, 36000, geo).keys.get(60).alpha - alphaFor(127) / 2) < 1e-9);
  assert.equal(glow(tracks, 48000, geo).keys.has(60), false);
  const two = { name: 'two', kind: 'notes', notes: [{ s: 0, e: 100, p: 60, v: 10 }, { s: 0, e: 100, p: 60, v: 127 }] };
  assert.equal(glow([two], 50, geoFor([two])).keys.get(60).alpha, alphaFor(127));
  assert.equal(on.pads.has(0), false); // the kick's flash ended 0.3 beat after its note-off at 480
  assert.equal(glow(tracks, 240, geo).pads.get(0).alpha, alphaFor(127));
  assert.equal(glow(tracks, 480 + 0.3 * 24000 + 1, geo).pads.has(0), false);
  const muted = { ...geo, muted: new Set(['bento ch2']) };
  assert.equal(glow(tracks, 12000, muted).keys.has(60), false);
});
