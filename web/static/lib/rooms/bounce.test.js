// web/static/lib/rooms/bounce.test.js
// F2 of the flow spec (docs/superpowers/specs/2026-10-15-flow-design.md):
// BOUNCE is the Studio's ⋯ menu's one verb for a tape into a take, in place of
// Mix down ×2 and Cut a record. Its toast has ▶ and Open, the menu keeps Last
// bounce, and a take that was once marked as a record is an ordinary take.
// The rooms off keep the old words. The menu is the tape page's own markup,
// built on a stand-in document; the player runs on a stand-in <audio>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { bounceMenu, lastBounce, bounceToast, lastBounceToast, takePlayer, bounceStartWords, BOUNCE_WORDS } from './bounce.js';
import { roomShelves, playOrder } from '../room/shelves.js';
import { MODELS } from '../scene/models.js';

const tapeHtml = readFileSync(new URL('../../tape.html', import.meta.url), 'utf8');

// The tape page's ⋯ menu, as served: the real markup, in a stand-in document.
function menu() {
  const doc = fakeDoc();
  const holder = parseHTML(doc, tapeHtml);
  const actions = holder.querySelector('#tape-actions');
  doc.body.append(actions);
  return { doc, actions };
}
const words = (actions) => actions.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]').map((b) => b.textContent.trim());

test('with the rooms on, the ⋯ menu offers Bounce the loop and Bounce the whole tape, and neither Mix down nor Cut a record', () => {
  const { doc, actions } = menu();
  bounceMenu(doc, { rooms: true });
  const w = words(actions);
  assert.ok(w.includes('Bounce the loop'), w.join(' | '));
  assert.ok(w.includes('Bounce the whole tape'), w.join(' | '));
  assert.ok(w.includes('Last bounce'), 'and the tape keeps Last bounce');
  assert.equal(w.filter((x) => /Mix down|Cut a record/i.test(x)).length, 0, w.join(' | '));
});

test('the bounce items are the mixdown items: the same buttons, so the same requests', () => {
  const { doc, actions } = menu();
  const loop = actions.querySelector('#tape-mixdown'), whole = actions.querySelector('#tape-mixdown-all');
  bounceMenu(doc, { rooms: true });
  assert.equal(actions.querySelector('#tape-mixdown'), loop);
  assert.equal(actions.querySelector('#tape-mixdown-all'), whole);
  assert.equal(loop.textContent, BOUNCE_WORDS.loop);
  assert.equal(whole.textContent, BOUNCE_WORDS.whole);
  assert.equal(loop.getAttribute('data-tip'), 'bounce');
  assert.equal(whole.getAttribute('data-tip'), 'bounce');
});

test('Last bounce sits by the bounces, a line of its own, disabled until there is one', () => {
  const { doc, actions } = menu();
  bounceMenu(doc, { rooms: true });
  const items = actions.children;
  const at = (id) => items.indexOf(actions.querySelector(id));
  assert.equal(at('#tape-last-bounce'), at('#tape-mixdown-all') + 1);
  const last = actions.querySelector('#tape-last-bounce');
  assert.equal(last.getAttribute('role'), 'menuitem');
  assert.equal(last.getAttribute('data-tip'), 'last-bounce');
  assert.equal(last.disabled, true, 'none yet');
});

test('with the rooms off the menu is untouched: Mix down, and no Last bounce', () => {
  const { doc, actions } = menu();
  const before = words(actions);
  const r = bounceMenu(doc, { rooms: false });
  assert.equal(r, null);
  assert.deepEqual(words(actions), before);
  assert.ok(before.includes('Mix down the loop') && before.includes('Mix down the whole tape'));
  assert.equal(actions.querySelector('#tape-last-bounce'), null);
  assert.equal(actions.querySelector('#tape-mixdown').getAttribute('data-tip'), 'mixdown');
});

test('asking twice does not add a second Last bounce', () => {
  const { doc, actions } = menu();
  bounceMenu(doc, { rooms: true });
  bounceMenu(doc, { rooms: true });
  assert.equal(actions.querySelectorAll('#tape-last-bounce').length, 1);
});

test('bounceMenu answers a setter for Last bounce: enabled with a take, disabled without', () => {
  const { doc, actions } = menu();
  const m = bounceMenu(doc, { rooms: true });
  const last = actions.querySelector('#tape-last-bounce');
  m.setLast({ name: 'jam_20261015-130100.wav', label: 'Second take loop' });
  assert.equal(last.disabled, false);
  assert.equal(m.take.name, 'jam_20261015-130100.wav');
  m.setLast(null);
  assert.equal(last.disabled, true);
  assert.equal(m.take, null);
});

// --- which take is a tape's last bounce ----------------------------------------------

const bounce = (name, created, extra = {}) => ({ name, created, origin: 'tape', label: 'Groove', ...extra });
const tape = { id: 't1', name: 'Groove' };

test('Last bounce is the newest take bounced from this tape', () => {
  const takes = [
    bounce('jam_a.wav', '2026-10-14T10:00:00Z', { tape_id: 't1' }),
    bounce('jam_c.wav', '2026-10-15T09:00:00Z', { tape_id: 't1' }),
    bounce('jam_b.wav', '2026-10-15T08:00:00Z', { tape_id: 't1' }),
    bounce('jam_other.wav', '2026-10-15T12:00:00Z', { tape_id: 't2', label: 'Elsewhere' }),
    { name: 'jam_kept.wav', created: '2026-10-15T13:00:00Z', label: 'Groove' }, // a KEEP that shares the tape's name
    { name: 'jam_cut.wav', created: '2026-10-15T14:00:00Z', tape_id: 't1', source: { name: 'jam_a.wav' } }, // a cut, not a bounce
  ];
  assert.equal(lastBounce(takes, tape).name, 'jam_c.wav');
});

test('no bounce yet: nothing', () => {
  assert.equal(lastBounce([], tape), null);
  assert.equal(lastBounce([{ name: 'jam_k.wav', created: '2026-10-15T13:00:00Z' }], tape), null);
  assert.equal(lastBounce(null, tape), null);
  assert.equal(lastBounce([bounce('jam_a.wav', '2026-10-15T08:00:00Z', { tape_id: 't2' })], tape), null, 'another tape’s');
});

test('a bounce from before takes carried their tape’s id counts by the tape’s name, unless another tape owns that name', () => {
  const old = bounce('jam_old.wav', '2026-10-01T10:00:00Z');
  assert.equal(lastBounce([old], tape).name, 'jam_old.wav');
  const owned = [old, bounce('jam_new.wav', '2026-10-02T10:00:00Z', { tape_id: 't2' })];
  assert.equal(lastBounce(owned, tape), null, 't2 made bounces called Groove too: the old one is not safely t1’s');
  assert.equal(lastBounce(owned, { id: 't2', name: 'Groove' }).name, 'jam_new.wav');
});

test('ties on the clock go to the later name; a take with no date is the oldest', () => {
  const same = '2026-10-15T09:00:00Z';
  assert.equal(lastBounce([bounce('jam_a.wav', same, { tape_id: 't1' }), bounce('jam_b.wav', same, { tape_id: 't1' })], tape).name, 'jam_b.wav');
  assert.equal(lastBounce([bounce('jam_nodate.wav', undefined, { tape_id: 't1' }), bounce('jam_a.wav', same, { tape_id: 't1' })], tape).name, 'jam_a.wav');
});

test('a bounce that once was a record is a bounce all the same', () => {
  const rec = bounce('jam_rec.wav', '2026-10-15T09:00:00Z', { tape_id: 't1', record: { cut: '2026-10-15T09:01:00Z', side: 'A', cover: 3 } });
  assert.equal(lastBounce([rec], tape).name, 'jam_rec.wav');
});

// --- the words and the toast -----------------------------------------------------------

test('the start toast says Bounce and how long the tape plays', () => {
  assert.match(bounceStartWords('0:08'), /^Bouncing 0:08/);
  assert.doesNotMatch(bounceStartWords('0:08'), /mix/i);
});

function fakeToast() {
  const shown = [];
  const toast = (msg, kind = 'ok', opts = {}) => {
    const t = { msg, kind, opts, actions: opts.actions || (opts.action ? [opts.action] : []), dismissed: false, dismiss() { this.dismissed = true; } };
    shown.push(t);
    return t;
  };
  return { shown, toast };
}
const listing = (takes) => async () => ({ ok: true, json: async () => takes });
class FakeAudio {
  constructor() { this.paused = true; this.src = ''; this.listeners = {}; FakeAudio.made.push(this); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; for (const f of this.listeners.pause || []) f(); }
  end() { this.paused = true; for (const f of this.listeners.ended || []) f(); }
}
FakeAudio.made = [];
const take = { name: 'jam_20261015-130100.wav', preview_name: 'jam_20261015-130100.mp3', has_preview: true, label: 'Second take loop', duration_seconds: 12 };

test('the bounce toast offers ▶ and Open', () => {
  const { shown, toast } = fakeToast();
  const went = [];
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player: { toggle() {} }, go: (u) => went.push(u) });
  const t = shown[0];
  assert.equal(t.msg, 'Bounced as a take');
  assert.deepEqual(t.actions.map((a) => a.label), ['▶', 'Open']);
  t.actions[1].run();
  assert.deepEqual(went, [`/wave.html?file=${encodeURIComponent(take.name)}`]);
});

test('▶ plays the take, on a toast of its own with ■ to stop it and Open; the end takes the toast away', async () => {
  FakeAudio.made.length = 0;
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([take]), Audio: FakeAudio });
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player, go() {} });
  await shown[0].actions[0].run();
  const a = FakeAudio.made[0];
  assert.equal(a.src, `/api/download?file=${take.preview_name}`, 'its preview, as every row plays');
  assert.equal(a.paused, false);
  const playing = shown[shown.length - 1];
  assert.deepEqual(playing.actions.map((x) => x.label), ['■', 'Open']);
  playing.actions[0].run();
  assert.equal(a.paused, true, '■ stops it');
  a.end();
  assert.equal(playing.dismissed, true);
});

test('▶ on the take that is playing pauses it rather than starting it twice', async () => {
  FakeAudio.made.length = 0;
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([take]), Audio: FakeAudio });
  await player.toggle(take.name);
  await player.toggle(take.name);
  assert.equal(FakeAudio.made.length, 1);
  assert.equal(FakeAudio.made[0].paused, true);
  assert.equal(shown.filter((t) => t.kind === 'bad').length, 0);
});

test('▶ on a bounce still being encoded says so, and plays nothing', async () => {
  FakeAudio.made.length = 0;
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([{ ...take, has_preview: false }]), Audio: FakeAudio });
  await player.toggle(take.name);
  assert.ok(FakeAudio.made.every((a) => a.paused), 'nothing playing');
  assert.equal(shown[0].kind, 'warn');
  assert.match(shown[0].msg, /encoding/i);
});

test('a bounce the Pi will not list is said, not played', async () => {
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: async () => ({ ok: false, status: 503 }), Audio: FakeAudio });
  await player.toggle(take.name);
  assert.equal(shown[0].kind, 'bad');
});

test('Last bounce raises the same toast for the newest bounce, naming it', () => {
  const { shown, toast } = fakeToast();
  const t = { ...take, origin: 'tape', tape_id: 't1', created: '2026-10-15T13:01:00Z' };
  lastBounceToast({ toast, take: t, player: { toggle() {} }, go() {} });
  assert.match(shown[0].msg, /Last bounce/);
  assert.match(shown[0].msg, /Second take loop/);
  assert.deepEqual(shown[0].actions.map((a) => a.label), ['▶', 'Open']);
  assert.ok((shown[0].opts.ms || 0) >= 10000, 'long enough to reach for');
});

test('Last bounce with none says so instead of staying silent', () => {
  const { shown, toast } = fakeToast();
  lastBounceToast({ toast, take: null, player: { toggle() {} }, go() {} });
  assert.equal(shown[0].actions.length, 0);
  assert.match(shown[0].msg, /no bounce|nothing bounced/i);
});

// --- records are gone; the takes that carried the mark are takes ------------------------

test('a take that carries a record mark appears on a shelf like any other, and nothing is split off for it', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const takes = [
    { name: 'jam_20261015-100000.wav', created: '2026-10-15T10:00:00Z', duration_seconds: 20, label: 'KEPT' },
    { name: 'jam_20261014-100000.wav', created: '2026-10-14T10:00:00Z', duration_seconds: 20, label: 'Once a record', record: { cut: '2026-10-14T11:00:00Z', side: 'A', cover: 2 } },
    { name: 'jam_20260901-100000.wav', created: '2026-09-01T10:00:00Z', duration_seconds: 20, label: 'Old record', record: { cut: '2026-09-02T11:00:00Z', side: 'B', cover: 0 } },
  ];
  const s = roomShelves(takes, null, {}, now);
  assert.equal('records' in s, false, 'there is no Records shelf');
  const names = s.month.spines.map((x) => x.take.name);
  assert.ok(names.includes('jam_20261014-100000.wav'), 'the marked take is this month’s');
  assert.ok(s.archive.some((b) => b.count >= 1), 'and the older one is in the archive');
});

test('a marked take is played in order with the others (Play all runs the shelf’s takes)', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const takes = [
    { name: 'jam_b.wav', created: '2026-10-15T10:00:00Z', duration_seconds: 20 },
    { name: 'jam_a.wav', created: '2026-10-14T10:00:00Z', duration_seconds: 20, record: { cut: '2026-10-14T11:00:00Z', side: 'A', cover: 0 } },
  ];
  assert.deepEqual(playOrder(roomShelves(takes, null, {}, now), 'jam_b.wav'), ['jam_b.wav', 'jam_a.wav']);
});

test('the scene contract has no record kind, and the room has no record module', () => {
  assert.equal('record' in MODELS, false);
  assert.deepEqual(Object.keys(MODELS).sort(), ['cable', 'cassette', 'reels', 'ribbon', 'vu']);
  assert.throws(() => readFileSync(new URL('../room/record.js', import.meta.url)), /ENOENT/);
  const contract = readFileSync(new URL('../../../../docs/superpowers/specs/2026-10-15-scene-contract-design.md', import.meta.url), 'utf8');
  assert.doesNotMatch(contract, /^\| `record` \|/m, 'the contract’s table of kinds');
  assert.doesNotMatch(readFileSync(new URL('../scene/models.js', import.meta.url), 'utf8'), /still to come \([^)]*record/);
});

// --- the rooms' pages point at nothing that was removed ------------------------------

const lib = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no rooms page offers Cut a record, the Records shelf or the turntable', () => {
  for (const f of ['../room/doorway.js', '../room/chair.js', '../room/shelves.js', '../room/swap.js', '../help/tips.js']) {
    const src = strip(lib(f));
    assert.doesNotMatch(src, /Cut a record|CUT A RECORD|Records shelf|RECORDS|turntable|Turntable|sleeve|room-cut|chair-cut|\bisRecord\b|record\.js|cutTakeRecord|cutTapeRecord|readyToCut/, f);
  }
  const css = lib('../../styles.css');
  assert.doesNotMatch(css, /room-sleeve|room-turntable|room-tt-|room-cutting|chair-cutting|\.chair-cut\b|room-next/, 'no rule for what is gone');
});

test('the tape page sends BOUNCE as the request Mix down always sent, and only the rooms change its words', () => {
  const page = lib('../tape/page.js');
  assert.match(page, /api\(`\/api\/tapes\/mixdown\?\$\{q\(\)\}`, \{ method: 'POST', body: \{ all \} \}\)/, 'the same request, no new route');
  assert.match(page, /bounceMenu\(document, \{ rooms: ROOMS \}\)/, 'the menu is rewritten only with the rooms on');
  assert.match(page, /Mixing down \$\{span\}/, 'and Mix down keeps its words with them off');
  assert.match(page, /bounceToast\(\{ toast, name: md\.take/, 'the done toast is the bounce toast, with ▶ and Open');
  assert.match(page, /lastBounceToast/);
  const own = lib('./bounce.js');
  assert.deepEqual([...own.matchAll(/'(\/api\/[a-z/]+)/g)].map((m) => m[1]).sort(), ['/api/jams']);
  assert.match(own, /`\/api\/download\?file=/);
});
