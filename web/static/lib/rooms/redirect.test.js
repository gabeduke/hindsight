// web/static/lib/rooms/redirect.test.js
// `/` with the tape on is the Studio at /tape.html, without a second load.
// With the tape off, `/` is Capture. The router manages this via replaceState
// rather than an inline redirect script (Phase 1, step 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor } from '../shell/router.js';

const route = (path, tapeOn) => routeFor(path, { base: 'http://localhost/', tapeOn });

test('the tape on: / and /index.html route to the Studio at /tape.html', () => {
  for (const path of ['/', '/index.html']) {
    const r = route(path, true);
    assert.equal(r.view, 'studio');
    assert.equal(r.path, '/tape.html');
  }
});

test('the tape off: / and /index.html route to Capture at /', () => {
  for (const path of ['/', '/index.html']) {
    const r = route(path, false);
    assert.equal(r.view, 'capture');
    assert.equal(r.path, '/');
  }
});

test('tape not known yet: / and /index.html route to Capture at / until answered', () => {
  for (const path of ['/', '/index.html']) {
    const r = route(path, null);
    assert.equal(r.view, 'capture');
    assert.equal(r.path, '/');
  }
});

test('/tape.html with the tape off redirects to Capture at /', () => {
  const r = route('/tape.html', false);
  assert.equal(r.view, 'capture');
  assert.equal(r.path, '/');
});

