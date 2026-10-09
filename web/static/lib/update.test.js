import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buttonLabel, phase } from './update.js';

const T = 'v2026.10.09.2';
const since = Date.parse('2026-10-09T15:00:00Z');
const at = (s) => new Date(since + s * 1000).toISOString();

test('the footer offers an update only when there is one', () => {
  assert.equal(buttonLabel({ running: 'v2026.10.09.1', latest: T, available: true }), `Update to ${T}`);
  assert.equal(buttonLabel({ running: T, latest: T, available: false }), '');
  assert.equal(buttonLabel(null), '');
});

test('over a dev build it is an install', () => {
  assert.equal(buttonLabel({ running: 'dev', latest: T, available: true }), `Install ${T}`);
});

test('done once the new version answers', () => {
  const p = phase(T, since, null, { version: T });
  assert.equal(p.done, true);
  assert.equal(p.ok, true);
});

test('Restarting… while nothing answers', () => {
  assert.deepEqual(phase(T, since, null, null), { done: false, text: 'Restarting…' });
});

test('follows the updater’s own steps', () => {
  const info = { update: { state: 'downloading', tag: T, message: `downloading ${T}`, at: at(3) } };
  assert.equal(phase(T, since, info, { version: 'v2026.10.09.1' }).text, `Downloading ${T}…`);
});

test('a rollback ends it, with the updater’s words', () => {
  const info = { update: { state: 'rolled_back', tag: T, message: 'didn’t come up; still on v2026.10.09.1', at: at(40) } };
  const p = phase(T, since, info, { version: 'v2026.10.09.1' });
  assert.equal(p.done, true);
  assert.equal(p.ok, false);
  assert.match(p.text, /still on v2026\.10\.09\.1/);
});

test('a step stamped the second the Pi queued it is this run’s', () => {
  const info = { update: { state: 'queued', tag: T, message: 'waiting for the updater to start', at: at(0) } };
  assert.equal(phase(T, since, info, { version: 'v2026.10.09.1' }).text, 'Waiting for the updater to start…');
});

test('last time’s failure, or another tag’s, is not this one’s', () => {
  const old = { update: { state: 'failed', tag: T, message: 'old', at: at(-1) } };
  assert.equal(phase(T, since, old, { version: 'v2026.10.09.1' }).done, false);
  const other = { update: { state: 'rolled_back', tag: 'v2026.10.08.1', message: 'other', at: at(5) } };
  assert.equal(phase(T, since, other, { version: 'v2026.10.09.1' }).done, false);
});
