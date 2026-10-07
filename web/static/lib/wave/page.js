// web/static/lib/wave/page.js
// The take page: it owns the take's editable state (selection, flags, grid,
// playhead), hands it to the view to paint, and saves changes through the
// sidecar API. The view and the clock own no take state of their own.
//
// The words follow the editing model: a *selection* is In to Out (the API
// still calls it trim); Loop is a toggle, off when the page opens; *Save as
// take* writes the selection as a new take; *Share* sends it as an MP3.
import { TileCache } from './tiles.js';
import { WaveView } from './view.js';
import { Overview } from './overview.js';
import { Clock } from './clock.js';
import { Lanes } from './lanes.js';
import { RisingNotes } from './rising.js';
import { looksLikeMP3, canShareFiles, shareOrDownload } from './share.js';
import {
  barBeat, fmtTime, fmtClock, fmtPoint, clampRegion, fmtRegionLength,
  SNAPS, SNAP_LABELS, initialSnap, tempoLabel, snapOnTempo, tempoPending, nudgeFrame, snapFrame, snapStep, setPoint, prevFlag, nextFlag,
} from './geometry.js';
import {
  viewAbout, stepFrames, stepLabel, placeEdge, fmtSample, beatOffset, fmtOffset, crossedLine,
  snapRadius, playFrom,
} from './boundary.js';
import { NearAudio } from './near.js';
import { findAttack, findZero } from './onset.js';
import { MIN_FPP } from '../edit/gestures.js';
import { EditorBar } from '../edit/editor-bar.js';
import { levelsFor, takeGain } from './draw.js';
import { drawTrace } from './tape-strip.js';
import { flagRequest, asFlags, newFlagId } from '../flags.js';
import { holdScreen } from '../wakelock.js';
import { initHelp } from '../help/help.js';
import { toast, toastNext, undoSkipped, undoPhrase } from '../toast.js';
import { withClient } from '../client.js';
import { token, withAlpha, onSchemeChange } from '../theme.js';
import { listFrom, fold, familyOf } from '../shelf.js';
import { cutLabel } from './cut-label.js';
import { initNav } from '../nav.js';
import { ReelWindow, peakDbAt } from '../bar/reel-window.js';
import { takeCounter, takeMarquee } from '../bar/lcd.js';
import { initPlayer } from '../bar/player.js';
import { timedFetch, watchLink } from '../link.js';

// Mirrors audio.MaxRenderSeconds: the server's cap on a share render.
const MAX_SHARE_SECONDS = 600;
const SPEEDS = [0.5, 1, 2];

const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get('file');


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
// What an unnamed take is called: its timestamp, as the list shows it.
const stampOf = (name) => (name || '').replace(/^jam_|\.wav$/g, '');

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

async function main() {
  // The page's link to the Pi; the real one is made once the page is up.
  let link = { ok() {}, fail() {} };
  if (!file) return fail('No take given.');
  // A reload while the notes pane was open leaves a stale {notes:1} entry
  // that would otherwise pop straight into the (unbuilt) pane on Back.
  if (history.state && history.state.notes) history.replaceState(null, '');
  initHelp({ page: 'take', toast });
  initNav();
  const [takeRes, peaksRes] = await Promise.all([
    fetch(`/api/take?file=${encodeURIComponent(file)}`, { headers: withClient() }),
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
  const state = {
    region: take.trim ? { start: take.trim.start_frame, end: take.trim.end_frame } : null,
    pending: null, // a lone In or Out waiting for its other half
    flags: asFlags(take.flags),
    grid: { bpm: take.bpm || null, sampleRate: sr, downbeat: take.downbeat_frame || 0 },
    snap: initialSnap(readPref('wave.snap', null), !!take.bpm),
    cursor: 0,
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
  const bench = window.matchMedia('(min-width: 860px)');
  const notesVisible = () => bench.matches || document.body.classList.contains('notes-open');
  function syncNotes() {
    if (!notes) return;
    if (notesVisible() && clock.playing) notes.start();
    else { notes.stop(); if (notesVisible()) notes.draw(); }
    $('notes-play').textContent = clock.playing ? 'Pause' : 'Play';
  }
  function redraw() {
    view.draw();
    if (overview) overview.draw();
    if (lanes) lanes.draw();
    if (notes && !notes.running && notesVisible()) notes.draw();
    drawStrip();
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
    // keepalive, as flushRegion's: a bar-1 move committed at pagehide must not be dropped.
    patch({ downbeat_frame: state.grid.downbeat }, { keepalive: true }).catch((e) => toast(`Could not save the downbeat: ${e.message}`, 'bad'));
  }
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
      if (!res.ok) return;
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
    if (state.selectedFlag === null && !sheet.hidden) sheet.hidden = true;
    take.label = fresh.label;
    state.snap = snapOnTempo(state.snap, snapChosen, !!take.bpm, !!fresh.bpm);
    take.bpm = fresh.bpm;
    take.tempo_from = fresh.tempo_from;
    take.starred = fresh.starred;
    if (fresh.has_preview) previewLanded();
    state.grid.bpm = fresh.bpm || null;
    state.grid.downbeat = fresh.downbeat_frame || 0;
    if (!pendingTrim) {
      const r = fresh.trim ? { start: fresh.trim.start_frame, end: fresh.trim.end_frame } : null;
      const same = (r && state.region && r.start === state.region.start && r.end === state.region.end) || (!r && !state.region);
      // Show it and re-arm the loop, but don't save: it came from the Pi.
      if (!same) { state.region = r; state.pending = null; renderSelection(); scheduleLoop(); }
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
      case 'selectFlag': openSheet(p.flag); break;
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
        state.grid.downbeat = p.frame; updateReadout(); redraw();
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

  function addFlagAt(frame) {
    if (state.flags.some((f) => f.frame === frame)) return;
    const id = newFlagId();
    state.flags.push({ id, frame, label: '' });
    state.flags.sort((a, b) => a.frame - b.frame);
    flagOp('add', { id, frame });
    redraw();
  }

  // A selection was committed: save it, re-arm the loop, update the rows.
  function selectionChanged() {
    renderSelection();
    saveRegion();
    scheduleLoop();
  }

  // --- flag sheet ---------------------------------------------------------
  const sheet = $('flag-sheet');
  function openSheet(flag) {
    state.selectedFlag = flag;
    $('flag-label').value = flag.label;
    sheet.hidden = false;
    $('flag-label').focus();
    view.draw();
  }
  function closeSheet(commit) {
    const f = state.selectedFlag;
    if (!f) return;
    if (commit) {
      const label = $('flag-label').value.trim();
      if (label !== f.label) {
        f.label = label;
        flagOp('edit', { id: f.id, label });
      }
    }
    state.selectedFlag = null;
    sheet.hidden = true;
    view.draw();
  }
  $('flag-done').addEventListener('click', () => closeSheet(true));
  $('flag-label').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeSheet(true);
    if (e.key === 'Escape') closeSheet(false);
  });
  $('flag-delete').addEventListener('click', () => {
    const f = state.selectedFlag;
    if (!f) return;
    state.flags = state.flags.filter((x) => x !== f);
    state.selectedFlag = null;
    sheet.hidden = true;
    flagOp('remove', { id: f.id }, (b) => {
      if (b.undo?.op) toast(f.label ? `Flag "${f.label}" deleted` : 'Flag deleted', 'ok', { action: { label: 'Undo', run: () => undo(b.undo.op) } });
    });
    redraw();
  });

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
    $('play').textContent = playing ? '❚❚' : '▶';
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
  $('notes-play').addEventListener('click', togglePlay);
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
  $('flag-now').addEventListener('click', () => addFlagAt(Math.min(total - 1, state.cursor)));
  function stepFlag(dir) {
    const f = dir < 0 ? prevFlag(state.flags, state.cursor) : nextFlag(state.flags, state.cursor);
    if (!f) return;
    seekTo(f.frame);
    view.follow(f.frame);
  }
  $('flag-prev').addEventListener('click', () => stepFlag(-1));
  $('flag-next').addEventListener('click', () => stepFlag(1));

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
      hold = setTimeout(() => { repeated = true; rep = setInterval(step, 120); }, 500);
    });
    for (const evName of ['pointerup', 'pointercancel', 'pointerleave']) {
      b.addEventListener(evName, () => {
        clearTimeout(hold); clearInterval(rep);
        setTimeout(() => { repeated = false; }, 0);
      });
    }
  }
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
    $('boundary-readout').textContent = `${edge === 'start' ? 'In' : edge === 'end' ? 'Out' : 'Bar 1'} ${fmtSample(f, sr)}${off ? ` · ${off}` : ''}`;
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
      updateReadout();
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
    const name = take.label || stampOf(file);
    $('take-name').textContent = name;
    $('take-name').classList.toggle('unlabelled', !take.label);
    document.title = `${name} — Hindsight`;
    $('take-star').setAttribute('aria-pressed', String(!!take.starred));
    $('take-star').classList.toggle('on', !!take.starred);
    $('take-bpm').textContent = tempoLabel(take.bpm, take.tempo_from);
    $('take-bpm').classList.toggle('unset', !take.bpm);
    $('take-len').textContent = state.region
      ? `${fmtClock(state.region.end - state.region.start, sr)} of ${fmtClock(total, sr)}`
      : fmtClock(total, sr);
    const src = take.source;
    $('take-source').hidden = !src;
    if (src) {
      $('take-source').textContent = `from ${stampOf(src.name)}`;
      $('take-source').href = `/wave.html?file=${encodeURIComponent(src.name)}`;
    }
    renderSnap();
    // A tempo cleared while bar 1 is being edited ends that edit.
    renderEditor();
  }

  function inlineEdit(button, input, { initial, commit }) {
    button.addEventListener('click', () => {
      input.value = initial();
      button.hidden = true;
      input.hidden = false;
      input.focus();
      input.select();
    });
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
      if (e.key === 'Escape') { cancelled = true; input.blur(); }
    });
  }
  inlineEdit($('take-name'), $('take-name-input'), {
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

  // Previous and next take, in the order the list last showed them.
  async function neighbours() {
    let order = null;
    try { order = JSON.parse(sessionStorage.getItem('hindsight.order') || 'null'); } catch {}
    if (!Array.isArray(order) || !order.includes(file)) {
      try {
        const res = await fetch('/api/jams');
        if (res.ok) order = (await res.json()).map((t) => t.name);
      } catch {}
    }
    if (!Array.isArray(order)) return;
    const i = order.indexOf(file);
    // replace, not a new entry: Back from any take in a run of ◂/▸ still
    // goes straight to the list (see the back button below).
    const go = (name) => () => {
      flushRegion();
      try { sessionStorage.setItem('hindsight.hop', '1'); } catch {}
      location.replace(`/wave.html?file=${encodeURIComponent(name)}`);
    };
    if (i > 0) { $('take-prev').disabled = false; $('take-prev').onclick = go(order[i - 1]); }
    if (i >= 0 && i < order.length - 1) { $('take-next').disabled = false; $('take-next').onclick = go(order[i + 1]); }
  }

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
    if (document.body.classList.contains('notes-open')) { e.preventDefault(); closeNotes(); return; }
    if (fromList && history.length > 1) { e.preventDefault(); history.back(); }
  });

  // --- menus ------------------------------------------------------------------
  function wireMenu(button, menu) {
    const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', () => close());
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== button) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  wireMenu($('menu-btn'), $('take-menu'));
  wireMenu($('more-btn'), $('more-menu'));

  $('downbeat-reset').addEventListener('click', () => {
    state.grid.downbeat = 0;
    patch({ downbeat_frame: null }).catch((e) => toast(`Could not reset the downbeat: ${e.message}`, 'bad'));
    updateReadout();
    follow(); renderEditor(); // bar 1 being edited has moved
    redraw();
  });
  $('dl-wav').href = `/api/download?file=${encodeURIComponent(file)}&dl=1`;
  if (take.has_midi && take.midi_name) {
    $('dl-midi').hidden = false;
    $('dl-midi').href = `/api/download?file=${encodeURIComponent(take.midi_name)}&dl=1`;
  }
  // To the trash, so it doesn't ask: the list says "Deleted · Undo".
  $('delete-take').addEventListener('click', async () => {
    try {
      await whenSaved();
      const res = await fetch(`/api/delete?file=${encodeURIComponent(file)}`, { method: 'DELETE', headers: withClient() });
      if (!res.ok) throw new Error(`status ${res.status}`);
      pendingTrim = null; // nothing left to save it to
      clock.pause();
      toastNext({ msg: `Deleted ${take.label || stampOf(file)}`, restore: file });
      if (fromList && history.length > 1) history.back();
      else location.href = list || '/takes.html';
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'bad');
    }
  });

  // --- Send to tape -------------------------------------------------------------
  // The selection (or the whole take) onto track 1 of the loaded tape, at its
  // playhead -- or, on an empty tape, as its first loop. Offered only when
  // the Pi runs the tape.
  const tapeAPI = async (path, opts = {}) => {
    const res = await fetch(path, { cache: 'no-store', ...opts });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b.error || `status ${res.status}`);
    return b;
  };
  fetch('/api/tapes', { cache: 'no-store' }).then((r) => {
    if (r.ok) { $('send-to-tape').hidden = false; $('copy-take').hidden = false; }
  }).catch(() => {});
  // Copy: the selection (or the whole take) onto the clipboard, for Drop on
  // a tape.
  const copyTake = async () => {
    const from = state.region ? state.region.start : 0;
    const to = state.region ? state.region.end : total;
    await tapeAPI('/api/clipboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ take: file, from, to }),
    });
    return to - from;
  };
  $('copy-take').addEventListener('click', async () => {
    try {
      const n = await copyTake();
      toast(`Copied ${fmtClock(n, sr)}: Drop it on a tape`, 'ok', { action: { label: 'Open the tape', run: () => { location.href = '/tape.html'; } } });
    } catch (e) {
      toast(`Could not copy: ${e.message}`, 'bad');
    }
  });
  // Send to tape: copy, then drop at the loaded tape's playhead, on track 1
  // -- or, on an empty tape, as its first loop.
  $('send-to-tape').addEventListener('click', async () => {
    try {
      const n = await copyTake();
      // Whichever tape is loaded now: another device may have changed it.
      let id = (await tapeAPI('/api/tapes')).loaded;
      if (!id) {
        const t = await tapeAPI('/api/tapes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: take.label || '' }) });
        await tapeAPI(`/api/tapes/load?id=${encodeURIComponent(t.id)}`, { method: 'POST' });
        id = t.id;
      }
      await tapeAPI(`/api/tapes/drop?id=${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track: 1 }),
      });
      toast(`Sent ${fmtClock(n, sr)} to tape, track 1`, 'ok', { action: { label: 'Open the tape', run: () => { location.href = '/tape.html'; } } });
    } catch (e) {
      toast(`Could not send to tape: ${e.message}`, 'bad');
    }
  });

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
      const list = await fetch('/api/jams', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : []));
      const s = familyOf(fold(Array.isArray(list) ? list : []), name).spine;
      return s && s.name !== name ? s.label || stampOf(s.name) : '';
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
  const shareVerb = canShareFiles() ? 'Share' : 'Download';
  function setShareLabel() {
    const r = state.region;
    shareBtn.textContent = r ? `${shareVerb} · ${fmtClock(r.end - r.start, sr)}` : shareVerb;
  }
  shareBtn.addEventListener('click', async () => {
    if (!state.region && total > MAX_SHARE_SECONDS * sr) {
      toast(`Select a part first — the whole take is over ${MAX_SHARE_SECONDS / 60} minutes`, 'bad');
      return;
    }
    const from = state.region ? state.region.start : 0;
    const to = state.region ? state.region.end : total;
    shareBtn.disabled = true;
    shareBtn.textContent = 'Rendering…';
    try {
      const res = await fetch(`/api/render?file=${encodeURIComponent(file)}&from=${from}&to=${to}`);
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
      if (result === 'downloaded' && shareVerb === 'Share') toast('Shared as a download');
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
    $('notes-open').hidden = false;
    syncNotes();
  }

  // --- rising notes on a phone ------------------------------------------
  // Fullscreen over the page, sharing its clock, with a thin strip of the
  // waveform on top so where you are in the take stays in sight.
  function openNotes() {
    if (document.body.classList.contains('notes-open')) return;
    document.body.classList.add('notes-open');
    history.pushState({ notes: 1 }, '');
    updateReadout();
    syncNotes();
    stripResize();
  }
  function closeNotes() {
    if (!document.body.classList.contains('notes-open')) return;
    if (history.state && history.state.notes) { history.back(); return; }
    document.body.classList.remove('notes-open');
    syncNotes();
  }
  window.addEventListener('popstate', () => {
    if (!document.body.classList.contains('notes-open')) return;
    document.body.classList.remove('notes-open');
    syncNotes();
  });
  $('notes-open').addEventListener('click', openNotes);
  const onBenchChange = () => { if (bench.matches) closeNotes(); syncNotes(); };
  bench.addEventListener('change', onBenchChange);

  const strip = $('notes-strip');
  const stripCtx = strip.getContext('2d');
  let stripCols = null;
  let stripGain = null;
  function stripResize() {
    const r = strip.getBoundingClientRect();
    if (r.width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    strip.width = Math.round(r.width * dpr);
    strip.height = Math.round(r.height * dpr);
    stripCols = levelsFor(filePeaks, Math.max(1, Math.round(r.width)));
    drawStrip();
  }
  function drawStrip() {
    if (!stripCols || !document.body.classList.contains('notes-open')) return;
    const dpr = window.devicePixelRatio || 1;
    const W = strip.width / dpr, H = strip.height / dpr;
    stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stripCtx.clearRect(0, 0, W, H);
    const played = (state.cursor / total) * W;
    const waveOn = token('--wave', '#268bd2'), waveOff = token('--wave-dim', '#a3b0ae');
    // The take's trace, on its own scale (as its view above), lit where played.
    const opts = { cy: H / 2, half: H / 2 - 2, gain: stripGain ??= takeGain(filePeaks), fillAlpha: 0.3 };
    drawTrace(stripCtx, stripCols, stripCols, { ...opts, fillAlpha: 0.45, line: waveOff });
    stripCtx.save();
    stripCtx.beginPath();
    stripCtx.rect(0, 0, played, H);
    stripCtx.clip();
    drawTrace(stripCtx, stripCols, stripCols, { ...opts, line: waveOn });
    stripCtx.restore();
    if (state.region) {
      stripCtx.fillStyle = withAlpha(waveOn, 0.2);
      stripCtx.fillRect((state.region.start / total) * W, 0, ((state.region.end - state.region.start) / total) * W, H);
    }
  }
  new ResizeObserver(stripResize).observe(strip);

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
      case 'f': case 'F': addFlagAt(Math.min(total - 1, state.cursor)); break;
      case '[': setPointAt('start'); break;
      case ']': setPointAt('end'); break;
      case 'l': case 'L': if (state.region || state.loop) setLoop(!state.loop); break;
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
    setText($('np-mini'), lcd.big);
    setText($('np-time'), lcd.small);
    setText($('np-unit'), lcd.unit);
    setAttr($('np-status'), 'data-state', lcd.status);
    // The marquee's words change with the name, tempo and selection only.
    const mk = `${take.label}|${state.grid.bpm}|${state.region ? `${state.region.start}-${state.region.end}` : ''}`;
    if (mk !== marqueeKey) {
      marqueeKey = mk;
      setText($('np-marquee'), takeMarquee({ name: take.label || stampOf(file), bpm: state.grid.bpm, region: state.region, sampleRate: sr }));
    }
    // The slider, for a screen reader: to the tenth of a second, not every frame.
    const ov = $('overview-canvas');
    setAttr(ov, 'aria-valuemax', String(total));
    setAttr(ov, 'aria-valuenow', String(Math.round(state.cursor / (sr / 10)) * (sr / 10)));
    setAttr(ov, 'aria-valuetext', `${bar ? `bar ${bar}, ` : ''}${fmtTime(Math.round(state.cursor / (sr / 10)) * (sr / 10), sr)}`);
    setAttr($('to-start'), 'aria-label', state.region ? 'Back to In' : 'Back to the start');
    $('notes-bar').textContent = bar || fmtTime(state.cursor, sr);
    feedReels();
  }
  let marqueeKey = null;
  function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
  function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }

  renderHeader();
  renderSelection();
  updateReadout();
  syncTransport();
  view.fitAll();
  loadLanes();
  neighbours();
  // Two hooks, because neither alone covers a phone: pagehide fires on
  // navigation, visibilitychange when the app is switched or the screen locks.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { bar.commit(); flushRegion(); }
  });
  // Back in view, back online, or back from a sleep that stopped the clock:
  // the take as the Pi has it now, with a "Reconnecting…" note until it answers.
  link = watchLink(() => refetchTake());
  window.addEventListener('pagehide', () => {
    clearTimeout(loopTimer);
    bar.commit();
    editResize.disconnect();
    flushRegion();
    screenLock?.release();
    bench.removeEventListener('change', onBenchChange);
    clock.destroy(); tiles.stop(); view.destroy(); overview.destroy();
    if (lanes) lanes.destroy();
    if (notes) notes.destroy();
  });
}

// pagehide tears the page down; one restored from the back-forward cache
// would come back without a clock or a view, so it loads afresh instead.
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

main().catch((e) => fail(e.message || String(e)));
