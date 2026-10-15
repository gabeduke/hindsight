// web/static/lib/buffer/buffer.js
// The Studio's buffer (docs/superpowers/specs/2026-10-15-studio-buffer-design.md):
// the clipboard, made visible. GRAB on the feed copies the last N bars (or
// a span dragged across the feed) off the ring into it; the buffer opens
// between the feed and the lanes -- a sheet over them on a phone -- and the
// lanes fold to strips to make room. There it's trimmed, auditioned on this
// device, then dropped on a lane (dragged there, or ↵ at the next free span
// on the armed track), kept as a take, or tossed.
//
// The Studio (lib/rooms/studio.js) mounts it, so it exists only with the
// two rooms on. It knows the tape from the page's `hindsight:tape-state`
// event, asks the page to look again with `hindsight:tape-changed` and
// `hindsight:clipboard`, and draws on the lanes only in a layer of its own
// (lanes.js). Everything it holds is the Pi's: a reload, or another device,
// sees the same buffer.

import * as api from './api.js';
import { Audition } from './audition.js';
import { drawWindow, levelsOf, frameOf, xOf, fadeHandles, RULER_H, FADE_BOX } from './draw.js';
import {
  BAR_PICKS, grabKey, grabSeconds, dropKey, clampWindow, gridOf, snapNear, edgeStep,
  bufferLines, bufferMeta, bufferNote, boardKey, spanWords,
} from './model.js';
import { bindBufferKeys } from './keys.js';
import { keyState, windowFrames, takesPoll } from './state.js';
import { setOpen, setFold } from './fold.js';
import { Overlay, Lift, boxesFor } from './lanes.js';
import { SNAPS, FADE_SHAPES } from '../tape/geometry.js';
import { leftPct as axisPct, ageOf } from '../objects/ribbonmath.js';
import { token } from '../theme.js';
import { toast as defaultToast } from '../toast.js';
import { restoreTake } from '../trash.js';
import { takeBack } from '../rooms/keep.js';

const POLL_MS = 2000;
const HOLD_MS = 350;   // a held sheet grip lifts the buffer onto a lane
const MOVE_PX = 6;
const EDGE_PX = 12;    // how near IN or OUT a press takes the mark
const SOURCES = ['main', 'ch1', 'ch2', 'aux'];
const PICK_KEY = 'buffer.bars';

function readPick() {
  try { const n = Number(localStorage.getItem(PICK_KEY)); return BAR_PICKS.includes(n) ? n : 4; } catch { return 4; }
}
function writePick(n) { try { localStorage.setItem(PICK_KEY, String(n)); } catch { /* this session only */ } }

/**
 * mountBuffer puts GRAB in the feed's keys (keysRow), the buffer after the
 * feed, and GRAB on the ribbon's selection bar, then drives them. The
 * Studio hands it its feed and the feed's row of keys. It returns null
 * without them.
 */
export function mountBuffer(doc = document, { feed, head = null, keysRow, ribbon = null, toast = defaultToast } = {}) {
  const tpl = (id) => doc.getElementById(id)?.content;
  if (!keysRow || !feed || !tpl('buffer-panel-tpl') || !tpl('buffer-grab-tpl')) return null;
  keysRow.prepend(tpl('buffer-grab-tpl').cloneNode(true));
  feed.after(tpl('buffer-panel-tpl').cloneNode(true));
  doc.getElementById('rb-sel')?.querySelector('.rb-sel-copy')?.before(tpl('buffer-sel-tpl').cloneNode(true));

  const $ = (id) => doc.getElementById(id);
  const body = doc.body;
  const grabRow = keysRow.querySelector('.buffer-grab');
  // From 1100 px the feed's keys sit beside its heading, over the meters:
  // GRAB goes at the heading's end instead, so the ribbon keeps its width;
  // narrower, the keys have a row of their own, and GRAB leads it. Moved,
  // not reordered in CSS, so the tab order is the order on screen.
  if (head && typeof matchMedia === 'function') {
    const wide = matchMedia('(min-width: 1100px)');
    const place = () => (wide.matches ? head.append(grabRow) : keysRow.prepend(grabRow));
    wide.addEventListener('change', place);
    place();
  }
  const el = {
    panel: $('buffer'),
    notch: $('buffer').querySelector('.buffer-notch'),
    sheetGrip: $('buffer').querySelector('.buffer-sheet-grip'),
    meta: $('buffer-meta'),
    metaFull: doc.createElement('span'),
    metaShort: doc.createElement('span'),
    note: $('buffer-note'),
    sources: $('buffer-sources'),
    audition: $('buffer-audition'),
    snap: $('buffer-snap'),
    snapName: $('buffer-snap-name'),
    unfold: $('buffer-unfold'),
    close: $('buffer-close'),
    grip: $('buffer-grip'),
    win: $('buffer-window'),
    canvas: $('buffer-canvas'),
    drop: $('buffer-drop'),
    dropWord: $('buffer-drop-word'),
    dropSub: $('buffer-drop-sub'),
    keep: $('buffer-keep'),
    toss: $('buffer-toss'),
    gain: $('buffer-gain'),
    gainVal: $('buffer-gain-val'),
    normalize: $('buffer-normalize'),
    reverse: $('buffer-reverse'),
    fades: $('buffer-fades'),
    fadesShape: $('buffer-fades-shape'),
    picks: grabRow.querySelector('.buffer-bars'),
    unit: grabRow.querySelector('.buffer-grab-unit'),
    grab: grabRow.querySelector('.buffer-grab-key'),
    grabWord: grabRow.querySelector('.buffer-grab-word'),
    grabN: grabRow.querySelector('.buffer-grab-n'),
    reopen: grabRow.querySelector('.buffer-reopen'),
    grabSel: doc.querySelector('.buffer-grab-sel'),
  };
  el.metaFull.className = 'buffer-meta-full';
  el.metaShort.className = 'buffer-meta-short';
  el.meta.append(el.metaFull, el.metaShort);
  // The buffer's span, marked on the feed's ribbon.
  const viz = $('viz-wrap');
  const mark = doc.createElement('div');
  mark.className = 'buffer-mark';
  mark.hidden = true;
  mark.innerHTML = '<span class="buffer-mark-label"></span>';
  viz?.append(mark);

  const overlay = new Overlay(doc);
  const audition = new Audition({ onChange: () => { render(); tickPlayhead(); } });

  const st = {
    board: null,      // the clipboard, as the Pi has it
    detail: null,     // the tape page's last hindsight:tape-state
    seen: false,      // the first board has come
    open: false,      // the buffer is showing
    dropped: '',      // a buffer just dropped (its created): ↵ drops it again further on, for a moment
    droppedAt: 0,     // when
    unfolded: false,  // UNFOLD: the lanes have their height back, the buffer stays
    n: readPick(),    // the feed's 1 / 2 / 4 / 8
    chosen: null,     // the sources picked by hand; null follows the armed track's input
    grabbing: false,
    local: null,      // the window or the fades while a mark is held: {in, out, fadeIn, fadeOut}
    lastDrop: null,   // {tape, clip, created, seen}: undo puts it back in hand
    gen: 0,           // moves with every change sent, so a fetch from before it is dropped
    chain: Promise.resolve(), // edits go one after another
  };

  const sr = () => st.detail?.tape?.sample_rate || 48000;
  const grabOf = () => st.board?.grab || null;
  const snapPer = () => (SNAPS.find((s) => s.id === (st.detail?.snap || 'bar')) || SNAPS[0]).per;
  const hint = () => doc.dispatchEvent(new CustomEvent('hindsight:clipboard'));

  // --- the board -----------------------------------------------------------------

  /**
   * takeBoard takes a clipboard the Pi answered with. A new grab opens the
   * buffer (one already dropped or kept, seen on a reload, waits in the
   * crate's first slot instead); the same one keeps its state; anything
   * else closes it.
   */
  function takeBoard(b, { mine = false } = {}) {
    const prev = st.board;
    st.board = b && b.tracks && b.tracks.length ? b : null;
    const g = grabOf();
    if (!g) {
      st.open = false;
      st.dropped = '';
    } else if (mine || !prev || prev.created !== st.board.created) {
      st.open = mine || !g.used;
      st.dropped = '';
    }
    st.seen = true;
    if (!st.open) audition.stop();
    else if (audition.playing) audition.play(boardKey(st.board)).catch(() => audition.stop());
    render();
  }

  async function fetchBoard() {
    const g = st.gen;
    try {
      const b = await api.board();
      if (!takesPoll(st, g)) return; // a change went out meanwhile, a mark is held, or a grab is on its way
      takeBoard(b.clipboard || null);
    } catch { /* the tape page says when the Pi can't be reached */ }
  }

  // send runs a change, one at a time, and takes the board it answers with.
  function send(run, { mine = false } = {}) {
    st.gen++;
    const p = st.chain.then(async () => {
      const b = await run();
      st.gen++;
      if (b && 'clipboard' in b) takeBoard(b.clipboard, { mine });
      hint();
      // An unused buffer it replaced went to the crate: the crate shows it.
      if (b && b.crated && b.crated.length) doc.dispatchEvent(new CustomEvent('hindsight:crate-changed'));
      return b;
    });
    st.chain = p.catch(() => {});
    return p;
  }

  // --- GRAB ------------------------------------------------------------------------

  function sources() {
    const d = st.detail;
    const names = d && d.sources && d.sources.length ? d.sources.map((s) => s.name) : SOURCES;
    const armed = d && d.rec_input && names.includes(d.rec_input) ? d.rec_input : names.includes('main') ? 'main' : names[0];
    return (st.chosen || [armed]).filter((n) => names.includes(n));
  }

  async function grab(req, what) {
    if (st.grabbing) return;
    st.dropped = '';
    const wasOpen = st.open;
    st.grabbing = true;
    st.open = true;
    render();
    try {
      const b = await send(() => api.grab({ ...req, sources: sources() }), { mine: true });
      const notes = [];
      if (b.crated && b.crated.length) notes.push('the last buffer, never dropped, is in the crate');
      const note = bufferNote(b.clipboard);
      toast(`Grabbed ${what}${note ? ` — ${note}` : ''}${notes.length ? `; ${notes[0]}` : ''}`, b.wall || b.clamped ? 'warn' : 'ok');
    } catch (e) {
      st.open = wasOpen && !!grabOf();
      toast(`Could not grab: ${e.message}`, 'bad');
    } finally {
      st.grabbing = false;
      render();
    }
  }

  function grabBars() {
    const hasGrid = !!st.detail?.tape?.grid;
    const n = st.n;
    if (hasGrid) return grab({ bars: n }, `the last ${n} bar${n === 1 ? '' : 's'}`);
    return grab({ seconds: grabSeconds(n) }, `the last ${grabSeconds(n)} s`);
  }

  function grabSpan() {
    const sel = ribbon && ribbon.sel;
    if (!sel) return;
    const req = { ring_from: sel.from };
    if (sel.to != null) req.ring_to = sel.to;
    grab(req, 'that span of the feed').then(() => ribbon.setSel(null));
  }

  function toggleSource(name) {
    const g = grabOf();
    const now = g ? g.sources : sources();
    const next = now.includes(name) ? now.filter((n) => n !== name) : [...now, name];
    if (!next.length) return; // a buffer has a lane at least
    st.chosen = next;
    if (!g) { render(); return; }
    send(() => api.grab({ again: true, sources: next }))
      .catch((e) => toast(`Could not take ${name}: ${e.message}`, 'bad'));
  }

  // --- the window ----------------------------------------------------------------

  const win = () => {
    const g = grabOf();
    return st.local ? { in: st.local.in ?? g.in, out: st.local.out ?? g.out } : { in: g.in, out: g.out };
  };
  const firstClip = () => st.board.tracks.flat()[0] || {};

  // moveEdge steps IN or OUT one step of the snap, ahead of the Pi's answer.
  function moveEdge(edge, dir) {
    const g = grabOf();
    if (!g) return;
    const w = win();
    const next = edgeStep(gridOf(g, snapPer()), edge === 'in' ? w.in : w.out, dir, sr());
    const to = clampWindow(g, edge === 'in' ? next : w.in, edge === 'out' ? next : w.out, sr());
    trimTo(to);
  }

  function trimTo(to) {
    st.local = { ...st.local, in: to.in, out: to.out };
    render();
    send(() => api.trim(to.in, to.out))
      .catch((e) => toast(`Could not move it: ${e.message}`, 'bad'))
      .finally(() => { if (st.local && st.local.in === to.in && st.local.out === to.out) { st.local = null; render(); } });
  }

  function shape(fields, done) {
    send(() => api.shape(fields))
      .then(() => done && toast(done, 'ok'))
      .catch((e) => toast(`Could not change it: ${e.message}`, 'bad'));
  }

  // --- DROP ----------------------------------------------------------------------

  function dropAt(track, at) {
    const b = st.board, d = st.detail;
    if (!b || !d || !d.tape) return;
    const tape = d.tape;
    const count = b.tracks.length;
    const frames = windowFrames(st);
    const where = spanWords(tape.grid, at, frames, tape.sample_rate);
    send(() => api.drop(tape.id, track, at))
      .then((r) => {
        st.dropped = b.created;
        st.droppedAt = performance.now();
        st.open = false;
        st.lastDrop = { tape: tape.id, clip: r.clip && r.clip.id, created: b.created, seen: false };
        audition.stop();
        render();
        doc.dispatchEvent(new CustomEvent('hindsight:tape-changed'));
        // The lanes unfold first; then the new block glows once, where it
        // is -- on a phone, where its lane is brought into sight.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (sheetMode()) doc.querySelectorAll('#lanes > .tape-track')[track - 1]?.scrollIntoView({ block: 'center' }); // clear of the docked bar
          overlay.glow(boxesFor(doc, { track, count, at, frames, view: st.detail?.view || d.view }));
        }));
        const what = count > 1 ? `tracks ${track}–${track + count - 1}` : `track ${track}`;
        toast(`Dropped on ${what} · ${where}`, 'ok', { action: { label: 'Undo', run: undoDrop } });
      })
      .catch((e) => toast(`Could not drop it: ${e.message}`, 'bad'));
  }

  // drop is ↵ and the DROP key: the armed track, the next free span.
  function drop() {
    const b = st.board, d = st.detail;
    // Nothing while a grab is on its way: the span would be the old one's.
    if (!b || !d || !d.tape || st.grabbing) return;
    const k = dropKey({ tape: d.tape, armed: d.rec_track, count: b.tracks.length, frames: windowFrames(st), pos: d.pos });
    if (!k.can) { toast(`${k.word}: ${k.sub}`, 'warn'); return; }
    dropAt(d.rec_track, k.at);
  }

  // Undo of a drop: the tape steps back, and the buffer is back in hand.
  function undoDrop() {
    const t = st.lastDrop;
    if (!t) return;
    api.undo(t.tape)
      .then(() => {
        doc.dispatchEvent(new CustomEvent('hindsight:tape-changed'));
        backInHand();
      })
      .catch((e) => toast(`Could not undo: ${e.message}`, 'bad'));
  }

  function backInHand() {
    st.lastDrop = null;
    if (grabOf()) { st.open = true; st.dropped = ''; }
    render();
  }

  // --- KEEP and TOSS ----------------------------------------------------------------

  function keepTake() {
    if (!st.board) return;
    send(() => api.keep())
      .then((k) => {
        toast(`Kept “${k.label}” as a take: it’s on the Listening Room’s shelf`, 'ok', {
          actions: [
            { label: 'Name it', run: () => location.assign(`/takes.html?take=${encodeURIComponent(k.name)}`) },
            { label: 'Undo', run: () => untake(k.name) },
          ],
        });
        fetchBoard(); // it's used now
      })
      .catch((e) => toast(`Could not keep it: ${e.message}`, 'bad'));
  }

  async function untake(name) {
    try { await takeBack(name); } catch (e) { toast(`Could not undo it: ${e.message}`, 'bad'); return; }
    toast(`Took back ${name}: it’s in Recently deleted`, 'ok', {
      action: { label: 'Restore', run: () => restoreTake(name).then(() => toast('Restored, starred')).catch((e) => toast(`Could not restore: ${e.message}`, 'bad')) },
    });
  }

  function toss() {
    if (!st.board) return;
    audition.stop();
    send(() => api.toss())
      .then(() => toast('Tossed the buffer', 'ok', {
        action: {
          label: 'Undo',
          run: () => send(() => api.restore(), { mine: true }).catch((e) => toast(`Could not bring it back: ${e.message}`, 'bad')),
        },
      }))
      .catch((e) => toast(`Could not toss it: ${e.message}`, 'bad'));
  }

  function close() {
    st.open = false;
    audition.stop();
    render();
  }

  // --- drawing ---------------------------------------------------------------------

  const levels = new Map(); // pool file and width -> levels per column, or a pending promise
  function levelsFor(cl, g, cols) {
    const file = cl.reversed ? cl.reversed.file : cl.file; // drawn as it was played
    const F = g.before + g.frames + g.after;
    const key = `${file}|${cols}|${F}`;
    const got = levels.get(key);
    if (got && !(got instanceof Promise)) return got;
    if (!got) {
      levels.set(key, api.peaks(file, 0, F, cols)
        .then((pd) => { levels.set(key, levelsOf(pd)); draw(); })
        .catch(() => levels.set(key, null)));
    }
    return null;
  }

  let colors = null;
  const color = () => (colors ||= {
    oxide: token('--oxide', '#5b3a20'), oxideLo: token('--oxide-lo', '#4a2e19'),
    trace: token('--trace', '#f6e7c4'), grease: token('--grease-mark', '#f0c419'),
    label: token('--oxide-label', '#cdb894'), tick: token('--oxide-tick', 'rgba(255,236,210,.35)'),
    ruler: token('--oxide-ruler', '#1d1209'), shade: 'rgba(0,0,0,.55)', fade: token('--trace-hot', '#fff8e8'),
    play: token('--ok', '#2fb37a'), mono: token('--mono', 'monospace'), font: token('--font', 'sans-serif'),
  });

  function draw() {
    const g = grabOf();
    const cv = el.canvas;
    const r = cv.getBoundingClientRect();
    if (!st.open || r.width <= 0 || r.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!g) {
      ctx.clearRect(0, 0, r.width, r.height);
      ctx.fillStyle = color().oxideLo;
      ctx.fillRect(0, RULER_H, r.width, r.height - RULER_H);
      return;
    }
    const cols = Math.max(16, Math.min(4096, Math.round(r.width)));
    const clips = st.board.tracks.map((tr) => tr[0]).filter(Boolean);
    const lanes = clips.map((cl) => ({ levels: levelsFor(cl, g, cols), name: cl.source, gain: 10 ** ((cl.gain_db || 0) / 20) }));
    // Quiet audio drawn big enough to see, as the lanes draw it.
    let peak = 0;
    for (const l of lanes) if (l.levels) for (const v of l.levels) peak = Math.max(peak, v);
    const lift = peak > 0 ? Math.min(8, Math.max(1, 0.9 / peak)) : 1;
    for (const l of lanes) l.gain *= lift;
    const c = firstClip();
    const w = win();
    const fades = { in: st.local?.fadeIn ?? c.fade_in ?? 0, out: st.local?.fadeOut ?? c.fade_out ?? 0 };
    const at = audition.at();
    let playAt = null;
    if (at != null) playAt = g.reversed ? w.out - at * sr() : w.in + at * sr();
    drawWindow(ctx, {
      W: r.width, H: r.height, lo: -g.before, hi: g.frames + g.after, frames: g.frames,
      lanes, lines: bufferLines(g), win: w, fades, playAt, colors: color(), grabbing: st.grabbing,
    });
  }

  let playRaf = 0;
  function tickPlayhead() {
    if (playRaf || !audition.playing) return;
    const step = () => {
      playRaf = 0;
      if (!audition.playing || !st.open) { draw(); return; }
      draw();
      playRaf = requestAnimationFrame(step);
    };
    playRaf = requestAnimationFrame(step);
  }

  // placeMark shades the buffer's span on the ribbon, and points the
  // bench's notch at it.
  function placeMark() {
    const g = grabOf();
    const ax = ribbon && ribbon.axis && ribbon.axis();
    // A buffer grabbed before a restart isn't anywhere on this feed.
    if (!st.open || !g || g.stale || !ax || !viz) { mark.hidden = true; el.notch.hidden = true; return; }
    const w = win();
    const buffered = ribbon.data?.buffered_seconds ?? ax.T;
    const fromAge = Math.min(ageOf(g.ring_from + w.in, ax.total, ax.sr), buffered);
    const toAge = Math.min(ageOf(g.ring_from + w.out, ax.total, ax.sr), buffered);
    const l = axisPct(fromAge, ax.A, ax.T), rr = axisPct(toAge, ax.A, ax.T);
    if (fromAge >= buffered && toAge >= buffered) { mark.hidden = true; el.notch.hidden = true; return; }
    mark.hidden = false;
    mark.style.left = `${l.toFixed(2)}%`;
    mark.style.width = `${Math.max(0.6, rr - l).toFixed(2)}%`;
    const what = g.bars ? `${g.bars} bar${g.bars === 1 ? '' : 's'}` : `${(st.board.frames / sr()).toFixed(1)} s`;
    mark.firstChild.textContent = `Grabbed · ${what} · ${g.sources.join(' + ')}`;
    const vr = viz.getBoundingClientRect(), pr = el.panel.getBoundingClientRect();
    const cx = vr.left + ((l + rr) / 200) * vr.width;
    el.notch.hidden = false;
    el.notch.style.left = `${Math.min(Math.max(16, cx - pr.left), pr.width - 16)}px`;
  }

  // --- rendering ---------------------------------------------------------------------

  function render() {
    const b = st.board, g = grabOf(), d = st.detail;
    const open = st.open && (!!g || st.grabbing);
    setOpen(body, open);
    setFold(body, open && !st.unfolded);
    el.panel.hidden = !open;
    // GRAB on the feed: its words follow the tempo, and the picker its N.
    const hasGrid = !!d?.tape?.grid;
    const k = grabKey(st.n, hasGrid);
    el.grabWord.textContent = st.grabbing ? 'Grabbing…' : k.word;
    // Where the picker is out of sight (a phone, the buffer open), the key says how much.
    el.grabN.textContent = st.grabbing || !hasGrid ? '' : ` ${st.n} bar${st.n === 1 ? '' : 's'}`;
    el.grab.setAttribute('aria-label', st.grabbing ? 'Grabbing' : k.label);
    el.grab.disabled = st.grabbing;
    for (const btn of el.picks.children) {
      const m = Number(btn.dataset.n);
      btn.textContent = k.pick(m);
      btn.setAttribute('aria-pressed', String(m === st.n));
    }
    el.unit.textContent = k.unit;
    el.unit.hidden = !k.unit;
    el.reopen.hidden = open || !g;
    if (el.grabSel) el.grabSel.disabled = st.grabbing;
    if (!open) { placeMark(); return; }

    const rate = sr();
    const winBoard = b && { ...b, frames: windowFrames(st) };
    const meta = st.grabbing && !g ? `grabbing the last ${hasGrid ? `${st.n} bar${st.n === 1 ? '' : 's'}` : `${grabSeconds(st.n)} s`}…` : g ? bufferMeta(winBoard, rate) : '';
    // A phone's line is shorter: no tempo, so the close key fits beside it.
    el.metaFull.textContent = meta;
    el.metaShort.textContent = g && !st.grabbing ? meta.split(' · ').slice(0, 2).join(' · ') : meta;
    const note = st.grabbing ? 'copying it off the ring: the bar after it is still being played' : bufferNote(b);
    el.note.textContent = note;
    el.note.hidden = !note;
    // The sources: a chip each, lit with signal; the buffer's own pressed.
    const names = d?.sources?.length ? d.sources : SOURCES.map((name) => ({ name }));
    const on = g ? g.sources : sources();
    if (el.sources.childElementCount !== names.length || [...el.sources.children].some((c, i) => c.dataset.name !== names[i].name)) {
      el.sources.replaceChildren(...names.map((s) => {
        const c = doc.createElement('button');
        c.type = 'button';
        c.className = 'chip buffer-source';
        c.dataset.name = s.name;
        c.innerHTML = '<span class="buffer-source-led" aria-hidden="true"></span><span class="buffer-source-name"></span>';
        c.lastChild.textContent = s.name;
        c.addEventListener('click', () => toggleSource(s.name));
        return c;
      }));
    }
    names.forEach((s, i) => {
      const c = el.sources.children[i];
      c.setAttribute('aria-pressed', String(on.includes(s.name)));
      c.classList.toggle('signal', typeof s.peak_db === 'number' && s.peak_db > -50);
      c.disabled = st.grabbing || !!g?.stale; // its span is in a ring that's gone
    });
    // DROP: where ↵ would put it.
    const dk = g && d && d.tape ? dropKey({ tape: d.tape, armed: d.rec_track, count: b.tracks.length, frames: windowFrames(st), pos: d.pos }) : { word: 'Drop', sub: '', can: false };
    el.dropWord.textContent = dk.word;
    el.dropSub.textContent = dk.can ? `${dk.sub}, the next free span · ↵` : dk.sub;
    el.drop.disabled = !dk.can || st.grabbing;
    el.keep.disabled = !g || st.grabbing;
    el.toss.disabled = !g || st.grabbing;
    for (const id of ['in-back', 'in-on', 'out-back', 'out-on']) $(`buffer-${id}`).disabled = !g || st.grabbing;
    const c = g ? firstClip() : {};
    if (!el.gain.dataset.held) el.gain.value = String(c.gain_db || 0);
    el.gainVal.textContent = `${(c.gain_db || 0) >= 0 ? '+' : ''}${(c.gain_db || 0).toFixed(1)} dB`;
    el.reverse.setAttribute('aria-pressed', String(!!g?.reversed));
    el.fadesShape.textContent = (FADE_SHAPES.find((f) => f.id === (c.fade_in_shape || '')) || FADE_SHAPES[0]).label.toLowerCase();
    for (const x of [el.gain, el.normalize, el.reverse, el.fades]) x.disabled = !g || st.grabbing;
    const snap = SNAPS.find((s) => s.id === (d?.snap || 'bar')) || SNAPS[0];
    el.snapName.textContent = snap.label;
    el.snap.disabled = !hasGrid;
    el.unfold.setAttribute('aria-pressed', String(st.unfolded));
    el.unfold.lastChild.textContent = st.unfolded ? ' ▴' : ' ▾';
    el.unfold.firstChild.textContent = st.unfolded ? 'Fold' : 'Unfold';
    el.audition.setAttribute('aria-pressed', String(audition.playing));
    el.audition.disabled = !g || st.grabbing;
    draw();
    placeMark();
  }

  // --- the window's marks, by hand -------------------------------------------------------

  // A press near IN or OUT holds that mark; near a fade's square, that fade.
  function wireCanvas() {
    const cv = el.canvas;
    let hold = null;
    const geo = () => {
      const g = grabOf();
      const r = cv.getBoundingClientRect();
      return { g, r, lo: -g.before, hi: g.frames + g.after };
    };
    cv.addEventListener('pointerdown', (e) => {
      const g = grabOf();
      if (!g || st.grabbing || e.button > 0) return;
      const { r, lo, hi } = geo();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const w = win(), c = firstClip();
      const fh = fadeHandles({ lo, hi, W: r.width, win: w, fadeIn: c.fade_in || 0, fadeOut: c.fade_out || 0 });
      const near = (p) => Math.abs(x - p.x) <= FADE_BOX && y <= p.y + FADE_BOX + 6;
      if (near(fh.in)) hold = { what: 'fadeIn' };
      else if (near(fh.out)) hold = { what: 'fadeOut' };
      else {
        const dIn = Math.abs(x - xOf(w.in, lo, hi, r.width)), dOut = Math.abs(x - xOf(w.out, lo, hi, r.width));
        if (Math.min(dIn, dOut) > EDGE_PX * (e.pointerType === 'touch' ? 2 : 1)) return;
        hold = { what: dIn <= dOut ? 'in' : 'out' };
      }
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* gone */ }
      st.local = { in: w.in, out: w.out, fadeIn: c.fade_in || 0, fadeOut: c.fade_out || 0 };
      body.classList.add('buffer-holding');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!hold) {
        // A pointer over a mark says it can be held.
        const g = grabOf();
        if (!g || e.pointerType !== 'mouse') return;
        const { r, lo, hi } = geo();
        const x = e.clientX - r.left;
        const w = win();
        const nearEdge = Math.min(Math.abs(x - xOf(w.in, lo, hi, r.width)), Math.abs(x - xOf(w.out, lo, hi, r.width))) <= EDGE_PX;
        cv.classList.toggle('buffer-at-mark', nearEdge);
        return;
      }
      const g = grabOf();
      const { r, lo, hi } = geo();
      const f = frameOf(e.clientX - r.left, lo, hi, r.width);
      const grid = e.shiftKey ? null : gridOf(g, snapPer());
      if (hold.what === 'in' || hold.what === 'out') {
        const at = snapNear(grid, f);
        const to = clampWindow(g, hold.what === 'in' ? at : st.local.in, hold.what === 'out' ? at : st.local.out, sr());
        st.local = { ...st.local, ...to };
      } else {
        const len = st.local.out - st.local.in;
        const v = hold.what === 'fadeIn' ? f - st.local.in : st.local.out - f;
        st.local = { ...st.local, [hold.what]: Math.round(Math.min(Math.max(0, v), len)) };
      }
      render();
    });
    const let_ = (commit) => {
      if (!hold) return;
      const h = hold;
      hold = null;
      body.classList.remove('buffer-holding');
      const l = st.local;
      if (!commit) { st.local = null; render(); return; }
      if (h.what === 'in' || h.what === 'out') { trimTo({ in: l.in, out: l.out }); return; }
      st.local = null;
      shape({ fade_in: l.fadeIn, fade_out: l.fadeOut });
      // Shown as let go until the Pi answers.
      const c = firstClip();
      c.fade_in = l.fadeIn;
      c.fade_out = l.fadeOut;
      render();
    };
    cv.addEventListener('pointerup', () => let_(true));
    cv.addEventListener('pointercancel', () => let_(false));
  }

  // --- dragging it onto a lane --------------------------------------------------------------

  let lift = null;
  const liftGet = () => ({ tape: st.detail?.tape, view: st.detail?.view, snap: st.detail?.snap || 'bar', board: st.board && { ...st.board, frames: windowFrames(st) } });
  function startLift(x, y) {
    if (!grabOf() || st.grabbing || lift) return;
    const phone = sheetMode();
    const was = el.panel.dataset.height;
    if (phone) el.panel.dataset.height = 'peek'; // the lanes come out from under it
    lift = new Lift({
      doc, overlay, get: liftGet,
      label: `${grabOf().sources.join(' + ')} · ${bufferMeta(st.board, sr())}`,
      onDrop: ({ track, at }) => dropAt(track, at),
      onEnd: () => { lift = null; if (phone) el.panel.dataset.height = was; },
    });
    lift.move(x, y);
    try { navigator.vibrate?.(10); } catch { /* no haptics */ }
  }

  function wireGrip() {
    let press = null;
    el.grip.addEventListener('pointerdown', (e) => {
      if (!grabOf() || e.button > 0) return;
      e.preventDefault();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { el.grip.setPointerCapture(e.pointerId); } catch { /* gone */ }
    });
    el.grip.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!lift && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) startLift(e.clientX, e.clientY);
      else if (lift) lift.move(e.clientX, e.clientY);
    });
    el.grip.addEventListener('pointerup', (e) => { press = null; lift?.end(true); void e; });
    el.grip.addEventListener('pointercancel', () => { press = null; lift?.end(false); });
  }

  // On a phone the buffer is a sheet: its grip pulls it up or down to the
  // inspector's three heights -- peek, half, full -- and held, then dragged,
  // lifts the buffer onto a lane.
  const sheetQuery = typeof matchMedia === 'function'
    ? matchMedia('(orientation: landscape) and (max-height: 440px), (max-width: 699.98px)') : null;
  const sheetMode = () => !!sheetQuery?.matches;
  function wireSheet() {
    const grip = el.sheetGrip;
    let drag = null, dragged = false;
    grip.addEventListener('pointerdown', (e) => {
      dragged = false;
      drag = { id: e.pointerId, y: e.clientY, x: e.clientX, h: el.panel.getBoundingClientRect().height, moved: false, lifted: false };
      try { grip.setPointerCapture(e.pointerId); } catch { /* gone */ }
      drag.timer = setTimeout(() => {
        if (drag && !drag.moved && grabOf()) { drag.lifted = true; startLift(drag.x, drag.y); }
      }, HOLD_MS);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.lifted) { lift?.move(e.clientX, e.clientY); return; }
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > MOVE_PX) { drag.moved = true; clearTimeout(drag.timer); }
      if (drag.moved) el.panel.style.height = `${Math.max(64, Math.round(drag.h - dy))}px`;
    });
    grip.addEventListener('pointerup', () => {
      if (!drag) return;
      clearTimeout(drag.timer);
      const d = drag;
      drag = null;
      if (d.lifted) { dragged = true; lift?.end(true); return; }
      if (!d.moved) return; // a tap: the click below
      dragged = true;
      const f = el.panel.getBoundingClientRect().height / innerHeight;
      el.panel.style.height = '';
      // Pulled right down, it closes: the buffer waits in the crate's first slot.
      if (f < 0.12) { close(); return; }
      el.panel.dataset.height = f < 0.25 ? 'peek' : f < 0.62 ? 'half' : 'full';
      requestAnimationFrame(draw);
    });
    grip.addEventListener('pointercancel', () => {
      if (drag) clearTimeout(drag.timer);
      if (drag?.lifted) lift?.end(false);
      drag = null;
      el.panel.style.height = '';
    });
    grip.addEventListener('click', () => {
      if (dragged) { dragged = false; return; }
      el.panel.dataset.height = el.panel.dataset.height === 'half' ? 'full' : 'half';
      requestAnimationFrame(draw);
    });
  }

  // --- wiring ------------------------------------------------------------------------------

  // A click doesn't take the page's keys to the buffer's keys: ↵ and ⌫ stay
  // the page's -- the buffer's -- as on the tape page's action bar.
  for (const root of [el.panel, grabRow]) {
    root.addEventListener('mousedown', (e) => { if (e.target.closest('button') && !e.target.closest('.buffer-sheet-grip')) e.preventDefault(); });
  }
  el.grab.addEventListener('click', grabBars);
  el.grabSel?.addEventListener('click', grabSpan);
  el.reopen.addEventListener('click', () => { st.open = true; st.dropped = ''; render(); });
  for (const btn of el.picks.children) {
    btn.addEventListener('click', () => { st.n = Number(btn.dataset.n); writePick(st.n); render(); });
  }
  el.close.addEventListener('click', close);
  el.unfold.addEventListener('click', () => { st.unfolded = !st.unfolded; render(); });
  el.snap.addEventListener('click', () => $('snap-btn')?.click()); // the ruler's own snap
  el.drop.addEventListener('click', drop);
  el.keep.addEventListener('click', keepTake);
  el.toss.addEventListener('click', toss);
  $('buffer-in-back').addEventListener('click', () => moveEdge('in', -1));
  $('buffer-in-on').addEventListener('click', () => moveEdge('in', 1));
  $('buffer-out-back').addEventListener('click', () => moveEdge('out', -1));
  $('buffer-out-on').addEventListener('click', () => moveEdge('out', 1));
  el.gain.addEventListener('pointerdown', () => { el.gain.dataset.held = '1'; });
  el.gain.addEventListener('input', () => {
    const v = Number(el.gain.value);
    el.gainVal.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
  });
  el.gain.addEventListener('change', () => { delete el.gain.dataset.held; shape({ gain_db: Number(el.gain.value) }); });
  el.normalize.addEventListener('click', () => shape({ normalize: true }, 'Normalized: its loudest moment just under full scale'));
  el.reverse.addEventListener('click', () => shape({ reverse: true }, grabOf()?.reversed ? 'Playing forwards' : 'Reversed'));
  el.fades.addEventListener('click', () => {
    const c = firstClip();
    const i = FADE_SHAPES.findIndex((f) => f.id === (c.fade_in_shape || ''));
    const next = FADE_SHAPES[(i + 1) % FADE_SHAPES.length].id;
    shape({ fade_in_shape: next, fade_out_shape: next });
  });
  el.audition.addEventListener('click', () => {
    if (audition.playing) { audition.stop(); return; }
    audition.play(boardKey(st.board)).catch((e) => { audition.stop(); toast(`Could not play it here: ${e.message}`, 'bad'); });
  });
  wireCanvas();
  wireGrip();
  wireSheet();
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lift) { e.preventDefault(); e.stopPropagation(); lift.end(false); } }, true);
  // ↵ drops it again only straight after a drop: any other key, or a press
  // anywhere, lets that go (state.js, HELD_MS, lets it go after a moment too).
  doc.addEventListener('keydown', (e) => { if (e.code !== 'Enter' && e.code !== 'NumpadEnter') st.dropped = ''; }, true);
  doc.addEventListener('pointerdown', () => { st.dropped = ''; }, true);

  bindBufferKeys(doc, {
    state: () => keyState(st, performance.now(), !!doc.querySelector('#multi-bar:not([hidden])')),
    run: (a) => {
      switch (a) {
        case 'grab': grabBars(); break;
        case 'in-back': moveEdge('in', -1); break;
        case 'in-on': moveEdge('in', 1); break;
        case 'out-back': moveEdge('out', -1); break;
        case 'out-on': moveEdge('out', 1); break;
        case 'drop': drop(); break;
        case 'keep': keepTake(); break;
        case 'toss': toss(); break;
        default:
      }
    },
  });

  // The Studio's verbs from the instrument strip (lib/play): its pads, its
  // keys while it has the keyboard, and a controller plugged into this
  // computer. GRAB and DROP are the buffer's; KEEP is too while it's open
  // (claimed with preventDefault, so the Studio doesn't also keep the feed).
  doc.addEventListener('hindsight:verb', (e) => {
    switch (e.detail?.verb) {
      case 'grab': grabBars(); e.preventDefault(); break;
      case 'drop': if (grabOf()) { drop(); e.preventDefault(); } break;
      case 'keep': if (st.open && grabOf() && !st.grabbing) { keepTake(); e.preventDefault(); } break;
      default:
    }
  });

  // The tape, as the page polls it. A drop undone -- by the toast, or by
  // ⌘Z on the page -- puts the buffer back in hand.
  doc.addEventListener('hindsight:tape-state', (e) => {
    st.detail = e.detail || null;
    const t = st.lastDrop, tape = st.detail?.tape;
    if (t && tape && tape.id === t.tape && t.clip) {
      const there = tape.tracks.some((tr) => tr.clips.some((c) => c.id === t.clip));
      if (there) t.seen = true;
      else if (t.seen && st.board?.created === t.created) backInHand();
    }
    render();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => draw()).observe(el.win);
  setInterval(() => { if (!doc.hidden) fetchBoard(); }, POLL_MS);
  setInterval(() => { if (st.open && !doc.hidden) placeMark(); }, 1000);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) fetchBoard(); else audition.stop(); });
  fetchBoard();
  render();
  return { state: st, render };
}
