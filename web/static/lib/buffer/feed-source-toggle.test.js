import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const tapeHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(tapeHtml)[0];

const BAR = 96000;
const cueClip = (bars = 4) => ({
  id: 'b1', name: 'main', file: 'p.wav', src: 0, frames: bars * BAR, loop: true, source: 'grab',
  lanes: [{ file: 'p.wav', src: 0, frames: bars * BAR, source: 'main' }],
  grab: { in: 0, out: bars * BAR, frames: bars * BAR, before: 0, after: 0, bars, bar_frames: BAR, sources: ['main'] },
});

const tapeOf = (clips = []) => ({
  id: 't', sample_rate: 48000, length: 32 * BAR, grid: { frames: 8 * BAR, bars: 8 },
  loop: { in: 0, out: 8 * BAR, on: true },
  tracks: [{ n: 1, clips: [] }, { n: 2, clips: [] }, { n: 3, clips: [] }, { n: 4, clips: [] }],
  cue: { clips },
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

async function withBufferTest(_, fn) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, requestAnimationFrame: globalThis.requestAnimationFrame };
  const log = [];
  const storageMap = new Map();
  const testStorage = {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || 'GET';
    log.push({ url, method, body: o.body ? JSON.parse(o.body) : null });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.startsWith('/api/tapes/cue/grab')) return ok({ tape: tapeOf([cueClip()]), edit: { op: 'cue-grab', cue_clip: cueClip() } });
    return ok({});
  };
  globalThis.requestAnimationFrame = () => 0;
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
    const buffer = mountBuffer(doc, { feed, keysRow, ribbon: null, storage: testStorage, toast: () => {} });
    const state = (t, o = {}) => doc.dispatchEvent(new CustomEvent('hindsight:tape-state', { detail: {
      tape: t, rec_track: 2, rec_tracks: [2], rec_input: 'main',
      sources: [{ name: 'main' }, { name: 'ch1' }, { name: 'ch2' }, { name: 'aux' }],
      snap: 'bar', pos: 0, view: {}, ...o,
    } }));
    state(tapeOf());
    await flush();
    await fn({ doc, log, testStorage, buffer, flush, state });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
  }
}

// The drawer opens on a clip held on the lane, and the lane hears which:
// ✕ closes it, and a clip gone from the lane closes it too.
test('a held clip opens the drawer, ✕ closes it, and the lane hears which is open', async () => {
  await withBufferTest({}, async ({ doc, flush, state }) => {
    const panel = doc.getElementById('buffer');
    const heard = [];
    doc.addEventListener('hindsight:cue-selected', (e) => heard.push(e.detail.id));
    assert.equal(doc.querySelector('.buffer-reopen'), null, 'no Buffer ▴: the lane is the way back');
    assert.equal(panel.hidden, true);
    state(tapeOf([cueClip()]));
    doc.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id: 'b1' } }));
    await flush();
    assert.equal(panel.hidden, false, 'held, it opens');
    assert.equal(doc.getElementById('buffer-title').textContent, 'main', 'under the clip’s name');
    doc.getElementById('buffer-close').dispatchEvent(new CustomEvent('click'));
    await flush();
    assert.equal(panel.hidden, true, '✕ closes it');
    doc.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id: 'b1' } }));
    state(tapeOf([]));
    await flush();
    assert.equal(panel.hidden, true, 'a clip gone from the lane closes it');
    assert.deepEqual(heard, ['b1', '', 'b1', '']);
  });
});

test('Feed source selector allows choosing ch2 before grab', async () => {
  await withBufferTest({}, async ({ doc, log, testStorage, flush }) => {
    const feedSources = doc.querySelector('.buffer-feed-sources');
    assert.ok(feedSources, 'feed source selector container exists');
    const btns = feedSources.querySelectorAll('button');
    assert.ok(btns.length >= 4, 'buttons for main, ch1, ch2, aux exist');

    const ch2Btn = [...btns].find((b) => b.dataset.source === 'ch2' || b.textContent.trim() === 'ch2');
    assert.ok(ch2Btn, 'ch2 button exists');

    // Click ch2
    ch2Btn.dispatchEvent(new CustomEvent('click'));
    await flush();

    assert.equal(ch2Btn.getAttribute('aria-pressed'), 'true', 'ch2 is pressed');
    assert.equal(testStorage.getItem('buffer.source'), 'ch2', 'ch2 persisted to storage');

    // Trigger grab
    const grabBtn = doc.querySelector('.buffer-grab-key');
    grabBtn.dispatchEvent(new CustomEvent('click'));
    await flush();

    const grabs = log.filter((r) => r.url.startsWith('/api/tapes/cue/grab') && r.method === 'POST');
    assert.ok(grabs.length > 0, 'grab API called');
    const lastGrab = grabs.at(-1);
    assert.deepEqual(lastGrab.body.sources, ['ch2'], 'grab payload used selected source ch2');
  });
});

// GRAB takes from the armed track's input until one is picked on its ▾, and
// the panel's Armed track goes back to following it
// (docs/plan/the-studio-on-one-screen.md). The key says which it is.
test('GRAB follows the armed track’s input until one is picked, and Armed track goes back', async () => {
  await withBufferTest({}, async ({ doc, log, testStorage, flush }) => {
    const btn = (src) => doc.querySelectorAll('.buffer-feed-sources button').find((b) => b.dataset.source === src);
    const from = () => doc.querySelector('.buffer-grab-from').textContent;
    const grabbed = async () => {
      doc.querySelector('.buffer-grab-key').dispatchEvent(new CustomEvent('click'));
      await flush();
      return log.filter((r) => r.url.startsWith('/api/tapes/cue/grab') && r.method === 'POST').at(-1)?.body.sources;
    };
    assert.ok(doc.querySelector('.buffer-grab-pop').contains(btn('')), 'the inputs are in the ▾’s panel, Armed track first');
    assert.equal(btn('').getAttribute('aria-pressed'), 'true');
    assert.equal(from(), 'from main · armed', 'the armed track (rec_input main) is what it takes');

    btn('ch2').dispatchEvent(new CustomEvent('click'));
    await flush();
    assert.equal(btn('').getAttribute('aria-pressed'), 'false');
    assert.equal(btn('ch2').getAttribute('aria-pressed'), 'true');
    assert.equal(from(), 'from ch2');
    assert.deepEqual(await grabbed(), ['ch2']);

    btn('').dispatchEvent(new CustomEvent('click'));
    await flush();
    assert.equal(btn('').getAttribute('aria-pressed'), 'true');
    assert.equal(testStorage.getItem('buffer.source'), '', 'nothing picked: it follows again, after a reload too');
    assert.equal(from(), 'from main · armed');
    assert.deepEqual(await grabbed(), ['main']);
  });
});
