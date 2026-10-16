import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refusal, readResponse, failToast, editTape, WAITING, WAITING_DETAIL } from './refusal.js';

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const PI_TEXT = 'a track is already recording; end it first: what’s armed waits until it ends';

test('the 409 for an edit while Rec is armed is read as the recording wait, and the Pi’s text is kept', () => {
  const r = refusal(409, { error: PI_TEXT, reason: 'recording' });
  assert.equal(r.recording, true);
  assert.equal(r.message, PI_TEXT);
  assert.match(r.detail, /work again once recording stops/);
});

test('another 409 has no wait, and keeps the Pi’s own words', () => {
  const r = refusal(409, { error: 'not now: a take is saving' });
  assert.equal(r.recording, false);
  assert.equal(r.message, 'not now: a take is saving');
});

test('a mixdown or a second record refused for Rec has no reason and so no wait', () => {
  // The Pi's 409 for those carries the sentence and no reason.
  assert.equal(refusal(409, { error: 'a track is already recording; end it first' }).recording, false);
});

test('a reason on a status that is not 409 is not the recording wait', () => {
  assert.equal(refusal(500, { reason: 'recording' }).recording, false);
});

test('no body falls back to the status', () => {
  assert.equal(refusal(409, null).message, 'HTTP 409');
  assert.equal(refusal(502, {}).message, 'HTTP 502');
});

test('the error a call throws keeps the Pi’s text: mixdown and record while recording read as they always did', async () => {
  for (const [what, text] of [['mixdown', 'a track is already recording; end it first'], ['record', 'a track is already recording; end it first']]) {
    await assert.rejects(readResponse(reply(409, { error: text })), (e) => {
      assert.equal(e.message, text, what);
      assert.equal(e.recording, false);
      assert.equal(e.status, 409);
      return true;
    });
  }
});

test('an edit’s refusal keeps the Pi’s text in e.message and marks e.recording', async () => {
  await assert.rejects(readResponse(reply(409, { error: PI_TEXT, reason: 'recording' })), (e) => {
    assert.equal(e.message, PI_TEXT);
    assert.equal(e.reason, 'recording');
    assert.equal(e.recording, true);
    return true;
  });
});

test('failToast warns with the waiting words for an edit and fails with the Pi’s words otherwise', () => {
  const seen = [];
  const toast = (m, k, o) => seen.push([m, k, o]);
  failToast(toast, 'Could not change the tape', { recording: true, message: PI_TEXT });
  failToast(toast, 'Could not mix down', { recording: false, message: 'a track is already recording; end it first' });
  assert.deepEqual(seen[0], [WAITING, 'warn', { detail: WAITING_DETAIL }]);
  assert.deepEqual(seen[1], ['Could not mix down: a track is already recording; end it first', 'bad', undefined]);
});

// patch() in page.js is editTape over change(api(PATCH)): this runs that path
// against a stub fetch.
test('an edit the Pi refuses with 409 recording: the toast has its detail line, the page is resynced, it says false', async () => {
  const toasts = [];
  let polled = 0;
  const fetchStub = async () => reply(409, { error: PI_TEXT, reason: 'recording' });
  const ok = await editTape(async () => readResponse(await fetchStub('/api/tapes?id=x', { method: 'PATCH' })), {
    toast: (m, k, o) => toasts.push([m, k, o]),
    resync: () => { polled++; },
  });
  assert.equal(ok, false);
  assert.equal(polled, 1);
  assert.deepEqual(toasts, [[WAITING, 'warn', { detail: WAITING_DETAIL }]]);
});

test('an edit refused for another reason says the Pi’s words and also resyncs', async () => {
  const toasts = [];
  let polled = 0;
  const ok = await editTape(async () => readResponse(reply(409, { error: 'not now: a take is saving' })), {
    toast: (m, k) => toasts.push([m, k]), resync: () => { polled++; },
  });
  assert.equal(ok, false);
  assert.equal(polled, 1);
  assert.deepEqual(toasts, [['Could not change the tape: not now: a take is saving', 'bad']]);
});

test('an edit that works says true and resyncs nothing', async () => {
  let polled = 0;
  const ok = await editTape(async () => readResponse(reply(200, {})), { toast: () => assert.fail(), resync: () => { polled++; } });
  assert.equal(ok, true);
  assert.equal(polled, 0);
});

test('the pages go through these: patch is editTape, the API helper reads the response with readResponse, and no caller rewrites the Pi’s text', () => {
  const src = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
  assert.match(src, /return editTape\(/);
  assert.match(src, /readResponse\(await pending\)/);
  assert.match(src, /poll\(true\)/);
  assert.equal((src.match(/failToast\(toast, /g) || []).length, 1, 'sendTrack arm and disarm');
  assert.doesNotMatch(src, /toast\(`Could not change the tape: /);
  const rig = readFileSync(new URL('../rig/page.js', import.meta.url), 'utf8');
  assert.match(rig, /failToast\(toast, /);
  const bar = readFileSync(new URL('../bar/tape-source.js', import.meta.url), 'utf8');
  assert.match(bar, /refusal\(res\.status/);
  assert.match(readFileSync(new URL('../toast.js', import.meta.url), 'utf8'), /opts\.detail/);
});
