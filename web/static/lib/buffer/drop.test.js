// web/static/lib/buffer/drop.test.js
// DROP in the real drawer (F7 of the flow spec, decision 10), built from
// shell.html's own templates on a stand-in document and opened on a cue clip
// as a held one opens it, with a Pi that answers from a table and remembers
// what it was asked: the key says where DROP will land and whether it
// replaces, a full loop is never refused, one Undo steps the tape back once,
// and a part longer than the loop says it runs past it.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mountBuffer } from './buffer.js';
import { keyState } from './state.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const tapeHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(tapeHtml)[0];

const BAR = 96000; // 120 BPM at 48 kHz
// A cue clip GRAB put on the lane: one lane, its window the whole grab.
const cueClip = (bars) => ({
  id: 'b1', name: 'main', file: 'p.wav', src: 0, frames: bars * BAR, loop: true, source: 'grab',
  lanes: [{ file: 'p.wav', src: 0, frames: bars * BAR, source: 'main' }],
  grab: { in: 0, out: bars * BAR, frames: bars * BAR, before: 0, after: 0, bars, bar_frames: BAR, sources: ['main'] },
});
const tapeOf = (clips = [[], [], [], []], over = {}) => ({
  id: 't', sample_rate: 48000, length: 32 * BAR, grid: { frames: 8 * BAR, bars: 8 },
  loop: { in: 0, out: 8 * BAR, on: true },
  tracks: clips.map((cs, i) => ({ n: i + 1, clips: cs.map(([a, b]) => ({ at: a * BAR, frames: (b - a) * BAR })) })),
  ...over,
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

async function withBuffer({ bars = 4, tape = tapeOf(), armed = [2], pos = 0 }, fn) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, requestAnimationFrame: globalThis.requestAnimationFrame };
  const log = [];
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || 'GET';
    log.push({ url, method, body: o.body ? JSON.parse(o.body) : null });
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.startsWith('/api/tapes/cue/drop')) return ok({ clip: { id: 'c9' }, tracks: 1, end: 0 });
    if (url.startsWith('/api/tapes/undo')) return ok({});
    return ok({});
  };
  globalThis.requestAnimationFrame = () => 0; // the glow on the new block is a look, not a test
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
    const buffer = mountBuffer(doc, { feed, keysRow, ribbon: null, storage: null, toast: (msg, kind, opts) => {
      const t = { msg, kind, opts, classList: { add() {} } };
      toasts.push(t);
      return t;
    } });
    assert.ok(buffer, 'the buffer was built');
    const state = (t, o = {}) => doc.dispatchEvent(new CustomEvent('hindsight:tape-state', { detail: {
      tape: { cue: { clips: [cueClip(bars)] }, ...t }, rec_track: armed[0] || 0, rec_tracks: armed, rec_input: 'main', sources: [{ name: 'main' }], snap: 'bar', pos, view: {}, ...o,
    } }));
    state(tape);
    doc.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id: 'b1' } }));
    await flush();
    const $ = (id) => doc.getElementById(id);
    await fn({
      doc, log, toasts, buffer, state, flush,
      word: () => $('buffer-drop-word').textContent,
      sub: () => $('buffer-drop-sub').textContent,
      key: () => $('buffer-drop'),
      press: async () => { $('buffer-drop').dispatchEvent(new CustomEvent('click')); await flush(); },
      // What each DROP asked for, past the clip (every one names b1).
      drops: () => log.filter((r) => r.url.startsWith('/api/tapes/cue/drop')).map((r) => {
        assert.equal(r.body.clip, 'b1');
        const { clip, ...rest } = r.body;
        return { ...r, body: rest };
      }),
    });
  } finally {
    mock.timers.reset();
    Object.assign(globalThis, saved);
    if (saved.localStorage === undefined) delete globalThis.localStorage;
    if (saved.requestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
  }
}

test('the key says where DROP will land: the track, the bars, and nothing more over an empty span', async () => {
  await withBuffer({}, async ({ word, sub, key }) => {
    assert.equal(word(), 'Drop on track 2');
    assert.equal(sub(), 'bars 1–4');
    assert.equal(key().disabled, false);
  });
});

test('the key says "replaces" exactly when the span lies over something on that track', async () => {
  await withBuffer({ tape: tapeOf([[], [[0, 4]], [], []]) }, async ({ word, sub }) => {
    assert.equal(word(), 'Drop on track 2');
    assert.equal(sub(), 'bars 1–4 · replaces');
  });
  await withBuffer({ tape: tapeOf([[[0, 8]], [[4, 8]], [[0, 8]], [[0, 8]]]) }, async ({ sub }) => {
    assert.equal(sub(), 'bars 1–4', 'full on every other track, and after the span on this one');
  });
});

test('DROP sends the track and the place the key named, and the toast says it replaced, with Undo', async () => {
  await withBuffer({ tape: tapeOf([[], [[0, 4]], [], []]), pos: 6.5 * BAR }, async ({ press, drops, toasts }) => {
    await press();
    assert.equal(drops().length, 1);
    assert.deepEqual(drops()[0].body, { track: 2, at: 0 }, 'the next bar line would run out of the loop: it wraps to the In');
    const t = toasts.at(-1);
    assert.equal(t.msg, 'Dropped on track 2 · bars 1–4 · replaced what was under it');
    assert.equal(t.opts.action.label, 'Undo');
  });
});

test('a full loop is dropped over, never refused', async () => {
  const full = tapeOf([[[0, 8]], [[0, 8]], [[0, 8]], [[0, 8]]]);
  await withBuffer({ tape: full, bars: 8, pos: 3 * BAR }, async ({ press, drops, toasts, sub, key }) => {
    assert.equal(key().disabled, false);
    assert.equal(sub(), 'bars 1–8 · replaces');
    await press();
    assert.equal(drops().length, 1);
    assert.doesNotMatch(toasts.map((t) => t.msg).join('\n'), /no room|Could not/i);
  });
});

test('one Undo steps the tape back once', async () => {
  await withBuffer({ tape: tapeOf([[], [[0, 4]], [], []]) }, async ({ press, toasts, log, flush }) => {
    await press();
    await toasts.at(-1).opts.action.run();
    await flush();
    assert.equal(log.filter((r) => r.url.startsWith('/api/tapes/undo')).length, 1);
    assert.equal(log.find((r) => r.url.startsWith('/api/tapes/undo')).method, 'POST');
  });
});

test('a part longer than the loop starts at the loop’s start, and the toast says it runs past', async () => {
  await withBuffer({ bars: 10, pos: 3 * BAR }, async ({ press, drops, toasts, sub }) => {
    assert.equal(sub(), 'bars 1–10 · runs past the loop');
    await press();
    assert.deepEqual(drops()[0].body, { track: 2, at: 0 });
    assert.equal(toasts.at(-1).msg, 'Dropped on track 2 · bars 1–10 · runs past the loop');
  });
});

test('with no track armed the key is off and says to arm one', async () => {
  await withBuffer({ armed: [] }, async ({ sub, word, key, press, drops }) => {
    assert.equal(key().disabled, true);
    assert.equal(word(), 'Drop');
    assert.equal(sub(), 'arm a track');
    await press();
    assert.equal(drops().length, 0);
  });
});

test('arming another track moves the key with it', async () => {
  await withBuffer({ tape: tapeOf([[], [[0, 4]], [], []]) }, async ({ state, word, sub, flush }) => {
    state(tapeOf([[], [[0, 4]], [], []]), { rec_track: 3, rec_tracks: [3] });
    await flush();
    assert.equal(word(), 'Drop on track 3');
    assert.equal(sub(), 'bars 1–4');
  });
});

test('a loop near the tape’s end: the part is moved back to fit, the key and the toast say so, and it is not refused', async () => {
  const t = tapeOf([[], [], [], []], { length: 10 * BAR, loop: { in: 8 * BAR, out: 10 * BAR, on: true } });
  await withBuffer({ tape: t, bars: 4 }, async ({ press, drops, toasts, sub, key }) => {
    assert.equal(key().disabled, false);
    assert.equal(sub(), 'bars 7–10 · moved back to fit the tape');
    await press();
    assert.deepEqual(drops()[0].body, { track: 2, at: 6 * BAR });
    assert.equal(toasts.at(-1).msg, 'Dropped on track 2 · bars 7–10 · moved back to fit the tape');
  });
});

// ↵ again, just after a drop, drops it again further on: the drawer shut by
// the drop keeps the clip for it. Its layer's close once let go of it.
test('just after a DROP, ↵ drops the clip again', async () => {
  await withBuffer({}, async ({ doc, press, buffer }) => {
    await press();
    assert.equal(doc.getElementById('buffer').hidden, true, 'the drawer shuts on a drop');
    assert.deepEqual(keyState(buffer.state, performance.now()), { open: false, held: true });
  });
});
