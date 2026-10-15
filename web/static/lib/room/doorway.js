// web/static/lib/room/doorway.js
// The Listening Room seen from the doorway: the takes page under the rooms
// flag (docs/superpowers/specs/2026-10-15-listening-room-design.md).
//
// The rack is still on the page, under the room, doing everything it did:
// the list, its filter, the sheet a take opens into (lib/shelf-detail.js),
// Play all, the trash and the now-playing bar. This module draws the room
// over it and works it through the handle shelf-page.js gives (lib/room/
// mount.js), so nothing the rack does is lost and nothing is done twice.
//
// What it draws, in reading order, as a screen reader meets it: the shelves
// (tapes, this month's takes, the archive by month, records), each a list of
// buttons; then the hi-fi -- the deck, the turntable -- and the sketchbook,
// each a button; then the dock, which is the bar. The wall, the lamp, the
// window, the rug and the chair are decoration, hidden from it. Without the
// room to draw them (a phone, or reduced data asked for), the shelves are
// rows.

import { roomShelves, inMonth, monthName, monthKey, isRecord, at, filterWords, playOrder } from './shelves.js';
import { loadTape, playTape, readyToCut } from './swap.js';
import { cutTakeRecord, cutTapeRecord, takeCover, tapeCover } from './record.js';
import { sendToStudio, fmtAt } from './notes.js';
import { spineTitle, familyCounts, familySticker } from '../shelf.js';
import { tagStore } from '../tags.js';
import { stripeFor } from '../objects/cassette-geom.js';
import { ticker } from '../objects/motion.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { DomRenderer } from '../scene/dom.js';
import { Carry, recall } from './carry.js';
import { DeckDrawer, FlightDrawer, tapeStrand, vtName, HIFI_MODELS } from './hifi.js';

// audio.MaxRenderSeconds: the Pi renders an MP3 or a DAW bundle of at most
// this much. A longer take is shared from the chair, a part at a time.
const MAX_RENDER_S = 600;
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

const fmtLen = (s) => {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
};
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
/** fromOf is where a take came from, for its card. */
function fromOf(t) {
  if (t.record) return 'a record';
  if (t.origin === 'tape') return 'a mixdown';
  if (t.origin === 'phone') return 'from a phone';
  if (t.source) return 'a cut';
  return 'from KEEP';
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

  // A shelf: its plate, the list on it, and -- for takes and records -- a
  // key that opens it as today's rack, where Select and Play all are.
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
  const tapesShelf = shelf('tapes', 'TAPES');
  const takesShelf = shelf('takes', 'TAKES', 'This month’s takes as a list, to select or play');
  const takesEmpty = el('p', 'room-empty', { text: 'Nothing kept this month yet. KEEP in the Studio puts a take on this shelf.' });
  takesShelf.sec.append(takesEmpty);
  const archiveShelf = shelf('archive', 'ARCHIVE');
  const recordsShelf = shelf('records', 'RECORDS', 'The records as a list, to select or play');
  const nextOne = el('p', 'room-next', { text: 'room for the next one you cut' });
  recordsShelf.sec.append(nextOne);
  // A filter left on (the rack's, remembered on this device) says so here:
  // otherwise the shelves just look empty.
  const filterText = el('span', 'room-filtered-text');
  const filterClear = el('button', 'room-filtered-clear', { type: 'button', 'data-tip': 'room-filter-clear' }, 'Show everything');
  const filterBar = el('p', 'room-filtered', { hidden: true }, filterText, filterClear);
  filterClear.addEventListener('click', () => { h.clearFilter(); takesShelf.list.querySelector('button')?.focus(); });
  const shelves = el('div', 'room-shelves', { role: 'group', 'aria-label': 'The shelves' },
    filterBar, tapesShelf.sec, takesShelf.sec, archiveShelf.sec, recordsShelf.sec);

  // The deck: what's in the bar (a take, or the tape loaded on the Pi).
  // Over its reels, a window with a smoked door, where a take sits as a
  // cassette (R2: the scene draws the door, the reels and the tape).
  const deckLcd = el('span', 'room-deck-lcd', { 'aria-hidden': 'true' });
  const deckReels = [el('span', 'room-deck-reel'), el('span', 'room-deck-reel')];
  const deckTape = tapeStrand('room-deck-tape');
  const deckLoad = el('span', 'room-deck-load');
  const deckDoor = el('span', 'room-deck-door');
  const deckWindow = el('span', 'room-deck-window', {}, deckLoad, deckDoor);
  const deckArt = el('span', 'room-deck-art', { 'aria-hidden': 'true' },
    ...deckReels, deckLcd, el('span', 'room-deck-keys'), deckTape, deckWindow);
  const deckPlace = el('button', 'room-place room-deck-place', { type: 'button', 'data-tip': 'room-deck' });
  const deckPlay = el('button', 'room-deck-play', { type: 'button', 'aria-label': 'Play' }, '▶');
  const deckEject = el('button', 'room-deck-eject', { type: 'button', 'aria-label': 'Eject: back on the shelf', 'data-tip': 'room-deck-eject', hidden: true }, '⏏');
  const deckMeta = el('span', 'room-deck-meta');
  const deckSit = el('a', 'room-deck-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'SIT DOWN');
  const deckBar = el('span', 'room-deck-progress', { 'aria-hidden': 'true' }, el('span', 'room-deck-progress-fill'));
  const deck = el('section', 'room-deck', { 'aria-label': 'The deck' }, deckArt, deckPlace, deckMeta, deckPlay, deckEject, deckSit, deckBar);

  // The turntable: a record in the bar, and the cutting of one.
  const ttArm = el('span', 'room-tt-arm');
  const ttVinyl = el('span', 'room-tt-vinyl');
  const ttArt = el('span', 'room-tt-art', { 'aria-hidden': 'true' }, ttVinyl, ttArm);
  const ttPlace = el('button', 'room-place room-tt-place', { type: 'button', 'data-tip': 'room-turntable' });
  const ttStart = el('button', 'room-tt-start', { type: 'button', 'aria-label': 'Start the record', hidden: true }, '▶');
  const cutBar = el('progress', 'room-cut-bar', { max: '1' });
  const cutWords = el('span', 'room-cut-words', { role: 'status' });
  const cutting = el('div', 'room-cutting', { hidden: true }, cutBar, cutWords);
  const turntable = el('section', 'room-turntable', { 'aria-label': 'The turntable' }, ttArt, ttPlace, ttStart, cutting);

  // The sketchbook, on the side table: the chair, for what's on the deck.
  const bookPlace = el('button', 'room-place room-book-place', { type: 'button', 'data-tip': 'room-book' });
  const book = el('section', 'room-book', { 'aria-label': 'The sketchbook' }, bookPlace);

  const stage = el('div', 'room-stage', {}, deck, turntable, book);
  const room = el('section', 'room', { 'aria-label': 'The Listening Room' }, scene, shelves, stage);
  (tools || main.firstChild)?.after(room);

  // The archive's month, opened to the rack.
  const rackBack = el('button', 'icon-btn room-rack-back', { type: 'button' }, '‹ The room');
  const rackTitle = el('h2', 'room-rack-title');
  const rackHead = el('div', 'room-rack-head', {}, rackBack, rackTitle);
  $('takes')?.before(rackHead);

  // Asks before taking the Studio's tape: a dialog of our own, Swap or Leave.
  const askText = el('p', 'room-ask-text');
  const askNo = el('button', 'icon-btn', { value: 'no' });
  const askYes = el('button', 'icon-btn primary', { value: 'yes' });
  const ask = el('dialog', 'sheet room-ask', { 'aria-labelledby': 'room-ask-h' },
    el('form', 'sheet-inner', { method: 'dialog' },
      el('h3', '', { id: 'room-ask-h', text: 'The Studio’s tape' }),
      askText,
      el('div', 'sheet-actions', {}, askNo, askYes)));
  body.append(ask);
  const askFirst = (question, kind = 'swap') => new Promise((resolve) => {
    askText.textContent = question;
    askNo.textContent = kind === 'cut' ? 'Not now' : 'Leave it';
    askYes.textContent = kind === 'cut' ? 'Cut it' : 'Swap it';
    ask.returnValue = 'no';
    ask.addEventListener('close', () => resolve(ask.returnValue === 'yes'), { once: true });
    ask.showModal();
  });

  // A tape's card: its own dialog, as a tape has no sheet in the rack.
  const tapeName = el('h3', 'room-card-name', { id: 'room-tape-h' });
  const tapeMeta = el('p', 'room-card-meta');
  const tapePut = el('button', 'room-put', { type: 'button', value: 'put' }, 'PUT IT ON');
  const tapeStudio = el('button', 'room-studio', { type: 'button' }, 'TO THE STUDIO');
  const tapeCut = el('button', 'icon-btn room-cut', { type: 'button', 'data-tip': 'room-cut' }, 'Cut a record');
  const tapeSit = el('a', 'icon-btn room-card-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'Sit down with it ›');
  const tapeClose = el('button', 'icon-btn', { type: 'button', value: 'close' }, 'Close');
  const tapeCard = el('dialog', 'sheet room-tapecard', { 'aria-labelledby': 'room-tape-h' },
    el('div', 'sheet-inner room-card', {},
      el('div', 'room-card-head', {}, el('span', 'room-card-reel', { 'aria-hidden': 'true' }), tapeName),
      tapeMeta,
      el('div', 'room-card-keys', {}, tapePut, tapeStudio),
      el('div', 'room-card-more', {}, tapeCut, tapeSit),
      el('div', 'sheet-actions', {}, tapeClose)));
  body.append(tapeCard);
  tapeClose.addEventListener('click', () => tapeCard.close());
  let cardTape = null;

  // The take's card, at the head of its sheet (the rack's TakeDetail).
  const det = h.detail;
  const put = el('button', 'room-put', { type: 'button', 'data-tip': 'room-put' }, 'PUT IT ON');
  const toStudio = el('button', 'room-studio', { type: 'button', 'data-tip': 'room-studio' }, 'TO THE STUDIO');
  const playAll = el('button', 'icon-btn room-playall', { type: 'button', 'data-tip': 'play-all' }, '▶ Play all from here');
  const cutBtn = el('button', 'icon-btn room-cut', { type: 'button', 'data-tip': 'room-cut' }, 'Cut a record');
  const mp3 = el('a', 'icon-btn room-mp3', { download: true, 'data-tip': 'share' }, 'MP3');
  const bundle = el('a', 'icon-btn room-bundle', { download: true, 'data-tip': 'bundle' }, 'DAW bundle');
  const longNote = el('p', 'room-card-note', { hidden: true, text: 'Over ten minutes: sit down with it and pick a part to share as an MP3 or a bundle.' });
  const card = el('div', 'room-card room-takecard', { role: 'group', 'aria-label': 'Put it on' },
    el('div', 'room-card-keys', {}, put, toStudio),
    el('div', 'room-card-more', {}, playAll, cutBtn, mp3, bundle),
    longNote);
  det.el('.detail-head').before(card);
  det.el('.sheet-back').textContent = '‹ Back on the shelf';
  det.el('.sheet-back').setAttribute('aria-label', 'Back on the shelf');
  det.el('.detail-open').textContent = 'Sit down with it ›';
  let cardTake = null;

  // --- state -------------------------------------------------------------------
  let tapeList = null; // GET /api/tapes: {loaded, tapes}, or null with the tape off
  let hadTape = false; // the bar had a tape when the page opened: it follows a new one
  let month = null; // the archive's month opened to the rack: {key, title}
  let cut = null; // a record being cut: {what, frac, words}
  let lastSig = '';

  // --- shelf to deck (R2) ------------------------------------------------------
  // The deck and anything in flight are scene objects on the shared ticker
  // (lib/scene): this page writes their state, their models move them, and
  // the drawers in hifi.js only draw. When the sound starts, and what's in
  // the deck, are carry.js's, on a clock: never on a frame.
  const hifi = new Scene({ models: HIFI_MODELS });
  const renderer = new DomRenderer();
  renderer.mount(room, hifi);
  hifi.start();
  // Added once the tape list is in, so the deck is first drawn as it is
  // rather than shutting its door on whatever was loaded.
  const deckObj = new SceneObject('deck', 'deck', { door: 'open', travel: 0, playing: false, loaded: null });
  let deckReady = false;
  const deckDrawer = new DeckDrawer({ deck, window: deckWindow, load: deckLoad, door: deckDoor, reels: deckReels, tape: deckTape });
  let cardPut = null; // the key whose card closed because PUT IT ON was pressed: not put back

  const rectOf = (n) => {
    const r = n?.getBoundingClientRect?.();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };
  const slotOf = (key) => room.querySelector(`.room-shelves [data-key="${CSS.escape(key)}"]`);
  const windowRect = () => rectOf(deckWindow);
  // A spine stands on its end and turns to show its face; a face already
  // out (a phone's shelf) cross-fades instead.
  const turnOf = (n) => !!n && n.offsetHeight > n.offsetWidth;

  // What a thing shows in the deck, as the deck's state: the same object for
  // the same picture, so the deck draws it again only when it changes.
  const faces = new Map();
  function faceOf(thing) {
    if (!thing) return null;
    const take = thing.kind === 'take' ? thing.take : null;
    const key = take ? `take:${take.name}` : `tape:${thing.tape.id}`;
    const name = take ? spineTitle(take) : (thing.tape.name || 'untitled');
    const stripe = take ? stripeFor(take, tagStore.list) : tapeCover(thing.tape.id) % 4 + 1;
    const sig = `${name}|${stripe}`;
    let f = faces.get(key);
    if (!f || f.sig !== sig) faces.set(key, (f = Object.freeze({ kind: thing.kind, key, name, stripe, sig })));
    return f;
  }
  const faceOfKey = (key) => {
    if (key.startsWith('take:')) { const t = takeByName(key.slice(5)); return t ? faceOf({ kind: 'take', take: t }) : null; }
    const s = (tapeList?.tapes || []).find((x) => x.id === key.slice(5));
    return s ? faceOf({ kind: 'tape', tape: s }) : null;
  };
  // The tape still on the deck under a take (the Pi's loaded tape), as a face.
  const tapeUnder = () => {
    const id = tapeList?.loaded;
    return id ? faceOf({ kind: 'tape', tape: (tapeList.tapes || []).find((x) => x.id === id) || { id, name: 'the tape' } }) : null;
  };

  // Reduced motion, and a move with nowhere to fly: a 150 ms cross-fade. A
  // View Transition where there is one; the Web Animations API where not.
  let fading = 0; // cross-fades whose change hasn't been made yet: the deck is theirs
  function fade(update) {
    fading++;
    const run = () => { fading--; update(); hifi.step(Infinity); };
    if (!document.startViewTransition) {
      run();
      for (const n of [deckWindow, ...room.querySelectorAll('.room-out')]) n.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
      return;
    }
    const root = document.documentElement;
    root.classList.add('room-xfade');
    const vt = document.startViewTransition(run);
    vt.finished.catch(() => {}).finally(() => root.classList.remove('room-xfade'));
  }

  const carry = new Carry({
    scene: hifi,
    deck: deckObj,
    fade,
    // A phone's buzz at SEAT; a laptop has nothing to buzz.
    vibrate: (ms) => { if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms); },
    // A flight is drawn by a ghost over the room: a copy of its spine, and
    // its face. The shelf's button stays as the gap, and is the control.
    attach: (c) => {
      const id = c.obj.id;
      renderer.part(id, new FlightDrawer({ host: room, source: slotOf(c.key), face: c.face, name: vtName(c.key) }));
      return () => renderer.unpart(id);
    },
    onSettle: () => render(),
  });

  // The deck follows the bar while nothing is moving: a take that left it
  // some other way (the dock's ⏏, Play all going on) flies home all the same.
  function syncDeck(bar) {
    if (!deckReady || fading) return;
    if (carry.current && carry.current.goal !== 'out') return; // a move has the deck
    const face = faceOf(bar.deck);
    const was = deckObj.state.loaded;
    if (face === was) return;
    if (was?.kind === 'take' && !carry.current) {
      const slot = slotOf(was.key);
      if (slot && windowRect()) {
        const c = carry.eject(was.key, { from: rectOf(slot), to: windowRect(), turn: turnOf(slot), face: was, under: face });
        if (c) c.toWindow = true;
        return;
      }
    }
    deckObj.set({ loaded: face, door: face ? 'shut' : 'open' });
  }
  // What's on the deck sounds when the bar plays it. Heard at once, from ▶'s
  // own class, so a stop coasts the reels as it happens.
  function syncPlaying(bar = inBar()) {
    const playing = !!$('np-play')?.classList.contains('playing') && !!bar.deck && bar.barKind === bar.deck.kind;
    deckObj.set({ playing });
  }
  const npPlay = $('np-play');
  if (npPlay) new MutationObserver(() => syncPlaying()).observe(npPlay, { attributes: true, attributeFilter: ['class'] });
  // The door drops the window's height.
  new ResizeObserver(() => { deckObj.set({ travel: deckWindow.clientHeight }); remeasure(); }).observe(deckWindow);

  // A flight follows its slot and the deck as the page scrolls or a shelf
  // row is swiped.
  function remeasure() {
    const c = carry.current;
    if (!c) return;
    const patch = {};
    const from = rectOf(slotOf(c.key));
    if (from) patch.from = from;
    if (c.toWindow) { const to = windowRect(); if (to) patch.to = to; }
    c.obj.set(patch);
  }
  addEventListener('scroll', remeasure, { capture: true, passive: true });
  addEventListener('resize', remeasure);

  // Off the shelf: PICK and PULL, held while its card is open.
  function pickUp(key, face) {
    const slot = slotOf(key);
    const from = rectOf(slot);
    if (!from || !face) return;
    carry.pick(key, { from, turn: turnOf(slot), face });
  }
  // On a phone the deck may be scrolled away: bring it into view for the flight.
  function showDeck() {
    const r = deckWindow.getBoundingClientRect();
    const top = document.querySelector('header.appbar')?.getBoundingClientRect().bottom || 0;
    if (r.height && (r.top < top || r.bottom > innerHeight)) deck.scrollIntoView({ block: 'nearest', behavior: ticker.reduced ? 'auto' : 'smooth' });
  }

  // The chair's ⏏, a page ago: it flies home from where the chair's deck
  // was, once its slot is on a shelf.
  let arrival = recall();
  const arrivalUntil = Date.now() + 3000;
  function tryArrive() {
    if (!arrival || arrival.waiting) return;
    if (Date.now() > arrivalUntil) { arrival = null; return; }
    if (!rectOf(slotOf(arrival.key)) || !faceOfKey(arrival.key)) return;
    // A page that has just opened is busy drawing its rack: fly once it has
    // a moment, or the first half of the flight is lost to one long frame.
    arrival.waiting = true;
    const go = () => {
      const a = arrival;
      arrival = null;
      const slot = slotOf(a.key), face = faceOfKey(a.key);
      if (!rectOf(slot) || !face) return;
      carry.arrive(a.key, { from: rectOf(slot), to: a.rect, turn: turnOf(slot), vanish: face.kind === 'tape', face });
      render();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 500 }); else setTimeout(go, 150);
  }

  Promise.resolve(h.tapes).then((list) => {
    tapeList = list;
    hadTape = !!(list && list.loaded);
    const d = inBar().deck;
    const face = faceOf(d);
    deckObj.set({ loaded: face, door: face ? 'shut' : 'open', travel: deckWindow.clientHeight });
    hifi.add(deckObj);
    renderer.part('deck', deckDrawer);
    deckReady = true;
    syncPlaying();
    render();
  });
  async function refreshTapes() {
    try {
      const res = await fetch('/api/tapes', { cache: 'no-store' });
      tapeList = res.ok ? await res.json() : null;
    } catch { /* the next look asks again */ }
    render();
    return tapeList;
  }
  setInterval(() => { if (!document.hidden && tapeList) refreshTapes(); }, TAPES_EVERY_MS);

  const takeByName = (name) => h.takes.all.find((t) => t.name === name) || null;
  // What's in the bar: a take, a record (the turntable's), or the tape.
  function inBar() {
    const name = h.np?.takeName;
    const t = name ? takeByName(name) : null;
    const loaded = tapeList && tapeList.loaded ? (tapeList.tapes || []).find((x) => x.id === tapeList.loaded) || { id: tapeList.loaded, name: 'the tape' } : null;
    return {
      deck: t && !isRecord(t) ? { kind: 'take', take: t } : loaded ? { kind: 'tape', tape: loaded } : null,
      table: t && isRecord(t) ? t : null,
      // The bar shows the tape when it holds no take.
      barKind: t ? (isRecord(t) ? 'record' : 'take') : loaded ? 'tape' : null,
    };
  }
  const chairFor = (thing) => (thing.kind === 'tape'
    ? `/wave.html?tape=${encodeURIComponent(thing.tape.id)}`
    : `/wave.html?file=${encodeURIComponent(thing.take.name)}`);

  // --- the shelves ---------------------------------------------------------------
  function spineButton(t, { isNew = false, members = [], onDeck = false } = {}) {
    const name = spineTitle(t);
    const fam = familySticker(familyCounts(members));
    const pulled = h.sheetOpen() === t.name;
    // Off the shelf, in the air or held out (R2): its gap stays open.
    const out = carry.holds(`take:${t.name}`);
    const words = [name, whenOf(t), fmtLen(t.duration_seconds), t.starred ? 'starred' : '', isNew ? 'new' : '',
      fam ? fam.replace('✂', 'cuts ').replace('MIX ×', 'mixes ') : '', onDeck ? 'on the deck' : ''].filter(Boolean).join(', ');
    const b = el('button', `room-cassette stripe-${stripeFor(t, tagStore.list)}${isNew ? ' is-new' : ''}${pulled ? ' pulled' : ''}${onDeck ? ' on-deck' : ''}${out ? ' room-out' : ''}${t.starred ? ' starred' : ''}`, {
      type: 'button', 'data-key': `take:${t.name}`, 'aria-label': words, 'aria-haspopup': 'dialog', 'aria-expanded': String(pulled),
    },
    el('span', 'room-cassette-stripe', { 'aria-hidden': 'true' }),
    el('span', 'room-cassette-name', { 'aria-hidden': 'true', text: name }),
    el('span', 'room-cassette-when', { 'aria-hidden': 'true', text: `${whenOf(t)} · ${fmtLen(t.duration_seconds)}` }),
    isNew ? el('span', 'room-new', { 'aria-hidden': 'true', text: 'NEW' }) : null,
    fam ? el('span', 'room-fam', { 'aria-hidden': 'true', text: fam }) : null);
    b.addEventListener('click', () => pickTake(t.name));
    return el('li', '', {}, b);
  }
  function tapeButton(s) {
    const len = fmtLen(s.seconds);
    const out = carry.holds(`tape:${s.id}`);
    const b = el('button', `room-reel box-${tapeCover(s.id) % 4 + 1}${s.loaded ? ' loaded' : ''}${out ? ' room-out' : ''}`, {
      type: 'button', 'data-key': `tape:${s.id}`, 'aria-haspopup': 'dialog',
      'aria-label': `${s.name || 'untitled'}, a tape, ${len}${s.bpm ? `, ${Math.round(s.bpm)} BPM` : ''}${s.loaded ? ', on the Studio’s deck' : ''}`,
    }, el('span', 'room-reel-label', { 'aria-hidden': 'true', text: s.name || 'untitled' }));
    b.addEventListener('click', () => openTape(s));
    return el('li', '', {}, b);
  }
  function boxButton(m) {
    const b = el('button', 'room-box', { type: 'button', 'data-key': `month:${m.key}`, 'aria-label': `${m.title}. Open the box` },
      el('span', 'room-box-label', { 'aria-hidden': 'true', text: m.plate }), el('span', 'room-box-hole', { 'aria-hidden': 'true' }));
    b.addEventListener('click', () => openMonth(m));
    return el('li', '', {}, b);
  }
  function sleeveButton(t, onTable) {
    const name = spineTitle(t);
    const cover = t.record && t.record.cover;
    const pulled = h.sheetOpen() === t.name;
    const b = el('button', `room-sleeve cover-${cover || 0}${pulled ? ' pulled' : ''}${onTable ? ' on-table' : ''}`, {
      type: 'button', 'data-key': `record:${t.name}`, 'aria-haspopup': 'dialog', 'aria-expanded': String(pulled),
      'aria-label': `${name}, a record, side ${t.record.side || 'A'}, ${fmtLen(t.duration_seconds)}${onTable ? ', on the turntable' : ''}`,
    }, el('span', 'room-sleeve-disc', { 'aria-hidden': 'true' }), el('span', 'room-sleeve-name', { 'aria-hidden': 'true', text: name }));
    b.addEventListener('click', () => pickTake(t.name));
    return el('li', '', {}, b);
  }

  function render() {
    const now = Date.now();
    const s = roomShelves(h.takes.all, tapeList, h.opts(), now);
    const bar = inBar();
    const onDeck = bar.deck?.kind === 'take' ? bar.deck.take.name : null;
    const onTable = bar.table?.name || null;
    // A poll that changes nothing must not rebuild what's under a finger.
    const sig = JSON.stringify([
      s.tapes?.map((t) => [t.id, t.name, t.loaded, t.seconds]),
      s.month.spines.map((x) => [x.take.name, x.take.label, x.take.starred, x.take.tag, x.isNew, x.members.length, x.take.duration_seconds]),
      s.archive.map((b) => b.plate), s.records.map((t) => [t.name, t.label, t.record.cover]),
      h.sheetOpen(), onDeck, onTable, tagStore.list.map((g) => `${g.id}:${g.color}`), monthName(now),
      filterWords(h.opts(), tagStore.list), carry.current?.key,
    ]);
    renderPlaces(bar);
    if (sig === lastSig) { tryArrive(); return; }
    lastSig = sig;
    const focused = document.activeElement?.closest?.('.room-shelves [data-key]')?.dataset.key;

    tapesShelf.sec.hidden = !s.tapes;
    if (s.tapes) {
      tapesShelf.h3.textContent = `TAPES · ${s.tapes.length}`;
      tapesShelf.list.replaceChildren(...s.tapes.map(tapeButton));
    }
    takesShelf.h3.textContent = `TAKES · ${monthName(now)} · ${s.month.spines.length}`;
    takesShelf.list.replaceChildren(...s.month.spines.map((x) => spineButton(x.take, { isNew: x.isNew, members: x.members, onDeck: x.take.name === onDeck })));
    const filtered = filterWords(h.opts(), tagStore.list);
    filterBar.hidden = !filtered.length;
    filterText.textContent = `Showing only takes ${filtered.join(', ')}. `;
    takesEmpty.hidden = s.month.spines.length > 0;
    takesEmpty.textContent = filtered.length
      ? 'No takes this month match. Show everything to see them all.'
      : 'Nothing kept this month yet. KEEP in the Studio puts a take on this shelf.';
    if (takesShelf.listBtn) takesShelf.listBtn.hidden = !s.month.spines.length;
    if (recordsShelf.listBtn) recordsShelf.listBtn.hidden = !s.records.length;
    const archived = s.archive.reduce((n, b) => n + b.count, 0);
    archiveShelf.sec.hidden = !s.archive.length;
    archiveShelf.h3.textContent = `ARCHIVE · ${archived}`;
    archiveShelf.list.replaceChildren(...s.archive.map(boxButton));
    recordsShelf.h3.textContent = `RECORDS · ${s.records.length}`;
    recordsShelf.list.replaceChildren(...s.records.map((t) => sleeveButton(t, t.name === onTable)));
    if (focused) room.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
    if (month) syncMonth();
    tryArrive();
  }

  // The hi-fi and the dock follow the bar, which has no events of its own:
  // a look twice a second, drawing only what changed.
  let placesSig = '';
  function renderPlaces(bar = inBar()) {
    syncDeck(bar);
    syncPlaying(bar);
    deckEject.hidden = bar.deck?.kind !== 'take';
    const playBtn = $('np-play');
    const playing = !!playBtn?.classList.contains('playing');
    const scrub = $('np-scrub');
    const max = Number(scrub?.getAttribute('aria-valuemax')) || 0;
    const frac = max > 0 ? Math.max(0, Math.min(1, Number(scrub.getAttribute('aria-valuenow')) / max)) : 0;
    const pos = $('position')?.textContent || '';
    room.style.setProperty('--room-played', frac.toFixed(4));
    deckLcd.textContent = bar.deck ? pos || '00:00' : '--:--';
    const sig = JSON.stringify([bar.deck && (bar.deck.take?.name || bar.deck.tape?.id), bar.deck?.tape?.name, bar.deck?.take?.label, bar.table?.name, bar.barKind, playing, cut && [cut.words, Math.round((cut.frac ?? -1) * 100)]]);
    if (sig === placesSig) return;
    placesSig = sig;
    const d = bar.deck;
    const dName = d ? (d.kind === 'take' ? spineTitle(d.take) : d.tape.name) : '';
    deck.classList.toggle('empty', !d);
    deck.classList.toggle('playing', playing && bar.barKind !== 'record' && !!d);
    deckPlace.replaceChildren(el('span', 'room-led', { 'aria-hidden': 'true' }), d ? `On the deck: ${dName}` : 'The deck · empty');
    deckPlace.setAttribute('aria-label', d ? `On the deck: ${dName}, a ${d.kind}. Sit down with it` : 'The deck is empty: pick something off the shelf');
    deckMeta.textContent = d ? `${d.kind}${bar.barKind === d.kind ? '' : ' · not playing'}` : 'pick something off the shelf';
    deckSit.hidden = !d;
    if (d) deckSit.href = chairFor(d);
    // ▶ here is the bar's own, when the bar holds what's on the deck.
    deckPlay.hidden = !d || bar.barKind !== d.kind;
    deckPlay.textContent = playing ? '❚❚' : '▶';
    deckPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const t = bar.table;
    turntable.classList.toggle('empty', !t);
    turntable.classList.toggle('playing', playing && !!t && bar.barKind === 'record');
    turntable.style.setProperty('--room-cover', t ? `var(--stripe-${t.record.cover || 8})` : 'var(--room-vinyl-label)');
    ttPlace.replaceChildren(t ? `Turntable: ${spineTitle(t)}` : cut ? 'Turntable · cutting' : 'Turntable · empty');
    ttPlace.setAttribute('aria-label', t ? `On the turntable: ${spineTitle(t)}. Sit down with it` : 'The turntable is empty: pick a record off the shelf');
    ttStart.hidden = !t;
    ttStart.textContent = playing && t ? '■' : '▶';
    ttStart.setAttribute('aria-label', playing && t ? 'Stop the record' : 'Start the record');
    cutting.hidden = !cut;
    if (cut) {
      if (cut.frac == null) cutBar.removeAttribute('value'); else cutBar.value = cut.frac;
      cutWords.textContent = `${cut.what}: ${cut.words}`;
    }
    // The sketchbook: the notes of the take on the deck.
    const bt = d && d.kind === 'take' ? d.take : t;
    const notes = bt ? (bt.flags || []).length : 0;
    const latest = bt ? [...(bt.flags || [])].filter((f) => f.label).sort((a, b) => b.frame - a.frame)[0] : null;
    bookPlace.replaceChildren(
      el('span', 'room-book-word', { text: 'Sketchbook' }),
      el('span', 'room-book-latest', { text: d && d.kind === 'tape' ? `${(d.tape.name || 'the tape')}` : latest ? `${fmtAt(latest.frame, bt.sample_rate || 48000)} · ${latest.label}` : bt ? 'no notes yet' : 'nothing on the deck' }),
      el('span', 'room-book-n', { 'aria-hidden': 'true', text: String(notes) }));
    bookPlace.setAttribute('aria-label', d || t
      ? `Sketchbook: ${notes} note${notes === 1 ? '' : 's'} on ${d ? dName : spineTitle(t)}. Sit down with it`
      : 'Sketchbook: nothing on the deck to write about yet');
    renderDock(bar);
  }
  setInterval(() => { if (!document.hidden) renderPlaces(); }, DECK_EVERY_MS);

  // The dock is the bar: SIT DOWN in it, and grease marks at In and Out.
  const sit = el('a', 'icon-btn room-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'SIT DOWN');
  $('np-open')?.after(sit);
  const grease = el('span', 'room-grease', { 'aria-hidden': 'true' }, el('i', 'room-grease-in'), el('i', 'room-grease-out'));
  $('np-scrub')?.after(grease);
  function renderDock(bar) {
    const thing = bar.barKind === 'tape' ? bar.deck : bar.barKind === 'take' ? bar.deck : bar.table ? { kind: 'take', take: bar.table } : null;
    sit.hidden = !thing;
    if (thing) sit.href = chairFor(thing);
    const t = thing && thing.kind === 'take' ? thing.take : null;
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
  const focusShelf = (sel) => (room.querySelector(`${sel} .room-row button`) || room.querySelector(`${sel}`))?.focus();
  deckPlace.addEventListener('click', () => {
    const d = inBar().deck;
    if (d) location.href = chairFor(d);
    else focusShelf('.room-shelf-takes');
  });
  deckPlay.addEventListener('click', () => $('np-play')?.click());
  ttPlace.addEventListener('click', () => {
    const t = inBar().table;
    if (t) location.href = chairFor({ kind: 'take', take: t });
    else focusShelf('.room-shelf-records');
  });
  ttStart.addEventListener('click', () => $('np-play')?.click());
  bookPlace.addEventListener('click', () => {
    const b = inBar();
    const thing = b.deck || (b.table && { kind: 'take', take: b.table });
    if (thing) location.href = chairFor(thing);
    else focusShelf('.room-shelf-takes');
  });

  // --- a take off the shelf ------------------------------------------------------
  // Pulled out: its sheet, with the card at its head. Its player is fetched
  // now, so PUT IT ON plays inside the press that asked.
  function pickTake(name) {
    // Off the shelf (R2): it lifts and slides out while its card is open. A
    // record keeps P5's pull, and one already on the deck is where it is.
    const t = takeByName(name);
    if (t && !isRecord(t) && inBar().deck?.take?.name !== name) pickUp(`take:${name}`, faceOf({ kind: 'take', take: t }));
    h.pick(name);
    h.openSheet(name);
    h.takes.player(name).catch(() => {});
  }
  h.onShow((t) => {
    cardTake = t;
    if (!t) return;
    const rec = isRecord(t);
    put.setAttribute('aria-label', rec ? 'Put it on the turntable' : 'Put it on the deck');
    const sr = t.sample_rate || 48000;
    const frames = Math.floor((t.duration_seconds || 0) * sr);
    const short = (t.duration_seconds || 0) <= MAX_RENDER_S;
    mp3.hidden = bundle.hidden = !short;
    longNote.hidden = short;
    if (short) {
      const q = `file=${encodeURIComponent(t.name)}&from=0&to=${frames}`;
      mp3.href = `/api/render?${q}`;
      bundle.href = `/api/bundle?${q}`;
    }
    cutBtn.hidden = rec;
    cutBtn.disabled = !!cut;
    playAll.textContent = h.playAll.running() ? '■ Stop Play all' : '▶ Play all from here';
  });
  h.onClosed((from) => {
    // Closed without PUT IT ON: back in its slot.
    const key = `take:${from}`;
    if (cardPut !== key) carry.putBack(key);
    room.querySelector(`[data-key="take:${CSS.escape(from)}"], [data-key="record:${CSS.escape(from)}"]`)?.focus();
  });
  h.onChange(() => { render(); if (cardTake) playAll.textContent = h.playAll.running() ? '■ Stop Play all' : '▶ Play all from here'; });
  tagStore.subscribe(() => render());

  put.addEventListener('click', () => { if (cardTake) putOnTake(cardTake.name); });
  toStudio.addEventListener('click', () => { if (cardTake) takeToStudio(cardTake); });
  playAll.addEventListener('click', () => {
    if (h.playAll.running()) { h.playAll.stop(); return; }
    if (!cardTake) return;
    const name = cardTake.name;
    if (h.sheetOpen()) h.closeSheet();
    // The shelf it stands on, in the shelf's order: not the rack's, which
    // would go on into the records and older months.
    h.playAll.from(name, playOrder(roomShelves(h.takes.all, tapeList, h.opts()), name));
  });
  cutBtn.addEventListener('click', () => { if (cardTake) cutFromTake(cardTake); });

  async function putOnTake(name) {
    const t = takeByName(name);
    const p = t && await h.takes.player(name);
    if (!p) { toast('Still encoding — a moment', 'warn'); return; }
    const key = `take:${name}`;
    cardPut = key;
    try { if (h.sheetOpen()) h.closeSheet(); } finally { cardPut = null; }
    if (isRecord(t)) {
      // A record goes on the turntable, as P5 put it there (R7 moves it).
      crossFade(() => { h.np.loadTake(t, p); render(); });
      if (p.audio.paused) await p.toggle();
      return;
    }
    // The deck takes one thing: another take on it goes home now, and its
    // sound stops with it.
    const was = inBar().deck;
    if (was?.kind === 'take' && was.take.name !== name) {
      h.np.backToTape();
      deckObj.set({ loaded: tapeUnder(), door: 'open' });
    }
    showDeck();
    const slot = slotOf(key);
    const c = carry.put(key, {
      from: rectOf(slot), to: windowRect(), turn: turnOf(slot), face: faceOf({ kind: 'take', take: t }),
      // SEAT, on the clock: the take goes in the bar and plays.
      onSeat: () => { h.np.loadTake(t, p); if (p.audio.paused) p.toggle(); },
    });
    if (c) c.toWindow = true;
    render();
  }

  // ⏏ on the deck: the sound stops at once, then it goes home.
  function ejectTake() {
    const d = inBar().deck;
    if (d?.kind !== 'take') return;
    const key = `take:${d.take.name}`;
    const slot = slotOf(key);
    const c = carry.eject(key, {
      from: rectOf(slot), to: windowRect(), turn: turnOf(slot), face: faceOf(d), under: tapeUnder(),
      onStop: () => h.np.backToTape({ byHand: true }),
    });
    if (c) c.toWindow = true;
    render();
  }
  deckEject.addEventListener('click', () => { ejectTake(); deckPlace.focus(); });
  // The dock's ⏏ has put the tape back by the time this hears it.
  $('np-eject')?.addEventListener('click', () => renderPlaces());

  async function takeToStudio(t) {
    const sr = t.sample_rate || 48000;
    const span = t.trim ? { from: t.trim.start_frame, to: t.trim.end_frame } : { from: 0, to: Math.floor((t.duration_seconds || 0) * sr) };
    try {
      location.href = await sendToStudio(t.name, span);
    } catch (e) {
      toast(`Couldn’t take it to the Studio: ${e.message}`, 'bad');
    }
  }

  // --- a tape off the shelf --------------------------------------------------------
  function openTape(s) {
    cardTape = s;
    pickUp(`tape:${s.id}`, faceOf({ kind: 'tape', tape: s }));
    render();
    tapeName.textContent = s.name || 'untitled';
    tapeMeta.textContent = [fmtLen(s.seconds), s.bpm ? `${Math.round(s.bpm)} BPM` : '', `${s.clips || 0} clip${s.clips === 1 ? '' : 's'}`, s.loaded ? 'on the Studio’s deck' : ''].filter(Boolean).join(' · ');
    tapeSit.href = `/wave.html?tape=${encodeURIComponent(s.id)}`;
    tapeCut.disabled = !!cut || !s.clips;
    tapeCard.showModal();
    tapePut.focus();
  }
  tapeCard.addEventListener('close', () => {
    if (!cardTape) return;
    const key = `tape:${cardTape.id}`;
    if (cardPut === key) cardPut = null; else carry.putBack(key);
    room.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  });
  tapePut.addEventListener('click', async () => {
    const s = cardTape;
    if (!s) return;
    const key = `tape:${s.id}`;
    cardPut = key;
    tapeCard.close();
    try {
      // Loaded first, asking if the Studio's is busy; the reel box waits,
      // pulled out. ▶ goes to the Pi at SEAT, as the box goes in.
      const r = await loadTape(s.id, { ask: askFirst });
      if (!r.loaded) { carry.putBack(key); return; }
      showDeck();
      const slot = slotOf(key);
      const c = carry.put(key, {
        from: rectOf(slot), to: windowRect(), turn: turnOf(slot), vanish: true, face: faceOf({ kind: 'tape', tape: s }),
        onSeat: () => {
          // On the deck from now, as far as this page is concerned.
          if (tapeList) tapeList = { ...tapeList, loaded: s.id };
          playTape(s.id, r).then((played) => {
            if (r.already && !played) toast(`${s.name} is on the Studio’s deck already, and in use there`, 'warn');
          }, (e) => toast(`Couldn’t put it on: ${e.message}`, 'bad'));
          // The bar follows a tape loaded since, once it has one.
          if (hadTape) h.np.backToTape({ byHand: true });
        },
        onLand: async () => {
          await refreshTapes();
          // A page that opened with no tape has none in its bar: it opens
          // again with it.
          if (!hadTape) location.replace('/takes.html');
        },
      });
      if (c) c.toWindow = true;
      render();
    } catch (e) {
      carry.putBack(key);
      toast(`Couldn’t put it on: ${e.message}`, 'bad');
    }
  });
  tapeStudio.addEventListener('click', async () => {
    const s = cardTape;
    if (!s) return;
    tapeCard.close();
    try {
      const r = await loadTape(s.id, { ask: askFirst });
      if (r.loaded) location.href = '/tape.html';
    } catch (e) {
      toast(`Couldn’t load it in the Studio: ${e.message}`, 'bad');
    }
  });
  tapeCut.addEventListener('click', () => { const s = cardTape; tapeCard.close(); if (s) cutFromTape(s); });

  // --- cutting a record --------------------------------------------------------------
  function setCut(next) { cut = next; placesSig = ''; renderPlaces(); }
  async function cutFromTake(t) {
    if (cut) return;
    if (h.sheetOpen()) h.closeSheet();
    const what = spineTitle(t);
    setCut({ what, frac: null, words: 'cutting' });
    try {
      const r = await cutTakeRecord(t, { tags: tagStore.list });
      toast(`${what} is on the Records shelf${r.cut ? ' (its selection, as a cut)' : ''}`, 'ok');
      await h.poll();
    } catch (e) {
      toast(`The record wasn’t cut: ${e.message}`, 'bad');
    } finally {
      setCut(null);
      render();
    }
  }
  async function cutFromTape(s) {
    if (cut) return;
    try {
      if (!(await readyToCut(s.id, { ask: askFirst }))) return;
    } catch (e) {
      toast(`The record wasn’t cut: ${e.message}`, 'bad');
      return;
    }
    const what = s.name || 'the tape';
    setCut({ what, frac: 0, words: 'starting' });
    toast(`Cutting ${what}: the tape plays once on the Pi, then it’s saved. ■ in the dock stops it.`, 'ok', { ms: 6000 });
    try {
      await cutTapeRecord(s.id, { onProgress: (p) => setCut({ what, frac: p.state === 'playing' ? p.frac : null, words: p.words }) });
      toast(`${what} is on the Records shelf`, 'ok');
      await h.poll();
    } catch (e) {
      toast(`The record wasn’t cut: ${e.message}`, 'bad');
    } finally {
      setCut(null);
      refreshTapes();
    }
  }

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
  // This month's takes, and the records, as today's rack: Select is there.
  takesShelf.listBtn.addEventListener('click', () => {
    const key = monthKey(Date.now());
    const n = roomShelves(h.takes.all, tapeList, h.opts()).month.spines.length;
    openList({ title: `${monthName()}: ${n} take${n === 1 ? '' : 's'}`, back: 'list:takes', names: () => inMonth(h.takes.all, key, h.opts()) });
  });
  recordsShelf.listBtn.addEventListener('click', () => {
    const records = () => new Set(roomShelves(h.takes.all, tapeList, h.opts()).records.map((t) => t.name));
    openList({ title: `Records: ${records().size}`, back: 'list:records', names: records });
  });

  render();
  return { render };
}
