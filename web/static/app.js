// Hindsight — app entry / Capture view.

import { connectLive } from '/lib/live.js';
import { watchLink, timedFetch } from '/lib/link.js';
import { Meters, fmtDur, tierPhrase, captureTiers, frameLevels, readouts, heldError } from '/lib/meter.js';
import { VUMeters } from '/lib/objects/vu.js';
import { Ribbon } from '/lib/objects/ribbon.js';
import { TakesList } from '/lib/takes.js';
import { initWakeLock } from '/lib/wakelock.js';
import { initPhone } from '/lib/phone/recorder.js';
import { ensureSheets } from '/lib/shell/sheets.js';
import { initHelp } from '/lib/help/help.js';
import { toast as defaultToast, takeNextToast } from '/lib/toast.js';
import { say, named } from '/lib/rooms/words.js';
import { takeTitle } from '/lib/rooms/takename.js';
import { newest, fold, membersOf } from '/lib/shelf.js';
import { initNav } from '/lib/nav.js';
import { pageBar, takesFinder } from '/lib/bar/engine.js';

// A take is named as its spine names it, not by its file.
const nameOf = (name, seconds) => takeTitle(name, seconds);

export function mountCapture(ctx = null) {
  const $ = (id) => document.getElementById(id);

  const el = {
    awake: $('awake'),
    healthDot: $('health-dot'),
    healthText: $('health-text'),
    vizWrap: $('capture-viz-wrap') || $('viz-wrap'),
    meters: $('capture-meters') || $('meters'),
    vu: $('capture-vu') || $('vu'),
    chanDiag: $('capture-chan-diag') || $('chan-diag'),
    chanGrid: $('capture-chan-grid') || $('chan-grid'),
    chanSaving: $('capture-chan-saving') || $('chan-saving'),
    chanDevice: $('capture-chan-device') || $('chan-device'),
    statBuffered: $('stat-buffered'),
    statDisk: $('capture-stat-disk') || $('stat-disk'),
    statXruns: $('capture-stat-xruns') || $('stat-xruns'),
    statTempo: $('capture-stat-tempo') || $('stat-tempo'),
    midiDevices: $('capture-midi-devices') || $('midi-devices'),
    durSeg: $('capture-dur-seg') || $('dur-seg'),
    markBtn: $('capture-mark-btn') || $('mark-btn'),
    captureBtn: $('capture-btn'),
    capWord: $('cap-word'),
    capSub: $('cap-sub'),
    lastSaved: $('last-saved'),
    phoneBtn: $('capture-phone-btn') || $('phone-btn'),
    takes: $('capture-takes') || $('takes'),
    takesEmpty: $('capture-takes-empty') || $('takes-empty'),
    allTakes: $('all-takes'),
    allCount: $('all-count'),
    toasts: $('toasts'),
    rbSel: $('capture-rb-sel') || $('rb-sel'),
  };

  const toast = ctx?.toast || defaultToast;

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
  let np = ctx?.engine?.bar || null;

  const navigateTo = (url) => {
    if (ctx?.go) ctx.go(url);
    else location.assign(url);
  };

  const takes = new TakesList(el.takes, el.takesEmpty, {
    onToast: toast,
    onListChange: () => { if (el.allCount) el.allCount.textContent = takes.all.length ? String(takes.all.length) : ''; },
    shape: (all) => {
      const f = fold(all);
      const top = newest(f.shelf, shelfCount());
      return [{ label: '', takes: top, members: membersOf(f, top) }];
    },
    stepOrder: 'all',
    spines: true,
    spineAction: 'play',
    // A hold opens the take on the takes page, to name it, star it, open it.
    onSpineHold: (name) => navigateTo(`/takes.html?take=${encodeURIComponent(name)}`),
    // A spine pressed plays its take in the now-playing bar; when it plays to
    // its end, or ⏏, the bar goes back to the tape.
    onPlay: async (name) => {
      if (!np) return;
      const t = takes.all.find((x) => x.name === name);
      const p = t && await takes.player(name);
      if (p) np.loadTake(t, p);
    },
    onEnded: (name) => { if (np && np.takeName === name && !np.looping) np.backToTape(); },
    audioFor: (t) => (np ? np.audioFor(t) : null),
  });

  if (ctx?.on) {
    ctx.on(shelfWide, 'change', () => takes.reshape());
    ctx.on(shelfBench, 'change', () => takes.reshape());
  } else {
    for (const m of [shelfWide, shelfBench]) m.addEventListener('change', () => takes.reshape());
  }

  // A take deleted from its own page comes back here with its Undo.
  function showNextToast() {
    const next = takeNextToast();
    if (!next) return;
    const opts = next.restore ? { action: { label: 'Undo', run: () => takes.restore([next.restore]) } } : {};
    toast(next.msg, next.kind || 'ok', opts);
  }
  showNextToast();

  const handlePageShow = (e) => {
    if (!e.persisted) return;
    showNextToast();
    pollTakes(true);
  };

  if (ctx?.on) {
    ctx.on(window, 'pageshow', handlePageShow);
  } else {
    window.addEventListener('pageshow', handlePageShow);
  }

  // ---------------------------------------------------------------- status

  function buildDurations(ringSeconds) {
    const opts = captureTiers(ringSeconds);

    // Prefer 30s; otherwise the shortest available.
    if (!opts.some((o) => o.s === selSeconds)) selSeconds = opts[0].s;

    if (!el.durSeg) return;
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
        if (el.capSub) el.capSub.textContent = tierPhrase(selSeconds, ringSeconds);
      });
      el.durSeg.appendChild(b);
    }
    if (el.capSub) el.capSub.textContent = tierPhrase(selSeconds, ringSeconds);

    ribbon?.setSpans(opts.map((o) => o.s));
    ribbon?.setSelected(selSeconds);
  }

  function buildChannelStrip(channels, saveChannels) {
    if (!el.chanGrid) return;
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
      if (el.meters) mainMeters = new Meters(el.meters, { labels, selected: [] });
      el.vu?.replaceChildren();
      // Off the ticker before its nodes go, or the old needles keep being
      // stepped in a DOM nobody can see.
      vuMeters?.destroy();
      if (el.vu) vuMeters = new VUMeters(el.vu, { labels });

      if (el.chanSaving) el.chanSaving.textContent = s.save_channels.join(' & ');
      if (el.chanDevice) el.chanDevice.textContent = s.device || 'no device';
    }

    const r = readouts(s);
    const healthy = s.capture_healthy;
    if (el.healthDot) el.healthDot.className = `dot ${r.health.state}`;

    // The bar is narrow, so it carries the short status only; the full text
    // goes to a toast (heldError) and to the title for a hover.
    if (el.healthText) {
      el.healthText.textContent = r.health.text;
      el.healthText.title = r.health.detail;
    }

    const held = heldError(captureErr, r.health.error, Date.now());
    captureErr = held.state;
    if (held.show) toast(held.show, 'bad', 8000);

    el.vizWrap?.classList.toggle('stale', !healthy);

    if (el.statBuffered) {
      el.statBuffered.textContent = fmtDur(Math.round(s.buffered_seconds));
      el.statBuffered.className = s.buffered_seconds < 5 ? 'v warn' : 'v';
    }

    // The readings, and how worried to be about each (lib/meter.js readouts).
    for (const [node, v] of [[el.statDisk, r.disk], [el.statXruns, r.xruns], [el.statTempo, r.tempo]]) {
      if (node) {
        node.textContent = v.text;
        node.className = v.level ? `v ${v.level}` : 'v';
      }
    }

    if (el.midiDevices) el.midiDevices.textContent = r.midi;

    // A save taken back with its toast's Undo isn't the last one kept.
    if (el.lastSaved) el.lastSaved.textContent = (s.last_saved && !tookBack.has(s.last_saved) && s.last_saved) || 'none';

    if (el.captureBtn) el.captureBtn.disabled = !healthy || s.saving;
    // The word changes with the state; what it catches only matters when it can.
    if (el.capWord) {
      if (s.saving) el.capWord.textContent = 'Saving…';
      else if (!healthy) el.capWord.textContent = 'No input';
      else el.capWord.textContent = 'Capture';
    }
    if (el.capSub) el.capSub.hidden = !healthy || !!s.saving;

    // Not `healthy`: an interface can be powered off with a full buffer still
    // in memory, and marking a moment in audio you can still capture is the
    // point of the feature.
    if (el.markBtn) el.markBtn.disabled = !s.buffered_seconds;

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
      if (el.healthDot) el.healthDot.className = 'dot bad';
      if (el.healthText) el.healthText.textContent = 'server unreachable';
      if (el.captureBtn) el.captureBtn.disabled = true;
      if (el.markBtn) el.markBtn.disabled = true;
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

  const handlePageHide = () => {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* fine */ }
  };
  if (ctx?.on) {
    ctx.on(window, 'pagehide', handlePageHide);
  } else {
    window.addEventListener('pagehide', handlePageHide);
  }

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
        { label: 'Name it', run: () => navigateTo(`/takes.html?take=${encodeURIComponent(name)}`) },
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
    toast(`Took back ${named(nameOf(name))}: it’s in Recently deleted`, 'ok', { action: { label: 'Restore', run: () => { tookBack.delete(name); takes.restore([name]); } } });
    pollTakes(true);
    pollStatus();
  }

  async function capture() {
    const btn = el.captureBtn;
    if (!btn) return;
    // A tick under the thumb as it goes, and two when it's on the shelf: the
    // phone is often in a pocket or on a stand, and the toast is easy to miss.
    // Android only; iOS has no vibrate, and that must not matter.
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    btn.disabled = true;
    if (el.capWord) el.capWord.textContent = 'Saving…';
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
      savedToast(`Saved ${named(nameOf(body.name, body.seconds))}`, body.name);
      saved = true;
      try { navigator.vibrate?.([12, 70, 12]); } catch { /* no haptics here */ }
      await pollTakes(true);
      await pollStatus();
    } catch (e) {
      toast(`Capture failed: ${e.message}`, 'bad', 7000);
    } finally {
      if (el.capWord) el.capWord.textContent = 'Capture';
      btn.disabled = false;
      // The key glows a moment once it's back: it caught something. (While
      // it's disabled, refreshing the list, its glow wouldn't show.)
      if (saved) {
        btn.classList.add('saved');
        setTimeout(() => btn.classList.remove('saved'), 1200);
      }
    }
  }

  el.captureBtn?.addEventListener('click', capture);

  if (!ctx) {
    initHelp({ page: 'main' });
    np = pageBar({ tapes: initNav(), onToast: toast, find: takesFinder(takes) });
  }

  // In the shell the phone's sheet is in the Studio's template, not the page.
  ensureSheets(document, 'studio-sheets-tpl');
  initPhone({
    button: el.phoneBtn,
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
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/flag', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error || say('could not flag'), 'bad');
        return;
      }
      ribbon?.poll(); // draw the new tick without waiting for the next poll
    } catch {
      toast(say('could not flag'), 'bad');
    } finally {
      // The next status poll re-enables it if audio is still buffered; this
      // just guards against a second click landing mid-request.
      btn.disabled = !status?.buffered_seconds;
    }
  }

  el.markBtn?.addEventListener('click', mark);

  // ---------------------------------------------------------------- live

  if (el.vizWrap) {
    ribbon = new Ribbon(el.vizWrap, {
      onToast: toast,
      onSavedToast: savedToast,
      selBar: el.rbSel,
      flagSheet: $('rb-flag-sheet'),
      onSaved: (name) => {
        takes.markFresh(name);
        pollTakes(true);
      },
    });
  }

  // The Pi, heard or not: the live meters and the status poll both report here.
  // Back from sleep (or a dropped network) the page asks again at once; the
  // meters' socket replaces itself (lib/live.js).
  const link = ctx?.shared?.link || watchLink(() => {
    pollStatus();
    pollTakes();
  });

  let liveHandle = null;
  function startLive() {
    if (liveHandle) return;
    liveHandle = connectLive({
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
  }

  function stopLive() {
    liveHandle?.close?.();
    liveHandle = null;
  }

  startLive();

  // ---------------------------------------------------------------- loops

  pollStatus().then(() => pollTakes(true));

  if (ctx?.every) {
    ctx.every(pollStatus, 2000);
    ctx.every(() => pollTakes(), 5000);
  } else {
    setInterval(pollStatus, 2000);
    setInterval(() => pollTakes(), 5000);
  }

  // Keep the screen awake while docked on a charger. Charging-only, so a phone
  // on battery is untouched. Like the service worker below, this needs a secure
  // context, so it engages on the tailnet HTTPS name and not over plain HTTP.
  initWakeLock({
    onChange: (held) => {
      if (el.awake) el.awake.hidden = !held;
    },
  });

  if (!ctx && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  return {
    show({ first } = {}) {
      startLive();
      if (!first) {
        pollStatus().then(() => pollTakes(true));
      }
    },
    hide() {
      stopLive();
    },
    destroy() {
      stopLive();
      vuMeters?.destroy?.();
      ribbon?.destroy?.();
    },
  };
}

if (typeof document !== 'undefined' && !document.getElementById('view-capture') && document.getElementById('capture-btn')) {
  mountCapture();
}
