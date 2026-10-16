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
import { spineTitle, familyCounts, familySticker, flagChips } from '../shelf.js';
import { flagRequest } from '../flags.js';
import { tagStore } from '../tags.js';
import { stripeFor } from '../objects/cassette-geom.js';
import { ReelWindow } from '../objects/reel-window.js';
import { RoomRenderer, roomScene } from './stage.js';
import { shelfTop, shelfBottom } from './art/shelf.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgReel() {
  const s = typeof document.createElementNS === 'function'
    ? document.createElementNS(SVG_NS, 'svg')
    : document.createElement('svg');
  s.setAttribute('class', 'np-reel room-deck-svg-reel');
  s.setAttribute('viewBox', '0 0 160 160');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

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
/** toneOf is which of four J-card papers a take's spine is printed on: from its name, so it keeps it. */
export function toneOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 4;
}

/**
 * deckTape is the tape's run across the deck's face: off the left reel's
 * pack, down round a guide, straight across the heads, and up onto the
 * right reel -- straight lines, as tape under tension runs.
 */
function deckTape() {
  const t = el('span', 'room-deck-tape', { 'aria-hidden': 'true' });
  t.innerHTML = '<svg viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false"><path d="M0,0 L5,36 L95,36 L100,0" fill="none" stroke="currentColor" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>';
  return t;
}

/**
 * drawTheRoom draws the room's picture and lays the shelves, the deck and
 * the sketchbook over it (lib/room/stage.js), choosing the wide view or the
 * tall one by the room's shape, and again when that changes. Where a
 * browser can't watch the room's size it draws nothing: the shelves and the
 * places are the page's markup, and work without the picture.
 */
function drawTheRoom({ room, frame, scene, twins, deco }) {
  if (typeof ResizeObserver !== 'function') return;
  try {
    const renderer = new RoomRenderer({ twins, box: frame, onError: (e) => console.error(e) });
    renderer.mount(scene, roomScene());
    deco[0].innerHTML = shelfTop();
    deco[1].innerHTML = shelfBottom();
    // Only where the room is drawn: on a phone (or with reduced data) the
    // frame is no box at all and the shelves are rows, placed by the page.
    const look = () => {
      const r = room.getBoundingClientRect();
      if (!r.width) return;
      if (getComputedStyle(frame).display === 'contents') { renderer.unplace(); return; }
      room.style.setProperty('--room-top', `${Math.max(0, r.top + scrollY)}px`);
      renderer.setView(renderer.pick(r.width, r.height));
    };
    new ResizeObserver(look).observe(room);
    look();
  } catch (e) { console.error(e); }
}
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
  // The picture of the room, drawn by lib/room/stage.js from ROOM (lib/room/
  // space.js) where there is room to draw it; decoration, hidden from a
  // screen reader.
  const scene = el('div', 'room-scene', { 'aria-hidden': 'true' });

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
  // The shelves' other cubbies -- books and a plant above, LPs below -- are
  // pictures, filled in when the room is drawn.
  const decoTop = el('div', 'room-shelf-deco room-shelf-deco-top', { 'aria-hidden': 'true' });
  const decoFoot = el('div', 'room-shelf-deco room-shelf-deco-foot', { 'aria-hidden': 'true' });
  const shelves = el('div', 'room-shelves', { role: 'group', 'aria-label': 'The shelves' },
    decoTop, filterBar, takesShelf.sec, archiveShelf.sec, decoFoot);

  // The deck: a picture of the bar -- what it holds, how far it has got. It
  // has no keys of its own (the bar is the only transport); pressing it is Open.
  const deckLcd = el('span', 'room-deck-lcd', { 'aria-hidden': 'true' });
  const deckReelL = svgReel();
  const deckReelR = svgReel();
  const deckLevels = el('span', 'room-deck-levels', { 'aria-hidden': 'true' });
  // Its face: two reels and the tape between them over the heads, then a
  // panel of meters, the counter and the keys -- hardware, all of it a picture.
  const deckArt = el('span', 'room-deck-art', { 'aria-hidden': 'true' },
    deckReelL, deckReelR, deckLevels,
    deckTape(), el('span', 'room-deck-head'),
    el('span', 'room-deck-panel', {},
      el('span', 'room-deck-vu'), el('span', 'room-deck-vu'),
      el('span', 'room-deck-buttons', {}, el('i'), el('i'), el('i'), el('i'), el('i')),
      el('span', 'room-deck-knob')),
    deckLcd);
  const deckReels = new ReelWindow({ left: deckReelL, right: deckReelR, levels: deckLevels });
  const deckPlace = el('button', 'room-place room-deck-place', { type: 'button', 'data-tip': 'room-deck' });
  const deckMeta = el('span', 'room-deck-meta');
  const deckBar = el('span', 'room-deck-progress', { 'aria-hidden': 'true' }, el('span', 'room-deck-progress-fill'));
  const deck = el('section', 'room-deck', { 'aria-label': 'The deck, a picture of the bar' }, deckArt, deckPlace, deckMeta, deckBar);

  // The sketchbook, on the side table: the chair, for what's in the bar.
  const bookPlace = el('button', 'room-place room-book-place', { type: 'button', 'data-tip': 'room-book' });
  const book = el('section', 'room-book', { 'aria-label': 'The sketchbook' }, bookPlace);

  const stage = el('div', 'room-stage', {}, deck, book);
  // The frame: the picture and the places laid over it share its box, which
  // is the view's crop of the room.
  const frame = el('div', 'room-frame', {}, scene, shelves, stage);
  const room = el('section', 'room', { 'aria-label': 'The Listening Room' }, frame);
  (tools || main.firstChild)?.after(room);
  drawTheRoom({ room, frame, scene, twins: { shelves, deck, book }, deco: [decoTop, decoFoot] });

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
    onPlay: (name, { placed, audio }) => { renderPlaces(); if (placed) flights.launch(name, { audio }); },
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
    const b = el('button', `room-cassette stripe-${stripeFor(t, tagStore.list)} room-tone-${toneOf(t.name)}${isNew ? ' is-new' : ''}${t.starred ? ' starred' : ''}`, {
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
  const barNow = () => (h.np?.snapshot ? h.np.snapshot() : readBar(document));
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

  let placesSig = '';
  let spinesSig = '';
  function renderPlaces() {
    const bar = barNow();
    const d = inBar();
    const w = deckWords(d, bar);
    const spines = JSON.stringify([h.np?.takeName ?? null, bar.playing]);
    if (spines !== spinesSig) { spinesSig = spines; syncSpines(); }
    const frac = Number(bar.frac) || 0;
    room.style.setProperty('--room-played', frac.toFixed(4));
    deckLcd.textContent = w.lcd;
    const sr = (d && d.kind === 'take' && d.take.sample_rate) || bar.sampleRate || 48000;
    const len = bar.length || Math.max(1, Math.round(((d && d.kind === 'take' && d.take.duration_seconds) || 10) * sr));
    const heard = bar.frame != null ? bar.frame : Math.round(frac * len);
    deckReels.poll({ heard, playing: !!(bar.playing && d), length: len, sampleRate: sr });
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
  h.np?.onChange?.(renderPlaces);

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
    const totalFrames = () => Math.max(1, Math.round((curTake().duration_seconds || 10) * sr()));
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
      const title = spineTitle(t);
      $('room-book-title').textContent = `Sketchbook · ${title}`;
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

  // --- the places ------------------------------------------------------------------
  // Open: the take in the bar, on its page; the tape in the Studio. With
  // nothing in the bar there is nothing to open, and the shelf is pointed at.
  const focusShelf = (sel) => (room.querySelector(`${sel} .room-row button`) || room.querySelector(`${sel}`))?.focus();
  function openBar() {
    const d = inBar();
    if (!d) { focusShelf('.room-shelf-takes'); return; }
    const w = deckWords(d, barNow());
    if (w.forTape) openTheTape();
    else if (h.openSketchbook && d.kind === 'take') h.openSketchbook(d.take.name);
    else location.href = w.href;
  }
  deckPlace.addEventListener('click', openBar);
  bookPlace.addEventListener('click', openBar);

  h.onChange(() => { render(); renderPlaces(); });
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
  return { render, renderPlaces, openSketchbook };
}
