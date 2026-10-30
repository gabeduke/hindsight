// web/static/lib/wave/page.js
// The take page: it owns the take's editable state (selection, flags, grid,
// playhead), hands it to the view to paint, and saves changes through the
// sidecar API. The view and the clock own no take state of their own.
//
// The words follow the editing model: a *selection* is In to Out (the API
// still calls it trim); Repeat is a toggle, off when the page opens; KEEP
// writes the selection as a new take; More's Share sends it as an MP3.
import { TileCache } from './tiles.js';
import { WaveView } from './view.js';
import { Overview } from './overview.js';
import { Clock } from './clock.js';
import { PlayWindow } from './playwindow.js';
import { Lanes } from './lanes.js';
import { RisingNotes } from './rising.js';
import { looksLikeMP3, canShareFiles, shareOrDownload, gainText } from './share.js';
import {
  barBeat, fmtTime, fmtClock, fmtPoint, clampRegion, fmtRegionLength,
  SNAPS, SNAP_LABELS, initialSnap, tempoLabel, snapOnTempo, tempoPending, nudgeFrame, placeDownbeat, nudgeDownbeat, adoptDownbeat, snapFrame, snapStep, setPoint, 
} from './geometry.js';
import {
  viewAbout, stepFrames, stepLabel, placeEdge, fmtSample, beatOffset, fmtOffset, crossedLine,
  snapRadius, playFrom,
} from './boundary.js';
import { NearAudio } from './near.js';
import { findAttack, findZero } from './onset.js';
import { MIN_FPP } from '../edit/gestures.js';
import { GESTURE } from '../ui/press.js';
import { setIcon } from '../ui/icons.js';
import { EditorBar } from '../edit/editor-bar.js';
import { levelsFor, takeGain } from './draw.js';
import { drawTrace } from './tape-strip.js';
import { flagRequest, asFlags, newFlagId } from '../flags.js';
import { holdScreen } from '../wakelock.js';
import { initHelp } from '../help/help.js';
import { showPresses } from '../ui/keys.js';
import { named } from '../rooms/words.js';
import { toast, toastNext, takeNextToast, undoSkipped, undoPhrase } from '../toast.js';
import { restoreTake, stepPast, putBack } from '../trash.js';
import { withClient } from '../client.js';
import { token, withAlpha, onSchemeChange } from '../theme.js';
import { listFrom, fold, familyOf, dropoutsText } from '../shelf.js';
import { takeTitle } from '../rooms/takename.js';
import { cutLabel } from './cut-label.js';
import { initNav } from '../nav.js';
import { ReelWindow, peakDbAt } from '../objects/reel-window.js';
import { takeCounter } from '../objects/lcd.js';
import { initPlayer } from '../bar/player.js';
import { measureBar, hereWord, deviceOf } from '../bar/slots.js';
import { takeDisplay } from '../bar/display.js';
import { layersOf } from '../ui/layers.js';
import { menu, barTop } from '../ui/menu.js';
import { pageCarry, takePageState, startOpen } from '../bar/carry.js';
import { timedFetch, watchLink } from '../link.js';
import { start as startRoom } from '../room/mount.js';
import { createTakes } from '../models/takes.js';

// Mirrors audio.MaxRenderSeconds: the server's cap on a share render.
const MAX_SHARE_SECONDS = 600;
const SPEEDS = [0.5, 1, 2];

const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get('file');
// The page's takes (lib/models/takes.js), for ◂ ▸, the spine a save sits
// under and Open's family lines: asked for as they are needed, since this
// page has no changes socket to say when the list moved.
const takes = createTakes();


function fail(msg) {
  $('wave-error').textContent = msg;
  $('wave-error').hidden = false;
  $('wave-canvas').hidden = true;
  $('np').hidden = true; // nothing to play: the bar's keys would be dead
}

// Mirrors the server's render filename sanitiser (internal/audio/render.go).
function safeStem(base) {
  return base.replace(/[^\p{L}\p{N} \-_.]/gu, '').trim() || 'take';
}

const stemOf = (name) => (name || '').replace(/\.wav$/, '');

// hopTo opens another take in this one's place: replace, not a new entry, so
// Back from any take in a run of the take menu's Previous and Next (or of
// deletes) still goes straight to the list (see the back button in main).
function hopTo(name) {
  try { sessionStorage.setItem('hindsight.hop', '1'); } catch {}
  location.replace(`/wave.html?file=${encodeURIComponent(name)}`);
}

// untrash is a trashed take's Undo, on the take after it: back from the
// trash, back in the list's order where it was, and open again.
async function untrash(q) {
  try {
    await restoreTake(q.restore);
  } catch (e) {
    toast(`Could not restore: ${e.message}`, 'bad');
    return;
  }
  try {
    const order = JSON.parse(sessionStorage.getItem('hindsight.order') || 'null');
    sessionStorage.setItem('hindsight.order', JSON.stringify(putBack(order, q.restore, q.at ?? -1)));
  } catch {}
  toastNext({ msg: 'Restored, starred' });
  hopTo(q.restore);
}

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

async function main() {
  // The page's link to the Pi; the real one is made once the page is up.
  let link = { ok() {}, fail() {} };
  // What Open hears of each redraw (lib/room/open.js).
  const openHooks = new Set();
  // What Open hears of a tapped pin, and of F, the keyboard's ✎.
  const pinHooks = new Set();
  const noteKeyHooks = new Set();
  if (!file) {
    // A tape opens in the Studio, where tapes live (?tape=ID). The Studio
    // shows the tape it has loaded, and offers the rest from its own list.
    if (new URLSearchParams(location.search).get('tape')) {
      location.replace('/tape.html');
      return;
    }
    return fail('No take given.');
  }
  initHelp({ page: 'take', toast });
  showPresses(document); // every key goes down the moment it is touched
  // Open is outside the shell, so it has a stack of open things of its own
  // (lib/ui/layers.js): ☰ and the phone's player close on it.
  initNav(document, { layers: layersOf(document) });
  // A take trashed on the page before this one: "Deleted … · Undo", and its
  // Undo opens it again, where it was in the list's order.
  const queued = takeNextToast();
  if (queued) toast(queued.msg, queued.kind || 'ok', queued.restore ? { action: { label: 'Undo', run: () => untrash(queued) } } : {});
  const [takeRes, peaksRes] = await Promise.all([
    // Not from the cache: Back onto a take deleted since must say it's gone.
    fetch(`/api/take?file=${encodeURIComponent(file)}`, { headers: withClient(), cache: 'no-store' }),
    fetch(`/api/peaks?file=${encodeURIComponent(file)}`),
  ]);
  if (takeRes.status === 404) return fail('That take is gone.');
  if (!takeRes.ok) return fail('Could not load the take.');
  const take = await takeRes.json();
  let previewReady = !!take.has_preview;
  if (!peaksRes.ok) return fail('This take has no waveform yet. Try again in a moment.');
  const filePeaks = await peaksRes.json();

  const sr = take.sample_rate || 48000;
  const total = Math.round(take.duration_seconds * sr);
  const minLen = Math.floor(sr * 3 / 1000) * 2 + 1;

  // Whether the snap is one chosen before, not the default for the take.
  let snapChosen = SNAPS.includes(readPref('wave.snap', null));

  // Save as take's name field (below): here, ahead of the first calls of
  // renderSelection and renderHeader, which keep an open field in step.
  const saveForm = $('save-name'), saveInput = $('save-name-input');
  let offered = ''; // the name the field was last filled with
  let saving = false; // a cut on its way: the field can't close or save again

  // --- state (the page owns it; the views read it each draw) -------------
  // Level (step C5, below): declared here, as Share's label reads it.
  let levelOn = readPref('wave.level', 'off') === 'on';
  let levelDb = 0;
  let levelRead = true; // the last read of the level worked
  let refreshShareLabel = () => {}; // Share's label, once Share is wired
  const state = {
    region: take.trim ? { start: take.trim.start_frame, end: take.trim.end_frame } : null,
    pending: null, // a lone In or Out waiting for its other half
    flags: asFlags(take.flags),
    dropouts: take.dropouts || [], // where the capture lost audio: set at save, never edited
    grid: { bpm: take.bpm || null, sampleRate: sr, downbeat: take.downbeat_frame || 0 },
    snap: initialSnap(readPref('wave.snap', null), !!take.bpm),
    cursor: PlayWindow.of(take).opening, // a take opens at In, ready to play its selection
    selectedFlag: null,
    loop: false, // off on every open (editing model, decision 1)
    // The boundary being edited, if any: { edge: 'start' | 'end' | 'downbeat',
    // seam, side } -- see "the boundary editor" below. The view reads it.
    edit: null,
  };

  // --- pieces --------------------------------------------------------------
  const canvas = $('wave-canvas');
  const tiles = new TileCache({
    file, totalFrames: total, filePeaks,
    onChange: () => view.draw(),
    onGone: () => fail('That take is gone.'),
  });
  // Declared before the view: WaveView's constructor fits, which emits
  // 'viewChange' synchronously, and these must exist (as null) by then.
  let overview = null;
  let lanes = null;
  let notes = null;
  // The piano roll draws while MIDI ▸ is open.
  let midiOpen = false;
  function syncNotes() {
    if (!notes) return;
    if (midiOpen && clock.playing) notes.start();
    else { notes.stop(); if (midiOpen) notes.draw(); }
  }
  function redraw() {
    view.draw();
    if (overview) overview.draw();
    if (lanes) lanes.draw();
    if (notes && !notes.running && midiOpen) notes.draw();
    for (const f of openHooks) f();
  }
  // Canvases don't restyle themselves when the device turns dark or light.
  // The overview caches its waveform, so that cache goes too.
  onSchemeChange(() => { if (overview) overview.cachedKey = null; redraw(); });
  // IN and OUT are written in marker; paint again once the face has loaded.
  document.fonts?.load('18px "Permanent Marker"').then(() => redraw()).catch(() => {});
  const view = new WaveView({ canvas, tiles, totalFrames: total, sampleRate: sr, getState: () => state, emit });
  overview = new Overview({
    canvas: $('overview-canvas'), filePeaks, totalFrames: total,
    getState: () => state, getView: () => view.view,
    emit: (ev, p) => {
      if (ev === 'panTo') view.panTo(p.start);
      else if (ev === 'seek') { seekTo(p.frame); if (!state.edit) view.follow(p.frame); }
      else if (ev === 'fitAll') view.fitAll();
    },
  });

  // The server always names the preview, but the mp3 is encoded in the
  // background after a save or cut and may not exist yet.
  const previewUrl = take.preview_name ? `/api/download?file=${encodeURIComponent(take.preview_name)}` : '';
  let screenLock = null;
  const clock = new Clock({
    previewUrl,
    sampleRate: sr, file,
    playWindow: () => new PlayWindow(state.region),
    onTick: (frame) => {
      state.cursor = frame;
      // Keep the playhead in view while it plays, unless a finger is busy.
      // Not while a boundary is being edited: the view stays on the point.
      if (clock.playing && !view.gesture && !state.edit) view.follow(frame);
      updateReadout(); redraw();
    },
    onError: (m) => toast(m, 'bad'),
    onEnded: () => { syncTransport(); syncNotes(); },
  });
  // The bar's reel window: the take's reels turn with the playhead, and the
  // LCD's two level bars read the take's peaks under it (left and right).
  const reels = new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
  initPlayer();
  measureBar($('np'));
  const gain = takeGain(filePeaks);
  const lcdInk = 'var(--lcd-ink)';
  reels.setLevels(Array.from({ length: Math.min(2, filePeaks.channels) }, () => lcdInk),
    (frame) => peakDbAt(filePeaks, frame / total, gain));
  function feedReels() {
    // The take's own rate: polled every frame, the reels follow the clock
    // at any practice speed without running on ahead of it.
    reels.poll({ heard: state.cursor, playing: clock.playing, length: total, sampleRate: sr });
  }
  function previewLanded() {
    if (previewReady) return;
    previewReady = true;
    clock.reloadPreview();
  }
  if (!previewReady) {
    let tries = 0;
    const poll = setInterval(async () => {
      if (previewReady || ++tries > 60) { clearInterval(poll); return; }
      try {
        const res = await fetch(`/api/take?file=${encodeURIComponent(file)}`, { cache: 'no-store' });
        if (res.ok && (await res.json()).has_preview) previewLanded();
      } catch {}
    }, 2000);
  }

  // The measurement of the take's audio lands a few seconds after the save
  // that made it. A page opened before then has the clock's tempo, and Send
  // to tape would give the tape that, so it looks again until the tempo is
  // settled. Nothing is applied while a save of ours is still on its way, or
  // once the tempo was edited here: an edit always wins.
  if (tempoPending(take.tempo_from)) {
    let tries = 0;
    const poll = setInterval(async () => {
      if (!tempoPending(take.tempo_from) || ++tries > 30) { clearInterval(poll); return; }
      if (savesInFlight > 0) return;
      try {
        const res = await fetch(`/api/take?file=${encodeURIComponent(file)}`, { cache: 'no-store', headers: withClient() });
        if (!res.ok) return;
        const fresh = await res.json();
        if (savesInFlight > 0 || !tempoPending(take.tempo_from) || tempoPending(fresh.tempo_from)) return;
        applyTake(fresh);
      } catch {}
    }, 2000);
  }

  // --- sidecar patches ----------------------------------------------------
  // Saves still on their way to the Pi. A refetch that lands meanwhile would
  // put older values back on screen, so it waits for them (see refetchTake).
  let savesInFlight = 0;
  let refetchWanted = false;
  function track(p) {
    savesInFlight++;
    return p.finally(() => {
      if (--savesInFlight > 0) return;
      for (const r of idleWaiters.splice(0)) r();
      if (refetchWanted) { refetchWanted = false; refetchTake(); }
    });
  }
  // PATCHes go one at a time, in order: a Clear sent straight after a
  // selection's save must reach the Pi after it, not race it.
  let patchChain = Promise.resolve();
  // keepalive lets a save outlive the page (a move committed at pagehide).
  function patch(body, { keepalive = false } = {}) {
    const run = patchChain.then(async () => {
      const res = await fetch(`/api/take?file=${encodeURIComponent(file)}`, {
        method: 'PATCH', headers: withClient({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), keepalive,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `status ${res.status}`);
      }
      const b = await res.json();
      if (b.undo) setUndo(b.undo);
      return b;
    });
    patchChain = run.catch(() => {});
    return track(run);
  }
  let regionTimer = 0;
  let pendingTrim = null; // the body the debounced save will send, if any
  function saveRegion() {
    clearTimeout(regionTimer);
    pendingTrim = { trim: state.region ? { start_frame: state.region.start, end_frame: state.region.end } : null };
    regionTimer = setTimeout(() => {
      const body = pendingTrim;
      pendingTrim = null;
      patch(body).catch((e) => toast(`Could not save the selection: ${e.message}`, 'bad'));
    }, 300);
  }
  // A selection made and then navigated away from within the debounce would
  // be lost. sendBeacon cannot PATCH, so this is a keepalive fetch.
  function flushRegion() {
    if (!pendingTrim) return;
    clearTimeout(regionTimer);
    const body = pendingTrim;
    pendingTrim = null;
    track(fetch(`/api/take?file=${encodeURIComponent(file)}`, {
      method: 'PATCH', headers: withClient({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body), keepalive: true,
    })).catch(() => {});
  }
  function saveDownbeat() {
    clearTimeout(downbeatTimer); downbeatPending = false;
    // keepalive, as flushRegion's: a bar-1 move committed at pagehide must not be dropped.
    patch({ downbeat_frame: state.grid.downbeat }, { keepalive: true }).catch((e) => toast(`Could not save the downbeat: ${e.message}`, 'bad'));
  }
  // Holding a nudge moves bar 1 many times a second: one save, and so one
  // undo step, once the hand settles.
  let downbeatTimer = 0;
  let downbeatPending = false;
  function saveDownbeatSoon() {
    clearTimeout(downbeatTimer);
    downbeatPending = true;
    downbeatTimer = setTimeout(saveDownbeat, 300);
  }
  function flushDownbeat() { if (downbeatPending) saveDownbeat(); }
  // One flag per request, by id (see /lib/flags.js), sent in order. The page
  // shows the change at once; the server's answer then replaces the list.
  function flagOp(op, args, then) {
    return track(flagRequest(file, op, args)).then((b) => {
      if (b.undo) setUndo(b.undo);
      if (b.cue_error) toast(b.cue_error, 'bad');
      else then?.(b);
      const keep = state.selectedFlag && state.selectedFlag.id;
      state.flags = asFlags(b.flags);
      if (keep) state.selectedFlag = state.flags.find((f) => f.id === keep) || null;
      redraw();
    }).catch((e) => {
      toast(`Could not save flags: ${e.message}`, 'bad');
      refetchTake();
    });
  }
  // The take as the server has it now, merged in: flags, name, star, tempo
  // and downbeat, and the selection unless an edit of ours is waiting. Called
  // when the page comes back into view and after a failed flag edit.
  async function refetchTake() {
    if (savesInFlight > 0) { refetchWanted = true; return; }
    let fresh;
    try {
      const res = await timedFetch(`/api/take?file=${encodeURIComponent(file)}`, { cache: 'no-store', headers: withClient() });
      if (!res.ok) { link.ok('take'); return; } // the Pi answered
      fresh = await res.json();
    } catch { link.fail('take'); return; }
    link.ok('take');
    applyTake(fresh);
  }
  // Put the take as the Pi has it on screen: after a refetch, or an Undo.
  function applyTake(fresh) {
    const keep = state.selectedFlag && state.selectedFlag.id;
    state.flags = asFlags(fresh.flags);
    if (keep) state.selectedFlag = state.flags.find((f) => f.id === keep) || null;
    take.label = fresh.label;
    state.snap = snapOnTempo(state.snap, snapChosen, !!take.bpm, !!fresh.bpm);
    take.bpm = fresh.bpm;
    take.tempo_from = fresh.tempo_from;
    take.starred = fresh.starred;
    if (fresh.has_preview) previewLanded();
    state.grid.bpm = fresh.bpm || null;
    state.grid.downbeat = adoptDownbeat(fresh.downbeat_frame, state.grid.downbeat, downbeatPending);
    if (!pendingTrim) {
      const r = fresh.trim ? { start: fresh.trim.start_frame, end: fresh.trim.end_frame } : null;
      const same = (r && state.region && r.start === state.region.start && r.end === state.region.end) || (!r && !state.region);
      // Show it and re-arm the loop, but don't save: it came from the Pi.
      if (!same) { state.region = r; state.pending = null; renderSelection(); scheduleLoop(); levelSoon(); }
    }
    applyLaneKinds(fresh.lane_kinds || {});
    if (fresh.undo) setUndo(fresh.undo);
    renderHeader();
    renderEditor();
    follow(); // an Undo may have moved the point being edited
    updateReadout();
    redraw();
  }

  // --- undo -----------------------------------------------------------------
  // The Pi keeps each take's last 50 changes with the device that made them
  // (internal/audio/history.go). ↶ undoes this device's newest; a toast's
  // Undo names its own step, so it still means what it said after a later
  // edit.
  let undoInfo = take.undo || { count: 0 };
  function setUndo(u) {
    undoInfo = u;
    const b = $('take-undo');
    b.disabled = !u.count;
    const what = u.count ? `Undo ${undoPhrase(u.next)}` : 'Nothing to undo';
    b.title = what;
    b.setAttribute('aria-label', what);
  }
  setUndo(undoInfo);
  // Saves still on their way go first, so Undo acts on what's on screen.
  let idleWaiters = [];
  function whenSaved() {
    bar.commit(); // a move still being made is saved first, so Undo undoes it
    flushDownbeat();
    if (pendingTrim) { const body = pendingTrim; pendingTrim = null; clearTimeout(regionTimer); patch(body).catch(() => {}); }
    return savesInFlight ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve();
  }
  // Undos go one at a time: a toast's Undo tapped during ↶'s waits its turn
  // rather than being dropped.
  let undoChain = Promise.resolve();
  function undo(op) {
    undoChain = undoChain.then(() => undoNow(op));
    return undoChain;
  }
  async function undoNow(op) {
    $('take-undo').disabled = true;
    try {
      await whenSaved();
      const q = op ? `&op=${encodeURIComponent(op)}` : '';
      const res = await fetch(`/api/take/undo?file=${encodeURIComponent(file)}${q}`, { method: 'POST', headers: withClient() });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `status ${res.status}`);
      // An edit made while this was on its way is newer than this answer:
      // fetch the take again once it lands, rather than show the older one.
      if (savesInFlight > 0) { refetchWanted = true; if (b.undo) setUndo(b.undo); }
      else if (b.take) applyTake({ ...b.take, undo: b.undo });
      else if (b.undo) setUndo(b.undo);
      if (b.cue_error) toast(b.cue_error, 'bad');
      if (b.skipped) toast(undoSkipped(b.skipped), 'warn');
      else toast(`Undone: ${undoPhrase(b.undone)}`, 'ok', { ms: 2500 });
    } catch (e) {
      toast(`Could not undo: ${e.message}`, 'bad');
      refetchTake(); // what Undo would do now, from the Pi
    }
  }
  $('take-undo').addEventListener('click', () => undo());

  // --- the loop -----------------------------------------------------------
  // Loop on: the selection repeats, sample-exact, through a decoded slice.
  // Loop off: playback runs from the playhead through the selection and on.
  let loopTimer = 0;
  async function applyLoop() {
    clearTimeout(loopTimer);
    const want = state.loop && state.region ? state.region : null;
    if (want && clock.loop && clock.loop.start === want.start && clock.loop.end === want.end) return;
    if (!want && !clock.loop) return;
    try {
      await clock.setLoop(want);
    } catch (e) {
      toast(`Could not loop: ${e.message}`, 'bad');
    }
  }
  // Holding a nudge changes the selection many times a second; only the one
  // the hand settles on is worth fetching a slice for.
  function scheduleLoop() {
    clearTimeout(loopTimer);
    loopTimer = setTimeout(applyLoop, 300);
  }
  function setLoop(on) {
    state.loop = on;
    syncTransport();
    applyLoop();
    // The seam view needs the loop: turning it off leaves the seam.
    if (state.edit) { renderEditor(); redraw(); }
  }

  // --- view events --------------------------------------------------------
  let scrubResume = false;
  function emit(ev, p) {
    switch (ev) {
      case 'seek':
        seekTo(p.frame);
        break;
      case 'addFlag':
        addFlagAt(p.frame);
        break;
      // A pin is its note: Open puts the cursor in its words.
      case 'selectFlag': for (const f of pinHooks) f(p.flag); break;
      case 'flagMove': {
        const f = state.flags.find((x) => x.id === p.flag.id);
        if (!f) break;
        f.frame = p.frame;
        if (p.final) {
          state.flags.sort((a, b) => a.frame - b.frame);
          flagOp('edit', { id: f.id, frame: f.frame });
        }
        redraw();
        break;
      }
      case 'regionChange':
        state.region = p.region;
        if (p.region) state.pending = null;
        if (p.final) selectionChanged();
        else renderSelection();
        redraw();
        break;
      case 'downbeatChange':
        state.grid.downbeat = p.frame; updateReadout(); renderDownbeat(); redraw();
        if (p.final) saveDownbeat();
        break;
      // A still press on bar 1 opens it in the boundary editor.
      case 'downbeatTap': startEditing('downbeat'); break;
      // In the seam view, a tap on a half picks the side the encoders move.
      case 'seamSide':
        if (state.edit?.seam) { state.edit.side = p.side; renderEditor(); redraw(); }
        break;
      // The playhead handle is the OP-1's lifted tape head: the take goes
      // quiet while it's dragged, then carries on from where it's put down.
      case 'scrubStart':
        scrubResume = clock.playing;
        if (clock.playing) clock.pause();
        syncTransport();
        break;
      case 'scrub':
        state.cursor = p.frame; updateReadout(); redraw();
        break;
      case 'scrubEnd':
        seekTo(p.frame);
        if (scrubResume) { scrubResume = false; togglePlay(); } else syncTransport();
        break;
      case 'viewChange':
        if (overview) overview.draw();
        if (lanes) lanes.draw();
        if (state.edit) renderEditor(); // the step is named for the zoom
        break;
    }
  }

  function seekTo(frame) {
    frame = Math.max(0, Math.min(total - 1, frame));
    clock.seek(frame);
    // Seeking out of a looping selection makes the clock drop its loop; put
    // it back so Loop still means what the button says.
    if (state.loop && state.region && !clock.loop) applyLoop();
    state.cursor = frame;
    updateReadout(); redraw();
  }

  // A note and its words go in one request: added bare and then given its
  // words, the Pi's answer to the add could land after the words and blank
  // them until the edit's came back.
  function addFlagAt(frame, label = '') {
    if (state.flags.some((f) => f.frame === frame)) return;
    const id = newFlagId();
    state.flags.push({ id, frame, label });
    state.flags.sort((a, b) => a.frame - b.frame);
    flagOp('add', { id, frame, label });
    redraw();
  }

  // A selection was committed: save it, re-arm the loop, update the rows.
  function selectionChanged() {
    renderSelection();
    saveRegion();
    scheduleLoop();
    levelSoon(); // Level follows the selection
  }

  // --- Level (step C5) ---------------------------------------------------------
  // Normalize: the selection (or the whole take) brought to 1.5 dB under full
  // scale, from its peak as /api/level reads it. On, the take plays here at
  // that gain and Share sends it so, so what's heard is what's shared. It
  // follows every change of the selection (made here, cleared, an Undo, another
  // device). Remembered per device; the take is routed through the gain only
  // from a tap (Level's own, or ▶), as iOS asks.
  let levelSeq = 0;
  let levelTimer = 0;
  function renderLevel() {
    $('level').setAttribute('aria-pressed', String(levelOn));
    $('level').textContent = levelOn ? `Level ${levelRead ? gainText(levelDb) : '–'}` : 'Level';
    $('level-gain').textContent = levelOn
      ? (levelRead ? `Plays and shares ${gainText(levelDb)}` : "The level couldn't be read: playing as recorded")
      : '';
    refreshShareLabel();
  }
  async function fetchLevel() {
    const seq = ++levelSeq;
    let db = 0, ok = true;
    if (levelOn) {
      const from = state.region ? state.region.start : 0;
      const to = state.region ? state.region.end : total;
      try {
        const res = await fetch(`/api/level?file=${encodeURIComponent(file)}&from=${from}&to=${to}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `status ${res.status}`);
        db = (await res.json()).gain_db || 0;
      } catch (e) {
        ok = false;
        if (seq === levelSeq) toast(`Could not read the level: ${e.message}`, 'bad');
      }
    }
    if (seq !== levelSeq) return;
    levelDb = db;
    levelRead = ok;
    clock.setGain(db);
    renderLevel();
  }
  function levelSoon() {
    if (!levelOn) return;
    clearTimeout(levelTimer);
    levelTimer = setTimeout(fetchLevel, 300);
  }
  $('level').addEventListener('click', () => {
    levelOn = !levelOn;
    writePref('wave.level', levelOn ? 'on' : 'off');
    if (levelOn) clock.route(); // in the tap
    renderLevel();
    fetchLevel();
  });
  renderLevel();
  if (levelOn) fetchLevel();

  // --- transport ----------------------------------------------------------
  async function togglePlay() {
    if (clock.playing) {
      clock.pause();
    } else {
      // With Loop on, play starts inside the selection.
      if (state.loop && state.region && (state.cursor < state.region.start || state.cursor >= state.region.end)) {
        seekTo(state.region.start);
      }
      await clock.play();
    }
    syncTransport();
    syncNotes();
  }
  // The screen stays on while a take plays: a phone propped on a music stand
  // shouldn't lock halfway through the part being learned.
  function syncScreenLock() {
    if (clock.playing && !screenLock) screenLock = holdScreen();
    else if (!clock.playing && screenLock) { screenLock.release(); screenLock = null; }
  }
  function syncTransport() {
    const playing = clock.playing;
    setIcon($('play'), playing ? 'pause' : 'play');
    $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('play').classList.toggle('playing', playing);
    // The editor's own ▶ is a pause too, beside the point being edited.
    $('be-play').textContent = playing ? '❚❚' : '▶';
    $('be-play').setAttribute('aria-label', playing ? 'Pause' : 'Play from here');
    $('loop').setAttribute('aria-pressed', String(state.loop));
    $('loop').disabled = !state.region && !state.loop;
    updateReadout();
    // The sample-exact loop runs at 1×; practice speed is for the preview.
    const speedOff = state.loop && !!state.region;
    for (const b of $('speed').querySelectorAll('button')) b.disabled = speedOff;
    $('notes-speed').disabled = speedOff;
    syncScreenLock();
  }
  $('play').addEventListener('click', togglePlay);
  // |◂: back to In, or to the top of a take with no selection.
  $('to-start').addEventListener('click', () => {
    const at = state.region ? state.region.start : 0;
    seekTo(at);
    if (!state.edit) view.follow(at); // the view stays on a point being edited
  });
  // ↺ 5 s, or J: back five seconds, playing or not -- to hear a bit again.
  function back5() {
    // Looping, not back past In: ▶ would start at In anyway.
    const lo = state.loop && state.region && state.cursor >= state.region.start ? state.region.start : 0;
    const at = Math.max(lo, state.cursor - 5 * sr);
    seekTo(at);
    if (!state.edit) view.follow(at);
  }
  $('back5').addEventListener('click', back5);

  // The scrubber is a slider for the keyboard too: ← → a second, and Space
  // still plays (the page's Space leaves focused controls alone).
  $('overview-canvas').addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Through ▶'s own click, so help mode can answer it with ▶'s tip.
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) $('play').click(); return; }
    if (state.edit || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    e.stopPropagation();
    const at = Math.max(0, Math.min(total - 1, state.cursor + (e.key === 'ArrowRight' ? sr : -sr)));
    seekTo(at);
    view.follow(at);
  });
  // While a boundary is being edited, the arrows step the point (the page's
  // handler); a tap still moves the playhead but leaves the view on the point.
  $('loop').addEventListener('click', () => setLoop(!state.loop));

  function setSpeed(rate) {
    clock.setRate(rate);
    for (const b of $('speed').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === rate));
    $('notes-speed').textContent = rate === 0.5 ? '½×' : `${rate}×`;
  }
  for (const b of $('speed').querySelectorAll('button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.rate)));
  $('notes-speed').addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(clock.rate || 1) + 1) % SPEEDS.length]));

  // In and Out, at the playhead: the OP-1's loop points.
  function setPointAt(edge) {
    // With Snap on, In and Out land on the grid like every other edit: the
    // nearest line to the playhead, which keeps moving while it plays.
    const at = snapFrame(state.cursor, state.grid, state.snap);
    const next = setPoint(edge, at, { selection: state.region, pending: state.pending }, total, minLen);
    const changed = JSON.stringify(next.selection) !== JSON.stringify(state.region);
    state.pending = next.pending;
    state.region = next.selection;
    if (changed) selectionChanged();
    else renderSelection();
    redraw();
  }
  $('set-in').addEventListener('click', () => setPointAt('start'));
  $('set-out').addEventListener('click', () => setPointAt('end'));
  // --- selection row --------------------------------------------------------
  function setRegion(r) {
    state.region = clampRegion(r, total, minLen);
    state.pending = null;
    selectionChanged();
    redraw();
  }
  // Clear saves at once rather than after the usual pause, so its toast
  // can offer Undo for exactly this change.
  function clearSelection() {
    if (!state.region) { state.pending = null; renderSelection(); redraw(); return; }
    state.region = null;
    state.pending = null;
    renderSelection();
    scheduleLoop();
    levelSoon(); // the whole take's level now
    clearTimeout(regionTimer);
    pendingTrim = null;
    patch({ trim: null }).then((b) => {
      if (b.undo?.op) toast('Selection cleared', 'ok', { action: { label: 'Undo', run: () => undo(b.undo.op) } });
    }).catch((e) => toast(`Could not clear the selection: ${e.message}`, 'bad'));
    redraw();
  }
  $('sel-clear').addEventListener('click', clearSelection);
  const nudge = (edge, sign) => () => {
    if (!state.region) return;
    const r = { ...state.region };
    r[edge] = nudgeFrame(r[edge], sign, state.grid, state.snap);
    if (edge === 'start') r.start = Math.min(r.start, r.end - minLen);
    else r.end = Math.max(r.end, r.start + minLen);
    setRegion(r);
  };
  for (const [id, edge, sign] of [['in-dec', 'start', -1], ['in-inc', 'start', 1], ['out-dec', 'end', -1], ['out-inc', 'end', 1]]) {
    const b = $(id);
    const step = nudge(edge, sign);
    let hold = 0, rep = 0, repeated = false;
    // A press-and-hold repeats; the click after the release would otherwise
    // add one more step, so it's swallowed.
    b.addEventListener('click', () => { if (repeated) { repeated = false; return; } step(); });
    b.addEventListener('pointerdown', () => {
      repeated = false;
      hold = setTimeout(() => { repeated = true; rep = setInterval(step, GESTURE.REPEAT_MS); }, GESTURE.HOLD.repeat);
    });
    for (const evName of ['pointerup', 'pointercancel', 'pointerleave']) {
      b.addEventListener(evName, () => {
        clearTimeout(hold); clearInterval(rep);
        setTimeout(() => { repeated = false; }, 0);
      });
    }
  }
  // --- bar 1 row ---------------------------------------------------------------
  // Bar 1's own keys, in the toolbar for as long as the take has a tempo: the
  // ruler's "1" and the editor's pads set the same state.grid.downbeat. A
  // drag or a pad saves once it's done; these save after a pause.
  function setDownbeat(f) {
    const next = placeDownbeat(f, total);
    if (next === state.grid.downbeat) return;
    state.grid.downbeat = next;
    updateReadout();
    renderDownbeat();
    saveDownbeatSoon();
    if (state.edit?.edge === 'downbeat') { follow(); renderEditor(); }
    redraw();
  }
  function renderDownbeat() {
    const on = !!state.grid.bpm;
    $('db-row').hidden = !on;
    if (on) $('db-time').textContent = fmtPoint(state.grid.downbeat, sr);
  }
  const nudgeBar1 = (sign) => () => setDownbeat(nudgeDownbeat(state.grid.downbeat, sign, state.grid, state.snap, total));
  for (const [id, sign] of [['db-dec', -1], ['db-inc', 1]]) {
    const b = $(id);
    const step = nudgeBar1(sign);
    let hold = 0, rep = 0, repeated = false;
    // Press-and-hold repeats, as the In and Out nudges do.
    b.addEventListener('click', () => { if (repeated) { repeated = false; return; } step(); });
    b.addEventListener('pointerdown', () => {
      repeated = false;
      hold = setTimeout(() => { repeated = true; rep = setInterval(step, GESTURE.REPEAT_MS); }, GESTURE.HOLD.repeat);
    });
    for (const evName of ['pointerup', 'pointercancel', 'pointerleave']) {
      b.addEventListener(evName, () => {
        clearTimeout(hold); clearInterval(rep);
        setTimeout(() => { repeated = false; }, 0);
      });
    }
  }
  const barOneAtPlayhead = () => { if (state.grid.bpm) setDownbeat(state.cursor); };
  $('db-set').addEventListener('click', barOneAtPlayhead);
  const dbTime = $('db-time');
  dbTime.addEventListener('click', () => startEditing('downbeat'));
  dbTime.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing('downbeat'); }
  });

  function renderSelection() {
    const r = state.region;
    $('sel-row').hidden = !r;
    if (r) {
      $('sel-in').textContent = fmtPoint(r.start, sr);
      $('sel-out').textContent = fmtPoint(r.end, sr);
      $('sel-len').textContent = fmtRegionLength(r, state.grid);
    }
    $('save-take').disabled = !r;
    followSaveName();
    $('set-in').classList.toggle('pending', state.pending?.edge === 'start');
    $('set-out').classList.toggle('pending', state.pending?.edge === 'end');
    if (!r && state.loop) { state.loop = false; applyLoop(); }
    setShareLabel();
    renderHeader();
    syncTransport();
    renderEditor(); // an In or Out edit ends with its selection
  }

  // --- the boundary editor ---------------------------------------------------
  // A boundary (In, Out or bar 1) selected for editing: the view centres on
  // it and follows it, and the editor bar's two encoders, snaps and steps
  // move it. See docs/superpowers/specs/2026-10-05-boundary-editor-design.md.
  // The bar's gestures (the pads, the steps, the keys, the wheel, and saving
  // a whole gesture as one undo step) are lib/edit/editor-bar.js's; what the
  // point is and how it moves and saves are here (the bar's host, below).
  const near = new NearAudio({ file, sampleRate: sr, total });
  let snapping = false; // an Attack or Zero is waiting on its audio
  const editFrame = () => {
    const e = state.edit;
    if (!e) return null;
    if (e.seam) return e.side === 'start' ? state.region?.start : state.region?.end;
    return e.edge === 'start' ? state.region?.start : e.edge === 'end' ? state.region?.end : state.grid.downbeat;
  };
  const editEdge = () => (state.edit?.seam ? state.edit.side : state.edit?.edge);
  // Centre the view on the point at fpp (as it is, by default). In the seam
  // view there is no continuous view to centre: only the zoom applies.
  function follow(fpp = view.view.fpp) {
    const f = editFrame();
    if (f == null) return;
    if (state.edit.seam) {
      view.view.fpp = Math.min(view.maxFpp(), Math.max(MIN_FPP, fpp));
      view.clampView(); view.changed();
      return;
    }
    Object.assign(view.view, viewAbout(f, fpp, view.view.width, total, MIN_FPP));
    view.changed();
  }
  // What can no longer be edited ends: the seam without its loop or selection
  // (back to the edge it was editing, centred again, for a drag on the canvas
  // may have panned the view while it was hidden), an In or Out without a
  // selection, bar 1 without a tempo.
  function checkEdit() {
    const e = state.edit;
    if (!e) return;
    if (e.seam && !(state.region && state.loop)) { e.edge = e.side; e.seam = false; follow(); }
    // (In the seam view the edge is the side, which needs the selection it has.)
    if (!e.seam && (e.edge === 'downbeat' ? !state.grid.bpm : !state.region)) { state.edit = null; bar.dirty = false; }
  }
  function renderEditor() {
    checkEdit();
    const e = state.edit;
    const el = $('boundary-editor');
    el.hidden = !e;
    el.parentElement.classList.toggle('editing', !!e);
    if (!e) return;
    const edge = editEdge();
    const f = editFrame();
    const off = fmtOffset(beatOffset(f, state.grid));
    $('boundary-readout').textContent = `${edge === 'start' ? 'In' : edge === 'end' ? 'Out' : 'Downbeat'} ${fmtSample(f, sr)}${off ? ` · ${off}` : ''}`;
    bar.renderStep();
    // Bar 1 is what the grid is counted from: snapping it to the grid does nothing.
    $('be-grid').hidden = !state.grid.bpm || edge === 'downbeat';
    $('be-seam').hidden = !state.region;
    $('be-seam').setAttribute('aria-pressed', String(!!e.seam));
    $('be-pos').setAttribute('aria-valuetext', $('boundary-readout').textContent);
    $('be-zoom').setAttribute('aria-valuetext', `${stepLabel(stepFrames(view.view.fpp, sr), sr)} a step`);
  }
  function startEditing(edge) {
    if (edge === 'downbeat' ? !state.grid.bpm : !state.region) return;
    bar.commit(); // opening another boundary mid-gesture saves the one before
    state.edit = { edge, seam: false, side: edge === 'end' ? 'end' : 'start' };
    bar.dirty = false;
    follow();
    renderEditor(); redraw();
    $('be-pos').focus({ preventScroll: true });
  }
  function stopEditing() {
    if (!state.edit) return;
    bar.commit();
    // Out of the seam first: the continuous view comes back on the edited point.
    if (state.edit.seam) setSeam(false);
    const edge = editEdge();
    const inside = $('boundary-editor').contains(document.activeElement);
    state.edit = null;
    bar.dirty = false;
    renderEditor(); redraw();
    // The editor's keys are gone; keyboard focus goes back to the readout.
    if (inside) $(edge === 'end' ? 'sel-out' : 'sel-in').focus({ preventScroll: true });
  }
  // Puts the edited boundary at f (where placeEdge lands a move: the host's
  // land, below), and saves it if save. The bar decides save, so a whole
  // gesture is one undo step however many moves came before it.
  function placeEdit(f, save) {
    const edge = editEdge();
    const prev = editFrame();
    if (edge === 'downbeat') {
      state.grid.downbeat = f;
      updateReadout(); renderDownbeat();
      if (save) saveDownbeat();
    } else {
      state.region = { ...state.region, [edge]: f };
      if (save) selectionChanged(); else renderSelection();
    }
    // A tick for each grid line the point crosses. Not for bar 1: the grid is
    // counted from it, so it carries every line along.
    const step = snapStep(state.grid, state.snap === 'off' ? 'beat' : state.snap);
    if (edge !== 'downbeat' && step && crossedLine(prev, f, state.grid.downbeat, step)) {
      try { navigator.vibrate?.(5); } catch { /* no haptics here */ }
    }
    if (state.edit && !state.edit.seam) follow();
  }
  function setSeam(on) {
    const e = state.edit;
    if (!e || e.seam === on) return;
    if (on) {
      if (!state.region) return;
      // The editor hides the Loop key, and the seam is the loop's: Seam turns it on.
      if (!state.loop) setLoop(true);
      e.side = e.edge === 'end' ? 'end' : 'start';
      e.seam = true;
    } else {
      e.edge = e.side; // keep editing the side the seam was moving
      e.seam = false;
    }
    follow();
    renderEditor(); redraw();
  }

  // The editor bar: the pads, the steps, their keys and the wheel move the
  // point; a whole gesture saves once.
  const bar = new EditorBar({
    els: { zoom: $('be-zoom'), pos: $('be-pos'), back: $('be-back'), fwd: $('be-fwd'), step: $('be-step') },
    host: {
      active: () => !!state.edit,
      frame: editFrame,
      land: (frame) => placeEdge(editEdge(), frame, { region: state.region, total, minLen }),
      place: placeEdit,
      fpp: () => view.view.fpp,
      width: () => view.view.width,
      follow,
      sampleRate: sr,
      render: () => { renderEditor(); redraw(); },
      readout: renderEditor,
    },
  });

  // Attack, Zero and Grid act once, on the point.
  async function snapTo(kind) {
    const f = editFrame();
    if (f == null || snapping) return;
    if (kind === 'grid') {
      bar.move(snapFrame(f, state.grid, state.snap === 'off' ? 'beat' : state.snap), true);
      return;
    }
    const edge = editEdge();
    const btn = $(kind === 'attack' ? 'be-attack' : 'be-zero');
    const radius = snapRadius(kind, sr, view.view);
    const at = Math.round(f);
    snapping = true;
    btn.classList.add('waiting');
    btn.setAttribute('aria-busy', 'true');
    try {
      const { x, from } = await near.around(at);
      // The point moved, or editing ended, while the audio came.
      if (!state.edit || editEdge() !== edge || editFrame() !== f) return;
      const i = at - from;
      // Out at the take's very end is one past the last sample: search from the last.
      const k = Math.min(i, x.length - 1);
      const j = i >= 0 && k >= 0 && i <= x.length ? (kind === 'attack' ? findAttack(x, sr, k, radius) : findZero(x, k, radius)) : -1;
      if (j < 0) { toast(kind === 'attack' ? 'No hit near here' : 'No zero crossing near here'); return; }
      bar.move(from + j, true);
    } catch (e) {
      toast(`Could not read the audio: ${e.message}`, 'bad');
    } finally {
      snapping = false;
      btn.classList.remove('waiting');
      btn.removeAttribute('aria-busy');
    }
  }
  $('be-attack').addEventListener('click', () => snapTo('attack'));
  $('be-zero').addEventListener('click', () => snapTo('zero'));
  $('be-grid').addEventListener('click', () => snapTo('grid'));

  // Hearing it: from the point (Out: a second before it); the seam, with the loop.
  $('be-play').addEventListener('click', () => {
    if (clock.playing) { togglePlay(); return; } // the editor's pause
    const f = editFrame();
    if (f == null) return;
    seekTo(playFrom(editEdge(), f, sr));
    togglePlay();
  });
  $('be-seam').addEventListener('click', () => setSeam(!state.edit?.seam));
  $('be-done').addEventListener('click', stopEditing);

  // The In and Out readouts open the editor; the same one again closes it.
  for (const [id, edge] of [['sel-in', 'start'], ['sel-out', 'end']]) {
    const b = $(id);
    const toggle = () => { if (state.edit && editEdge() === edge) stopEditing(); else startEditing(edge); };
    b.addEventListener('click', toggle);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  // The wheel moves the point (⌘ or Ctrl with it zooms); see the bar.
  view.onWheel = (e) => bar.wheel(e);
  // A resize keeps the point in view (the seam view has no point to keep).
  const editResize = new ResizeObserver(() => {
    const f = editFrame();
    if (f == null || state.edit.seam) return;
    const v = view.view;
    if (f < v.start || f > v.start + v.width * v.fpp) follow();
  });
  editResize.observe(canvas);

  // --- snap -----------------------------------------------------------------
  function renderSnap() {
    const b = $('snap');
    b.hidden = !state.grid.bpm;
    b.textContent = `Snap: ${SNAP_LABELS[state.snap]}`;
    b.setAttribute('aria-pressed', String(state.snap !== 'off'));
  }
  $('snap').addEventListener('click', () => {
    state.snap = SNAPS[(SNAPS.indexOf(state.snap) + 1) % SNAPS.length];
    writePref('wave.snap', state.snap);
    snapChosen = true;
    renderSnap();
  });

  // --- header ---------------------------------------------------------------
  function renderHeader() {
    // A rename here or on another device: Save as take's offer follows it.
    followSaveName();
    renderDownbeat();
    // Its name as its spine says it: its label, or the time it was cut.
    const name = takeTitle({ ...take, name: take.name || file });
    $('take-name-text').textContent = name;
    $('take-name').classList.toggle('unlabelled', !take.label);
    $('take-name').setAttribute('aria-label', `${name}: this take’s menu`);
    document.title = `${name} — Hindsight`;
    $('take-star').setAttribute('aria-pressed', String(!!take.starred));
    $('take-star').classList.toggle('on', !!take.starred);
    $('take-bpm').textContent = tempoLabel(take.bpm, take.tempo_from);
    $('take-bpm').classList.toggle('unset', !take.bpm);
    const drops = dropoutsText(take);
    $('take-drops').hidden = !drops;
    $('take-drops').textContent = drops;
    $('take-len').textContent = state.region
      ? `${fmtClock(state.region.end - state.region.start, sr)} of ${fmtClock(total, sr)}`
      : fmtClock(total, sr);
    const src = take.source;
    $('take-source').hidden = !src;
    if (src) {
      $('take-source').textContent = `from ${takeTitle(src)}`;
      $('take-source').href = `/wave.html?file=${encodeURIComponent(src.name)}`;
    }
    renderSnap();
    // A tempo cleared while bar 1 is being edited ends that edit.
    renderEditor();
  }

  // inlineEdit swaps `button` for `input` to edit a value in place; a tap
  // on the button starts it, or `start()` (the answer) does, for a value
  // whose button is a menu's (the take's name: Rename… in its menu).
  function inlineEdit(button, input, { initial, commit, tap = true }) {
    const start = () => {
      input.value = initial();
      button.hidden = true;
      input.hidden = false;
      input.focus();
      input.select();
    };
    if (tap) button.addEventListener('click', start);
    let cancelled = false;
    const done = async () => {
      if (input.hidden) return;
      input.hidden = true;
      button.hidden = false;
      if (cancelled) { cancelled = false; return; }
      await commit(input.value.trim());
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelled = true; input.blur(); }
    });
    return start;
  }
  const rename = inlineEdit($('take-name'), $('take-name-input'), {
    tap: false,
    initial: () => take.label || '',
    commit: async (v) => {
      if (v === (take.label || '')) return;
      const before = take.label;
      take.label = v;
      renderHeader();
      try { await patch({ label: v }); } catch (e) { take.label = before; renderHeader(); toast(`Could not rename: ${e.message}`, 'bad'); }
    },
  });
  inlineEdit($('take-bpm'), $('take-bpm-input'), {
    initial: () => (take.bpm ? String(take.bpm) : ''),
    commit: async (v) => {
      const bpm = v === '' ? null : Number(v);
      if (bpm !== null && !(bpm >= 20 && bpm <= 400)) { toast('A tempo is 20 to 400 BPM', 'bad'); return; }
      if (bpm === (take.bpm || null)) return;
      const before = take.bpm;
      const beforeFrom = take.tempo_from;
      take.bpm = bpm;
      take.tempo_from = 'you';
      state.grid.bpm = bpm;
      renderHeader(); updateReadout(); redraw();
      try {
        const res = await patch({ bpm });
        take.bpm = res.bpm ?? null;
        take.tempo_from = res.tempo_from || '';
        state.grid.bpm = take.bpm;
        renderHeader(); redraw();
      } catch (e) {
        take.bpm = before; take.tempo_from = beforeFrom; state.grid.bpm = before || null;
        renderHeader(); redraw();
        toast(`Could not set the tempo: ${e.message}`, 'bad');
      }
    },
  });
  $('take-star').addEventListener('click', async () => {
    take.starred = !take.starred;
    renderHeader();
    try { await patch({ starred: take.starred }); } catch (e) { take.starred = !take.starred; renderHeader(); toast(`Could not star: ${e.message}`, 'bad'); }
  });

  // Previous and next take, in the order the list last showed them: rows
  // of the take's menu, each saying which take it opens, by its spine's
  // name. Answers that order (or null), which Delete steps on through too.
  async function neighbours() {
    let order = null;
    let list = null;
    try { order = JSON.parse(sessionStorage.getItem('hindsight.order') || 'null'); } catch {}
    orderListed = Array.isArray(order) && order.includes(file);
    try { list = await takes.get(); } catch {}
    if (!orderListed && Array.isArray(list)) order = list.map((t) => t.name);
    if (!Array.isArray(order)) return null;
    const i = order.indexOf(file);
    const titleOf = (name) => takeTitle((Array.isArray(list) && list.find((t) => t.name === name)) || { name });
    const go = (name) => () => {
      flushRegion();
      flushDownbeat();
      hopTo(name);
    };
    const offer = (key, words, name) => {
      $(key).disabled = !name;
      $(key).onclick = name ? go(name) : null;
      setText($(words), name ? titleOf(name) : '');
    };
    offer('take-prev', 'take-prev-name', i > 0 ? order[i - 1] : null);
    offer('take-next', 'take-next-name', i >= 0 && i < order.length - 1 ? order[i + 1] : null);
    return order;
  }
  let orderReady = Promise.resolve(null);
  let orderListed = false; // the order is the list's, not every take's

  // Back returns to the list as it was -- the main page or the takes page --
  // with the browser's own Back, which keeps its scroll, where a fresh load
  // would start at the top. A ◂/▸ hop replaces the page, so the referrer is
  // then the last take, not the list; the list the run began at is kept for
  // the session.
  let list = null;
  try {
    const hop = sessionStorage.getItem('hindsight.hop') === '1';
    sessionStorage.removeItem('hindsight.hop');
    if (hop) list = sessionStorage.getItem('hindsight.list') || null;
    else list = listFrom(document.referrer, location.origin);
    sessionStorage.setItem('hindsight.list', list || '');
  } catch {}
  const fromList = !!list;
  // The ‹ says where it goes: the list the take was opened from.
  const backLink = document.querySelector('.appbar .back');
  if (list === '/') {
    backLink.href = '/';
    backLink.setAttribute('aria-label', 'Back to the main page');
    backLink.querySelector('.back-text').textContent = 'Capture';
  }
  backLink.addEventListener('click', (e) => {
    if (fromList && history.length > 1) { e.preventDefault(); history.back(); }
  });

  // --- menus ------------------------------------------------------------------
  // The take's menu, from its name (lib/ui/menu.js): under the name, on the
  // page's stack, so Escape, Back or a press elsewhere closes it. Rename…
  // swaps the name for its field; Tag… is the tag beside the star, where the
  // header has no room for it (css/chrome.css).
  menu($('take-name'), $('take-menu'), { layers: layersOf(document), side: 'below', align: 'start', floor: barTop(document) });
  $('take-rename').addEventListener('click', () => rename());
  $('take-tag-row').addEventListener('click', () => $('take-tag')?.click());
  // More, beside KEEP: Share (or Download), the bundle, the files, Delete.
  menu($('more-btn'), $('more-menu'), { layers: layersOf(document), align: 'end' });

  // Fine tune ▸ and MIDI ▸ fold out under the keys, closed on every open.
  function fold(button, panel, onToggle = () => {}) {
    button.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      onToggle(open);
    });
  }
  fold($('fine-btn'), $('fine-tune'));
  fold($('midi-btn'), $('midi'), (open) => { midiOpen = open; if (lanes) lanes.draw(); syncNotes(); });
  // Shown from the take's first paint, not when its MIDI has loaded.
  $('midi-btn').hidden = !take.has_midi;

  $('downbeat-reset').addEventListener('click', () => {
    state.grid.downbeat = 0;
    clearTimeout(downbeatTimer); downbeatPending = false;
    patch({ downbeat_frame: null }).catch((e) => toast(`Could not reset the downbeat: ${e.message}`, 'bad'));
    updateReadout(); renderDownbeat();
    follow(); renderEditor(); // bar 1 being edited has moved
    redraw();
  });
  // The downloads, in More and in the take's menu.
  for (const id of ['dl-wav', 'take-dl-wav']) $(id).href = `/api/download?file=${encodeURIComponent(file)}&dl=1`;
  if (take.has_midi && take.midi_name) {
    for (const id of ['dl-midi', 'take-dl-midi']) {
      $(id).hidden = false;
      $(id).href = `/api/download?file=${encodeURIComponent(take.midi_name)}&dl=1`;
    }
  }
  // Delete this take, in the take's menu, and Delete take in More: to the trash in one tap, so it
  // doesn't ask, and on to the next take in the list's order (the one before,
  // from the last), which says "Deleted … · Undo". Undo brings it back,
  // starred as any restore is, and opens it again. With no take left to go
  // on to, back to the list, which says it there.
  let trashing = false;
  async function trashTake() {
    if (trashing) return;
    trashing = true;
    $('take-trash').disabled = true;
    try {
      await whenSaved();
      const res = await fetch(`/api/delete?file=${encodeURIComponent(file)}`, { method: 'DELETE', headers: withClient() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `status ${res.status}`);
    } catch (e) {
      trashing = false;
      $('take-trash').disabled = false;
      toast(`Could not delete: ${e.message}`, 'bad');
      return;
    }
    // Nothing left to save to: a selection changed while it went is dropped.
    pendingTrim = null;
    clearTimeout(regionTimer);
    clock.pause();
    const msg = `Deleted ${named(takeTitle({ ...take, name: file }))}`;
    // On through the list's own order only: a take it doesn't have (a cut
    // opened from its toast, say) goes back to the list, as before.
    const order = await orderReady;
    const step = orderListed ? stepPast(order, file) : { next: null };
    if (step.next) {
      try { sessionStorage.setItem('hindsight.order', JSON.stringify(step.order)); } catch {}
      toastNext({ msg, restore: file, at: step.at });
      hopTo(step.next);
    } else {
      toastNext({ msg, restore: file });
      if (fromList && history.length > 1) history.back();
      else location.href = list || '/takes.html';
    }
  }
  $('take-trash').addEventListener('click', trashTake);
  $('take-trash').disabled = false; // off until now: a tap before this did nothing
  $('delete-take').addEventListener('click', trashTake);

  // --- Save as take ---------------------------------------------------------
  // It asks for the new take's name first, in the verbs' place: offered as
  // the server would name it ("Tuesday jam · 0:42–1:10") and selected, so
  // typing replaces it. Enter or Save saves; Escape or Cancel puts the verbs
  // back. On the takes page the new take folds in with this one.
  function offerName() { return cutLabel(take, state.region.start, state.region.end, sr); }
  function openSaveName() {
    if (!state.region || saving) return;
    offered = offerName();
    saveInput.value = offered;
    // The offer can be longer than a typed name may be; it mustn't make the
    // field refuse to submit.
    saveInput.maxLength = Math.max(120, offered.length);
    document.querySelector('.tb-row.verbs').hidden = true;
    saveForm.hidden = false;
    saveInput.focus();
    saveInput.select();
  }
  function closeSaveName(refocus = true) {
    if (saveForm.hidden || saving) return;
    saveForm.hidden = true;
    document.querySelector('.tb-row.verbs').hidden = false;
    if (refocus) $('save-take').focus();
  }
  // The selection moved, or the take was renamed, while the field is open:
  // the offer follows, and so does the field if it still holds the offer;
  // a name the owner typed stays. No selection, nothing to save.
  function followSaveName() {
    if (saveForm.hidden || saving) return;
    if (!state.region) { closeSaveName(false); return; }
    const was = offered;
    offered = offerName();
    saveInput.maxLength = Math.max(120, offered.length);
    if (saveInput.value === was) saveInput.value = offered;
  }
  function setSaving(on) {
    saving = on;
    for (const id of ['save-name-ok', 'save-name-cancel', 'save-name-input']) $(id).disabled = on;
  }
  // The spine the new take sits under on the takes page: this take's, which
  // is further up the line when this take is itself a cut or an earlier mix.
  async function spineName(name) {
    try {
      const list = await takes.refresh();
      const s = familyOf(fold(Array.isArray(list) ? list : []), name).spine;
      return s && s.name !== name ? takeTitle(s) : '';
    } catch { return ''; }
  }
  $('save-take').addEventListener('click', openSaveName);
  $('save-name-cancel').addEventListener('click', () => closeSaveName());
  saveForm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSaveName(); }
  });
  saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.region || saving) return;
    // The offer, untouched, goes as no name at all: the server names it as
    // it always has, rather than taking the offer as typed (and capping it).
    const typed = saveInput.value.trim();
    const label = typed === offered ? '' : typed;
    setSaving(true);
    try {
      const res = await fetch(`/api/cut?file=${encodeURIComponent(file)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_frame: state.region.start, end_frame: state.region.end, label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      setSaving(false);
      closeSaveName();
      const under = await spineName(body.name);
      // Built as nodes: the names are the owner's and never markup.
      const t = document.createElement('div');
      t.className = 'toast ok';
      t.append('Saved ');
      const a = document.createElement('a');
      a.href = `/wave.html?file=${encodeURIComponent(body.name)}`;
      a.textContent = typed || offered;
      t.append(a, under ? ` · in ${under} on the shelf` : '');
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 8000);
    } catch (err) {
      toast(`Could not save as a take: ${err.message}`, 'bad');
    } finally {
      setSaving(false);
    }
  });

  // --- Share ------------------------------------------------------------------
  // The selection (or the whole take) rendered to an MP3 and handed to the
  // phone's share sheet. Nothing is saved: a share is a stream.
  const shareBtn = $('share');
  const shareWord = $('share-word');
  const shareVerb = canShareFiles() ? 'Share' : 'Download';
  function setShareLabel() {
    const r = state.region;
    // With Level on, the row says it shares levelled.
    const lv = levelOn && levelRead && levelDb ? ` · ${gainText(levelDb)}` : '';
    shareWord.textContent = (r ? `${shareVerb} · ${fmtClock(r.end - r.start, sr)}` : shareVerb) + lv;
  }
  refreshShareLabel = setShareLabel;
  shareBtn.addEventListener('click', async () => {
    if (!state.region && total > MAX_SHARE_SECONDS * sr) {
      toast(`Select a part first — the whole take is over ${MAX_SHARE_SECONDS / 60} minutes`, 'bad');
      return;
    }
    const from = state.region ? state.region.start : 0;
    const to = state.region ? state.region.end : total;
    shareBtn.disabled = true;
    shareWord.textContent = 'Rendering…';
    try {
      const res = await fetch(`/api/render?file=${encodeURIComponent(file)}&from=${from}&to=${to}${levelOn ? '&normalize=1' : ''}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `status ${res.status}`);
      }
      const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const filename = m ? m[1] : `${safeStem(take.label || stemOf(file))}.mp3`;
      const blob = await res.blob();
      // A render that died mid-stream is still a 200; sniff the body.
      const head = new Uint8Array(await blob.slice(0, 2048).arrayBuffer());
      if (!looksLikeMP3(head) || blob.size <= 1024) throw new Error('render failed, try again');
      const result = await shareOrDownload(blob, filename, filename.replace(/\.mp3$/, ''));
      const gain = res.headers.get('X-Hindsight-Gain-Db');
      if (result === 'downloaded' && shareVerb === 'Share') toast(`Shared as a download${gain ? `, levelled ${gainText(Number(gain))}` : ''}`);
      else if (result !== 'cancelled' && gain) toast(`Levelled ${gainText(Number(gain))}`);
      // Asked to level, and the Pi couldn't read the level: it went as recorded.
      if (result !== 'cancelled' && levelOn && gain === null) toast("Shared as recorded: its level couldn't be read", 'warn');
    } catch (e) {
      toast(`${shareVerb} failed: ${e.message}`, 'bad');
    } finally {
      shareBtn.disabled = false;
      setShareLabel();
    }
  });

  // --- DAW bundle ---------------------------------------------------------------
  $('bundle').addEventListener('click', async () => {
    if (!state.region && total > MAX_SHARE_SECONDS * sr) {
      toast(`Select a part first — the whole take is over ${MAX_SHARE_SECONDS / 60} minutes`, 'bad');
      return;
    }
    const from = state.region ? state.region.start : 0;
    const to = state.region ? state.region.end : total;
    toast('Bundling…', 'ok', 2000);
    try {
      const res = await fetch(`/api/bundle?file=${encodeURIComponent(file)}&from=${from}&to=${to}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `status ${res.status}`);
      }
      const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const filename = m ? m[1] : `${safeStem(take.label || stemOf(file))}.zip`;
      const blob = await res.blob();
      if (blob.size < 100) throw new Error('bundle failed, try again');
      await shareOrDownload(blob, filename, filename.replace(/\.zip$/, ''), 'application/zip');
      if (res.headers.get('X-Hindsight-Midi') === 'none') toast('Bundled the audio only — this take has no MIDI');
    } catch (e) {
      toast(`Bundle failed: ${e.message}`, 'bad');
    }
  });

  // --- MIDI lanes -----------------------------------------------------------
  const laneKinds = { ...(take.lane_kinds || {}) };
  const guessedKinds = {}; // what /api/midi guessed, before any override
  // The sidecar's kinds, as an Undo or another device left them.
  function applyLaneKinds(kinds) {
    for (const k of Object.keys(laneKinds)) if (!(k in kinds)) delete laneKinds[k];
    Object.assign(laneKinds, kinds);
    if (!lanes) return;
    for (const [name, guessed] of Object.entries(guessedKinds)) {
      const want = laneKinds[name] || guessed;
      const c = lanes.cards.find((k) => k.track.name === name);
      if (c && c.track.kind !== want) lanes.setKind(name, want);
    }
    if (notes) notes.draw();
  }
  async function loadLanes() {
    let res;
    try {
      res = await fetch(`/api/midi?file=${encodeURIComponent(file)}`);
    } catch {
      toast('Could not load MIDI', 'bad');
      return;
    }
    if (res.status === 404) return;
    if (res.status === 422) {
      const t = document.createElement('div');
      t.className = 'toast bad';
      t.append('This take\'s MIDI file does not decode. ');
      const a = document.createElement('a');
      a.href = `/api/download?file=${encodeURIComponent(take.midi_name || `${stemOf(file)}.mid`)}&dl=1`;
      a.textContent = 'Download the raw .mid';
      t.appendChild(a);
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 8000);
      return;
    }
    if (!res.ok) { toast('Could not load MIDI', 'bad'); return; }
    let midi;
    try { midi = await res.json(); } catch { toast('Could not load MIDI', 'bad'); return; }
    if (!midi.tracks || !midi.tracks.length) return;
    // /api/midi is served immutable; the sidecar has the latest kinds.
    for (const t of midi.tracks) {
      guessedKinds[t.name] = t.kind;
      if (laneKinds[t.name]) t.kind = laneKinds[t.name];
    }
    const container = $('lanes');
    container.hidden = false;
    lanes = new Lanes({
      container,
      tracks: midi.tracks,
      storageKey: `wave.lanes.${file}`,
      getState: () => state,
      getView: () => view.view,
      onKindChange: (name, kind) => {
        laneKinds[name] = kind;
        patch({ lane_kinds: laneKinds }).catch((e) => toast(`Could not save the lane: ${e.message}`, 'bad'));
        if (notes) notes.draw();
      },
    });
    lanes.draw();
    notes = new RisingNotes({
      canvas: $('notes-canvas'),
      chips: $('notes-tracks'),
      tracks: midi.tracks,
      tempo: midi.tempo || [],
      sampleRate: sr,
      getState: () => state,
      getClock: () => clock,
      storageKey: `wave.notes.${file}`,
    });
    $('notes-pane').hidden = false;
    syncNotes();
  }

  // --- keyboard -----------------------------------------------------------
  // The menus close themselves on Escape before the handler below runs, so
  // whether one was open is noted on the way down (capture comes first).
  let menuWasOpen = false;
  document.addEventListener('keydown', (e) => {
    menuWasOpen = e.key === 'Escape' && !!document.querySelector('.menu:not([hidden])');
  }, true);
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    // A dialog's keys are its own: nothing moves the take behind it.
    if (document.querySelector('dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      bar.commit(); // so ⌘Z undoes a move still being made
      if (undoInfo.count) undo();
      return;
    }
    // Cmd-+, Ctrl-0 and friends belong to the browser.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Space on a focused control presses that control; it is not Play too.
    if (e.key === ' ' && e.target.closest?.('button, a, select, [role="button"], [tabindex]')) return;
    // While a boundary is being edited the arrows step it, Shift by ten.
    if (state.edit) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        bar.step(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 10 : 1, !e.repeat);
        return;
      }
      // Escape closes an open menu and nothing else (see menuWasOpen).
      if (e.key === 'Escape' && !menuWasOpen) { e.preventDefault(); stopEditing(); return; }
    }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      // F is ✎ from the keyboard: Open's notes, at the playhead.
      case 'f': case 'F': for (const f of noteKeyHooks) f(); break;
      case '[': setPointAt('start'); break;
      case ']': setPointAt('end'); break;
      case 'b': case 'B': barOneAtPlayhead(); break;
      case 'l': case 'L': if (state.region || state.loop) setLoop(!state.loop); break;
      case 'j': case 'J': if (!e.repeat) back5(); break;
      case '+': case '=': view.zoomTo(view.view.fpp / 2, view.view.width / 2); break;
      case '-': view.zoomTo(view.view.fpp * 2, view.view.width / 2); break;
      case '0': view.fitAll(); break;
      case 'ArrowLeft': view.panTo(view.view.start - view.view.width * view.view.fpp * 0.2); break;
      case 'ArrowRight': view.panTo(view.view.start + view.view.width * view.view.fpp * 0.2); break;
    }
  });

  // --- readout ------------------------------------------------------------
  // The bar's LCD: where the take is, the lamp, and its scrolling line; the
  // scrubber says the same to a screen reader. The reels hear of it too.
  function updateReadout() {
    const bar = barBeat(state.cursor, state.grid);
    const lcd = takeCounter({ pos: state.cursor, length: total, sampleRate: sr, bar, playing: clock.playing });
    setText($('position'), lcd.big);
    setText($('np-time'), lcd.small);
    setText($('np-unit'), lcd.unit);
    setAttr($('np-status'), 'data-state', lcd.status);
    // The display's tempo, the take and where it plays (lib/bar/display.js),
    // which change with the name and the tempo only.
    const dk = `${take.label}|${state.grid.bpm}`;
    if (dk !== displayKey) {
      displayKey = dk;
      const d = takeDisplay({ title: takeTitle({ ...take, name: take.name || file }), bpm: state.grid.bpm }, hereWord(deviceOf(window)));
      setText($('np-tempo-short'), d.tempo.short);
      setText($('np-tempo-long'), d.tempo.long);
      setText($('np-source-short'), d.source.short);
      setText($('np-source-long'), d.source.long);
      setText($('np-output-val'), d.out);
    }
    // The slider, for a screen reader: to the tenth of a second, not every frame.
    const ov = $('overview-canvas');
    setAttr(ov, 'aria-valuemax', String(total));
    setAttr(ov, 'aria-valuenow', String(Math.round(state.cursor / (sr / 10)) * (sr / 10)));
    setAttr(ov, 'aria-valuetext', `${bar ? `bar ${bar}, ` : ''}${fmtTime(Math.round(state.cursor / (sr / 10)) * (sr / 10), sr)}`);
    setAttr($('to-start'), 'aria-label', state.region ? 'Back to In' : 'Back to the start');
    feedReels();
  }
  let displayKey = null;
  function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
  function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }

  renderHeader();
  renderSelection();
  updateReadout();
  syncTransport();
  view.fitAll();
  loadLanes();
  orderReady = neighbours();
  // A bar 1 nudge still in its pause saves before the page goes away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDownbeat();
  });
  // Two hooks, because neither alone covers a phone: pagehide fires on
  // navigation, visibilitychange when the app is switched or the screen locks.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { bar.commit(); flushRegion(); }
  });
  // Back in view, back online, or back from a sleep that stopped the clock:
  // the take as the Pi has it now, with a "Reconnecting…" note until it answers.
  link = watchLink(() => refetchTake(), { retryMs: 3000 });

  // This page is Open (lib/room/open.js): it opens where the bar was
  // (carry.arrival), and ✎ on the bar arrives with a note started at the
  // frame that was heard. The room lays its words over the page and works
  // the take through this handle.
  const arrival = pageCarry().arrival(file, total);
  if (arrival && (arrival.frame > 0 || arrival.play)) {
    // The browser may refuse a sound nobody tapped for on this page (Safari
    // on an iPhone always does): then the take waits at the frame the bar
    // left it, paused, with ▶ one tap away, and no toast for it.
    startOpen(arrival, {
      seek: (f) => { seekTo(f); view.follow(Math.max(0, Math.min(total - 1, f))); },
      pos: () => state.cursor,
      play: () => togglePlay(),
    });
  }
  startRoom('open', {
    file, take, takes, sampleRate: sr, total, peaks: filePeaks, toast,
    arrivalNote: arrival ? arrival.note : null,
    state: () => state,
    playing: () => clock.playing,
    togglePlay,
    seek: (frame) => { seekTo(frame); if (!state.edit) view.follow(Math.max(0, Math.min(total - 1, frame))); },
    // A note is a flag with words. NOTE HERE puts one where the playhead
    // is -- or answers the one already there.
    addNote(frame, label = '') {
      const at = Math.max(0, Math.min(total - 1, Math.round(frame)));
      const there = state.flags.find((f) => f.frame === at);
      if (there) { this.editNote(there.id, label); return there.id; }
      addFlagAt(at, label);
      return state.flags.find((f) => f.frame === at)?.id || null;
    },
    editNote(id, label) {
      const f = state.flags.find((x) => x.id === id);
      if (!f || f.label === label) return;
      f.label = label;
      flagOp('edit', { id, label });
      redraw();
    },
    removeNote(id) {
      const f = state.flags.find((x) => x.id === id);
      if (!f) return;
      state.flags = state.flags.filter((x) => x !== f);
      if (state.selectedFlag === f) state.selectedFlag = null;
      flagOp('remove', { id }, (b) => {
        if (b.undo?.op) toast(f.label ? `Note "${named(f.label)}" taken out` : 'Note taken out', 'ok', { action: { label: 'Undo', run: () => undo(b.undo.op) } });
      });
      redraw();
    },
    patch: (body) => patch(body),
    onRedraw: (fn) => { openHooks.add(fn); return () => openHooks.delete(fn); },
    onPin: (fn) => { pinHooks.add(fn); return () => pinHooks.delete(fn); },
    onNoteKey: (fn) => { noteKeyHooks.add(fn); return () => noteKeyHooks.delete(fn); },
  })?.catch((e) => console.error('Open could not start:', e));
  // Leaving, the take and where the playhead is go to the next page's bar
  // (lib/bar/carry.js), so Room -> Open -> back carries what was done here.
  // Opened and left alone (not played, the playhead where it began), the page
  // is transparent: the bar's take, as the Room left it, stands.
  // Repeat on the bar isn't this page's (its Loop is a selection's): the
  // Room's flag for this take, as it left it, goes back with it.
  const carry = pageCarry();
  carry.wire(window, document, takePageState({ file, sr, from: state.cursor, loop: carry.loopOf(file), now: () => ({ frame: state.cursor, playing: clock.playing }) }));
  window.addEventListener('pagehide', () => {
    clearTimeout(loopTimer);
    bar.commit();
    editResize.disconnect();
    flushRegion();
    flushDownbeat();
    screenLock?.release();
    clock.destroy(); tiles.stop(); view.destroy(); overview.destroy();
    if (lanes) lanes.destroy();
    if (notes) notes.destroy();
  });
}

// pagehide tears the page down; one restored from the back-forward cache
// would come back without a clock or a view, so it loads afresh instead.
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

main().catch((e) => fail(e.message || String(e)));
