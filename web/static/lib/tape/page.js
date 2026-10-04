// web/static/lib/tape/page.js
// The tape page: the loaded tape's four tracks, its transport, and catching
// from the ring. The Pi does the work (internal/tape); this page polls its
// state a few times a second and sends what you tap.

import { toast } from '../toast.js';
import { initHelp } from '../help/help.js';
import { peakColumns, foldChannels, drawColumns } from '../wave/draw.js';
import { viewRange, xOf, frameAt, barLines, bpm as bpmOf, barBeat, fmtSecs, clipBuckets } from './geometry.js';

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
  clip: null,       // the clip whose sheet is open
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
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
}

let polling = false;
async function poll() {
  if (polling || !state.id) return;
  polling = true;
  try {
    apply(await api(`/api/tapes/state?${q()}`));
  } catch (e) {
    if (e.status === 404 || e.status === 409) {
      // Another device loaded a different tape: follow it.
      try { const l = await api('/api/tapes'); if (l.loaded && l.loaded !== state.id) { state.id = l.loaded; } } catch { /* next poll */ }
    }
  } finally {
    polling = false;
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
  $('tape-sub').textContent = t.grid
    ? `${bpmOf(t.grid, sr).toFixed(1)} BPM · ${t.grid.bars} bar${t.grid.bars === 1 ? '' : 's'}`
    : 'no tempo yet';
  const empty = t.tracks.every((tr) => tr.clips.length === 0);
  $('tape-empty').hidden = !(empty && !t.grid);
  $('tape-undo').disabled = !state.undo;
  $('tape-redo').disabled = !state.redo;
  const lock = live ? live.aligned : 'none';
  $('lock-dot').className = `dot lock ${lock === 'exact' || lock === 'locked' ? 'ok' : lock === 'estimated' ? 'wait' : 'bad'}`;
  $('lock-dot').title = lock === 'none' ? 'not lined up: catches are off' : `lined up (${lock})`;

  const playing = !!(live && live.playing);
  $('play').textContent = playing ? '■' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('play').classList.toggle('playing', playing);
  $('play').disabled = !live || !live.output;
  $('loop').setAttribute('aria-pressed', String(!!t.loop.on));
  $('loop').disabled = !(t.loop.out > t.loop.in);
  const heard = live ? live.heard : 0;
  $('position').textContent = live ? `${barBeat(heard, t.grid) || ''} ${fmtSecs(heard, sr)}${live.output ? '' : ' · no output'}` : '';

  renderSources();
  renderPasses();
  const canCatch = live && live.aligned !== 'none';
  $('catch-pass').disabled = !canCatch || !(live.cycles || []).length;
  for (const b of $('catch-bars').querySelectorAll('button')) b.disabled = !canCatch || !t.grid;
  drawLanes();
  drawOverview();
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
    b.addEventListener('click', () => doCatch({ pass: k }));
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
      lane.name.addEventListener('click', () => { state.track = n; render(); });
      lane.bus.addEventListener('click', () => patch({ track: { n, bus: track(n).bus === 'A' ? 'B' : 'A' } }));
      lane.mute.addEventListener('click', () => patch({ track: { n, mute: !track(n).mute } }));
      lane.solo.addEventListener('click', () => patch({ track: { n, solo: !track(n).solo } }));
      lane.gain.addEventListener('input', () => { lane.gain.dataset.busy = '1'; });
      lane.gain.addEventListener('change', () => { delete lane.gain.dataset.busy; patch({ track: { n, gain_db: Number(lane.gain.value) } }); });
      lane.canvas.addEventListener('click', (e) => laneTap(lane, e));
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
      const nudge = Math.round(((c.nudge_ms || 0) / 1000) * t.sample_rate);
      const x0 = xOf(c.at + nudge, view, W), x1 = xOf(c.at + nudge + c.frames, view, W);
      if (x1 < 0 || x0 > W) continue;
      const top = 2 + Math.min(c.layer, 3) * 3, h = H - 4 - Math.min(c.layer, 3) * 3;
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
      lane.hits.push({ x0, x1, clip: c });
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
    apply(await api(`/api/tapes?${q()}`, { method: 'PATCH', body }));
    return true;
  } catch (e) {
    toast(`Could not change the tape: ${e.message}`, 'bad');
    return false;
  }
}

async function transport(action, extra = {}) {
  try {
    await api(`/api/tapes/transport?${q()}`, { method: 'POST', body: { action, ...extra } });
    setTimeout(poll, 150);
  } catch (e) {
    toast(e.message, 'bad');
  }
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
  const body = { track: state.track, source: state.source, ...what };
  try {
    const b = await api(`/api/tapes/catch?${q()}`, { method: 'POST', body });
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
    apply(await api(`/api/tapes/${redo ? 'redo' : 'undo'}?${q()}`, { method: 'POST' }));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function openClip(c) {
  state.clip = c;
  $('clip-title').textContent = `Clip on track ${state.track} · ${(c.frames / state.tape.sample_rate).toFixed(2)} s · ${c.source || ''}`;
  $('clip-gain').value = String(c.gain_db || 0);
  $('clip-gain-val').textContent = `${c.gain_db || 0} dB`;
  $('clip-nudge-val').textContent = `${c.nudge_ms || 0} ms`;
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
    const s = await api(`/api/tapes/load?id=${encodeURIComponent(id)}`, { method: 'POST' });
    state.id = id;
    state.tape = null;
    apply(s);
  } catch (e) {
    toast(`Could not load the tape: ${e.message}`, 'bad');
  }
}

async function openMenu() {
  const menu = $('tape-menu');
  if (!menu.hidden) { menu.hidden = true; return; }
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
  $('play').addEventListener('click', () => transport(state.live && state.live.playing ? 'stop' : 'play'));
  $('loop').addEventListener('click', () => patch({ loop: { on: !state.tape.loop.on } }));
  $('tape-undo').addEventListener('click', () => undoRedo(false));
  $('tape-redo').addEventListener('click', () => undoRedo(true));
  $('catch-pass').addEventListener('click', () => doCatch({ pass: 1 }));
  for (const b of $('catch-bars').querySelectorAll('button')) b.addEventListener('click', () => doCatch({ bars: Number(b.dataset.bars) }));
  $('tape-name').addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
  document.addEventListener('click', (e) => { if (!$('tape-menu').contains(e.target)) $('tape-menu').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('tape-menu').hidden = true;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoRedo(e.shiftKey); }
      return;
    }
    if (e.key === ' ' && !e.target.closest?.('button, a, [tabindex]')) { e.preventDefault(); $('play').click(); }
  });
  $('tape-new').addEventListener('click', () => { $('tape-menu').hidden = true; newTape(); });
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
  new ResizeObserver(() => { drawLanes(); drawOverview(); }).observe($('lanes'));
}

boot();
