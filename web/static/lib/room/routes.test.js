// web/static/lib/room/routes.test.js
// The spine's sheet goes (docs/architecture.md, Vocabulary,
// "What happens to today's surfaces"), and nothing may be left that is only
// reachable through it. This lists every control the sheet has -- read from a
// real TakeDetail, which the takes page still builds -- and says where each
// lives now. A control added to the sheet
// without a line here fails: say where it goes. Each line's `check` is run
// against the real thing it names, not against a description of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { room, take, click } from './harness.js';
import { tagKey } from './tagpick.js';
import { tagStore } from '../tags.js';
import './abs-hook.js';

const page = (file) => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')).children);
  return doc;
};
const tapesPage = page('shell.html');
const takePage = page('wave.html');

// The sheet itself, as the takes page builds it, with a take that has a family,
// a flag and MIDI so every control it can show is shown.
async function sheetControls() {
  const doc = fakeDoc();
  globalThis.document = doc;
  const { TakeDetail } = await import('../shelf-detail.js');
  tagStore.set([{ id: 'g1', name: 'Funk', color: 2 }]); // a tag to give, so its chip is there
  const root = doc.createElement('aside');
  doc.body.append(root);
  const t = take('a', { has_midi: true, midi_name: 'a.mid', flags: [{ id: 'f1', frame: 48000, label: 'verse' }], tag: 'g1', source: { name: 'jam_src.wav', start_frame: 0, end_frame: 100 } });
  const src = take('src');
  const cut = take('cut', { source: { name: 'jam_a.wav', start_frame: 0, end_frame: 50 } });
  const mix = take('mix', { origin: 'tape', tape_id: 't1' });
  const detail = new TakeDetail(root, { takes: { all: [t, src, cut, mix], player: async () => null }, onToast: () => {}, onBack: () => {}, onPick: () => {}, isShown: () => false });
  await detail.show(t, { spine: t, cuts: [cut], mixes: [mix] });
  const classes = new Set();
  for (const b of root.querySelectorAll('button, a')) {
    const c = String(b.className).split(/\s+/).find((x) => /^(sheet-back|detail-[a-z]+|star|tag-chip|tag-edit-btn)$/.test(x));
    classes.add(c || `?${b.tagName}.${b.className}`);
  }
  return [...classes].sort();
}

// --- where each lives ----------------------------------------------------------------

const idsOf = (doc, ids) => ids.every((id) => !!doc.getElementById(id));
const ROUTES = {
  'sheet-back': { where: 'nowhere: there is no sheet to go back from', gone: true },
  'detail-play': {
    where: 'a tap on the spine or the List’s row, and the bar’s ▶',
    check: async () => {
      const r = await room();
      click(r.spine('jam_a.wav'));
      await r.settle();
      return r.log.includes('play jam_a.wav') && r.np.takeName === 'jam_a.wav';
    },
  },
  'detail-open': {
    where: 'the deck (a tap on it), the dock’s Open',
    check: async () => {
      const r = await room({ barTake: 'jam_a.wav' });
      click(r.q('.room-deck-place'));
      return r.w.navigated.at(-1) === '/wave.html?file=jam_a.wav' && r.q('.room-sit').getAttribute('href') === '/wave.html?file=jam_a.wav';
    },
  },
  star: { where: 'Open’s ★, and a selection’s ★', check: () => idsOf(takePage, ['take-star']) && idsOf(tapesPage, ['sel-star']) },
  'detail-rename': { where: 'Open’s title (tap to rename)', check: () => idsOf(takePage, ['take-name', 'take-name-input']) },
  'detail-bpm': { where: 'Open’s tempo', check: () => idsOf(takePage, ['take-bpm', 'take-bpm-input']) },
  'detail-wav': { where: 'Open’s Download ▾', check: () => idsOf(takePage, ['dl-wav']) },
  'detail-midi': { where: 'Open’s Download ▾', check: () => idsOf(takePage, ['dl-midi']) },
  'detail-delete': { where: 'Open’s ⋯ (Delete take), and a selection’s Delete', check: () => idsOf(takePage, ['delete-take']) && idsOf(tapesPage, ['sel-delete']) },
  'tag-chip': { where: 'a selection’s Tag', check: () => selectionHasTag() },
  'tag-edit-btn': { where: 'a selection’s Tag › Edit tags, and the shelf’s own Edit tags', check: () => selectionHasTag() },
  'detail-flag': {
    // The chair's notes are built by the chair as the page opens (F6 rebuilds
    // them as Open's): its own tests and the browser look cover it.
    where: 'Open’s notes (▶ from a note), and the take page’s flags',
    check: () => idsOf(takePage, ['flag-label']),
  },
  'detail-up': { where: 'the List: a spine’s folded takes are rows under it', check: () => foldedRowsShow() },
  'detail-member': { where: 'the List: a spine’s cuts and earlier bounces are rows, each plays on a tap', check: () => foldedRowsShow() },
  'detail-source': { where: 'the List: the take a cut was made from is a row', check: () => foldedRowsShow() },
};

// The select bar with the room's Tag key on it.
function selectionHasTag() {
  const doc = fakeDoc();
  const bar = doc.createElement('div');
  bar.innerHTML = '<button id="sel-star"></button><button id="sel-export"></button>';
  doc.body.append(bar);
  const k = tagKey({ doc, bar, takes: { all: [], selected: new Set() }, tags: { list: [] }, manage: () => {} });
  return !!bar.querySelector('#sel-tag') && k.key.dataset.tip === 'bulk-tag';
}

async function foldedRowsShow() {
  const { TakesList } = await import('../takes.js');
  const doc = fakeDoc();
  globalThis.document = doc;
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} };
  const root = doc.createElement('div');
  const members = new Map([['jam_a.wav', [take('cut', { has_peaks: false })]]]);
  const l = new TakesList(root, doc.createElement('p'), { spines: true, showFolded: true, shape: () => [{ label: '', takes: [take('a', { has_peaks: false })], members }] });
  l.all = [take('a', { has_peaks: false }), take('cut', { has_peaks: false })];
  l.reshape();
  return l.rows.get('jam_cut.wav').el.hidden === false;
}

test('every control the sheet has is listed here, and nothing here is a control the sheet no longer has', async () => {
  const controls = await sheetControls();
  assert.deepEqual(controls.filter((c) => c.startsWith('?')), [], 'a control this test cannot name');
  const missing = controls.filter((c) => !(c in ROUTES));
  assert.deepEqual(missing, [], 'these controls of the sheet are not said to live anywhere');
  const stale = Object.keys(ROUTES).filter((c) => !controls.includes(c));
  assert.deepEqual(stale, [], 'these lines are for controls the sheet does not have');
});

test('each control that moved is where it says it is', async () => {
  for (const [name, r] of Object.entries(ROUTES)) {
    if (r.gone) continue;
    assert.equal(await r.check(), true, `${name} → ${r.where}`);
  }
});

test('the shelf offers none of the sheet’s old keys (a take’s GRAB is Open’s, built by the chair: seen in the browser run)', async () => {
  const r = await room();
  const words = [...r.doc.documentElement.descendants()].filter((e) => e.tagName === 'BUTTON' || e.tagName === 'A').map((e) => e.textContent);
  for (const gone of [/PUT IT ON/, /TO THE STUDIO/, /Play all from here/, /GRAB/, /Cut a record/]) {
    assert.ok(!words.some((w) => gone.test(w)), `${gone} is on the shelf`);
  }
});

test('Play all is in the List’s header, where the sheet’s Play all from here went', () => {
  assert.ok(tapesPage.getElementById('play-all'));
  assert.match(tapesPage.getElementById('play-all').textContent, /Play all/);
});
