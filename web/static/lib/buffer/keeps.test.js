// web/static/lib/buffer/keeps.test.js
// The drawer's KEEP names what it keeps (F1 of the flow spec); IN and OUT
// step by the Studio's snap. The real drawer, built from shell.html's own
// templates on a stand-in document, opened on a cue clip.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const tapeHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(tapeHtml)[0];

const BAR = 96000; // 120 BPM at 48 kHz
const clip = (bars, id = 'c1') => ({
  id, name: 'main', file: 'p.wav', src: 0, frames: bars * BAR, loop: true, source: 'grab',
  lanes: [{ file: 'p.wav', src: 0, frames: bars * BAR, source: 'main' }],
  grab: { in: 0, out: bars * BAR, frames: bars * BAR, before: 0, after: 0, bars, bar_frames: BAR, sources: ['main'] },
});

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

async function withBuffer(lane, fn, { snap = 'bar' } = {}) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const log = [];
  globalThis.fetch = async (url, o = {}) => {
    log.push({ url, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    return { ok: true, status: 200, json: async () => ({}) };
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
    const b = mountBuffer(doc, { feed, keysRow, ribbon: null, toast: () => {} });
    assert.ok(b, 'the drawer was built');
    // The tape page's poll: a 4-track tape at 120 BPM, nothing on it, its
    // loop `loopBars` long (bracket on) -- or the whole 8 bars with none --
    // and the cue lane's clips.
    let clips = lane;
    const tapeState = (loopBars = null) => doc.dispatchEvent(new CustomEvent('hindsight:tape-state', { detail: {
      tape: {
        id: 't', sample_rate: 48000, length: 8 * BAR, grid: { frames: 8 * BAR, bars: 8 },
        loop: loopBars ? { in: 0, out: loopBars * BAR, on: true } : { in: 0, out: 8 * BAR, on: false },
        tracks: [1, 2, 3, 4].map(() => ({ clips: [] })),
        cue: { clips },
      },
      rec_track: 1, rec_tracks: [1], rec_input: 'main', sources: [{ name: 'main' }], snap, pos: 0, view: {},
    } }));
    tapeState();
    const open = (id) => doc.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id } }));
    const press = async (id) => { doc.getElementById(id).dispatchEvent(new CustomEvent('click')); await flush(); };
    await fn({ doc, tapeState, open, log, press, set: (c) => { clips = c; }, poll: async () => { tapeState(); await flush(); } });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
    if (saved.localStorage === undefined) delete globalThis.localStorage;
  }
}

test('the drawer’s KEEP says its length', async () => {
  await withBuffer([clip(4)], async ({ doc, open }) => {
    open('c1');
    await flush();
    assert.equal(doc.getElementById('buffer-keep-len').textContent, '4 BARS');
    assert.match(doc.getElementById('buffer-keep').getAttribute('aria-label'), /^KEEP 4 BARS/);
  });
});

// The drawer has no snap of its own: IN and OUT step by the one on ⌗, which
// the page says in hindsight:tape-state (lib/tape/page.js heardTape).
for (const [snap, frames] of [['bar', BAR], ['beat', BAR / 4]]) {
  test(`IN and OUT step by the Studio’s snap: a ${snap}`, async () => {
    const wide = { ...clip(4), grab: { ...clip(4).grab, before: BAR, after: BAR, downbeat: 0 } };
    await withBuffer([wide], async ({ doc, open, press, log }) => {
      open('c1');
      await flush();
      assert.equal(doc.getElementById('buffer-snap'), null, 'and no snap key of its own');
      await press('buffer-in-on');
      const trims = log.filter((r) => r.url.startsWith('/api/tapes/cue/clip') && r.method === 'PATCH').map((r) => r.body);
      assert.equal(trims.length, 1);
      assert.equal(trims[0].in, frames, `IN moved on a ${snap}`);
    }, { snap });
  });
}

test('with no clip open, KEEP names nothing', async () => {
  await withBuffer([clip(4)], async ({ doc }) => {
    await flush();
    assert.equal(doc.getElementById('buffer-keep-len').textContent, '');
  });
});

test('a trimmed clip changes the words', async () => {
  await withBuffer([clip(4)], async ({ doc, set, poll, open }) => {
    open('c1');
    await flush();
    set([clip(2)]);
    await poll();
    assert.equal(doc.getElementById('buffer-keep-len').textContent, '2 BARS');
  });
});

const picked = (doc) => doc.querySelectorAll('.buffer-bars button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

test('GRAB’s picker starts at the tape’s loop in bars, and follows the loop', async () => {
  await withBuffer([], async ({ doc, tapeState }) => {
    assert.deepEqual(picked(doc), ['8'], 'no bracket: the tape’s first loop, 8 bars');
    tapeState(2);
    assert.deepEqual(picked(doc), ['2'], 'a 2-bar loop: GRAB starts at 2');
    tapeState(3);
    assert.deepEqual(picked(doc), ['2'], 'a 3-bar loop: the largest that fits inside it');
    tapeState(4);
    assert.deepEqual(picked(doc), ['4']);
  });
});

test('a pick made by hand stays until the loop changes', async () => {
  await withBuffer([], async ({ doc, tapeState }) => {
    tapeState(2);
    doc.querySelector('.buffer-bars button[data-n="8"]').dispatchEvent(new CustomEvent('click'));
    assert.deepEqual(picked(doc), ['8'], 'picked by hand');
    tapeState(2);
    tapeState(2);
    assert.deepEqual(picked(doc), ['8'], 'the poll of an unchanged loop leaves it');
    tapeState(4);
    assert.deepEqual(picked(doc), ['4'], 'the loop changed: back to following it');
  });
});
