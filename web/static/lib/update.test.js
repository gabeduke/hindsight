import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buttonLabel, phase, plan, cmpVersion, versionParts } from './update.js';

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

// --- the releases sheet ------------------------------------------------------


const RELEASES = [
  { tag: 'v2026.10.09.10', changes: ['Ten'] },
  { tag: 'v2026.10.09.9', changes: ['Nine'] },
  { tag: 'v2026.10.09.5', changes: ['Five a', 'Five b'] },
  { tag: 'v2026.10.09.4', changes: ['Four'] },
  { tag: 'v2026.10.09.3', changes: ['Three'] },
];

test('versions compare by number, and a deploy.sh stamp as its release', () => {
  assert.equal(cmpVersion('v2026.10.09.10', 'v2026.10.09.9'), 1);
  assert.equal(cmpVersion('v2026.10.09.3-4-gabc1234', 'v2026.10.09.3'), 0);
  assert.equal(cmpVersion('dev', 'v2026.10.09.3'), null);
  assert.deepEqual(versionParts('v2026.10.09.3+dirty'), [2026, 10, 9, 3]);
});

test('a stamped deploy.sh build is updated, not installed over', () => {
  assert.equal(buttonLabel({ running: 'v2026.10.09.3-4-gabc1234', latest: T, available: true }), `Update to ${T}`);
});

test('going forward brings in every release after the running one', () => {
  const p = plan(RELEASES, 'v2026.10.09.4', 'v2026.10.09.10');
  assert.equal(p.action, 'Update to v2026.10.09.10');
  assert.equal(p.way, 'forward');
  assert.deepEqual(p.groups.map((g) => g.tag), ['v2026.10.09.10', 'v2026.10.09.9', 'v2026.10.09.5']);
});

test('going back takes out every release after the pick', () => {
  const p = plan(RELEASES, 'v2026.10.09.9', 'v2026.10.09.4');
  assert.equal(p.action, 'Go back to v2026.10.09.4');
  assert.equal(p.way, 'back');
  assert.deepEqual(p.groups.map((g) => g.tag), ['v2026.10.09.9', 'v2026.10.09.5']);
  assert.deepEqual(p.groups[1].changes, ['Five a', 'Five b']);
});

test('the running release has nothing to do', () => {
  const p = plan(RELEASES, 'v2026.10.09.5', 'v2026.10.09.5');
  assert.equal(p.action, '');
  assert.equal(p.way, 'same');
});

test('a deploy.sh build can go back to the release it was built on', () => {
  const p = plan(RELEASES, 'v2026.10.09.5-2-gabc1234', 'v2026.10.09.5');
  assert.equal(p.way, 'back');
  assert.match(p.action, /^Go back to/);
  assert.equal(p.groups.length, 0);
  assert.match(p.note, /commits/);
});

test('over a dev build it shows what the release itself changed', () => {
  const p = plan(RELEASES, 'dev', 'v2026.10.09.4');
  assert.equal(p.action, 'Install v2026.10.09.4');
  assert.deepEqual(p.groups, [{ tag: 'v2026.10.09.4', changes: ['Four'] }]);
});
