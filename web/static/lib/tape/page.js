// web/static/lib/tape/page.js
// The tape page: the loaded tape's four tracks, its transport, and catching
// from the ring. The Pi does the work (internal/tape); this page polls its
// state a few times a second and sends what you tap.

import { toast } from '../toast.js';
import { canShareFiles, shareOrDownload } from '../wave/share.js';
import { initHelp } from '../help/help.js';
import { drawBars, takeGain } from '../wave/draw.js';
import { clipLabel, blockLevels, labelFits, placeLabel } from './blocks.js';
import { roundRectPath } from '../cassette-geom.js';
import {
  editView as viewRange, barSpan, nearestBar, xOf, frameAt, barLines, bpm as bpmOf, barBeat, fmtSecs,
  SNAPS, slideTo, nudgeFrames, splitAt, joinPartner, fitsDoubled, zoomView, panView, followView, levelAt,
} from './geometry.js';
import { meterFill, quietNote, levelText, isSilent, QUIET } from './levels.js';
import { punchStart, traceAdd, recRegion, wrappedSince, fullPasses } from './rec.js';
import { initAway } from './away-sheet.js';
import { initOutput } from './output-ui.js';
import { Pending } from './pending.js';
import { token, withAlpha, onSchemeChange } from '../theme.js';
import { TapeMachine } from './machine.js';
import { initNav } from '../nav.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 200;

const state = {
  id: '',           // the tape shown (the loaded one)
  tape: null,
  live: null,
  sources: [],
  undo: 0,
  redo: 0,
  track: 1,         // the selected track
  source: readPref('tape.source', 'aux'),
  mode: readPref('tape.mode', 'layer'), // a catch onto audio: layer or replace
  clip: null,       // the clip whose sheet is open
  clipboard: null,  // what /api/clipboard says
  sel: null,        // a ruler drag in progress: {from, to} tape frames
  scope: readPref('tape.scope', 'one'), // lift and copy: the selected track, or all
  snap: readPref('tape.snap', 'bar'),   // what a slid clip snaps to
  slide: null,      // a clip being slid: {n, clip, at}
  zoom: null,       // the lanes' view once pinched, panned or paged: {from, to}; null shows the loop
  touchedView: 0,   // when a pinch or pan last moved the view: following waits a moment after
  noClickUntil: 0,  // a lane's click before this ends a pan, not a tap
  pinch: false,     // two fingers are on the lanes or the ruler
  rec: null,        // a punch being recorded: {key, track, start, trace, wrapped}
};
const peaks = new Map(); // pool file -> PeakData, or a pending promise
// A pool file's gain for its bars (lib/wave/draw.js takeGain): one per file,
// so every clip of it -- a repeat, a split's halves -- is drawn alike.
const gains = new Map();
function gainOf(file, pd) {
  if (!gains.has(file)) gains.set(file, takeGain(pd));
  return gains.get(file);
}

function readPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(b.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return b;
}
const q = () => `id=${encodeURIComponent(state.id)}`;

// --- loading ------------------------------------------------------------------

async function boot() {
  initHelp({ page: 'tape', toast });
  initNav();
  initAway({
    button: $('away'),
    sheet: $('away-sheet'),
    toast,
    api,
    getTape: () => state.tape && { id: state.id, tape: state.tape, track: state.track, replace: state.mode === 'replace' },
    onPlaced: (d, k) => {
      const t = state.tape;
      const bars = t && t.grid ? (k.to - k.from) / (t.grid.frames / t.grid.bars) : 0;
      const n = Math.round(bars);
      const what = n > 0 && Math.abs(bars - n) < 0.01 ? `${n} bar${n === 1 ? '' : 's'}` : `${((k.to - k.from) / k.sr).toFixed(1)} s`;
      const msg = `Kept ${what} from this device on track ${k.track}`;
      caughtToast(msg, d.clip, { action: { label: 'Undo', run: () => undoRedo(false) } });
      poll();
      const note = quietNote(d.clip);
      return note ? `${msg} — ${note}` : msg;
    },
    onUndo: () => undoRedo(false),
  });
  output = initOutput({ api, toast, poll, transport, getTape: () => state.tape, getGhost: () => ghost });
  let list;
  try {
    list = await api('/api/tapes');
  } catch (e) {
    if (e.status === 404) { $('tape-off').hidden = false; return; }
    toast(`Could not reach the tape: ${e.message}`, 'bad');
    return;
  }
  $('tape-body').hidden = false;
  if (!list.loaded) {
    // No tape yet: make the first one.
    const t = list.tapes[0] || await api('/api/tapes', { method: 'POST', body: { name: '' } });
    await api(`/api/tapes/load?id=${encodeURIComponent(t.id)}`, { method: 'POST' });
    state.id = t.id;
  } else {
    state.id = list.loaded;
  }
  wire();
  await poll();
  fetchClipboard();
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  setInterval(() => { if (!document.hidden) fetchClipboard(); }, 2000);
}

// gen counts this page's changes, bumped as each is sent and again as its
// answer arrives: a poll in flight across either may answer with the tape
// from before the change, and is dropped.
let polling = false;
let gen = 0;
async function poll() {
  if (polling || !state.id) return;
  polling = true;
  const g = gen;
  try {
    // Only an empty tape with no grid can use a suggested tempo, so only
    // then is one asked for.
    const bare = state.tape && !state.tape.grid && state.tape.tracks.every((tr) => tr.clips.length === 0);
    const s = await api(`/api/tapes/state?${q()}${bare ? '&suggest=1' : ''}`);
    if (g !== gen) return;
    if (!s.loaded) { await follow(); return; }
    apply(s);
  } catch (e) {
    if (e.status === 404 && g === gen) await follow();
  } finally {
    polling = false;
  }
}

// follow switches to the tape that's loaded now, because another device
// loaded it.
async function follow() {
  try {
    const l = await api('/api/tapes');
    if (!l.loaded || l.loaded === state.id) return;
    const s = await api(`/api/tapes/state?id=${encodeURIComponent(l.loaded)}`);
    state.id = l.loaded;
    closeSheets();
    apply(s);
    toast('Another device loaded a different tape');
  } catch { /* the next poll tries again */ }
}

// change sends one change and shows the tape it answers with.
async function change(send) {
  gen++;
  try {
    const s = await send();
    gen++;
    if (s && s.tape) apply(s);
    return s;
  } catch (e) {
    gen++;
    throw e;
  }
}

function apply(s) {
  const changed = JSON.stringify(s.tape) !== JSON.stringify(state.tape);
  if (state.tape && s.tape && s.tape.id !== state.tape.id) { state.zoom = null; delete $('new-bpm').dataset.touched; }
  state.tape = s.tape;
  // The empty-tape form starts at the tempo you were playing, until you type.
  if (s.suggest_bpm && !$('new-bpm').dataset.touched) $('new-bpm').value = String(s.suggest_bpm);
  state.live = s.live || null;
  // On this phone, show what's heard: everything that draws the playhead
  // reads live.heard.
  if (state.live && output && output.streamingHere()) {
    const h = output.player.heard();
    if (h) state.live.heard = h.pos;
  }
  state.sources = s.sources || [];
  state.undo = s.undo || 0;
  state.redo = s.redo || 0;
  if (state.track > state.tape.tracks.length) state.track = 1;
  if (changed) { buildLanes(); loadPeaks(); }
  followPlayhead();
  tracePunch();
  render();
  feedMachine();
}

// feedMachine hands the machine over the lanes what this poll said: where
// the tape is, whether it plays or records, and how to read each track's
// level at a frame.
let machine = null;
let output = null;
let ghost = null; // a locate seen but not yet heard, { pos, until }
const pending = new Pending();

// askHeard notes a mute or solo press, so the track keeps sounding as it did
// until the change reaches this phone's speaker.
function askHeard(n) {
  if (!output || !output.streamingHere()) return;
  const tr = track(n);
  pending.ask(n, { mute: tr.mute, solo: tr.solo }, output.player.delayMs(), performance.now());
}

// heardTracks is the tracks as the speaker plays them now.
function heardTracks() {
  const now = performance.now();
  return state.tape.tracks.map((tr) => ({ ...tr, ...pending.heard(tr.n, tr, now) }));
}

// jamOnly explains, and refuses, what needs the jam room while the tape
// plays on a phone.
function jamOnly() {
  if (!state.live || state.live.output_mode !== 'phone') return false;
  $('jam-only-delay').textContent = `${(((output && output.player.delayMs()) || 800) / 1000).toFixed(1)} s`;
  $('jam-only').showModal();
  return true;
}
function feedMachine() {
  const t = state.tape, live = state.live;
  if (!t) return;
  machine ??= new TapeMachine($('tape-machine'));
  machine.setTracks(t.tracks.length);
  const tracks = heardTracks();
  const anySolo = tracks.some((tr) => tr.solo);
  const peaksOf = (f) => peaks.get(f);
  machine.poll({
    heard: live ? live.heard : 0,
    playing: !!(live && live.playing && !(live.count_in > 0)),
    recording: !!(live && live.record && live.record.state === 'on' && live.record.tape === t.id),
    length: t.length,
    sampleRate: t.sample_rate,
    levels: (frame) => tracks.map((tr) => levelAt(tr, frame, peaksOf, t.sample_rate, anySolo)),
  });
}

// laneView is the span of tape the lanes and the ruler show: where a pinch,
// a pan or the playhead took it, else the loop and a bar either side.
function laneView() {
  return state.zoom || viewRange(state.tape);
}

// followPlayhead pages the view after a playhead that has run out of it --
// past the loop's Out with the loop off, say -- unless a finger moved the
// view a moment ago.
function followPlayhead() {
  const live = state.live;
  if (!live || !live.playing || live.count_in > 0 || state.pinch || state.slide || state.sel) return;
  if (performance.now() - state.touchedView < 2500) return;
  const v = laneView();
  const f = followView(v, live.heard, state.tape.length);
  if (f !== v) state.zoom = f;
}

// tracePunch follows a punch as it records: where it starts, and the
// source's level at each poll, drawn on its lane until it ends and its clip
// arrives.
function tracePunch() {
  const t = state.tape, live = state.live;
  const r = live && live.record;
  if (!r || r.state !== 'on' || !t.grid || r.tape !== t.id) { state.rec = null; return; }
  const key = `${r.from}:${r.track}`;
  if (!state.rec || state.rec.key !== key) state.rec = { key, track: r.track, start: null, trace: null, wrapped: false };
  const counting = live.count_in > 0;
  if (state.rec.start === null && (counting || live.playing)) {
    const obs = { counting, pos: live.pos, heard: live.heard, delivered: live.delivered, from: r.from };
    state.rec.start = punchStart(t.grid, t.loop, obs);
    // A page opened mid-punch: the loop may have come round already.
    state.rec.wrapped = !counting && wrappedSince(t.loop, obs);
  }
  if (live.playing && !counting) {
    const src = state.sources.find((x) => x.name === r.source);
    state.rec.trace = traceAdd(state.rec.trace, live.heard, src && src.peak_db);
  }
}

function loadPeaks() {
  for (const t of state.tape.tracks) {
    for (const c of t.clips) {
      if (peaks.has(c.file)) continue;
      const p = fetch(`/api/tapes/peaks?file=${encodeURIComponent(c.file)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((pd) => { peaks.set(c.file, pd); drawLanes(); })
        .catch(() => peaks.set(c.file, null));
      peaks.set(c.file, p);
    }
  }
}

// --- rendering ------------------------------------------------------------------

function render() {
  const t = state.tape;
  const live = state.live;
  const sr = t.sample_rate;
  $('tape-name-text').textContent = t.name;
  $('tape-name').title = `${t.name}: switch tape`;
  document.title = `${t.name} — tape — Hindsight`;
  // The tempo, and the loop in bars (the grid's own until the ruler moves
  // it).
  let sub = 'no tempo yet', short = '–', full = 'No tempo yet';
  if (t.grid) {
    const bars = t.loop.out > t.loop.in ? Math.round((t.loop.out - t.loop.in) / (t.grid.frames / t.grid.bars)) : t.grid.bars;
    const bpm = bpmOf(t.grid, sr);
    sub = `${bpm.toFixed(1)} BPM · ${bars} bar${bars === 1 ? '' : 's'}${t.loop.on ? '' : ', not looping'}`;
    // A narrow phone has no room for the words: the note says tempo, the
    // pair reads "84 · 4", and the words are in the label.
    short = `${Math.round(bpm)} · ${bars}`;
    full = `Tempo ${sub}: change the bars`;
  }
  $('tape-sub-long').textContent = sub;
  $('tape-sub-short').textContent = short;
  $('tape-sub').setAttribute('aria-label', full);
  $('tape-sub').title = full;
  $('tape-sub').disabled = !t.grid;
  const empty = t.tracks.every((tr) => tr.clips.length === 0);
  $('tape-empty').hidden = !(empty && !t.grid);
  $('tape-undo').disabled = !state.undo;
  $('tape-redo').disabled = !state.redo;
  const lock = live ? live.aligned : 'none';
  // The sign over the door: lit only while a punch is going onto tape.
  const onAir = !!(live && live.playing && live.record && live.record.state === 'on' && live.record.tape === t.id);
  $('rec-sign').classList.toggle('on', onAir);
  // Playing on a phone, there is nothing to line up: grey, not red.
  const phoneOut = !!(live && live.output_mode === 'phone');
  $('lock-dot').className = `dot lock ${phoneOut ? 'off' : lock === 'exact' || lock === 'locked' ? 'ok' : lock === 'estimated' ? 'wait' : 'bad'}`;
  $('lock-dot').title = phoneOut ? 'no lock: the tape is playing on a phone' : lock === 'none' ? 'not lined up yet: catches wait'
    : lock === 'estimated' ? 'lined up by the clocks: nudge a catch if it’s off' : `lined up to the sample (${lock})`;

  const md = live && live.mixdown && live.mixdown.tape === t.id ? live.mixdown : null;
  const mixing = !!(md && (md.state === 'playing' || md.state === 'tail'));
  // Through a mixdown's tail too: ■ there cancels it.
  const playing = !!(live && (live.playing || live.count_in > 0)) || mixing;
  $('play').textContent = playing ? '■' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('play').classList.toggle('playing', playing);
  $('play').disabled = !live || !live.output;
  $('loop').setAttribute('aria-pressed', String(!!t.loop.on));
  $('loop').disabled = !(t.loop.out > t.loop.in);
  const heard = live ? live.heard : 0;
  const counting = !!(live && live.count_in > 0);
  if (counting && t.grid) {
    // The render head is ahead of what's heard by what's rendered ahead.
    const beat = t.grid.frames / t.grid.bars / 4;
    const left = Math.min(t.grid.frames / t.grid.bars, live.count_in + Math.max(0, live.out - live.delivered));
    $('position').textContent = `count-in ${Math.min(4, Math.max(1, 4 - Math.floor((left - 1) / beat)))} of 4`;
  } else if (md && md.state === 'playing') {
    $('position').textContent = `mixing down · ${fmtSecs(Math.max(0, heard - md.from), sr)} of ${fmtSecs(md.to - md.from, sr)} · ■ cancels`;
  } else if (md && md.state === 'tail') {
    $('position').textContent = 'mixing down · letting it ring out · ■ cancels';
  } else if (md && md.state === 'saving') {
    $('position').textContent = 'saving the mixdown as a take…';
  } else {
    $('position').textContent = live ? `${barBeat(heard, t.grid) || ''} ${fmtSecs(heard, sr)}${live.output ? '' : ' · no output'}` : '';
  }
  // Rec: armed (waiting for ▶), counting in, or recording.
  const rec = live && live.record;
  const rb = $('rec');
  rb.setAttribute('aria-pressed', String(!!(rec && rec.state === 'on' && !counting)));
  rb.classList.toggle('armed', !!(rec && rec.state === 'armed'));
  rb.classList.toggle('counting', counting);
  // It names the source it records from, under its label: that's easy to
  // lose sight of in the row below.
  if (!rb.firstElementChild) {
    rb.replaceChildren(Object.assign(document.createElement('span'), { className: 'rec-what' }),
      Object.assign(document.createElement('span'), { className: 'rec-src' }));
  }
  const recWhat = !rec ? '● Rec' : rec.state === 'armed' ? `● Armed ${rec.track}` : `● Rec ${rec.track}`;
  const recSrc = rec ? rec.source : state.source;
  rb.firstElementChild.textContent = recWhat;
  rb.lastElementChild.textContent = recSrc;
  setIf(rb, 'aria-label', `${recWhat.slice(2)} from ${recSrc}`);
  // In phone mode it stays pressable whatever else is true, so the jam-room sheet can explain.
  rb.disabled = !rec && !phoneOut && (!live || live.aligned === 'none' || !t.grid || mixing);
  $('click').setAttribute('aria-pressed', String(!!t.click));
  $('click').disabled = !t.grid;
  $('tap').textContent = live && live.tapped ? 'Tap where it comes round' : 'Tap where the loop starts';
  $('tap').classList.toggle('second', !!(live && live.tapped));

  noteMixdown(live && live.mixdown);
  renderClock(live && live.clock, t);
  renderSources();
  renderPasses();
  const canCatch = live && live.aligned !== 'none';
  $('catch-pass').disabled = !phoneOut && (!canCatch || !(live.cycles || []).length);
  for (const b of $('catch-bars').querySelectorAll('button')) b.disabled = !canCatch || !t.grid;
  rb.setAttribute('aria-disabled', String(phoneOut));
  rb.classList.toggle('dim', phoneOut);
  $('catch-pass').classList.toggle('jam-only', phoneOut);
  $('catch-pass').textContent = phoneOut ? 'Catch · jam room only' : 'Catch the last pass';
  $('jam-only-note').hidden = !phoneOut;
  for (const id of ['sources', 'catch-bars', 'catch-mode', 'passes']) $(id).hidden = phoneOut;
  renderMode();
  renderClipboard();
  renderEdit();
  drawLanes();
  drawOverview();
  drawRuler();
  renderFit();
  if (output) output.render(state.live);
}

function renderMode() {
  for (const b of $('catch-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
}

// --- the clipboard -------------------------------------------------------------

// cbGen moves when this page learns the clipboard from an edit's answer, so
// a fetch already in flight with the old one is dropped.
let cbGen = 0;
async function fetchClipboard() {
  const g = cbGen;
  let c = null, err = '';
  try {
    const b = await api('/api/clipboard');
    c = b.clipboard || null;
    err = b.error || '';
  } catch { /* shown as empty */ }
  if (g !== cbGen) return;
  state.clipboard = c;
  state.clipboardError = err;
  renderClipboard();
}

function renderClipboard() {
  const c = state.clipboard;
  const t = state.tape;
  const chip = $('clip-play');
  if (state.clipboardError) {
    chip.textContent = 'can’t be read: × clears it';
  } else if (!c || !t) {
    chip.textContent = 'empty';
  } else {
    const secs = (c.frames / t.sample_rate).toFixed(1);
    const n = c.tracks.length;
    chip.textContent = `${$('clip-audio').paused ? '▶' : '■'} ${secs} s${n > 1 ? ` · ${n} tracks` : ''} · ${c.from}`;
  }
  chip.disabled = !c;
  chip.classList.toggle('playing', !$('clip-audio').paused);
  // A several-track clipboard lands from the selected track down; Merge
  // puts it on the one.
  const fits = !!(c && t && state.track + c.tracks.length - 1 <= t.tracks.length);
  $('drop').disabled = !fits;
  $('drop').title = c && t && !fits ? `${c.tracks.length} tracks don't fit from track ${state.track}: Merge puts them on it` : '';
  $('merge').hidden = !(c && c.tracks.length > 1);
  $('merge').disabled = !t;
  $('clip-clear').disabled = !c && !state.clipboardError;
}

function auditionClipboard() {
  const a = $('clip-audio');
  if (!a.paused) { a.pause(); renderClipboard(); return; }
  a.src = `/api/clipboard/audio?t=${encodeURIComponent(state.clipboard ? state.clipboard.created : '')}`;
  a.play().catch((e) => toast(`Could not play the clipboard: ${e.message}`, 'bad'));
  renderClipboard();
}

async function drop(merge = false) {
  // Read before the request: a poll may change the clipboard meanwhile.
  const c = state.clipboard;
  const secs = c && state.tape ? (c.frames / state.tape.sample_rate).toFixed(1) : '';
  try {
    const d = await change(() => api(`/api/tapes/drop?${q()}`, { method: 'POST', body: { track: state.track, merge } }));
    const n = c ? c.tracks.filter((tr) => tr && tr.length).length : 0;
    const what = merge ? `Merged ${n} track${n === 1 ? '' : 's'}, ${secs} s, onto track ${state.track}`
      : `Dropped ${secs} s on track ${state.track}${d.tracks > 1 ? ` and the ${d.tracks - 1} after it` : ''}`;
    // A copy from the ribbon carries its level: say if it's silent.
    const silent = c && c.tracks.some((tr) => tr && tr.some((x) => isSilent(x.peak_db)));
    toast(silent ? `${what} — some of it is silent: nothing came in where it was copied from` : what, silent ? 'warn' : 'ok', {
      action: { label: 'Undo', run: () => undoRedo(false) },
    });
    poll();
  } catch (e) {
    toast(`Could not drop: ${e.message}`, 'bad');
  }
}

// --- the clock ---------------------------------------------------------------

// renderClock says who follows the tape's clock (TAPE_CLOCK=lead).
function renderClock(c, t) {
  const el = $('clock-out');
  el.hidden = !c;
  if (!c) return;
  const who = c.devices.length ? c.devices.join(', ') : 'no device plugged in';
  el.textContent = !t.grid ? 'clock: once the tape has a tempo'
    : `clock → ${who}${c.running ? ' ●' : ''}${c.running && c.heard_bpm ? ` · hears ${c.heard_bpm} BPM` : ''}`;
  el.classList.toggle('none', !c.devices.length);
}

// --- mixdown and export ------------------------------------------------------

// mixdown plays the loop (or, with all, the whole tape) once and saves what
// the mixer put out as a take; live.mixdown follows it.
async function mixdown(all) {
  if (jamOnly()) return;
  try {
    const b = await change(() => api(`/api/tapes/mixdown?${q()}`, { method: 'POST', body: { all } }));
    const md = b.mixdown;
    state.mixKey = `${md.id}:${md.state}`;
    toast(`Mixing down ${fmtSecs(md.to - md.from, state.tape.sample_rate)}: the tape plays it once, then it’s saved as a take`, 'ok', {
      ms: 6000, action: { label: 'Cancel', run: () => transport('stop') },
    });
    poll();
  } catch (e) {
    toast(`Could not mix down: ${e.message}`, 'bad');
  }
}

// noteMixdown says when a mixdown ends -- once, and not for one that ended
// before this page opened.
function noteMixdown(md) {
  const key = md ? `${md.id}:${md.state}` : '';
  if (state.mixKey === undefined) { state.mixKey = key; return; }
  if (key === state.mixKey) return;
  state.mixKey = key;
  if (!md || md.tape !== state.id) return;
  if (md.state === 'done') {
    toast('Mixed down as a take', 'ok', {
      ms: 10000, action: { label: 'Open it', run: () => { location.href = `/wave.html?file=${encodeURIComponent(md.take)}`; } },
    });
  } else if (md.state === 'failed') {
    toast(`The mixdown didn’t save: ${md.error}`, 'bad');
  }
}

// exportStems asks first, so a refusal is a toast rather than a page of
// JSON, then downloads the zip as it renders.
async function exportStems(e) {
  e.preventDefault();
  closeMenus();
  const url = `/api/tapes/export?${q()}`;
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) {
    const why = !res ? 'the Pi didn’t answer'
      : res.status === 409 ? 'another export is being made, or this tape isn’t the loaded one'
        : res.status === 400 ? 'there’s nothing on the tape to export' : `HTTP ${res.status}`;
    toast(`Could not export: ${why}`, 'bad');
    return;
  }
  toast('Rendering the stems: the download starts in a moment');
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// shareClip offers a clip to the share sheet as a WAV -- a short one; a long
// one downloads, without holding it all in the phone's memory. A sheet that
// won't open (too long after the tap, say) downloads too.
async function shareClip(c) {
  const t = state.tape;
  const url = `/api/tapes/clip?${q()}&clip=${encodeURIComponent(c.id)}`;
  if (c.frames / t.sample_rate > 60 || !canShareFiles()) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  toast('Preparing the WAV…');
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    toast(`Could not share it: ${e.message}`, 'bad');
    return;
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    toast(`Could not share it: ${b.error || `HTTP ${res.status}`}`, 'bad');
    return;
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=utf-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/.exec(cd);
  let name = 'clip.wav';
  try { if (m) name = decodeURIComponent(m[1]); } catch { /* keep the plain one */ }
  await shareOrDownload(await res.blob(), name, name, 'audio/wav');
}

// --- editing: lift, copy, split, join, slide, multiply ------------------------

function renderEdit() {
  const t = state.tape;
  const live = state.live;
  for (const b of $('edit-scope').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope));
    if (b.dataset.scope === 'one') b.textContent = `Track ${state.track}`;
  }
  const sel = t.loop.out > t.loop.in;
  $('ed-lift').disabled = !sel;
  $('ed-copy').disabled = !sel;
  $('ed-split').disabled = !live || !track(state.track) || splitAt(track(state.track), live.heard, t.sample_rate) === 0;
  $('ed-x2').disabled = !fitsDoubled(t);
  const box = $('snap');
  if (!box.children.length) {
    for (const s of SNAPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.snap = s.id;
      b.dataset.tip = 'tape-snap';
      b.textContent = s.label;
      b.addEventListener('click', () => { state.snap = s.id; writePref('tape.snap', s.id); renderEdit(); });
      box.appendChild(b);
    }
  }
  for (const b of box.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.snap === (t.grid ? state.snap : 'off')));
    b.disabled = !t.grid && b.dataset.snap !== 'off';
  }
}

// edit sends one edit, shows the tape it answers with, and answers what the
// edit did -- or null, having said why not.
async function edit(op, extra = {}) {
  try {
    const s = await change(() => api(`/api/tapes/edit?${q()}`, { method: 'POST', body: { op, track: state.track, ...extra } }));
    const e = (s && s.edit) || {};
    if (e.clipboard) { cbGen++; state.clipboard = e.clipboard; state.clipboardError = ''; renderClipboard(); }
    return e;
  } catch (err) {
    toast(`Could not ${op === 'multiply' ? 'double the loop' : op}: ${err.message}`, 'bad');
    return null;
  }
}

const undoAction = { label: 'Undo', run: () => undoRedo(false) };

// spanText reads the loop as bars, or seconds with no tempo.
function spanText() {
  const t = state.tape;
  const l = t.loop;
  if (!t.grid) return `${((l.out - l.in) / t.sample_rate).toFixed(1)} s`;
  const n = Math.round((l.out - l.in) / (t.grid.frames / t.grid.bars));
  return `${n} bar${n === 1 ? '' : 's'}`;
}

async function liftCopy(op) {
  const all = state.scope === 'all';
  const what = `${spanText()} of ${all ? 'every track' : `track ${state.track}`}`;
  const e = await edit(op, { all });
  if (!e) return;
  if (op === 'lift') toast(`Lifted ${what} to the clipboard: Drop puts it at the playhead`, 'ok', { action: undoAction });
  else toast(`Copied ${what}: Drop puts it at the playhead`, 'ok');
}

async function split() {
  const e = await edit('split');
  if (e) toast(`Split ${e.clips} clip${e.clips === 1 ? '' : 's'} on track ${state.track}`, 'ok', { action: undoAction });
}

async function multiply() {
  const e = await edit('multiply');
  if (e) toast(`The loop is ${spanText()} now`, 'ok', { action: undoAction });
}

async function slide(clip, at) {
  const e = await edit('slide', { clip: clip.id, at });
  const t = state.tape;
  if (e) toast(`Slid to ${t.grid ? `bar ${barBeat(at, t.grid)}` : fmtSecs(at, t.sample_rate)}`, 'ok', { action: undoAction });
}

// wireLane: tap a clip for its sheet, or an empty part of the lane to move
// the playhead (a click, so the sheet opens after the tap is done with);
// hold a clip, then drag, to slide it along its track, snapping as chosen.
function wireLane(lane) {
  const cv = lane.canvas;
  let down = null;      // the one pointer being followed
  let slidUntil = 0;    // a click before this ends a slide, not a tap
  const hitAt = (x) => (lane.hits || []).filter((h) => x >= h.x0 && x <= h.x1).pop();
  const finish = (commit) => {
    const d = down;
    down = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.held) return;
    const sl = state.slide;
    state.slide = null;
    cv.classList.remove('sliding');
    drawLanes();
    if (d.moved) slidUntil = performance.now() + 600;
    // Only a drag commits: a held tap that wobbled a pixel moves nothing.
    if (commit && d.moved && sl && sl.at !== sl.clip.at) slide(sl.clip, sl.at);
  };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('click', (e) => {
    if (performance.now() < slidUntil) { slidUntil = 0; return; }
    if (performance.now() < state.noClickUntil) return; // the end of a pan or pinch
    laneTap(lane, e);
  });
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || e.button > 0 || down) return; // one pointer at a time
    const hit = hitAt(e.clientX - cv.getBoundingClientRect().left);
    if (!hit) return;
    down = { x: e.clientX, y: e.clientY, hit, moved: false, held: false, id: e.pointerId };
    down.timer = setTimeout(() => {
      if (!down || down.moved || state.pinch) return;
      down.held = true;
      try { cv.setPointerCapture(down.id); } catch { /* the pointer's gone */ }
      state.slide = { n: lane.n, clip: hit.clip, at: hit.clip.at };
      cv.classList.add('sliding');
      if (navigator.vibrate) navigator.vibrate(10);
      drawLanes();
    }, 300);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const far = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
    if (!down.held) {
      if (far) { down.moved = true; clearTimeout(down.timer); down = null; } // a swipe: the browser's
      return;
    }
    if (far) down.moved = true;
    if (!down.moved || !state.slide) return;
    const view = laneView();
    const df = ((e.clientX - down.x) / cv.getBoundingClientRect().width) * (view.to - view.from);
    state.slide.at = slideTo(state.tape.grid, down.hit.clip.at, df, state.snap);
    drawLanes();
  });
  // While a slide is held, a finger's drag is the slide's, not a scroll.
  cv.addEventListener('touchmove', (e) => { if (down && down.held) e.preventDefault(); }, { passive: false });
  cv.addEventListener('pointerup', (e) => { if (down && e.pointerId === down.id) finish(true); });
  cv.addEventListener('pointercancel', (e) => { if (down && e.pointerId === down.id) finish(false); });
  cv.addEventListener('lostpointercapture', (e) => { if (down && down.held && e.pointerId === down.id) finish(false); });
}

// --- the ruler -----------------------------------------------------------------

function drawRuler() {
  const t = state.tape;
  if (!t) return;
  const cv = $('tape-ruler');
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  const W = r.width, H = r.height;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const view = laneView();
  if (ghost && performance.now() >= ghost.until) ghost = null;
  const ink = token('--well-ink', '#f2e6c8'), warn = token('--warn', '#b58900');
  const span = (from, to, fill) => {
    const x0 = Math.max(0, xOf(from, view, W)), x1 = Math.min(W, xOf(to, view, W));
    if (x1 > x0) { ctx.fillStyle = fill; ctx.fillRect(x0, 0, x1 - x0, H); }
  };
  if (t.loop.out > t.loop.in) span(t.loop.in, t.loop.out, withAlpha(warn, t.loop.on ? 0.22 : 0.08));
  if (state.sel) span(state.sel.from, state.sel.to, withAlpha(token('--sel', '#268bd2'), 0.35));
  ctx.font = `10px ${token('--mono', 'ui-monospace, monospace')}`;
  ctx.textBaseline = 'middle';
  for (const b of barLines(t.grid, view)) {
    const x = Math.round(xOf(b.frame, view, W));
    ctx.fillStyle = withAlpha(ink, 0.35);
    ctx.fillRect(x, H * 0.45, 1, H * 0.55);
    ctx.fillStyle = ink;
    if (x + 3 < W - 8) ctx.fillText(String(b.n), x + 3, H * 0.3);
  }
  if (state.live) {
    const x = xOf(state.live.heard, view, W);
    if (x >= 0 && x <= W) { ctx.fillStyle = token('--accent', '#cb4b16'); ctx.fillRect(Math.round(x), 0, 2, H); }
  }
  // A locate seen but not yet heard: a hollow marker where the sound will be.
  if (ghost) {
    const x = xOf(ghost.pos, view, W);
    if (x >= 0 && x <= W) {
      ctx.strokeStyle = token('--accent', '#cb4b16'); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x - 5, 1); ctx.lineTo(x + 5, 1); ctx.lineTo(x, 9); ctx.closePath(); ctx.stroke();
    }
  }
}

// Tap the ruler: the playhead to the nearest bar line. Hold, then drag:
// select whole bars, which become the loop.
function wireRuler() {
  const cv = $('tape-ruler');
  let down = null;
  const frameOf = (e) => {
    const r = cv.getBoundingClientRect();
    return frameAt(Math.min(r.width, Math.max(0, e.clientX - r.left)), laneView(), r.width);
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || down) return; // a second finger is a pinch's
    cv.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, f: frameOf(e), held: false, moved: false };
    down.timer = setTimeout(() => {
      if (!down || down.moved || !state.tape.grid || state.pinch) return;
      down.held = true;
      state.sel = barSpan(state.tape.grid, down.f, down.f);
      if (navigator.vibrate) navigator.vibrate(10);
      drawRuler();
    }, 300);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (down.held) {
      state.sel = barSpan(state.tape.grid, down.f, frameOf(e));
      drawRuler();
    } else if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      down.moved = true; // a swipe, not a tap or a hold
    }
  });
  const end = (e, cancelled) => {
    if (!down) return;
    clearTimeout(down.timer);
    const d = down;
    down = null;
    if (d.held) {
      const sel = state.sel;
      state.sel = null;
      drawRuler();
      if (!cancelled && sel) {
        const n = Math.round((sel.to - sel.from) / (state.tape.grid.frames / state.tape.grid.bars));
        patch({ loop: { in: sel.from, out: sel.to, on: true } }).then((ok) => ok && toast(`Looping ${n} bar${n === 1 ? '' : 's'}`, 'ok', {
          action: { label: 'Undo', run: () => undoRedo(false) },
        }));
      }
    } else if (!d.moved && !cancelled && performance.now() >= state.noClickUntil) {
      const f = frameOf(e);
      transport('locate', { pos: state.tape.grid ? nearestBar(state.tape.grid, f) : f });
    }
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
}

// --- the view: pinch, pan, Fit --------------------------------------------------

// redrawView redraws what the view moves, once a frame however many moves.
let viewRaf = 0;
function redrawView() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => { viewRaf = 0; drawLanes(); drawRuler(); drawOverview(); renderFit(); });
}

// Canvases don't restyle themselves when the device turns dark or light.
onSchemeChange(redrawView);

function renderFit() { $('view-fit').hidden = !state.zoom; }

// The closest the view goes: a quarter of a second across.
const minSpan = () => Math.round(state.tape.sample_rate * 0.25);

function setView(v) {
  const now = performance.now();
  state.zoom = v;
  state.touchedView = now;
  state.noClickUntil = now + 400;
  redrawView();
}

// wireView: on the lanes or the ruler, two fingers pinch the view closer
// or wider and pan it with their midpoint; one finger dragged sideways pans
// (a vertical one still scrolls the page); with a trackpad or a wheel,
// ctrl/⌘ zooms and a sideways scroll pans. A held slide or loop drag keeps
// its finger. The view stays where it's put until Fit.
function wireView(el, rectOf) {
  const pts = new Map();
  let g = null;
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, d: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)) };
  };
  el.addEventListener('pointerdown', (e) => {
    if (!state.tape || e.button > 0 || e.target.tagName !== 'CANVAS') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && !state.slide && !state.sel) {
      const r = rectOf(), m = mid();
      state.pinch = true;
      state.noClickUntil = performance.now() + 400;
      g = { kind: 'pinch', v0: laneView(), x0: m.x - r.left, d0: m.d, w: r.width };
    } else if (pts.size === 1) {
      g = { kind: 'maybe', v0: laneView(), x0: e.clientX, y0: e.clientY, w: rectOf().width, id: e.pointerId };
    }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p || !g) return;
    p.x = e.clientX; p.y = e.clientY;
    if (state.slide || state.sel) { g = null; return; }
    const len = state.tape.length;
    if (g.kind === 'pinch') {
      if (pts.size < 2) return;
      const r = rectOf(), m = mid();
      const anchor = g.v0.from + (g.x0 / g.w) * (g.v0.to - g.v0.from);
      const v = zoomView(g.v0, anchor, g.d0 / m.d, len, minSpan());
      setView(panView(v, -((m.x - r.left - g.x0) / g.w) * (v.to - v.from), len));
    } else if (e.pointerId === g.id) {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (g.kind === 'maybe' && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) g.kind = 'pan';
      if (g.kind === 'pan') setView(panView(g.v0, -(dx / g.w) * (g.v0.to - g.v0.from), len));
    }
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (g && g.kind !== 'maybe') state.noClickUntil = performance.now() + 400;
    if (pts.size === 0) { g = null; state.pinch = false; } else if (g && g.kind === 'pinch') g = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    if (!state.tape) return;
    const r = rectOf(), v = laneView(), span = v.to - v.from;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const anchor = v.from + ((e.clientX - r.left) / r.width) * span;
      setView(zoomView(v, anchor, Math.exp(e.deltaY * 0.01), state.tape.length, minSpan()));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setView(panView(v, ((e.shiftKey ? e.deltaY : e.deltaX) / r.width) * span, state.tape.length));
    }
  }, { passive: false });
}

// --- a track's sheet -------------------------------------------------------------

function openTrack(n) {
  const tr = track(n);
  if (!tr) return;
  state.sheetTrack = n;
  $('track-title').textContent = `Track ${n}`;
  $('track-name').value = tr.name || '';
  $('track-gain').value = String(tr.gain_db);
  $('track-gain-val').textContent = `${tr.gain_db} dB`;
  $('track-pan').value = String(tr.pan || 0);
  $('track-pan-val').textContent = panText(tr.pan || 0);
  const sh = $('track-sheet');
  if (typeof sh.showModal === 'function') sh.showModal();
}

function panText(p) {
  if (Math.abs(p) < 0.01) return 'centre';
  return `${Math.round(Math.abs(p) * 100)}% ${p < 0 ? 'left' : 'right'}`;
}

// renderSources draws the source chips, each with its meter: built once,
// then updated in place on every poll so a meter moves without the chip
// being replaced under a finger.
function renderSources() {
  const box = $('sources');
  const names = state.sources.map((s) => s.name).join(' ');
  if (box.dataset.names !== names) {
    box.dataset.names = names;
    box.replaceChildren(...state.sources.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'source';
      b.dataset.tip = 'source-chip';
      b.dataset.name = s.name;
      const label = document.createElement('span');
      label.className = 'source-name';
      const meter = document.createElement('span');
      meter.className = 'meter';
      meter.setAttribute('aria-hidden', 'true');
      meter.appendChild(document.createElement('i'));
      b.append(label, meter);
      b.addEventListener('click', () => {
        const r = state.live && state.live.record;
        if (r && r.source !== s.name) {
          // An armed or running punch keeps the source it began with.
          toast(`● Rec is ${r.state === 'armed' ? 'armed' : 'recording'} from ${r.source}: end it to record from ${s.name}`, 'warn');
          return;
        }
        state.source = s.name;
        writePref('tape.source', s.name);
        render();
      });
      return b;
    }));
  }
  // While a punch is armed or running, the lit chip is the one it records.
  const r = state.live && state.live.record;
  const lit = r ? r.source : state.source;
  for (const b of box.children) {
    const s = state.sources.find((x) => x.name === b.dataset.name);
    if (!s) continue;
    setIf(b, 'aria-pressed', String(s.name === lit));
    const label = `${s.name} ${s.clean ? '●' : '○'}`;
    if (b.firstChild.textContent !== label) b.firstChild.textContent = label;
    const bar = b.lastChild.firstChild;
    const width = `${Math.round(meterFill(s.peak_db) * 100)}%`;
    if (bar.style.width !== width) bar.style.width = width;
    bar.classList.toggle('hot', typeof s.peak_db === 'number' && s.peak_db > -1);
    const lvl = levelText(s.peak_db);
    const title = (s.clean ? 'clean: no tape in it' : `the tape is in it (bus ${s.leaks.join('+')})`) + (lvl ? ` · ${lvl}` : '');
    if (b.title !== title) b.title = title;
  }
}

function setIf(el, attr, v) {
  if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
}

// caughtToast adds a word to a catch's toast when it came back silent or very
// quiet, and makes it a warning.
function caughtToast(msg, clip, opts) {
  const note = quietNote(clip);
  toast(note ? `${msg} — ${note}` : msg, note ? 'warn' : 'ok', note ? { ...opts, ms: 12000 } : opts);
}

function renderPasses() {
  const cycles = (state.live && state.live.cycles) || [];
  const recent = cycles.slice(-6);
  const box = $('passes');
  box.replaceChildren(...recent.map((c, i) => {
    const k = recent.length - i; // 1 is the last one
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pass';
    b.dataset.tip = 'passes';
    b.textContent = `−${k}`;
    b.title = `Catch pass −${k} onto track ${state.track}`;
    // By the pass's own start, so it's the one on screen even if another
    // has finished since.
    b.addEventListener('click', () => doCatch({ out: c.out }));
    return b;
  }));
  if (!recent.length) {
    const s = document.createElement('span');
    s.className = 'muted';
    s.textContent = 'each time round the loop is kept here';
    box.appendChild(s);
  }
}

// One row per track: a header and a lane.
const lanes = [];
function buildLanes() {
  const box = $('lanes');
  const t = state.tape;
  if (lanes.length !== t.tracks.length) {
    box.replaceChildren();
    lanes.length = 0;
    for (const tr of t.tracks) {
      const row = document.createElement('div');
      row.className = 'tape-track';
      row.innerHTML = `
        <div class="tt-head" data-tip="track">
          <span class="tt-num" aria-hidden="true"></span>
          <button class="tt-name" type="button"></button>
          <button class="chip tt-bus" type="button" data-tip="bus"></button>
          <button class="chip tt-mute" type="button" aria-pressed="false" data-tip="track-mute">M</button>
          <button class="chip tt-solo" type="button" aria-pressed="false" data-tip="track-solo">S</button>
          <span class="tt-pend" hidden></span>
          <input class="tt-gain" type="range" min="-30" max="6" step="0.5" aria-label="Track level" data-tip="track-gain">
        </div>
        <canvas class="tt-lane" data-tip="tape-lane"></canvas>`;
      const n = tr.n;
      // The track's colour, for its number's ring (styles.css .tt-num).
      row.style.setProperty('--tc', `var(--t${((n - 1) % 4) + 1})`);
      row.querySelector('.tt-num').textContent = String(n);
      row.querySelector('.tt-name').dataset.n = String(n);
      const lane = {
        n, row,
        name: row.querySelector('.tt-name'),
        bus: row.querySelector('.tt-bus'),
        mute: row.querySelector('.tt-mute'),
        solo: row.querySelector('.tt-solo'),
        pend: row.querySelector('.tt-pend'),
        gain: row.querySelector('.tt-gain'),
        canvas: row.querySelector('.tt-lane'),
      };
      // Tap a track to select it; tap it again for its sheet.
      lane.name.addEventListener('click', () => { if (state.track === n) openTrack(n); else { state.track = n; render(); } });
      lane.bus.addEventListener('click', () => patch({ track: { n, bus: track(n).bus === 'A' ? 'B' : 'A' } }));
      lane.mute.addEventListener('click', () => { askHeard(n); patch({ track: { n, mute: !track(n).mute } }); });
      lane.solo.addEventListener('click', () => { askHeard(n); patch({ track: { n, solo: !track(n).solo } }); });
      lane.gain.addEventListener('input', () => { lane.gain.dataset.busy = '1'; });
      lane.gain.addEventListener('change', () => { delete lane.gain.dataset.busy; patch({ track: { n, gain_db: Number(lane.gain.value) } }); });
      wireLane(lane);
      box.appendChild(row);
      lanes.push(lane);
    }
  }
}

function track(n) { return state.tape.tracks[n - 1]; }

function drawLanes() {
  const t = state.tape;
  if (!t) return;
  const view = laneView();
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  for (const lane of lanes) {
    const tr = track(lane.n);
    if (!tr) continue;
    lane.row.classList.toggle('selected', lane.n === state.track);
    // The number is in its ring; the masking tape carries the name, blank until
    // there is one, as a strip waiting to be written on.
    lane.name.textContent = tr.name || '';
    lane.name.setAttribute('aria-label', `Track ${tr.n}${tr.name ? `, ${tr.name}` : ''}`);
    lane.name.title = tr.name ? `${tr.n} ${tr.name}` : `Track ${tr.n}`;
    lane.bus.textContent = tr.bus;
    lane.mute.setAttribute('aria-pressed', String(!!tr.mute));
    lane.solo.setAttribute('aria-pressed', String(!!tr.solo));
    // The keys show the ask; the lane dims with the sound, until it is heard.
    const heardTr = heardTracks();
    const ht = heardTr.find((x) => x.n === tr.n);
    const heardSolo = heardTr.some((x) => x.solo);
    const isPending = pending.pending(tr.n, performance.now());
    lane.row.classList.toggle('unheard', !!ht && (ht.mute || (heardSolo && !ht.solo)));
    lane.row.classList.toggle('pending', isPending);
    lane.pend.hidden = !isPending;
    if (isPending) lane.pend.textContent = `in ${(output.player.delayMs() / 1000).toFixed(1)} s`;
    if (!lane.gain.dataset.busy) lane.gain.value = String(tr.gain_db);
    lane.gain.title = `${tr.gain_db} dB`;

    const cv = lane.canvas;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const W = r.width, H = r.height;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // The loop, a faint amber band across every lane.
    if (t.loop && t.loop.out > t.loop.in) {
      const lx0 = xOf(t.loop.in, view, W), lx1 = xOf(t.loop.out, view, W);
      ctx.fillStyle = withAlpha(col('--warn', '#b58900'), t.loop.on ? 0.07 : 0.03);
      ctx.fillRect(lx0, 0, Math.max(0, lx1 - lx0), H);
    }
    // Bar lines.
    for (const b of barLines(t.grid, view)) {
      const x = Math.round(xOf(b.frame, view, W));
      ctx.fillStyle = col('--well-rule', 'rgba(242,230,200,.14)');
      ctx.fillRect(x, 0, 1, H);
    }
    // Clips, base layer first: each a rounded block in the track's colour
    // with rounded bars inside (lib/tape/blocks.js), lit where it has played,
    // and a label when it's wide enough. A layer over another is fainter.
    const tc = trackColor(lane.n, col);
    const ink = col('--well-ink', '#f2e6c8');
    const heard = state.live ? xOf(state.live.heard, view, W) : null;
    lane.hits = [];
    const labels = [];
    const sorted = [...tr.clips].sort((a, b) => a.layer - b.layer);
    for (const c of sorted) {
      const nudge = nudgeFrames(c, t.sample_rate);
      const x0 = xOf(c.at + nudge, view, W), x1 = xOf(c.at + nudge + c.frames, view, W);
      if (x1 < 0 || x0 > W) continue;
      const top = 2 + Math.min(c.layer, 3) * 3, h = H - 4 - Math.min(c.layer, 3) * 3;
      const bw = Math.max(1, x1 - x0);
      const radius = Math.min(6, bw / 2, h / 2);
      const block = () => { ctx.beginPath(); roundRectPath(ctx, x0 + 0.75, top + 0.75, Math.max(0.5, bw - 1.5), h - 1.5, radius); };
      // One being slid stays where it is, faint, until it lands.
      ctx.globalAlpha = state.slide && state.slide.clip.id === c.id ? 0.35 : 1;
      block();
      ctx.fillStyle = withAlpha(tc, c.layer ? 0.1 : 0.16);
      ctx.fill();
      const pd = peaks.get(c.file);
      if (pd && !(pd instanceof Promise) && bw > 8) {
        const lv = blockLevels(pd, c, bw);
        const bars = { x0: x0 + 4, pitch: 4, cy: top + h / 2 + 3, half: Math.max(1, h / 2 - 12), gain: gainOf(c.file, pd), width: 2.2 };
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, bw, h);
        ctx.clip();
        drawBars(ctx, lv, { ...bars, color: withAlpha(tc, c.layer ? 0.4 : 0.55) });
        if (heard != null && heard > x0) {
          ctx.beginPath();
          ctx.rect(x0, top, Math.min(heard, x1) - x0, h);
          ctx.clip();
          ctx.shadowColor = withAlpha(tc, 0.7);
          ctx.shadowBlur = 4 * dpr;
          drawBars(ctx, lv, { ...bars, color: tc });
        }
        ctx.restore();
      }
      if (labelFits(bw)) {
        const label = clipLabel(c, tr);
        ctx.save();
        ctx.font = `10px ${col('--mono', 'ui-monospace, monospace')}`;
        const lw = label ? Math.min(bw - 12, ctx.measureText(label).width) : 0;
        if (label && placeLabel(labels, { x: x0 + 6, y: top + 4, w: lw, h: 11 })) {
          ctx.textBaseline = 'top';
          ctx.shadowColor = 'rgba(0,0,0,.9)';
          ctx.shadowBlur = 3 * dpr;
          ctx.fillStyle = withAlpha(ink, 0.85);
          ctx.fillText(label, x0 + 6, top + 4, bw - 12);
        }
        ctx.restore();
      }
      const picked = state.clip && state.clip.id === c.id;
      ctx.lineWidth = picked ? 2 : 1.5;
      ctx.strokeStyle = picked ? ink : tc;
      block();
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      lane.hits.push({ x0, x1, clip: c });
    }
    if (state.rec && state.rec.track === lane.n) drawPunch(ctx, view, W, H, col);
    // A clip being slid: where it would land.
    const sl = state.slide;
    if (sl && sl.n === lane.n) {
      const from = sl.at + nudgeFrames(sl.clip, t.sample_rate); // where it'll sound, as the clip itself is drawn
      const x0 = xOf(from, view, W), x1 = xOf(from + sl.clip.frames, view, W);
      const warn = col('--warn', '#b58900');
      ctx.fillStyle = withAlpha(warn, 0.22);
      ctx.fillRect(x0, 1, Math.max(1, x1 - x0), H - 2);
      ctx.strokeStyle = warn;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0) - 1, H - 3);
      ctx.setLineDash([]);
      ctx.fillStyle = warn;
      ctx.font = `11px ${col('--mono', 'ui-monospace, monospace')}`;
      ctx.textBaseline = 'top';
      ctx.fillText(t.grid ? barBeat(sl.at, t.grid) : fmtSecs(sl.at, t.sample_rate), Math.max(2, x0 + 4), 4);
    }
    // The playhead: what the device is playing now.
    if (state.live) {
      const x = xOf(state.live.heard, view, W);
      if (x >= 0 && x <= W) {
        ctx.fillStyle = col('--accent', '#cb4b16');
        ctx.fillRect(Math.round(x), 0, 2, H);
      }
    }
    // A locate not yet heard: a dashed line where the sound will be.
    if (ghost && performance.now() < ghost.until) {
      const gx = xOf(ghost.pos, view, W);
      if (gx >= 0 && gx <= W) {
        ctx.strokeStyle = col('--accent', '#cb4b16'); ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(Math.round(gx) + 0.5, 0); ctx.lineTo(Math.round(gx) + 0.5, H); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// trackColor is track n's colour: --t1 to --t4, round again past four.
function trackColor(n, col) {
  const i = ((n - 1) % 4) + 1;
  return col(`--t${i}`, ['#268bd2', '#2aa198', '#b58900', '#d33682'][i - 1]);
}

// drawPunch draws a punch recording onto its lane: the span this pass has
// covered, and the source's level along it; or, before the tape reaches it,
// a line where it will start.
function drawPunch(ctx, view, W, H, col) {
  const rec = state.rec, live = state.live, t = state.tape;
  if (rec.start === null || !live) return;
  const red = col('--rec', '#dc322f');
  ctx.save();
  ctx.font = '11px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  const reg = recRegion(rec.wrapped || !!(rec.trace && rec.trace.passes > 0), rec.start, t.loop, live.heard);
  if (!reg) {
    const x = Math.round(xOf(rec.start, view, W)) + 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillText('● REC from here', x + 4, 4);
    ctx.restore();
    return;
  }
  const x0 = xOf(reg.from, view, W), x1 = xOf(reg.to, view, W);
  ctx.globalAlpha = 0.16;
  ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
  ctx.globalAlpha = 1;
  ctx.fillRect(Math.round(x0), 0, 1, H);
  // The level at each poll, held until the next: a rough picture of what's
  // coming in, not the waveform the clip will have.
  // Under the label, so it stays readable.
  const top = 18, room = H - top - 3;
  const ss = rec.trace ? rec.trace.samples : [];
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < ss.length; i++) {
    const a = Math.max(ss[i].pos, reg.from), b = i + 1 < ss.length ? ss[i + 1].pos : reg.to;
    if (b <= a) continue;
    const h = Math.max(1, meterFill(ss[i].db) * room);
    const xa = xOf(a, view, W), xb = xOf(b, view, W);
    ctx.fillRect(xa, top + (room - h) / 2, Math.max(1, xb - xa), h);
  }
  ctx.globalAlpha = 1;
  const full = t.loop.on ? fullPasses(live.cycles, live.record.from) : 0;
  ctx.fillText(full > 0 ? `● REC · ${full} full pass${full === 1 ? '' : 'es'}` : '● REC', Math.max(2, x0 + 4), 4);
  ctx.restore();
}

function drawOverview() {
  const t = state.tape;
  if (!t) return;
  const cv = $('tape-overview');
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height;
  ctx.clearRect(0, 0, W, H);
  // The whole tape, six minutes: what's recorded, and the loop.
  const all = { from: 0, to: t.length };
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  t.tracks.forEach((tr, i) => {
    ctx.fillStyle = withAlpha(trackColor(tr.n, col), 0.75);
    for (const c of tr.clips) {
      const x0 = xOf(c.at, all, W), x1 = xOf(c.at + c.frames, all, W);
      ctx.fillRect(x0, 2 + i * ((H - 4) / t.tracks.length), Math.max(1, x1 - x0), (H - 4) / t.tracks.length - 1);
    }
  });
  if (t.loop.out > t.loop.in) {
    const x0 = xOf(t.loop.in, all, W), x1 = xOf(t.loop.out, all, W);
    ctx.strokeStyle = withAlpha(col('--warn', '#b58900'), t.loop.on ? 1 : 0.4);
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
  }
  if (state.zoom) {
    const x0 = xOf(state.zoom.from, all, W), x1 = xOf(state.zoom.to, all, W);
    ctx.strokeStyle = col('--well-dim', '#a39d90');
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
    ctx.setLineDash([]);
  }
  if (state.live) {
    ctx.fillStyle = col('--accent', '#cb4b16');
    ctx.fillRect(Math.round(xOf(state.live.heard, all, W)), 0, 2, H);
  }
}

// --- actions --------------------------------------------------------------------

// patch changes the tape, and says whether it did.
async function patch(body) {
  try {
    await change(() => api(`/api/tapes?${q()}`, { method: 'PATCH', body }));
    return true;
  } catch (e) {
    toast(`Could not change the tape: ${e.message}`, 'bad');
    return false;
  }
}

async function transport(action, extra = {}) {
  if (action === 'locate' && output && output.streamingHere()) {
    ghost = { pos: extra.pos, until: performance.now() + output.player.delayMs() };
  }
  try {
    const b = await change(() => api(`/api/tapes/transport?${q()}`, { method: 'POST', body: { action, ...extra } }));
    if (b && b.kept) keptToast(b.kept);
    setTimeout(poll, 150);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// keptToast says what a punch kept -- on its own track, all of it, even
// split where the loop wrapped -- with Undo.
function keptToast(k) {
  const bars = state.tape && state.tape.grid ? k.frames / (state.tape.grid.frames / state.tape.grid.bars) : 0;
  const n = Math.round(bars);
  const what = Math.abs(bars - n) < 0.01 && n > 0 ? `${n} bar${n === 1 ? '' : 's'}` : `${(k.frames / state.tape.sample_rate).toFixed(1)} s`;
  caughtToast(`Kept ${what} from ${k.clip.source} on track ${k.track}`, k.clip, { action: { label: 'Undo', run: () => undoRedo(false) } });
}

// rec arms the selected track, punches in, or ends the punch and keeps it.
async function rec() {
  const r = state.live && state.live.record;
  if (!r && jamOnly()) return; // keeping a take already running stays possible
  try {
    if (!r) {
      const b = await change(() => api(`/api/tapes/record?${q()}`, { method: 'POST', body: { track: state.track, source: state.source, replace: state.mode === 'replace' } }));
      const armed = b.record.state === 'armed';
      const { track, source } = b.record;
      toast(armed ? `Track ${track} armed to record ${source}: press ▶ to count in` : `Recording ${source} onto track ${track} from the next bar — tap ● again to keep it`, 'ok', {
        ms: 8000, action: { label: 'Cancel', run: () => api(`/api/tapes/record?${q()}&cancel=1`, { method: 'DELETE' }).then(poll, () => {}) },
      });
    } else {
      const b = await change(() => api(`/api/tapes/record?${q()}`, { method: 'DELETE' }));
      if (b.kept) keptToast(b.kept);
      else toast(r.state === 'armed' ? `Track ${r.track} disarmed` : 'Nothing to keep yet: the tape hadn’t reached a bar line');
    }
    poll();
  } catch (e) {
    toast(`Could not record: ${e.message}`, 'bad');
    poll();
  }
}

// tap is a free-loop tap.
async function tap() {
  if (jamOnly()) return;
  try {
    const b = await change(() => api(`/api/tapes/tap?${q()}`, { method: 'POST', body: { track: state.track, source: state.source } }));
    if (b.stage === 'first') {
      toast('Now tap where it comes round', 'ok', { action: { label: 'Start over', run: () => api(`/api/tapes/tap?${q()}`, { method: 'DELETE' }).then(poll, () => {}) } });
    } else {
      caughtToast(`A ${(b.clip.frames / state.tape.sample_rate).toFixed(2)} s loop: ${b.bars} bar${b.bars === 1 ? '' : 's'} at ${b.bpm} BPM`, b.clip, {
        ms: 8000, action: { label: 'Undo', run: () => undoRedo(false) },
      });
    }
    poll();
  } catch (e) {
    toast(`Could not tap: ${e.message}`, 'bad');
  }
}

// openTempo offers the other bar counts the loop could be: the same frames,
// relabelled, so nothing is stretched.
function openTempo() {
  const t = state.tape;
  const menu = $('tempo-menu');
  const wasOpen = !menu.hidden;
  closeMenus();
  if (!t || !t.grid || wasOpen) return;
  const opts = [];
  for (const bars of [t.grid.bars / 4, t.grid.bars / 2, t.grid.bars, t.grid.bars * 2, t.grid.bars * 4]) {
    if (!Number.isInteger(bars) || bars < 1 || bars > 64) continue;
    const bpm = bpmOf({ frames: t.grid.frames, bars }, t.sample_rate);
    if (bpm < 20 || bpm > 400) continue;
    opts.push({ bars, bpm });
  }
  menu.replaceChildren(...opts.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = o.bars === t.grid.bars ? 'on' : '';
    b.textContent = `${o.bars} bar${o.bars === 1 ? '' : 's'} at ${o.bpm.toFixed(1)} BPM`;
    b.addEventListener('click', () => { closeMenus(); if (o.bars !== t.grid.bars) patch({ bars: o.bars }); });
    return b;
  }));
  showMenu('tempo-menu');
}

function laneTap(lane, e) {
  state.track = lane.n;
  const r = lane.canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const hit = (lane.hits || []).filter((h) => x >= h.x0 && x <= h.x1).pop();
  if (hit) { openClip(hit.clip); return; }
  // An empty part of a lane moves the playhead there.
  transport('locate', { pos: frameAt(x, laneView(), r.width) });
  render();
}

async function doCatch(what) {
  if (jamOnly()) return;
  const body = { track: state.track, source: state.source, replace: state.mode === 'replace', ...what };
  try {
    const b = await change(() => api(`/api/tapes/catch?${q()}`, { method: 'POST', body }));
    const s = (b.clip.frames / state.tape.sample_rate).toFixed(1);
    caughtToast(`Caught ${s} s from ${b.clip.source} onto track ${state.track}${b.clip.clean ? '' : ' — the tape was in that source too'}`, b.clip, {
      action: { label: 'Undo', run: () => undoRedo(false) },
    });
    poll();
  } catch (e) {
    toast(`Could not catch: ${e.message}`, 'bad');
  }
}

async function undoRedo(redo) {
  try {
    await change(() => api(`/api/tapes/${redo ? 'redo' : 'undo'}?${q()}`, { method: 'POST' }));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// closeSheets closes what belongs to the tape shown, before another is.
function closeSheets() {
  const sh = $('clip-sheet');
  if (sh.open) sh.close();
  if ($('track-sheet').open) $('track-sheet').close();
  if ($('rename-sheet').open) $('rename-sheet').close();
  state.clip = null;
  closeMenus();
}

function openClip(c) {
  state.clip = c;
  const lvl = typeof c.peak_db === 'number' && c.peak_db < QUIET ? ` · ${levelText(c.peak_db)} when caught` : '';
  $('clip-title').textContent = `Clip on track ${state.track} · ${(c.frames / state.tape.sample_rate).toFixed(2)} s · ${c.source || ''}${lvl}`
    + (c.aligned === 'estimated' ? ' · caught before the lock: nudge it if it’s early or late' : '');
  $('clip-gain').value = String(c.gain_db || 0);
  $('clip-gain-val').textContent = `${c.gain_db || 0} dB`;
  $('clip-nudge-val').textContent = `${c.nudge_ms || 0} ms`;
  const lp = state.tape.loop;
  $('clip-tile').disabled = !(lp.on && c.at + 2 * c.frames <= lp.out);
  const home = state.tape.tracks.find((tr) => tr.clips.some((x) => x.id === c.id));
  $('clip-join').disabled = !home || !joinPartner(home, c);
  $('clip-reverse').textContent = c.reversed ? 'Play forwards' : 'Reverse';
  const sh = $('clip-sheet');
  if (typeof sh.showModal === 'function') sh.showModal();
  drawLanes();
}

async function newTape() {
  try {
    const t = await api('/api/tapes', { method: 'POST', body: { name: '' } });
    await loadTape(t.id);
  } catch (e) {
    toast(`Could not make a tape: ${e.message}`, 'bad');
  }
}

async function loadTape(id) {
  try {
    await change(async () => {
      const s = await api(`/api/tapes/load?id=${encodeURIComponent(id)}`, { method: 'POST' });
      state.id = id;
      state.tape = null;
      closeSheets();
      return s;
    });
  } catch (e) {
    toast(`Could not load the tape: ${e.message}`, 'bad');
  }
}

// The header's three menus: the title's (the tapes), the tempo's, and ⋯
// (this tape's actions). One open at a time; each says so to assistive tech.
const MENUS = [['tape-menu', 'tape-name'], ['tempo-menu', 'tape-sub'], ['tape-actions', 'tape-more']];
function closeMenus() {
  for (const [m, b] of MENUS) { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
}
function showMenu(id) {
  for (const [m, b] of MENUS) {
    $(m).hidden = m !== id;
    $(b).setAttribute('aria-expanded', String(m === id));
  }
}
const menusOpen = () => MENUS.some(([m]) => !$(m).hidden);

function openActions() {
  if (!$('tape-actions').hidden) { closeMenus(); return; }
  const t0 = state.tape, live = state.live;
  const playable = !!(t0 && live && live.output && t0.tracks.some((tr) => tr.clips.length));
  $('tape-mixdown').disabled = !playable || !(t0.loop.out > t0.loop.in);
  $('tape-mixdown-all').disabled = !playable;
  showMenu('tape-actions');
}

// openRename asks for a new name for the loaded tape. An empty name is
// refused here; the Pi would ignore it anyway.
function openRename() {
  if (!state.tape) return;
  const input = $('rename-name');
  input.value = state.tape.name;
  $('rename-sheet').showModal();
  input.focus();
  input.select();
}

async function openMenu() {
  const menu = $('tape-menu');
  if (!menu.hidden) { closeMenus(); return; }
  let list = { tapes: [] };
  try { list = await api('/api/tapes'); } catch { /* show what we can */ }
  $('tape-list').replaceChildren(...list.tapes.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.tip = 'tape-load';
    b.className = t.id === state.id ? 'on' : '';
    b.textContent = `${t.name}${t.bpm ? ` · ${t.bpm} BPM` : ''} · ${t.clips} clip${t.clips === 1 ? '' : 's'}`;
    b.addEventListener('click', () => { closeMenus(); if (t.id !== state.id) loadTape(t.id); });
    return b;
  }));
  showMenu('tape-menu');
}

function wire() {
  $('jam-only-close').addEventListener('click', () => $('jam-only').close());
  $('jam-only-switch').addEventListener('click', () => { $('jam-only').close(); $('tape-out').click(); });
  $('jam-only-change').addEventListener('click', (e) => { e.preventDefault(); $('tape-out').click(); });
  $('play').addEventListener('click', () => transport($('play').classList.contains('playing') ? 'stop' : 'play'));
  $('rec').addEventListener('click', rec);
  $('click').addEventListener('click', () => patch({ click: !state.tape.click }));
  $('tap').addEventListener('click', tap);
  $('tape-sub').addEventListener('click', (e) => { e.stopPropagation(); openTempo(); });
  for (const b of $('catch-mode').querySelectorAll('button')) {
    b.addEventListener('click', () => { state.mode = b.dataset.mode; writePref('tape.mode', state.mode); renderMode(); });
  }
  $('clip-play').addEventListener('click', auditionClipboard);
  $('clip-audio').addEventListener('ended', renderClipboard);
  $('clip-audio').addEventListener('pause', renderClipboard);
  $('clip-audio').addEventListener('error', () => { $('clip-audio').pause(); renderClipboard(); });
  $('drop').addEventListener('click', () => drop(false));
  $('merge').addEventListener('click', () => drop(true));
  for (const b of $('edit-scope').querySelectorAll('button')) {
    b.addEventListener('click', () => { state.scope = b.dataset.scope; writePref('tape.scope', state.scope); renderEdit(); });
  }
  $('ed-lift').addEventListener('click', () => liftCopy('lift'));
  $('ed-copy').addEventListener('click', () => liftCopy('copy'));
  $('ed-split').addEventListener('click', split);
  $('ed-x2').addEventListener('click', multiply);
  $('clip-reverse').addEventListener('click', async () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c && await edit('reverse', { clip: c.id })) {
      toast(c.reversed ? 'Playing forwards' : 'Reversed', 'ok', { action: undoAction });
    }
  });
  $('clip-share').addEventListener('click', () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c) shareClip(c);
  });
  $('clip-join').addEventListener('click', async () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c && await edit('join', { clip: c.id })) toast('Joined', 'ok', { action: undoAction });
  });
  $('clip-clear').addEventListener('click', async () => {
    try { await api('/api/clipboard', { method: 'DELETE' }); } catch (e) { toast(e.message, 'bad'); }
    $('clip-audio').pause();
    fetchClipboard();
  });
  $('clip-tile').addEventListener('click', () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c) patch({ clip: { id: c.id, tile: true } }).then((ok) => ok && toast('Repeated to the loop’s end', 'ok', { action: { label: 'Undo', run: () => undoRedo(false) } }));
  });
  $('track-name').addEventListener('change', () => patch({ track: { n: state.sheetTrack, name: $('track-name').value } }));
  $('track-gain').addEventListener('input', () => { $('track-gain-val').textContent = `${$('track-gain').value} dB`; });
  $('track-gain').addEventListener('change', () => patch({ track: { n: state.sheetTrack, gain_db: Number($('track-gain').value) } }));
  $('track-pan').addEventListener('input', () => { $('track-pan-val').textContent = panText(Number($('track-pan').value)); });
  $('track-pan').addEventListener('change', () => patch({ track: { n: state.sheetTrack, pan: Number($('track-pan').value) } }));
  $('track-done').addEventListener('click', () => $('track-sheet').close());
  wireRuler();
  $('loop').addEventListener('click', () => patch({ loop: { on: !state.tape.loop.on } }));
  $('tape-undo').addEventListener('click', () => undoRedo(false));
  $('tape-redo').addEventListener('click', () => undoRedo(true));
  $('catch-pass').addEventListener('click', () => doCatch({ pass: 1 }));
  for (const b of $('catch-bars').querySelectorAll('button')) b.addEventListener('click', () => doCatch({ bars: Number(b.dataset.bars) }));
  $('tape-name').addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
  $('tape-more').addEventListener('click', (e) => { e.stopPropagation(); openActions(); });
  document.addEventListener('click', (e) => {
    if (!MENUS.some(([m]) => $(m).contains(e.target))) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
    // Typing is typing; a level slider with focus still lets the keys work.
    const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
      || (e.target.tagName === 'INPUT' && e.target.type !== 'range'));
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      if (typing || document.querySelector('dialog[open]')) return; // the field's own undo, or a sheet's
      e.preventDefault();
      undoRedo(e.shiftKey);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return; // a sheet's keys are its own
    if (e.key === ' ' && !e.target.closest?.('button, a, [tabindex], input:not([type=range])')) { e.preventDefault(); $('play').click(); }
    // With a keyboard -- a laptop, or a tablet with one: the transport, and
    // which track catches go onto. Not under a dialog or a menu, and not on
    // a held key's repeats, which would toggle Rec or the loop over and over.
    // By physical key, so they work on any keyboard layout.
    if (!state.tape || menusOpen()) return;
    const press = (id) => { if (!e.repeat && !$(id).disabled) $(id).click(); };
    const pick = (n) => {
      if (n < 1 || n > state.tape.tracks.length || n === state.track) return false;
      state.track = n;
      render();
      return true;
    };
    switch (e.code) {
      case 'KeyR': press('rec'); break;
      case 'KeyL': press('loop'); break;
      case 'KeyK': press('click'); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': pick(Number(e.code.slice(5))); break;
      // Only when it changes the track: otherwise the arrows scroll.
      case 'ArrowUp': if (pick(state.track - 1)) e.preventDefault(); break;
      case 'ArrowDown': if (pick(state.track + 1)) e.preventDefault(); break;
      default:
    }
  });
  $('tape-new').addEventListener('click', () => { closeMenus(); newTape(); });
  $('tape-mixdown').addEventListener('click', () => { closeMenus(); mixdown(false); });
  $('tape-mixdown-all').addEventListener('click', () => { closeMenus(); mixdown(true); });
  $('tape-export').addEventListener('click', exportStems);
  $('tape-rename').addEventListener('click', () => { closeMenus(); openRename(); });
  $('rename-cancel').addEventListener('click', () => $('rename-sheet').close());
  $('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('rename-name').value.trim();
    if (!name) { $('rename-name').focus(); return; }
    $('rename-sheet').close();
    if (name !== state.tape.name) await patch({ name });
  });
  $('tape-clone').addEventListener('click', async () => {
    closeMenus();
    try {
      const t = await api(`/api/tapes/clone?${q()}`, { method: 'POST' });
      toast(`Cloned as “${t.name}”`, 'ok', { action: { label: 'Open it', run: () => loadTape(t.id) } });
    } catch (e) { toast(e.message, 'bad'); }
  });
  $('tape-delete').addEventListener('click', async () => {
    closeMenus();
    let list = { tapes: [] };
    try { list = await api('/api/tapes'); } catch { /* none */ }
    const others = list.tapes.filter((t) => t.id !== state.id);
    if (!others.length) { toast('The loaded tape can\'t be deleted; there\'s no other one', 'warn'); return; }
    const name = window.prompt(`Delete which tape? Type its name:\n${others.map((t) => t.name).join('\n')}`);
    const t = others.find((x) => x.name === (name || '').trim());
    if (!t) return;
    try { await api(`/api/tapes?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }); toast(`Deleted “${t.name}”`); } catch (e) { toast(e.message, 'bad'); }
  });
  $('new-bpm').addEventListener('input', () => { $('new-bpm').dataset.touched = '1'; });
  $('set-tempo').addEventListener('click', () => patch({ tempo: { bpm: Number($('new-bpm').value), bars: Number($('new-bars').value) } }));
  // The clip sheet.
  $('clip-gain').addEventListener('input', () => { $('clip-gain-val').textContent = `${$('clip-gain').value} dB`; });
  $('clip-gain').addEventListener('change', () => state.clip && patch({ clip: { id: state.clip.id, gain_db: Number($('clip-gain').value) } }));
  const nudge = (d) => {
    if (!state.clip) return;
    const v = Math.round(((state.clip.nudge_ms || 0) + d) * 10) / 10;
    state.clip = { ...state.clip, nudge_ms: v };
    $('clip-nudge-val').textContent = `${v} ms`;
    patch({ clip: { id: state.clip.id, nudge_ms: v } });
  };
  $('nudge-back').addEventListener('click', () => nudge(-5));
  $('nudge-fwd').addEventListener('click', () => nudge(5));
  $('clip-remove').addEventListener('click', () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c) patch({ clip: { id: c.id, remove: true } }).then((ok) => ok && toast('Clip removed', 'ok', { action: { label: 'Undo', run: () => undoRedo(false) } }));
  });
  $('clip-done').addEventListener('click', () => $('clip-sheet').close());
  $('clip-sheet').addEventListener('close', () => { state.clip = null; drawLanes(); });
  new ResizeObserver(() => { drawLanes(); drawOverview(); drawRuler(); }).observe($('lanes'));
  wireView($('lanes'), () => (lanes[0] ? lanes[0].canvas : $('lanes')).getBoundingClientRect());
  wireView($('tape-ruler'), () => $('tape-ruler').getBoundingClientRect());
  $('view-fit').addEventListener('click', () => { state.zoom = null; state.touchedView = performance.now(); redrawView(); });
}

boot();
