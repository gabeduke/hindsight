import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// `/` with the tape on is the Studio, which is the tape
// page. It has to go there before anything draws, so it is a classic inline
// script in index.html's head rather than a module -- and so this runs the
// script itself, out of the page, against a stand-in storage and location.

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const m = /<script id="studio-redirect">([\s\S]*?)<\/script>/.exec(html);

function run(store, { throwing = false } = {}) {
  const went = [];
  const localStorage = {
    getItem(k) {
      if (throwing) throw new Error('denied');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
  };
  const location = { replace: (u) => went.push(u) };
  new Function('localStorage', 'location', m[1])(localStorage, location);
  return went;
}

test('the redirect is in the head, before the stylesheets and any script', () => {
  assert.ok(m, 'index.html should carry the studio-redirect script');
  const at = html.indexOf('<script id="studio-redirect">');
  assert.ok(at < html.indexOf('<link rel="stylesheet"'), 'it runs before the page can paint');
  assert.ok(at < html.indexOf('<body'), 'it is in the head');
});

test('the tape on: `/` is replaced with the Studio', () => {
  assert.deepEqual(run({ 'hindsight.tapeOn': 'true' }), ['/tape.html']);
});

test('the old per-device rooms flag makes no difference: the rooms are the only layout', () => {
  assert.deepEqual(run({ 'hindsight.rooms': '0', 'hindsight.tapeOn': 'true' }), ['/tape.html']);
  assert.deepEqual(run({ 'hindsight.rooms': '1', 'hindsight.tapeOn': 'false' }), []);
});

test('with the tape off, or not known yet, `/` is the Studio itself', () => {
  // lib/nav.js puts it right once the Pi answers (studioRedirect).
  assert.deepEqual(run({ 'hindsight.tapeOn': 'false' }), []);
  assert.deepEqual(run({}), []);
});

test('no storage at all stays put, without throwing', () => {
  assert.deepEqual(run({}, { throwing: true }), []);
});
