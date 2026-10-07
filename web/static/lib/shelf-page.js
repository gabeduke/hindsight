// web/static/lib/shelf-page.js
// The takes page: every take, searched, filtered and grouped by day
// (lib/shelf.js), drawn by the same list the main page uses (lib/takes.js).

import { TakesList } from '/lib/takes.js';
import { TrashList } from '/lib/trash.js';
import { toast, takeNextToast } from '/lib/toast.js';
import { initHelp } from '/lib/help/help.js';
import { shelve, sheetState, tagCounts, fold, familyOf, matches } from '/lib/shelf.js';
import { tagStore } from '/lib/tags.js';
import { openTagManager } from '/lib/tags-dialog.js';
import { initNav } from '/lib/nav.js';
import { TakeDetail } from '/lib/shelf-detail.js';
import { pageBar } from '/lib/bar/bar.js';
import { watchLink, timedFetch } from '/lib/link.js';

const $ = (id) => document.getElementById(id);

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
  },
  selectBar: $('select-bar'),
  shape: (all) => {
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
tagStore.subscribe(() => { renderTagFilters(); syncPick(); });

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
}

// --- the detail pane, on a wide screen ------------------------------------

// Every take is a spine, for picking; the picked take is a cassette, with the
// controls. Wide enough, the cassette sits beside the rack.
const wide = matchMedia('(min-width: 1100px)');
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
let reopen = history.state?.cassette || null;
if (reopen) history.replaceState(null, '');
// /takes.html?take=NAME (the Capture page's "Name it", or a held spine on
// its shelf) picks that take, and opens its sheet on a phone.
const asked = new URLSearchParams(location.search).get('take');
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

// pick shows take `name` in the pane, and puts it in the now-playing bar.
// hand: picked by a press, not the first take a wide screen shows by itself.
function pick(name, hand = false) {
  // A take left playing would lose its Pause with its controls in the pane:
  // picking another stops it.
  if (name !== picked && takes.playing && takes.playing !== name) takes.stopOthers(name);
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
  if (!np || !name) return;
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
  if (takes.selecting) return;
  const row = e.target.closest('.take');
  if (!row || e.target.closest('button, a, input, .take-flag, .take-flag-edit')) return;
  pick(row.dataset.name, true);
  if (!wide.matches) openSheet(row.dataset.name);
});
$('takes').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
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
  // Never disturb the list while something is playing.
  if (!force && takes.isPlaying()) return;
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
np = pageBar({ tapes: initNav(), onToast: toast });
poll(true);
pollStatus();
setInterval(() => poll(), 5000);
setInterval(pollStatus, 15000);
