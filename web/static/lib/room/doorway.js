// web/static/lib/room/doorway.js
// The Listening Room seen from the doorway: the takes page under the rooms
// flag (docs/superpowers/specs/2026-10-15-listening-room-design.md, and the
// flow spec, 2026-10-15-flow-design.md, "One way to listen").
//
// The rack is still on the page, under the room, doing what it did: the list,
// its filter, Select, Play all, the trash and the now-playing bar. This module
// draws the room over it and works it through the handle shelf-page.js gives
// (lib/room/mount.js), so nothing the rack does is lost and nothing is done
// twice.
//
// A tap on a spine plays it in the bar and a hold selects it (lib/room/
// press.js, tap.js): there is no sheet. The deck is a picture of the bar
// (lib/room/deck.js), and tapes are not on the shelves: they live in the
// Studio.
//
// What it draws, in reading order, as a screen reader meets it: the shelves
// (this month's takes, the archive by month), each a list of buttons; then the
// deck -- the bar, drawn -- and the sketchbook, each a button; then the dock,
// which is the bar. The wall, the lamp, the window, the rug and the chair are
// decoration, hidden from it. Without the room to draw them (a phone, or
// reduced data asked for), the shelves are rows, and the page's own bar is the
// only transport.

import { roomShelves, inMonth, monthName, monthKey, at, filterWords } from './shelves.js';
import { forgetNote, fmtAt } from './notes.js';
import { openTheTape, forTheTape } from '../bar/carry.js';
import { pressMachine } from './press.js';
import { createTap, wireRack, askedTake } from './tap.js';
import { createFlights, rectOf } from './fly.js';
import { tagKey } from './tagpick.js';
import { openTagManager } from '../tags-dialog.js';
import { deckOf, deckWords, readBar, fmtLen } from './deck.js';
import { spineTitle, familyCounts, familySticker } from '../shelf.js';
import { tagStore } from '../tags.js';
import { stripeFor } from '../objects/cassette-geom.js';

const TAPES_EVERY_MS = 15000;
const DECK_EVERY_MS = 500;

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** whenOf is when a take was made, as the card says it: "today 21:04", "Tue 13 Oct". */
function whenOf(t, now = Date.now()) {
  const ms = at(t);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), today = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `today ${hm}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A View Transition cross-fade, where there is one and motion is welcome.
// The shelf-to-deck flight is brief R2's; this is its stand-in. It answers
// once the page has changed (the transition runs the update a frame later),
// so focus can move to what's there now.
function crossFade(update) {
  if (!document.startViewTransition || reduced()) { update(); return Promise.resolve(); }
  return document.startViewTransition(update).updateCallbackDone.catch(() => {});
}

export function mount(h) {
  // A toast's *Name it* (or a held Capture spine) sends the person here to name
  // a take, and the sheet it opened is gone: a take is named on Open.
  const named = askedTake({ rooms: true, search: location.search });
  if (named) { location.replace(named); return { render() {} }; }
  forgetNote(); // a take's GRAB left a note for the Studio: this page is not it
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const main = document.querySelector('.shelf-main');
  const tools = document.querySelector('.shelf-tools');
  const toast = h.toast;
  body.classList.add('room-on');

  // --- the header: the room's name, and Search the shelves ----------------
  const title = document.querySelector('.shelf-title');
  if (title && title.firstChild && title.firstChild.nodeType === 3) title.firstChild.textContent = 'Listening Room · takes ';
  if (tools && !tools.id) tools.id = 'room-search-tools';
  const searchBtn = el('button', 'chip room-search-btn', {
    type: 'button', 'aria-expanded': 'false', 'aria-controls': tools?.id, 'data-tip': 'room-search',
  }, el('span', '', { 'aria-hidden': 'true', text: '⌕ ' }), 'Search the shelves');
  $('play-all')?.before(searchBtn);
  searchBtn.addEventListener('click', () => {
    const on = !body.classList.contains('room-search');
    body.classList.toggle('room-search', on);
    searchBtn.setAttribute('aria-expanded', String(on));
    if (on) $('shelf-q')?.focus();
  });


  // --- the room ----------------------------------------------------------------
  const scene = el('div', 'room-scene', { 'aria-hidden': 'true' },
    el('span', 'room-curtain'),
    el('span', 'room-window', {}, el('span', 'room-city')),
    el('span', 'room-lamp', {}, el('span', 'room-lamp-shade'), el('span', 'room-lamp-pole')),
    el('span', 'room-floor'),
    el('span', 'room-rug'),
    el('span', 'room-armchair', {}, el('span', 'room-armchair-arm'), el('span', 'room-armchair-back')),
    el('span', 'room-console'),
    el('span', 'room-speaker'),
    el('span', 'room-sidetable', {}, el('span', 'room-glass'), el('span', 'room-pencil')));

  // A shelf: its plate, the list on it, and -- for takes -- a key that opens
  // it as today's rack, where Select and Play all are.
  const shelf = (key, label, asList = null) => {
    const h3 = el('h3', 'room-plate', { id: `room-${key}-h` });
    // The section is named by its plate; the list in it needs no second name.
    const list = el('ul', 'room-row', { role: 'list' });
    const listBtn = asList ? el('button', 'room-list-btn', { type: 'button', 'data-key': `list:${key}`, 'aria-label': asList, 'data-tip': 'room-list' }, '☰ List') : null;
    const foot = el('div', 'room-shelf-foot', {}, h3, listBtn);
    const sec = el('section', `room-shelf room-shelf-${key}`, { 'aria-labelledby': `room-${key}-h` }, foot, list);
    h3.textContent = label;
    return { sec, h3, list, listBtn };
  };
  // Tapes are not here: they live in the Studio only (the flow spec, answer 2).
  // A tape's bounces are takes, and stand on the takes shelf.
  const takesShelf = shelf('takes', 'TAKES', 'This month’s takes as a list, to select or play');
  const takesEmpty = el('p', 'room-empty', { text: 'Nothing kept this month yet. KEEP in the Studio puts a take on this shelf.' });
  takesShelf.sec.append(takesEmpty);
  const archiveShelf = shelf('archive', 'ARCHIVE');
  // A filter left on (the rack's, remembered on this device) says so here:
  // otherwise the shelves just look empty.
  const filterText = el('span', 'room-filtered-text');
  const filterClear = el('button', 'room-filtered-clear', { type: 'button', 'data-tip': 'room-filter-clear' }, 'Show everything');
  const filterBar = el('p', 'room-filtered', { hidden: true }, filterText, filterClear);
  filterClear.addEventListener('click', () => { h.clearFilter(); takesShelf.list.querySelector('button')?.focus(); });
  const shelves = el('div', 'room-shelves', { role: 'group', 'aria-label': 'The shelves' },
    filterBar, takesShelf.sec, archiveShelf.sec);

  // The deck: a picture of the bar -- what it holds, how far it has got. It
  // has no keys of its own (the bar is the only transport); pressing it is Open.
  const deckLcd = el('span', 'room-deck-lcd', { 'aria-hidden': 'true' });
  const deckArt = el('span', 'room-deck-art', { 'aria-hidden': 'true' },
    el('span', 'room-deck-reel'), el('span', 'room-deck-reel'), deckLcd);
  const deckPlace = el('button', 'room-place room-deck-place', { type: 'button', 'data-tip': 'room-deck' });
  const deckMeta = el('span', 'room-deck-meta');
  const deckBar = el('span', 'room-deck-progress', { 'aria-hidden': 'true' }, el('span', 'room-deck-progress-fill'));
  const deck = el('section', 'room-deck', { 'aria-label': 'The deck, a picture of the bar' }, deckArt, deckPlace, deckMeta, deckBar);

  // The sketchbook, on the side table: the chair, for what's in the bar.
  const bookPlace = el('button', 'room-place room-book-place', { type: 'button', 'data-tip': 'room-book' });
  const book = el('section', 'room-book', { 'aria-label': 'The sketchbook' }, bookPlace);

  const stage = el('div', 'room-stage', {}, deck, book);
  const room = el('section', 'room', { 'aria-label': 'The Listening Room' }, scene, shelves, stage);
  (tools || main.firstChild)?.after(room);

  // The archive's month, opened to the rack.
  const rackBack = el('button', 'icon-btn room-rack-back', { type: 'button' }, '‹ The room');
  const rackTitle = el('h2', 'room-rack-title');
  const rackHead = el('div', 'room-rack-head', {}, rackBack, rackTitle);
  $('takes')?.before(rackHead);

  // --- a tap plays, a hold selects ----------------------------------------------
  // One tap for every surface: a spine, and a row of the List (a month's box,
  // a search, a family's takes). The List's rows are the rack's own, wired
  // here; its select bar gets a Tag key.
  // The flight: a tap that puts a take on the deck lets its cassette fly there
  // from its spine while it plays (lib/room/fly.js). The sound is asked for
  // first, inside the tap; the flight is only a picture of it. Where the deck
  // is not drawn (a phone) it flies to the bar, the one transport there.
  let flewTo = 'deck';
  const flights = createFlights({
    doc: document, win: window, host: body, reduced, ticker: h.ticker, timers: h.flightTimers,
    spine: (name) => room.querySelector(`.room-cassette[data-key="take:${CSS.escape(name)}"]`),
    target: () => {
      const art = deckArt.getBoundingClientRect();
      if (art.width > 0 && art.height > 0) {
        flewTo = 'deck';
        const w = art.width * 0.86;
        return { x: art.left + art.width * 0.07, y: art.top + art.height * 0.04, w, h: w / 1.59 };
      }
      const np = $('np');
      if (!np || np.hidden) return null;
      flewTo = 'bar';
      const r = rectOf(np);
      return { x: r.x + 10, y: r.y + 8, w: 72, h: 46 };
    },
    face: (name) => {
      const d = spineData.get(name);
      return { name: d ? spineTitle(d.t) : name, stripe: d ? stripeFor(d.t, tagStore.list) : 1 };
    },
    onLand: () => {
      renderPlaces();
      // It lands in the deck, which settles once; on a phone, in the bar.
      const seat = flewTo === 'deck' ? deck : $('np');
      seat?.classList.add('room-seat');
      (h.flightTimers || { set: (f, ms) => setTimeout(f, ms) }).set(() => seat?.classList.remove('room-seat'), 450);
    },
  });
  const tap = createTap({
    takes: h.takes, bar: () => h.np, toast, pick: h.pick,
    onPlay: (name, { placed }) => { renderPlaces(); if (placed) flights.launch(name); },
    onStop: () => flights.cancel(),
  });
  wireRack(h.rack, { takes: h.takes, tap });
  const tagging = tagKey({ doc: document, bar: h.selectBar, takes: h.takes, tags: tagStore, manage: (o) => openTagManager({ onToast: toast, ...o }) });

  // --- state -------------------------------------------------------------------
  let tapeList = null; // GET /api/tapes: {loaded, tapes}, or null with the tape off: the deck names the tape in the bar by it
  let month = null; // the archive's month opened to the rack: {key, title}
  let lastSig = '';

  Promise.resolve(h.tapes).then((list) => {
    tapeList = list;
    renderPlaces();
  });
  async function refreshTapes() {
    try {
      const res = await fetch('/api/tapes', { cache: 'no-store' });
      tapeList = res.ok ? await res.json() : null;
    } catch { /* the next look asks again */ }
    renderPlaces();
  }
  setInterval(() => { if (!document.hidden && tapeList) refreshTapes(); }, TAPES_EVERY_MS);

  // What's in the bar: a take, or the tape (lib/room/deck.js).
  const inBar = () => deckOf({ takeName: h.np?.takeName ?? null, takes: h.takes.all, tapes: tapeList });

  // --- the shelves ---------------------------------------------------------------
  // One press machine per spine: a tap plays (or, with a selection on, picks
  // the take in or out); a hold, or ⇧-click, selects.
  function wireSpine(b, name) {
    const takes = h.takes;
    const press = pressMachine({
      onTap: () => (takes.selecting ? takes.toggleSelected(name) : tap.tap(name)),
      onSelect: () => {
        try { navigator.vibrate?.(10); } catch { /* not everywhere */ }
        if (takes.selecting) takes.toggleSelected(name); else takes.enterSelect(name);
      },
      selecting: () => takes.selecting,
    });
    // The player is fetched as the finger goes down, so the play is inside the tap.
    b.addEventListener('pointerdown', (e) => { if (!takes.selecting) tap.warm(name); press.down(e); });
    b.addEventListener('pointermove', press.move);
    b.addEventListener('pointerup', press.up);
    for (const ev of ['pointercancel', 'pointerleave']) b.addEventListener(ev, press.cancel);
    b.addEventListener('click', press.click);
    // A long press on a phone is the browser's menu too: not on a spine.
    b.addEventListener('contextmenu', (e) => { if (press.active()) e.preventDefault(); });
  }
  // What each spine on the shelf stands for, for painting it (the bar's take
  // and the selection change without the shelf being drawn again).
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
    b.setAttribute('aria-label', [spineTitle(t), whenOf(t), fmtLen(t.duration_seconds), t.starred ? 'starred' : '', d.isNew ? 'new' : '',
      fam ? fam.replace('✂', 'cuts ').replace('MIX ×', 'mixes ') : '', inTheBar ? 'in the bar' : '', chosen ? 'selected' : ''].filter(Boolean).join(', '));
    b.classList.toggle('on-deck', inTheBar);
    b.classList.toggle('selected', chosen);
    // A spine is a toggle: picked while selecting, else playing.
    b.setAttribute('aria-pressed', String(h.takes.selecting ? chosen : playing));
  }
  const syncSpines = () => { for (const b of room.querySelectorAll('.room-cassette')) paintSpine(b); };
  function spineButton(t, { isNew = false, members = [] } = {}) {
    const name = spineTitle(t);
    const fam = familySticker(familyCounts(members));
    spineData.set(t.name, { t, isNew, members });
    const b = el('button', `room-cassette stripe-${stripeFor(t, tagStore.list)}${isNew ? ' is-new' : ''}${t.starred ? ' starred' : ''}`, {
      type: 'button', 'data-key': `take:${t.name}`,
    },
    el('span', 'room-cassette-stripe', { 'aria-hidden': 'true' }),
    el('span', 'room-cassette-name', { 'aria-hidden': 'true', text: name }),
    el('span', 'room-cassette-when', { 'aria-hidden': 'true', text: `${whenOf(t)} · ${fmtLen(t.duration_seconds)}` }),
    isNew ? el('span', 'room-new', { 'aria-hidden': 'true', text: 'NEW' }) : null,
    fam ? el('span', 'room-fam', { 'aria-hidden': 'true', text: fam }) : null);
    wireSpine(b, t.name);
    paintSpine(b);
    return el('li', '', {}, b);
  }
  function boxButton(m) {
    const b = el('button', 'room-box', { type: 'button', 'data-key': `month:${m.key}`, 'aria-label': `${m.title}. Open the box` },
      el('span', 'room-box-label', { 'aria-hidden': 'true', text: m.plate }), el('span', 'room-box-hole', { 'aria-hidden': 'true' }));
    b.addEventListener('click', () => openMonth(m));
    return el('li', '', {}, b);
  }
  const barNow = () => readBar(document);
  function render() {
    const now = Date.now();
    const s = roomShelves(h.takes.all, h.opts(), now);
    // A poll that changes nothing must not rebuild what's under a finger.
    const sig = JSON.stringify([
      s.month.spines.map((x) => [x.take.name, x.take.label, x.take.starred, x.take.tag, x.isNew, x.members.length, x.take.duration_seconds]),
      s.archive.map((b) => b.plate),
      tagStore.list.map((g) => `${g.id}:${g.color}`), monthName(now),
      filterWords(h.opts(), tagStore.list),
    ]);
    if (sig === lastSig) return;
    lastSig = sig;
    const focused = document.activeElement?.closest?.('.room-shelves [data-key]')?.dataset.key;

    takesShelf.h3.textContent = `TAKES · ${monthName(now)} · ${s.month.spines.length}`;
    spineData.clear();
    takesShelf.list.replaceChildren(...s.month.spines.map((x) => spineButton(x.take, { isNew: x.isNew, members: x.members })));
    const filtered = filterWords(h.opts(), tagStore.list);
    filterBar.hidden = !filtered.length;
    filterText.textContent = `Showing only takes ${filtered.join(', ')}. `;
    takesEmpty.hidden = s.month.spines.length > 0;
    takesEmpty.textContent = filtered.length
      ? 'No takes this month match. Show everything to see them all.'
      : 'Nothing kept this month yet. KEEP in the Studio puts a take on this shelf.';
    if (takesShelf.listBtn) takesShelf.listBtn.hidden = !s.month.spines.length;
    const archived = s.archive.reduce((n, b) => n + b.count, 0);
    archiveShelf.sec.hidden = !s.archive.length;
    archiveShelf.h3.textContent = `ARCHIVE · ${archived}`;
    archiveShelf.list.replaceChildren(...s.archive.map(boxButton));
    if (focused) room.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
    if (month) syncMonth();
  }

  // The deck and the dock follow the bar, which has no events of its own: a
  // look twice a second, drawing only what changed. The take in the bar, and
  // whether it plays, are also what the spines say: they are repainted in
  // place, never rebuilt (a rebuild under a finger that has just held would
  // lose the lift that must not play).
  let placesSig = '';
  let spinesSig = '';
  function renderPlaces() {
    const bar = barNow();
    const d = inBar();
    const w = deckWords(d, bar);
    const spines = JSON.stringify([h.np?.takeName ?? null, bar.playing]);
    if (spines !== spinesSig) { spinesSig = spines; syncSpines(); }
    room.style.setProperty('--room-played', bar.frac.toFixed(4));
    deckLcd.textContent = w.lcd;
    const sig = JSON.stringify([w.place, w.meta, w.label, w.href, bar.playing, !!d]);
    if (sig === placesSig) return;
    placesSig = sig;
    deck.classList.toggle('empty', !d);
    deck.classList.toggle('playing', bar.playing && !!d);
    deckPlace.replaceChildren(el('span', 'room-led', { 'aria-hidden': 'true' }), w.place);
    deckPlace.setAttribute('aria-label', w.label);
    deckMeta.textContent = w.meta;
    // The sketchbook: the notes of the take in the bar.
    const bt = d && d.kind === 'take' ? d.take : null;
    const notes = bt ? (bt.flags || []).length : 0;
    const latest = bt ? [...(bt.flags || [])].filter((f) => f.label).sort((a, b) => b.frame - a.frame)[0] : null;
    bookPlace.replaceChildren(
      el('span', 'room-book-word', { text: 'Sketchbook' }),
      el('span', 'room-book-latest', { text: d && d.kind === 'tape' ? `${(d.tape.name || 'the tape')}` : latest ? `${fmtAt(latest.frame, bt.sample_rate || 48000)} · ${latest.label}` : bt ? 'no notes yet' : 'nothing in the bar' }),
      el('span', 'room-book-n', { 'aria-hidden': 'true', text: String(notes) }));
    bookPlace.setAttribute('aria-label', d
      ? `Open the sketchbook: ${notes} note${notes === 1 ? '' : 's'} on ${d.kind === 'take' ? spineTitle(d.take) : d.tape.name}`
      : 'Sketchbook: nothing in the bar to write about yet');
    renderDock(d, w);
  }
  setInterval(() => { if (!document.hidden) renderPlaces(); }, DECK_EVERY_MS);

  // The dock is the bar: Open in it for the tape (a take's name, in the bar,
  // is its way in: lib/bar/take-keys.js), and grease marks at In and Out.
  const sit = el('a', 'icon-btn room-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'Open');
  $('np-open')?.after(sit);
  // A tape opens in the Studio, and says it goes for the tape (F4).
  let sitForTape = false;
  sit.addEventListener('click', () => { if (sitForTape) forTheTape(); });
  const grease = el('span', 'room-grease', { 'aria-hidden': 'true' }, el('i', 'room-grease-in'), el('i', 'room-grease-out'));
  $('np-scrub')?.after(grease);
  function renderDock(d, w) {
    sit.hidden = !d || d.kind === 'take';
    if (d) sit.setAttribute('href', w.href);
    sitForTape = !!d && w.forTape;
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

  // --- the places ------------------------------------------------------------------
  // Open: the take in the bar, on its page; the tape in the Studio. With
  // nothing in the bar there is nothing to open, and the shelf is pointed at.
  const focusShelf = (sel) => (room.querySelector(`${sel} .room-row button`) || room.querySelector(`${sel}`))?.focus();
  function openBar() {
    const d = inBar();
    if (!d) { focusShelf('.room-shelf-takes'); return; }
    const w = deckWords(d, barNow());
    if (w.forTape) openTheTape(); else location.href = w.href;
  }
  deckPlace.addEventListener('click', openBar);
  bookPlace.addEventListener('click', openBar);

  h.onChange(() => render());
  h.onSelected(() => { tagging.sync(); syncSpines(); });
  tagStore.subscribe(() => render());

  // --- the archive: a month's box, opened to the rack ----------------------------------
  // `month` is what's open: {title, names(), back} -- a month's box, or a
  // shelf opened as a list.
  let monthSig = '';
  function syncMonth() {
    const names = month.names();
    const sig = [...names].sort().join('|');
    if (sig === monthSig) return;
    monthSig = sig;
    h.setFilter((t) => names.has(t.name));
  }
  function openMonth(m) {
    openList({ title: m.title, back: `month:${m.key}`, names: () => inMonth(h.takes.all, m.key, h.opts()) });
  }
  function openList(m) {
    month = m;
    monthSig = '';
    crossFade(() => {
      body.classList.add('room-rack');
      rackTitle.textContent = m.title;
      syncMonth();
    }).then(() => rackBack.focus());
  }
  rackBack.addEventListener('click', () => {
    const back = month?.back || '';
    month = null;
    monthSig = '';
    crossFade(() => {
      body.classList.remove('room-rack');
      h.setFilter(null);
    }).then(() => room.querySelector(`[data-key="${CSS.escape(back)}"]`)?.focus());
  });
  // This month's takes, as today's rack: Select and Play all are there.
  takesShelf.listBtn.addEventListener('click', () => {
    const key = monthKey(Date.now());
    const n = roomShelves(h.takes.all, h.opts()).month.spines.length;
    openList({ title: `${monthName()}: ${n} take${n === 1 ? '' : 's'}`, back: 'list:takes', names: () => inMonth(h.takes.all, key, h.opts()) });
  });

  render();
  renderPlaces();
  return { render };
}
