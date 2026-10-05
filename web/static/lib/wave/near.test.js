import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NearAudio, SPAN_MS } from './near.js';

// A WAV of `frames` mono 16-bit samples, sample k = k mod 1000 (so a test
// can tell which frames came back).
function wav(frames, sr = 48000) {
  const buf = new ArrayBuffer(44 + frames * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + frames * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, frames * 2, true);
  for (let k = 0; k < frames; k++) dv.setInt16(44 + k * 2, k % 1000, true);
  return buf;
}

test('it asks the slice endpoint for the span round the point, and caches it', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    const u = new URL(url, 'http://x');
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    return { ok: true, arrayBuffer: async () => wav(to - from) };
  };
  const near = new NearAudio({ file: 'jam a.wav', sampleRate: 48000, total: 480000, fetchFn });
  const half = (48000 * SPAN_MS) / 1000;
  const a = await near.around(100000);
  assert.equal(a.from, 100000 - half);
  assert.equal(a.x.length, 2 * half);
  assert.match(urls[0], /^\/api\/slice\?file=jam%20a\.wav&from=\d+&to=\d+$/);
  await near.around(100000 + 10); // within the same span: no new fetch
  assert.equal(urls.length, 1);
});

test('near the start or the end, the span stops at the take', async () => {
  const fetchFn = async (url) => {
    const u = new URL(url, 'http://x');
    return { ok: true, arrayBuffer: async () => wav(Number(u.searchParams.get('to')) - Number(u.searchParams.get('from'))) };
  };
  const near = new NearAudio({ file: 'a.wav', sampleRate: 48000, total: 30000, fetchFn });
  const a = await near.around(100);
  assert.equal(a.from, 0, 'at the start, it starts at 0');
  assert.equal(a.x.length, 100 + 12000);
  const z = await near.around(29900);
  assert.equal(z.from, 29900 - 12000);
  assert.equal(z.from + z.x.length, 30000, 'at the end, it stops at the take');
});

test('a failed load rejects, saying why, and a later call tries again', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const near = new NearAudio({ file: 'a.wav', sampleRate: 48000, total: 480000, fetchFn });
  await assert.rejects(near.around(100000), /404/);
  await assert.rejects(near.around(100000), /404/);
  assert.equal(calls, 2);
});
