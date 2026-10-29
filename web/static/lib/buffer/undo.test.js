// web/static/lib/buffer/undo.test.js
// GRAB onto the cue lane, and its Undo (F3 of the flow spec;
// the-studio-on-one-screen.md, step 5). The real drawer, built from
// shell.html's own templates on a stand-in document, with a Pi that keeps a
// tape -- its cue lane and its history -- and remembers what it was asked: a
// GRAB opens the drawer on the clip it made; one that took the place of an
// untouched GRAB says so, with Undo, and Undo is the tape's, which brings the
// old clip back, open; a toss is undone the same way.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { remember } from './replaced.js';

const tapeHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(tapeHtml)[0];

const BAR = 96000; // 120 BPM at 48 kHz
const clip = (bars, id, over = {}) => ({
  id, name: 'main', file: `p-${id}.wav`, src: 0, frames: bars * BAR, loop: true, source: 'grab',
  lanes: [{ file: `p-${id}.wav`, src: 0, frames: bars * BAR, source: 'main' }],
  grab: { in: 0, out: bars * BAR, frames: bars * BAR, before: 0, after: 0, bars, bar_frames: BAR, sources: ['main'] },
  ...over,
});
const tapeOf = (clips) => ({
  id: 't', sample_rate: 48000, length: 8 * BAR, grid: { frames: 8 * BAR, bars: 8 },
  loop: { in: 0, out: 8 * BAR, on: false }, tracks: [1, 2, 3, 4].map(() => ({ clips: [] })),
  cue: { clips },
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

/**
 * withPi mounts the drawer against a Pi whose tape's cue lane is `lane`. A
 * GRAB makes pi.next, in the place of the newest clip if it is an untouched
 * GRAB, else after it; the tape's Undo steps its history back. Every request
 * is in `log`, and the page's poll is `poll()`.
 */
async function withPi({ lane = [], next = null }, fn, { storage = null } = {}) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const pi = { tape: tapeOf(lane), history: [], next, log: [] };
  const change = (to) => { pi.history.push(pi.tape); pi.tape = to; };
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || 'GET';
    const body = o.body ? JSON.parse(o.body) : null;
    pi.log.push({ url, method, body });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    const clips = pi.tape.cue.clips;
    if (url.startsWith('/api/tapes/cue/grab')) {
      const last = clips.at(-1);
      const replaced = last && last.source === 'grab' && !last.touched ? last : null;
      change(tapeOf([...(replaced ? clips.slice(0, -1) : clips), pi.next]));
      return ok({ tape: pi.tape, edit: { op: 'cue-grab', cue_clip: pi.next, ...(replaced ? { cue_replaced: replaced } : {}) } });
    }
    if (url.startsWith('/api/tapes/edit') && body.op === 'cue-remove') {
      change(tapeOf(clips.filter((c) => c.id !== body.clip)));
      return ok({ tape: pi.tape, edit: { op: 'cue-remove', clips: 1 } });
    }
    if (url.startsWith('/api/tapes/undo')) {
      pi.tape = pi.history.pop();
      return ok({ tape: pi.tape });
    }
    return ok({});
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
    const buffer = mountBuffer(doc, { feed, keysRow, ribbon: null, storage, toast: (msg, kind, opts) => {
      const t = { msg, kind, opts, dismissed: false, dismiss() { this.dismissed = true; } };
      toasts.push(t);
      return t; // as the page's toast hands back its element
    } });
    assert.ok(buffer, 'the drawer was built');
    // The page's poll: what the Pi has now.
    const poll = async () => {
      doc.dispatchEvent(new CustomEvent('hindsight:tape-state', { detail: {
        tape: pi.tape, rec_track: 1, rec_tracks: [1], rec_input: 'main', sources: [{ name: 'main' }], snap: 'bar', pos: 0, view: {},
      } }));
      await flush();
    };
    // Asked to look again, the page polls.
    doc.addEventListener('hindsight:tape-changed', () => { poll(); });
    await poll();
    const click = (node) => node.dispatchEvent(new CustomEvent('click'));
    await fn({ doc, pi, toasts, buffer, poll, grab: async () => { click(keysRow.querySelector('.buffer-grab-key')); await flush(); } });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
    if (saved.localStorage === undefined) delete globalThis.localStorage;
  }
}

const actionsOf = (t) => (t.opts?.actions || (t.opts?.action ? [t.opts.action] : [])).map((a) => a.label);

test('a GRAB lands on the cue lane and opens the drawer on it', async () => {
  await withPi({ next: clip(2, 'new') }, async ({ doc, pi, toasts, buffer, grab }) => {
    await grab();
    const post = pi.log.find((r) => r.url.startsWith('/api/tapes/cue/grab'));
    assert.equal(post.url, '/api/tapes/cue/grab?id=t', 'onto the tape’s lane');
    assert.deepEqual(post.body.sources, ['main']);
    assert.equal(buffer.state.sel, 'new');
    assert.equal(doc.getElementById('buffer').hidden, false);
    assert.match(toasts.at(-1).msg, /^Grabbed the last \d+ bars onto the cue lane/);
    assert.deepEqual(actionsOf(toasts.at(-1)), [], 'nothing replaced, nothing to undo');
    assert.equal(pi.log.filter((r) => r.url.startsWith('/api/clipboard')).length, 0, 'the clipboard is left to Cut and Copy');
  });
});

test('a GRAB in the place of an untouched one says so, and Undo brings that one back, open', async () => {
  await withPi({ lane: [clip(4, 'old')], next: clip(2, 'new') }, async ({ pi, toasts, buffer, grab }) => {
    await grab();
    const t = toasts.at(-1);
    assert.match(t.msg, /in place of “main”, which you hadn’t used/);
    assert.deepEqual(actionsOf(t), ['Undo']);
    assert.equal(buffer.state.sel, 'new');
    await t.opts.action.run();
    await flush();
    assert.equal(pi.log.filter((r) => r.url.startsWith('/api/tapes/undo')).length, 1, 'the tape’s own Undo, once');
    assert.equal(buffer.state.sel, 'old', 'the old clip is open again');
    assert.ok(buffer.state.open);
  });
});

test('a GRAB after a touched clip is added after it, with no Undo to offer', async () => {
  await withPi({ lane: [clip(4, 'old', { touched: true })], next: clip(2, 'new') }, async ({ pi, toasts, grab }) => {
    await grab();
    assert.deepEqual(pi.tape.cue.clips.map((c) => c.id), ['old', 'new']);
    assert.deepEqual(actionsOf(toasts.at(-1)), []);
  });
});

test('a newer GRAB takes the older GRAB’s Undo off the screen', async () => {
  await withPi({ lane: [clip(4, 'a')], next: clip(2, 'b') }, async ({ pi, toasts, grab }) => {
    await grab();
    const first = toasts.at(-1);
    pi.next = clip(1, 'c');
    await grab();
    const second = toasts.at(-1);
    assert.deepEqual(actionsOf(second), ['Undo']);
    assert.equal(first.dismissed, true, 'the older Undo is gone: tapping it could only undo the wrong grab');
    assert.equal(second.dismissed, false);
  });
});

test('Toss takes the clip off the lane, and its Undo puts it back, open', async () => {
  await withPi({ lane: [clip(4, 'x')] }, async ({ doc, pi, toasts, buffer }) => {
    doc.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id: 'x' } }));
    await flush();
    doc.getElementById('buffer-toss').dispatchEvent(new CustomEvent('click'));
    await flush();
    assert.deepEqual(pi.tape.cue.clips, []);
    assert.equal(doc.getElementById('buffer').hidden, true, 'gone from the lane, the drawer shuts');
    const t = toasts.find((x) => /^Tossed/.test(x.msg));
    assert.deepEqual(actionsOf(t), ['Undo']);
    await t.opts.action.run();
    await flush();
    assert.deepEqual(pi.tape.cue.clips.map((c) => c.id), ['x']);
    assert.equal(buffer.state.sel, 'x');
    assert.equal(doc.getElementById('buffer').hidden, false);
  });
});

test('no toast mentions the crate or the buffer any more', async () => {
  await withPi({ lane: [clip(4, 'old')], next: clip(2, 'new') }, async ({ toasts, grab }) => {
    await grab();
    for (const t of toasts) assert.doesNotMatch(t.msg, /crate|buffer/i);
  });
});

test('a GRAB made away from the Studio opens its clip here, once, saying what it replaced, with Undo', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  remember(storage, { by: 'new', line: 'In place of “main”, which you hadn’t used' });
  // The Studio opens with the take's clip already on the lane.
  await withPi({ lane: [clip(2, 'new')] }, async ({ pi, toasts, buffer, poll }) => {
    pi.history.push(tapeOf([clip(4, 'old')]));
    assert.equal(buffer.state.sel, 'new');
    const said = toasts.filter((t) => /In place of/.test(t.msg));
    assert.equal(said.length, 1);
    assert.deepEqual(actionsOf(said[0]), ['Undo']);
    await said[0].opts.action.run();
    await flush();
    assert.deepEqual(pi.tape.cue.clips.map((c) => c.id), ['old']);
    // The next poll does not say it again.
    await poll();
    assert.equal(toasts.filter((t) => /In place of/.test(t.msg)).length, 1);
  }, { storage });
});
