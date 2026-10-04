// web/static/lib/tape/page.js
// The tape page: the loaded tape's four tracks, its transport, and catching
// from the ring. The Pi does the work (internal/tape); this page polls its
// state a few times a second and sends what you tap.

import { toast } from '../toast.js';
import { initHelp } from '../help/help.js';
import { peakColumns, foldChannels, drawColumns } from '../wave/draw.js';
import {
  editView as viewRange, barSpan, nearestBar, xOf, frameAt, barLines, bpm as bpmOf, barBeat, fmtSecs, clipBuckets,
  SNAPS, slideTo, nudgeFrames, splitAt, joinPartner, fitsDoubled,
} from './geometry.js';

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
};
const peaks = new Map(); // pool file -> PeakData, or a pending promise

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
    const s = await api(`/api/tapes/state?${q()}`);
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
  state.tape = s.tape;
  state.live = s.live || null;
  state.sources = s.sources || [];
  state.undo = s.undo || 0;
  state.redo = s.redo || 0;
  if (state.track > state.tape.tracks.length) state.track = 1;
  if (changed) { buildLanes(); loadPeaks(); }
  render();
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
  $('tape-name').textContent = `${t.name} ▾`;
  document.title = `${t.name} — tape — Hindsight`;
  // The tempo, and the loop in bars (the grid's own until the ruler moves
  // it).
  let sub = 'no tempo yet';
  if (t.grid) {
    const bars = t.loop.out > t.loop.in ? Math.round((t.loop.out - t.loop.in) / (t.grid.frames / t.grid.bars)) : t.grid.bars;
    sub = `${bpmOf(t.grid, sr).toFixed(1)} BPM · ${bars} bar${bars === 1 ? '' : 's'}${t.loop.on ? '' : ', not looping'} ▾`;
  }
  $('tape-sub').textContent = sub;
  $('tape-sub').disabled = !t.grid;
  const empty = t.tracks.every((tr) => tr.clips.length === 0);
  $('tape-empty').hidden = !(empty && !t.grid);
  $('tape-undo').disabled = !state.undo;
  $('tape-redo').disabled = !state.redo;
  const lock = live ? live.aligned : 'none';
  $('lock-dot').className = `dot lock ${lock === 'exact' || lock === 'locked' ? 'ok' : lock === 'estimated' ? 'wait' : 'bad'}`;
  $('lock-dot').title = lock === 'none' ? 'not lined up yet: catches wait'
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
  rb.textContent = !rec ? '● Rec' : rec.state === 'armed' ? `● Armed ${rec.track}` : `● Rec ${rec.track}`;
  rb.disabled = !rec && (!live || live.aligned === 'none' || !t.grid || mixing);
  $('click').setAttribute('aria-pressed', String(!!t.click));
  $('click').disabled = !t.grid;
  $('tap').textContent = live && live.tapped ? 'Tap where it comes round' : 'Tap where the loop starts';
  $('tap').classList.toggle('second', !!(live && live.tapped));

  noteMixdown(live && live.mixdown);
  renderClock(live && live.clock, t);
  renderSources();
  renderPasses();
  const canCatch = live && live.aligned !== 'none';
  $('catch-pass').disabled = !canCatch || !(live.cycles || []).length;
  for (const b of $('catch-bars').querySelectorAll('button')) b.disabled = !canCatch || !t.grid;
  renderMode();
  renderClipboard();
  renderEdit();
  drawLanes();
  drawOverview();
  drawRuler();
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
    toast(what, 'ok', {
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
  $('tape-menu').hidden = true;
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
    laneTap(lane, e);
  });
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape || e.button > 0 || down) return; // one pointer at a time
    const hit = hitAt(e.clientX - cv.getBoundingClientRect().left);
    if (!hit) return;
    down = { x: e.clientX, y: e.clientY, hit, moved: false, held: false, id: e.pointerId };
    down.timer = setTimeout(() => {
      if (!down || down.moved) return;
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
    const view = viewRange(state.tape);
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
  const view = viewRange(t);
  const span = (from, to, fill) => {
    const x0 = Math.max(0, xOf(from, view, W)), x1 = Math.min(W, xOf(to, view, W));
    if (x1 > x0) { ctx.fillStyle = fill; ctx.fillRect(x0, 0, x1 - x0, H); }
  };
  if (t.loop.out > t.loop.in) span(t.loop.in, t.loop.out, t.loop.on ? 'rgba(251,191,36,0.22)' : 'rgba(251,191,36,0.08)');
  if (state.sel) span(state.sel.from, state.sel.to, 'rgba(52,211,153,0.35)');
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (const b of barLines(t.grid, view)) {
    const x = Math.round(xOf(b.frame, view, W));
    ctx.fillStyle = 'rgba(238,242,248,0.35)';
    ctx.fillRect(x, H * 0.45, 1, H * 0.55);
    ctx.fillStyle = 'rgba(238,242,248,0.7)';
    if (x + 3 < W - 8) ctx.fillText(String(b.n), x + 3, H * 0.3);
  }
  if (state.live) {
    const x = xOf(state.live.heard, view, W);
    if (x >= 0 && x <= W) { ctx.fillStyle = '#eef2f8'; ctx.fillRect(Math.round(x), 0, 1, H); }
  }
}

// Tap the ruler: the playhead to the nearest bar line. Hold, then drag:
// select whole bars, which become the loop.
function wireRuler() {
  const cv = $('tape-ruler');
  let down = null;
  const frameOf = (e) => {
    const r = cv.getBoundingClientRect();
    return frameAt(Math.min(r.width, Math.max(0, e.clientX - r.left)), viewRange(state.tape), r.width);
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!state.tape) return;
    cv.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, f: frameOf(e), held: false, moved: false };
    down.timer = setTimeout(() => {
      if (!down || down.moved || !state.tape.grid) return;
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
    } else if (!d.moved && !cancelled) {
      const f = frameOf(e);
      transport('locate', { pos: state.tape.grid ? nearestBar(state.tape.grid, f) : f });
    }
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
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

function renderSources() {
  const box = $('sources');
  box.replaceChildren(...state.sources.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tip = 'source-chip';
    b.setAttribute('aria-pressed', String(s.name === state.source));
    b.textContent = `${s.name} ${s.clean ? '●' : '○'}`;
    b.title = s.clean ? 'clean: no tape in it' : `the tape is in it (bus ${s.leaks.join('+')})`;
    b.addEventListener('click', () => { state.source = s.name; writePref('tape.source', s.name); renderSources(); });
    return b;
  }));
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
          <button class="tt-name" type="button"></button>
          <button class="chip tt-bus" type="button" data-tip="bus"></button>
          <button class="chip tt-mute" type="button" aria-pressed="false" data-tip="track-mute">M</button>
          <button class="chip tt-solo" type="button" aria-pressed="false" data-tip="track-solo">S</button>
          <input class="tt-gain" type="range" min="-30" max="6" step="0.5" aria-label="Track level" data-tip="track-gain">
        </div>
        <canvas class="tt-lane" data-tip="tape-lane"></canvas>`;
      const n = tr.n;
      const lane = {
        n, row,
        name: row.querySelector('.tt-name'),
        bus: row.querySelector('.tt-bus'),
        mute: row.querySelector('.tt-mute'),
        solo: row.querySelector('.tt-solo'),
        gain: row.querySelector('.tt-gain'),
        canvas: row.querySelector('.tt-lane'),
      };
      // Tap a track to select it; tap it again for its sheet.
      lane.name.addEventListener('click', () => { if (state.track === n) openTrack(n); else { state.track = n; render(); } });
      lane.bus.addEventListener('click', () => patch({ track: { n, bus: track(n).bus === 'A' ? 'B' : 'A' } }));
      lane.mute.addEventListener('click', () => patch({ track: { n, mute: !track(n).mute } }));
      lane.solo.addEventListener('click', () => patch({ track: { n, solo: !track(n).solo } }));
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
  const view = viewRange(t);
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  for (const lane of lanes) {
    const tr = track(lane.n);
    if (!tr) continue;
    lane.row.classList.toggle('selected', lane.n === state.track);
    lane.name.textContent = `${tr.n}${tr.name ? ` ${tr.name}` : ''}`;
    lane.bus.textContent = tr.bus;
    lane.mute.setAttribute('aria-pressed', String(!!tr.mute));
    lane.solo.setAttribute('aria-pressed', String(!!tr.solo));
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
    // Bar lines.
    for (const b of barLines(t.grid, view)) {
      const x = Math.round(xOf(b.frame, view, W));
      ctx.fillStyle = col('--line', '#26324a');
      ctx.fillRect(x, 0, 1, H);
    }
    // Clips, base layer first.
    lane.hits = [];
    const sorted = [...tr.clips].sort((a, b) => a.layer - b.layer);
    for (const c of sorted) {
      const nudge = nudgeFrames(c, t.sample_rate);
      const x0 = xOf(c.at + nudge, view, W), x1 = xOf(c.at + nudge + c.frames, view, W);
      if (x1 < 0 || x0 > W) continue;
      const top = 2 + Math.min(c.layer, 3) * 3, h = H - 4 - Math.min(c.layer, 3) * 3;
      // One being slid stays where it is, faint, until it lands.
      ctx.globalAlpha = state.slide && state.slide.clip.id === c.id ? 0.35 : 1;
      ctx.fillStyle = c.layer ? 'rgba(96,165,250,0.18)' : 'rgba(52,211,153,0.16)';
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), h);
      const pd = peaks.get(c.file);
      const w = Math.max(1, Math.round(x1 - x0));
      if (pd && !(pd instanceof Promise)) {
        const [b0, b1] = clipBuckets(c, pd);
        const cols = foldChannels(peakColumns(pd, w, b0, b1), pd.channels);
        ctx.save();
        ctx.translate(Math.round(x0), 0);
        drawColumns(ctx, cols, 1, { top, height: h, color: c.layer ? '#60a5fa' : '#34d399' });
        ctx.restore();
      }
      ctx.strokeStyle = state.clip && state.clip.id === c.id ? '#eef2f8' : 'rgba(238,242,248,0.25)';
      ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, x1 - x0) - 1, h - 1);
      ctx.globalAlpha = 1;
      lane.hits.push({ x0, x1, clip: c });
    }
    // A clip being slid: where it would land.
    const sl = state.slide;
    if (sl && sl.n === lane.n) {
      const from = sl.at + nudgeFrames(sl.clip, t.sample_rate); // where it'll sound, as the clip itself is drawn
      const x0 = xOf(from, view, W), x1 = xOf(from + sl.clip.frames, view, W);
      ctx.fillStyle = 'rgba(251,191,36,0.22)';
      ctx.fillRect(x0, 1, Math.max(1, x1 - x0), H - 2);
      ctx.strokeStyle = '#fbbf24';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0) - 1, H - 3);
      ctx.setLineDash([]);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(t.grid ? barBeat(sl.at, t.grid) : fmtSecs(sl.at, t.sample_rate), Math.max(2, x0 + 4), 4);
    }
    // The playhead: what the device is playing now.
    if (state.live) {
      const x = xOf(state.live.heard, view, W);
      if (x >= 0 && x <= W) {
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.fillRect(Math.round(x), 0, 1, H);
      }
    }
  }
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
  ctx.fillStyle = 'rgba(52,211,153,0.5)';
  t.tracks.forEach((tr, i) => {
    for (const c of tr.clips) {
      const x0 = xOf(c.at, all, W), x1 = xOf(c.at + c.frames, all, W);
      ctx.fillRect(x0, 2 + i * ((H - 4) / t.tracks.length), Math.max(1, x1 - x0), (H - 4) / t.tracks.length - 1);
    }
  });
  if (t.loop.out > t.loop.in) {
    const x0 = xOf(t.loop.in, all, W), x1 = xOf(t.loop.out, all, W);
    ctx.strokeStyle = t.loop.on ? '#fbbf24' : 'rgba(251,191,36,0.4)';
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
  }
  if (state.live) {
    ctx.fillStyle = '#eef2f8';
    ctx.fillRect(Math.round(xOf(state.live.heard, all, W)), 0, 1, H);
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
  toast(`Kept ${what} from ${k.clip.source} on track ${k.track}`, 'ok', { action: { label: 'Undo', run: () => undoRedo(false) } });
}

// rec arms the selected track, punches in, or ends the punch and keeps it.
async function rec() {
  const r = state.live && state.live.record;
  try {
    if (!r) {
      const b = await change(() => api(`/api/tapes/record?${q()}`, { method: 'POST', body: { track: state.track, source: state.source, replace: state.mode === 'replace' } }));
      const armed = b.record.state === 'armed';
      toast(armed ? `Track ${state.track} armed: press ▶ to count in` : `Recording ${state.source} onto track ${state.track} from the next bar — tap ● again to keep it`, 'ok', {
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
  try {
    const b = await change(() => api(`/api/tapes/tap?${q()}`, { method: 'POST', body: { track: state.track, source: state.source } }));
    if (b.stage === 'first') {
      toast('Now tap where it comes round', 'ok', { action: { label: 'Start over', run: () => api(`/api/tapes/tap?${q()}`, { method: 'DELETE' }).then(poll, () => {}) } });
    } else {
      toast(`A ${(b.clip.frames / state.tape.sample_rate).toFixed(2)} s loop: ${b.bars} bar${b.bars === 1 ? '' : 's'} at ${b.bpm} BPM`, 'ok', {
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
  $('tape-menu').hidden = true;
  if (!t || !t.grid || !menu.hidden) { menu.hidden = true; return; }
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
    b.addEventListener('click', () => { menu.hidden = true; if (o.bars !== t.grid.bars) patch({ bars: o.bars }); });
    return b;
  }));
  menu.hidden = false;
}

function laneTap(lane, e) {
  state.track = lane.n;
  const r = lane.canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const hit = (lane.hits || []).filter((h) => x >= h.x0 && x <= h.x1).pop();
  if (hit) { openClip(hit.clip); return; }
  // An empty part of a lane moves the playhead there.
  transport('locate', { pos: frameAt(x, viewRange(state.tape), r.width) });
  render();
}

async function doCatch(what) {
  const body = { track: state.track, source: state.source, replace: state.mode === 'replace', ...what };
  try {
    const b = await change(() => api(`/api/tapes/catch?${q()}`, { method: 'POST', body }));
    const s = (b.clip.frames / state.tape.sample_rate).toFixed(1);
    toast(`Caught ${s} s from ${state.source} onto track ${state.track}${b.clip.clean ? '' : ' — the tape was in that source too'}`, 'ok', {
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
  state.clip = null;
  $('tape-menu').hidden = true;
  $('tempo-menu').hidden = true;
}

function openClip(c) {
  state.clip = c;
  $('clip-title').textContent = `Clip on track ${state.track} · ${(c.frames / state.tape.sample_rate).toFixed(2)} s · ${c.source || ''}`
    + (c.aligned === 'estimated' ? ' · caught before the lock: nudge it if it’s early or late' : '');
  $('clip-gain').value = String(c.gain_db || 0);
  $('clip-gain-val').textContent = `${c.gain_db || 0} dB`;
  $('clip-nudge-val').textContent = `${c.nudge_ms || 0} ms`;
  const lp = state.tape.loop;
  $('clip-tile').disabled = !(lp.on && c.at + 2 * c.frames <= lp.out);
  const home = state.tape.tracks.find((tr) => tr.clips.some((x) => x.id === c.id));
  $('clip-join').disabled = !home || !joinPartner(home, c);
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

async function openMenu() {
  const menu = $('tape-menu');
  $('tempo-menu').hidden = true;
  if (!menu.hidden) { menu.hidden = true; return; }
  const t0 = state.tape, live = state.live;
  const playable = !!(t0 && live && live.output && t0.tracks.some((tr) => tr.clips.length));
  $('tape-mixdown').disabled = !playable || !(t0.loop.out > t0.loop.in);
  $('tape-mixdown-all').disabled = !playable;
  let list = { tapes: [] };
  try { list = await api('/api/tapes'); } catch { /* show what we can */ }
  $('tape-list').replaceChildren(...list.tapes.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.tip = 'tape-load';
    b.className = t.id === state.id ? 'on' : '';
    b.textContent = `${t.name}${t.bpm ? ` · ${t.bpm} BPM` : ''} · ${t.clips} clip${t.clips === 1 ? '' : 's'}`;
    b.addEventListener('click', () => { menu.hidden = true; if (t.id !== state.id) loadTape(t.id); });
    return b;
  }));
  menu.hidden = false;
}

function wire() {
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
  document.addEventListener('click', (e) => {
    if (!$('tape-menu').contains(e.target)) $('tape-menu').hidden = true;
    if (!$('tempo-menu').contains(e.target)) $('tempo-menu').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('tape-menu').hidden = true; $('tempo-menu').hidden = true; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoRedo(e.shiftKey); }
      return;
    }
    if (e.key === ' ' && !e.target.closest?.('button, a, [tabindex]')) { e.preventDefault(); $('play').click(); }
  });
  $('tape-new').addEventListener('click', () => { $('tape-menu').hidden = true; newTape(); });
  $('tape-mixdown').addEventListener('click', () => { $('tape-menu').hidden = true; mixdown(false); });
  $('tape-mixdown-all').addEventListener('click', () => { $('tape-menu').hidden = true; mixdown(true); });
  $('tape-export').addEventListener('click', exportStems);
  $('tape-clone').addEventListener('click', async () => {
    $('tape-menu').hidden = true;
    try {
      const t = await api(`/api/tapes/clone?${q()}`, { method: 'POST' });
      toast(`Cloned as “${t.name}”`, 'ok', { action: { label: 'Open it', run: () => loadTape(t.id) } });
    } catch (e) { toast(e.message, 'bad'); }
  });
  $('tape-delete').addEventListener('click', async () => {
    $('tape-menu').hidden = true;
    let list = { tapes: [] };
    try { list = await api('/api/tapes'); } catch { /* none */ }
    const others = list.tapes.filter((t) => t.id !== state.id);
    if (!others.length) { toast('The loaded tape can\'t be deleted; there\'s no other one', 'warn'); return; }
    const name = window.prompt(`Delete which tape? Type its name:\n${others.map((t) => t.name).join('\n')}`);
    const t = others.find((x) => x.name === (name || '').trim());
    if (!t) return;
    try { await api(`/api/tapes?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }); toast(`Deleted “${t.name}”`); } catch (e) { toast(e.message, 'bad'); }
  });
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
}

boot();
