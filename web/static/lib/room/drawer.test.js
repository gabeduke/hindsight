// web/static/lib/room/drawer.test.js
// The notes drawer (lib/room/drawer.js) on a stand-in document and a
// stand-in take, and barNotes (notes.js), the take in the bar as its
// source: ✎ opens it at the frame heard, Enter adds a note there and the
// next goes where the take is then, a time goes there, ▶ plays from it,
// the words are edited in place, ✕ takes it out, GRAB sends its span, the
// name, ★ and tag change the take, and Done, Back and Escape put it away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { createLayers } from '../ui/layers.js';
import { Ticker } from '../objects/motion.js';
import { iconOf } from '../ui/icons.js';
import { createNotesDrawer, atLine } from './drawer.js';
import { notesOf, barNotes } from './notes.js';

const SR = 48000;
const tick = () => new Promise((r) => setTimeout(r, 0));

function stage({ head = true, flags = [], dock = null } = {}) {
  const doc = fakeDoc();
  globalThis.document = doc;
  globalThis.CSS = { escape: (s) => String(s) };
  const layers = createLayers({ doc, win: { addEventListener() {}, removeEventListener() {} }, CloseWatcher: undefined, history: undefined });
  // Less motion: the sheet is where it goes at once.
  const clock = new Ticker({ raf: () => 1, cancel() {}, now: () => 0, reduced: true });
  const toasts = [];
  const into = dock ? doc.createElement('aside') : null;
  if (into) doc.body.append(into);
  const drawer = createNotesDrawer({ doc, layers, toast: (m) => toasts.push(m), head, clock, reduced: () => true, dock: dock && { into, when: dock } });
  const calls = [];
  const fns = new Set();
  const changed = () => fns.forEach((f) => f());
  let take = { name: 'jam_a.wav', label: 'the riff', starred: false, tag: '', flags, sample_rate: SR };
  let now = 9 * SR;
  let n = 0;
  const source = {
    name: 'jam_a.wav', sampleRate: SR, total: 90 * SR,
    take: () => take,
    notes: () => notesOf(take.flags, SR),
    bpm: () => 0,
    frame: () => now,
    async add(frame, label) { calls.push(`add ${frame} ${label}`); take = { ...take, flags: [...take.flags, { id: `n${++n}`, frame, label }] }; changed(); },
    async edit(id, label) { calls.push(`edit ${id} ${label}`); take = { ...take, flags: take.flags.map((f) => (f.id === id ? { ...f, label } : f)) }; changed(); },
    async remove(id) { calls.push(`remove ${id}`); take = { ...take, flags: take.flags.filter((f) => f.id !== id) }; changed(); },
    async patch(fields) { calls.push(`patch ${JSON.stringify(fields)}`); take = { ...take, ...fields }; changed(); },
    seek(frame, { play = false } = {}) { calls.push(`seek ${frame}${play ? ' play' : ''}`); },
    async grab(span) { calls.push(`grab ${span.from}-${span.to}`); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
  return {
    doc, layers, drawer, source, calls, toasts, into,
    $: (id) => doc.getElementById(id),
    rows: () => doc.querySelectorAll('.notes-row'),
    setNow: (f) => { now = f; },
    async write(words) {
      doc.getElementById('notes-words').value = words;
      doc.getElementById('notes-write').dispatchEvent({ type: 'submit', preventDefault() {} });
      await tick();
    },
  };
}

test('atLine says where the words go', () => {
  assert.equal(atLine(9 * SR, SR), 'at 0:09');
  assert.equal(atLine(125 * SR, SR), 'at 2:05');
});

test('✎ opens it at the frame heard, put away until then, its words ready', () => {
  const s = stage();
  assert.equal(s.$('notes-drawer').hidden, true, 'put away until ✎');
  s.drawer.open(s.source, { at: 9 * SR });
  assert.equal(s.$('notes-drawer').hidden, false);
  assert.equal(s.drawer.isOpen, true);
  assert.match(s.$('notes-at').textContent, /at 0:09$/);
  assert.equal(iconOf(s.$('notes-at')), 'note', '✎ is drawn, not typed');
  assert.equal(s.doc.activeElement, s.$('notes-words'));
  assert.equal(s.$('notes-name').value, 'the riff', 'the take’s name, to edit in place');
  assert.equal(s.$('notes-none').hidden, false, 'no notes yet, and it says so');
  assert.equal(s.$('notes-drawer').getAttribute('aria-label'), 'Notes on the riff');
});

test('Enter adds the words at ✎’s frame; the next note goes where the take is then', async () => {
  const s = stage();
  s.drawer.open(s.source, { at: 9 * SR });
  await s.write('   ');
  assert.deepEqual(s.calls, [], 'no words, no note');
  s.setNow(12 * SR);
  await s.write('the bridge');
  assert.deepEqual(s.calls, [`add ${9 * SR} the bridge`]);
  assert.equal(s.$('notes-words').value, '', 'the field empties for the next one');
  assert.match(s.$('notes-at').textContent, /at 0:12$/, 'the take played on');
  await s.write('the drop');
  assert.equal(s.calls[1], `add ${12 * SR} the drop`);
  const rows = s.rows();
  assert.equal(rows.length, 2);
  assert.deepEqual([...rows].map((r) => r.querySelector('.notes-n').textContent), ['1', '2']);
  assert.equal(rows[0].querySelector('.notes-time').textContent, '0:09');
  assert.equal(rows[0].querySelector('.notes-row-words').value, 'the bridge');
  assert.equal(s.$('notes-none').hidden, true);
});

test('Enter never writes over another note: a note already on the frame moves the new one a frame on', async () => {
  const s = stage({ flags: [{ id: 'x', frame: 9 * SR, label: 'there' }] });
  s.drawer.open(s.source, { at: 9 * SR });
  await s.write('mine');
  assert.deepEqual(s.calls, [`add ${9 * SR + 1} mine`]);
});

test('a note’s time goes there, ▶ plays from it, its words are edited in place, ✕ takes it out', async () => {
  const s = stage({ flags: [{ id: 'a', frame: 30 * SR, label: 'verse' }] });
  s.drawer.open(s.source);
  const row = s.rows()[0];
  row.querySelector('.notes-time').dispatchEvent({ type: 'click' });
  assert.equal(s.calls.at(-1), `seek ${30 * SR}`, 'a tap on its time goes there');
  row.querySelector('.notes-play').dispatchEvent({ type: 'click' });
  assert.equal(s.calls.at(-1), `seek ${30 * SR} play`);
  assert.equal(iconOf(row.querySelector('.notes-play')), 'play');
  const w = row.querySelector('.notes-row-words');
  w.value = 'verse two ';
  w.dispatchEvent({ type: 'change' });
  assert.equal(s.calls.at(-1), 'edit a verse two');
  await tick();
  s.rows()[0].querySelector('.notes-out').dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(s.calls.at(-1), 'remove a');
  assert.equal(s.rows().length, 0);
});

test('GRAB sends the note’s span, to the next note at most', async () => {
  const s = stage({ flags: [{ id: 'a', frame: 10 * SR, label: '' }, { id: 'b', frame: 14 * SR, label: '' }] });
  s.drawer.open(s.source);
  s.rows()[0].querySelector('.notes-grab').dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(s.calls.at(-1), `grab ${10 * SR}-${14 * SR}`);
});

test('the name, ★ and tag change the take, and the drawer shows what they are now', async () => {
  const s = stage();
  s.drawer.open(s.source);
  s.$('notes-star').dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(s.calls.at(-1), 'patch {"starred":true}');
  assert.equal(s.$('notes-star').getAttribute('aria-pressed'), 'true');
  assert.equal(iconOf(s.$('notes-star')), 'star');
  s.$('notes-name').value = ' riff two ';
  s.$('notes-name').dispatchEvent({ type: 'change' });
  await tick();
  assert.equal(s.calls.at(-1), 'patch {"label":"riff two"}');
  assert.equal(s.$('notes-tag').getAttribute('aria-haspopup'), 'menu', 'the tag is a menu (lib/ui/menu.js)');
});

test('Done, Back and Escape put it away, by its layer on the stack', () => {
  const s = stage();
  s.drawer.open(s.source);
  assert.equal(s.layers.top()?.kind, 'drawer');
  s.$('notes-done').dispatchEvent({ type: 'click' });
  assert.equal(s.drawer.isOpen, false);
  assert.equal(s.$('notes-drawer').hidden, true);
  s.drawer.open(s.source);
  s.layers.top().close('escape');
  assert.equal(s.drawer.isOpen, false);
  assert.equal(s.drawer.source, null, 'put away, it lets the take go');
});

test('a name being written in is saved when Back puts the drawer away, not lost with it', async () => {
  const s = stage();
  s.drawer.open(s.source);
  const name = s.$('notes-name');
  // A browser fires change when a changed field loses the focus.
  name.blur = () => { s.doc.activeElement = null; name.dispatchEvent({ type: 'change' }); };
  name.focus();
  name.value = 'kept';
  s.layers.top().close('back');
  await tick();
  assert.equal(s.calls.at(-1), 'patch {"label":"kept"}');
  assert.equal(s.drawer.source, null);
});

test('a time or ▶ the bar can’t go to says so', async () => {
  const s = stage({ flags: [{ id: 'a', frame: SR, label: '' }] });
  s.source.seek = async () => { throw new Error('it can’t play yet'); };
  s.drawer.open(s.source);
  s.rows()[0].querySelector('.notes-play').dispatchEvent({ type: 'click' });
  await tick();
  assert.deepEqual(s.toasts, ['Couldn’t play it: it can’t play yet']);
});

test('the bar on something else: the next note goes a frame on, not to the start', async () => {
  const s = stage();
  s.drawer.open(s.source, { at: 9 * SR });
  s.setNow(null);
  await s.write('one');
  await s.write('two');
  assert.deepEqual(s.calls, [`add ${9 * SR} one`, `add ${9 * SR + 1} two`]);
});

test('without its head (Open, whose header has them) there is no name, ★ or tag', () => {
  const s = stage({ head: false });
  s.drawer.open(s.source);
  assert.equal(s.$('notes-name'), null);
  assert.equal(s.$('notes-star'), null);
  assert.equal(s.$('notes-tag'), null);
  assert.ok(s.$('notes-done'));
});

test('a refused note says so and keeps its words', async () => {
  const s = stage();
  s.source.add = async () => { throw new Error('the Pi is busy'); };
  s.drawer.open(s.source);
  await s.write('lost?');
  assert.deepEqual(s.toasts, ['Couldn’t add the note: the Pi is busy']);
  assert.equal(s.$('notes-words').value, 'lost?');
});

// --- barNotes: the take in the bar as the drawer's source -------------------------

function pi(take) {
  const sent = [];
  let flags = [...(take.flags || [])];
  const fetchImpl = async (url, init = {}) => {
    sent.push(`${init.method || 'GET'} ${url}${init.body ? ` ${init.body}` : ''}`);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.startsWith('/api/take/flags')) {
      const body = init.body ? JSON.parse(init.body) : {};
      const id = new URL(url, 'http://x').searchParams.get('id');
      if (init.method === 'POST') flags.push({ id: body.id, frame: body.frame, label: body.label || '' });
      if (init.method === 'PATCH') flags = flags.map((f) => (f.id === id ? { ...f, ...body } : f));
      if (init.method === 'DELETE') flags = flags.filter((f) => f.id !== id);
      return ok({ flags });
    }
    if (url.startsWith('/api/take?')) return ok(init.method === 'PATCH' ? { ...take, ...JSON.parse(init.body) } : take);
    if (url === '/api/tapes/cue/grab') return ok({});
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { sent, fetchImpl };
}

test('barNotes: the Pi’s take, its notes by its flags, where the bar is, and what it changes said to the room', async () => {
  globalThis.crypto ??= (await import('node:crypto')).webcrypto;
  const p = pi({ name: 'jam_a.wav', label: 'a', sample_rate: SR, duration_seconds: 60, bpm: 120, flags: [{ id: 'x', frame: SR, label: 'in' }] });
  const seeks = [];
  const heard = [];
  const went = [];
  const src = await barNotes('jam_a.wav', {
    fetchImpl: p.fetchImpl,
    bar: { frameNow: () => ({ take: 'jam_a.wav', frame: 5 * SR }), seekTake: async (n, f, o) => seeks.push([n, f, o]) },
    go: (u) => went.push(u),
    onChanged: (t) => heard.push(t.flags.length),
  });
  assert.equal(p.sent[0], 'GET /api/take?file=jam_a.wav');
  assert.equal(src.total, 60 * SR);
  assert.equal(src.bpm(), 120);
  assert.equal(src.frame(), 5 * SR);
  assert.deepEqual(src.notes().map((n) => n.label), ['in']);
  let told = 0;
  src.onChange(() => told++);
  await src.add(5 * SR, 'here');
  assert.deepEqual(src.notes().map((n) => n.label), ['in', 'here']);
  assert.deepEqual(heard, [2], 'the room hears it, to fetch its list again');
  assert.equal(told, 1, 'and the drawer');
  await src.patch({ starred: true });
  assert.equal(src.take().starred, true);
  assert.match(p.sent.at(-1), /^PATCH \/api\/take\?file=jam_a\.wav \{"starred":true\}$/);
  await src.seek(SR, { play: true });
  assert.deepEqual(seeks, [['jam_a.wav', SR, { play: true }]]);
  await src.grab({ from: SR, to: 2 * SR });
  assert.deepEqual(went, ['/tape.html'], 'GRAB goes to the Studio, by the router');
});

test('barNotes: the bar holding another take hears none of it; one that can’t be loaded throws; reload fetches it again; a take the Pi hasn’t got throws', async () => {
  const p = pi({ name: 'jam_a.wav', sample_rate: SR, duration_seconds: 10, starred: false });
  const src = await barNotes('jam_a.wav', { fetchImpl: p.fetchImpl, bar: { frameNow: () => ({ take: 'jam_b.wav', frame: 99 }), seekTake: async () => false }, go() {} });
  assert.equal(src.frame(), null);
  await assert.rejects(src.seek(0), /can’t play yet/);
  let told = 0;
  src.onChange(() => told++);
  await src.reload();
  assert.equal(p.sent.filter((x) => x.startsWith('GET')).length, 2);
  assert.equal(told, 1);
  await assert.rejects(barNotes('jam_z.wav', { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no such take' }) }), bar: {}, go() {} }), /no such take/);
});

// A stand-in MediaQueryList: matches, and says when it changes.
function screen(matches) {
  const fns = new Set();
  return {
    matches,
    addEventListener: (_, fn) => fns.add(fn),
    removeEventListener: (_, fn) => fns.delete(fn),
    set(m) { this.matches = m; fns.forEach((fn) => fn()); },
  };
}

test('docked, it stands in the dock, shown, with no drag; its ✎ follows the take until the words are begun', async () => {
  const wide = screen(true);
  const s = stage({ head: false, dock: wide });
  assert.ok(s.drawer.el.parentElement === s.into, 'in the dock');
  assert.equal(s.drawer.el.hidden, false);
  assert.ok(s.drawer.el.classList.contains('notes-docked'));
  s.drawer.open(s.source, { focus: false });
  assert.equal(s.drawer.isOpen, true);
  assert.notEqual(s.doc.activeElement, s.$('notes-words'), 'focus: false leaves the keys alone');
  assert.match(s.$('notes-at').textContent, /at 0:09$/);
  s.setNow(20 * SR);
  s.drawer.refresh();
  assert.match(s.$('notes-at').textContent, /at 0:20$/, 'it follows the take');
  s.$('notes-words').focus();
  s.$('notes-words').dispatchEvent({ type: 'focus' });
  s.setNow(25 * SR);
  s.drawer.refresh();
  assert.match(s.$('notes-at').textContent, /at 0:20$/, 'begun, it stays where the words began');
  await s.write('here');
  assert.deepEqual(s.calls, [`add ${20 * SR} here`]);
  assert.equal(s.layers.top(), null, 'docked, it is not on the stack: Back and Escape are the page’s');
});

test('the screen narrowing puts the docked drawer back as a sheet, away; widening docks it again with its take', () => {
  const wide = screen(true);
  const s = stage({ head: false, dock: wide });
  s.drawer.open(s.source, { focus: false });
  wide.set(false);
  assert.ok(s.drawer.el.parentElement === s.doc.body, 'back at the end of the page');
  assert.equal(s.drawer.el.hidden, true, 'put away until ✎');
  s.drawer.open(s.source);
  assert.equal(s.drawer.el.hidden, false, '✎ brings it up as a sheet');
  wide.set(true);
  assert.ok(s.drawer.el.parentElement === s.into, 'docked again');
  assert.equal(s.drawer.el.hidden, false);
  assert.ok(s.drawer.source === s.source, 'with its take');
});
