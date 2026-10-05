// web/static/lib/shelf-page.js
// The takes page: every take, searched, filtered and grouped by day
// (lib/shelf.js), drawn by the same list the main page uses (lib/takes.js).

import { TakesList } from '/lib/takes.js';
import { TrashList } from '/lib/trash.js';
import { toast, takeNextToast } from '/lib/toast.js';
import { initHelp } from '/lib/help/help.js';
import { shelve } from '/lib/shelf.js';
import { initNav } from '/lib/nav.js';
import { TakeDetail } from '/lib/shelf-detail.js';

const $ = (id) => document.getElementById(id);

// What the shelf shows, remembered per device. Never the search: a search
// left in from last week would hide takes without saying why.
const VIEW_KEY = 'hindsight.shelf';
const view = { query: '', starred: false, midi: false, phone: false, tape: false, sort: 'newest' };
try {
  const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  for (const k of ['starred', 'midi', 'phone', 'tape']) view[k] = saved[k] === true;
  if (saved.sort === 'longest') view.sort = 'longest';
} catch { /* fine */ }
function saveView() {
  try {
    const { starred, midi, phone, tape, sort } = view;
    localStorage.setItem(VIEW_KEY, JSON.stringify({ starred, midi, phone, tape, sort }));
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
const takes = new TakesList($('takes'), $('takes-empty'), {
  onToast: toast,
  onListChange: () => {
    clearTimeout(trashTimer);
    trashTimer = setTimeout(() => trash.refresh(), 150);
    renderCounts();
    syncPick();
  },
  selectBar: $('select-bar'),
  shape: (all) => shelve(all, view),
  spines: true,
});
$('select-btn').addEventListener('click', () => (takes.selecting ? takes.exitSelect() : takes.enterSelect()));

// --- the view: search, filters, sort --------------------------------------

function renderControls() {
  for (const b of $('shelf-filters').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(view[b.dataset.filter]));
  }
  for (const b of $('shelf-sort').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.sort === view.sort));
  }
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
const detail = new TakeDetail($('take-detail'), { takes, onToast: toast });
let picked = null;

const shownNames = () => [...$('takes').querySelectorAll('.take')].map((e) => e.dataset.name);

function pick(name) {
  // A take left playing would lose its Pause with its controls in the pane:
  // picking another stops it.
  if (name !== picked && takes.playing && takes.playing !== name) takes.stopOthers(name);
  picked = name;
  for (const [n, row] of takes.rows) {
    const on = n === picked;
    row.el.classList.toggle('picked', on);
    row.el.setAttribute('aria-current', on ? 'true' : 'false');
    row.ws?.setPicked?.(on);
  }
  detail.show(wide.matches ? takes.all.find((t) => t.name === picked) || null : null);
}

// syncPick keeps the pick on a take that's shown: the first, when the one
// picked has gone -- deleted, or filtered out.
function syncPick() {
  const shown = shownNames();
  // On a phone nothing is picked until a spine is pressed.
  if (!wide.matches) { pick(shown.includes(picked) ? picked : null); return; }
  pick(shown.includes(picked) ? picked : shown[0] || null);
}

// A row's body picks it; its own controls keep their press, and a press on
// its waveform both seeks and picks.
$('takes').addEventListener('click', (e) => {
  if (takes.selecting) return;
  const row = e.target.closest('.take');
  if (!row || e.target.closest('button, a, input, .take-flag, .take-flag-edit')) return;
  pick(row.dataset.name);
});
$('takes').addEventListener('keydown', (e) => {
  if (takes.selecting || (e.key !== 'Enter' && e.key !== ' ')) return;
  const row = e.target.closest('.take');
  if (!row || e.target !== row) return; // a row's own controls keep their keys
  e.preventDefault();
  pick(row.dataset.name);
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
    const res = await fetch('/api/status', { cache: 'no-store' });
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
    if (restoreScroll != null) { window.scrollTo(0, restoreScroll); restoreScroll = null; }
  } catch { /* transient; the next tick retries */ }
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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { poll(); pollStatus(); }
});

renderControls();
showNextToast();
initHelp({ page: 'takes' });
initNav();
poll(true);
pollStatus();
setInterval(() => poll(), 5000);
setInterval(pollStatus, 15000);
