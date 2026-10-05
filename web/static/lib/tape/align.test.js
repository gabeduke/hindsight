import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soundingAt, toFile, toTape, fileView, gridMove, beatGrid, clipUnder, placeAt,
  alignLand, alignView, clipNumber, alignReadout, padStart, hitIn, PAD_MS,
  alignEdge, refClipsNear, refHitNear, REACH_MS,
} from './align.js';

const sr = 48000;
const clip = { at: 100000, src: 480, frames: 96000, layer: 0, nudge_ms: 2.5 }; // heard 120 frames late

test('a clip sounds at its at plus its nudge, and tape and file frames map both ways', () => {
  assert.equal(soundingAt(clip, sr), 100120);
  assert.equal(soundingAt({ ...clip, nudge_ms: undefined }, sr), 100000);
  assert.equal(toFile(clip, 100120, sr), 480);
  assert.equal(toFile(clip, 101120, sr), 1480);
  assert.equal(toTape(clip, 1480, sr), 101120);
});

test('the view of the clip\'s file under a tape view', () => {
  assert.deepEqual(fileView(clip, { from: 100120, to: 100520 }, 400, sr), { start: 480, fpp: 1, width: 400 });
  assert.deepEqual(fileView(clip, { from: 90000, to: 130000 }, 400, sr), { start: 480 - 10120, fpp: 100, width: 400 });
});

test('Hit → Grid moves the hit onto the nearest line of the snap, or the beat with it off', () => {
  const grid = { frames: 480000, bars: 4 }; // 120000 a bar, 30000 a beat (96 BPM)
  assert.equal(gridMove(120119, grid, 'bar'), -119);
  assert.equal(gridMove(149880, grid, 'beat'), 120);
  assert.equal(gridMove(149880, grid, 'off'), 120);
  assert.equal(gridMove(16000, grid, '8th'), -1000);
  assert.equal(gridMove(5000, null, 'bar'), 0);
});

test('the tape grid as a beat grid', () => {
  assert.deepEqual(beatGrid({ frames: 480000, bars: 4 }, sr), { bpm: 96, sampleRate: sr, downbeat: 0 });
  assert.equal(beatGrid(null, sr).bpm, null);
});

test('the clip heard at a tape frame: the top layer where clips overlap', () => {
  const tr = { clips: [
    { at: 0, src: 0, frames: 48000, layer: 0 },
    { at: 24000, src: 0, frames: 48000, layer: 1 },
  ] };
  assert.equal(clipUnder(tr, 1000, sr).layer, 0);
  assert.equal(clipUnder(tr, 30000, sr).layer, 1);
  assert.equal(clipUnder(tr, 80000, sr), null);
  assert.equal(clipUnder({ clips: [] }, 0, sr), null);
});

test('a moved clip stays on the tape', () => {
  assert.equal(placeAt(clip, -119, 10000000), 99881);
  assert.equal(placeAt(clip, -200000, 10000000), 0);
  assert.equal(placeAt(clip, 9999999, 10000000), 9999999);
  assert.equal(placeAt(clip, 0.6, 10000000), 100001);
});

test('a move of the hit lands the whole clip, the nudge kept and counted', () => {
  // The hit is 500 frames into the clip, which sounds 120 frames after its at.
  assert.deepEqual(alignLand(clip, 100000, 500, 100720, 10000000, sr), { at: 100100, point: 100720 });
  // Mid-gesture the clip is at its previewed at, not its stored one.
  assert.deepEqual(alignLand(clip, 100100, 500, 100721, 10000000, sr), { at: 100101, point: 100721 });
  // Not before the tape's start: the hit stops where the clip does.
  assert.deepEqual(alignLand(clip, 100000, 500, 0, 10000000, sr), { at: 0, point: 620 });
});

test('a move stopped by the tape\'s start or end says which', () => {
  assert.equal(alignEdge(clip, 100000, 500, 100720, 10000000, sr), '');
  assert.equal(alignEdge(clip, 100000, 500, 0, 10000000, sr), 'start');
  // Stopped exactly at 0 gets there.
  assert.equal(alignEdge(clip, 100000, 500, 620, 10000000, sr), '');
  assert.equal(alignEdge(clip, 100000, 500, 200720, 200000, sr), 'end');
  assert.equal(alignEdge(clip, 100000, 500, 100720 + 99899, 200000, sr), '');
});

test('the view about the hit: centred, whole frames, within the tape and the zoom', () => {
  assert.deepEqual(alignView(100000, 10, 400, 10000000), { from: 98000, to: 102000 });
  // No closer than 8 px a sample.
  assert.deepEqual(alignView(100000, 0.01, 400, 10000000), { from: 99975, to: 100025 });
  // No wider than the tape, and not off its ends.
  assert.deepEqual(alignView(100, 1e6, 400, 48000), { from: 0, to: 48000 });
  assert.deepEqual(alignView(10, 10, 400, 48000), { from: 0, to: 4000 });
  assert.deepEqual(alignView(47990, 10, 400, 48000), { from: 44000, to: 48000 });
});

test('a clip is numbered by where it starts on its track', () => {
  const tr = { clips: [{ id: 'b', at: 500 }, { id: 'a', at: 0 }, { id: 'c', at: 500 }] };
  assert.equal(clipNumber(tr, { id: 'a' }), 1);
  assert.equal(clipNumber(tr, { id: 'b' }), 2);
  assert.equal(clipNumber(tr, { id: 'c' }), 3);
});

test('the readout: the point, its beat, and the reference track\'s hit', () => {
  const grid = { frames: 480000, bars: 4 }; // 30000 a beat
  assert.equal(alignReadout({ track: 2, n: 1, point: 30120, sampleRate: sr, grid, ref: null }),
    'Clip 2.1 0:00.627 +24 · +2.5 ms from 1.2');
  assert.equal(alignReadout({ track: 2, n: 1, point: 30000, sampleRate: sr, grid: null, ref: null }), 'Clip 2.1 0:00.625 +0');
  assert.equal(alignReadout({ track: 2, n: 3, point: 30000, sampleRate: sr, grid, ref: { track: 1, hit: 30000 } }),
    'Clip 2.3 0:00.625 +0 · on 1.2 · 0.0 ms from track 1');
  assert.equal(alignReadout({ track: 2, n: 1, point: 30000, sampleRate: sr, grid: null, ref: { track: 4, hit: 30062 } }),
    'Clip 2.1 0:00.625 +0 · −1.3 ms from track 4');
  // No hit found: the point is the clip's start.
  assert.equal(alignReadout({ track: 2, n: 1, point: 30000, sampleRate: sr, grid, ref: null, start: true }),
    'Clip 2.1 start 0:00.625 +0 · on 1.2');
});

test('padStart mirrors the overhang back and forth in front of a file\'s start', () => {
  const x = Float32Array.from([1, 2, 3, 4, 5]);
  const p = padStart({ x, from: 0 }, 2, 40); // 150 ms at 40 Hz: 6 frames
  assert.equal(p.from, -6);
  assert.deepEqual([...p.x], [2, 1, 1, 2, 2, 1, 1, 2, 3, 4, 5]);
  // Further into the file, or with nothing before the clip, it is left alone.
  const later = { x, from: 100 };
  assert.equal(padStart(later, 2, 40), later);
  const none = { x, from: 0 };
  assert.equal(padStart(none, 0, 40), none);
  assert.equal(PAD_MS, 150);
});

// A pool file as a catch leaves it: 10 ms before the clip's src, a held
// chord, and (maybe) a click on top of it.
function poolFile(clickAt, len = 12480) {
  const x = new Float32Array(len);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let n = 0; n < len; n++) x[n] = 0.2 * Math.sin((2 * Math.PI * 110 * n) / sr) + 0.1 * Math.sin((2 * Math.PI * 165 * n) / sr);
  if (clickAt != null) for (let n = clickAt; n < Math.min(len, clickAt + 4800); n++) x[n] += 0.8 * rnd() * Math.exp(-(n - clickAt) / 600);
  return x;
}

test('a clip\'s first hit just after its src is found, padded; a held note or an earlier click is not', () => {
  const src = 480; // 10 ms of overhang
  const first = (x) => hitIn(padStart({ x, from: 0 }, src, sr), src, src + Math.round(sr * 0.06), sr);
  for (const ms of [5, 30, 55]) {
    const at = src + Math.round((ms * sr) / 1000);
    const x = poolFile(at);
    const j = first(x);
    assert.ok(Math.abs(j - at) <= sr / 1000, `${ms} ms in: found ${j}, not ${at}`);
    // Unpadded, Attack can't see that far back: the reason for the padding.
    assert.equal(hitIn({ x, from: 0 }, src, src + Math.round(sr * 0.06), sr), -1);
  }
  assert.equal(first(poolFile(null)), -1);
  const early = first(poolFile(src - 240));
  assert.ok(early === -1 || early <= src, `a click 5 ms before src: ${early}`);
});

test('hitIn searches only its window', () => {
  const x = poolFile(12000, 24000);
  const audio = { x, from: 50000 };
  assert.ok(Math.abs(hitIn(audio, 61000, 63000, sr) - 62000) <= 48);
  assert.equal(hitIn(audio, 62500, 64000, sr), -1);
  assert.equal(hitIn(audio, 90000, 91000, sr), -1); // past the audio
});

test('what of a reference track is heard within reach: the top layer, each copy apart', () => {
  const lo = { id: 'lo', at: 0, src: 0, frames: 48000, layer: 0 };
  const top = { id: 'top', at: 24000, src: 0, frames: 48000, layer: 1 };
  const tr = { clips: [lo, top] };
  assert.deepEqual(refClipsNear(tr, 22000, 4000, sr),
    [{ clip: lo, from: 18000, to: 24000 }, { clip: top, from: 24000, to: 26001 }]);
  // Under the top layer the lower one isn't heard.
  assert.deepEqual(refClipsNear(tr, 40000, 4000, sr), [{ clip: top, from: 36000, to: 44001 }]);
  // Before a clip's start, its start is in reach.
  assert.deepEqual(refClipsNear({ clips: [top] }, 23900, 2880, sr), [{ clip: top, from: 24000, to: 26781 }]);
  // A nudge counts: the clip is heard 120 frames late.
  const n = { ...top, nudge_ms: 2.5 };
  assert.deepEqual(refClipsNear({ clips: [n] }, 23900, 2880, sr), [{ clip: n, from: 24120, to: 26781 }]);
  assert.deepEqual(refClipsNear(tr, 100000, 2880, sr), []);
  assert.deepEqual(refClipsNear({ clips: [] }, 0, 2880, sr), []);
});

// A pool file with hits at each of clicks.
function hits(clicks, len) {
  const x = poolFile(null, len);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const c of clicks) for (let n = c; n < Math.min(len, c + 4800); n++) x[n] += 0.8 * rnd() * Math.exp(-(n - c) / 600);
  return x;
}

test('Hit → Track finds the reference hit at a clip\'s start when the point is early', async () => {
  const R = Math.round((sr * REACH_MS) / 1000);
  const src = 480; // 10 ms of overhang, as a catch leaves it
  const audioOf = (x) => async () => ({ x, from: 0 });
  // The kick 0.5 ms into the clip; the point 2 ms before the clip starts.
  const one = { id: 'one', at: 200000, src, frames: 24000, layer: 0 };
  const x1 = hits([src + 24], 30000);
  const h1 = await refHitNear(refClipsNear({ clips: [one] }, 199904, R, sr), 199904, sr, audioOf(x1));
  assert.ok(h1 && h1.clip === one && Math.abs(h1.at - 200024) <= 48, `found ${h1 && h1.at}`);
  // A tiled loop: two copies end to end of the same file, which runs on past
  // the clip into the next bar's kick. The point is 2 ms before the second
  // copy's kick: that kick, not the first copy's, which it can't hear.
  const F = 24000;
  const a = { id: 'a', at: 200000, src, frames: F, layer: 0 };
  const b = { id: 'b', at: 200000 + F, src, frames: F, layer: 0 };
  const xt = hits([src + 24, src + F + 24], src + F + 4800);
  const p = 200000 + F + 24 - 96;
  const spans = refClipsNear({ clips: [a, b] }, p, R, sr);
  assert.deepEqual(spans.map((s) => s.clip.id), ['a', 'b']);
  const h2 = await refHitNear(spans, p, sr, audioOf(xt));
  assert.ok(h2 && h2.clip === b && Math.abs(h2.at - (200000 + F + 24)) <= 48, `found ${h2 && h2.clip.id} ${h2 && h2.at}`);
  // Nothing within reach, or no hit in it: nothing.
  assert.equal(await refHitNear(refClipsNear({ clips: [one] }, 100000, R, sr), 100000, sr, audioOf(x1)), null);
  assert.equal(await refHitNear(refClipsNear({ clips: [one] }, 210000, R, sr), 210000, sr, audioOf(x1)), null);
});
