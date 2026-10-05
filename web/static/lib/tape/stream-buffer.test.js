import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePacket, StampLog, heardIndex, nextBackoff } from './stream-buffer.js';

function packet(frame, pos, playing, frames = 4) {
  const b = new ArrayBuffer(24 + frames * 4);
  const v = new DataView(b);
  'HSTR'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint8(4, 1);
  v.setUint8(5, playing ? 1 : 0);
  v.setBigUint64(8, BigInt(frame), true);
  v.setBigInt64(16, BigInt(pos), true);
  v.setInt16(24, 1234, true);
  return b;
}

test('a packet parses', () => {
  const p = parsePacket(packet(96000, 4800, true));
  assert.deepEqual([p.frame, p.pos, p.playing, p.pcm.length, p.pcm[0]], [96000, 4800, true, 8, 1234]);
  assert.equal(parsePacket(new ArrayBuffer(10)), null);
});

test('the heard position runs on from the last stamp', () => {
  const log = new StampLog();
  log.add(0, { frame: 1000, pos: 5000, playing: true });
  log.add(960, { frame: 1960, pos: 5960, playing: true });
  assert.deepEqual(log.at(1000, null), { frame: 2000, pos: 6000, playing: true });
  assert.equal(log.at(-5, null), null);
});

test('heard position wraps at the loop\'s Out', () => {
  const log = new StampLog();
  log.add(0, { frame: 0, pos: 95500, playing: true });
  const loop = { in: 0, out: 96000, on: true };
  assert.equal(log.at(400, loop).pos, 95900);
  assert.equal(log.at(700, loop).pos, 200);
});

test('stopped, the position stands', () => {
  const log = new StampLog();
  log.add(0, { frame: 0, pos: 777, playing: false });
  assert.equal(log.at(500, null).pos, 777);
});

test('the heard index is the read index, plus time since, less the output latency', () => {
  assert.equal(heardIndex({ rd: 48000, at: 10 }, 10.5, 48000, 0.02), 48000 + 24000 - 960);
});

test('reconnects back off to five seconds', () => {
  assert.deepEqual([0, 500, 1000, 2000, 4000].map(nextBackoff), [500, 1000, 2000, 4000, 5000]);
  assert.equal(nextBackoff(5000), 5000);
});
