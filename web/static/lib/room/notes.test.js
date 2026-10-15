import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesOf, noteSpan, clipboardBody, sendToStudio, fmtAt, SPAN_SECONDS, freeFrame, fieldEnter } from './notes.js';

const SR = 48000;

test('notes are the flags in time order, numbered from 1, with their words', () => {
  const notes = notesOf([
    { id: 'r2', frame: 130 * SR, label: 'bass drifts' },
    { id: 'r1', frame: 42 * SR, label: 'the bridge. keep this' },
    { id: 'f9', frame: 185 * SR },
  ], SR);
  assert.deepEqual(notes.map((n) => [n.n, n.id, n.at, n.label]), [
    [1, 'r1', '0:42', 'the bridge. keep this'],
    [2, 'r2', '2:10', 'bass drifts'],
    [3, 'f9', '3:05', ''],
  ]);
  assert.deepEqual(notesOf(null), []);
});

test('a note reaches the next note when it comes sooner than eight bars', () => {
  const notes = notesOf([{ id: 'a', frame: 10 * SR }, { id: 'b', frame: 14 * SR }], SR);
  // 120 BPM: eight bars are 16 s; the next note is 4 s on.
  assert.deepEqual(noteSpan(notes, 'a', { sampleRate: SR, bpm: 120, total: 60 * SR }), { from: 10 * SR, to: 14 * SR });
});

test('a note reaches eight bars at the take’s tempo when the next note is further', () => {
  const notes = notesOf([{ id: 'a', frame: 0 }, { id: 'b', frame: 50 * SR }], SR);
  // 96 BPM: a bar is 2.5 s, eight are 20 s.
  assert.deepEqual(noteSpan(notes, 'a', { sampleRate: SR, bpm: 96, total: 60 * SR }), { from: 0, to: 20 * SR });
});

test('without a tempo a note reaches 16 s, and never past the take’s end', () => {
  const notes = notesOf([{ id: 'a', frame: 5 * SR }, { id: 'z', frame: 55 * SR }], SR);
  assert.deepEqual(noteSpan(notes, 'a', { sampleRate: SR, total: 60 * SR }), { from: 5 * SR, to: (5 + SPAN_SECONDS) * SR });
  assert.deepEqual(noteSpan(notes, 'z', { sampleRate: SR, total: 60 * SR }), { from: 55 * SR, to: 60 * SR });
});

test('a second note on the same frame does not end the first at once', () => {
  const notes = notesOf([{ id: 'a', frame: SR }, { id: 'b', frame: SR }, { id: 'c', frame: 3 * SR }], SR);
  assert.deepEqual(noteSpan(notes, 'a', { sampleRate: SR, total: 10 * SR }), { from: SR, to: 3 * SR });
});

test('nothing left after the mark, or no such note: no span', () => {
  const notes = notesOf([{ id: 'a', frame: 10 * SR }], SR);
  assert.equal(noteSpan(notes, 'a', { sampleRate: SR, total: 10 * SR }), null);
  assert.equal(noteSpan(notes, 'nope', { sampleRate: SR, total: 10 * SR }), null);
});

test('to the studio posts {take, from, to} to the clipboard and goes to the Studio', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init.method, JSON.parse(init.body)]); return { ok: true, json: async () => ({}) }; };
  const to = await sendToStudio('jam_a.wav', { from: 1, to: 9 }, { fetchImpl });
  assert.equal(to, '/tape.html');
  assert.deepEqual(calls, [['/api/clipboard', 'POST', { take: 'jam_a.wav', from: 1, to: 9 }]]);
  assert.deepEqual(clipboardBody('x.wav', { from: 2, to: 3 }), { take: 'x.wav', from: 2, to: 3 });
});

test('a refused copy says why, and goes nowhere', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: 'the tape is off (set TAPE=true)' }) });
  await assert.rejects(sendToStudio('jam_a.wav', { from: 1, to: 9 }, { fetchImpl }), /the tape is off/);
});

test('fmtAt', () => {
  assert.equal(fmtAt(0), '0:00');
  assert.equal(fmtAt(725 * SR, SR), '12:05');
});

test('Enter in the note field never writes over a note already at the playhead', () => {
  const notes = notesOf([{ id: 'r1', frame: 42 * SR, label: 'the bridge. keep this' }], SR);
  const act = fieldEnter({ words: 'new words', cursor: 42 * SR, notes, total: 60 * SR });
  assert.equal(act.kind, 'new');
  assert.notEqual(act.frame, 42 * SR);
  assert.equal(act.frame, 42 * SR + 1);
  assert.equal(act.words, 'new words');
});

test('Enter writes the words of the note NOTE HERE made, and nothing for no words', () => {
  const notes = notesOf([{ id: 'r1', frame: 5, label: '' }], SR);
  assert.deepEqual(fieldEnter({ current: { id: 'r1', frame: 5 }, words: ' a fill ', cursor: 99, notes }), { kind: 'edit', id: 'r1', words: 'a fill' });
  assert.deepEqual(fieldEnter({ words: '   ', cursor: 99, notes }), { kind: 'none' });
  assert.deepEqual(fieldEnter({ words: 'x', cursor: 99, notes, total: 200 }), { kind: 'new', frame: 99, words: 'x' });
});

test('a free frame: on, then back at the end, then none', () => {
  const at = (frames) => frames.map((frame) => ({ frame }));
  assert.equal(freeFrame(at([10, 11]), 10, 100), 12);
  assert.equal(freeFrame(at([98, 99]), 99, 100), 97);
  assert.equal(freeFrame(at([0, 1]), 0, 2), null);
});
