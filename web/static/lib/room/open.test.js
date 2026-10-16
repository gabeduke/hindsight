// web/static/lib/room/open.test.js
// Open: a take's page with the rooms on (lib/room/open.js), mounted on
// wave.html's real markup in a stand-in document, with the page's handle
// (its flags, its cursor, its clock) as a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const SR = 48000;
const waveHtml = readFileSync(new URL('../../wave.html', import.meta.url), 'utf8');
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const jam = (n, extra = {}) => ({ name: `jam_${n}.wav`, label: n, created: '2026-10-15T20:00:00Z', duration_seconds: 90, ...extra });

async function open({ file = 'jam_a.wav', arrivalNote = null, jams = [], region = null, bpm = null } = {}) {
  const doc = fakeDoc();
  globalThis.document = doc;
  doc.body.append(...parseHTML(doc, waveHtml.slice(waveHtml.indexOf('<body'))).children);
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.location = { href: '', search: '' };
  globalThis.fetch = async (u) => (String(u).startsWith('/api/jams') ? { ok: true, json: async () => jams } : { ok: false, status: 404, json: async () => ({}) });
  const calls = [];
  const state = { cursor: 7 * SR, region, grid: { bpm, sampleRate: SR, downbeat: 0 }, flags: [] };
  let hooks = [];
  const h = {
    file, take: { name: 'jam_a.wav', label: 'a', created: '2026-10-15T20:00:00Z', tag: '' }, sampleRate: SR, total: 90 * SR, peaks: null,
    toast: (m) => calls.push(`toast ${m}`),
    state: () => state, playing: () => false, togglePlay: async () => { calls.push('play'); }, seek: (f) => { calls.push(`seek ${f}`); state.cursor = f; },
    addNote: (f) => { calls.push(`add ${f}`); state.flags.push({ id: `f${state.flags.length + 1}`, frame: f, label: '' }); hooks.forEach((fn) => fn()); return `f${state.flags.length}`; },
    editNote: (id, label) => { calls.push(`edit ${id} ${label}`); state.flags.find((x) => x.id === id).label = label; },
    removeNote: (id) => { calls.push(`remove ${id}`); state.flags = state.flags.filter((x) => x.id !== id); hooks.forEach((fn) => fn()); },
    patch: async (b) => b,
    onRedraw: (fn) => hooks.push(fn),
    arrivalNote,
  };
  const { mount } = await import('./open.js');
  const out = mount(h);
  await new Promise((r) => setTimeout(r, 0)); // the family lines are fetched
  return { doc, h, calls, state, out, $: (id) => doc.getElementById(id), all: (s) => doc.querySelectorAll(s) };
}

test('Open adds ✎ Note in place of the flag key, and the flag key is out of the way', async () => {
  const p = await open();
  assert.equal(p.$('flag-now').hidden, true);
  const note = p.$('room-open-note');
  assert.ok(note, 'the ✎ key is made');
  assert.equal(note.textContent, '✎');
  assert.equal(note.getAttribute('aria-label'), 'Note at the playhead');
  assert.ok(p.doc.body.classList.contains('room-open-on'));
});

test('✎ Note makes a note at the playhead and puts the cursor in its words', async () => {
  const p = await open();
  p.$('room-open-note').dispatchEvent({ type: 'click' });
  assert.deepEqual(p.calls.filter((c) => c.startsWith('add')), [`add ${7 * SR}`]);

  const rows = p.all('.room-open-note-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.room-open-at').textContent, '0:07');
  assert.equal(p.doc.activeElement, rows[0].querySelector('.room-open-words'), 'its words are ready for typing');
});

test('the Notes heading has a ✎ Note too, since a phone’s bar folds its own keys away', async () => {
  const p = await open();
  p.all('.room-open-note-btn')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(p.calls.filter((c) => c.startsWith('add')), [`add ${7 * SR}`]);
});

test('✎ on the bar arrives with a note already started at the frame that was heard', async () => {
  const p = await open({ arrivalNote: 44 * SR });
  assert.deepEqual(p.calls.filter((c) => c.startsWith('add')), [`add ${44 * SR}`]);
  assert.equal(p.doc.activeElement, p.all('.room-open-words')[0]);
  const none = await open();
  assert.deepEqual(none.calls.filter((c) => c.startsWith('add')), [], 'no note when the bar did not ask for one');
});

test('a note is one line: number, time, words, ▶ from here, GRAB from here, ✕', async () => {
  const p = await open({ arrivalNote: 10 * SR });
  const row = p.all('.room-open-note-row')[0];
  const words = row.querySelector('.room-open-words');
  words.value = 'the bridge';
  words.dispatchEvent({ type: 'change' });
  assert.ok(p.calls.includes('edit f1 the bridge'));
  row.querySelector('.room-open-play').dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(p.calls.includes(`seek ${10 * SR}`) && p.calls.includes('play'), '▶ plays from the note');
  assert.ok(row.querySelector('.room-open-grab-note'), 'GRAB from here');
  row.querySelector('.room-open-out').dispatchEvent({ type: 'click' });
  assert.ok(p.calls.includes('remove f1'));
  assert.equal(p.all('.room-open-note-row').length, 0);
});

test('Send to is gone, GRAB having taken Tape and Clipboard; KEEP says what it keeps; GRAB sits beside it', async () => {
  const p = await open({ region: { start: 0, end: 120 * SR } });
  assert.equal(p.$('send-btn').style.display, 'none');
  assert.equal(p.$('send-menu').style.display, 'none');
  assert.equal(p.$('send-menu').children.length, 3, 'the menu is not given a GRAB of its own');
  assert.equal(p.$('save-take').textContent, 'KEEP 2m');
  assert.match(p.all('.room-open-grab')[0].textContent, /^GRAB/);
});

test('From this take and Earlier bounces list the family, and a line opens that take', async () => {
  const spine = jam('spine', { created: '2026-10-15T20:00:00Z' });
  const cut = jam('cut', { name: 'jam_cut.wav', source: { name: 'jam_a.wav' } });
  const jams = [jam('a', { name: 'jam_a.wav' }), cut];
  const p = await open({ jams });
  const lines = p.all('.room-open-fam-line');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].getAttribute('href'), '/wave.html?file=jam_cut.wav');
  assert.equal(p.all('.room-open-fam')[0].getAttribute('aria-label'), 'From this take');
  void spine;
});

test('with no family there is no heading for one', async () => {
  const p = await open({ jams: [jam('a', { name: 'jam_a.wav' })] });
  assert.equal(p.all('.room-open-fam').length, 0);
});

test('familyLines: a take’s cuts and its tape’s earlier bounces, the take itself never among them', async () => {
  const { familyLines } = await import('./open.js');
  const a = jam('a', { name: 'jam_a.wav' });
  const cut = jam('c', { name: 'jam_c.wav', source: { name: 'jam_a.wav' } });
  const m1 = jam('m1', { name: 'jam_m1.wav', origin: 'tape', tape_id: 't1', created: '2026-10-14T10:00:00Z' });
  const m2 = jam('m2', { name: 'jam_m2.wav', origin: 'tape', tape_id: 't1', created: '2026-10-15T10:00:00Z' });
  const l = familyLines([a, cut, m1, m2], 'jam_a.wav');
  assert.deepEqual(l.from.map((x) => x.name), ['jam_c.wav']);
  assert.deepEqual(l.earlier, []);
  const onBounce = familyLines([a, cut, m1, m2], 'jam_m2.wav');
  assert.deepEqual(onBounce.earlier.map((x) => x.name), ['jam_m1.wav'], 'the newest bounce lists the earlier ones');
  const onOld = familyLines([a, cut, m1, m2], 'jam_m1.wav');
  assert.deepEqual(onOld.earlier.map((x) => x.name), ['jam_m2.wav'], 'an older bounce lists the newest, which stands as the spine');
  assert.deepEqual(onBounce.earlier.map((x) => x.name), ['jam_m1.wav'], 'and the newest lists the older ones');
  assert.deepEqual(familyLines('nonsense', 'jam_a.wav'), { from: [], madeFrom: null, earlier: [] });
});

test('From this take means made from this take; a cut says Made from its source instead', async () => {
  const { familyLines } = await import('./open.js');
  const a = jam('a', { name: 'jam_a.wav' });
  const c = jam('c', { name: 'jam_c.wav', source: { name: 'jam_a.wav' } });
  const d = jam('d', { name: 'jam_d.wav', source: { name: 'jam_a.wav' } });
  const e = jam('e', { name: 'jam_e.wav', source: { name: 'jam_c.wav' } });
  const onC = familyLines([a, c, d, e], 'jam_c.wav');
  assert.deepEqual(onC.from.map((x) => x.name), ['jam_e.wav'], 'only what was cut from c: not its sibling d');
  assert.equal(onC.madeFrom.name, 'jam_a.wav', 'c links back to a');
  const onA = familyLines([a, c, d, e], 'jam_a.wav');
  assert.deepEqual(onA.from.map((x) => x.name).sort(), ['jam_c.wav', 'jam_d.wav', 'jam_e.wav']);
  assert.equal(onA.madeFrom, null);
  assert.equal(familyLines([a, c], 'jam_c.wav').from.length, 0, 'a cut with no cuts of its own has no From this take');
});

test('Open draws a Made from heading for a cut', async () => {
  const a = jam('a', { name: 'jam_a.wav' });
  const c = jam('c', { name: 'jam_c.wav', source: { name: 'jam_a.wav' } });
  const p = await open({ jams: [a, c], file: 'jam_c.wav' });
  assert.deepEqual(p.all('.room-open-fam').map((x) => x.getAttribute('aria-label')), ['Made from']);
  assert.equal(p.all('.room-open-fam-line')[0].getAttribute('href'), '/wave.html?file=jam_a.wav');
});

test('the take page reaches Open only through start(), consumes the bar’s arrival, and sends ?tape= to the Studio', () => {
  const page = read('../wave/page.js');
  assert.match(page, /startRoom\('open', \{[^}]*arrivalNote:/s);
  assert.match(page, /roomOn\(\) \? pageCarry\(\)\.arrival\(file, total\) : null/, 'only with the rooms on');
  assert.match(page, /startOpen\(arrival, \{[\s\S]*?pos: \(\) => state\.cursor/, 'a refused sound leaves the take at the frame the bar left (behaviour: carry.test.js)');
  assert.match(page, /get\('tape'\) && roomOn\(\)\) \{\s*location\.replace\('\/tape\.html'\)/, '?tape= goes to the Studio, with the rooms on');
  assert.doesNotMatch(page, /chair/i, 'the chair is gone');
});

test('the chair, TOOLS and the swap question are gone from the app', () => {
  const sw = read('../../sw.js');
  assert.doesNotMatch(sw, /room\/chair\.js|room\/swap\.js/);
  assert.match(sw, /'\/lib\/room\/open\.js'/);
  const css = read('../../styles.css');
  assert.doesNotMatch(css, /\.chair\b|chair-on|chair-tools|chair-of-tape|\.book-(page|left|right|notes|rings|title)|room-ask-text/, 'no rule for what is gone');
  const tips = read('../help/tips.js');
  assert.doesNotMatch(tips, /room-tools|room-stand|room-put|room-note-here|room-sticker/);
});
