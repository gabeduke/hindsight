// web/static/lib/buffer/keeps.test.js
// The drawer's keys say what they do: To the shelf names what goes there
// (F1 of the flow spec), and says the clip is on the shelf, not "kept"
// (KEEP is the feed's word: the-calm-studio.md, decision 7); Repeat is the
// clip's own going round; IN and OUT step by the Studio's snap. The real
// drawer, built from shell.html's own templates on a stand-in document,
// opened on a cue clip.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { unmark } from '../rooms/words.js';

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
    const body = url.startsWith('/api/tapes/cue/keep') ? { name: 'jam_1.wav', label: 'Groove', seconds: 10 } : {};
    return { ok: true, status: 200, json: async () => body };
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
    const b = mountBuffer(doc, { feed, keysRow, ribbon: null, storage: null, toast: (msg, kind, opts) => { toasts.push({ msg, kind, opts }); return {}; } });
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
    await fn({ doc, tapeState, open, log, toasts, press, set: (c) => { clips = c; }, poll: async () => { tapeState(); await flush(); } });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
    if (saved.localStorage === undefined) delete globalThis.localStorage;
  }
}

test('the drawer’s To the shelf says its length', async () => {
  await withBuffer([clip(4)], async ({ doc, open }) => {
    open('c1');
    await flush();
    assert.equal(doc.getElementById('buffer-keep-word').textContent, 'To the shelf');
    assert.equal(doc.getElementById('buffer-keep-len').textContent, '4 BARS');
    assert.equal(doc.getElementById('buffer-keep').getAttribute('aria-label'), 'To the shelf 4 BARS');
  });
});

test('To the shelf makes a take of the clip, and the toast says it is on the shelf, never that it was kept', async () => {
  await withBuffer([clip(4)], async ({ open, press, log, toasts }) => {
    open('c1');
    await flush();
    await press('buffer-keep');
    const asked = log.filter((r) => r.url.startsWith('/api/tapes/cue/keep'));
    assert.deepEqual(asked.map((r) => r.body), [{ clip: 'c1' }]);
    const said = toasts.at(-1);
    assert.equal(unmark(said.msg), '“Groove” is on the Listening Room’s shelf, as a take');
    assert.doesNotMatch(said.msg, /kept|keep/i);
    assert.deepEqual(said.opts.actions.map((a) => a.label), ['Name it', 'Undo']);
  });
});

test('Repeat says whether a launch goes round, and a press turns it the other way', async () => {
  await withBuffer([clip(4)], async ({ doc, open, press, log }) => {
    open('c1');
    await flush();
    const key = doc.getElementById('buffer-repeat');
    assert.equal(key.textContent, 'Repeat');
    assert.equal(key.getAttribute('aria-pressed'), 'true', 'a GRAB goes round');
    await press('buffer-repeat');
    const set = log.filter((r) => r.url.startsWith('/api/tapes/edit')).map((r) => r.body);
    assert.equal(set.length, 1);
    assert.equal(set[0].op, 'cue-set');
    assert.equal(set[0].cue_clip.id, 'c1');
    assert.equal(set[0].cue_clip.loop, false, 'the clip’s own loop, off: a launch plays once');
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

test('with no clip open, To the shelf names nothing', async () => {
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
