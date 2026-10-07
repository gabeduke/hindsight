// web/static/lib/tape/page.js
// The tape page: the loaded tape's four tracks, its transport, and catching
// from the ring. The Pi does the work (internal/tape); this page polls its
// state a few times a second and sends what you tap.

import { toast } from '../toast.js';
import { canShareFiles, shareOrDownload } from '../wave/share.js';
import { initHelp } from '../help/help.js';
import { drawBars, takeGain, levelsOfColumns, laneChannels } from '../wave/draw.js';
import { drawTrace, traceLines } from '../wave/tape-strip.js';
import { TileCache } from '../wave/tiles.js';
import { MIN_FPP } from '../edit/gestures.js';
import { EditorBar } from '../edit/editor-bar.js';
import { NearAudio } from '../wave/near.js';
import { stepFrames, stepLabel } from '../wave/boundary.js';
import { clipLabel, blockLevels, labelFits, placeLabel, needsDetail } from './blocks.js';
import {
  fileView, soundingAt, toTape, gridMove, alignLand, alignEdge, alignView, clipNumber, alignReadout,
  padStart, hitIn, placeAt, refClipsNear, refHitNear, REACH_MS,
} from './align.js';
import { roundRectPath } from '../cassette-geom.js';
import {
  editView as viewRange, barSpan, nearestBar, xOf, frameAt, barLines, bpm as bpmOf, barBeat, fmtSecs,
  SNAPS, slideTo, nudgeFrames, splitAt, joinPartner, fitsDoubled, zoomView, panView, followView, levelAt,
  trimBounds, trimTo, trimmed, repeatRoom, repeatCount, groupMove, fadeOptions, fadeOption, clipFades,
} from './geometry.js';
import { meterFill, quietNote, levelText, isSilent, QUIET } from './levels.js';
import { punchStart, traceAdd, recRegion, wrappedSince, fullPasses } from './rec.js';
import { initAway } from './away-sheet.js';
import { initOutput } from './output-ui.js';
import { Pending } from './pending.js';
import { hitClip, ClipGesture, MIN_GRIPS_PX, HANDLE_PX, SLOP_PX, EDGE_PX, targetTrack } from './clipgestures.js';
import { SECTION_NAMES, SECTION_COLORS, colorOf, sectionHit, newName, isLooped, barsText as sectionBars, makeSpan, edgeTo } from './sections.js';
import { insertPreview, deletePreview, insertRefusal, spanWords, barOf as barNumber } from './timeedit.js';
import { overviewWindow, onWindow, dragTo, tapAt, isDoubleTap, paintTapeOverview, trackColor } from './overview.js';
import { token, withAlpha, onSchemeChange } from '../theme.js';
import { ReelWindow } from '../bar/reel-window.js';
import { tapeCounter, tapeMarquee } from '../bar/lcd.js';
import { initPlayer } from '../bar/player.js';
import { initNav } from '../nav.js';
import { timedFetch, watchLink } from '../link.js';
import { pollGate } from './poll-gate.js';

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
  picked: null,     // the id of the clip last tapped: its grips show, to trim it
  clipboard: null,  // what /api/clipboard says
  sel: null,        // a ruler drag in progress: {from, to} tape frames
  scope: readPref('tape.scope', 'one'), // lift and copy: the selected track, or all
  snap: readPref('tape.snap', 'bar'),   // what a slid clip snaps to
  slide: null,      // a clip being slid: {n, clip, at, to}: from track n to track to
  trim: null,       // a grip being dragged: {n, clip, edge, edge0, at, bounds, limited}
  repeat: null,     // the ⟳ corner being dragged: {n, clip, count, max}
  multi: null,      // several clips picked: a Set of their ids, or null
  // What Drop, Insert or Delete time would do, shown on the lanes before it's
  // done: {kind, tape?, from, to, track?, tracks?, label, armed?}. tape is the
  // tape as it would be (lib/tape/timeedit.js).
  preview: null,
  zoom: null,       // the lanes' view once pinched, panned or paged: {from, to}; null shows the loop
  touchedView: 0,   // when a pinch or pan last moved the view: following waits a moment after
  noClickUntil: 0,  // a lane's click before this ends a pan, not a tap
  pinch: false,     // two fingers are on the lanes or the ruler
  rec: null,        // a punch being recorded: {key, track, start, trace, wrapped}
  // The bar's open drawer: 'rec' (Record · Catch), 'edit' (Clipboard · Edit) or ''.
  drawer: ['rec', 'edit', 'crate'].includes(readPref('tape.drawer', '')) ? readPref('tape.drawer', '') : '',
};
const peaks = new Map(); // pool file -> PeakData, or a pending promise
// A pool file's gain for its bars (lib/wave/draw.js takeGain): one per file,
// so every clip of it -- a repeat, a split's halves -- is drawn alike.
const gains = new Map();
function gainOf(file, pd) {
  if (!gains.has(file)) gains.set(file, takeGain(pd));
  return gains.get(file);
}

// Range peaks per pool file, for the stretch of a clip on screen at deep zoom
// (/api/tapes/peaks), cached as tiles the way the take page's are.
const tiles = new Map(); // pool file -> TileCache
function tilesOf(file, pd) {
  let tc = tiles.get(file);
  if (!tc) {
    tc = new TileCache({
      file, totalFrames: Math.round(pd.duration * pd.sample_rate), filePeaks: pd,
      urlFor: (f, t, b) => `/api/tapes/peaks?file=${encodeURIComponent(file)}&from=${f}&to=${t}&buckets=${b}`,
      onChange: redrawLanes,
    });
    tiles.set(file, tc);
  }
  return tc;
}

// dropTiles lets go of the tiles of files no longer on the tape.
function dropTiles(t) {
  const on = new Set(t.tracks.flatMap((tr) => tr.clips.map((c) => c.file)));
  for (const [f, tc] of tiles) if (!on.has(f)) { tc.stop(); tiles.delete(f); }
}

// redrawLanes redraws the lanes once a frame however many tiles arrive.
let lanesRaf = 0;
function redrawLanes() {
  if (lanesRaf) return;
  lanesRaf = requestAnimationFrame(() => { lanesRaf = 0; drawLanes(); });
}

function readPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } }

// keepalive lets a save outlive the page (a move committed at pagehide).
// A read gives up after `timeout` ms (a tablet that slept leaves requests
// that are never answered); a change is left to take as long as it takes.
async function api(path, { method = 'GET', body, keepalive = false, timeout } = {}) {
  const init = {
    method, cache: 'no-store', keepalive,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const pending = method === 'GET' ? timedFetch(path, init, timeout) : fetch(path, init);
  const res = await pending;
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
    // Its own copy of the tape plays here: stop the stream's, or the phone
    // plays both, 0.8 s apart. The output stays on this phone. Only in This
    // phone mode: in Both the jam room is the clock and may be recording.
    onPlay: () => {
      if (output && output.streamingHere() && state.live && state.live.output_mode === 'phone') transport('stop');
    },
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
  $('np-dock').hidden = false;
  initPlayer();
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
  // Back from a sleep (or the network back): the tape as the Pi has it now,
  // at once, not at the next tick -- and a "Reconnecting…" note till it answers.
  link = watchLink(() => { poll(true); fetchClipboard(); });
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  setInterval(() => { if (!document.hidden) fetchClipboard(); }, 2000);
}

// gen counts this page's changes, bumped as each is sent and again as its
// answer arrives: a poll in flight across either may answer with the tape
// from before the change, and is dropped.
// The gate (poll-gate.js) lets one poll be in flight, except that a wake-up
// poll goes ahead of one that was lost, and drops the lost one's answer.
const gate = pollGate();
let gen = 0;
// The page's link to the Pi (lib/link.js); a stand-in until boot makes it.
let link = { ok() {}, fail() {} };
const POLL_TIMEOUT_MS = 4000;
async function poll(force = false) {
  if (!state.id) return;
  const mine = gate.begin(force === true);
  if (!mine) return;
  const g = gen;
  try {
    // Only an empty tape with no grid can use a suggested tempo, so only
    // then is one asked for.
    const bare = state.tape && !state.tape.grid && state.tape.tracks.every((tr) => tr.clips.length === 0);
    const s = await api(`/api/tapes/state?${q()}${bare ? '&suggest=1' : ''}`, { timeout: POLL_TIMEOUT_MS });
    link.ok('tape');
    if (g !== gen || !gate.current(mine)) return;
    if (!s.loaded) { await follow(); return; }
    apply(s);
  } catch (e) {
    // An answer of any kind (a 404) was the Pi; none at all is the link.
    if (e.status === undefined) link.fail('tape');
    else link.ok('tape');
    if (e.status === 404 && g === gen && gate.current(mine)) await follow();
  } finally {
    gate.end(mine);
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
    // The punch and record code keeps the engine's position: what lands on tape.
    state.live.heardEngine = state.live.heard;
    if (h) state.live.heard = h.pos;
  }
  state.sources = s.sources || [];
  state.undo = s.undo || 0;
  state.redo = s.redo || 0;
  if (state.track > state.tape.tracks.length) state.track = 1;
  if (state.preview) refreshPreview();
  if (changed) { buildLanes(); loadPeaks(); dropTiles(state.tape); }
  syncAlign();
  followPlayhead();
  tracePunch();
  render();
  feedReels();
}

// feedReels hands the bar's reel window what this poll said: where the tape
// is, whether it plays, and how to read each track's level at a frame for
// the LCD's level bars.
let reels = null;
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
function feedReels() {
  const t = state.tape, live = state.live;
  if (!t) return;
  reels ??= new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
  const tracks = heardTracks();
  const anySolo = tracks.some((tr) => tr.solo);
  const peaksOf = (f) => peaks.get(f);
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  reels.setLevels(tracks.map((tr) => trackColor(tr.n, col)),
    (frame) => tracks.map((tr) => levelAt(tr, frame, peaksOf, t.sample_rate, anySolo)));
  reels.poll({
    heard: live ? live.heard : 0,
    playing: !!(live && live.playing && !(live.count_in > 0)),
    length: t.length,
    sampleRate: t.sample_rate,
  });
}

// laneView is the span of tape the lanes and the ruler show: where a pinch,
// a pan or the playhead took it, else the loop and a bar either side.
function laneView() {
  const v = state.zoom || viewRange(state.tape);
  // A previewed edit whose point is off the view brings the view to it while
  // it shows: an Insert after the last one, at the playhead it left.
  const pv = state.preview;
  if (!pv || (pv.from >= v.from && pv.from <= v.to)) return v;
  const w = v.to - v.from;
  const from = Math.max(0, pv.from - Math.round(w / 4));
  return { ...v, from, to: from + w };
}

// followPlayhead pages the view after a playhead that has run out of it --
// past the loop's Out with the loop off, say -- unless a finger moved the
// view a moment ago.
function followPlayhead() {
  const live = state.live;
  // Not while a clip is being aligned: the view is the hit's then.
  if (!live || !live.playing || live.count_in > 0 || state.pinch || state.slide || gripHeld() || state.sel || state.align) return;
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
    const obs = { counting, pos: live.pos, heard: live.heardEngine ?? live.heard, delivered: live.delivered, from: r.from };
    state.rec.start = punchStart(t.grid, t.loop, obs);
    // A page opened mid-punch: the loop may have come round already.
    state.rec.wrapped = !counting && wrappedSince(t.loop, obs);
  }
  if (live.playing && !counting) {
    const src = state.sources.find((x) => x.name === r.source);
    state.rec.trace = traceAdd(state.rec.trace, live.heardEngine ?? live.heard, src && src.peak_db);
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
  renderMulti();
  renderCrateDrops();
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
  // On this phone with its sound held back for a tap: ▶ is that tap
  // (output-ui.js), and never stops the tape.
  const waiting = !!(output && output.player.state === 'locked');
  const shown = playing && !waiting;
  $('play').textContent = shown ? '■' : '▶';
  $('play').setAttribute('aria-label', waiting ? 'Play here' : shown ? 'Stop' : 'Play');
  $('play').classList.toggle('playing', shown);
  $('play').disabled = (!live || !live.output) && !waiting;
  $('loop').setAttribute('aria-pressed', String(!!t.loop.on));
  $('loop').disabled = !(t.loop.out > t.loop.in);
  const counting = !!(live && live.count_in > 0);
  // The bar's LCD: the position (or what's happening instead), the time, the
  // lamp, and the line that names what's loaded.
  const lcd = tapeCounter(t, live, md);
  setText($('position'), lcd.big);
  setText($('np-mini'), lcd.big);
  setText($('np-time'), lcd.small);
  setText($('np-unit'), lcd.unit);
  setIf($('np-status'), 'data-state', lcd.status);
  // A message's details hold still where the marquee scrolls.
  setText($('np-marquee'), lcd.note || tapeMarquee(t, live));
  $('np-marquee').parentElement.classList.toggle('still', !!lcd.note);
  const ov = $('tape-overview');
  setIf(ov, 'aria-valuemax', String(t.length));
  setIf(ov, 'aria-valuenow', String(live ? Math.round(live.heard) : 0));
  setIf(ov, 'aria-valuetext', live ? `${t.grid ? `bar ${barBeat(live.heard, t.grid)}, ` : ''}${fmtSecs(live.heard, sr)}` : '');
  $('to-start').disabled = !live;
  setIf($('to-start'), 'aria-label', t.loop.on && t.loop.out > t.loop.in ? 'Back to the loop’s start' : 'Back to the top of the tape');
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
  setText($('catch-pass').querySelector('.np-catch-sub'), phoneOut ? 'jam room only' : 'the last pass');
  setIf($('catch-pass'), 'aria-label', phoneOut ? 'Catch: needs the jam room' : `Catch the last pass onto track ${state.track}`);
  $('jam-only-note').hidden = !phoneOut;
  // What needs the jam room goes, rows and all: the Record drawer keeps the
  // note and Overdub on this device.
  for (const row of ['sources', 'catch', 'passes']) document.querySelector(`.np-dock .tb-row.${row}`).hidden = phoneOut;
  renderMode();
  renderDrawers();
  renderClipboard();
  renderEdit();
  renderAlign();
  drawLanes();
  drawOverview();
  drawRuler();
  drawSections();
  renderFit();
  if (output) output.render(state.live);
}

// renderDrawers opens the bar's one open drawer and lights its key. From
// 700 px a drawer docks above the bar and pushes the lanes up; on a phone
// both are rows in the page (styles.css, "the dock").
function renderDrawers() {
  for (const [key, id] of [['rec', 'drawer-rec'], ['edit', 'drawer-edit'], ['crate', 'drawer-crate']]) {
    const open = state.drawer === key && !state.align;
    $(id).classList.toggle('open', open);
    setIf($(`np-${id}`), 'aria-expanded', String(open));
    $(`np-${id}`).disabled = !!state.align; // the editor has the place
  }
}

function setDrawer(key) {
  state.drawer = key;
  writePref('tape.drawer', key);
  renderDrawers();
  if (key === 'crate') fetchCrate();
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
  // Insert pushes what's on the tape along: there must be something, or a
  // tempo, for it to be pushed by.
  $('insert').disabled = !fits || !t || (!t.grid && !t.tracks.some((x) => x.clips.length));
  $('drop').title = c && t && !fits ? `${c.tracks.length} tracks don't fit from track ${state.track}: Merge puts them on it` : '';
  $('merge').hidden = !(c && c.tracks.length > 1);
  $('merge').disabled = !t;
  $('clip-clear').disabled = !c && !state.clipboardError;
  // One clip on it can be kept on the crate, by reference.
  const one = c ? c.tracks.flat() : [];
  $('clip-keep-board').hidden = !(one.length === 1 && one[0].at === 0 && one[0].frames === c.frames);
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
  $('ed-delete').disabled = !sel;
  $('ed-copy').disabled = !sel;
  $('ed-split').disabled = !live || !track(state.track) || splitAt(track(state.track), live.heardEngine ?? live.heard, t.sample_rate) === 0;
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

// What each edit is called in a toast that says it couldn't be done.
const OP_WORDS = {
  multiply: 'double the loop', 'section-add': 'make the section', 'section-set': 'change the section',
  'section-remove': 'remove the section', 'delete-time': 'delete the time', 'duplicate-section': 'duplicate the section',
  move: 'move them', duplicate: 'copy them after themselves',
};

// edit sends one edit, shows the tape it answers with, and answers what the
// edit did -- or null, having said why not.
async function edit(op, extra = {}, { keepalive = false } = {}) {
  try {
    const s = await change(() => api(`/api/tapes/edit?${q()}`, { method: 'POST', body: { op, track: state.track, ...extra }, keepalive }));
    const e = (s && s.edit) || {};
    if (e.clipboard) { cbGen++; state.clipboard = e.clipboard; state.clipboardError = ''; renderClipboard(); }
    return e;
  } catch (err) {
    toast(`Could not ${OP_WORDS[op] || op}: ${err.message}`, 'bad');
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

async function slide(clip, at, from, to) {
  const e = await edit('slide', { clip: clip.id, at, to });
  const t = state.tape;
  if (!e) return;
  if (to !== from) { state.track = to; render(); }
  const where = t.grid ? `bar ${barBeat(at, t.grid)}` : fmtSecs(at, t.sample_rate);
  toast(`Slid to ${to !== from ? `track ${to}, ` : ''}${where}`, 'ok', { action: undoAction });
}

// lanePitch is how far a slide moves to cross a lane: the lanes' tops'
// spacing, averaged over them all, so one row grown a little taller (a wrapped
// label) doesn't skew it.
function lanePitch() {
  if (lanes.length < 2) return 0;
  const top = (l) => l.canvas.getBoundingClientRect().top;
  return (top(lanes[lanes.length - 1]) - top(lanes[0])) / (lanes.length - 1);
}

// markTarget lights the lanes a slide would land on, when they're other
// tracks: the one track a clip goes to, or each a group's clips go to.
function markTarget(sl) {
  const to = new Set();
  if (sl && sl.group && sl.dtrack) for (const g of sl.group) to.add(g.track + sl.dtrack);
  else if (sl && !sl.group && sl.to !== sl.n) to.add(sl.to);
  for (const l of lanes) l.row.classList.toggle('drop-target', to.has(l.n));
}

// --- the crate ------------------------------------------------------------------
// The clips kept from takes, the ribbon and the tape (internal/tape/crate.go):
// a drawer of rows, newest first, to play here, drop at the playhead, or open
// for rename, share, the take it came from and delete. tape.html?crate=<take>
// opens it on the clips kept from that take. See
// docs/superpowers/specs/2026-10-07-crate-design.md.

const crate = {
  clips: [], sr: 48000, gen: 0, q: '',
  take: new URLSearchParams(location.search).get('crate') || '',
  open: null, // the clip whose sheet is open
};

async function fetchCrate() {
  const g = ++crate.gen;
  const qs = new URLSearchParams();
  if (crate.q) qs.set('q', crate.q);
  if (crate.take) qs.set('take', crate.take);
  try {
    const b = await api(`/api/crate?${qs}`, { timeout: POLL_TIMEOUT_MS });
    if (g !== crate.gen) return;
    crate.clips = b.clips || [];
    crate.sr = b.sample_rate || crate.sr;
    renderCrate();
  } catch (e) {
    toast(`Could not read the crate: ${e.message}`, 'bad');
  }
}

// crateMeta reads a kept clip's length (and bars, with a tempo) and where
// it came from.
function crateMeta(k) {
  const s = k.frames / crate.sr;
  const len = s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`;
  const bars = k.bpm > 0 ? Math.round(((s * k.bpm) / 240) * 10) / 10 : 0;
  return [len, bars ? `${bars} bar${bars === 1 ? '' : 's'}` : '', k.source && k.source.what].filter(Boolean).join(' · ');
}

const CRATE_EMPTY = $('crate-empty').innerHTML; // what it says with nothing kept

// renderCrate rebuilds the rows, where they were scrolled to and the focus
// kept: after a fetch, not for a play or a stop (markPlaying).
function renderCrate() {
  const list = $('crate-list');
  const scroll = list.scrollTop;
  const focused = document.activeElement && list.contains(document.activeElement)
    ? [document.activeElement.closest('.crate-row')?.dataset.id, document.activeElement.className] : null;
  list.replaceChildren();
  $('crate-from').hidden = !crate.take;
  if (crate.take) $('crate-from').textContent = `from ${crate.take.replace(/\.wav$/, '')} ×`;
  $('crate-empty').hidden = crate.clips.length > 0;
  if (crate.q || crate.take) $('crate-empty').textContent = 'No kept clip matches.';
  else $('crate-empty').innerHTML = CRATE_EMPTY;
  for (const k of crate.clips) {
    const li = document.createElement('li');
    li.className = 'crate-row';
    li.dataset.id = k.id;
    li.innerHTML = `
      <button class="crate-play" type="button" data-tip="crate-play">
        <canvas class="crate-wave" aria-hidden="true"></canvas>
        <span class="crate-text"><span class="crate-name"></span><span class="crate-meta mono"></span></span>
      </button>
      <button class="icon-btn crate-drop" type="button" data-tip="crate-drop">Drop</button>
      <button class="icon-btn crate-insert" type="button" data-tip="crate-insert">Insert</button>
      <button class="icon-btn crate-more" type="button" aria-label="More for this clip" data-tip="crate-more">⋯</button>`;
    li.querySelector('.crate-name').textContent = k.name;
    li.querySelector('.crate-meta').textContent = crateMeta(k);
    li.querySelector('.crate-play').addEventListener('click', () => auditionCrate(k));
    li.querySelector('.crate-drop').addEventListener('click', () => dropCrate(k));
    const ins = li.querySelector('.crate-insert');
    ins.addEventListener('click', (e) => { if (!confirmFirst(e, ins, 'insert', k)) insertHere(k); });
    wirePreview(ins, 'insert', () => k);
    li.querySelector('.crate-drop').disabled = !state.tape;
    li.querySelector('.crate-more').addEventListener('click', () => openCrateClip(k));
    list.appendChild(li);
  }
  // The waves once every row is in, so measuring one lays the list out once.
  for (const li of list.children) drawCrateWave(li.querySelector('.crate-wave'), crate.clips.find((k) => k.id === li.dataset.id));
  list.scrollTop = scroll;
  if (focused) list.querySelector(`.crate-row[data-id="${CSS.escape(focused[0] || '')}"] .${focused[1].split(' ').pop()}`)?.focus({ preventScroll: true });
  markPlaying();
  renderCrateDrops();
}

// markPlaying marks the row playing ■, the others ▶, in place.
function markPlaying() {
  const a = $('crate-audio');
  const playing = a.dataset.id && !a.paused ? a.dataset.id : '';
  for (const li of $('crate-list').children) {
    li.querySelector('.crate-play').setAttribute('aria-pressed', String(li.dataset.id === playing));
    li.classList.toggle('playing', li.dataset.id === playing);
  }
}

// The rows' Drop keys need a tape to drop on.
function renderCrateDrops() {
  const t = state.tape;
  for (const b of document.querySelectorAll('#crate-list .crate-drop')) b.disabled = !t;
  // As #insert: an empty tape with no tempo has nothing to push along.
  const pushes = !!t && (!!t.grid || t.tracks.some((x) => x.clips.length));
  for (const b of document.querySelectorAll('#crate-list .crate-insert')) b.disabled = !pushes;
}

// drawCrateWave draws a kept clip's bars, small, from its file's peaks.
async function drawCrateWave(cv, k) {
  let pd = peaks.get(k.file);
  if (pd === undefined) {
    pd = fetch(`/api/tapes/peaks?file=${encodeURIComponent(k.file)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    peaks.set(k.file, pd);
  }
  if (pd instanceof Promise) { pd = await pd; peaks.set(k.file, pd); }
  if (!pd || !cv.isConnected) return;
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const color = getComputedStyle(cv).color;
  drawBars(ctx, blockLevels(pd, k, r.width), { x0: 2, pitch: 4, cy: r.height / 2, half: Math.max(1, r.height / 2 - 2), gain: gainOf(k.file, pd), width: 2, color });
}

function auditionCrate(k) {
  const a = $('crate-audio');
  if (a.dataset.id === k.id && !a.paused) { a.pause(); return; }
  a.dataset.id = k.id;
  a.src = `/api/crate/audio?id=${encodeURIComponent(k.id)}`;
  // Another row tapped before this one starts aborts it: not an error.
  a.play().catch((e) => { if (e.name !== 'AbortError') toast(`Could not play it: ${e.message}`, 'bad'); });
  markPlaying();
}

async function dropCrate(k) {
  try {
    const d = await change(() => api(`/api/tapes/drop?${q()}`, { method: 'POST', body: { crate: k.id, track: state.track } }));
    caughtToast(`Dropped “${k.name}” on track ${state.track}`, d.clip, { action: undoAction });
    poll();
  } catch (e) {
    toast(`Could not drop it: ${e.message}`, 'bad');
  }
}

// keep puts a clip on the crate: a tape clip, or the clipboard, by reference.
async function keep(body) {
  try {
    const b = await api('/api/crate', { method: 'POST', body });
    toast(`Kept “${b.clip.name}” in the crate`, 'ok', { action: { label: 'Open', run: () => setDrawer('crate') } });
    fetchCrate(); // on a phone the crate is always on the page
  } catch (e) {
    toast(`Could not keep it: ${e.message}`, 'bad');
  }
}

function openCrateClip(k) {
  crate.open = k;
  $('crate-title').textContent = k.name;
  $('crate-what').textContent = crateMeta(k);
  $('crate-name').value = k.name;
  const take = k.source && k.source.kind === 'take' ? k.source.take : '';
  $('crate-take').hidden = !take;
  if (take) $('crate-take').href = `wave.html?file=${encodeURIComponent(take)}`;
  $('crate-sheet').showModal();
}

function wireCrate() {
  let t = 0;
  $('crate-q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { crate.q = $('crate-q').value.trim(); fetchCrate(); }, 200);
  });
  $('crate-from').addEventListener('click', () => {
    crate.take = '';
    const u = new URL(location.href);
    u.searchParams.delete('crate');
    history.replaceState(history.state, '', u);
    fetchCrate();
  });
  for (const ev of ['play', 'playing', 'ended', 'pause']) $('crate-audio').addEventListener(ev, markPlaying);
  // Enter both submits the form and changes the field: one rename.
  let renaming = false;
  const rename = async () => {
    const k = crate.open;
    const name = $('crate-name').value.trim();
    if (!k || !name || name === k.name || renaming) return;
    renaming = true;
    try {
      const b = await api(`/api/crate?id=${encodeURIComponent(k.id)}`, { method: 'PATCH', body: { name } });
      if (crate.open && crate.open.id === b.clip.id) crate.open = b.clip;
      $('crate-title').textContent = b.clip.name;
      fetchCrate();
    } catch (e) {
      toast(`Could not rename it: ${e.message}`, 'bad');
    } finally {
      renaming = false;
    }
  };
  $('crate-rename').addEventListener('submit', (e) => { e.preventDefault(); rename(); });
  $('crate-name').addEventListener('change', rename);
  $('crate-share').addEventListener('click', async () => {
    const k = crate.open;
    if (!k) return;
    try {
      const res = await fetch(`/api/crate/audio?id=${encodeURIComponent(k.id)}&download=1`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const name = `${k.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'clip'}.wav`;
      await shareOrDownload(await res.blob(), name, name, 'audio/wav');
    } catch (e) { toast(`Could not share it: ${e.message}`, 'bad'); }
  });
  $('crate-delete').addEventListener('click', async () => {
    const k = crate.open;
    $('crate-sheet').close();
    if (!k) return;
    try {
      await api(`/api/crate?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' });
      fetchCrate();
      toast(`Deleted “${k.name}”: it can come back for a week`, 'ok', {
        action: { label: 'Undo', run: async () => {
          try { await api(`/api/crate?id=${encodeURIComponent(k.id)}`, { method: 'PATCH', body: { restore: true } }); } catch (e) { toast(`Could not bring it back: ${e.message}`, 'bad'); }
          fetchCrate();
        } },
      });
    } catch (e) { toast(`Could not delete it: ${e.message}`, 'bad'); }
  });
  $('crate-done').addEventListener('click', () => $('crate-sheet').close());
  $('crate-sheet').addEventListener('close', () => { crate.open = null; });
  // Opened on a take's clips (from its page, or the takes list): open, but
  // not remembered as the drawer to open next time. On a phone every drawer
  // is on the page, so the crate is always read.
  if (crate.take) { state.drawer = 'crate'; renderDrawers(); }
  fetchCrate();
}

// --- Drop, Insert, Delete time: what each does, shown first ----------------------
// Drop puts the clipboard over what's there; Insert pushes everything after
// the playhead later and puts it in the gap; Delete time cuts the selection
// out and closes the gap (internal/tape/timeedit.go). Hovered or focused, a
// key shows on the lanes what it will do. On a touch screen, with no hover,
// the first tap on Insert or Delete time shows it and the second does it,
// unless Ask first is off. See docs/superpowers/specs/2026-10-07-insert-delete-time-design.md.

const hover = matchMedia('(hover: hover)');
const askFirst = () => readPref('tape.ask', 'on') !== 'off';
const playhead = () => (state.live ? (state.live.heardEngine ?? state.live.heard) : 0);

// boardOf is the clipboard, or a kept clip, as Insert lays it.
const boardOf = (k) => (k ? { frames: k.frames, tracks: [[{ ...k, at: 0, layer: 0 }]] } : state.clipboard);

// previewOf works out what a key would do at frame at (the playhead).
function previewOf(kind, k, at = playhead()) {
  const t = state.tape;
  if (!t) return null;
  if (kind === 'delete') {
    const l = t.loop;
    if (!(l.out > l.in)) return null;
    return { kind, tape: deletePreview(t, l.in, l.out), from: l.in, to: l.out, label: `−${spanWords(l.out - l.in, t.grid, t.sample_rate)}` };
  }
  const b = boardOf(k);
  if (!b || !(b.frames > 0)) return null;
  if (kind === 'drop') return { kind, from: at, to: at + b.frames, track: state.track, tracks: b.tracks.length, label: spanWords(b.frames, t.grid, t.sample_rate) };
  // Only what will happen: an Insert the Pi would refuse isn't shown (or
  // asked about), so its tap gets the Pi's reason at once.
  if (insertRefusal(t, at, b, state.track)) return null;
  return { kind, k, tape: insertPreview(t, at, b, state.track), from: at, to: at + b.frames, label: `+${spanWords(b.frames, t.grid, t.sample_rate)}`, crate: k && k.id };
}

// refreshPreview works a shown preview out again from the tape and the
// playhead as this poll has them: another device's edit, an undo, a Drop
// that moved the playhead on, or the tape playing. An armed one keeps its
// point, so the second tap inserts where the first showed.
function refreshPreview() {
  const pv = state.preview;
  if (!pv) return;
  const next = previewOf(pv.kind, pv.k, pv.armed ? pv.from : playhead());
  showPreview(next ? { ...next, armed: pv.armed } : null);
}

function showPreview(pv) {
  state.preview = pv;
  for (const b of document.querySelectorAll('.icon-btn.confirming')) if (!pv || !pv.armed || b.dataset.arm !== pv.kind) b.classList.remove('confirming');
  redrawView();
}

// wirePreview shows what key b does while it's hovered or has the focus.
function wirePreview(b, kind, k = () => null) {
  const show = () => { if (!(state.preview && state.preview.armed)) showPreview(previewOf(kind, k())); };
  const hide = () => { if (state.preview && !state.preview.armed && state.preview.kind === kind) showPreview(null); };
  b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
  b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  b.addEventListener('focus', () => { if (b.matches(':focus-visible')) show(); });
  b.addEventListener('blur', hide);
}

// confirmFirst: on a touch screen with Ask first on, a first tap on Insert or
// Delete time shows what it will do and asks for a second. True when this
// tap only showed it.
function confirmFirst(e, b, kind, k = null) {
  const touch = e.pointerType === 'touch' || !hover.matches;
  if (!touch || !askFirst()) return false;
  const pv = state.preview;
  if (pv && pv.armed && pv.kind === kind && (pv.crate || null) === (k ? k.id : null)) return false; // the second tap
  const next = previewOf(kind, k);
  if (!next) return false;
  b.dataset.arm = kind;
  showPreview({ ...next, armed: true });
  b.classList.add('confirming');
  toast(kind === 'delete' ? `Tap again to delete ${next.label.slice(1)} on every track and close the gap` : `Tap again to insert ${next.label.slice(1)} at the playhead, pushing every track later`, 'warn');
  return true;
}

async function insertHere(k = null) {
  // Where the preview showed it, so the edit is the one seen; without one,
  // the Pi's playhead.
  const pv = state.preview;
  const shown = pv && pv.kind === 'insert' && (pv.crate || null) === (k ? k.id : null);
  showPreview(null);
  const e = await edit('insert', { ...(k ? { crate: k.id } : {}), ...(shown ? { pos: pv.from } : {}) });
  if (!e) return;
  const t = state.tape;
  const at = e.at ?? 0;
  const where = t.grid ? `bar ${barNumber(at, t.grid)}` : fmtSecs(at, t.sample_rate);
  toast(`Inserted ${spanWords(e.frames, t.grid, t.sample_rate)} at ${where} · every track after it moved later`, 'ok', { action: undoAction });
}

async function deleteTime() {
  showPreview(null);
  const e = await edit('delete-time');
  if (!e) return;
  const t = state.tape;
  const at = e.at ?? 0;
  const what = t.grid ? sectionBars({ at, end: at + e.frames }, t.grid, t.sample_rate) : spanWords(e.frames, t.grid, t.sample_rate);
  toast(`Deleted ${what} · everything after moved up`, 'ok', { action: undoAction });
}

function wireTimeEdits() {
  wirePreview($('drop'), 'drop');
  wirePreview($('insert'), 'insert');
  wirePreview($('ed-delete'), 'delete');
  $('insert').addEventListener('click', (e) => { if (!confirmFirst(e, $('insert'), 'insert')) insertHere(); });
  $('ed-delete').addEventListener('click', (e) => { if (!confirmFirst(e, $('ed-delete'), 'delete')) deleteTime(); });
  // A tap anywhere else lets an armed preview go (Escape too: see the keys).
  // The lanes are drawn again at once, so the press that let it go hits the
  // clips as they are, not as the preview drew them.
  document.addEventListener('pointerdown', (e) => {
    if (state.preview && state.preview.armed && !e.target.closest?.('.confirming')) {
      showPreview(null);
      drawLanes();
    }
  }, true);
  $('ask-first').addEventListener('click', () => {
    writePref('tape.ask', askFirst() ? 'off' : 'on');
    renderAskFirst();
  });
  renderAskFirst();
}

function renderAskFirst() {
  $('ask-first').setAttribute('aria-pressed', String(askFirst()));
}

// --- several clips -------------------------------------------------------------
// Select more in a clip's sheet, or Shift with a click, picks several clips;
// then a tap adds or takes one off, the bar (#multi-bar) acts on them all,
// and dragging any of them moves them all, by the same time and tracks (one
// move edit). See docs/superpowers/specs/2026-10-07-select-clips-design.md.

// picks is the picked clips as they are on the tape now, each with its
// track; ids no longer on the tape are let go of.
function picks() {
  if (!state.multi || !state.tape) return [];
  const out = [];
  for (const tr of state.tape.tracks) for (const c of tr.clips) if (state.multi.has(c.id)) out.push({ ...c, track: tr.n });
  if (out.length !== state.multi.size) state.multi = new Set(out.map((c) => c.id));
  return out;
}

function startMulti(ids) {
  state.multi = new Set(ids);
  renderMulti();
  drawLanes();
}

function endMulti() {
  state.multi = null;
  renderMulti();
  drawLanes();
}

// toggleMulti adds a clip to the picked ones, or takes it off; the first
// Shift-click starts from the clip picked already, if any. Align stays one
// clip's.
function toggleMulti(c) {
  if (state.align) return;
  if (!state.multi) state.multi = new Set(state.picked && state.picked !== c.id ? [state.picked] : []);
  if (state.multi.has(c.id)) state.multi.delete(c.id);
  else state.multi.add(c.id);
  if (!state.multi.size) { endMulti(); return; }
  renderMulti();
  drawLanes();
}

function renderMulti() {
  const n = picks().length;
  if (state.multi && !n) state.multi = null;
  $('multi-bar').hidden = !state.multi;
  setText($('multi-count'), `${n} clip${n === 1 ? '' : 's'}`);
}

const clipsText = (n) => `${n} clip${n === 1 ? '' : 's'}`;

// The clips keys and the bar act on: the ones picked, or else the one clip.
const keyed = () => (state.multi ? [...state.multi] : state.picked ? [state.picked] : []);

async function moveClips(ids, dt, dtrack) {
  const e = await edit('move', { clips: ids, dt, dtrack });
  if (e) toast(`Moved ${clipsText(e.clips)}`, 'ok', { action: undoAction });
}

async function removeClips(ids) {
  const e = await edit('remove', { clips: ids });
  if (!e) return;
  if (state.multi) endMulti();
  if (ids.includes(state.picked)) state.picked = null;
  toast(`Removed ${clipsText(ids.length)}`, 'ok', { action: undoAction });
}

async function copyClips(ids) {
  const e = await edit('copy', { clips: ids });
  if (e) toast(`Copied ${clipsText(e.clips)}, as they lie: Drop puts them at the playhead`, 'ok');
}

async function duplicateClips(ids) {
  const e = await edit('duplicate', { clips: ids });
  if (!e) return;
  // The copies are picked now, so another ⌘D carries the run on.
  if (state.multi) { state.multi = new Set(e.ids || []); renderMulti(); } else if (e.ids && e.ids.length) state.picked = e.ids[0];
  drawLanes();
  toast(`Copied ${clipsText(e.clips)} after ${ids.length === 1 ? 'itself' : 'themselves'}`, 'ok', { action: undoAction });
}

async function reverseClips(ids) {
  const e = await edit('reverse', { clips: ids });
  if (e) toast(`Turned ${clipsText(e.clips)} round`, 'ok', { action: undoAction });
}

// moveHere moves the picked clips so the first starts at the playhead,
// keeping their spacing and tracks.
function moveHere() {
  const ps = picks();
  const live = state.live;
  if (!ps.length || !live) return;
  // The first sounds at the playhead: where it's heard, its nudge taken off.
  const first = ps.reduce((a, b) => (b.at < a.at ? b : a));
  const want = (live.heardEngine ?? live.heard) - nudgeFrames(first, state.tape.sample_rate) - first.at;
  const m = groupMove(ps, want, 0, { tracks: lanes.length, length: state.tape.length });
  if (!m.dt) { toast(want ? 'They can’t go any further that way' : 'They start at the playhead already', 'warn'); return; }
  if (m.dt !== want) toast('They go as far as the tape does', 'warn');
  moveClips(ps.map((c) => c.id), m.dt, 0);
}

// The grips a clip offers on its block (lib/tape/clipgestures.js): the
// picked clip's edges, to trim it, and its ⟳ corner, to repeat it, unless
// it's being aligned or slid, or several are picked.
const gripsOf = (c) => (c.id === state.picked && !state.align && !state.slide && !state.multi ? ['in', 'out', 'repeat'] : []);

// gripHeld: a grip or the ⟳ corner is the finger's, so the lanes leave it be.
const gripHeld = () => !!(state.trim || state.repeat);

async function repeatClip(c, count) {
  const e = await edit('repeat', { clip: c.id, count });
  if (e) toast(`Repeated it ${count === 1 ? 'once' : `${count} times`}, end to end`, 'ok', { action: undoAction });
}

// fileFramesOf is how long a clip's pool file is, from its peaks: 0 until
// they've loaded (a trim is then bounded by its neighbours alone, and the
// Pi clamps it to the file).
function fileFramesOf(c) {
  const pd = peaks.get(c.file);
  return pd && !(pd instanceof Promise) ? Math.round(pd.duration * pd.sample_rate) : 0;
}

// trimRange is how far a clip's edge can go (geometry.js trimBounds).
function trimRange(c, edge) {
  const t = state.tape;
  const tr = t.tracks.find((x) => x.clips.some((o) => o.id === c.id));
  return trimBounds(c, edge, tr, { fileFrames: fileFramesOf(c), length: t.length, sampleRate: t.sample_rate });
}

async function trimClip(c, edge, at) {
  const e = await edit('trim', { clip: c.id, edge, at });
  if (!e || !e.clip) return;
  const t = state.tape;
  const where = edge === 'in' ? e.clip.at : e.clip.at + e.clip.frames;
  toast(`Trimmed its ${edge === 'in' ? 'start' : 'end'} to ${t.grid ? `bar ${barBeat(where, t.grid)}` : fmtSecs(where, t.sample_rate)}`, 'ok', { action: undoAction });
}

// laneHit is the clip, and the part of its block, under a pointer on a lane.
function laneHit(lane, e) {
  const r = lane.canvas.getBoundingClientRect();
  return hitClip(lane.hits, e.clientX - r.left, e.clientY - r.top, gripsOf);
}

// wireLane: tap a clip for its sheet, or an empty part of the lane to move
// the playhead (a click, so the sheet opens after the tap is done with);
// hold a clip, then drag, to slide it along its track, snapping as chosen.
// Which press is which is lib/tape/clipgestures.js's; this does what it says.
function wireLane(lane) {
  const cv = lane.canvas;
  const gest = new ClipGesture();
  let timer = 0;
  const pt = (e) => ({ id: e.pointerId, x: e.clientX, y: e.clientY });
  // A held grip or ⟳ corner follows the tape frame under the finger, not
  // just its travel, so it carries on as the view scrolls under it.
  const frameUnder = (x) => { const r = cv.getBoundingClientRect(); return frameAt(x - r.left, laneView(), r.width); };
  const held = () => { const g = state.trim || state.repeat; return g && g.n === lane.n ? g : null; };
  const follow = () => {
    const g = held();
    if (!g) return;
    const df = frameUnder(g.x) - g.f0;
    if (g === state.repeat) g.count = repeatCount(df, g.clip.frames, g.max);
    // ⌥ (Alt) moves a trim freely, off the snap.
    else Object.assign(g, trimTo(g.edge0, df, g.bounds, state.tape.grid, state.snap, g.free));
    drawLanes();
  };
  // Held near either end of the lane, it scrolls the view that way a little
  // each frame, so a drag can reach past what's shown.
  let scrollRaf = 0;
  const edgeScroll = () => {
    scrollRaf = 0;
    const g = held();
    if (!g) return;
    const r = cv.getBoundingClientRect();
    const x = g.x - r.left;
    const dir = x > r.width - EDGE_PX ? 1 : x < EDGE_PX ? -1 : 0;
    if (!dir) return;
    const v = laneView();
    setView(panView(v, dir * (v.to - v.from) * 0.02, state.tape.length));
    follow();
    scrollRaf = requestAnimationFrame(edgeScroll);
  };
  const letGo = () => { cancelAnimationFrame(scrollRaf); scrollRaf = 0; };
  const run = (fx, e) => {
    if (!fx) return;
    if (fx.type === 'grip' && fx.zone === 'repeat') {
      try { cv.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
      state.repeat = { n: lane.n, clip: fx.clip, count: 0, max: repeatRoom(fx.clip, state.tape.length), x: e.clientX, f0: frameUnder(e.clientX) };
      cv.classList.add('repeating');
    } else if (fx.type === 'gripMove' && held()) {
      const g = held();
      g.x = e.clientX;
      g.free = !!e.altKey;
      follow();
      if (!scrollRaf) scrollRaf = requestAnimationFrame(edgeScroll);
    } else if (state.repeat && state.repeat.n === lane.n && (fx.type === 'gripEnd' || fx.type === 'release')) {
      const rp = state.repeat;
      state.repeat = null;
      letGo();
      cv.classList.remove('repeating');
      drawLanes();
      if (fx.commit && rp.count > 0) repeatClip(rp.clip, rp.count);
    } else if (fx.type === 'grip') {
      // A grip is the finger's from the press: the lanes don't pan it.
      try { cv.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
      const c = fx.clip;
      const edge0 = fx.zone === 'in' ? c.at : c.at + c.frames;
      const bounds = trimRange(c, fx.zone) || { lo: edge0, hi: edge0 };
      state.trim = { n: lane.n, clip: c, edge: fx.zone, edge0, at: edge0, bounds, limited: false, x: e.clientX, f0: frameUnder(e.clientX), free: false };
      cv.classList.add('trimming');
    } else if (fx.type === 'gripEnd' || (fx.type === 'release' && state.trim && state.trim.n === lane.n)) {
      const tr = state.trim;
      state.trim = null;
      letGo();
      cv.classList.remove('trimming');
      drawLanes();
      if (fx.commit && tr && tr.at !== tr.edge0) trimClip(tr.clip, tr.edge, tr.at);
    } else if (fx.type === 'slideStart' && !state.slide) {
      // (A second finger's hold on another lane, while one slide runs, slides nothing.)
      try { cv.setPointerCapture(fx.id); } catch { /* the pointer's gone */ }
      // One of several picked: they all go with it.
      const group = state.multi && state.multi.has(fx.clip.id) ? picks() : null;
      state.slide = { n: lane.n, clip: fx.clip, at: fx.clip.at, to: lane.n, group, dt: 0, dtrack: 0 };
      cv.classList.add('sliding');
      if (navigator.vibrate) navigator.vibrate(10);
      drawLanes();
    } else if (fx.type === 'slide' && state.slide && state.slide.n === lane.n) {
      const view = laneView();
      // A drag up or down with the finger wandering a little sideways keeps
      // its place, with the snap off too.
      const dx = Math.abs(fx.dx) <= SLOP_PX ? 0 : fx.dx;
      const df = (dx / cv.getBoundingClientRect().width) * (view.to - view.from);
      state.slide.at = slideTo(state.tape.grid, fx.clip.at, df, state.snap);
      // Up or down a lane once it's half a lane over: onto that track.
      state.slide.to = targetTrack(lane.n, fx.dy, lanePitch(), lanes.length);
      const sl = state.slide;
      if (sl.group) {
        // Held inside the tape and its tracks, all of them.
        const m = groupMove(sl.group, sl.at - fx.clip.at, sl.to - sl.n, { tracks: lanes.length, length: state.tape.length });
        sl.dt = m.dt;
        sl.dtrack = m.dtrack;
        sl.at = fx.clip.at + m.dt;
        sl.to = sl.n + m.dtrack;
      }
      markTarget(sl);
      drawLanes();
    } else if (fx.type === 'slideEnd' && state.slide && state.slide.n === lane.n) {
      const sl = state.slide;
      state.slide = null;
      cv.classList.remove('sliding');
      markTarget(null);
      drawLanes();
      // Only a drag commits: a held tap that wobbled a pixel moves nothing.
      if (fx.commit && sl && sl.group) {
        if (sl.dt || sl.dtrack) moveClips(sl.group.map((g) => g.id), sl.dt, sl.dtrack);
      } else if (fx.commit && sl && (sl.at !== sl.clip.at || sl.to !== sl.n)) slide(sl.clip, sl.at, sl.n, sl.to);
    }
  };
  // A gesture that ended takes its hold with it; another finger's lift doesn't.
  const end = (fx) => { if (fx) clearTimeout(timer); run(fx); };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('click', (e) => {
    if (!gest.clickIsTap()) return; // the end of a slide
    if (performance.now() < state.noClickUntil) return; // the end of a pan or pinch
    laneTap(lane, e);
  });
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || e.button > 0) return;
    const fx = gest.down(pt(e), laneHit(lane, e));
    if (fx && fx.type === 'press') {
      // Not while two fingers pinch, or another finger holds a grip.
      timer = setTimeout(() => { if (!state.pinch && !gripHeld()) run(gest.hold()); }, fx.hold);
    } else run(fx, e);
  });
  cv.addEventListener('pointermove', (e) => {
    // A mouse over a grip shows it can be dragged sideways.
    if (e.pointerType === 'mouse' && !e.buttons) {
      const h = laneHit(lane, e);
      cv.classList.toggle('on-grip', !!h && (h.zone === 'in' || h.zone === 'out' || h.zone === 'repeat'));
    }
    const fx = gest.move(pt(e));
    if (fx && fx.type === 'swipe') clearTimeout(timer); // the browser's, and the lanes' pan
    else run(fx, e);
  });
  // While a slide is held, or a grip pressed, a finger's drag is the clip's,
  // not a scroll.
  cv.addEventListener('touchmove', (e) => { if (gest.held || gripHeld()) e.preventDefault(); }, { passive: false });
  // On the window, so a press let go off the lane (a mouse dragged out of it
  // before the hold) ends there too, and its hold doesn't start a slide.
  window.addEventListener('pointerup', (e) => end(gest.up(pt(e))));
  window.addEventListener('pointercancel', (e) => end(gest.cancel(pt(e))));
  cv.addEventListener('lostpointercapture', (e) => end(gest.lost(pt(e))));
}

// --- the clip editor --------------------------------------------------------------
// Align: the take page's editor bar on one clip, its point the clip's first
// hit. The pads, the steps, their keys and the wheel move the whole clip;
// each gesture is one slide edit, so one undo step. Hit → Grid and Hit →
// Track move it so the hit lands on a line, or on another track's hit. See
// docs/superpowers/specs/2026-10-05-tape-align-design.md. The bar's gestures
// are lib/edit/editor-bar.js's; what the point is, where it lands and how a
// move is saved are here (the bar's host, below). Everything is in sounding
// frames (at plus nudge); a move writes at and leaves the nudge alone.
//
// state.align: null, or { clipId, hitOff, found, at, ref, refHit, saving } --
// hitOff the hit's frames from where the clip sounds, found whether Align
// found a hit (else the point is the clip's start, and the snaps decline), at
// where it is drawn (ahead of the stored one while a gesture runs or a save
// is on its way), ref the track picked to line up against, refHit the hit
// Hit → Track found there ({ track, clipId, k }, k in that clip's file),
// saving the slides sent and not yet answered.

// The audio round a point, per pool file: the clip's own, and the tracks it
// is lined up against.
const nears = new Map(); // pool file -> NearAudio
async function nearOf(file) {
  let n = nears.get(file);
  if (n) return n;
  let pd = peaks.get(file);
  if (pd instanceof Promise) { await pd; pd = peaks.get(file); }
  if (!pd) throw new Error('its peaks didn’t load');
  n = nears.get(file); // another call may have made it meanwhile
  if (n) return n;
  n = new NearAudio({
    file, sampleRate: pd.sample_rate, total: Math.round(pd.duration * pd.sample_rate),
    urlFor: (f, t) => `/api/tapes/slice?file=${encodeURIComponent(file)}&from=${f}&to=${t}`,
  });
  nears.set(file, n);
  if (nears.size > 8) nears.delete(nears.keys().next().value); // a few are plenty
  return n;
}

// audioAbout is a pool file's audio round file frames [a, b], with the room
// Attack wants: about 105 ms before a and 65 ms after b. NearAudio reuses a
// stretch while the point is in its middle half, which may leave less; then
// it fetches one centred on the search instead. Before the file's start
// padStart makes the room.
async function audioAbout(file, a, b) {
  const n = await nearOf(file);
  const ms = (m) => Math.round((n.sr * m) / 1000);
  const lo = Math.max(0, a - ms(110)), hi = Math.min(n.total, b + ms(70));
  const k = n.kept;
  if (k && (k.from > lo || k.from + k.x.length < hi)) n.kept = null;
  return n.around(Math.round((a + b) / 2));
}

// alignHome is the clip being aligned as the tape has it, and its track's
// number, or null.
function alignHome() {
  return state.align ? clipHome(state.align.clipId) : null;
}

// clipHome is a clip of the loaded tape and its track, by id, or null.
function clipHome(id) {
  if (!state.tape) return null;
  for (const tr of state.tape.tracks) {
    const clip = tr.clips.find((c) => c.id === id);
    if (clip) return { n: tr.n, track: tr, clip };
  }
  return null;
}
// alignPoint is the point: where the clip's first hit sounds, at the
// previewed at.
function alignPoint() {
  const h = alignHome();
  return h ? soundingAt({ ...h.clip, at: state.align.at }, state.tape.sample_rate) + state.align.hitOff : null;
}
const alignFpp = () => { const v = laneView(); return (v.to - v.from) / (laneWidth() || 1); };

// alignFollow centres the lanes on the point at fpp (as they are, by
// default), as a pinch sets the view, within the zoom's limits.
function alignFollow(fpp = alignFpp()) {
  const f = alignPoint();
  const w = laneWidth();
  if (f == null || !w) return;
  setView(alignView(f, fpp, w, state.tape.length));
}

// Slides go one after another, in the order they were made, so the last one
// lands last; an undo waits for them (undoRedo).
let alignSaves = Promise.resolve();
function saveAlign(clipId, at) {
  const a = state.align;
  const tape = state.id;
  // Where this move was made from: the last slide sent, or the stored clip.
  const was = a.saving ? a.sent : alignHome().clip.at;
  a.saving++;
  a.sent = at;
  alignSaves = alignSaves.then(async () => {
    try {
      // Not onto another tape loaded meanwhile: edit sends to the one loaded.
      // An undo that went first moved the clip, so the move goes from where
      // the undo put it, not back over it; a clip it took away isn't moved.
      // By id, not through state.align: a move saved as the editor closes
      // (or opens on another clip) still goes.
      const h = state.id === tape && clipHome(clipId);
      if (h) {
        const to = h.clip.at === was ? at : placeAt(h.clip, at - was, state.tape.length);
        await edit('slide', { clip: clipId, at: to }, { keepalive: true });
      }
    } finally {
      if (state.align === a) {
        a.saving--;
        // Answered (or refused, having said why): from here the stored clip
        // is where it is drawn.
        if (syncAlign()) { renderAlign(); redrawView(); }
      }
    }
  }).catch((e) => console.error(e)); // the next slide still goes
}

// syncAlign follows the tape as it arrives: the clip moved by a save landing,
// another device or an undo is drawn where it now is -- unless a gesture or a
// save is under way -- and a clip that's gone closes the editor. True when it
// changed anything.
function syncAlign() {
  const a = state.align;
  if (!a) return false;
  const h = alignHome();
  if (!h) { state.align = null; bar.dirty = false; return true; }
  if (a.ref != null && (a.ref === h.n || !track(a.ref))) { a.ref = null; a.refHit = null; }
  if (bar.dirty || a.saving || a.at === h.clip.at) return false;
  a.at = h.clip.at;
  alignFollow();
  return true;
}

let alignTicket = 0; // the latest Align: one whose audio comes late is dropped
// openAlign opens the editor on a clip from its sheet. The sheet stays open,
// Align waiting, while the audio round the clip's start comes; letting the
// sheet go meanwhile lets Align go too.
async function openAlign(c) {
  const t = state.tape;
  const sr = t.sample_rate;
  const ticket = ++alignTicket;
  const btn = $('clip-align');
  btn.classList.add('waiting');
  btn.setAttribute('aria-busy', 'true');
  // The first hit: the strongest starting within 60 ms of the clip's start;
  // else its start, and the snaps decline. The pool file keeps only a little
  // before the clip, so the audio is padded for Attack to see back far
  // enough (padStart).
  let hitOff = 0, found = false;
  try {
    const end = c.src + Math.round((sr * REACH_MS) / 1000);
    const audio = padStart(await audioAbout(c.file, c.src, end), c.src, sr);
    const j = hitIn(audio, c.src, end, sr);
    found = j >= 0;
    hitOff = found ? Math.min(c.frames - 1, Math.max(0, j - c.src)) : 0;
  } catch (e) {
    toast(`Could not read the clip’s audio: ${e.message}`, 'bad');
  } finally {
    if (ticket === alignTicket) { btn.classList.remove('waiting'); btn.removeAttribute('aria-busy'); }
  }
  // Another Align, the sheet let go of, or another tape.
  if (ticket !== alignTicket || !state.tape || state.tape.id !== t.id) return;
  const sh = $('clip-sheet');
  if (!sh.open || !state.clip || state.clip.id !== c.id) return;
  sh.close();
  bar.commit(); // another clip mid-gesture saves first
  state.align = { clipId: c.id, hitOff, found, at: c.at, ref: null, refHit: null, saving: 0, sent: c.at };
  bar.dirty = false;
  const h = alignHome();
  if (!h) { state.align = null; return; }
  state.align.at = h.clip.at;
  alignFollow();
  renderAlign();
  const el = $('clip-editor');
  el.scrollIntoView?.({ block: 'nearest' });
  // The editor docks over the bar and the tracks give it the height: on a
  // short screen the clip's track may have gone below them.
  const lane = lanes.find((l) => l.n === h.n);
  if (lane) lane.row.scrollIntoView?.({ block: 'nearest' });
  $('ce-pos').focus({ preventScroll: true });
}

function closeAlign() {
  if (!state.align) return;
  bar.commit();
  const inside = $('clip-editor').contains(document.activeElement);
  state.align = null;
  bar.dirty = false;
  renderAlign();
  drawLanes();
  // The editor's keys are gone; keyboard focus goes back to the transport.
  if (inside) $('play').focus({ preventScroll: true });
}

function renderAlign() {
  const a = state.align;
  const el = $('clip-editor');
  el.hidden = !a;
  el.parentElement.classList.toggle('editing', !!a);
  renderDrawers(); // the drawers wait under the editor, their keys unlit
  if (!a) return;
  const t = state.tape;
  const sr = t.sample_rate;
  const h = alignHome();
  if (!h) return;
  const point = alignPoint();
  // The reference hit, where its clip is now.
  let ref = null;
  const rh = a.refHit;
  const rc = rh && rh.track === a.ref && track(rh.track) ? track(rh.track).clips.find((c) => c.id === rh.clipId) : null;
  if (rc) ref = { track: rh.track, hit: toTape(rc, rh.k, sr) };
  $('ce-readout').textContent = alignReadout({
    track: h.n, n: clipNumber(h.track, h.clip), point, sampleRate: sr, grid: t.grid, ref, start: !a.found,
  });
  bar.renderStep();
  $('ce-pos').setAttribute('aria-valuetext', $('ce-readout').textContent);
  $('ce-zoom').setAttribute('aria-valuetext', `${stepLabel(stepFrames(alignFpp(), sr), sr)} a step`);
  $('ce-grid').hidden = !t.grid;
  // The picker: every other track, in its colour, by its number.
  const box = $('ce-ref');
  const others = t.tracks.filter((tr) => tr.n !== h.n).map((tr) => tr.n);
  if (box.dataset.tracks !== others.join(' ')) {
    box.dataset.tracks = others.join(' ');
    box.replaceChildren(...others.map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn ce-ref-key';
      b.dataset.track = String(n);
      b.dataset.tip = 'ce-ref';
      b.setAttribute('aria-label', `Track ${n}`);
      b.style.setProperty('--tc', `var(--t${((n - 1) % 4) + 1})`);
      const num = document.createElement('span');
      num.textContent = String(n);
      b.appendChild(num);
      b.addEventListener('click', () => pickRef(n));
      return b;
    }));
  }
  box.hidden = !others.length;
  for (const b of box.children) b.setAttribute('aria-pressed', String(Number(b.dataset.track) === a.ref));
  $('ce-track').hidden = a.ref == null;
  const live = state.live;
  const playing = !!(live && (live.playing || live.count_in > 0));
  $('ce-play').textContent = playing ? '❚❚' : '▶';
  $('ce-play').setAttribute('aria-label', playing ? 'Pause' : 'Play from a second before the hit');
  $('ce-play').disabled = !live || !live.output;
}

// pickRef picks the track to line up against; the picked one again unpicks it.
function pickRef(n) {
  const a = state.align;
  if (!a) return;
  a.ref = a.ref === n ? null : n;
  a.refHit = null;
  renderAlign();
}

// snapTo moves the hit onto tape frame f for Hit → Grid and Hit → Track,
// saying so when the tape's start or end stops it short.
function snapTo(f) {
  const h = alignHome();
  const a = state.align;
  const edge = alignEdge(h.clip, a.at, a.hitOff, f, state.tape.length, state.tape.sample_rate);
  bar.move(f, true);
  if (edge) toast(edge === 'start' ? 'The tape starts here' : 'The tape ends here');
}

// Without a hit of its own the point is only the clip's start: nothing to
// snap (the snaps decline rather than guess).
function noHit() {
  if (state.align.found) return false;
  toast('No hit near the clip’s start');
  return true;
}

// Hit → Grid: the hit onto the nearest line of the Snap setting (the beat
// with it off).
function hitToGrid() {
  const p = alignPoint();
  if (p == null || !state.tape.grid || noHit()) return;
  snapTo(p + gridMove(p, state.tape.grid, state.snap));
}

// Hit → Track: the hit onto the nearest hit of the picked track within 60 ms
// of the point, whatever the zoom, found with Attack in the audio of each
// clip heard there -- so a hit at the very start of a clip counts when the
// point is a little early.
let seeking = false;
async function hitToTrack() {
  const a = state.align;
  const p = alignPoint();
  if (!a || a.ref == null || p == null || seeking || noHit()) return;
  const t = state.tape;
  const sr = t.sample_rate;
  const r = a.ref;
  const spans = refClipsNear(track(r), p, Math.round((sr * REACH_MS) / 1000), sr);
  if (!spans.length) { toast(`Track ${r} has nothing here`); return; }
  const btn = $('ce-track');
  seeking = true;
  btn.classList.add('waiting');
  btn.setAttribute('aria-busy', 'true');
  try {
    const hit = await refHitNear(spans, p, sr, (c, lo, hi) => audioAbout(c.file, lo, hi));
    // The clip moved, or the editor closed, while the audio came.
    if (state.align !== a || a.ref !== r || alignPoint() !== p) return;
    if (!hit) { toast(`No hit near here on track ${r}`); return; }
    a.refHit = { track: r, clipId: hit.clip.id, k: hit.k };
    snapTo(hit.at);
  } catch (e) {
    toast(`Could not read the audio: ${e.message}`, 'bad');
  } finally {
    seeking = false;
    btn.classList.remove('waiting');
    btn.removeAttribute('aria-busy');
  }
}

// ▶ hears it: the tape from a second before the hit; while playing, it stops.
async function alignPlay() {
  const live = state.live;
  if (live && (live.playing || live.count_in > 0)) { transport('stop'); return; }
  const p = alignPoint();
  if (p == null) return;
  bar.commit();
  if (await transport('locate', { pos: Math.max(0, p - state.tape.sample_rate) })) transport('play');
}

// The editor bar, one for the page: its listeners live as long as it does.
const bar = new EditorBar({
  els: { zoom: $('ce-zoom'), pos: $('ce-pos'), back: $('ce-back'), fwd: $('ce-fwd'), step: $('ce-step') },
  host: {
    active: () => !!state.align,
    frame: alignPoint,
    land: (f) => {
      const h = alignHome();
      return alignLand(h.clip, state.align.at, state.align.hitOff, f, state.tape.length, state.tape.sample_rate).point;
    },
    place: (f, save) => {
      const h = alignHome();
      const a = state.align;
      a.at = alignLand(h.clip, a.at, a.hitOff, f, state.tape.length, state.tape.sample_rate).at;
      // Against the last slide sent while any are on their way, so a move
      // back to the stored at is still sent.
      if (save && a.at !== (a.saving ? a.sent : h.clip.at)) saveAlign(h.clip.id, a.at);
      alignFollow();
    },
    fpp: alignFpp,
    width: () => laneWidth(),
    follow: alignFollow,
    get sampleRate() { return state.tape ? state.tape.sample_rate : 48000; },
    render: () => { renderAlign(); redrawView(); },
    readout: renderAlign,
  },
});

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
  // A previewed edit's length on the ruler: +4 bars, −4 bars.
  const pv = state.preview;
  if (pv) {
    const c = pv.kind === 'delete' ? token('--rec', '#dc322f') : warn;
    if (pv.kind === 'delete') { ctx.fillStyle = c; ctx.fillRect(Math.round(xOf(pv.from, view, W)) - 1, 0, 2, H); } // the seam
    else span(pv.from, pv.to, withAlpha(c, 0.3));
    ctx.font = `600 11px ${token('--mono', 'ui-monospace, monospace')}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(pv.label, Math.max(2, Math.min(W - 70, xOf(pv.from, view, W) + 16)), H * 0.5); // past the bar's number
  }
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

// --- sections -------------------------------------------------------------------
// Named spans over the ruler (internal/tape/sections.go): hold and drag on the
// strip to make one, tap one to select its bars (the loop's In and Out, so
// Lift, Copy and ×2 act on it), tap it again for its sheet, drag an edge to
// resize it. On bar lines, with a tempo. See
// docs/superpowers/specs/2026-10-07-sections-design.md.

// a drag on the strip; the section whose sheet is open; the one the keys are on
const sec = { drag: null, open: null, focus: -1 };
const sectionsOf = () => (state.tape && shownTape().sections) || [];

function drawSections() {
  const t = state.tape;
  if (!t) return;
  const cv = $('tape-sections');
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
  const ink = token('--well-ink', '#f2e6c8');
  ctx.font = `600 10px ${token('--mono', 'ui-monospace, monospace')}`;
  ctx.textBaseline = 'middle';
  const d = sec.drag;
  for (const stored of sectionsOf()) {
    const sc = d && d.section && d.section.id === stored.id ? { ...stored, at: d.at, end: d.end } : stored;
    const x0 = xOf(sc.at, view, W), x1 = xOf(sc.end, view, W);
    if (x1 < 0 || x0 > W) continue;
    const c = token(colorOf(sc).token, colorOf(sc).fallback);
    const looped = isLooped(sc, t.loop);
    ctx.fillStyle = withAlpha(c, looped ? 0.5 : 0.28);
    ctx.fillRect(x0, 1, Math.max(1, x1 - x0), H - 2);
    ctx.fillStyle = c;
    ctx.fillRect(x0, 1, 2, H - 2);
    if (looped) { ctx.strokeStyle = ink; ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0) - 1, H - 3); }
    // The one the keys are on, while the strip has the focus.
    if (document.activeElement === cv && sectionsOf()[sec.focus]?.id === stored.id) {
      ctx.strokeStyle = token('--focus', '#2f6fb3'); ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 1, 1, Math.max(1, x1 - x0) - 2, H - 2);
      ctx.lineWidth = 1;
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, Math.max(0, x1 - x0 - 4), H); ctx.clip();
    ctx.fillStyle = ink;
    ctx.fillText(sc.name, Math.max(x0, 0) + 6, H / 2);
    ctx.restore();
  }
  if (d && d.kind === 'make') {
    const x0 = xOf(d.from, view, W), x1 = xOf(d.to, view, W);
    const warn = token('--warn', '#b58900');
    ctx.fillStyle = withAlpha(warn, 0.25);
    ctx.fillRect(x0, 1, Math.max(1, x1 - x0), H - 2);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = warn;
    ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0) - 1, H - 3);
    ctx.setLineDash([]);
  }
}

function wireSections() {
  const cv = $('tape-sections');
  let down = null;
  const frameOf = (e) => {
    const r = cv.getBoundingClientRect();
    return frameAt(Math.min(r.width, Math.max(0, e.clientX - r.left)), laneView(), r.width);
  };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || down || e.button > 0) return;
    const r = cv.getBoundingClientRect();
    const hit = sectionHit(sectionsOf(), e.clientX - r.left, laneView(), r.width);
    try { cv.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, f: frameOf(e), hit, moved: false };
    if (hit && hit.zone !== 'body') {
      // An edge drags at once, a bar at a time with a tempo.
      sec.drag = { kind: hit.zone, section: hit.section, at: hit.section.at, end: hit.section.end };
    } else if (!hit) {
      // Hold, then drag: a new section over the bars dragged across.
      down.timer = setTimeout(() => {
        if (!down || down.moved || state.pinch) return;
        sec.drag = { kind: 'make', ...(makeSpan(down.f, down.f, state.tape.grid) || { from: down.f, to: down.f }) };
        if (navigator.vibrate) navigator.vibrate(10);
        drawSections();
      }, 300);
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
    const d = sec.drag;
    if (!d) { if (down.moved) clearTimeout(down.timer); return; }
    const f = frameOf(e);
    // Whole frames on bar lines, as the Pi keeps them (sections.js).
    if (d.kind === 'make') Object.assign(d, makeSpan(down.f, f, state.tape.grid) || { from: down.f, to: down.f });
    else Object.assign(d, edgeTo(d.section, d.kind, f, sectionsOf(), state.tape.grid, state.tape.length));
    drawSections();
  });
  const end = (e, ok) => {
    if (!down || e.pointerId !== down.id) return;
    clearTimeout(down.timer);
    const dn = down, d = sec.drag;
    down = null;
    sec.drag = null;
    drawSections();
    if (!ok) return;
    if (d && d.kind === 'make') {
      if (d.to > d.from) addSection(d.from, d.to);
      else toast('Drag across the bars the section should cover', 'warn');
    }
    else if (d && dn.moved && (d.at !== d.section.at || d.end !== d.section.end)) setSection(d.section.id, { at: d.at, end: d.end });
    else if (!dn.moved && dn.hit) tapSection(dn.hit.section);
  };
  cv.addEventListener('pointerup', (e) => end(e, true));
  cv.addEventListener('pointercancel', (e) => end(e, false));
  // With a keyboard: ← → move between sections, Enter selects one's bars,
  // and again opens its sheet.
  const say = () => {
    const sc = sectionsOf()[sec.focus];
    cv.setAttribute('aria-label', sc
      ? `Section ${sc.name}, ${sectionBars(sc, state.tape.grid, state.tape.sample_rate)}${isLooped(sc, state.tape.loop) ? ', selected' : ''}. Left and right to move, Enter to select`
      : 'Sections: none yet. Hold and drag on the strip to make one');
  };
  cv.addEventListener('focus', () => { if (sec.focus < 0 && sectionsOf().length) sec.focus = 0; say(); drawSections(); });
  cv.addEventListener('blur', drawSections);
  cv.addEventListener('keydown', (e) => {
    const n = sectionsOf().length;
    if (!n) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation(); // not the page's track keys
      sec.focus = Math.max(0, Math.min(n - 1, sec.focus + (e.key === 'ArrowRight' ? 1 : -1)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const sc = sectionsOf()[Math.max(0, sec.focus)];
      if (sc) tapSection(sc);
    } else return;
    say();
    drawSections();
  });
  // The sheet.
  $('section-name').addEventListener('change', () => {
    const name = $('section-name').value.trim();
    if (sec.open && name) setSection(sec.open, { name });
  });
  $('section-dup').addEventListener('click', async () => {
    const sc = sectionsOf().find((x) => x.id === sec.open);
    $('section-sheet').close();
    if (!sc) return;
    const e = await edit('duplicate-section', { section: sc.id });
    if (e) {
      const t = state.tape;
      toast(`${sc.name} twice in a row: ${sectionBars(e.section, t.grid, t.sample_rate)} is a copy, and what followed moved ${spanWords(e.frames, t.grid, t.sample_rate)} later`, 'ok', { action: undoAction });
    }
  });
  $('section-remove').addEventListener('click', async () => {
    const id = sec.open;
    $('section-sheet').close();
    const sc = sectionsOf().find((x) => x.id === id);
    if (sc && await edit('section-remove', { section: id })) toast(`Removed the section ${sc.name}; the audio under it stays`, 'ok', { action: undoAction });
  });
  $('section-done').addEventListener('click', () => $('section-sheet').close());
  $('section-sheet').addEventListener('close', () => { sec.open = null; });
}

async function addSection(at, end) {
  const name = newName(sectionsOf());
  const e = await edit('section-add', { name, at, end });
  if (!e || !e.section) return;
  toast(`Made ${name}, ${sectionBars(e.section, state.tape.grid, state.tape.sample_rate)}: tap it to select its bars`, 'ok', { action: undoAction });
  openSection(e.section);
}

async function setSection(id, fields) {
  const e = await edit('section-set', { section: id, ...fields });
  if (e && e.section && sec.open === id) openSection(e.section);
}

// tapSection selects a section's bars; tapped again, it opens its sheet.
async function tapSection(sc) {
  if (isLooped(sc, state.tape.loop)) { openSection(sc); return; }
  if (await patch({ loop: { in: sc.at, out: sc.end } })) {
    toast(`${sc.name}, ${sectionBars(sc, state.tape.grid, state.tape.sample_rate)}: Lift, Copy and ×2 act on it. Tap it again to rename it`, 'ok', { action: undoAction });
  }
}

function openSection(sc) {
  sec.open = sc.id;
  sec.focus = sectionsOf().findIndex((x) => x.id === sc.id);
  const t = state.tape;
  $('section-title').textContent = `${sc.name} · ${sectionBars(sc, t.grid, t.sample_rate)}`;
  $('section-name').value = sc.name;
  $('section-names').replaceChildren(...SECTION_NAMES.map((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tip = 'section-names';
    b.textContent = n;
    b.setAttribute('aria-pressed', String(n === sc.name));
    b.addEventListener('click', () => setSection(sc.id, { name: n }));
    return b;
  }));
  $('section-colors').replaceChildren(...SECTION_COLORS.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tip = 'section-color';
    b.setAttribute('aria-label', c.id);
    b.style.setProperty('--c', token(c.token, c.fallback));
    b.setAttribute('aria-pressed', String(colorOf(sc).id === c.id));
    b.addEventListener('click', () => setSection(sc.id, { color: c.id }));
    return b;
  }));
  const sh = $('section-sheet');
  if (!sh.open && typeof sh.showModal === 'function') sh.showModal();
}

// --- the view: pinch, pan, Fit --------------------------------------------------

// redrawView redraws what the view moves, once a frame however many moves.
let viewRaf = 0;
function redrawView() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => { viewRaf = 0; drawLanes(); drawRuler(); drawSections(); drawOverview(); renderFit(); });
}

// Canvases don't restyle themselves when the device turns dark or light.
onSchemeChange(redrawView);

function renderFit() { $('view-fit').hidden = !state.zoom; }

// The closest the view goes: the take page's 8 px to the sample.
const laneWidth = () => (lanes[0] ? lanes[0].canvas.getBoundingClientRect().width : 0) || 0;
const minSpan = () => Math.max(1, Math.round(MIN_FPP * laneWidth()));

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
// The overview is the whole tape's scrubber: drag its window to move what the
// lanes show, tap to move the playhead there (to the nearest bar), double-tap
// to go back to the loop.
function wireOverview() {
  const cv = $('tape-overview');
  cv.style.touchAction = 'none';
  // A slider for the keyboard too: ← → a bar (a second with no tempo). A
  // held arrow steps on from where it last asked for, not from a stale poll,
  // and no faster than the Pi can answer. While a clip is being aligned the
  // arrows are the editor's. Tapping it focuses it, and Space still plays:
  // the page's own Space handler leaves focused controls alone.
  let asked = null; // { pos, at }
  cv.addEventListener('keydown', (e) => {
    const t = state.tape, live = state.live;
    if (!t || !live || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) $('play').click();
      return;
    }
    if (state.align || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (asked && now - asked.at < 150) return;
    const from = asked && now - asked.at < 1000 ? asked.pos : live.heard;
    const step = t.grid ? t.grid.frames / t.grid.bars : t.sample_rate;
    const pos = Math.max(0, Math.min(t.length, from + (e.key === 'ArrowRight' ? step : -step)));
    asked = { pos, at: now };
    transport('locate', { pos });
  });
  let down = null, lastTap = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, w: r.width }; };
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || down) return;
    const { x, w } = at(e);
    const win = overviewWindow(laneView(), state.tape.length, w);
    // On the window, the drag holds it where it was grabbed; off it, the
    // window's middle comes to the finger.
    down = { id: e.pointerId, x0: x, grab: onWindow(x, win) ? x - win.x : win.w / 2, moved: false };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id || !state.tape) return;
    const { x, w } = at(e);
    if (!down.moved && Math.abs(x - down.x0) < 6) return;
    down.moved = true;
    setView(dragTo(x, down.grab, laneView(), state.tape.length, w));
  });
  const up = (e) => {
    if (!down || e.pointerId !== down.id) return;
    const moved = down.moved;
    down = null;
    const t = state.tape;
    if (!t || moved || e.type === 'pointercancel') return;
    const { x, w } = at(e);
    const tap = { t: performance.now(), x };
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null;
      state.zoom = null;
      state.touchedView = performance.now();
      redrawView();
      return;
    }
    lastTap = tap;
    const pos = tapAt(x, t.length, w, t.grid);
    const v = laneView();
    if (pos < v.from || pos > v.to) setView(followView(v, pos, t.length));
    transport('locate', { pos });
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

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
    if (pts.size === 2 && !state.slide && !state.sel && !gripHeld()) {
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
    if (state.slide || state.sel || gripHeld()) { g = null; return; }
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
    // While a clip is being aligned the wheel moves it (⌘ or Ctrl zooms); see the bar.
    if (bar.wheel(e)) { e.preventDefault(); return; }
    // While a grip is held, the view is the grip's to scroll.
    if (gripHeld()) { e.preventDefault(); return; }
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

function setText(el, v) {
  if (el.textContent !== v) el.textContent = v;
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

// shownTape is the tape the lanes draw: as it is, or as a previewed Insert or
// Delete time would leave it.
const shownTape = () => (state.preview && state.preview.tape) || state.tape;

function drawLanes() {
  const t = shownTape();
  if (!t) return;
  const view = laneView();
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  const heardTr = heardTracks();
  const heardSolo = heardTr.some((x) => x.solo);
  for (const lane of lanes) {
    const tr = t.tracks[lane.n - 1];
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
    const ht = heardTr.find((x) => x.n === tr.n);
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
    const mono = col('--mono', 'ui-monospace, monospace');
    const heard = state.live ? xOf(state.live.heard, view, W) : null;
    lane.hits = [];
    const labels = [];
    const sorted = [...tr.clips].sort((a, b) => a.layer - b.layer);
    const al = state.align;
    for (const stored of sorted) {
      // The clip being aligned is drawn where the editor has it, which runs
      // ahead of the stored one through a gesture.
      const aligning = !!al && stored.id === al.clipId;
      // A clip being trimmed is drawn with its edge where the grip has it.
      const tm = state.trim && state.trim.clip.id === stored.id ? state.trim : null;
      const c = aligning ? { ...stored, at: al.at } : tm ? trimmed(stored, tm.edge, tm.at) : stored;
      const nudge = nudgeFrames(c, t.sample_rate);
      const x0 = xOf(c.at + nudge, view, W), x1 = xOf(c.at + nudge + c.frames, view, W);
      if (x1 < 0 || x0 > W) continue;
      const top = 2 + Math.min(c.layer, 3) * 3, h = H - 4 - Math.min(c.layer, 3) * 3;
      const bw = Math.max(1, x1 - x0);
      const radius = Math.min(6, bw / 2, h / 2);
      const block = () => { ctx.beginPath(); roundRectPath(ctx, x0 + 0.75, top + 0.75, Math.max(0.5, bw - 1.5), h - 1.5, radius); };
      if (tm) drawTrimReach(ctx, stored, tm, view, W, top, h, tc, x0, x1);
      if (stored.ghost) { drawGhost(ctx, x0, bw, top, h, tc); continue; } // an Insert's clipboard, previewed
      // One being slid stays where it is, faint, until it lands.
      const sliding = state.slide && (state.slide.clip.id === c.id || (state.slide.group && state.slide.group.some((g) => g.id === c.id)));
      ctx.globalAlpha = sliding ? 0.35 : 1;
      block();
      ctx.fillStyle = withAlpha(tc, c.layer ? 0.1 : 0.16);
      ctx.fill();
      const pd = peaks.get(c.file);
      const ready = pd && !(pd instanceof Promise);
      if (ready && bw > 8 && needsDetail(c, pd, view, W)) {
        // Deep in: the stretch of the file on screen as a trace, from range
        // peaks (the coarser level shows while a tile loads), one lane a channel.
        const xa = Math.max(0, x0), xb = Math.min(W, x1);
        const fv = fileView(c, view, W, t.sample_rate);
        const { cols, channels } = tilesOf(c.file, pd).columns({ start: fv.start + xa * fv.fpp, fpp: fv.fpp, width: xb - xa }, dpr);
        const laneCh = laneChannels(channels);
        const laneH = h / laneCh.length;
        const gain = gainOf(c.file, pd);
        ctx.save();
        ctx.beginPath();
        ctx.rect(xa, top, xb - xa, h);
        ctx.clip();
        const lit = heard != null && heard > xa;
        const drawn = laneCh.map((ch, i) => {
          const lv = levelsOfColumns(cols, channels, ch);
          const opts = { cy: top + laneH * (i + 0.5), half: Math.max(1, laneH / 2 - 4), gain, x0: xa };
          const lines = traceLines(lv, lv, opts);
          drawTrace(ctx, null, null, { ...opts, lines, line: withAlpha(tc, c.layer ? 0.4 : 0.55) });
          return { opts, lines };
        });
        if (lit) {
          ctx.beginPath();
          ctx.rect(xa, top, Math.min(heard, xb) - xa, h);
          ctx.clip();
          for (const { opts, lines } of drawn) {
            drawTrace(ctx, null, null, { ...opts, lines, line: tc, fillAlpha: 0.14, width: 1.3, glow: [{ color: withAlpha(tc, 0.7), blur: 4 }] });
          }
        }
        ctx.restore();
      } else if (ready && bw > 8) {
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
      drawFades(ctx, c, view, W, x0, x1, top, h, ink, withAlpha(col('--well', '#000'), 0.6));
      if (labelFits(bw)) {
        const label = clipLabel(stored, tr);
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
      const picked = (state.clip && state.clip.id === c.id) || aligning || (state.multi && state.multi.has(c.id));
      ctx.lineWidth = picked ? 2 : 1.5;
      ctx.strokeStyle = picked ? ink : tc;
      block();
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      if (bw >= MIN_GRIPS_PX && gripsOf(stored).length) drawGrips(ctx, x0, x1, top, h, ink, col('--warn', '#b58900'), tm, mono);
      lane.hits.push({ x0, x1, top, h, clip: stored });
      // The hit the editor follows: a line across the lane.
      if (aligning) {
        const x = Math.round(xOf(soundingAt(c, t.sample_rate) + al.hitOff, view, W));
        if (x >= 0 && x <= W) { ctx.fillStyle = ink; ctx.fillRect(x, 0, 1, H); }
      }
    }
    // A ⟳ corner being dragged: its copies, over everything else on the lane.
    const rp = state.repeat;
    const rclip = rp && rp.n === lane.n ? tr.clips.find((x) => x.id === rp.clip.id) : null;
    if (rclip) {
      const k = Math.min(rclip.layer, 3) * 3;
      drawRepeats(ctx, rclip, rp, view, W, 2 + k, H - 4 - k, tc, ink, mono);
    }
    if (state.preview) drawPreview(ctx, state.preview, lane.n, view, W, H, col);
    // The hit Hit → Track lined it up against, dashed, where its clip is now.
    const rh = al && al.refHit;
    const rc = rh && rh.track === lane.n && al.ref === lane.n ? tr.clips.find((x) => x.id === rh.clipId) : null;
    if (rc) {
      const x = Math.round(xOf(toTape(rc, rh.k, t.sample_rate), view, W)) + 0.5;
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = ink;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (state.rec && state.rec.track === lane.n) drawPunch(ctx, view, W, H, col);
    // A clip being slid: where it would land, on the lane it's over; or each
    // of a group, on the lane it goes to.
    const sl = state.slide;
    const landing = !sl ? [] : sl.group
      ? sl.group.filter((g) => g.track + sl.dtrack === lane.n).map((g) => ({ clip: g, at: g.at + sl.dt }))
      : sl.to === lane.n ? [{ clip: sl.clip, at: sl.at }] : [];
    for (const { clip: lc, at: lat } of landing) {
      const from = lat + nudgeFrames(lc, t.sample_rate); // where it'll sound, as the clip itself is drawn
      const x0 = xOf(from, view, W), x1 = xOf(from + lc.frames, view, W);
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
      ctx.fillText(t.grid ? barBeat(lat, t.grid) : fmtSecs(lat, t.sample_rate), Math.max(2, x0 + 4), 4);
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


// drawGhost draws a clip an Insert would lay: dashed, faint.
function drawGhost(ctx, x0, bw, top, h, tc) {
  ctx.fillStyle = withAlpha(tc, 0.12);
  ctx.fillRect(x0, top, bw, h);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = tc;
  ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, bw - 1), h - 1);
  ctx.setLineDash([]);
}

// drawPreview marks on one lane what a previewed edit does: the gap an
// Insert opens (every track), the seam where Delete time closes the gap
// (every track), or what Drop covers (the clipboard's tracks).
function drawPreview(ctx, pv, n, view, W, H, col) {
  if (pv.kind === 'drop' && !(n >= pv.track && n < pv.track + pv.tracks)) return;
  const x0 = xOf(pv.from, view, W), x1 = xOf(pv.to, view, W);
  if (pv.kind === 'delete') {
    // The lanes are drawn as they'll be: what followed the selection now
    // meets what came before it, at a red seam.
    const c = col('--rec', '#dc322f');
    ctx.fillStyle = withAlpha(c, 0.16);
    ctx.fillRect(x0 - 4, 0, 8, H);
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x0) - 1, 0, 2, H);
    return;
  }
  const c = col('--warn', '#b58900');
  if (pv.kind === 'insert') {
    ctx.fillStyle = withAlpha(c, 0.1);
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
  }
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.75, 1, Math.max(1, x1 - x0) - 1.5, H - 2);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

// drawFades draws a clip's fades on its block, as a DAW does: the faded
// corner shaded, under an equal-power curve from silence to full.
function drawFades(ctx, c, view, W, x0, x1, top, h, ink, shade) {
  const { fadeIn, fadeOut } = clipFades(c);
  if (!fadeIn && !fadeOut) return;
  const px = (frames) => (frames / (view.to - view.from)) * W;
  const ramp = (from, w, rising) => {
    if (w < 2) return;
    ctx.beginPath();
    const y = (k) => top + h - h * Math.sin((rising ? k : 1 - k) * Math.PI / 2);
    ctx.moveTo(from, top);
    for (let i = 0; i <= 16; i++) ctx.lineTo(from + (w * i) / 16, y(i / 16));
    ctx.lineTo(from + w, top);
    ctx.closePath();
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) ctx[i ? 'lineTo' : 'moveTo'](from + (w * i) / 16, y(i / 16));
    ctx.strokeStyle = withAlpha(ink, 0.75);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, h);
  ctx.clip();
  ramp(x0, Math.min(x1 - x0, px(fadeIn)), true);
  const wo = Math.min(x1 - x0, px(fadeOut));
  ramp(x1 - wo, wo, false);
  ctx.restore();
}

// drawTrimReach draws, faintly, the audio a trimmed edge can reach: the
// clip's file from as far back, or on, as the edge can go, outside the block
// as it's drawn now, so you see what you'd get back.
function drawTrimReach(ctx, stored, tm, view, W, top, h, tc, x0, x1) {
  const pd = peaks.get(stored.file);
  if (!pd || pd instanceof Promise) return;
  const reach = trimmed(stored, tm.edge, tm.edge === 'in' ? tm.bounds.lo : tm.bounds.hi);
  const nudge = nudgeFrames(reach, state.tape.sample_rate);
  const rx0 = xOf(reach.at + nudge, view, W), rx1 = xOf(reach.at + nudge + reach.frames, view, W);
  if (rx1 - rx0 <= 8) return;
  ctx.save();
  ctx.beginPath();
  if (x0 > rx0) ctx.rect(rx0, top, x0 - rx0, h);
  if (rx1 > x1) ctx.rect(x1, top, rx1 - x1, h);
  ctx.clip();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = withAlpha(tc, 0.45);
  ctx.strokeRect(rx0 + 0.5, top + 0.5, rx1 - rx0 - 1, h - 1);
  ctx.setLineDash([]);
  // Zoomed in past the file's whole peaks, its bars would be one a few
  // samples, across all of the reach: the outline is enough there.
  if (needsDetail(reach, pd, view, W)) { ctx.restore(); return; }
  drawBars(ctx, blockLevels(pd, reach, rx1 - rx0), {
    x0: rx0 + 4, pitch: 4, cy: top + h / 2 + 3, half: Math.max(1, h / 2 - 12),
    gain: gainOf(stored.file, pd), width: 2.2, color: withAlpha(tc, 0.22),
  });
  ctx.restore();
}

// drawRepeats draws the copies a drag of the ⟳ corner would lay: a ghost of
// the clip after it for each, and how many.
function drawRepeats(ctx, c, rp, view, W, top, h, tc, ink, mono) {
  const pd = peaks.get(c.file);
  const ready = pd && !(pd instanceof Promise);
  const nudge = nudgeFrames(c, state.tape.sample_rate);
  let last = 0;
  for (let k = 1; k <= rp.count; k++) {
    const x0 = xOf(c.at + nudge + k * c.frames, view, W), x1 = xOf(c.at + nudge + (k + 1) * c.frames, view, W);
    last = x1;
    if (x1 < 0 || x0 > W) continue;
    const bw = Math.max(1, x1 - x0);
    ctx.save();
    ctx.fillStyle = withAlpha(tc, 0.08);
    ctx.fillRect(x0, top, bw, h);
    // Zoomed in past the file's whole peaks, a copy is its outline.
    if (ready && bw > 8 && !needsDetail(c, pd, view, W)) {
      ctx.beginPath(); ctx.rect(x0, top, bw, h); ctx.clip();
      drawBars(ctx, blockLevels(pd, c, bw), {
        x0: x0 + 4, pitch: 4, cy: top + h / 2 + 3, half: Math.max(1, h / 2 - 12),
        gain: gainOf(c.file, pd), width: 2.2, color: withAlpha(tc, 0.3),
      });
    }
    ctx.restore();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = withAlpha(tc, 0.8);
    ctx.strokeRect(x0 + 0.5, top + 0.5, bw - 1, h - 1);
    ctx.setLineDash([]);
  }
  if (rp.count > 0 && last > 0) {
    ctx.font = `11px ${mono}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = ink;
    ctx.fillText(`×${rp.count + 1}`, Math.min(W - 28, last + 4), top + 4);
  }
}

// drawGrips draws the picked clip's trim grips, a pill inside each edge's
// zone below its ⟳ corner; a grip pushed against how far it can go turns
// amber, with a line at the stop.
function drawGrips(ctx, x0, x1, top, h, ink, warn, tm, mono) {
  // The ⟳ corner, top right (lib/tape/clipgestures.js zonesOf's 'repeat').
  ctx.save();
  ctx.font = `13px ${mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = withAlpha(ink, 0.9);
  ctx.fillText('⟳', x1 - HANDLE_PX / 2, top + Math.min(HANDLE_PX, h / 2) / 2);
  ctx.restore();
  // The pills sit below the corner, in the edges' lower part.
  const below = top + Math.min(HANDLE_PX, h / 2);
  const gh = Math.min(28, (top + h - below) * 0.7);
  const y = below + (top + h - below - gh) / 2;
  for (const [edge, gx] of [['in', x0 + HANDLE_PX / 2 - 2], ['out', x1 - HANDLE_PX / 2 - 2]]) {
    const stop = tm && tm.edge === edge && tm.limited;
    ctx.fillStyle = stop ? warn : withAlpha(ink, 0.9);
    ctx.beginPath();
    roundRectPath(ctx, gx, y, 4, gh, 2);
    ctx.fill();
    if (stop) ctx.fillRect(Math.round(edge === 'in' ? x0 : x1 - 2), top, 2, h);
  }
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
  const reg = recRegion(rec.wrapped || !!(rec.trace && rec.trace.passes > 0), rec.start, t.loop, live.heardEngine ?? live.heard);
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
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  // The window: what the lanes show. Dashed until a pinch, a pan or a drag
  // here has moved it off the loop.
  paintTapeOverview(ctx, r.width, r.height, t, state.live ? state.live.heard : null,
    { col, win: overviewWindow(laneView(), t.length, r.width), dashed: !state.zoom });
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
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
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
  const hit = laneHit(lane, e);
  // With several picked, or with Shift, a tap adds the clip or takes it off.
  if (hit && (state.multi || e.shiftKey)) { toggleMulti(hit.clip); return; }
  if (hit) { openClip(hit.clip); return; }
  // An empty part of a lane moves the playhead there, and lets go of the
  // picked clip (several picked stay picked).
  state.picked = null;
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
  // A clip editor's move still being made is saved first, and the undo goes
  // after it and every slide before it, in the same line, so a step made
  // while it's on its way waits behind it (saveAlign).
  bar.commit();
  const run = alignSaves.then(async () => {
    try {
      await change(() => api(`/api/tapes/${redo ? 'redo' : 'undo'}?${q()}`, { method: 'POST' }));
    } catch (e) {
      toast(e.message, 'bad');
    }
  });
  alignSaves = run;
  await run;
}

// closeSheets closes what belongs to the tape shown, before another is.
function closeSheets() {
  const sh = $('clip-sheet');
  if (sh.open) sh.close();
  if ($('track-sheet').open) $('track-sheet').close();
  if ($('rename-sheet').open) $('rename-sheet').close();
  if ($('section-sheet').open) $('section-sheet').close();
  state.clip = null;
  // The clip editor's clip was on the tape going away: nothing to save.
  state.align = null;
  bar.dirty = false;
  closeMenus();
}

function openClip(c) {
  state.clip = c;
  state.picked = c.id;
  // Start here and End here trim to the playhead, where the clip would be
  // placed to sound there (its nudge taken off).
  const live = state.live;
  const here = live ? (live.heardEngine ?? live.heard) - nudgeFrames(c, state.tape.sample_rate) : null;
  for (const edge of ['in', 'out']) {
    const b = trimRange(c, edge);
    const now = edge === 'in' ? c.at : c.at + c.frames;
    $(`clip-trim-${edge}`).disabled = here == null || !b || here < b.lo || here > b.hi || here === now;
  }
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
  renderFades(c);
  const sh = $('clip-sheet');
  if (typeof sh.showModal === 'function') sh.showModal();
  drawLanes();
}

// renderFades lays out the clip sheet's two rows of fade lengths, the
// clip's own lit: off, 10 ms, and with a tempo parts of a beat, a beat and a
// bar (geometry.js fadeOptions). A length set another way lights none.
function renderFades(c) {
  const t = state.tape;
  const plays = clipFades(c); // what plays, after a trim shorter than a fade
  for (const [edge, key] of [['in', 'fade_in'], ['out', 'fade_out']]) {
    const box = $(`clip-fade-${edge}`);
    const on = fadeOption(edge === 'in' ? plays.fadeIn : plays.fadeOut, t.grid, t.sample_rate);
    box.replaceChildren(...fadeOptions(t.grid, t.sample_rate).map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tip = 'clip-fade';
      b.textContent = o.label;
      b.disabled = o.frames === null || o.frames > c.frames;
      if (o.frames === null) b.title = 'The tape has no tempo yet';
      b.setAttribute('aria-pressed', String(!!on && on.id === o.id));
      b.addEventListener('click', () => setFade(c, key, o.frames));
      return b;
    }));
  }
}

// setFade sets one of the sheet's clip's fades, and keeps the sheet on it.
async function setFade(c, key, frames) {
  const ok = await patch({ clip: { id: c.id, [key]: frames } });
  if (!ok || !state.clip || state.clip.id !== c.id) return;
  const now = state.tape.tracks.flatMap((tr) => tr.clips).find((x) => x.id === c.id);
  if (now) { state.clip = now; renderFades(now); }
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
  // The bar's drawer keys open one drawer, or close it; its ✕ closes it.
  $('np-drawer-rec').addEventListener('click', () => setDrawer(state.drawer === 'rec' ? '' : 'rec'));
  $('np-drawer-edit').addEventListener('click', () => setDrawer(state.drawer === 'edit' ? '' : 'edit'));
  $('np-drawer-crate').addEventListener('click', () => setDrawer(state.drawer === 'crate' ? '' : 'crate'));
  for (const b of document.querySelectorAll('.np-drawer-close')) {
    b.addEventListener('click', () => { const key = b.dataset.drawer; setDrawer(''); $(`np-drawer-${key}`).focus(); });
  }
  // From 1200 px the three drawer keys sit beside Catch; narrower (the
  // 1024 px bench too), the top row has no room for them, and they sit under
  // it, beside OUT. Moved, not reordered in CSS, so the tab order stays the
  // order on screen.
  const wide = matchMedia('(min-width: 1200px)');
  const placeKeys = () => {
    const keys = [$('np-drawer-rec'), $('np-drawer-edit'), $('np-drawer-crate')];
    const had = keys.find((k) => k === document.activeElement);
    if (wide.matches) $('catch-pass').before(...keys);
    else document.querySelector('.np-out').before(...keys);
    if (had) had.focus({ preventScroll: true }); // a move would drop it
  };
  wide.addEventListener('change', placeKeys);
  placeKeys();
  // Toasts and tips rise over the dock: its height, a drawer included.
  new ResizeObserver(() => {
    document.body.style.setProperty('--dock-h', `${Math.round($('np-dock').getBoundingClientRect().height)}px`);
  }).observe($('np-dock'));
  // |◂: to the loop's start while looping, else to the top of the tape.
  $('to-start').addEventListener('click', () => {
    const t = state.tape;
    if (!t) return;
    transport('locate', { pos: t.loop.on && t.loop.out > t.loop.in ? t.loop.in : 0 });
  });
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
  wireSections();
  wireOverview();
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
    // Escape closes an open menu and nothing else.
    const menuWasOpen = e.key === 'Escape' && menusOpen();
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
    // ⌘C or Ctrl+C copies the picked clips (or the one picked clip) as they
    // lie, unless there's text selected to copy; ⌘D or Ctrl+D lays a copy
    // of them right after them.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !typing && !e.repeat && !state.align && !document.querySelector('dialog[open]')) {
      const ids = keyed();
      if (e.code === 'KeyC' && ids.length && !String(window.getSelection?.() || '')) { e.preventDefault(); copyClips(ids); return; }
      if (e.code === 'KeyD' && ids.length) { e.preventDefault(); duplicateClips(ids); return; }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return; // a sheet's keys are its own
    // While a clip is being aligned the arrows step it, Shift by ten (not on
    // a level slider or in a menu, whose arrows are their own), and Escape
    // closes the editor.
    if (state.align) {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.tagName !== 'INPUT' && !menusOpen()) {
        e.preventDefault();
        bar.step(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 10 : 1, !e.repeat);
        return;
      }
      if (e.key === 'Escape' && !menuWasOpen) { e.preventDefault(); closeAlign(); return; }
    }
    // Escape lets a previewed Insert, Delete time or Drop go, first.
    if (e.key === 'Escape' && !menuWasOpen && state.preview) {
      e.preventDefault();
      showPreview(null);
      return;
    }
    // Escape closes an open drawer, once nothing nearer was open.
    if (e.key === 'Escape' && !menuWasOpen && state.drawer) {
      e.preventDefault();
      const key = state.drawer;
      const inside = $(`drawer-${key}`).contains(document.activeElement);
      setDrawer('');
      if (inside) $(`np-drawer-${key}`).focus(); // not lost to the page
      return;
    }
    // Escape lets go of several picked clips, then of the picked clip.
    if (e.key === 'Escape' && !menuWasOpen && state.multi) {
      endMulti();
      return;
    }
    if (e.key === 'Escape' && !menuWasOpen && state.picked) {
      state.picked = null;
      drawLanes();
      return;
    }
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
      case 'KeyS': if (!state.align) press('ed-split'); break;
      case 'Delete': case 'Backspace': {
        // Not while a clip is aligned: the editor's clip is the picked one.
        const ids = state.align || e.repeat ? [] : keyed();
        if (ids.length) { e.preventDefault(); removeClips(ids); }
        break;
      }
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
  $('clip-keep').addEventListener('click', () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c) keep({ tape: state.id, clip: c.id });
  });
  $('clip-keep-board').addEventListener('click', () => keep({ clipboard: true }));
  wireCrate();
  wireTimeEdits();
  $('clip-select').addEventListener('click', () => {
    const c = state.clip;
    $('clip-sheet').close();
    if (c) startMulti([c.id]);
  });
  $('multi-move').addEventListener('click', moveHere);
  $('multi-copy').addEventListener('click', () => copyClips(keyed()));
  $('multi-reverse').addEventListener('click', () => reverseClips(keyed()));
  $('multi-remove').addEventListener('click', () => removeClips(keyed()));
  $('multi-done').addEventListener('click', endMulti);
  for (const edge of ['in', 'out']) {
    $(`clip-trim-${edge}`).addEventListener('click', () => {
      const c = state.clip;
      const live = state.live;
      $('clip-sheet').close();
      if (c && live) trimClip(c, edge, (live.heardEngine ?? live.heard) - nudgeFrames(c, state.tape.sample_rate));
    });
  }
  $('clip-align').addEventListener('click', () => {
    if (state.clip && !$('clip-align').classList.contains('waiting')) openAlign(state.clip);
  });
  // The clip editor.
  $('ce-done').addEventListener('click', closeAlign);
  $('ce-grid').addEventListener('click', hitToGrid);
  $('ce-track').addEventListener('click', hitToTrack);
  $('ce-play').addEventListener('click', alignPlay);
  $('clip-sheet').addEventListener('close', () => {
    state.clip = null;
    // An Align still waiting for its audio is let go of with the sheet.
    alignTicket++;
    $('clip-align').classList.remove('waiting');
    $('clip-align').removeAttribute('aria-busy');
    drawLanes();
  });
  // A clip editor's move still being made is saved when the page goes. Two
  // hooks, as on the take page: pagehide fires on navigation,
  // visibilitychange when the app is switched or the screen locks.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bar.commit(); });
  window.addEventListener('pagehide', () => bar.commit());
  // The lanes and the bar's scrubber change width apart: each redraws all three.
  const ro = new ResizeObserver(() => { drawLanes(); drawOverview(); drawRuler(); drawSections(); });
  ro.observe($('lanes'));
  ro.observe($('tape-overview'));
  ro.observe($('tape-sections'));
  wireView($('lanes'), () => (lanes[0] ? lanes[0].canvas : $('lanes')).getBoundingClientRect());
  wireView($('tape-ruler'), () => $('tape-ruler').getBoundingClientRect());
  $('view-fit').addEventListener('click', () => { state.zoom = null; state.touchedView = performance.now(); redrawView(); });
}

boot();
