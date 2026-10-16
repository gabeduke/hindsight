// web/static/lib/room/open.js
// Open: a take's page with the rooms on (docs/superpowers/specs/2026-10-15-
// flow-design.md, "Open: one page to dig in"). It is the take page as it
// stands -- the waveform, the selection, the tempo, the MIDI -- with the
// rooms' words laid over it: ✎ Note, GRAB beside KEEP, the take's notes one
// line each, its tag, and what was made from it (From this take) or came
// before it (Earlier bounces). The page (lib/wave/page.js) hands this module
// a handle on its take, its flags and its clock; nothing the page does is
// copied, and with the rooms off this is not even fetched.
//
// Every class made here is room-open-*, which only this module makes, so the
// stylesheet's rules for it reach nothing else (AGENTS.md: scope a new rule
// to the thing you are adding).

import { notesOf, noteSpan, sendToStudio, forgetNote, fmtAt } from './notes.js';
import { keepLabel, selectionKeepLength } from '../rooms/keeplabel.js';
import { takeGrabSpan, takeGrabLabel, takeStartN, loadedLoopBars, readPick } from '../rooms/grab.js';
import { tagStore } from '../tags.js';
import { openTagManager } from '../tags-dialog.js';
import { fold, familyOf, spineTitle } from '../shelf.js';
import { takeHref } from '../bar/take-source.js';

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
 * familyLines is what Open lists under the take: the takes made from it
 * (`cuts`, "From this take") and the earlier bounces of its tape (`mixes`),
 * for the spine this take is on. A take that is itself a cut or an earlier
 * bounce lists its spine's family without itself. Each line: {name, title,
 * length, href}. Pure: `list` is /api/jams.
 */
export function familyLines(list, name) {
  const fam = familyOf(fold(Array.isArray(list) ? list : []), name);
  const line = (t) => ({ name: t.name, title: spineTitle(t), length: t.duration_seconds || 0, href: takeHref(t.name) });
  const rest = (l) => l.filter((t) => t.name !== name).map(line);
  return { from: rest(fam.cuts), earlier: rest(fam.mixes) };
}

export function mount(h) {
  forgetNote(); // a take's GRAB left a note for the Studio: this page is not it
  document.body.classList.add('room-open-on');
  const take = h.take;
  const sr = h.sampleRate;
  const notes = () => notesOf(h.state().flags, sr);
  const spanOpts = () => ({ sampleRate: sr, bpm: h.state().grid.bpm, total: h.total });

  // --- the page: the notes, and what was made from the take --------------------
  // ✎ Note, here as well as in the bar: on a phone the bar's own keys are
  // folded away until the player is opened, and this is where the notes are.
  const noteHead = el('button', 'icon-btn room-open-note-btn', { type: 'button', 'data-tip': 'room-open-note' }, '✎ Note');
  const head = el('div', 'room-open-head', {}, el('h2', 'room-open-h', { text: 'Notes' }), noteHead);
  const list = el('ol', 'room-open-notes', { 'aria-label': 'Notes' });
  const none = el('p', 'room-open-none', { text: 'No notes yet. ✎ Note puts one at the playhead.' });
  const family = el('div', 'room-open-family');
  const section = el('section', 'room-open', { 'aria-label': 'Notes and what was made from this take' }, head, list, none, family);
  const col = document.querySelector('.wave-col');
  const toolbar = col && col.querySelector('.toolbar');
  if (toolbar) toolbar.after(section); else col?.append(section);

  // --- ✎ Note: in the bar's own keys, where the flag was ---------------------
  const flagNow = $('flag-now');
  const noteKey = el('button', 'icon-btn tb-flag room-open-note', { id: 'room-open-note', type: 'button', 'aria-label': 'Note at the playhead', 'data-tip': 'room-open-note' }, '✎');
  if (flagNow) { flagNow.hidden = true; flagNow.before(noteKey); }
  for (const k of [noteKey, noteHead]) k.addEventListener('click', () => writeAt(h.state().cursor));

  // --- the notes: number, time, words, ▶, GRAB, ✕ -----------------------------
  let notesSig = '';
  function renderNotes() {
    const ns = notes();
    const sig = JSON.stringify(ns.map((n) => [n.id, n.frame, n.label]));
    if (sig === notesSig) return;
    notesSig = sig;
    const focused = document.activeElement?.closest?.('.room-open-notes li')?.dataset.id;
    const focusCls = (document.activeElement?.className || 'room-open-words').split(' ')[0];
    list.replaceChildren(...ns.map((n) => {
      const num = el('span', 'room-open-n', { 'aria-hidden': 'true', text: String(n.n) });
      const at = el('span', 'room-open-at', { 'aria-hidden': 'true', text: n.at });
      const words = el('input', 'room-open-words', { type: 'text', maxlength: '120', value: n.label, placeholder: 'what you heard…', 'aria-label': `Note ${n.n}, at ${n.at}: its words` });
      words.value = n.label;
      words.addEventListener('change', () => h.editNote(n.id, words.value.trim()));
      words.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); words.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); words.value = n.label; words.blur(); }
      });
      const play = el('button', 'icon-btn room-open-play', { type: 'button', 'aria-label': `Play from note ${n.n}, at ${n.at}` }, '▶');
      play.addEventListener('click', async () => { h.seek(n.frame); if (!h.playing()) await h.togglePlay(); });
      const span = noteSpan(ns, n.id, spanOpts());
      const go = el('button', 'icon-btn room-open-grab-note', { type: 'button', 'aria-label': `GRAB from note ${n.n} into the Studio’s buffer`, 'data-tip': 'room-open-grab-note', disabled: !span }, 'GRAB');
      go.addEventListener('click', () => noteToStudio(n.id));
      const out = el('button', 'icon-btn room-open-out', { type: 'button', 'aria-label': `Take note ${n.n} out` }, '✕');
      out.addEventListener('click', () => h.removeNote(n.id));
      return el('li', 'room-open-note-row', { 'data-id': n.id }, num, at, words, play, go, out);
    }));
    none.hidden = ns.length > 0;
    if (focused) list.querySelector(`li[data-id="${CSS.escape(focused)}"] .${focusCls}`)?.focus();
  }

  async function noteToStudio(id) {
    const span = noteSpan(notes(), id, spanOpts());
    if (!span) return;
    try { location.href = await sendToStudio(h.file, span); } catch (e) { h.toast(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad'); }
  }

  // ✎ Note: a note at the frame (or the one already there), its words ready.
  function writeAt(frameAt) {
    const id = h.addNote(frameAt);
    if (!id) return;
    renderNotes();
    const row = list.querySelector(`li[data-id="${CSS.escape(id)}"] .room-open-words`);
    row?.focus();
    row?.scrollIntoView?.({ block: 'nearest' });
  }

  // --- the tag: the take's one tag, beside its star ------------------------------
  const tagKey = el('button', 'icon-btn room-open-tag', { type: 'button', 'aria-haspopup': 'dialog', 'data-tip': 'room-open-tag' });
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
  const grabKey = el('button', 'icon-btn room-open-grab', { type: 'button', 'data-tip': 'room-open-grab' });
  const keepKey = $('save-take');
  if (keepKey) keepKey.after(grabKey); else $('send-btn')?.before(grabKey);
  const grabSpan = () => {
    const st = h.state();
    return takeGrabSpan({ region: st.region, playhead: st.cursor, total: h.total, sampleRate: sr, bpm: st.grid.bpm, n: grabN });
  };
  async function grabNow() {
    const span = grabSpan();
    if (!span) return;
    try { location.href = await sendToStudio(h.file, span); } catch (e) { h.toast(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad'); }
  }
  grabKey.addEventListener('click', grabNow);
  let grabSig = '';
  function renderGrab() {
    const st = h.state();
    // KEEP, the take's other verb (the page's Save as take): it says how much it keeps.
    if (keepKey) {
      const k = keepLabel(st.region ? selectionKeepLength((st.region.end - st.region.start) / sr) : '');
      if (keepKey.textContent !== k) keepKey.textContent = k;
    }
    const words = takeGrabLabel({ n: grabN, bpm: st.grid.bpm, selection: !!st.region });
    if (words === grabSig) return;
    grabSig = words;
    grabKey.textContent = words;
    const what = st.region ? 'the selection' : st.grid.bpm > 0 ? `the ${grabN} bar${grabN === 1 ? '' : 's'} before the playhead` : `the ${2 * grabN} seconds before the playhead`;
    grabKey.setAttribute('aria-label', `${words}: ${what}, into the Studio’s buffer`);
    if (sendGrab) {
      sendGrab.firstChild.textContent = words;
      sendGrabSub.textContent = st.region ? 'The selection, into the Studio’s buffer' : 'Before the playhead, into the Studio’s buffer';
    }
  }
  loadedLoopBars().then((bars) => { grabN = takeStartN({ loopBars: bars, stored: readPick() }); renderGrab(); });

  // Send to ▾: Tape and Clipboard are GRAB now -- one request, the Studio's
  // buffer, which DROP empties where the clipboard Pasted. Crate is gone with
  // the crate (lib/rooms/nocrate.js).
  const sendMenu = $('send-menu');
  let sendGrab = null, sendGrabSub = null;
  if (sendMenu) {
    for (const id of ['send-to-tape', 'copy-take']) { const b = $(id); if (b) b.hidden = true; }
    sendGrabSub = el('span', 'menu-sub');
    sendGrab = el('button', '', { id: 'send-grab', type: 'button', role: 'menuitem', 'data-tip': 'send-grab' }, el('b'), sendGrabSub);
    sendGrab.addEventListener('click', grabNow); // the menu closes itself on a choice
    sendMenu.prepend(sendGrab);
  }

  // --- From this take, Earlier bounces ---------------------------------------------
  async function drawFamily() {
    let jams = [];
    try { const res = await fetch('/api/jams', { cache: 'no-store' }); if (res.ok) jams = await res.json(); } catch { /* the lines just don't show */ }
    const { from, earlier } = familyLines(jams, h.file);
    const group = (title, lines, tip) => lines.length && el('section', 'room-open-fam', { 'aria-label': title, 'data-tip': tip },
      el('h2', 'room-open-h', { text: title }),
      el('ol', 'room-open-fam-list', {}, ...lines.map((l) => el('li', '', {},
        el('a', 'room-open-fam-line', { href: l.href, 'aria-label': `Open ${l.title}` }, el('span', 'room-open-fam-name', { text: l.title }), el('span', 'room-open-at', { text: fmtAt(l.length * sr, sr) }))))));
    family.replaceChildren(...[group('From this take', from, 'room-open-from'), group('Earlier bounces', earlier, 'room-open-earlier')].filter(Boolean));
  }
  drawFamily();

  // --- each redraw -----------------------------------------------------------------
  function onRedraw() {
    renderNotes();
    renderGrab();
  }
  h.onRedraw(onRedraw);
  renderTag();
  onRedraw();
  // ✎ on the bar arrives with a note started at the frame that was heard.
  if (h.arrivalNote != null) writeAt(h.arrivalNote);
  return { section };
}
