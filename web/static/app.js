// Hindsight — app entry.

import { connectLive } from '/lib/live.js';
import { watchLink, timedFetch } from '/lib/link.js';
import { Meters, fmtDur, tierPhrase, captureTiers, frameLevels, readouts, heldError } from '/lib/meter.js';
import { VUMeters } from '/lib/objects/vu.js';
import { Ribbon } from '/lib/objects/ribbon.js';
import { TakesList } from '/lib/takes.js';
import { initWakeLock } from '/lib/wakelock.js';
import { initPhone } from '/lib/phone/recorder.js';
import { initHelp } from '/lib/help/help.js';
import { toast, takeNextToast } from '/lib/toast.js';
import { say } from '/lib/rooms/words.js';
import { on as roomsOn } from '/lib/rooms/flag.js';
import { takeTitle } from '/lib/rooms/takename.js';
import { newest, fold, membersOf } from '/lib/shelf.js';
import { initNav } from '/lib/nav.js';
import { pageBar, takesFinder } from '/lib/bar/bar.js';
import { initUpdate } from '/lib/update.js';
import { initSettings } from '/lib/settings.js';

const $ = (id) => document.getElementById(id);

const el = {
  awake: $('awake'),
  healthDot: $('health-dot'),
  healthText: $('health-text'),
  vizWrap: $('viz-wrap'),
  meters: $('meters'),
  vu: $('vu'),
  chanGrid: $('chan-grid'),
  chanSaving: $('chan-saving'),
  chanDevice: $('chan-device'),
  statBuffered: $('stat-buffered'),
  statDisk: $('stat-disk'),
  statXruns: $('stat-xruns'),
  statTempo: $('stat-tempo'),
  midiDevices: $('midi-devices'),
  durSeg: $('dur-seg'),
  markBtn: $('mark-btn'),
  captureBtn: $('capture-btn'),
  capWord: $('cap-word'),
  capSub: $('cap-sub'),
  lastSaved: $('last-saved'),
  takes: $('takes'),
  takesEmpty: $('takes-empty'),
  allCount: $('all-count'),
  toasts: $('toasts'),
};

// ---------------------------------------------------------------- toasts

// toast is lib/toast.js: a message, and optionally one action ("Undo").

// ---------------------------------------------------------------- state

let status = null;
let ribbon = null;
let mainMeters = null;
let vuMeters = null;
let chanMeters = null;
let selSeconds = 30;
// The capture error on screen, since when, and whether it has been toasted
// (lib/meter.js heldError).
let captureErr = { text: '', since: 0, shown: false };

// On the shelf: the newest takes as cassette spines -- a press plays one --
// as many as the screen holds; the takes page (takes.html) has the rest. Cuts
// and a tape's earlier mixdowns fold into their spine (lib/shelf.js fold), as
// they do there. Its ◂ ▸ still step through every take, in the list's own
// order.
const shelfWide = matchMedia('(min-width: 1100px)');
const shelfBench = matchMedia('(min-width: 900px) and (orientation: landscape) and (min-height: 561px)');
const shelfCount = () => (shelfWide.matches ? 6 : shelfBench.matches ? 4 : 3);
// The now-playing bar: the tape, or a spine pressed (lib/bar/bar.js).
let np = null;
const takes = new TakesList(el.takes, el.takesEmpty, {
  onToast: toast,
  onListChange: () => { el.allCount.textContent = takes.all.length ? String(takes.all.length) : ''; },
  shape: (all) => {
    const f = fold(all);
    const top = newest(f.shelf, shelfCount());
    return [{ label: '', takes: top, members: membersOf(f, top) }];
  },
  stepOrder: 'all',
  spines: true,
  spineAction: 'play',
  // A hold opens the take on the takes page, to name it, star it, open it.
  onSpineHold: (name) => location.assign(`/takes.html?take=${encodeURIComponent(name)}`),
  // A spine pressed plays its take in the now-playing bar; when it plays to
  // its end, or ⏏, the bar goes back to the tape.
  onPlay: async (name) => {
    if (!np) return;
    const t = takes.all.find((x) => x.name === name);
    const p = t && await takes.player(name);
    if (p) np.loadTake(t, p);
  },
  onEnded: (name) => { if (np && np.takeName === name && !np.looping) np.backToTape(); },
});
for (const m of [shelfWide, shelfBench]) m.addEventListener('change', () => takes.reshape());

// A take deleted from its own page comes back here with its Undo.
function showNextToast() {
  const next = takeNextToast();
  if (!next) return;
  const opts = next.restore ? { action: { label: 'Undo', run: () => takes.restore([next.restore]) } } : {};
  toast(next.msg, next.kind || 'ok', opts);
}
showNextToast();
// The tape's link, when the Pi runs one.
fetch('/api/tapes', { cache: 'no-store' }).then((r) => {
  ribbon?.offerCopy(r.ok); // with the tape on, a span can be copied for it
}).catch(() => {});
// Back from the take page can restore this page from the browser's cache,
// scripts and all, without loading it: catch up then.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  showNextToast();
  pollTakes(true);
});

// ---------------------------------------------------------------- status

function buildDurations(ringSeconds) {
  const opts = captureTiers(ringSeconds);

  // Prefer 30s; otherwise the shortest available.
  if (!opts.some((o) => o.s === selSeconds)) selSeconds = opts[0].s;

  el.durSeg.textContent = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.dataset.seconds = String(o.s);
    b.setAttribute('aria-pressed', String(o.s === selSeconds));
    b.addEventListener('click', () => {
      selSeconds = o.s;
      for (const other of el.durSeg.children) {
        other.setAttribute('aria-pressed', String(Number(other.dataset.seconds) === selSeconds));
      }
      ribbon?.setSelected(selSeconds);
      el.capSub.textContent = tierPhrase(selSeconds, ringSeconds);
    });
    el.durSeg.appendChild(b);
  }
  el.capSub.textContent = tierPhrase(selSeconds, ringSeconds);

  ribbon?.setSpans(opts.map((o) => o.s));
  ribbon?.setSelected(selSeconds);
}

function buildChannelStrip(channels, saveChannels) {
  const labels = Array.from({ length: channels }, (_, i) => String(i + 1));
  const selected = saveChannels.map((c) => c - 1);
  el.chanGrid.textContent = '';
  chanMeters = new Meters(el.chanGrid, { labels, selected });
}

// The saves taken back on this page with their toast's Undo, so the status
// doesn't name one as the last saved.
const tookBack = new Set();

function applyStatus(s) {
  const first = status === null;
  const shapeChanged =
    first ||
    s.ring_seconds !== status.ring_seconds ||
    s.channels !== status.channels ||
    String(s.save_channels) !== String(status.save_channels);
  status = s;

  if (shapeChanged) {
    buildDurations(s.ring_seconds);
    buildChannelStrip(s.channels, s.save_channels);

    const sel = s.save_channels.map((c) => c - 1);
    el.meters?.replaceChildren();
    const labels = sel.length > 1 ? ['L', 'R'] : ['M'];
    mainMeters = new Meters(el.meters, { labels, selected: [] });
    el.vu.replaceChildren();
    // Off the ticker before its nodes go, or the old needles keep being
    // stepped in a DOM nobody can see.
    vuMeters?.destroy();
    vuMeters = new VUMeters(el.vu, { labels });

    el.chanSaving.textContent = s.save_channels.join(' & ');
    el.chanDevice.textContent = s.device || 'no device';
  }

  const r = readouts(s);
  const healthy = s.capture_healthy;
  el.healthDot.className = `dot ${r.health.state}`;

  // The bar is narrow, so it carries the short status only; the full text
  // goes to a toast (heldError) and to the title for a hover.
  el.healthText.textContent = r.health.text;
  el.healthText.title = r.health.detail;

  const held = heldError(captureErr, r.health.error, Date.now());
  captureErr = held.state;
  if (held.show) toast(held.show, 'bad', 8000);
  if (s.version) $('version').textContent = s.version;

  el.vizWrap.classList.toggle('stale', !healthy);

  el.statBuffered.textContent = fmtDur(Math.round(s.buffered_seconds));
  el.statBuffered.className = s.buffered_seconds < 5 ? 'v warn' : 'v';

  // The readings, and how worried to be about each (lib/meter.js readouts).
  for (const [node, v] of [[el.statDisk, r.disk], [el.statXruns, r.xruns], [el.statTempo, r.tempo]]) {
    node.textContent = v.text;
    node.className = v.level ? `v ${v.level}` : 'v';
  }

  el.midiDevices.textContent = r.midi;

  // A save taken back with its toast's Undo isn't the last one kept.
  el.lastSaved.textContent = (s.last_saved && !tookBack.has(s.last_saved) && s.last_saved) || 'none';

  el.captureBtn.disabled = !healthy || s.saving;
  // The word changes with the state; what it catches only matters when it can.
  if (s.saving) el.capWord.textContent = 'Saving…';
  else if (!healthy) el.capWord.textContent = 'No input';
  else el.capWord.textContent = 'Capture';
  el.capSub.hidden = !healthy || !!s.saving;

  // Not `healthy`: an interface can be powered off with a full buffer still
  // in memory, and marking a moment in audio you can still capture is the
  // point of the feature.
  el.markBtn.disabled = !s.buffered_seconds;

  // Channel strip reads its levels from /api/status so it stays live even
  // before the websocket has delivered a frame.
  if (chanMeters && s.channel_rms) {
    chanMeters.update(s.channel_rms, s.channel_rms, null);
  }
}

async function pollStatus() {
  try {
    const res = await timedFetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyStatus(await res.json());
    link.ok('status');
  } catch {
    link.fail('status');
    el.healthDot.className = 'dot bad';
    el.healthText.textContent = 'server unreachable';
    el.captureBtn.disabled = true;
    // buffered_seconds is unknown, not zero, but the flag would fail the
    // same way capture would, so it gets the same fail-safe.
    el.markBtn.disabled = true;
  }
}

// Back from a take returns to the list where you left it. The browser keeps
// the scroll when it restores the page from its cache; when it reloads it
// instead, the list isn't there yet when it tries, so it's put back here once
// the takes have rendered.
const SCROLL_KEY = 'hindsight.scroll';
let restoreScroll = null;
try {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'back_forward') restoreScroll = Number(sessionStorage.getItem(SCROLL_KEY)) || null;
} catch { /* fine */ }
window.addEventListener('pagehide', () => {
  try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* fine */ }
});

async function pollTakes(force = false) {
  // Never disturb the list while something is playing — this is what used to
  // kill playback every few seconds.
  if (!force && takes.isPlaying()) return;
  try {
    await takes.refresh();
    if (restoreScroll != null) { window.scrollTo(0, restoreScroll); restoreScroll = null; }
  } catch {
    /* transient; the next tick retries */
  }
}

// ---------------------------------------------------------------- capture

// Every save says so, with Name it and Undo: a capture you didn't mean goes
// straight to the trash (Recently deleted, under the takes list), and the
// toast that says so has Restore.
// With the rooms on a take is named as its spine names it, not by its file.
const nameOf = (name, seconds) => (roomsOn() ? takeTitle(name, seconds) : name);

function savedToast(msg, name) {
  toast(msg, 'ok', {
    actions: [
      { label: 'Name it', run: () => location.assign(`/takes.html?take=${encodeURIComponent(name)}`) },
      { label: 'Undo', run: () => undoSave(name) },
    ],
  });
}

async function undoSave(name) {
  try {
    await takes.trash([name]);
    tookBack.add(name);
  } catch (e) {
    toast(`Could not undo the save: ${e.message}`, 'bad');
    return;
  }
  toast(`Took back ${nameOf(name)}: it’s in Recently deleted`, 'ok', { action: { label: 'Restore', run: () => { tookBack.delete(name); takes.restore([name]); } } });
  pollTakes(true);
  pollStatus();
}

async function capture() {
  const btn = el.captureBtn;
  // A tick under the thumb as it goes, and two when it's on the shelf: the
  // phone is often in a pocket or on a stand, and the toast is easy to miss.
  // Android only; iOS has no vibrate, and that must not matter.
  try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
  btn.disabled = true;
  el.capWord.textContent = 'Saving…';
  let saved = false;

  try {
    const res = await fetch(`/api/trigger?seconds=${selSeconds}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = body.error || `HTTP ${res.status}`;
      toast(res.status === 507 ? `Disk full — ${msg}` : `Capture failed: ${msg}`, 'bad', 7000);
      return;
    }

    takes.markFresh(body.name);
    savedToast(`Saved ${nameOf(body.name, body.seconds)}`, body.name);
    saved = true;
    try { navigator.vibrate?.([12, 70, 12]); } catch { /* no haptics here */ }
    await pollTakes(true);
    await pollStatus();
  } catch (e) {
    toast(`Capture failed: ${e.message}`, 'bad', 7000);
  } finally {
    el.capWord.textContent = 'Capture';
    btn.disabled = false;
    // The key glows a moment once it's back: it caught something. (While
    // it's disabled, refreshing the list, its glow wouldn't show.)
    if (saved) {
      btn.classList.add('saved');
      setTimeout(() => btn.classList.remove('saved'), 1200);
    }
  }
}

el.captureBtn.addEventListener('click', capture);

initHelp({ page: 'main' });
initUpdate();
initSettings();
np = pageBar({ tapes: initNav(), onToast: toast, find: takesFinder(takes) });

initPhone({
  button: $('phone-btn'),
  sheet: $('phone-sheet'),
  toast,
  // The hub's HTTPS address, when there is a certificate for it.
  secureURL: () => (status?.hub?.cert_not_after && status.hub.url) || '',
  onSaved: (name) => {
    takes.markFresh(name);
    pollTakes(true);
  },
});

async function mark() {
  const btn = el.markBtn;
  btn.disabled = true;
  try {
    const res = await fetch('/api/flag', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || say('could not flag'), 'bad');
      return;
    }
    ribbon.poll(); // draw the new tick without waiting for the next poll
  } catch {
    toast(say('could not flag'), 'bad');
  } finally {
    // The next status poll re-enables it if audio is still buffered; this
    // just guards against a second click landing mid-request.
    btn.disabled = !status?.buffered_seconds;
  }
}

el.markBtn.addEventListener('click', mark);

// ---------------------------------------------------------------- live

ribbon = new Ribbon(el.vizWrap, {
  onToast: toast,
  onSavedToast: savedToast,
  selBar: $('rb-sel'),
  flagSheet: $('rb-flag-sheet'),
  onSaved: (name) => {
    takes.markFresh(name);
    pollTakes(true);
  },
});

// The Pi, heard or not: the live meters and the status poll both report here.
// Back from sleep (or a dropped network) the page asks again at once; the
// meters' socket replaces itself (lib/live.js).
const link = watchLink(() => {
  pollStatus();
  pollTakes();
});

connectLive({
  onOpen: () => link.ok('live'),
  onClose: () => link.fail('live'),
  onFrame: (f) => {
    if (!mainMeters || !status) return;
    const { rms, peak, clip } = frameLevels(f, status.save_channels.map((c) => c - 1));
    mainMeters.update(rms, peak, clip);
    vuMeters?.update(rms, peak, clip);
    const last = f.bins?.[f.bins.length - 1];
    if (chanMeters && last?.rms) chanMeters.update(last.rms, f.peak, f.clip);
  },
});

// ---------------------------------------------------------------- loops

pollStatus().then(() => pollTakes(true));
setInterval(pollStatus, 2000);
setInterval(() => pollTakes(), 5000);

// Keep the screen awake while docked on a charger. Charging-only, so a phone
// on battery is untouched. Like the service worker below, this needs a secure
// context, so it engages on the tailnet HTTPS name and not over plain HTTP.
initWakeLock({
  onChange: (held) => {
    el.awake.hidden = !held;
  },
});

// A service worker cannot register over plain HTTP, which is how this device
// is reached on the LAN. Registering only in a secure context means the app
// picks it up automatically if TLS is ever added, without failing noisily now.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
