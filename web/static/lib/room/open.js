// web/static/lib/room/open.js
// Open: a take's page (docs/architecture/take-page.md, "Open"). It is the
// take page -- the waveform, the selection, the tempo, the MIDI -- with the
// rooms' words laid over it: the notes drawer docked beside the waveform (a
// sheet from ✎ on a phone, with the list under the keys), GRAB beside KEEP,
// the take's tag, and what was made from it (From this take) or came before
// it (Earlier bounces). The page (lib/wave/page.js) hands this module a
// handle on its take, its flags and its clock, and the page's takes
// (h.takes, lib/models/takes.js); nothing the page does is copied.
//
// Every class made here is room-open-*, which only this module makes, so the
// stylesheet's rules for it reach nothing else (AGENTS.md: scope a new rule
// to the thing you are adding).

import { notesOf, sendToStudio, forgetNote, fmtAt } from './notes.js';
import { keepLabel, selectionKeepLength } from '../rooms/keeplabel.js';
import { takeGrabSpan, takeGrabLabel, takeStartN, loadedLoopBars, readPick } from '../rooms/grab.js';
import { tagStore } from '../tags.js';
import { openTagManager } from '../tags-dialog.js';
import { fold, familyOf } from '../shelf.js';
import { takeTitle } from '../rooms/takename.js';
import { takeHref } from '../bar/take-source.js';
import { layersOf } from '../ui/layers.js';
import { createNotesDrawer, createNotesList } from './drawer.js';

function el(tag, cls, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}
const $ = (id) => document.getElementById(id);

/**
 * familyLines is what Open lists under the take. {from, madeFrom, earlier}:
 * `from` ("From this take") is what was cut from this take: for the spine,
 * everything folded under it that is a cut; for a cut, only the cuts made
 * from it. `madeFrom` is the take this one was cut from, or null. `earlier`
 * ("Earlier bounces") is for the spine and for a bounce: the other bounces of
 * the tape, the spine (the newest) included when this is an older one.
 * Each line: {name, title, length, href}. Pure: `list` is the takes (h.takes).
 */
export function familyLines(list, name) {
  const all = Array.isArray(list) ? list : [];
  const fam = familyOf(fold(all), name);
  const line = (t) => ({ name: t.name, title: takeTitle(t), length: t.duration_seconds || 0, href: takeHref(t.name) });
  const self = all.find((t) => t.name === name);
  const isSpine = !!fam.spine && fam.spine.name === name;
  const from = fam.cuts.filter((t) => t.name !== name && (isSpine || (t.source && t.source.name === name))).map(line);
  const src = self && self.source ? all.find((t) => t.name === self.source.name) : null;
  const bounced = isSpine || (self && self.origin === 'tape');
  const earlier = bounced
    ? [...(!isSpine && fam.spine ? [fam.spine] : []), ...fam.mixes.filter((t) => t.name !== name)].map(line)
    : [];
  return { from, madeFrom: src ? line(src) : null, earlier };
}

/** WIDE is where the drawer docks beside the waveform: the page's own grid. */
export const WIDE = '(min-width: 860px)';

export function mount(h) {
  forgetNote(); // a take's GRAB left a note for the Studio: this page is not it
  document.body.classList.add('room-open-on');
  const take = h.take;
  const sr = h.sampleRate;
  const notes = () => notesOf(h.state().flags, sr);

  // --- the notes drawer (lib/room/drawer.js), as in the rooms ---------------------
  // Docked beside the waveform from 860 px, always there, without its own
  // name, ★ and tag (the header has them); on a phone ✎ brings it up as a
  // sheet, and the list sits under the keys.
  const drawer = createNotesDrawer({
    doc: document, layers: layersOf(document), toast: h.toast, head: false,
    dock: { into: $('notes-dock'), when: matchMedia(WIDE) },
  });
  const source = {
    name: h.file,
    sampleRate: sr,
    total: h.total,
    take: () => take,
    notes,
    bpm: () => h.state().grid.bpm || 0,
    frame: () => h.state().cursor,
    // The page's own: optimistic, each sent in order (lib/flags.js), and
    // its Undo for a note taken out.
    async add(frame, words) { h.addNote(frame, words); },
    async edit(id, words) { h.editNote(id, words); },
    async remove(id) { h.removeNote(id); },
    async seek(frame, { play = false } = {}) { h.seek(frame); if (play && !h.playing()) await h.togglePlay(); },
    async grab(span) { location.href = await sendToStudio(h.file, span); },
    onChange: (fn) => h.onRedraw(fn),
  };
  if (drawer.docked) drawer.open(source, { focus: false });
  matchMedia(WIDE).addEventListener?.('change', () => { if (drawer.docked) drawer.open(source, { focus: false }); });

  // ✎: the drawer, its words ready to go at the frame. In the bar's own
  // keys, and F from the keyboard.
  function writeAt(frameAt, opts) {
    drawer.open(source, { at: frameAt, ...opts });
  }
  $('note-now')?.addEventListener('click', () => writeAt(h.state().cursor));
  h.onNoteKey?.(() => writeAt(h.state().cursor));
  // A pin on the waveform is its note: the cursor goes to its words.
  h.onPin?.((f) => writeAt(f.frame, { note: f.id }));

  // A phone's list, under the keys: the drawer's rows.
  const here = $('notes-here');
  const list = createNotesList({ doc: document, toast: h.toast });
  here?.append(el('h2', 'room-open-h', { text: 'Notes' }), list.list, list.none);
  list.none.textContent = 'No notes yet. The pencil in the bar writes one where the take is.';

  // --- the tag: the take's one tag, beside its star ------------------------------
  // #take-tag: the page's header and its take menu's Tag… know it by its id.
  const tagKey = el('button', 'icon-btn room-open-tag', { id: 'take-tag', type: 'button', 'aria-haspopup': 'dialog', 'data-tip': 'room-open-tag' });
  $('take-star')?.after(tagKey);
  function renderTag() {
    const g = tagStore.list.find((x) => x.id === take.tag);
    tagKey.className = `icon-btn room-open-tag${g ? ` stripe-${g.color} on` : ''}`;
    tagKey.textContent = g ? g.name : '+ tag';
    tagKey.setAttribute('aria-label', g ? `Tag: ${g.name}. Change it` : 'Add a tag');
  }
  const pickDlg = el('dialog', 'sheet room-open-pick', { 'aria-labelledby': 'room-open-pick-h' });
  document.body.append(pickDlg);
  tagKey.addEventListener('click', () => {
    const btn = (label, cls, run) => { const b = el('button', cls, { type: 'button' }, label); b.addEventListener('click', () => { pickDlg.close(); run(); }); return b; };
    const own = take.tag || '';
    pickDlg.replaceChildren(el('div', 'sheet-inner', {},
      el('h3', '', { id: 'room-open-pick-h', text: 'One tag' }),
      el('div', 'room-open-pick-list', {},
        ...tagStore.list.map((g) => {
          const b = btn(g.name, `icon-btn room-open-tag stripe-${g.color} on`, () => setTag(g.id === own ? '' : g.id));
          b.setAttribute('aria-pressed', String(g.id === own));
          return b;
        }),
        own ? btn('No tag', 'icon-btn', () => setTag('')) : null),
      el('div', 'sheet-actions', {},
        btn(tagStore.list.length ? 'Edit tags' : 'Make a tag', 'icon-btn', () => openTagManager({ onToast: h.toast, onCreated: (g) => setTag(g.id) })),
        btn('Done', 'icon-btn', () => {}))));
    pickDlg.showModal();
  });
  async function setTag(id) {
    try {
      const b = await h.patch({ tag: id });
      take.tag = b.tag ?? id;
      renderTag();
    } catch (e) { h.toast(`Couldn’t tag it: ${e.message}`, 'bad'); }
  }
  tagStore.subscribe(renderTag);
  tagStore.load();

  // --- GRAB beside KEEP: the selection, else the N bars before the playhead ---------
  // N starts at the tape's loop in bars, as the feed's GRAB does. The take's
  // own tempo says how long a bar is; with none, N is twice as many seconds.
  let grabN = takeStartN({ stored: readPick() });
  const grabKey = $('take-grab');
  const keepKey = $('save-take');
  const grabSpan = () => {
    const st = h.state();
    return takeGrabSpan({ region: st.region, playhead: st.cursor, total: h.total, sampleRate: sr, bpm: st.grid.bpm, n: grabN });
  };
  async function grabNow() {
    const span = grabSpan();
    if (!span) return;
    try { location.href = await sendToStudio(h.file, span); } catch (e) { h.toast(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad'); }
  }
  grabKey?.addEventListener('click', grabNow);
  let grabSig = '';
  function renderGrab() {
    const st = h.state();
    // KEEP, the take's other verb (the page's Save as take): it says how much it keeps.
    if (keepKey) {
      const k = keepLabel(st.region ? selectionKeepLength((st.region.end - st.region.start) / sr) : '');
      if (keepKey.textContent !== k) keepKey.textContent = k;
    }
    const words = takeGrabLabel({ n: grabN, bpm: st.grid.bpm, selection: !!st.region });
    if (words === grabSig || !grabKey) return;
    grabSig = words;
    grabKey.textContent = words;
    const what = st.region ? 'the selection' : st.grid.bpm > 0 ? `the ${grabN} bar${grabN === 1 ? '' : 's'} before the playhead` : `the ${2 * grabN} seconds before the playhead`;
    grabKey.setAttribute('aria-label', `${words}: ${what}, onto the Studio’s cue lane`);
  }
  loadedLoopBars().then((bars) => { grabN = takeStartN({ loopBars: bars, stored: readPick() }); renderGrab(); });

  // --- From this take, Earlier bounces ---------------------------------------------
  const family = el('div', 'room-open-family');
  const section = el('section', 'room-open', { 'aria-label': 'What was made from this take' }, family);
  (here || document.querySelector('.wave-col'))?.after(section);
  async function drawFamily() {
    let jams = [];
    try { jams = await h.takes.get(); } catch { /* the lines just don't show */ }
    const { from, madeFrom, earlier } = familyLines(jams, h.file);
    const group = (title, lines, tip) => lines.length && el('section', 'room-open-fam', { 'aria-label': title, 'data-tip': tip },
      el('h2', 'room-open-h', { text: title }),
      el('ol', 'room-open-fam-list', {}, ...lines.map((l) => el('li', '', {},
        el('a', 'room-open-fam-line', { href: l.href, 'aria-label': `Open ${l.title}` }, el('span', 'room-open-fam-name', { text: l.title }), el('span', 'room-open-at', { text: fmtAt(l.length * sr, sr) }))))));
    family.replaceChildren(...[group('Made from', madeFrom ? [madeFrom] : [], 'room-open-made'), group('From this take', from, 'room-open-from'), group('Earlier bounces', earlier, 'room-open-earlier')].filter(Boolean));
  }
  drawFamily();

  // --- each redraw -----------------------------------------------------------------
  function onRedraw() {
    if (!drawer.docked) list.draw(source);
    renderGrab();
  }
  h.onRedraw(onRedraw);
  renderTag();
  list.draw(source);
  onRedraw();
  // ✎ on the bar arrives with the drawer open at the frame that was heard.
  if (h.arrivalNote != null) writeAt(h.arrivalNote);
  return { section, drawer, list };
}
