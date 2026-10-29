// web/static/lib/room/drawer.js
// The notes drawer (docs/architecture/rooms.md, "The notes drawer";
// listening-back.md, "One notes drawer"): the one place a take's notes are
// written, the same in the Studio, the Listening Room and on Open. ✎ is the
// only pencil and means a note here, now: it opens the drawer at the frame
// being heard, the take plays on, and the URL stays.
//
// From the top: the take's name (edited in place), ★ and its tag; then
// "✎ at 0:09" with the words, which Enter adds; then the notes, each its
// number, its time (a tap goes there), its words (edited in place), ▶,
// GRAB and ✕.
//
// It is a sheet from the foot (lib/ui/sheet.js), on the page's stack, so a
// swipe down, Back, Escape and Done put it away. It draws a take it is
// handed as a *source*, which says what the take is and does what is asked
// of it; the shell makes one of the take in the bar (notes.js barNotes) and
// Open one of its page (lib/room/open.js). The drawer keeps nothing of the
// take's itself.
//
// Every class made here is notes-*, and css/notes.css styles it.

import { createSheet } from '../ui/sheet.js';
import { menu, menuItem, menuRows } from '../ui/menu.js';
import { icon } from '../ui/icons.js';
import { fmtAt, fieldEnter, noteSpan } from './notes.js';
import { tagStore } from '../tags.js';
import { openTagManager } from '../tags-dialog.js';
import { takeTitle } from '../rooms/takename.js';

/**
 * A source is a take as the drawer asks after it:
 *   take()              the take now: { name, label, starred, tag, ... }
 *   notes()             its notes (notes.js notesOf), in time order
 *   sampleRate, total   frames per second, and the take's length in frames
 *   bpm()               its tempo, or 0: how far a note's GRAB reaches
 *   frame()             the frame being heard now, or null when it isn't
 *   add(frame, words), edit(id, words), remove(id)
 *                       a note, by the take's flags; each a promise
 *   patch(fields)       { label } { starred } { tag }: a promise
 *   seek(frame, {play}) the take to a frame, and playing, if asked: a promise
 *   grab(span)          { from, to } onto the Studio's cue lane: a promise
 *   onChange(fn)        fn() whenever the take changes; answers a way off
 */

/** atLine is what the drawer says over the words: where they will go. */
export function atLine(frame, sampleRate) {
  return `at ${fmtAt(frame, sampleRate)}`;
}

/**
 * createNotesDrawer makes the drawer, put away, at the end of `doc.body`.
 * `head` false leaves out the take's name, ★ and tag, for a page whose
 * header has them (Open). Answers { el, open(source, {at}), close(),
 * refresh(), isOpen, source, destroy() }. `open` on a drawer already open
 * moves its ✎ to `at`.
 */
export function createNotesDrawer({ doc = globalThis.document, layers, toast = () => {}, head: withHead = true, clock, reduced } = {}) {
  const mk = (tag, cls, attrs = {}, ...kids) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    e.append(...kids.filter((k) => k != null && k !== false));
    return e;
  };
  const keyWith = (name, cls, attrs) => {
    const b = mk('button', `icon-btn ${cls}`, { type: 'button', ...attrs });
    b.innerHTML = icon(name);
    return b;
  };

  // --- the markup --------------------------------------------------------------
  const grabber = mk('div', 'notes-grabber', { 'aria-hidden': 'true' });
  const name = mk('input', 'notes-name', { id: 'notes-name', type: 'text', maxlength: '80', placeholder: 'Name this take…', 'aria-label': 'The take’s name', autocomplete: 'off' });
  const star = keyWith('star', 'notes-star', { id: 'notes-star', 'aria-label': 'Star this take', 'aria-pressed': 'false', 'data-tip': 'notes-star' });
  const tag = mk('button', 'icon-btn notes-tag', { id: 'notes-tag', type: 'button', 'data-tip': 'notes-tag' });
  const tagPanel = mk('div', 'menu notes-tag-menu', { id: 'notes-tag-menu', 'aria-label': 'Tag' });
  const done = keyWith('check', 'notes-done', { id: 'notes-done', 'aria-label': 'Put the notes away' });
  const head = mk('div', 'notes-head', {}, withHead && name, withHead && star, withHead && mk('span', 'menu-anchor notes-tag-anchor', {}, tag, tagPanel), done);
  const at = mk('label', 'notes-at mono', { id: 'notes-at', for: 'notes-words' });
  const words = mk('input', 'notes-words', { id: 'notes-words', type: 'text', maxlength: '120', placeholder: 'What you heard…', autocomplete: 'off', enterkeyhint: 'done' });
  const write = mk('form', 'notes-write', { id: 'notes-write', 'data-tip': 'notes-write' }, at, words);
  const list = mk('ol', 'notes-list', { id: 'notes-list', 'aria-label': 'Notes' });
  const none = mk('p', 'notes-none', { id: 'notes-none', text: 'No notes yet. Write what you hear, and Enter puts it here.' });
  const el = mk('section', 'notes-drawer', { id: 'notes-drawer', role: 'dialog', 'aria-label': 'Notes' },
    grabber, mk('div', 'notes-body', {}, head, write, list, none));
  el.hidden = true;
  tagPanel.hidden = true;
  doc.body.append(el);

  let src = null;
  let off = null;
  let aim = 0; // the frame ✎ was pressed at: where the words go

  const sheet = createSheet(el, {
    layers, kind: 'drawer',
    // All the way up, or half way: the list away, the words and the take
    // still in view. It stands on the bar, so it goes out past the foot
    // of the screen, not just its own height.
    detents: () => [0, Math.round((el.offsetHeight || 0) * 0.45)],
    closed: () => Math.max(el.offsetHeight || 0, (globalThis.innerHeight || 0) - (el.offsetTop || 0)),
    handles: [grabber, head],
    onShow: () => { el.hidden = false; },
    onHide: () => {
      // Back, Escape and a swipe don't blur: a field being written in
      // saves now (its change), while the drawer still has its take.
      if (el.contains(doc.activeElement)) doc.activeElement.blur?.();
      el.hidden = true;
      off?.();
      off = null;
      src = null;
    },
    ...(clock ? { clock } : {}),
    ...(reduced ? { reduced } : {}),
  });

  // --- the take: its name, ★ and tag ---------------------------------------------
  const fail = (what) => (e) => toast(`Couldn’t ${what}: ${e.message}`, 'bad');
  name.addEventListener('change', () => {
    const label = name.value.trim();
    if (!src || label === (src.take().label || '')) return;
    src.patch({ label }).catch(fail('rename it'));
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
  });
  star.addEventListener('click', () => {
    if (src) src.patch({ starred: !src.take().starred }).catch(fail('star it'));
  });
  const setTag = (id) => src?.patch({ tag: id }).catch(fail('tag it'));
  if (withHead) menu(tag, tagPanel, {
    layers, doc, align: 'end', side: 'below', focus: 'checked',
    render(panel) {
      const own = src?.take().tag || '';
      const rows = tagStore.list.map((g) => {
        const r = menuItem(doc, { word: g.name, role: 'menuitemradio', checked: g.id === own, className: `notes-tag-row stripe-${g.color}` });
        r.addEventListener('click', () => setTag(g.id === own ? '' : g.id));
        return r;
      });
      const plain = [];
      if (own) {
        const r = menuItem(doc, { word: 'No tag' });
        r.addEventListener('click', () => setTag(''));
        plain.push(r);
      }
      const edit = menuItem(doc, { word: tagStore.list.length ? 'Edit tags…' : 'Make a tag…' });
      edit.addEventListener('click', () => openTagManager({ onToast: toast, onCreated: (g) => setTag(g.id) }));
      plain.push(edit);
      panel.replaceChildren(...menuRows(doc, [rows, plain].filter((g) => g.length)));
    },
  });
  done.addEventListener('click', () => sheet.close('program'));

  // --- ✎ at 0:09, and the words: Enter adds ------------------------------------------
  write.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!src) return;
    const s = src;
    const todo = fieldEnter({ words: words.value, cursor: aim, notes: s.notes(), total: s.total });
    if (todo.kind !== 'new') return;
    words.value = '';
    try {
      await s.add(todo.frame, todo.words);
    } catch (err) {
      if (src === s && !words.value) words.value = todo.words;
      fail('add the note')(err);
      return;
    }
    // The take played on: the next note goes where it is now (or, if the
    // bar has moved on to something else, a frame on from this one).
    if (src === s) { aim = s.frame() ?? aim; render(); }
  });

  // --- the notes: number, time, words, ▶, GRAB, ✕ ---------------------------------------
  let sig = '';
  function row(n, ns) {
    const s = src;
    const num = mk('span', 'notes-n', { 'aria-hidden': 'true', text: String(n.n) });
    const time = mk('button', 'notes-time mono', { type: 'button', 'aria-label': `Go to note ${n.n}, at ${n.at}`, text: n.at });
    time.addEventListener('click', () => Promise.resolve(s.seek(n.frame)).catch(fail('go there')));
    const w = mk('input', 'notes-row-words', { type: 'text', maxlength: '120', placeholder: 'what you heard…', 'aria-label': `Note ${n.n}, at ${n.at}: its words` });
    w.value = n.label;
    w.addEventListener('change', () => {
      const v = w.value.trim();
      if (v !== n.label) s.edit(n.id, v).catch(fail('save the note'));
    });
    w.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); w.blur(); }
      // Escape puts the words back, and the drawer stays: the field keeps it.
      if (e.key === 'Escape') { e.preventDefault(); w.value = n.label; w.blur(); }
    });
    const play = keyWith('play', 'notes-play', { 'aria-label': `Play from note ${n.n}, at ${n.at}` });
    play.addEventListener('click', () => Promise.resolve(s.seek(n.frame, { play: true })).catch(fail('play it')));
    const span = noteSpan(ns, n.id, { sampleRate: s.sampleRate, bpm: s.bpm(), total: s.total });
    const grab = mk('button', 'icon-btn notes-grab', { type: 'button', 'aria-label': `GRAB from note ${n.n} onto the Studio’s cue lane`, 'data-tip': 'notes-grab', disabled: !span, text: 'GRAB' });
    grab.addEventListener('click', () => { if (span) s.grab(span).catch(fail('GRAB it into the Studio')); });
    const out = keyWith('close', 'notes-out', { 'aria-label': `Take note ${n.n} out` });
    out.addEventListener('click', () => s.remove(n.id).catch(fail('take the note out')));
    return mk('li', 'notes-row', { 'data-id': n.id }, num, time, w, play, grab, out);
  }

  let atSaid = '';
  function render() {
    if (!src) return;
    const t = src.take();
    const label = `Notes on ${takeTitle(t)}`;
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    if (withHead) drawHead(t);
    const said = atLine(aim, src.sampleRate);
    if (said !== atSaid) {
      atSaid = said;
      at.innerHTML = icon('note', { size: 16 });
      at.append(` ${said}`);
    }
    const ns = src.notes();
    const next = JSON.stringify([ns.map((n) => [n.id, n.frame, n.label]), src.bpm()]);
    none.hidden = ns.length > 0;
    if (next === sig) return;
    sig = next;
    // A row being written in keeps its focus across the redraw.
    const focused = doc.activeElement?.closest?.('.notes-row')?.dataset.id;
    list.replaceChildren(...ns.map((n) => row(n, ns)));
    if (focused) list.querySelector(`li[data-id="${globalThis.CSS?.escape ? CSS.escape(focused) : focused}"] .notes-row-words`)?.focus();
  }
  function drawHead(t) {
    if (doc.activeElement !== name) {
      name.value = t.label || '';
      name.placeholder = takeTitle(t);
    }
    star.setAttribute('aria-pressed', String(!!t.starred));
    star.classList.toggle('on', !!t.starred);
    const g = tagStore.list.find((x) => x.id === t.tag);
    tag.className = `icon-btn notes-tag${g ? ` stripe-${g.color} on` : ''}`;
    tag.textContent = g ? g.name : '+ tag';
    tag.setAttribute('aria-label', g ? `Tag: ${g.name}. Change it` : 'Add a tag');
  }
  if (withHead) tagStore.subscribe(() => render());

  return {
    el,
    /** open shows `source`'s notes, with ✎ at `at` (its frame now by default) and the words ready. */
    open(source, { at: frame } = {}) {
      if (src !== source) {
        off?.();
        src = source;
        sig = '';
        words.value = '';
        off = source.onChange?.(() => render()) || null;
        if (withHead) tagStore.load();
      }
      aim = Math.max(0, Math.round(frame ?? source.frame() ?? 0));
      render();
      if (!sheet.isOpen) sheet.open();
      words.focus({ preventScroll: true });
    },
    close: () => sheet.close('program'),
    refresh: render,
    get isOpen() { return sheet.isOpen; },
    get source() { return src; },
    destroy() {
      sheet.destroy();
      el.remove();
    },
  };
}
