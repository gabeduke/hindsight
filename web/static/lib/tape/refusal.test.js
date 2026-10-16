import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refusal, failToast, WAITING, WAITING_DETAIL } from './refusal.js';

test('the 409 for Rec says Waiting for rec to finish, with the line under it', () => {
  const r = refusal(409, { error: 'a track is already recording; end it first: …', reason: 'recording' });
  assert.equal(r.recording, true);
  assert.equal(r.message, 'Waiting for rec to finish');
  assert.match(r.detail, /work again once recording stops/);
});

test('another 409 keeps the Pi’s own words', () => {
  const r = refusal(409, { error: 'not now: a take is saving' });
  assert.equal(r.recording, false);
  assert.equal(r.message, 'not now: a take is saving');
  assert.equal(refusal(409, { error: 'an update is already under way' }).message, 'an update is already under way');
});

test('a reason on a status that is not 409 is not the recording wait', () => {
  assert.equal(refusal(500, { reason: 'recording' }).recording, false);
});

test('no body falls back to the status', () => {
  assert.equal(refusal(409, null).message, 'HTTP 409');
  assert.equal(refusal(502, {}).message, 'HTTP 502');
});

test('failToast warns with the waiting words for Rec and fails with the Pi’s words otherwise', () => {
  const seen = [];
  const toast = (m, k, o) => seen.push([m, k, o]);
  failToast(toast, 'Could not change the tape', { recording: true, message: WAITING });
  failToast(toast, 'Could not change the tape', { recording: false, message: 'not now: a take is saving' });
  assert.deepEqual(seen[0], [WAITING, 'warn', { detail: WAITING_DETAIL }]);
  assert.deepEqual(seen[1], ['Could not change the tape: not now: a take is saving', 'bad', undefined]);
});

test('the rig page and the Play bar read it too, and the toast has a second line', () => {
  const rig = readFileSync(new URL('../rig/page.js', import.meta.url), 'utf8');
  assert.match(rig, /refusal\(r\.status, b\)/);
  assert.match(rig, /failToast\(toast, /);
  const bar = readFileSync(new URL('../bar/tape-source.js', import.meta.url), 'utf8');
  assert.match(bar, /refusal\(res\.status/);
  assert.match(readFileSync(new URL('../toast.js', import.meta.url), 'utf8'), /opts\.detail/);
});

// The pages: each place that PATCHes the tape reads the reason, so none of
// them shows a raw "a track is already recording; end it first: …".
test('the tape page reads the reason where it calls the Pi, and says so through failToast', () => {
  const src = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*refusal[^}]*\} from '\.\/refusal\.js'/);
  assert.match(src, /refusal\(res\.status, b\)/);
  assert.equal((src.match(/failToast\(toast, /g) || []).length, 2, 'patch() and sendTrack()');
  assert.doesNotMatch(src, /toast\(`Could not change the tape: /);
});
