// web/static/lib/room/doorway.js
// The Listening Room is a library (docs/plan/the-studio-space.md, "The
// library" and "The studio is a place"): on a tablet and wider, a wall of
// shelves from under the header to the bar -- one shelf per month, newest
// first, then ★ and a shelf per tag -- in light perspective, under the
// lamp; on a phone, the List (shell/views/room.js's rack), with the wall one
// tap away on Shelf | List. The drawn room is where you are, not what you
// look at: it is the backdrop, in full only while you walk in
// (html[data-arriving="room"], the router's, while the switch plays) and
// at ambient light after.
//
// The List is still on the page, under the room, doing what it did: the
// rows, the filter, Select, Play all, the trash and the bar. This module
// draws the wall over it and works it through the handle shell/views/room.js
// gives (lib/room/mount.js), so nothing the List does is done twice.
//
// A tap on a spine plays it in the bar and a hold selects it (lib/ui/
// press.js, lib/room/tap.js): there is no sheet. A shelf's All › opens the
// List to that shelf; the search opens it with the field pinned. Tapes are
// not on the shelves: they live in the Studio.
//
// What it draws, in reading order, as a screen reader meets it: the
// shelves, each a list of buttons with its plate and its All ›; then the
// dock, which is the bar. The room behind them is decoration, hidden from
// it. Without the room to draw it (a phone, or reduced data asked for) the
// shelves stand on a plain wall.

import { wallShelves, shelfNames, at, filterWords } from './shelves.js';
import { forgetNote, fmtAt } from './notes.js';
import { openTheTape } from '../bar/carry.js';
import { bindPress, SPINE_PRESS } from '../ui/press.js';
import { icon } from '../ui/icons.js';
import { createTap, wireRack, askedTake } from './tap.js';
import { createFlights, rectOf } from './fly.js';
import { tagKey } from './tagpick.js';
import { openTagManager } from '../tags-dialog.js';
import { deckOf, readBar } from './deck.js';
import { familyCounts, familySticker, flagChips } from '../shelf.js';
import { takeTitle, fmtLen } from '../rooms/takename.js';
import { flagRequest } from '../flags.js';
import { tagStore } from '../tags.js';
import { stripeFor } from '../objects/cassette-geom.js';
import { RoomRenderer, roomScene, backdropRoom } from './stage.js';
import { libraryView, setLibraryView, CHANGED } from './library.js';

/** el builds an element: a class, attributes (text sets its words), children. */
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
/** drawn is an element holding an icon (lib/ui/icons.js) and then its words. */
function drawn(tag, cls, attrs, name, words, size = 16) {
  const e = el(tag, cls, attrs);
  e.innerHTML = `${icon(name, { size })}${words ? `<span>${words}</span>` : ''}`;
  return e;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** whenOf is when a take was made, as a spine says it: "today 21:04", "Tue 13 Oct". */
function whenOf(t, now = Date.now()) {
  const ms = at(t);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), today = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `today ${hm}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** toneOf is which of four J-card papers a take's spine is printed on: from its name, so it keeps it. */
export function toneOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 4;
}

/**
 * drawBackdrop draws the room behind the shelves (lib/room/stage.js, the
 * room without the furniture the wall now is), choosing the wide view or the
 * tall one by the room's shape, and again when that changes. Where the room
 * isn't drawn (a phone, reduced data) or a browser can't watch its size, it
 * draws nothing: the shelves work without it.
 */
function drawBackdrop({ room, scene }) {
  if (typeof ResizeObserver !== 'function') return;
  try {
    const space = backdropRoom();
    const renderer = new RoomRenderer({ box: scene, room: space, onError: (e) => console.error(e) });
    renderer.mount(scene, roomScene(space));
    const look = () => {
      const r = room.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(scene).display === 'none') return;
      renderer.setView(renderer.pick(r.width, r.height));
    };
    new ResizeObserver(look).observe(room);
    look();
  } catch (e) { console.error(e); }
}
// A View Transition cross-fade, where there is one and motion is welcome:
// the wall to the List and back. It answers once the page has changed (the
// transition runs the update a frame later), so focus can move to what's
// there now.
function crossFade(update) {
  if (!document.startViewTransition || reduced()) { update(); return Promise.resolve(); }
  return document.startViewTransition(update).updateCallbackDone.catch(() => {});
}

export function mount(h) {
  // A toast's *Name it* (or a held Capture spine) sends the person here to name
  // a take, and the sheet it opened is gone: a take is named on Open.
  const named = askedTake({ search: location.search });
  if (named) { location.replace(named); return { render() {} }; }
  forgetNote(); // a take's GRAB left a note for the Studio: this page is not it
  // The room's class on <body> is mount.js's BODY, which the page puts on
  // while the room is shown: the room may be mounted out of sight while the
  // Studio is shown (lib/shell/router.js prewarm), and must not mark it.
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const main = document.querySelector('.shelf-main');
  const tools = document.querySelector('.shelf-tools');
  const toast = h.toast;

  const title = document.querySelector('.shelf-title');
  if (title && title.firstChild && title.firstChild.nodeType === 3) title.firstChild.textContent = 'Listening Room · takes ';

  // --- the room: the drawn room behind, the wall of shelves in front ------
  const scene = el('div', 'room-scene');
  const backdrop = el('div', 'room-backdrop', { 'aria-hidden': 'true' }, el('div', 'room-frame', {}, scene));
  // A filter left on (the List's, remembered on this device) says so here:
  // otherwise the shelves just look empty.
  const filterText = el('span', 'room-filtered-text');
  const filterClear = el('button', 'room-filtered-clear', { type: 'button', 'data-tip': 'room-filter-clear' }, 'Show everything');
  const filterBar = el('p', 'room-filtered', { hidden: true }, filterText, filterClear);
  filterClear.addEventListener('click', () => { h.clearFilter(); room.querySelector('.room-cassette')?.focus(); });
  const emptyCard = el('p', 'room-empty', { hidden: true });
  const caseEl = el('div', 'room-case', {}, filterBar, emptyCard);
  const wall = el('div', 'room-wall', { role: 'group', 'aria-label': 'The shelves' }, caseEl);
  const room = el('section', 'room', { 'aria-label': 'The Listening Room' }, backdrop, wall);
  (tools || main.firstChild)?.after(room);
  drawBackdrop({ room, scene });

  // The List's head, when it shows a shelf (All ›): the way back, and what
  // it shows. The search's Cancel is beside its field, where the toolbar
  // holds it; in the head, where the page has put the field elsewhere.
  const rackBack = drawn('button', 'icon-btn room-rack-back', { type: 'button', 'data-tip': 'room-back' }, 'left', 'The room');
  const rackTitle = el('h2', 'room-rack-title');
  const searchDone = el('button', 'icon-btn room-search-done', { type: 'button', 'data-tip': 'room-search-done' }, 'Cancel');
  const fieldLabel = $('shelf-q')?.closest?.('label');
  if (fieldLabel && tools?.contains?.(fieldLabel)) fieldLabel.after(searchDone);
  const rackHead = el('div', 'room-rack-head', {}, rackBack, rackTitle, searchDone.parentElement ? null : searchDone);
  $('takes')?.before(rackHead);

  // --- a tap plays, a hold selects ----------------------------------------------
  // One tap for every surface: a spine, and a row of the List. The List's
  // rows are the rack's own, wired here; its select bar gets a Tag key.
  // The flight: a tap that puts a take in the bar lets its cassette fly
  // there from its spine while it plays (lib/room/fly.js). The sound is asked
  // for first, inside the tap; the flight is only a picture of it.
  const flights = createFlights({
    doc: document, win: window, host: body, reduced, ticker: h.ticker, timers: h.flightTimers,
    spine: (name) => room.querySelector(`.room-cassette[data-key="take:${CSS.escape(name)}"]`),
    target: () => {
      const np = $('np');
      if (!np || np.hidden) return null;
      const r = rectOf(np);
      return { x: r.x + 10, y: r.y + 8, w: 72, h: 46 };
    },
    face: (name) => {
      const d = spineData.get(name);
      return { name: d ? takeTitle(d.t) : name, stripe: d ? stripeFor(d.t, tagStore.list) : 1 };
    },
    onLand: () => {
      renderPlaces();
      // It lands in the bar, which settles once.
      const seat = $('np');
      seat?.classList.add('room-seat');
      (h.flightTimers || { set: (f, ms) => setTimeout(f, ms) }).set(() => seat?.classList.remove('room-seat'), 450);
    },
  });
  const tap = createTap({
    takes: h.takes, bar: () => h.np, toast, pick: h.pick, go: h.go,
    onPlay: (name, { placed, audio }) => { renderPlaces(); if (placed) flights.launch(name, { audio }); },
    onStop: () => flights.cancel(),
  });
  wireRack(h.rack, { takes: h.takes, tap });
  const tagging = tagKey({ doc: document, bar: h.selectBar, takes: h.takes, tags: tagStore, manage: (o) => openTagManager({ onToast: toast, ...o }) });

  // --- state -------------------------------------------------------------------
  let tapeList = null; // GET /api/tapes: {loaded, tapes}, or null with the tape off: the dock names the tape in the bar by it
  let lastSig = '';
  // `home` is how this device shows the room (Shelf | List, lib/room/
  // library.js); `shown` is a shelf opened to the List, or the search, over
  // it (below); `mode` is what is on the screen.
  let home = libraryView();
  let mode = home;
  let shown = null; // { kind: 'shelf' | 'search', layer, key?, close }

  Promise.resolve(h.tapes).then((list) => {
    tapeList = list;
    renderPlaces();
  });

  // What's in the bar: a take, or the tape (lib/room/deck.js).
  const inBar = () => deckOf({ takeName: h.np?.takeName ?? null, takes: h.takes.all, tapes: tapeList });

  // --- the shelves ---------------------------------------------------------------
  // One press per spine (lib/ui/press.js): a tap plays (or, with a selection
  // on, picks the take in or out); a hold, or ⇧-click, selects. A long press
  // on a phone is the browser's menu too: not on a spine.
  // A double tap opens the take (listening-back.md, "The way in"), as a
  // double tap opens a part in the Studio. Its first tap has already
  // started it, so it plays on into its page, which picks up where the bar
  // is; a take its first tap paused is started again on the way.
  let tapping = null; // the last tap's play, still on its way
  async function openSpine(name) {
    await tapping?.catch?.(() => {});
    if (h.np?.takeName === name && !barNow().playing) await tap.tap(name);
    const href = `/wave.html?file=${encodeURIComponent(name)}`;
    if (h.go) h.go(href); else location.href = href;
  }
  function wireSpine(b, name) {
    const takes = h.takes;
    bindPress(b, {
      ...SPINE_PRESS,
      onTap: () => {
        if (takes.selecting) takes.toggleSelected(name);
        else tapping = Promise.resolve(tap.tap(name));
      },
      onDouble: () => { if (!takes.selecting) openSpine(name); },
      onHold: () => {
        try { navigator.vibrate?.(10); } catch { /* not everywhere */ }
        if (takes.selecting) takes.toggleSelected(name); else takes.enterSelect(name);
      },
      selecting: () => takes.selecting,
      // The player is fetched as the finger goes down, so the play is inside the tap.
      onDown: () => { if (!takes.selecting) tap.warm(name); },
    });
  }
  // What each spine on the wall stands for, for painting it (the bar's take
  // and the selection change without the wall being drawn again).
  const spineData = new Map();
  function paintSpine(b) {
    const name = (b.dataset.key || '').slice('take:'.length);
    const d = spineData.get(name);
    if (!d) return;
    const bar = barNow();
    const inTheBar = h.np?.takeName === name;
    const playing = inTheBar && bar.playing;
    const chosen = h.takes.selected.has(name);
    const fam = familySticker(familyCounts(d.members));
    const t = d.t;
    b.setAttribute('aria-label', [takeTitle(t), whenOf(t), fmtLen(t.duration_seconds), t.starred ? 'starred' : '', d.isNew ? 'new' : '',
      fam ? fam.replace('✂', 'cuts ').replace('MIX ×', 'mixes ') : '', inTheBar ? 'in the bar' : '', chosen ? 'selected' : ''].filter(Boolean).join(', '));
    b.classList.toggle('on-deck', inTheBar);
    b.classList.toggle('playing', playing);
    b.classList.toggle('selected', chosen);
    // A spine is a toggle: picked while selecting, else playing.
    b.setAttribute('aria-pressed', String(h.takes.selecting ? chosen : playing));
  }
  const syncSpines = () => { for (const b of room.querySelectorAll('.room-cassette')) paintSpine(b); };
  function spineButton(t, { isNew = false, members = [] } = {}) {
    const fam = familySticker(familyCounts(members));
    spineData.set(t.name, { t, isNew, members });
    const b = el('button', `room-cassette sinks stripe-${stripeFor(t, tagStore.list)} room-tone-${toneOf(t.name)}${isNew ? ' is-new' : ''}${t.starred ? ' starred' : ''}`, {
      type: 'button', 'data-key': `take:${t.name}`,
    },
    el('span', 'room-cassette-stripe', { 'aria-hidden': 'true' }),
    el('span', 'room-cassette-name', { 'aria-hidden': 'true', text: takeTitle(t) }),
    isNew ? el('span', 'room-new', { 'aria-hidden': 'true', text: 'NEW' }) : null,
    fam ? el('span', 'room-fam', { 'aria-hidden': 'true', text: fam }) : null);
    wireSpine(b, t.name);
    paintSpine(b);
    return el('li', '', {}, b);
  }
  // A shelf: its spines, standing on its board; on the board's edge its
  // plate (a card in a brass holder, hand-lettered) and All ›, which opens
  // the List to it.
  function shelfOf(s) {
    const id = `room-shelf-${s.key.replace(/[^a-z0-9]+/gi, '-')}-h`;
    const plate = el('h3', 'room-plate', { id });
    if (s.kind === 'starred') plate.append(el('span', 'room-star', { 'aria-hidden': 'true' }));
    else if (s.kind === 'tag') plate.append(el('span', `room-plate-dot stripe-${s.tag.color}`, { 'aria-hidden': 'true' }));
    plate.append(el('span', 'room-plate-word', { text: s.plate }), el('span', 'room-plate-n', { text: ` · ${s.count}` }));
    const all = drawn('button', 'room-all sinks', { type: 'button', 'data-key': `all:${s.key}`, 'data-tip': 'room-all', 'aria-label': `All of ${s.title}` }, 'right', '', 14);
    all.prepend(el('span', '', { text: 'All' }));
    all.addEventListener('click', () => openShelf(s, all));
    const row = el('ul', 'room-row', { role: 'list' }, ...s.spines.map((x) => spineButton(x.take, { isNew: x.isNew, members: x.members })));
    const sec = el('section', `room-shelf room-shelf-${s.kind}`, { 'aria-labelledby': id, 'data-shelf': s.key },
      row, el('div', 'room-shelf-foot', {}, plate, all));
    sec.style.setProperty('--n', String(s.count));
    return sec;
  }
  const barNow = () => (h.np?.snapshot ? h.np.snapshot() : readBar(document));
  function render() {
    const now = Date.now();
    const opts = h.opts();
    const shelves = wallShelves(h.takes.all, { ...opts, tags: tagStore.list }, now);
    const filtered = filterWords(opts, tagStore.list);
    // A poll that changes nothing must not rebuild what's under a finger.
    const sig = JSON.stringify([
      shelves.map((s) => [s.key, s.plate, s.spines.map((x) => [x.take.name, x.take.label, x.take.starred, x.take.tag, x.isNew, x.members.length, x.take.duration_seconds])]),
      tagStore.list.map((g) => `${g.id}:${g.color}:${g.name}`), filtered,
    ]);
    if (shown?.kind === 'shelf') syncShelf();
    if (sig === lastSig) return;
    lastSig = sig;
    const a = document.activeElement;
    const focused = a?.closest?.('.room-wall [data-key]') ? { key: a.dataset.key, shelf: a.closest('.room-shelf')?.dataset.shelf } : null;

    spineData.clear();
    filterBar.hidden = !filtered.length;
    filterText.textContent = `Showing only takes ${filtered.join(', ')}. `;
    emptyCard.hidden = shelves.length > 0;
    emptyCard.textContent = filtered.length
      ? 'No takes match. Show everything to see them all.'
      : 'Nothing on the shelves yet. KEEP in the Studio puts a take here.';
    caseEl.replaceChildren(filterBar, emptyCard, ...shelves.map(shelfOf));
    if (focused) {
      const shelf = focused.shelf ? caseEl.querySelector(`[data-shelf="${CSS.escape(focused.shelf)}"]`) : null;
      (shelf?.querySelector(`[data-key="${CSS.escape(focused.key)}"]`) || room.querySelector(`[data-key="${CSS.escape(focused.key)}"]`))?.focus();
    }
    fitSoon();
  }

  // A shelf that holds more than it shows ends on half a spine, so it says
  // it goes on: the row is cut to a whole number of spines and a half.
  // Measured when the wall changes size or is drawn again, never per frame.
  function fitRows() {
    if (typeof getComputedStyle !== 'function' || mode !== 'shelf') return;
    for (const row of caseEl.querySelectorAll('.room-row')) {
      row.style.removeProperty('max-width');
      const first = row.querySelector('.room-cassette');
      if (!first || row.scrollWidth <= row.clientWidth + 1) continue;
      const cs = getComputedStyle(row);
      const pitch = first.offsetWidth + (parseFloat(cs.columnGap) || 0);
      const pad = parseFloat(cs.paddingLeft) || 0;
      if (!pitch) continue;
      const k = Math.max(1, Math.floor((row.clientWidth - pad - pitch / 2) / pitch));
      row.style.maxWidth = `${Math.round(pad + k * pitch + pitch / 2)}px`;
    }
  }
  let fitting = false;
  function fitSoon() {
    if (fitting || typeof requestAnimationFrame !== 'function') return;
    fitting = true;
    requestAnimationFrame(() => { fitting = false; fitRows(); });
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitSoon).observe(wall);

  // On a tablet and wider the room is pinned to the window (styles.css),
  // where the page's own box for it is: under the header (and a banner),
  // over the bar. Measured when that box changes size, never per frame.
  function pinRoom() {
    const r = main?.getBoundingClientRect?.();
    if (!r || !r.height) return; // another room is showing
    main.style.setProperty('--room-top', `${Math.round(r.top)}px`);
    main.style.setProperty('--room-h', `${Math.round(r.height)}px`);
  }
  if (typeof ResizeObserver === 'function' && main) new ResizeObserver(pinRoom).observe(main);

  let spinesSig = '';
  function renderPlaces() {
    const bar = barNow();
    const d = inBar();
    const spines = JSON.stringify([h.np?.takeName ?? null, bar.playing]);
    if (spines !== spinesSig) { spinesSig = spines; syncSpines(); }
    renderDock(d);
  }
  const offBar = h.np?.onChange?.(renderPlaces);

  // The dock is the bar (its Open › opens a take, or the tape in the
  // Studio: lib/bar/bar.js), with grease marks at a take's In and Out.
  const grease = el('span', 'room-grease', { 'aria-hidden': 'true' }, el('i', 'room-grease-in'), el('i', 'room-grease-out'));
  if (h.barSlot) h.barSlot.add(grease, { after: $('np-scrub') });
  else $('np-scrub')?.after(grease);
  function renderDock(d) {
    const t = d && d.kind === 'take' ? d.take : null;
    const tr = t && t.trim;
    const total = t ? (t.duration_seconds || 0) * (t.sample_rate || 48000) : 0;
    grease.hidden = !tr || !total;
    const sc = $('np-scrub');
    if (tr && total && sc) {
      grease.style.left = `${sc.offsetLeft}px`;
      grease.style.top = `${sc.offsetTop}px`;
      grease.style.width = `${sc.offsetWidth}px`;
      grease.style.height = `${sc.offsetHeight}px`;
      grease.style.setProperty('--in', String(tr.start_frame / total));
      grease.style.setProperty('--out', String(tr.end_frame / total));
    }
  }

  // The Sketchbook: the notes of the take in the bar, which ✎ on the bar
  // opens (the engine's setOnNote). It left the room's floor with the deck;
  // the notes drawer (listening-back.md, step 2) is to take its place.
  function openSketchbook(takeName, stashed = null) {
    const t0 = h.takes.all.find((x) => x.name === takeName);
    if (!t0) return;
    let dlg = $('room-sketchbook');
    if (!dlg) {
      dlg = el('dialog', 'sheet room-book-sheet', { id: 'room-sketchbook', 'aria-labelledby': 'room-book-title' },
        el('div', 'sheet-inner room-book-inner', {},
          el('div', 'room-book-head', {},
            el('h3', '', { id: 'room-book-title', text: 'Sketchbook' }),
            el('button', 'icon-btn room-book-star', { id: 'room-book-star', type: 'button', 'aria-label': 'Star take' }, '★'),
            el('button', 'icon-btn room-book-tag', { id: 'room-book-tag', type: 'button', 'aria-label': 'Tag take' }, '+ tag'),
            el('a', 'icon-btn room-book-wave', { id: 'room-book-wave', text: 'Open waveform ›' }),
            el('button', 'icon-btn room-book-close', { id: 'room-book-close', type: 'button', text: 'Done' })),
          el('div', 'room-book-meta-row', {},
            el('input', 'room-book-name-input', { id: 'room-book-name-input', type: 'text', maxlength: '80', placeholder: 'Name this take…', 'aria-label': 'Take name' })),
          el('form', 'room-book-form', { id: 'room-book-form' },
            el('label', 'room-book-at', { id: 'room-book-at', for: 'room-book-input' }),
            el('div', 'room-book-row', {},
              el('input', '', { id: 'room-book-input', type: 'text', maxlength: '120', placeholder: 'Write a note at this moment…', autocomplete: 'off' }),
              el('button', 'icon-btn primary', { type: 'submit', text: 'Add note' }))),
          el('div', 'room-book-list', { id: 'room-book-list', role: 'list' })));
      body.append(dlg);
      $('room-book-close').addEventListener('click', () => dlg.close?.());
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close?.(); });
    }
    const curTake = () => h.takes.all.find((x) => x.name === takeName) || t0;
    const sr = () => curTake().sample_rate || 48000;
    const frameAt = () => {
      if (stashed && stashed.take === takeName && typeof stashed.frame === 'number') return stashed.frame;
      const now = h.np?.frameNow?.();
      if (now && now.take === takeName) return now.frame;
      return 0;
    };
    let targetFrame = frameAt();
    const patchTake = async (fields) => {
      const res = await fetch(`/api/take?file=${encodeURIComponent(takeName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      h.takes.etag = null;
      await h.takes.refresh();
      render();
      renderPlaces();
      renderBook();
    };
    $('room-book-star').onclick = async () => {
      try {
        await patchTake({ starred: !curTake().starred });
      } catch (e) { toast?.(`Could not star take: ${e.message}`, 'bad'); }
    };
    $('room-book-tag').onclick = async () => {
      const list = tagStore.list;
      if (!list.length) {
        openTagManager({ onToast: toast, onCreated: (g) => patchTake({ tag: g.id }).catch(() => {}) });
        return;
      }
      const cur = curTake().tag || '';
      const idx = list.findIndex((g) => g.id === cur);
      const next = idx < 0 ? list[0].id : (idx + 1 < list.length ? list[idx + 1].id : '');
      try {
        await patchTake({ tag: next });
      } catch (e) { toast?.(`Could not tag take: ${e.message}`, 'bad'); }
    };
    $('room-book-name-input').onchange = async (e) => {
      const label = e.target.value.trim();
      if (label === (curTake().label || '')) return;
      try {
        await patchTake({ label });
      } catch (err) { toast?.(`Could not rename take: ${err.message}`, 'bad'); }
    };
    const renderBook = () => {
      const t = curTake();
      $('room-book-title').textContent = `Sketchbook · ${takeTitle(t)}`;
      $('room-book-wave').setAttribute('href', `/wave.html?file=${encodeURIComponent(t.name)}`);
      $('room-book-at').textContent = `Note at ${fmtAt(targetFrame, sr())}`;
      const starBtn = $('room-book-star');
      starBtn.setAttribute('aria-pressed', String(!!t.starred));
      starBtn.classList.toggle('on', !!t.starred);
      const g = tagStore.list.find((x) => x.id === t.tag);
      const tagBtn = $('room-book-tag');
      tagBtn.className = `icon-btn room-book-tag${g ? ` stripe-${g.color} on` : ''}`;
      tagBtn.textContent = g ? g.name : '+ tag';
      const nameIn = $('room-book-name-input');
      if (document.activeElement !== nameIn) nameIn.value = t.label || '';
      const list = $('room-book-list');
      const chips = flagChips(t);
      if (!chips.length) {
        list.replaceChildren(el('p', 'muted room-book-empty', { text: 'No notes on this take yet. Add one above while it plays.' }));
        return;
      }
      list.replaceChildren(...chips.map((f) => {
        const jump = el('button', 'chip room-book-jump mono', { type: 'button', 'aria-label': `Seek to ${f.at}`, text: `✎ ${f.at}` });
        jump.addEventListener('click', async () => {
          const p = await h.takes.player(t.name);
          if (p?.audio) p.audio.currentTime = f.frame / sr();
        });
        const input = el('input', 'room-book-edit', { type: 'text', maxlength: '120', placeholder: 'Note…' });
        input.value = f.label || '';
        input.addEventListener('change', async () => {
          const label = input.value.trim();
          if (label === (f.label || '')) return;
          try {
            await flagRequest(t.name, 'edit', { id: f.id, label });
            h.takes.etag = null;
            await h.takes.refresh();
            renderPlaces();
            renderBook();
          } catch (e) { toast?.(`Could not save note: ${e.message}`, 'bad'); }
        });
        const rm = el('button', 'icon-btn danger room-book-rm', { type: 'button', 'aria-label': `Remove note at ${f.at}`, text: '×' });
        rm.addEventListener('click', async () => {
          try {
            await flagRequest(t.name, 'remove', { id: f.id });
            h.takes.etag = null;
            await h.takes.refresh();
            renderPlaces();
            renderBook();
          } catch (e) { toast?.(`Could not remove note: ${e.message}`, 'bad'); }
        });
        return el('div', 'room-book-item', { role: 'listitem' }, jump, input, rm);
      }));
    };
    const form = $('room-book-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = $('room-book-input');
      const label = input.value.trim();
      const frame = targetFrame;
      try {
        await flagRequest(takeName, 'add', { frame, label });
        input.value = '';
        h.takes.etag = null;
        await h.takes.refresh();
        targetFrame = frameAt();
        renderPlaces();
        renderBook();
      } catch (err) {
        toast?.(`Could not add note: ${err.message}`, 'bad');
      }
    };
    renderBook();
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
    $('room-book-input')?.focus();
  }

  h.onChange(() => { render(); renderPlaces(); });
  h.onSelected(() => { tagging.sync(); syncSpines(); });
  tagStore.subscribe(() => render());

  // --- the library: the wall or the List, a shelf's All ›, the search -------------
  // A shelf opened to the List and the search are each on the page's stack
  // (lib/ui/layers.js), so Back and Escape put them away as they close a
  // sheet, and a switch of rooms does.
  const viewKeys = () => [...($('shelf-view')?.querySelectorAll('button[data-show]') || [])];
  function show(next) {
    mode = next;
    body.classList.toggle('room-rack', next !== 'shelf');
    body.classList.toggle('room-search', next === 'search');
    body.classList.toggle('room-drill', next === 'opened' || (next === 'search' && rackHead.contains(searchDone)));
    rackBack.hidden = next !== 'opened';
    searchDone.hidden = next !== 'search';
    for (const b of viewKeys()) b.setAttribute('aria-pressed', String(b.dataset.show === home));
    if (next === 'shelf') fitSoon();
  }
  const putAway = () => (shown?.layer?.open ? shown.layer.close('program') : shown?.close('program'));

  // Shelf | List: this device's way of seeing the room, remembered.
  for (const b of viewKeys()) {
    b.addEventListener('click', () => {
      const v = b.dataset.show;
      setLibraryView(v);
      home = v;
      if (shown) putAway();
      else crossFade(() => show(home));
    });
  }
  // The same switch, changed in Settings (lib/device-prefs.js): heard while
  // the room shows, and looked at again whenever it is shown.
  function followPref() {
    home = libraryView();
    if (!shown) show(home);
    else for (const b of viewKeys()) b.setAttribute('aria-pressed', String(b.dataset.show === home));
  }
  h.on?.(window, CHANGED, followPref);

  // A shelf's All ›: the List, showing that shelf alone; ‹ The room (or
  // Back) goes back to the wall, to the All › it came from.
  let shelfSig = '';
  function syncShelf() {
    const names = shelfNames(h.takes.all, shown.key, { ...h.opts(), tags: tagStore.list });
    const sig = [...names].sort().join('|');
    if (sig === shelfSig) return;
    shelfSig = sig;
    h.setFilter((t) => names.has(t.name));
  }
  function openShelf(s, all) {
    if (shown) putAway();
    const close = (reason) => {
      if (shown !== mine) return;
      shown = null;
      shelfSig = '';
      crossFade(() => { h.setFilter(null); if (!shown) show(home); }).then(() => {
        if (reason !== 'navigate') room.querySelector(`[data-key="${CSS.escape(`all:${s.key}`)}"]`)?.focus();
      });
    };
    const mine = { kind: 'shelf', key: s.key, close };
    mine.layer = h.layers?.open({ el: h.rack, kind: 'drawer', owner: all, returnFocus: null, onClose: close }) || null;
    shown = mine;
    shelfSig = '';
    rackTitle.textContent = `${s.plate} · ${s.count}`;
    crossFade(() => { syncShelf(); show('opened'); }).then(() => rackBack.focus());
  }
  rackBack.addEventListener('click', putAway);

  // The search (its field is #shelf-q, wherever the page puts it): used, it
  // opens the List with the field pinned and the results right under it,
  // above where a keyboard comes up; Cancel (or Back) empties it and goes
  // back to the wall or the List it came from. What it matches is
  // lib/shelf.js searchText: what's printed on a spine, the day, the tag,
  // the tempo, the notes.
  const field = $('shelf-q');
  function openSearch() {
    if (shown?.kind === 'search') return;
    if (shown) putAway();
    const close = (reason) => {
      if (shown !== mine) return;
      shown = null;
      h.clearQuery?.();
      if (reason !== 'navigate') field?.blur?.();
      show(home);
    };
    const mine = { kind: 'search', close };
    mine.layer = h.layers?.open({ el: tools || field, kind: 'drawer', owner: field, outside: false, returnFocus: null, onClose: close }) || null;
    shown = mine;
    rackTitle.textContent = '';
    show('search');
    // The results start at the top, under the field.
    try { window.scrollTo?.(0, 0); } catch { /* fine */ }
  }
  field?.addEventListener('focus', openSearch);
  field?.addEventListener('input', openSearch);
  searchDone.addEventListener('click', putAway);

  show(home);
  render();
  renderPlaces();
  return {
    render,
    renderPlaces,
    openSketchbook,
    shown: followPref,
    hide() {
      flights.cancel();
      $('room-sketchbook')?.close?.();
    },
    destroy() {
      offBar?.();
      flights.cancel();
    },
  };
}
