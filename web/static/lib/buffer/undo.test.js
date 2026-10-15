// web/static/lib/buffer/undo.test.js
// GRAB's Undo (F3 of the flow spec). The real buffer, built from tape.html's
// own templates on a stand-in document, with a Pi that answers from a table
// and remembers what it was asked: a GRAB over a buffer nobody dropped or
// kept says so, with Undo, and Undo puts the old one back; a GRAB over
// nothing, or over one that was dropped or kept, says nothing of the kind.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { remember } from './replaced.js';

const tapeHtml = readFileSync(new URL('../../tape.html', import.meta.url), 'utf8');
const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(tapeHtml)[0];

const BAR = 96000; // 120 BPM at 48 kHz
const board = (bars, created, used = false) => ({
  created, frames: bars * BAR,
  tracks: [[{ file: `p-${created}.wav`, gain_db: 0, fade_in: 0, fade_out: 0 }]],
  grab: { in: 0, out: bars * BAR, frames: bars * BAR, before: 0, after: 0, bars, bar_frames: BAR, sources: ['main'], used },
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

/**
 * withPi mounts the buffer against a Pi whose clipboard is `pi.board`; a POST
 * replaces it with pi.next (and says it replaced `pi.replaced`), and the Undo
 * restores pi.replaced. Every request is in `log`.
 */
async function withPi(init, fn, { storage = null } = {}) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const pi = { board: init.board || null, next: init.next || null, replaced: init.replaced || null, log: [], failUndo: init.failUndo || '' };
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || 'GET';
    pi.log.push({ url, method, body: o.body ? JSON.parse(o.body) : null });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.startsWith('/api/clipboard/restore')) {
      if (pi.failUndo) return { ok: false, status: 409, json: async () => ({ error: pi.failUndo }) };
      pi.board = pi.replaced;
      return ok({ clipboard: pi.board, seconds: 1 });
    }
    if (url === '/api/clipboard' && method === 'POST') {
      pi.board = pi.next;
      return ok({ clipboard: pi.board, seconds: 8, clamped: false, wall: false, why: '', crated: [],
        ...(pi.replaced ? { replaced: pi.replaced, replaced_seconds: 8 } : {}) });
    }
    return ok({ clipboard: pi.board });
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc();
    doc.body.append(...parseHTML(doc, ['buffer-grab-tpl', 'buffer-panel-tpl', 'buffer-sel-tpl'].map(template).join('')).children);
    const feed = doc.createElement('section');
    const keysRow = doc.createElement('div');
    const sel = doc.createElement('div'); sel.id = 'rb-sel';
    const save = doc.createElement('button'); save.className = 'rb-sel-save';
    sel.append(save);
    const viz = doc.createElement('div'); viz.id = 'viz-wrap';
    doc.body.append(feed, keysRow, sel, viz);
    const toasts = [];
    const buffer = mountBuffer(doc, { feed, keysRow, ribbon: null, storage, toast: (msg, kind, opts) => toasts.push({ msg, kind, opts }) });
    assert.ok(buffer, 'the buffer was built');
    doc.dispatchEvent(new CustomEvent('hindsight:tape-state', { detail: {
      tape: {
        id: 't', sample_rate: 48000, length: 8 * BAR, grid: { frames: 8 * BAR, bars: 8 },
        loop: { in: 0, out: 8 * BAR, on: false }, tracks: [1, 2, 3, 4].map(() => ({ clips: [] })),
      },
      rec_track: 1, rec_tracks: [1], rec_input: 'main', sources: [{ name: 'main' }], snap: 'bar', pos: 0, view: {},
    } }));
    await flush();
    const click = (node) => node.dispatchEvent(new CustomEvent('click'));
    await fn({ doc, pi, toasts, buffer, grab: async () => { click(keysRow.querySelector('.buffer-grab-key')); await flush(); } });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
    if (saved.localStorage === undefined) delete globalThis.localStorage;
  }
}

const actionsOf = (t) => (t.opts?.actions || (t.opts?.action ? [t.opts.action] : [])).map((a) => a.label);

test('a GRAB over a buffer nobody dropped or kept says so, with Undo', async () => {
  const old = board(4, 'old'), next = board(2, 'new');
  await withPi({ board: old, next, replaced: old }, async ({ pi, toasts, grab }) => {
    await grab();
    const t = toasts.at(-1);
    assert.match(t.msg, /Replaced the buffer’s 4 BARS from the feed, which was never dropped or kept/);
    assert.deepEqual(actionsOf(t), ['Undo']);
    const post = pi.log.find((r) => r.method === 'POST' && r.url === '/api/clipboard');
    assert.equal(post.body.crate, false, 'the rooms keep the replaced one in the Pi’s one slot, not in a crate nobody sees');
  });
});

test('Undo puts the old buffer back, naming the grab it undoes', async () => {
  const old = board(4, 'old'), next = board(2, 'new');
  await withPi({ board: old, next, replaced: old }, async ({ pi, toasts, buffer, grab }) => {
    await grab();
    assert.equal(buffer.state.board.created, 'new');
    await toasts.at(-1).opts.action.run();
    await flush();
    const undo = pi.log.find((r) => r.url.startsWith('/api/clipboard/restore'));
    assert.equal(undo.method, 'POST');
    assert.equal(undo.url, '/api/clipboard/restore?replaced=1&by=new');
    assert.equal(buffer.state.board.created, 'old', 'the old buffer is the buffer again');
    assert.ok(buffer.state.open, 'and it is open, as a grab opens it');
    assert.match(toasts.at(-1).msg, /^Put back the buffer’s 4 BARS from the feed/);
  });
});

test('an Undo the Pi refuses says why, and leaves the buffer as it was', async () => {
  const old = board(4, 'old'), next = board(2, 'new');
  await withPi({ board: old, next, replaced: old, failUndo: 'the buffer has moved on since that grab' }, async ({ toasts, buffer, grab }) => {
    await grab();
    await toasts.at(-1).opts.action.run();
    await flush();
    assert.equal(toasts.at(-1).kind, 'bad');
    assert.match(toasts.at(-1).msg, /moved on/);
    assert.equal(buffer.state.board.created, 'new');
  });
});

test('a GRAB over nothing says nothing of replacing, and offers no Undo', async () => {
  await withPi({ board: null, next: board(2, 'new') }, async ({ toasts, grab }) => {
    await grab();
    const t = toasts.at(-1);
    assert.match(t.msg, /^Grabbed the last \d+ bars/);
    assert.doesNotMatch(t.msg, /Replaced|crate/i);
    assert.deepEqual(actionsOf(t), []);
  });
});

test('a GRAB over a buffer that was dropped or kept says nothing of replacing either', async () => {
  // The Pi answers no `replaced` for a used one; the page does not guess.
  await withPi({ board: board(4, 'old', true), next: board(2, 'new') }, async ({ toasts, grab }) => {
    await grab();
    assert.doesNotMatch(toasts.at(-1).msg, /Replaced|crate/i);
    assert.deepEqual(actionsOf(toasts.at(-1)), []);
  });
});

test('no toast mentions the crate any more', async () => {
  const old = board(4, 'old');
  await withPi({ board: old, next: board(2, 'new'), replaced: old }, async ({ toasts, grab }) => {
    await grab();
    for (const t of toasts) assert.doesNotMatch(t.msg, /crate/i);
  });
});

test('a take’s GRAB leaves its note for the Studio, which says it once, with Undo', async () => {
  const old = board(4, 'old'), next = board(2, 'new');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  remember(storage, { by: 'new', line: 'Replaced the buffer’s 4 BARS from the feed, which was never dropped or kept' });
  // The Studio opens with the new buffer already on the Pi.
  await withPi({ board: next, replaced: old }, async ({ pi, toasts, buffer }) => {
    assert.equal(buffer.state.board.created, 'new');
    const said = toasts.filter((t) => /Replaced the buffer/.test(t.msg));
    assert.equal(said.length, 1);
    assert.deepEqual(actionsOf(said[0]), ['Undo']);
    await said[0].opts.action.run();
    await flush();
    assert.equal(pi.log.find((r) => r.url.startsWith('/api/clipboard/restore')).url, '/api/clipboard/restore?replaced=1&by=new');
    assert.equal(buffer.state.board.created, 'old');
    // The next poll does not say it again.
    mock.timers.tick(2000); await flush();
    assert.equal(toasts.filter((t) => /Replaced the buffer/.test(t.msg)).length, 1);
  }, { storage });
});
