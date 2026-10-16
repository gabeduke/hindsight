// web/static/lib/shelf-page.js
// The takes page: every take, searched, filtered and grouped by day
// (lib/shelf.js), drawn by the same list the main page uses (lib/takes.js).

import { TakesList } from '/lib/takes.js';
import { TrashList } from '/lib/trash.js';
import { toast, takeNextToast } from '/lib/toast.js';
import { initHelp } from '/lib/help/help.js';
import { shelve, sheetState, tagCounts, fold, familyOf, matches, stopsOnPick } from '/lib/shelf.js';
import { tagStore } from '/lib/tags.js';
import { openTagManager } from '/lib/tags-dialog.js';
import { initNav } from '/lib/nav.js';
import { named } from '/lib/rooms/words.js';
import { TakeDetail } from '/lib/shelf-detail.js';
import { pageBar, takesFinder } from '/lib/bar/bar.js';
import { watchLink, timedFetch } from '/lib/link.js';
import { spanOf, firstOf, nextOf, doneAt } from '/lib/playall.js';
import { holdScreen } from '/lib/wakelock.js';
import { Loop } from '/lib/objects/motion.js';
import { start as startRoom, roomOn } from '/lib/room/mount.js';

const $ = (id) => document.getElementById(id);

// With the two rooms on, this page is the Listening Room seen from the
// doorway (lib/room/doorway.js): the rack is still here, under the room,
// doing what it does, and the room asks it through the handle at the foot.
// A tap on a take there plays it in the bar and a hold selects it; the sheet
// below is the takes page's with the rooms off, and never opens with them on.
const roomMode = roomOn();
// What the room hears of: the list, and the selection. Empty with the room off.
const roomHooks = { change: new Set(), selected: new Set() };
const roomChanged = () => { for (const f of roomHooks.change) f(); };
// The room's month box, opened to the rack: only that month's families.
let roomFilter = null;

// What the shelf shows, remembered per device. Never the search: a search
// left in from last week would hide takes without saying why.
const VIEW_KEY = 'hindsight.shelf';
const view = { query: '', starred: false, midi: false, phone: false, tape: false, sort: 'newest', tag: '' };
try {
  const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  for (const k of ['starred', 'midi', 'phone', 'tape']) view[k] = saved[k] === true;
  if (saved.sort === 'longest' || saved.sort === 'tag') view.sort = saved.sort;
  if (typeof saved.tag === 'string') view.tag = saved.tag;
} catch { /* fine */ }
function saveView() {
  try {
    const { starred, midi, phone, tape, sort, tag } = view;
    localStorage.setItem(VIEW_KEY, JSON.stringify({ starred, midi, phone, tape, sort, tag }));
  } catch { /* private mode */ }
}

// Asks before something that can't be undone: deleting from the trash, or
// emptying it. Deleting a take doesn't ask; it goes to the trash.
function confirmForever(title, name) {
  const dlg = $('confirm');
  return new Promise((resolve) => {
    if (typeof dlg.showModal !== 'function') {
      resolve(window.confirm(`${title} ${name}`));
      return;
    }
    $('confirm-title').textContent = title;
    $('confirm-name').textContent = name;
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'delete'), { once: true });
    dlg.showModal();
  });
}

const trash = new TrashList($('trash'), {
  onToast: toast,
  onConfirm: confirmForever,
  onRestored: () => poll(true),
});
let trashTimer = 0;
// What the shelf folded on its last draw (lib/shelf.js fold).
let fam = fold([]);
const takes = new TakesList($('takes'), $('takes-empty'), {
  onToast: toast,
  onListChange: () => {
    clearTimeout(trashTimer);
    trashTimer = setTimeout(() => trash.refresh(), 150);
    renderCounts();
    renderTagFilters();
    syncPick();
    renderPlayAll();
  },
  selectBar: $('select-bar'),
  // Select mode, however it starts (Select, a hold) or ends (Done, Escape):
  // Play all stops, and its key is off while it lasts.
  onSelectChange: () => { stopPlayAll({ pause: true }); renderPlayAll(); },
  // The Listening Room's: its spines follow the selection; a hold selects with
  // a finger or a pen, not a mouse; a family's takes are rows of the List.
  onSelected: () => { for (const f of roomHooks.selected) f(); },
  touchHold: roomMode,
  showFolded: roomMode,
  shape: (every) => {
    // The take on the deck stays in a month's box while the box is open: its
    // row is its player, and a row the rack drops stops playing.
    const all = roomFilter ? every.filter((t) => roomFilter(t) || (np && t.name === np.takeName)) : every;
    const opts = { ...view, tags: tagStore.list, tag: shownTag() };
    // The same fold the shelf is drawn from, for the pane's families.
    fam = fold(all.filter((t) => matches(t, opts)));
    return shelve(all, opts);
  },
  spines: true,
});
$('select-btn').addEventListener('click', () => (takes.selecting ? takes.exitSelect() : takes.enterSelect()));

// --- the view: search, filters, sort --------------------------------------

// The tag filter in force: one a tag was deleted from can't hide every take.
function shownTag() {
  if (view.tag === '' || view.tag === 'none') return view.tag;
  return tagStore.list.some((g) => g.id === view.tag) ? view.tag : '';
}

// One chip per tag with how many takes wear it, the untagged, and the way
// into the tag manager. Pressing the lit chip turns the filter off.
function renderTagFilters() {
  const box = $('shelf-tags'), list = tagStore.list, on = shownTag();
  const n = tagCounts(takes.all, list);
  // A poll that changes nothing must not rebuild the chips under a finger.
  const sig = JSON.stringify([list, n, on]);
  if (sig === renderTagFilters.sig) return;
  renderTagFilters.sig = sig;
  const chip = (cls, label, pressed, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-pressed', String(pressed));
    if (typeof label === 'string') b.textContent = label; else b.append(...label);
    b.addEventListener('click', run);
    return b;
  };
  const pick = (id) => { view.tag = view.tag === id ? '' : id; saveView(); renderTagFilters(); reshape(); };
  const els = list.map((g) => {
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.setAttribute('aria-hidden', 'true');
    const count = document.createElement('span');
    count.className = 'tag-n';
    count.textContent = String(n[g.id]);
    const b = chip(`icon-btn toggle tag-chip stripe-${g.color}`, [dot, g.name, ' ', count], on === g.id, () => pick(g.id));
    return b;
  });
  if (list.length) els.push(chip('icon-btn toggle', `Untagged ${n['']}`, on === 'none', () => pick('none')));
  const edit = chip('chip tag-edit-btn', list.length ? 'Edit tags' : '+ Tags', false, () => openTagManager({ onToast: toast }));
  edit.setAttribute('data-tip', 'tags-edit');
  els.push(edit);
  box.replaceChildren(...els);
}
// After the list's own subscription has reshaped the shelf: a tag deleted, or
// the tags loading under a saved tag filter, can fold the picked take.
tagStore.subscribe(() => { renderTagFilters(); syncPick(); roomChanged(); });

function renderControls() {
  for (const b of $('shelf-filters').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(view[b.dataset.filter]));
  }
  for (const b of $('shelf-sort').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.sort === view.sort));
  }
  renderTagFilters();
}

function reshape() {
  takes.reshape();
  renderCounts();
  syncPick();
  renderPlayAll(); // nothing shown: nothing to play
}

// --- the detail pane, on a wide screen ------------------------------------

// Every take is a spine, for picking; the picked take is a cassette, with the
// controls. Wide enough, the cassette sits beside the rack.
const wideMQ = matchMedia('(min-width: 1100px)');
// In the Listening Room a spine always opens its sheet, at any width: the
// room stands where the pane would.
const wide = roomMode
  ? { get matches() { return false; }, addEventListener: (type, fn) => wideMQ.addEventListener(type, fn) }
  : wideMQ;
const detail = new TakeDetail($('take-detail'), {
  takes, onToast: toast, onBack: () => closeSheet(), onPick: (name) => pick(name, true), isShown: (name) => present(name),
});
let picked = null;
// The spine the pick is on: the pick itself, or the spine it's folded into.
// Deleting a folded take goes back to it.
let pickedSpine = null;

// --- the cassette sheet, on a phone ------------------------------------------

// Narrower than the rack-and-pane layout, a spine opens its cassette as a
// sheet over the page. One history entry per opening (lib/shelf.js
// sheetState), so the device's Back closes it; the page behind it is inert.
let sheet = { open: null };
// A reload, or a return the browser didn't keep in memory, brings the
// sheet's entry back with the sheet closed: drop the entry, and reopen the
// sheet once its take is listed (syncPick).
// With the rooms on there is no sheet to bring back.
let reopen = history.state?.cassette || null;
if (reopen) history.replaceState(null, '');
if (roomMode) reopen = null;
// /takes.html?take=NAME (the Capture page's "Name it", or a held spine on
// its shelf) picks that take, and opens its sheet on a phone. With the rooms
// on it is the room's to send to Open (lib/room/tap.js askedTake), so the
// address is left as it came.
const asked = roomMode ? null : new URLSearchParams(location.search).get('take');
if (asked) { reopen = asked; history.replaceState(null, '', location.pathname); }
const behind = () => [document.querySelector('.appbar'), document.querySelector('.shelf-tools'), $('takes'), $('takes-empty'), $('trash'), document.querySelector('.about'), $('np')].filter(Boolean);

function setSheet(on, from) {
  document.body.classList.toggle('cassette-open', on);
  const pane = $('take-detail');
  if (on) { pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-modal', 'true'); }
  else { pane.removeAttribute('role'); pane.removeAttribute('aria-modal'); }
  for (const el of behind()) el.inert = on;
  if (on) {
    showDetail(picked === sheet.open || spineOf(picked) === sheet.open ? picked : sheet.open);
    $('take-detail').scrollTop = 0;
    detail.el('.sheet-back').focus();
  } else {
    if (!wide.matches) detail.show(null);
    // Back to the spine it came from, or the first one if that take has gone.
    (takes.rows.get(from)?.el || $('takes').querySelector('.take.spine'))?.focus();
  }
  roomChanged();
}

function openSheet(name) {
  sheet = sheetState(sheet, { type: 'open', name });
  if (sheet.history === 'push') history.pushState({ cassette: name }, '');
  else if (sheet.history === 'replace') history.replaceState({ cassette: name }, '');
  setSheet(true);
}

function closeSheet() {
  const was = sheet.open;
  sheet = sheetState(sheet, { type: 'close' });
  if (sheet.history === 'back') history.back();
  if (was) setSheet(false, was);
}

addEventListener('popstate', (e) => {
  const was = sheet.open;
  sheet = sheetState(sheet, { type: 'popstate', state: e.state });
  if (sheet.open) {
    // Forward, onto a sheet's entry: open it again, if its take is still here.
    if (wide.matches || !takes.rows.has(sheet.open)) { history.replaceState(null, ''); sheet = { open: null }; return; }
    pick(sheet.open, true);
    setSheet(true);
  } else if (was) {
    setSheet(false, was);
  }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.open && !e.target.closest?.('input')) closeSheet(); });

// The spines on the shelf; a folded take's row is there too, hidden.
const shownNames = () => [...$('takes').querySelectorAll('.take:not(.folded)')].map((e) => e.dataset.name);
const spineOf = (name) => (name && fam.under.get(name)) || name;
// present: a take the pane can show -- a spine, or one folded into a spine.
const present = (name) => !!name && takes.rows.has(name) && (fam.under.has(name) || shownNames().includes(name));

function showDetail(name) {
  const t = (name && takes.all.find((x) => x.name === name)) || null;
  detail.show(t, t ? familyOf(fam, t.name) : null);
}

// The crate's clips, counted by the take they were kept from, for the pane's
// ◫ line; with the tape off there's no crate, and none is shown.
// With the rooms on the crate is off the screen (F3), so nothing is counted
// and the line stays hidden.
if (!roomOn()) {
  fetch('/api/crate', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((b) => {
    if (!b) return;
    const counts = new Map();
    for (const k of b.clips || []) if (k.source && k.source.take) counts.set(k.source.take, (counts.get(k.source.take) || 0) + 1);
    detail.setCrate(counts);
    if (picked && (wide.matches || sheet.open)) showDetail(picked);
  }).catch(() => {});
}

// pick shows take `name` in the pane, and puts it in the now-playing bar.
// hand: picked by a press, not the first take a wide screen shows by itself.
function pick(name, hand = false) {
  // A take left playing would lose its Pause with its controls in the pane:
  // picking another stops it.
  // In the Listening Room it doesn't: browsing the shelves never stops
  // what's on the deck.
  if (stopsOnPick({ room: roomMode, picked, name, playing: takes.playing })) takes.stopOthers(name);
  picked = name;
  pickedSpine = spineOf(name);
  for (const [n, row] of takes.rows) {
    const on = n === pickedSpine;
    row.el.classList.toggle('picked', on);
    row.el.setAttribute('aria-current', on ? 'true' : 'false');
    row.ws?.setPicked?.(on);
  }
  showDetail(wide.matches || sheet.open ? picked : null);
  offerBar(name, hand);
}

// The bar holds the picked take -- except that arriving while the tape
// plays, it keeps the tape until a take is picked by hand.
let np = null;
async function offerBar(name, hand) {
  // The room puts a take on the deck itself, with PUT IT ON.
  if (!np || !name || roomMode) return;
  // The tape -- playing as the page opened, or put back with ⏏ -- stays
  // until a take is picked by hand.
  const keepTape = () => !hand && (np.ejected || (np.tapePlaying() && !np.takeName));
  if (!hand) await np.ready;
  if (keepTape()) return;
  const t = takes.all.find((x) => x.name === name);
  const p = t && await takes.player(name);
  if (picked !== name || keepTape()) return; // another pick since, or ⏏ meanwhile
  // No player yet (still encoding): not another take's ▶ beside this one.
  if (!p) { if (hand) np.backToTape(); return; }
  np.loadTake(t, p);
}

// --- Play all ------------------------------------------------------------------
// The takes shown, in their order, through the bar, each from its
// selection's In to its Out, or the whole take (lib/playall.js). It starts
// at the picked take, picks each in turn (so the bar, the pane and the
// spine follow it), and stops at the end of the list, on ■ Stop, on Pause
// (in the bar or the cassette), on ⏏, on Loop (which stays on the take), or
// when a take is picked by hand. The take's own audio events drive it, as
// they go on firing with the screen off; animation frames only add
// precision while the page is in view. The screen is held on meanwhile, as
// the take page holds it while a take plays.
let playAll = null; // { name, audio, span, prev, raf, moving, off, lock }
const playNames = () => shownNames();

function renderPlayAll() {
  const b = $('play-all');
  b.textContent = playAll ? '■ Stop' : '▶ Play all';
  b.disabled = !playAll && (takes.selecting || !shownNames().length);
  for (const [n, row] of takes.rows) row.el.classList.toggle('play-all', !!playAll && n === playAll.name);
  roomChanged();
}

function stopPlayAll({ pause = false } = {}) {
  const r = playAll;
  if (!r) return;
  playAll = null;
  r.watch?.stop();
  r.off?.abort();
  r.lock?.release();
  if (pause && r.audio && !r.audio.paused) r.audio.pause();
  renderPlayAll();
}

// moveOn leaves the take Play all is on for the next one shown, or stops at
// the end of the list.
function moveOn(r) {
  r.moving = true;
  r.off?.abort();
  r.watch?.stop();
  if (r.audio && !r.audio.paused) r.audio.pause();
  const next = nextOf(playNames(), r.name);
  if (next) playAllFrom(next); else stopPlayAll();
}

async function playAllFrom(name) {
  const r = playAll;
  try {
    const t = takes.all.find((x) => x.name === name);
    // A pick or ⏏ while its player loads is the person taking over.
    const was = { picked, bar: np.takeName, ejected: np.ejected };
    const p = t && await takes.player(name);
    if (playAll !== r) return;
    if (picked !== was.picked || np.takeName !== was.bar || np.ejected !== was.ejected) return stopPlayAll();
    // Still encoding, or gone: on to the next.
    if (!p) {
      const next = nextOf(playNames(), name);
      return next ? playAllFrom(next) : stopPlayAll();
    }
    r.name = name;
    r.span = spanOf(t);
    r.audio = p.audio;
    pick(name, true);
    np.loadTake(t, p);
    renderPlayAll();
    takes.rows.get(name)?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const a = p.audio;
    a.currentTime = r.span.from;
    r.prev = r.span.from;
    try {
      await a.play();
    } catch (e) {
      if (playAll !== r) return;
      // A browser that wants a tap for each take (an iPhone may): stop on
      // it, picked, so ▶ Play all goes on from here. Anything else (its
      // audio wouldn't load): skip it.
      if (e.name === 'NotAllowedError') {
        stopPlayAll();
        toast('This browser wants a tap to play each take: ▶ Play all goes on from here', 'warn');
        return;
      }
      toast(`Skipped ${named(t.label || name)}: it wouldn't play`, 'warn');
      moveOn(r);
      return;
    }
    if (playAll !== r) return;
    r.moving = false;
    r.off = new AbortController();
    const check = () => {
      if (playAll !== r || r.moving) return;
      // A hand pick or ⏏ (each pauses it), or Loop (which plays it on).
      if (picked !== r.name || np.takeName !== r.name || np.looping) return stopPlayAll();
      if (a.error) { moveOn(r); return; }
      const now = a.currentTime;
      const done = doneAt(r.span, r.prev, now, a.ended);
      r.prev = now;
      if (done) { moveOn(r); return; }
      if (a.paused) stopPlayAll(); // Pause, in the bar or the cassette
    };
    const sig = { signal: r.off.signal };
    for (const ev of ['timeupdate', 'pause', 'ended', 'error']) a.addEventListener(ev, check, sig);
    // A seek is a jump, not playing across Out: count from where it lands.
    a.addEventListener('seeked', () => { r.prev = a.currentTime; }, sig);
    // And every frame, on the shared ticker: timeupdate comes a few times a
    // second, which is late for an Out.
    r.watch?.stop();
    r.watch = new Loop(() => { check(); return playAll === r && !r.moving; });
    r.watch.start();
  } catch (e) {
    // Nothing may leave Play all on, holding the polls off, with nothing playing.
    if (playAll === r) {
      stopPlayAll();
      toast(`Play all stopped: ${e.message}`, 'bad');
    }
  }
}

$('play-all').addEventListener('click', () => {
  if (playAll) { stopPlayAll({ pause: true }); return; }
  const first = firstOf(playNames(), pickedSpine);
  if (!first) return;
  playAll = { name: first, moving: true, lock: holdScreen() };
  renderPlayAll();
  playAllFrom(first);
});

// kept is the take to stay on after a poll: the pick, or -- when the pick was
// folded and has gone -- the spine it was folded into.
const kept = () => (present(picked) ? picked : present(pickedSpine) ? pickedSpine : null);

// syncPick keeps the pick on a take that's shown: the first, when the one
// picked has gone -- deleted, or filtered out.
function syncPick() {
  const shown = shownNames();
  if (reopen && present(reopen)) {
    const name = reopen;
    reopen = null;
    if (!wide.matches) { pick(name, true); openSheet(spineOf(name)); return; }
    picked = name;
    pickedSpine = spineOf(name);
    requestAnimationFrame(() => takes.rows.get(pickedSpine)?.el.scrollIntoView({ block: 'nearest' }));
  }
  // On a phone nothing is picked until a spine is pressed; a sheet whose
  // take has gone (deleted, filtered out) closes.
  if (!wide.matches) {
    if (sheet.open && !present(sheet.open)) {
      // The sheet's spine has gone. A take folded into it that's still here
      // (a cut, now a spine of its own) keeps the sheet; otherwise it closes.
      const still = kept();
      if (still) {
        sheet = { open: spineOf(still), history: null };
        history.replaceState({ cassette: sheet.open }, '');
      } else closeSheet();
    }
    pick(kept());
    return;
  }
  if (sheet.open) {
    // Wide enough for the pane: the sheet goes, and its history entry too.
    const was = sheet.open;
    sheet = sheetState(sheet, { type: 'widen' });
    if (sheet.history === 'back') history.back();
    setSheet(false, was);
  }
  pick(kept() || shown[0] || null);
}

// A row's body picks it; its own controls keep their press, and a press on
// its waveform both seeks and picks.
$('takes').addEventListener('click', (e) => {
  if (roomMode || takes.selecting) return; // the room's rows play (lib/room/tap.js)
  const row = e.target.closest('.take');
  if (!row || e.target.closest('button, a, input, .take-flag, .take-flag-edit')) return;
  pick(row.dataset.name, true);
  if (!wide.matches) openSheet(row.dataset.name);
});
$('takes').addEventListener('keydown', (e) => {
  if (roomMode || (e.key !== 'Enter' && e.key !== ' ')) return;
  const row = e.target.closest('.take');
  if (!row || e.target !== row) return; // a row's own controls keep their keys
  e.preventDefault();
  // Selecting: the key picks the spine into the selection, as a tap does.
  if (takes.selecting) { takes.toggleSelected(row.dataset.name); return; }
  pick(row.dataset.name, true);
  if (!wide.matches) openSheet(row.dataset.name);
});
wide.addEventListener('change', syncPick);

$('shelf-filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  view[b.dataset.filter] = !view[b.dataset.filter];
  saveView();
  renderControls();
  reshape();
});
$('shelf-sort').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sort]');
  if (!b || b.dataset.sort === view.sort) return;
  view.sort = b.dataset.sort;
  saveView();
  renderControls();
  reshape();
});
let searchTimer = 0;
$('shelf-q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { view.query = e.target.value; reshape(); }, 120);
});

// --- counts and space ------------------------------------------------------

let diskFree = null;
const fmtGB = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

function renderCounts() {
  const all = takes.all;
  $('shelf-count').textContent = String(takes.shownCount);
  const used = all.reduce((sum, t) => sum + (t.size_mb || 0), 0);
  const parts = [`${all.length} ${all.length === 1 ? 'take' : 'takes'}`, fmtGB(used)];
  if (diskFree != null) parts.push(`${diskFree >= 100 ? diskFree.toFixed(0) : diskFree.toFixed(1)} GB free`);
  $('shelf-store').textContent = parts.join(' · ');
  // Nothing at all, or nothing that matches: different advice.
  $('takes-empty').textContent = all.length
    ? 'No takes match. Turn a filter off, or clear the search.'
    : 'No takes yet. Capture one on the main page.';
}

async function pollStatus() {
  try {
    const res = await timedFetch('/api/status', { cache: 'no-store' });
    if (!res.ok) return;
    diskFree = (await res.json()).disk_free_gb ?? null;
    renderCounts();
  } catch { /* the next tick retries */ }
}

// --- the list --------------------------------------------------------------

// Back from a take returns to the list where you left it. The browser keeps
// the scroll when it restores the page from its cache; when it reloads it
// instead, the list isn't there yet when it tries, so it's put back here once
// the takes have rendered.
const SCROLL_KEY = 'hindsight.shelf.scroll';
let restoreScroll = null;
try {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'back_forward') restoreScroll = Number(sessionStorage.getItem(SCROLL_KEY)) || null;
} catch { /* fine */ }
window.addEventListener('pagehide', () => {
  try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* fine */ }
});

async function poll(force = false) {
  // Never disturb the list while something is playing, or Play all is
  // between two takes.
  if (!force && (takes.isPlaying() || playAll)) return;
  try {
    await takes.refresh();
    link.ok('takes');
    if (restoreScroll != null) { window.scrollTo(0, restoreScroll); restoreScroll = null; }
  } catch { link.fail('takes'); /* the next tick retries */ }
}

// A take deleted from its own page comes back here with its Undo.
function showNextToast() {
  const next = takeNextToast();
  if (!next) return;
  const opts = next.restore ? { action: { label: 'Undo', run: () => takes.restore([next.restore]) } } : {};
  toast(next.msg, next.kind || 'ok', opts);
}

window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  showNextToast();
  poll(true);
});
// Back from sleep, or the network back: ask the Pi at once, and say so while
// it doesn't answer.
const link = watchLink(() => { poll(); pollStatus(); });

renderControls();
showNextToast();
initHelp({ page: 'takes' });
const navTapes = initNav();
np = pageBar({ tapes: navTapes, onToast: toast, find: takesFinder(takes) });
poll(true);
pollStatus();
setInterval(() => poll(), 5000);
setInterval(pollStatus, 15000);

// --- the Listening Room ----------------------------------------------------
// With the rooms flag on, the room mounts over the rack and works it through
// this handle (lib/room/doorway.js). With it off, start() reads the flag and
// stops: nothing below is touched.
startRoom('doorway', {
  takes, toast, tapes: navTapes,
  get np() { return np; },
  opts: () => ({ ...view, tags: tagStore.list, tag: shownTag() }),
  // A tap on a take picks it, so Play all goes on from here.
  pick: (name) => pick(name, true),
  // The List's rows and its select bar: the room wires a tap to the rows and
  // gives the bar its Tag key.
  rack: $('takes'),
  selectBar: $('select-bar'),
  setFilter: (fn) => { roomFilter = fn; reshape(); },
  // The rack's filter, all of it off: the room shows when one is on.
  clearFilter: () => {
    view.query = '';
    $('shelf-q').value = '';
    for (const k of ['starred', 'midi', 'phone', 'tape']) view[k] = false;
    view.tag = '';
    saveView();
    renderControls();
    reshape();
  },
  onChange: (fn) => roomHooks.change.add(fn),
  onSelected: (fn) => roomHooks.selected.add(fn),
  poll: () => poll(true),
})?.catch((e) => console.error('The Listening Room could not start:', e));
