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
  SNAPS, SNAP_LABELS, nudgeFrame, snapFrame, setPoint, prevFlag, nextFlag,
} from './geometry.js';
import { peakColumns, foldChannels, drawColumns } from './draw.js';
import { flagRequest, asFlags, newFlagId } from '../flags.js';
import { holdScreen } from '../wakelock.js';
import { initHelp } from '../help/help.js';

// Mirrors audio.MaxRenderSeconds: the server's cap on a share render.
const MAX_SHARE_SECONDS = 600;
const SPEEDS = [0.5, 1, 2];

const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get('file');

function toast(msg, kind = 'ok', ms = 4000) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function fail(msg) {
  $('wave-error').textContent = msg;
  $('wave-error').hidden = false;
  $('wave-canvas').hidden = true;
  $('overview-canvas').hidden = true;
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
  if (!file) return fail('No take given.');
  // A reload while the notes pane was open leaves a stale {notes:1} entry
  // that would otherwise pop straight into the (unbuilt) pane on Back.
  if (history.state && history.state.notes) history.replaceState(null, '');
  initHelp({ page: 'take', toast });
  const [takeRes, peaksRes] = await Promise.all([
    fetch(`/api/take?file=${encodeURIComponent(file)}`),
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

  // --- state (the page owns it; the views read it each draw) -------------
  const state = {
    region: take.trim ? { start: take.trim.start_frame, end: take.trim.end_frame } : null,
    pending: null, // a lone In or Out waiting for its other half
    flags: asFlags(take.flags),
    grid: { bpm: take.bpm || null, sampleRate: sr, downbeat: take.downbeat_frame || 0 },
    snap: SNAPS.includes(readPref('wave.snap', 'off')) ? readPref('wave.snap', 'off') : 'off',
    cursor: 0,
    selectedFlag: null,
    loop: false, // off on every open (editing model, decision 1)
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
  const view = new WaveView({ canvas, tiles, totalFrames: total, sampleRate: sr, getState: () => state, emit });
  overview = new Overview({
    canvas: $('overview-canvas'), filePeaks, totalFrames: total,
    getState: () => state, getView: () => view.view,
    emit: (ev, p) => {
      if (ev === 'panTo') view.panTo(p.start);
      else if (ev === 'centerOn') view.centerOn(p.frame);
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
      if (clock.playing && !view.gesture) view.follow(frame);
      updateReadout(); redraw();
    },
    onError: (m) => toast(m, 'bad'),
    onEnded: () => { syncTransport(); syncNotes(); },
  });
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

  // --- sidecar patches ----------------------------------------------------
  // Saves still on their way to the Pi. A refetch that lands meanwhile would
  // put older values back on screen, so it waits for them (see refetchTake).
  let savesInFlight = 0;
  let refetchWanted = false;
  function track(p) {
    savesInFlight++;
    return p.finally(() => {
      if (--savesInFlight === 0 && refetchWanted) { refetchWanted = false; refetchTake(); }
    });
  }
  function patch(body) {
    return track((async () => {
      const res = await fetch(`/api/take?file=${encodeURIComponent(file)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `status ${res.status}`);
      }
      return res.json();
    })());
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
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), keepalive: true,
    })).catch(() => {});
  }
  function saveDownbeat() {
    patch({ downbeat_frame: state.grid.downbeat }).catch((e) => toast(`Could not save the downbeat: ${e.message}`, 'bad'));
  }
  // One flag per request, by id (see /lib/flags.js), sent in order. The page
  // shows the change at once; the server's answer then replaces the list.
  function flagOp(op, args) {
    flagRequest(file, op, args).then((b) => {
      if (b.cue_error) toast(b.cue_error, 'bad');
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
      const res = await fetch(`/api/take?file=${encodeURIComponent(file)}`, { cache: 'no-store' });
      if (!res.ok) return;
      fresh = await res.json();
    } catch { return; }
    const keep = state.selectedFlag && state.selectedFlag.id;
    state.flags = asFlags(fresh.flags);
    if (keep) state.selectedFlag = state.flags.find((f) => f.id === keep) || null;
    take.label = fresh.label;
    take.bpm = fresh.bpm;
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
    renderHeader();
    updateReadout();
    redraw();
  }

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
      case 'viewChange': if (overview) overview.draw(); if (lanes) lanes.draw(); break;
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
    flagOp('remove', { id: f.id });
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
    $('loop').setAttribute('aria-pressed', String(state.loop));
    $('loop').disabled = !state.region && !state.loop;
    // The sample-exact loop runs at 1×; practice speed is for the preview.
    const speedOff = state.loop && !!state.region;
    for (const b of $('speed').querySelectorAll('button')) b.disabled = speedOff;
    $('notes-speed').disabled = speedOff;
    syncScreenLock();
  }
  $('play').addEventListener('click', togglePlay);
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
  function clearSelection() {
    state.region = null;
    state.pending = null;
    selectionChanged();
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
    $('set-in').classList.toggle('pending', state.pending?.edge === 'start');
    $('set-out').classList.toggle('pending', state.pending?.edge === 'end');
    if (!r && state.loop) { state.loop = false; applyLoop(); }
    setShareLabel();
    renderHeader();
    syncTransport();
  }

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
    renderSnap();
  });

  // --- header ---------------------------------------------------------------
  function renderHeader() {
    const name = take.label || stampOf(file);
    $('take-name').textContent = name;
    $('take-name').classList.toggle('unlabelled', !take.label);
    document.title = `${name} — Hindsight`;
    $('take-star').setAttribute('aria-pressed', String(!!take.starred));
    $('take-star').classList.toggle('on', !!take.starred);
    $('take-bpm').textContent = take.bpm ? `${take.bpm} bpm` : '+ bpm';
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
      take.bpm = bpm;
      state.grid.bpm = bpm;
      renderHeader(); updateReadout(); redraw();
      try {
        const res = await patch({ bpm });
        take.bpm = res.bpm ?? null;
        state.grid.bpm = take.bpm;
        renderHeader(); redraw();
      } catch (e) {
        take.bpm = before; state.grid.bpm = before || null;
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

  // Back returns to the list as it was: the browser's own Back keeps its
  // scroll, where a fresh load of "/" would start at the top.
  // A ◂/▸ hop replaces the page, so the referrer is then the last take, not
  // the list; whether the run began at the list is kept for the session.
  let fromList = false;
  try {
    const ref = document.referrer && new URL(document.referrer);
    const hop = sessionStorage.getItem('hindsight.hop') === '1';
    sessionStorage.removeItem('hindsight.hop');
    if (hop) fromList = sessionStorage.getItem('hindsight.fromList') === '1';
    else fromList = !!ref && ref.origin === location.origin && ref.pathname === '/';
    sessionStorage.setItem('hindsight.fromList', fromList ? '1' : '0');
  } catch {}
  document.querySelector('.topbar .back').addEventListener('click', (e) => {
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
    redraw();
  });
  $('dl-wav').href = `/api/download?file=${encodeURIComponent(file)}&dl=1`;
  if (take.has_midi && take.midi_name) {
    $('dl-midi').hidden = false;
    $('dl-midi').href = `/api/download?file=${encodeURIComponent(take.midi_name)}&dl=1`;
  }
  $('delete-take').addEventListener('click', async () => {
    const dlg = $('confirm');
    let ok;
    if (typeof dlg.showModal === 'function') {
      $('confirm-name').textContent = take.label || file;
      dlg.returnValue = 'cancel';
      dlg.showModal();
      ok = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'delete'), { once: true }));
    } else {
      ok = window.confirm(`Delete ${file}?`);
    }
    if (!ok) return;
    try {
      const res = await fetch(`/api/delete?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      pendingTrim = null; // nothing left to save it to
      location.href = '/';
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'bad');
    }
  });

  // --- Save as take ---------------------------------------------------------
  $('save-take').addEventListener('click', async () => {
    if (!state.region) return;
    const btn = $('save-take');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/cut?file=${encodeURIComponent(file)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_frame: state.region.start, end_frame: state.region.end, label: '' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      // Built as nodes: the name comes from the server and is never markup.
      const t = document.createElement('div');
      t.className = 'toast ok';
      t.append('Saved as ');
      const a = document.createElement('a');
      a.href = `/wave.html?file=${encodeURIComponent(body.name)}`;
      a.textContent = body.name;
      t.appendChild(a);
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 8000);
    } catch (e) {
      toast(`Could not save as a take: ${e.message}`, 'bad');
    } finally {
      btn.disabled = !state.region;
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
    for (const t of midi.tracks) if (laneKinds[t.name]) t.kind = laneKinds[t.name];
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
  function stripResize() {
    const r = strip.getBoundingClientRect();
    if (r.width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    strip.width = Math.round(r.width * dpr);
    strip.height = Math.round(r.height * dpr);
    stripCols = foldChannels(peakColumns(filePeaks, Math.round(r.width)), filePeaks.channels);
    drawStrip();
  }
  function drawStrip() {
    if (!stripCols || !document.body.classList.contains('notes-open')) return;
    const dpr = window.devicePixelRatio || 1;
    const W = strip.width / dpr, H = strip.height / dpr;
    stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stripCtx.clearRect(0, 0, W, H);
    const played = (state.cursor / total) * W;
    drawColumns(stripCtx, stripCols, 1, { top: 0, height: H, color: (x) => (x < played ? '#34d399' : '#2c5f52') });
    if (state.region) {
      stripCtx.fillStyle = 'rgba(52,211,153,0.2)';
      stripCtx.fillRect((state.region.start / total) * W, 0, ((state.region.end - state.region.start) / total) * W, H);
    }
  }
  new ResizeObserver(stripResize).observe(strip);

  // --- keyboard -----------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    // Cmd-+, Ctrl-0 and friends belong to the browser.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Space on a focused control presses that control; it is not Play too.
    if (e.key === ' ' && e.target.closest?.('button, a, select, [role="button"], [tabindex]')) return;
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
  function updateReadout() {
    $('pos-bar').textContent = barBeat(state.cursor, state.grid);
    $('pos-time').textContent = fmtTime(state.cursor, sr);
    $('notes-bar').textContent = barBeat(state.cursor, state.grid) || fmtTime(state.cursor, sr);
  }

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
    if (document.visibilityState === 'hidden') flushRegion();
    else refetchTake();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(loopTimer);
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
