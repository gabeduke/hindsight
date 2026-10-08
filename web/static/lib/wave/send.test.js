import test from 'node:test';
import assert from 'node:assert/strict';
import { sendHint, sentMessage, fmtBpm, FIRST_LOOP_MAX_S } from './send.js';

const sr = 48000;

test('a take with a tempo says where the downbeat goes, whole or selected', () => {
  assert.equal(
    sendHint({ bpm: 120, region: null, total: 420 * sr, sr }),
    'Sends the whole take at 120 BPM, its downbeat on a tape bar line',
  );
  assert.equal(
    sendHint({ bpm: 125.25, region: { start: 10, end: 100 }, total: 420 * sr, sr }),
    'Sends the selection at 125.25 BPM, its downbeat on a tape bar line',
  );
});

test('a long take with a tempo is not called a loop however long it is', () => {
  assert.doesNotMatch(sendHint({ bpm: 96, region: null, total: 900 * sr, sr }), /loop/);
});

test('a short take with no tempo says it becomes the first loop on an empty tape', () => {
  const h = sendHint({ bpm: null, region: { start: 0, end: 8 * sr }, total: 30 * sr, sr });
  assert.match(h, /selection/);
  assert.match(h, /loop that sets its tempo/);
});

test('past a minute with no tempo it says one clip, no loop', () => {
  const edge = FIRST_LOOP_MAX_S * sr;
  assert.match(sendHint({ bpm: 0, region: null, total: edge, sr }), /loop that sets its tempo/);
  assert.match(sendHint({ bpm: 0, region: null, total: edge + 1, sr }), /one clip, no loop/);
  assert.match(sendHint({ bpm: undefined, region: { start: 0, end: edge + 1 }, total: 900 * sr, sr }), /one clip, no loop/);
});

test('a tempo outside what a tape can hold is no tempo', () => {
  assert.match(sendHint({ bpm: 5, region: null, total: 10 * sr, sr }), /loop that sets its tempo/);
});

test('tempos read as the take page reads them', () => {
  assert.equal(fmtBpm(120), '120');
  assert.equal(fmtBpm(125.2500001), '125.25');
  assert.equal(fmtBpm(83.4), '83.4');
});

test('what a send did is said in the words of what it did', () => {
  assert.deepEqual(sentMessage({ mode: 'grid', bar: 2, bpm: 120, tempo_set: true }, '7:02'), {
    msg: 'Sent 7:02 to tape, track 1: the downbeat on tape bar 2, the tape is now 120 BPM', kind: 'ok',
  });
  assert.equal(sentMessage({ mode: 'grid', bar: 5, bpm: 120 }, '1:00').msg, 'Sent 1:00 to tape, track 1: the downbeat on tape bar 5');
  assert.match(sentMessage({ mode: 'first-loop', bpm: 92 }, '0:08').msg, /a loop at 92 BPM/);
  assert.match(sentMessage({ mode: 'linear' }, '3:00').msg, /one clip, no loop, no tempo/);
});

test('a tempo that did not match is a warning, with what the Pi said', () => {
  const r = sentMessage({ mode: 'as-is', warning: 'The take is 100.00 BPM and the tape is 120.00.' }, '0:30', 2);
  assert.equal(r.kind, 'warn');
  assert.match(r.msg, /^Sent 0:30 to tape, track 2\. The take is 100\.00 BPM/);
  assert.equal(sentMessage({ mode: 'as-is' }, '0:30').kind, 'ok');
});

test('a send that left the downbeat out says it is on the bar lines, not which bar', () => {
  assert.equal(sentMessage({ mode: 'grid', bpm: 120 }, '0:10').msg, "Sent 0:10 to tape, track 1: on the tape's bar lines");
});
