// web/static/lib/rooms/face.test.js
// The Studio's face (lib/rooms/face.js): the tape's or the feed's, written
// on the Studio's root and kept on this device.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFace, FACES, KEY } from './face.js';

/** A root that keeps its attributes, as main#view-studio does. */
function fakeRoot() {
  const attrs = new Map();
  return { attrs, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null };
}

/** A storage that keeps strings, as localStorage does. */
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('the faces are the tape and the feed, the tape first', () => {
  assert.deepEqual([...FACES], ['tape', 'feed']);
});

test('a device that never turned starts on the tape, and says so on the root', () => {
  const root = fakeRoot();
  const face = createFace({ root, storage: fakeStorage() });
  assert.equal(face.get(), 'tape');
  assert.equal(root.getAttribute('data-face'), 'tape');
});

test('a turn writes the face on the root, remembers it, and tells whoever listens', () => {
  const root = fakeRoot();
  const storage = fakeStorage();
  const face = createFace({ root, storage });
  const heard = [];
  face.onChange((f) => heard.push(f));
  assert.equal(face.set('feed'), true);
  assert.equal(face.get(), 'feed');
  assert.equal(root.getAttribute('data-face'), 'feed');
  assert.equal(storage.getItem(KEY), 'feed');
  assert.deepEqual(heard, ['feed']);
  assert.equal(face.set('tape'), true);
  assert.deepEqual(heard, ['feed', 'tape']);
  assert.equal(root.getAttribute('data-face'), 'tape');
});

test('the face it is on, or one it has not got, changes nothing', () => {
  const root = fakeRoot();
  const storage = fakeStorage();
  const face = createFace({ root, storage });
  const heard = [];
  face.onChange((f) => heard.push(f));
  assert.equal(face.set('tape'), false);
  assert.equal(face.set('lanes'), false);
  assert.equal(face.set(undefined), false);
  assert.equal(face.get(), 'tape');
  assert.deepEqual(heard, []);
  assert.equal(storage.getItem(KEY), null, 'nothing was kept');
});

test('the device comes back on the face it left', () => {
  const storage = fakeStorage({ [KEY]: 'feed' });
  const root = fakeRoot();
  const face = createFace({ root, storage });
  assert.equal(face.get(), 'feed');
  assert.equal(root.getAttribute('data-face'), 'feed', 'written at once, so the Studio shows it as it mounts');
});

test('a face kept that it has not got is the tape', () => {
  const face = createFace({ root: fakeRoot(), storage: fakeStorage({ [KEY]: 'lanes' }) });
  assert.equal(face.get(), 'tape');
});

test('a browser that keeps nothing still turns, for this visit', () => {
  const throws = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); } };
  const face = createFace({ root: fakeRoot(), storage: throws });
  assert.equal(face.get(), 'tape');
  assert.equal(face.set('feed'), true);
  assert.equal(face.get(), 'feed');
  const none = createFace({ root: null, storage: null });
  assert.equal(none.set('feed'), true, 'with no root and no storage it is still a face');
});

test('an off stops the telling', () => {
  const face = createFace({ root: fakeRoot(), storage: fakeStorage() });
  const heard = [];
  const off = face.onChange((f) => heard.push(f));
  face.set('feed');
  off();
  face.set('tape');
  assert.deepEqual(heard, ['feed']);
});
