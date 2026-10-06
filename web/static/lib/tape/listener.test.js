// Joining the tape's stream again on a new page: only for the device that
// was listening, only while the tape is on a phone with nobody else on it.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rejoin, rememberListener, wasListener } from './listener.js';

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});
afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch; });

// answers: one live state per poll, the last repeated.
function pi(answers) {
  let n = 0;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    if (url === '/api/tapes') return { json: async () => ({ loaded: 't1' }) };
    const a = answers[Math.min(n++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { json: async () => ({ live: a }) };
  };
  return asked;
}
const aPlayer = () => {
  const p = { active: false, starts: [], async start(o) { p.starts.push(o); p.active = true; } };
  return p;
};
const phone = (listeners) => ({ output_mode: 'phone', stream: { listeners } });

test('a device that was not listening does not join', async () => {
  const asked = pi([phone(0)]);
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0 }), false);
  assert.equal(asked.length, 0);
  assert.equal(p.starts.length, 0);
});

test('the listener joins again while the tape is on a phone with nobody on it', async () => {
  rememberListener(true);
  pi([phone(0)]);
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0 }), true);
  assert.deepEqual(p.starts, [{ rejoin: true }]);
  assert.equal(wasListener(), true);
});

test('the page left behind still holding its socket a moment is waited out', async () => {
  rememberListener(true);
  pi([phone(1), phone(1), phone(0)]);
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0 }), true);
  assert.equal(p.starts.length, 1);
});

test('another device listening all along has the tape: this one forgets', async () => {
  rememberListener(true);
  pi([phone(1)]);
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0, tries: 3 }), false);
  assert.equal(p.starts.length, 0);
  assert.equal(wasListener(), false);
});

test('the tape back in the jam room: this device forgets', async () => {
  rememberListener(true);
  pi([{ output_mode: 'jam', stream: { listeners: 0 } }]);
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0 }), false);
  assert.equal(wasListener(), false);
});

test('a Pi that never answers leaves the note for the next page', async () => {
  rememberListener(true);
  globalThis.fetch = async () => { throw new Error('offline'); };
  const p = aPlayer();
  assert.equal(await rejoin(p, { gap: 0, tries: 3 }), false);
  assert.equal(wasListener(), true);
});
