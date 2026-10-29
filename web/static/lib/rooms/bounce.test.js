// web/static/lib/rooms/bounce.test.js
// F2 of the flow spec (docs/architecture/rooms.md, Vocabulary):
// BOUNCE is the tape's menu's one verb for a tape into a take, in place of
// Mix down ×2 and Cut a record. Its toast has ▶ and Open, the menu keeps
// the last bounce, and a take that was once marked as a record is an
// ordinary take. The menu is the Studio's own markup (the tape's name's),
// built on a stand-in document; the player runs on a stand-in <audio>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { fileCss } from '../stylesheets.js';
import { bounceMenu, lastBounce, lastBounceKeeper, bounceToast, lastBounceToast, takePlayer, bounceStartWords, BOUNCE_WORDS } from './bounce.js';
import { wallShelves } from '../room/shelves.js';
import { MODELS } from '../scene/models.js';

const tapeHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');

// The tape's menu, as served: the real markup, in a stand-in document.
function menu() {
  const doc = fakeDoc();
  const holder = parseHTML(doc, tapeHtml);
  const actions = holder.querySelector('#tape-menu');
  doc.body.append(actions);
  return { doc, actions };
}
const words = (actions) => actions.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')
  .map((b) => (b.querySelector('.menu-word') || b).textContent.trim());

test('the tape’s menu offers Bounce the loop and Bounce the whole tape, and neither Mix down nor Cut a record', () => {
  const { doc, actions } = menu();
  bounceMenu(doc);
  const w = words(actions);
  assert.ok(w.includes('Bounce the loop'), w.join(' | '));
  assert.ok(w.includes('Bounce the whole tape'), w.join(' | '));
  assert.ok(w.includes('Play the last bounce'), 'and the tape keeps its last bounce');
  assert.equal(w.filter((x) => /Mix down|Cut a record/i.test(x)).length, 0, w.join(' | '));
});

test('the bounce items are the mixdown items: the same buttons, so the same requests', () => {
  const { doc, actions } = menu();
  const loop = actions.querySelector('#tape-mixdown'), whole = actions.querySelector('#tape-mixdown-all');
  bounceMenu(doc);
  assert.equal(actions.querySelector('#tape-mixdown'), loop);
  assert.equal(actions.querySelector('#tape-mixdown-all'), whole);
  assert.equal(loop.querySelector('.menu-word').textContent, BOUNCE_WORDS.loop);
  assert.equal(whole.querySelector('.menu-word').textContent, BOUNCE_WORDS.whole);
  assert.equal(loop.getAttribute('data-tip'), 'bounce');
  assert.equal(whole.getAttribute('data-tip'), 'bounce');
});

test('the last bounce is in the bounces’ group, after Export stems, a row of its own, disabled until there is one, and says so on its face', () => {
  const { doc, actions } = menu();
  bounceMenu(doc);
  const items = actions.children;
  const at = (id) => items.indexOf(actions.querySelector(id));
  assert.equal(at('#tape-last-bounce'), at('#tape-export') + 1);
  for (let i = at('#tape-mixdown'); i < at('#tape-last-bounce'); i++) assert.ok(!items[i].classList.contains('menu-divider'), 'no line between them');
  const last = actions.querySelector('#tape-last-bounce');
  assert.equal(last.getAttribute('role'), 'menuitem');
  assert.equal(last.getAttribute('data-tip'), 'last-bounce');
  assert.equal(last.disabled, true, 'none yet');
  assert.equal(last.querySelector('.menu-sub').textContent, 'none yet', 'a phone has no tooltip');
});

test('asking twice does not add a second last bounce', () => {
  const { doc, actions } = menu();
  bounceMenu(doc);
  bounceMenu(doc);
  assert.equal(actions.querySelectorAll('#tape-last-bounce').length, 1);
  assert.equal(actions.querySelector('#tape-last-bounce').querySelectorAll('.menu-sub').length, 1);
});

test('bounceMenu answers a setter for Last bounce: enabled with a take, disabled without', () => {
  const { doc, actions } = menu();
  const m = bounceMenu(doc);
  const last = actions.querySelector('#tape-last-bounce');
  m.setLast({ name: 'jam_20261015-130100.wav', label: 'Second take loop' });
  assert.equal(last.disabled, false);
  assert.equal(m.take.name, 'jam_20261015-130100.wav');
  assert.equal(last.querySelector('.menu-sub').textContent, 'Second take loop', 'it says which take');
  m.setLast(null);
  assert.equal(last.disabled, true);
  assert.equal(m.take, null);
  assert.equal(last.querySelector('.menu-sub').textContent, 'none yet');
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
  constructor() { this.paused = true; this.src = ''; this.playCalls = 0; this.listeners = {}; FakeAudio.made.push(this); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  play() {
    this.playCalls++;
    if (FakeAudio.reject) return Promise.reject(Object.assign(new Error('The request is not allowed'), { name: 'NotAllowedError' }));
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; for (const f of this.listeners.pause || []) f(); }
  end() { this.paused = true; for (const f of this.listeners.ended || []) f(); }
}
FakeAudio.made = [];
FakeAudio.reject = false;
const take = { name: 'jam_20261015-130100.wav', preview_name: 'jam_20261015-130100.mp3', has_preview: true, label: 'Second take loop', duration_seconds: 12 };
const stub = { toggle() {}, prepare() {} };
const instant = async () => {};
const fresh = () => { FakeAudio.made.length = 0; FakeAudio.reject = false; };

test('the bounce toast offers ▶ and Open', () => {
  const { shown, toast } = fakeToast();
  const went = [];
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player: stub, go: (u) => went.push(u) });
  const t = shown[0];
  assert.equal(t.msg, 'Bounced as a take');
  assert.deepEqual(t.actions.map((a) => a.label), ['▶', 'Open']);
  t.actions[1].run();
  assert.deepEqual(went, [`/wave.html?file=${encodeURIComponent(take.name)}`]);
});

test('the take is looked up and its audio built when the toast is raised, so ▶ calls play() inside the tap, with nothing awaited first', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  let fetches = 0;
  const fetchImpl = async () => { fetches++; return { ok: true, json: async () => [take] }; };
  const player = takePlayer({ toast, fetchImpl, Audio: FakeAudio, sleep: instant });
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player, go() {} });
  await player.whenReady();
  const a = FakeAudio.made[0];
  assert.ok(a, 'the audio exists before anyone taps');
  assert.equal(a.src, `/api/download?file=${take.preview_name}`, 'its preview, as every row plays');
  assert.equal(a.playCalls, 0);
  const asked = fetches;
  const run = shown[0].actions[0].run();
  assert.equal(a.playCalls, 1, 'play() ran before the tap’s handler returned: still inside the gesture');
  assert.equal(fetches, asked, 'and nothing was fetched on the tap');
  await run;
});

test('▶ plays the take, on a toast of its own with ■ to stop it and Open; the end takes the toast away', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([take]), Audio: FakeAudio, sleep: instant });
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player, go() {} });
  await player.whenReady();
  await shown[0].actions[0].run();
  const a = FakeAudio.made[0];
  assert.equal(a.paused, false);
  const playing = shown[shown.length - 1];
  assert.deepEqual(playing.actions.map((x) => x.label), ['■', 'Open']);
  playing.actions[0].run();
  assert.equal(a.paused, true, '■ stops it');
  a.end();
  assert.equal(playing.dismissed, true);
});

test('a ▶ the browser refuses (iOS holds sound back) says so and keeps Open reachable, as the first toast went when it was tapped', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const went = [];
  const player = takePlayer({ toast, fetchImpl: listing([take]), Audio: FakeAudio, sleep: instant, go: (u) => went.push(u) });
  bounceToast({ toast, name: take.name, message: 'Bounced as a take', player, go: (u) => went.push(u) });
  await player.whenReady();
  FakeAudio.reject = true;
  await shown[0].actions[0].run();
  const last = shown[shown.length - 1];
  assert.equal(last.kind, 'bad');
  assert.match(last.msg, /Couldn’t play it/);
  assert.ok(last.actions.some((a) => a.label === 'Open'), 'Open is offered again');
  last.actions.find((a) => a.label === 'Open').run();
  assert.deepEqual(went, [`/wave.html?file=${encodeURIComponent(take.name)}`]);
  FakeAudio.reject = false;
  await player.whenReady();
  await player.toggle(take.name);
  assert.equal(FakeAudio.made.at(-1).paused, false, 'and a second tap can still play it');
});

test('▶ on the take that is playing pauses it rather than starting it twice', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([take]), Audio: FakeAudio, sleep: instant });
  await player.prepare(take.name);
  await player.toggle(take.name);
  await player.toggle(take.name);
  assert.equal(FakeAudio.made.length, 1);
  assert.equal(FakeAudio.made[0].paused, true);
  assert.equal(shown.filter((t) => t.kind === 'bad').length, 0);
});

test('▶ on a bounce still being encoded says so with Open beside it, and plays nothing', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: listing([{ ...take, has_preview: false }]), Audio: FakeAudio, sleep: instant, tries: 2 });
  await player.prepare(take.name);
  await player.toggle(take.name);
  assert.ok(FakeAudio.made.every((a) => a.playCalls === 0), 'nothing played');
  assert.equal(shown[0].kind, 'warn');
  assert.match(shown[0].msg, /encoding/i);
  assert.ok(shown[0].actions.some((a) => a.label === 'Open'));
});

test('a preview that lands while the toast is up makes ▶ work: the lookup tries again', async () => {
  fresh();
  const { toast } = fakeToast();
  let n = 0;
  const fetchImpl = async () => ({ ok: true, json: async () => [{ ...take, has_preview: ++n >= 3 }] });
  const player = takePlayer({ toast, fetchImpl, Audio: FakeAudio, sleep: instant });
  await player.prepare(take.name);
  assert.equal(n, 3);
  await player.toggle(take.name);
  assert.equal(FakeAudio.made[0].playCalls, 1);
});

test('a bounce the Pi will not list is said, not played', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const player = takePlayer({ toast, fetchImpl: async () => ({ ok: false, status: 503 }), Audio: FakeAudio, sleep: instant });
  await player.prepare(take.name);
  await player.toggle(take.name);
  assert.equal(shown[0].kind, 'bad');
  assert.equal(FakeAudio.made.length, 0);
});

test('a lookup that answers late, after another take was asked for, does not take its place; a tap meanwhile plays nothing', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const other = { ...take, name: 'jam_other.wav', preview_name: 'jam_other.mp3' };
  let release;
  const slow = new Promise((r) => { release = r; });
  const fetchImpl = async () => {
    // the first ask is the slow one
    if (!release.used) { release.used = true; await slow; return { ok: true, json: async () => [take] }; }
    return { ok: true, json: async () => [other] };
  };
  const player = takePlayer({ toast, fetchImpl, Audio: FakeAudio, sleep: instant });
  const first = player.prepare(take.name);
  await player.toggle(take.name); // a tap during the lookup
  assert.equal(FakeAudio.made.length, 0, 'nothing to play yet');
  assert.equal(shown[0].kind, 'warn');
  await player.prepare(other.name);
  release();
  await first;
  assert.equal(FakeAudio.made.length, 1, 'the late answer built no audio');
  await player.toggle(other.name);
  assert.equal(FakeAudio.made[0].src, '/api/download?file=jam_other.mp3');
  assert.equal(FakeAudio.made[0].playCalls, 1);
});

test('a stop while the lookup is out leaves the late answer silent', async () => {
  fresh();
  const { toast } = fakeToast();
  let release;
  const slow = new Promise((r) => { release = r; });
  const fetchImpl = async () => { await slow; return { ok: true, json: async () => [take] }; };
  const player = takePlayer({ toast, fetchImpl, Audio: FakeAudio, sleep: instant });
  const asked = player.prepare(take.name);
  player.stop();
  release();
  await asked;
  assert.ok(FakeAudio.made.every((a) => a.playCalls === 0), 'nothing started');
  assert.equal(player.playing, null);
});

test('a lookup waiting for a preview to be encoded stops asking once another take is asked for', async () => {
  fresh();
  const { toast } = fakeToast();
  const other = { ...take, name: 'jam_other.wav', preview_name: 'jam_other.mp3' };
  let fetches = 0, wake;
  const sleep = () => new Promise((r) => { wake = r; });
  const fetchImpl = async () => { fetches++; return { ok: true, json: async () => [{ ...take, has_preview: false }, other] }; };
  const player = takePlayer({ toast, fetchImpl, Audio: FakeAudio, sleep });
  const first = player.prepare(take.name);
  await Promise.resolve();
  await player.prepare(other.name);
  assert.equal(fetches, 2);
  wake();
  await first;
  assert.equal(fetches, 2, 'the overtaken lookup did not ask again');
});

test('Last bounce raises the same toast for the newest bounce, naming it; it knows the take, so it asks the Pi nothing', async () => {
  fresh();
  const { shown, toast } = fakeToast();
  const t = { ...take, origin: 'tape', tape_id: 't1', created: '2026-10-15T13:01:00Z' };
  const player = takePlayer({ toast, fetchImpl: async () => { throw new Error('no lookup needed'); }, Audio: FakeAudio, sleep: instant });
  lastBounceToast({ toast, take: t, player, go() {} });
  assert.match(shown[0].msg, /^The last bounce/);
  assert.match(shown[0].msg, /Second take loop/);
  assert.deepEqual(shown[0].actions.map((a) => a.label), ['▶', 'Open']);
  assert.ok((shown[0].opts.ms || 0) >= 10000, 'long enough to reach for');
  await player.whenReady();
  const run = shown[0].actions[0].run();
  assert.equal(FakeAudio.made[0].playCalls, 1, 'and ▶ plays inside the tap');
  await run;
});

test('Last bounce with none says so instead of staying silent', () => {
  const { shown, toast } = fakeToast();
  lastBounceToast({ toast, take: null, player: stub, go() {} });
  assert.equal(shown[0].actions.length, 0);
  assert.match(shown[0].msg, /no bounce|nothing bounced/i);
});

// --- Last bounce follows the loaded tape ------------------------------------------------

function fakeMenu() {
  const m = { states: [], take: null, setLast(t) { m.take = t; m.states.push(t && t.name); } };
  return m;
}
const bounceOf = (name, tapeId) => ({ name, origin: 'tape', tape_id: tapeId, label: tapeId, created: '2026-10-15T13:00:00Z', has_preview: true, preview_name: `${name}.mp3` });

test('after a switch to another tape, Last bounce is disabled until the Pi answers, and the other tape’s bounce is never offered for it', async () => {
  const menu = fakeMenu();
  let tape = { id: 'B', name: 'B' };
  let release;
  const gate = new Promise((r) => { release = r; });
  const keeper = lastBounceKeeper({ menu, tapeNow: () => tape, fetchImpl: async () => { await gate; return { ok: true, json: async () => [bounceOf('jam_b.wav', 'B')] }; } });
  keeper.set(bounceOf('jam_b.wav', 'B'), 'B');
  assert.equal(keeper.take()?.name, 'jam_b.wav');
  tape = { id: 'A', name: 'A' };
  assert.equal(keeper.take(), null, 'B’s bounce is not A’s, even before anyone asks');
  const asked = keeper.refresh();
  assert.equal(menu.take, null, 'the menu line is off while the answer is out');
  release();
  await asked;
  assert.equal(menu.take, null, 'and the answer had none for A');
  assert.equal(keeper.take(), null);
});

test('an answer that returns after the tape changed is ignored', async () => {
  const menu = fakeMenu();
  let tape = { id: 'B', name: 'B' };
  let release;
  const gate = new Promise((r) => { release = r; });
  const keeper = lastBounceKeeper({ menu, tapeNow: () => tape, fetchImpl: async () => { await gate; return { ok: true, json: async () => [bounceOf('jam_b.wav', 'B')] }; } });
  const asked = keeper.refresh(); // asked for B
  tape = { id: 'A', name: 'A' };
  keeper.changed('A');
  release();
  await asked;
  assert.equal(menu.take, null, 'B’s late answer did not light A’s Last bounce');
  assert.equal(keeper.take(), null);
});

test('the same tape: the answer lights Last bounce, and a bounce just made stands without asking', async () => {
  const menu = fakeMenu();
  const tape = { id: 'A', name: 'A' };
  const keeper = lastBounceKeeper({ menu, tapeNow: () => tape, fetchImpl: async () => ({ ok: true, json: async () => [bounceOf('jam_a.wav', 'A')] }) });
  await keeper.refresh();
  assert.equal(keeper.take().name, 'jam_a.wav');
  keeper.set({ name: 'jam_new.wav', label: 'A' }, 'A');
  assert.equal(menu.take.name, 'jam_new.wav');
});

test('a Pi that does not answer leaves Last bounce as it was for this tape', async () => {
  const menu = fakeMenu();
  const tape = { id: 'A', name: 'A' };
  const keeper = lastBounceKeeper({ menu, tapeNow: () => tape, fetchImpl: async () => { throw new Error('down'); } });
  keeper.set(bounceOf('jam_a.wav', 'A'), 'A');
  await keeper.refresh();
  assert.equal(keeper.take().name, 'jam_a.wav');
});

test('a disabled last bounce says why on its face, not only in a tooltip, and an enabled one which take it plays', () => {
  const { doc, actions } = menu();
  const m = bounceMenu(doc);
  const last = actions.querySelector('#tape-last-bounce');
  const note = last.querySelector('.bounce-note');
  assert.ok(note, 'a visible second line');
  assert.match(note.textContent, /none yet/);
  assert.equal(note.getAttribute('aria-hidden'), null, 'a screen reader hears it too');
  m.setLast({ name: 'jam_a.wav', label: 'A' });
  assert.equal(last.querySelector('.bounce-note').textContent, 'A');
  m.setLast(null);
  assert.match(last.querySelector('.bounce-note').textContent, /none yet/);
});

// --- records are gone; the takes that carried the mark are takes ------------------------

test('a take that carries a record mark appears on a shelf like any other, and nothing is split off for it', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const takes = [
    { name: 'jam_20261015-100000.wav', created: '2026-10-15T10:00:00Z', duration_seconds: 20, label: 'KEPT' },
    { name: 'jam_20261014-100000.wav', created: '2026-10-14T10:00:00Z', duration_seconds: 20, label: 'Once a record', record: { cut: '2026-10-14T11:00:00Z', side: 'A', cover: 2 } },
    { name: 'jam_20260901-100000.wav', created: '2026-09-01T10:00:00Z', duration_seconds: 20, label: 'Old record', record: { cut: '2026-09-02T11:00:00Z', side: 'B', cover: 0 } },
  ];
  const s = wallShelves(takes, {}, now);
  assert.deepEqual(s.map((x) => x.kind), ['month', 'month'], 'there is no Records shelf');
  const names = s[0].spines.map((x) => x.take.name);
  assert.ok(names.includes('jam_20261014-100000.wav'), 'the marked take is this month’s');
  assert.equal(s[1].key, 'month:2026-09', 'and the older one is on its own month’s shelf');
});

test('a marked take stands in order with the others on the shelf', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const takes = [
    { name: 'jam_b.wav', created: '2026-10-15T10:00:00Z', duration_seconds: 20 },
    { name: 'jam_a.wav', created: '2026-10-14T10:00:00Z', duration_seconds: 20, record: { cut: '2026-10-14T11:00:00Z', side: 'A', cover: 0 } },
  ];
  assert.deepEqual(wallShelves(takes, {}, now)[0].spines.map((x) => x.take.name), ['jam_b.wav', 'jam_a.wav']);
});

test('the scene contract has no record kind, and the room has no record module', () => {
  assert.equal('record' in MODELS, false);
  assert.deepEqual(Object.keys(MODELS).sort(), ['cable', 'cassette', 'prop', 'reels', 'ribbon', 'vu']);
  assert.throws(() => readFileSync(new URL('../room/record.js', import.meta.url)), /ENOENT/);
  // The scene contract is docs/architecture/css-and-motion.md now; read every
  // architecture file, so the check still holds wherever the contract moves.
  const docs = new URL('../../../../docs/architecture/', import.meta.url);
  const contract = readdirSync(docs).filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(new URL(f, docs), 'utf8')).join('\n');
  assert.match(contract, /^## The scene contract$/m, 'the contract is where this test reads it');
  assert.doesNotMatch(contract, /^\| `record` \|/m, 'the contract’s table of kinds');
  assert.doesNotMatch(readFileSync(new URL('../scene/models.js', import.meta.url), 'utf8'), /still to come \([^)]*record/);
});

// --- the rooms' pages point at nothing that was removed ------------------------------

const lib = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no rooms page offers Cut a record, the Records shelf or the turntable', () => {
  for (const f of ['../room/doorway.js', '../room/open.js', '../room/shelves.js', '../help/tips.js']) {
    const src = strip(lib(f));
    assert.doesNotMatch(src, /Cut a record|CUT A RECORD|Records shelf|RECORDS|turntable|Turntable|sleeve|room-cut|chair-cut|\bisRecord\b|record\.js|cutTakeRecord|cutTapeRecord|readyToCut/, f);
  }
  const css = fileCss('styles.css');
  assert.doesNotMatch(css, /room-sleeve|room-turntable|room-tt-|room-cutting|chair-cutting|\.chair-cut\b|room-next/, 'no rule for what is gone');
});

test('the tape page sends BOUNCE as the request Mix down always sent', () => {
  const page = lib('../tape/page.js');
  assert.match(page, /api\(`\/api\/tapes\/mixdown\?\$\{q\(\)\}`, \{ method: 'POST', body: \{ all \} \}\)/, 'the same request, no new route');
  assert.match(page, /bounceMenu\(document\)/, 'the menu is rewritten as BOUNCE');
  assert.doesNotMatch(page, /Mixing down|Mixed down as a take/, 'and Mix down’s words are gone');
  assert.match(page, /bounceToast\(\{ toast, name: md\.take/, 'the done toast is the bounce toast, with ▶ and Open');
  assert.match(page, /lastBounceToast/);
  assert.match(page, /lastBounceKeeper\(\{ menu, tapeNow/, 'Last bounce follows the loaded tape');
  assert.match(page, /bouncing\.keeper\.refresh\(\)/, 'and is asked again as the menu opens');
  assert.match(page, /bouncing\.keeper\.changed\(state\.id\)/, 'with another tape’s bounce dropped first');
  assert.match(page, /take: bouncing\.keeper\.take\(\)/, 'the click offers only this tape’s');
  assert.doesNotMatch(page, /bouncing\.menu\.take/, 'never the menu’s own memory');
  const own = lib('./bounce.js');
  assert.deepEqual([...new Set([...own.matchAll(/'(\/api\/[a-z/]+)/g)].map((m) => m[1]))].sort(), ['/api/jams']);
  assert.match(own, /`\/api\/download\?file=/);
});
