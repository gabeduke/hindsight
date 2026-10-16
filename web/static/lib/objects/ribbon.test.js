import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Ribbon } from './ribbon.js';

// The selection bar's Keep as clip puts a span of the ring in the crate. On
// the tape page -- the Studio, with the rooms on -- the crate is on the same
// page, so the ribbon has to say it kept something (onKept), or the crate
// shows "Nothing kept yet" until the page is reloaded.

function withFetch(answer, fn) {
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answer; };
  return fn(calls).finally(() => { globalThis.fetch = prev; });
}

const ribbonWith = (opts) => ({ sel: { from: 4800, to: 9600 }, onToast() {}, ...opts });

test('Keep as clip says it kept the span, with what the Pi answered', () => withFetch(
  { ok: true, status: 200, json: async () => ({ clip: { id: 'k1' }, clamped: false }) },
  async (calls) => {
    const kept = [];
    await Ribbon.prototype.keepSel.call(ribbonWith({ onKept: (b) => kept.push(b) }));
    assert.deepEqual(calls, [{ url: '/api/crate', body: { ring_from: 4800, ring_to: 9600 } }]);
    assert.deepEqual(kept, [{ clip: { id: 'k1' }, clamped: false }]);
  },
));

test('a refused keep says nothing was kept', () => withFetch(
  { ok: false, status: 409, json: async () => ({ error: 'no tape' }) },
  async () => {
    const kept = [];
    const toasts = [];
    await Ribbon.prototype.keepSel.call(ribbonWith({ onKept: (b) => kept.push(b), onToast: (m) => toasts.push(m) }));
    assert.deepEqual(kept, []);
    assert.deepEqual(toasts, ['Could not keep it: no tape']);
  },
));

test('Capture, which has no crate on its page, needn’t listen', () => withFetch(
  { ok: true, status: 200, json: async () => ({}) },
  async () => {
    await assert.doesNotReject(Ribbon.prototype.keepSel.call(ribbonWith({})));
  },
));
