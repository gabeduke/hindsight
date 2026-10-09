// Hindsight — app entry.

import { connectLive } from '/lib/live.js';
import { watchLink, timedFetch } from '/lib/link.js';
import { Meters, FLOOR_DB, fmtDur, tierPhrase } from '/lib/meter.js';
import { VUMeters } from '/lib/vu.js';
import { Ribbon } from '/lib/ribbon.js';
import { TakesList } from '/lib/takes.js';
import { initWakeLock } from '/lib/wakelock.js';
import { initPhone } from '/lib/phone/recorder.js';
import { initHelp } from '/lib/help/help.js';
import { toast, takeNextToast } from '/lib/toast.js';
import { newest, fold, membersOf } from '/lib/shelf.js';
import { initNav } from '/lib/nav.js';
import { pageBar } from '/lib/bar/bar.js';

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
// The capture error on screen, since when, and whether it has been toasted:
// once per failure, so a 2-second poll does not re-toast it forever; cleared
// on recovery, so a repeat failure toasts again.
let captureErr = { text: '', since: 0, shown: false };
const CAPTURE_ERR_HOLD_MS = 3500;

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
  const opts = [];
  if (ringSeconds >= 30) opts.push({ s: 30, label: '30s' });
  if (ringSeconds >= 120) opts.push({ s: 120, label: '2m' });
  if (ringSeconds >= 420) opts.push({ s: 420, label: '7m' });
  opts.push({ s: 0, label: `Full ${fmtDur(ringSeconds)}` });

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
    vuMeters = new VUMeters(el.vu, { labels });

    el.chanSaving.textContent = s.save_channels.join(' & ');
    el.chanDevice.textContent = s.device || 'no device';
  }

  const healthy = s.capture_healthy;
  // An interface that's switched off, or still booting, isn't an error: the
  // Pi keeps trying and picks it up the moment it appears.
  const waiting = !healthy && s.capture_waiting;
  el.healthDot.className = `dot ${healthy ? 'ok' : waiting ? 'wait' : 'bad'}`;

  // The bar is narrow and device errors are long ("Illegal combination of I/O
  // devices" and friends), so it carries a short status only. The full text
  // goes to a toast, which has the width for it, and to the title for a hover.
  const detail = healthy ? '' : (s.last_error || '');
  el.healthText.textContent = healthy ? 'recording'
    : waiting ? 'waiting for the interface'
      : (detail ? 'capture error' : 'no capture');
  el.healthText.title = detail;

  // Only once it has stood for a few seconds: switching the interface off
  // first reads as a stalled stream, then as waiting, and the stall on the
  // way there is not worth a red toast.
  const errNow = detail && !waiting ? detail : '';
  if (errNow !== captureErr.text) captureErr = { text: errNow, since: Date.now(), shown: false };
  else if (errNow && !captureErr.shown && Date.now() - captureErr.since >= CAPTURE_ERR_HOLD_MS) {
    captureErr.shown = true;
    toast(errNow, 'bad', 8000);
  }
  if (s.version) $('version').textContent = s.version;

  el.vizWrap.classList.toggle('stale', !healthy);

  el.statBuffered.textContent = fmtDur(Math.round(s.buffered_seconds));
  el.statBuffered.className = s.buffered_seconds < 5 ? 'v warn' : 'v';

  const free = s.disk_free_gb;
  // No decimal past 100 GB: the tile is 78px at 390px wide and "128.4 GB"
  // clips there, while a tenth of a gigabyte means nothing on a "do I have
  // room" readout. Only reachable on a bigger card than this Pi has.
  el.statDisk.textContent = `${free >= 100 ? free.toFixed(0) : free.toFixed(1)} GB`;
  el.statDisk.className = free < s.min_free_gb ? 'v bad' : free < s.min_free_gb * 3 ? 'v warn' : 'v';

  el.statXruns.textContent = String(s.xruns);
  el.statXruns.className = s.xruns > 0 ? 'v warn' : 'v';

  // A dash means "no defensible reading", which covers three real states: the
  // EP unplugged, the EP present with clock-send switched off (it ships off,
  // and that looks exactly like firmware that cannot send clock), and a room
  // that has been quiet too briefly to fill two quarter notes.
  el.statTempo.textContent = s.midi_bpm == null ? '\u2013' : s.midi_bpm.toFixed(1);
  el.statTempo.className = s.midi_connected ? 'v' : 'v warn';

  // Which MIDI devices are open right now. The Orchid can enumerate as a
  // power sink rather than a MIDI device if it is connected before it has
  // booted; this line is how you tell, from the couch, that it did not.
  const devs = (s.midi_devices || []).filter((d) => d.connected);
  el.midiDevices.textContent = devs.length
    ? devs.map((d) => d.clock ? `${d.name} (clock)` : d.name).join(', ')
    : 'none';

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
  toast(`Took back ${name}: it’s in Recently deleted`, 'ok', { action: { label: 'Restore', run: () => { tookBack.delete(name); takes.restore([name]); } } });
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
    savedToast(`Saved ${body.name}`, body.name);
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
np = pageBar({ tapes: initNav(), onToast: toast });

initPhone({
  button: $('phone-btn'),
  sheet: $('phone-sheet'),
  toast,
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
      toast(body.error || 'could not flag', 'bad');
      return;
    }
    ribbon.poll(); // draw the new tick without waiting for the next poll
  } catch {
    toast('could not flag', 'bad');
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
    const sel = status.save_channels.map((c) => c - 1);
    const last = f.bins?.[f.bins.length - 1];
    const rms = sel.map((c) => last?.rms?.[c] ?? FLOOR_DB);
    const peak = sel.map((c) => f.peak?.[c] ?? FLOOR_DB);
    const clip = sel.map((c) => f.clip?.[c] ?? false);
    mainMeters.update(rms, peak, clip);
    vuMeters?.update(rms, peak, clip);
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
