import test from 'node:test';
import assert from 'node:assert/strict';
import { Audition } from './audition.js';

// A stand-in AudioContext: decodes anything to a buffer `seconds` long.
function fakeCtx(seconds = 2) {
  const started = [];
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 10; this.destination = {}; }
    async resume() {}
    async decodeAudioData() { return { duration: seconds }; }
    createBufferSource() {
      return { loop: false, connect() {}, disconnect() {}, start(t) { started.push(this); this.at = t; }, stop() { this.stopped = true; } };
    }
  }
  return { Ctx, started };
}

test('AUDITION fetches the clipboard’s audio with the browser’s own fetch', async () => {
  // fetch must be called as itself: called as the Audition's method it
  // throws "Illegal invocation", and audition never played.
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = function (url) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    asked.push(url);
    return Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  };
  try {
    const { Ctx, started } = fakeCtx();
    const a = new Audition({ Ctx });
    await a.play('k1');
    assert.equal(a.playing, true);
    assert.match(asked[0], /^\/api\/clipboard\/audio\?k=k1$/);
    assert.equal(started[0].loop, true, 'it loops');
  } finally {
    globalThis.fetch = was;
  }
});

test('it plays on this device, loops from the top, and a new buffer starts again', async () => {
  const { Ctx, started } = fakeCtx(2);
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  let changes = 0;
  const a = new Audition({ Ctx, fetchImpl, onChange: () => changes++ });
  await a.play('one');
  await a.play('one'); // the same buffer: left playing
  assert.equal(started.length, 1);
  a.ctx.currentTime = started[0].at + 2.5;
  assert.equal(Math.round(a.at() * 10) / 10, 0.5, 'round the loop');
  await a.play('two');
  assert.equal(started.length, 2);
  assert.equal(started[0].stopped, true);
  a.stop();
  assert.equal(a.playing, false);
  assert.equal(a.at(), null);
  assert.ok(changes >= 3);
});

test('an empty buffer says so', async () => {
  const { Ctx } = fakeCtx();
  const a = new Audition({ Ctx, fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(a.play('x'), /the buffer is empty/);
  assert.equal(a.playing, false);
});
