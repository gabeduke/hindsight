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
// (tapes, this month's takes, the archive by month), each a list of
// buttons; then the hi-fi -- the deck -- and the sketchbook, each a button; then the dock, which is the bar. The wall, the lamp, the
// window, the rug and the chair are decoration, hidden from it. Without the
// room to draw them (a phone, or reduced data asked for), the shelves are
// rows.

import { roomShelves, inMonth, monthName, monthKey, at, filterWords, playOrder } from './shelves.js';
import { putTapeOn, loadTape } from './swap.js';
import { sendToStudio, fmtAt } from './notes.js';
import { takeGrabSpan, takeGrabLabel, takeStartN, loadedLoopBars, readPick, playheadFor } from '../rooms/grab.js';
import { spineTitle, familyCounts, familySticker } from '../shelf.js';
import { tagStore } from '../tags.js';
import { stripeFor, stripeOf } from '../objects/cassette-geom.js';

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
  const tapesShelf = shelf('tapes', 'TAPES');
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
    filterBar, tapesShelf.sec, takesShelf.sec, archiveShelf.sec);

  // The deck: what's in the bar (a take, or the tape loaded on the Pi).
  const deckLcd = el('span', 'room-deck-lcd', { 'aria-hidden': 'true' });
  const deckArt = el('span', 'room-deck-art', { 'aria-hidden': 'true' },
    el('span', 'room-deck-reel'), el('span', 'room-deck-reel'), deckLcd, el('span', 'room-deck-keys'));
  const deckPlace = el('button', 'room-place room-deck-place', { type: 'button', 'data-tip': 'room-deck' });
  const deckPlay = el('button', 'room-deck-play', { type: 'button', 'aria-label': 'Play' }, '▶');
  const deckMeta = el('span', 'room-deck-meta');
  const deckSit = el('a', 'room-deck-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'SIT DOWN');
  const deckBar = el('span', 'room-deck-progress', { 'aria-hidden': 'true' }, el('span', 'room-deck-progress-fill'));
  const deck = el('section', 'room-deck', { 'aria-label': 'The deck' }, deckArt, deckPlace, deckMeta, deckPlay, deckSit, deckBar);

  // The sketchbook, on the side table: the chair, for what's on the deck.
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
  const askFirst = (question) => new Promise((resolve) => {
    askText.textContent = question;
    askNo.textContent = 'Leave it';
    askYes.textContent = 'Swap it';
    ask.returnValue = 'no';
    ask.addEventListener('close', () => resolve(ask.returnValue === 'yes'), { once: true });
    ask.showModal();
  });

  // A tape's card: its own dialog, as a tape has no sheet in the rack.
  const tapeName = el('h3', 'room-card-name', { id: 'room-tape-h' });
  const tapeMeta = el('p', 'room-card-meta');
  const tapePut = el('button', 'room-put', { type: 'button', value: 'put' }, 'PUT IT ON');
  const tapeStudio = el('button', 'room-studio', { type: 'button' }, 'TO THE STUDIO');
  const tapeSit = el('a', 'icon-btn room-card-sit', { href: '/wave.html', 'data-tip': 'room-sit' }, 'Sit down with it ›');
  const tapeClose = el('button', 'icon-btn', { type: 'button', value: 'close' }, 'Close');
  const tapeCard = el('dialog', 'sheet room-tapecard', { 'aria-labelledby': 'room-tape-h' },
    el('div', 'sheet-inner room-card', {},
      el('div', 'room-card-head', {}, el('span', 'room-card-reel', { 'aria-hidden': 'true' }), tapeName),
      tapeMeta,
      el('div', 'room-card-keys', {}, tapePut, tapeStudio),
      el('div', 'room-card-more', {}, tapeSit),
      el('div', 'sheet-actions', {}, tapeClose)));
  body.append(tapeCard);
  tapeClose.addEventListener('click', () => tapeCard.close());
  let cardTape = null;

  // The take's card, at the head of its sheet (the rack's TakeDetail).
  const det = h.detail;
  const put = el('button', 'room-put', { type: 'button', 'data-tip': 'room-put' }, 'PUT IT ON');
  // GRAB: the last N bars before the playhead, N the tape's loop in bars
  // (lib/rooms/grab.js); a take's saved selection, if it has one, instead.
  const toStudio = el('button', 'room-studio', { type: 'button', 'data-tip': 'room-studio' }, 'GRAB');
  const playAll = el('button', 'icon-btn room-playall', { type: 'button', 'data-tip': 'play-all' }, '▶ Play all from here');
  const mp3 = el('a', 'icon-btn room-mp3', { download: true, 'data-tip': 'share' }, 'MP3');
  const bundle = el('a', 'icon-btn room-bundle', { download: true, 'data-tip': 'bundle' }, 'DAW bundle');
  const longNote = el('p', 'room-card-note', { hidden: true, text: 'Over ten minutes: sit down with it and pick a part to share as an MP3 or a bundle.' });
  const card = el('div', 'room-card room-takecard', { role: 'group', 'aria-label': 'Put it on' },
    el('div', 'room-card-keys', {}, put, toStudio),
    el('div', 'room-card-more', {}, playAll, mp3, bundle),
    longNote);
  det.el('.detail-head').before(card);
  det.el('.sheet-back').textContent = '‹ Back on the shelf';
  det.el('.sheet-back').setAttribute('aria-label', 'Back on the shelf');
  det.el('.detail-open').textContent = 'Sit down with it ›';
  let cardTake = null;
  let grabN = takeStartN({ stored: readPick() }); // GRAB's N: the loop's bars, once the Pi has said
  const paintGrab = () => {
    if (!cardTake) return;
    const words = takeGrabLabel({ n: grabN, bpm: cardTake.bpm, selection: !!cardTake.trim });
    if (toStudio.textContent !== words) toStudio.textContent = words;
    toStudio.setAttribute('aria-label', `${words} into the Studio’s buffer`);
  };

  // --- state -------------------------------------------------------------------
  let tapeList = null; // GET /api/tapes: {loaded, tapes}, or null with the tape off
  let hadTape = false; // the bar had a tape when the page opened: it follows a new one
  let month = null; // the archive's month opened to the rack: {key, title}
  let lastSig = '';

  Promise.resolve(h.tapes).then((list) => {
    tapeList = list;
    hadTape = !!(list && list.loaded);
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
  // What's in the bar: a take, or the tape.
  function inBar() {
    const name = h.np?.takeName;
    const t = name ? takeByName(name) : null;
    const loaded = tapeList && tapeList.loaded ? (tapeList.tapes || []).find((x) => x.id === tapeList.loaded) || { id: tapeList.loaded, name: 'the tape' } : null;
    return {
      deck: t ? { kind: 'take', take: t } : loaded ? { kind: 'tape', tape: loaded } : null,
      // The bar shows the tape when it holds no take.
      barKind: t ? 'take' : loaded ? 'tape' : null,
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
    const words = [name, whenOf(t), fmtLen(t.duration_seconds), t.starred ? 'starred' : '', isNew ? 'new' : '',
      fam ? fam.replace('✂', 'cuts ').replace('MIX ×', 'mixes ') : '', onDeck ? 'on the deck' : ''].filter(Boolean).join(', ');
    const b = el('button', `room-cassette stripe-${stripeFor(t, tagStore.list)}${isNew ? ' is-new' : ''}${pulled ? ' pulled' : ''}${onDeck ? ' on-deck' : ''}${t.starred ? ' starred' : ''}`, {
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
    const b = el('button', `room-reel box-${stripeOf(String(s.id || '')) % 4 + 1}${s.loaded ? ' loaded' : ''}`, {
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
  function render() {
    const now = Date.now();
    const s = roomShelves(h.takes.all, tapeList, h.opts(), now);
    const bar = inBar();
    const onDeck = bar.deck?.kind === 'take' ? bar.deck.take.name : null;
    // A poll that changes nothing must not rebuild what's under a finger.
    const sig = JSON.stringify([
      s.tapes?.map((t) => [t.id, t.name, t.loaded, t.seconds]),
      s.month.spines.map((x) => [x.take.name, x.take.label, x.take.starred, x.take.tag, x.isNew, x.members.length, x.take.duration_seconds]),
      s.archive.map((b) => b.plate),
      h.sheetOpen(), onDeck, tagStore.list.map((g) => `${g.id}:${g.color}`), monthName(now),
      filterWords(h.opts(), tagStore.list),
    ]);
    renderPlaces(bar);
    if (sig === lastSig) return;
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
    const archived = s.archive.reduce((n, b) => n + b.count, 0);
    archiveShelf.sec.hidden = !s.archive.length;
    archiveShelf.h3.textContent = `ARCHIVE · ${archived}`;
    archiveShelf.list.replaceChildren(...s.archive.map(boxButton));
    if (focused) room.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
    if (month) syncMonth();
  }

  // The hi-fi and the dock follow the bar, which has no events of its own:
  // a look twice a second, drawing only what changed.
  let placesSig = '';
  function renderPlaces(bar = inBar()) {
    const playBtn = $('np-play');
    const playing = !!playBtn?.classList.contains('playing');
    const scrub = $('np-scrub');
    const max = Number(scrub?.getAttribute('aria-valuemax')) || 0;
    const frac = max > 0 ? Math.max(0, Math.min(1, Number(scrub.getAttribute('aria-valuenow')) / max)) : 0;
    const pos = $('position')?.textContent || '';
    room.style.setProperty('--room-played', frac.toFixed(4));
    deckLcd.textContent = bar.deck ? pos || '00:00' : '--:--';
    const sig = JSON.stringify([bar.deck && (bar.deck.take?.name || bar.deck.tape?.id), bar.deck?.tape?.name, bar.deck?.take?.label, bar.barKind, playing]);
    if (sig === placesSig) return;
    placesSig = sig;
    const d = bar.deck;
    const dName = d ? (d.kind === 'take' ? spineTitle(d.take) : d.tape.name) : '';
    deck.classList.toggle('empty', !d);
    deck.classList.toggle('playing', playing && !!d);
    deckPlace.replaceChildren(el('span', 'room-led', { 'aria-hidden': 'true' }), d ? `On the deck: ${dName}` : 'The deck · empty');
    deckPlace.setAttribute('aria-label', d ? `On the deck: ${dName}, a ${d.kind}. Sit down with it` : 'The deck is empty: pick something off the shelf');
    deckMeta.textContent = d ? `${d.kind}${bar.barKind === d.kind ? '' : ' · not playing'}` : 'pick something off the shelf';
    deckSit.hidden = !d;
    if (d) deckSit.href = chairFor(d);
    // ▶ here is the bar's own, when the bar holds what's on the deck.
    deckPlay.hidden = !d || bar.barKind !== d.kind;
    deckPlay.textContent = playing ? '❚❚' : '▶';
    deckPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    // The sketchbook: the notes of the take on the deck.
    const bt = d && d.kind === 'take' ? d.take : null;
    const notes = bt ? (bt.flags || []).length : 0;
    const latest = bt ? [...(bt.flags || [])].filter((f) => f.label).sort((a, b) => b.frame - a.frame)[0] : null;
    bookPlace.replaceChildren(
      el('span', 'room-book-word', { text: 'Sketchbook' }),
      el('span', 'room-book-latest', { text: d && d.kind === 'tape' ? `${(d.tape.name || 'the tape')}` : latest ? `${fmtAt(latest.frame, bt.sample_rate || 48000)} · ${latest.label}` : bt ? 'no notes yet' : 'nothing on the deck' }),
      el('span', 'room-book-n', { 'aria-hidden': 'true', text: String(notes) }));
    bookPlace.setAttribute('aria-label', d
      ? `Sketchbook: ${notes} note${notes === 1 ? '' : 's'} on ${dName}. Sit down with it`
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
    const thing = bar.barKind ? bar.deck : null;
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
  bookPlace.addEventListener('click', () => {
    const b = inBar();
    const thing = b.deck;
    if (thing) location.href = chairFor(thing);
    else focusShelf('.room-shelf-takes');
  });

  // --- a take off the shelf ------------------------------------------------------
  // Pulled out: its sheet, with the card at its head. Its player is fetched
  // now, so PUT IT ON plays inside the press that asked.
  function pickTake(name) {
    h.pick(name);
    h.openSheet(name);
    h.takes.player(name).catch(() => {});
  }
  h.onShow((t) => {
    cardTake = t;
    if (!t) return;
    paintGrab();
    loadedLoopBars().then((bars) => { grabN = takeStartN({ loopBars: bars, stored: readPick() }); paintGrab(); });
    put.setAttribute('aria-label', 'Put it on the deck');
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
    playAll.textContent = h.playAll.running() ? '■ Stop Play all' : '▶ Play all from here';
  });
  h.onClosed((from) => room.querySelector(`[data-key="take:${CSS.escape(from)}"]`)?.focus());
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
    // would go on into older months.
    h.playAll.from(name, playOrder(roomShelves(h.takes.all, tapeList, h.opts()), name));
  });

  async function putOnTake(name) {
    const t = takeByName(name);
    const p = t && await h.takes.player(name);
    if (!p) { toast('Still encoding — a moment', 'warn'); return; }
    if (h.sheetOpen()) h.closeSheet();
    crossFade(() => { h.np.loadTake(t, p); render(); });
    if (p.audio.paused) await p.toggle();
  }

  async function takeToStudio(t) {
    const sr = t.sample_rate || 48000;
    // The take's saved selection, else the N bars before the playhead -- the
    // bar's, if it holds this take; else the take's start.
    const span = takeGrabSpan({
      region: t.trim ? { start: t.trim.start_frame, end: t.trim.end_frame } : null,
      playhead: playheadFor(h.np, t.name, sr), total: Math.floor((t.duration_seconds || 0) * sr),
      sampleRate: sr, bpm: t.bpm, n: grabN,
    });
    if (!span) return;
    try {
      location.href = await sendToStudio(t.name, span);
    } catch (e) {
      toast(`Couldn’t take it to the Studio: ${e.message}`, 'bad');
    }
  }

  // --- a tape off the shelf --------------------------------------------------------
  function openTape(s) {
    cardTape = s;
    tapeName.textContent = s.name || 'untitled';
    tapeMeta.textContent = [fmtLen(s.seconds), s.bpm ? `${Math.round(s.bpm)} BPM` : '', `${s.clips || 0} clip${s.clips === 1 ? '' : 's'}`, s.loaded ? 'on the Studio’s deck' : ''].filter(Boolean).join(' · ');
    tapeSit.href = `/wave.html?tape=${encodeURIComponent(s.id)}`;
    tapeCard.showModal();
    tapePut.focus();
  }
  tapeCard.addEventListener('close', () => {
    if (cardTape) room.querySelector(`[data-key="tape:${CSS.escape(cardTape.id)}"]`)?.focus();
  });
  tapePut.addEventListener('click', async () => {
    const s = cardTape;
    if (!s) return;
    tapeCard.close();
    try {
      const r = await putTapeOn(s.id, { ask: askFirst });
      if (!r.loaded) return;
      if (r.already && !r.played) toast(`${s.name} is on the Studio’s deck already, and in use there`, 'warn');
      await refreshTapes();
      // The bar follows a tape loaded since, once it has one; a page that
      // opened with none has no tape in its bar, and opens again with it.
      if (!hadTape) { location.replace('/takes.html'); return; }
      crossFade(() => { h.np.backToTape({ byHand: true }); render(); });
    } catch (e) {
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
  // This month's takes, as today's rack: Select is there.
  takesShelf.listBtn.addEventListener('click', () => {
    const key = monthKey(Date.now());
    const n = roomShelves(h.takes.all, tapeList, h.opts()).month.spines.length;
    openList({ title: `${monthName()}: ${n} take${n === 1 ? '' : 's'}`, back: 'list:takes', names: () => inMonth(h.takes.all, key, h.opts()) });
  });

  render();
  return { render };
}
