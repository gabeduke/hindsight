// web/static/lib/buffer/buffer.js
// GRAB, and a cue clip's drawer (docs/architecture/tape.md, The cue lane;
// the-studio-on-one-screen.md, step 5). GRAB on the feed copies the last N
// bars (or a span dragged across the feed) off the ring onto the cue lane,
// as a clip with a lane per input and its handles; the drawer opens on it
// in the dock above the bar -- a sheet over the lanes on a phone -- and the
// lanes fold to strips to make room. Holding a clip on the lane opens it
// too. There it's trimmed, auditioned on this device, then dropped on a
// lane (dragged there, or ↵ at the next free span on the armed track), kept
// as a take, or tossed. A tap on the clip still launches it.
//
// The Studio (lib/rooms/studio.js) mounts it, so it exists only with the
// two rooms on. It knows the tape from the page's `hindsight:tape-state`
// event, hears a held clip from the lane's `hindsight:cue-select`, says
// which is open with `hindsight:cue-selected`, asks the page to look again
// with `hindsight:tape-changed`, and draws on the lanes only in a layer of
// its own (lanes.js). Everything it holds is the tape's, on the Pi: a
// reload, or another device, sees the same clip.

import * as api from './api.js';
import { Audition } from './audition.js';
import { drawWindow, levelsOf, frameOf, xOf, fadeHandles, RULER_H, FADE_BOX } from './draw.js';
import {
  grabKey, grabSeconds, dropKey, clampWindow, gridOf, snapNear, edgeStep,
  bufferLines, bufferMeta, bufferNote, boardKey, spanWords, chipsFor, grabTitle, overwritten,
} from './model.js';
import { boardOf, clipOn, grabbedWords } from './cueclip.js';
import { bindBufferKeys } from './keys.js';
import { keyState, windowFrames, pulledTo } from './state.js';
import { setOpen, setFold } from './fold.js';
import { Overlay, Lift, boxesFor } from './lanes.js';
import { SNAPS, FADE_SHAPES } from '../tape/geometry.js';
import { leftPct as axisPct, ageOf } from '../objects/ribbonmath.js';
import { token } from '../theme.js';
import { toast as defaultToast } from '../toast.js';
import { restoreTake } from '../trash.js';
import { takeBack } from '../rooms/keep.js';
import { takeTitle } from '../rooms/takename.js';
import { named } from '../rooms/words.js';
import { followLoop, readPick, writePick, readSource, writeSource } from '../rooms/grab.js';
import { splitKey, barTop } from '../ui/menu.js';
import { layersOf } from '../ui/layers.js';
import { keepLabel, bufferKeepLength } from '../rooms/keeplabel.js';
import { recallNote, raiseUndo } from './replaced.js';
import { GESTURE } from '../ui/press.js';

const HOLD_MS = GESTURE.HOLD.lift; // a held sheet grip lifts the buffer onto a lane
const MOVE_PX = GESTURE.SLOP_FINE_PX;
const EDGE_PX = 12;    // how near IN or OUT a press takes the mark
const SOURCES = ['main', 'ch1', 'ch2', 'aux'];
// A GRAB made away from the Studio leaves the clip to open on here (replaced.js).
const pageStorage = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

/**
 * mountBuffer puts GRAB in the feed's keys (keysRow), the drawer in the dock
 * above the bar (ctx.dockSlot; after the feed without a shell), and GRAB on
 * the ribbon's selection bar, then drives them. The Studio hands it its feed
 * and the feed's row of keys. It returns null without them.
 */
export function mountBuffer(doc = document, { feed, keysRow, ribbon = null, toast = defaultToast, storage = pageStorage(), ctx = null } = {}) {
  const tpl = (id) => doc.getElementById(id)?.content;
  if (!keysRow || !feed || !tpl('buffer-panel-tpl') || !tpl('buffer-grab-tpl')) return null;
  keysRow.prepend(tpl('buffer-grab-tpl').cloneNode(true));
  const drawer = tpl('buffer-panel-tpl').cloneNode(true).children[0];
  if (ctx?.dockSlot) ctx.dockSlot.add(drawer);
  else feed.after(drawer);
  // GRAB, then KEEP: the selection's two verbs.
  doc.getElementById('rb-sel')?.querySelector('.rb-sel-save')?.before(tpl('buffer-sel-tpl').cloneNode(true));

  // The drawer's own keys by id, found in it wherever the dock has it.
  const $ = (id) => drawer.querySelector(`#${id}`) || doc.getElementById(id);
  const body = doc.body;
  // GRAB leads the feed's keys, at every width (the feed is a strip,
  // docs/plan/the-studio-on-one-screen.md); how much it takes, and from
  // which input, is on its ▾.
  const grabRow = keysRow.querySelector('.buffer-grab');
  const el = {
    panel: drawer,
    sheetGrip: drawer.querySelector('.buffer-sheet-grip'),
    title: drawer.querySelector('#buffer-title'),
    meta: drawer.querySelector('#buffer-meta'),
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
    loop: $('buffer-loop'),
    keepLen: $('buffer-keep-len'),
    toss: $('buffer-toss'),
    gain: $('buffer-gain'),
    gainVal: $('buffer-gain-val'),
    normalize: $('buffer-normalize'),
    reverse: $('buffer-reverse'),
    fades: $('buffer-fades'),
    fadesShape: $('buffer-fades-shape'),
    picks: grabRow.querySelector('.buffer-bars'),
    unit: grabRow.querySelector('.buffer-grab-unit'),
    feedSources: grabRow.querySelector('.buffer-feed-sources'),
    grab: grabRow.querySelector('.buffer-grab-key'),
    grabWord: grabRow.querySelector('.buffer-grab-word'),
    grabN: grabRow.querySelector('.buffer-grab-n'),
    grabFrom: grabRow.querySelector('.buffer-grab-from'),
    grabMore: grabRow.querySelector('.buffer-grab-more'),
    grabPop: grabRow.querySelector('.buffer-grab-pop'),
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
  const audition = new Audition({ url: (key) => api.audioURL(tapeId(), st.sel, key), onChange: () => { render(); tickPlayhead(); } });

  const st = {
    sel: '',          // the cue clip the drawer is open on (its id), or ''
    board: null,      // that clip, as a board (cueclip.js boardOf)
    clip: null,       // ... and as the tape has it
    answer: null,     // the tape as the Pi last answered a change, until the page's next look
    detail: null,     // the tape page's last hindsight:tape-state
    noted: false,     // a GRAB made away from the Studio has been looked for
    open: false,      // the buffer is showing
    dropped: '',      // a buffer just dropped (its created): ↵ drops it again further on, for a moment
    droppedAt: 0,     // when
    unfolded: false,  // UNFOLD: the lanes have their height back, the buffer stays
    n: readPick() ?? 4,    // the feed's 1 / 2 / 4 / 8: it starts at the tape's loop in bars (rooms/grab.js)
    loopBars: null,   // the loop N last followed
    keeps: '',        // what K keeps from here, as the instrument's pad last heard it
    chosen: null,     // the sources picked by hand; null follows the armed track's input
    chosenSource: readSource(storage) || null, // feed source picked by hand
    grabbing: false,
    local: null,      // the window or the fades while a mark is held: {in, out, fadeIn, fadeOut}
    lastDrop: null,   // {tape, clip, created, seen}: undo puts it back in hand
    pending: 0,       // changes on their way
    chain: Promise.resolve(), // edits go one after another
  };

  const sr = () => st.detail?.tape?.sample_rate || 48000;
  const grabOf = () => st.board?.grab || null;
  const snapPer = () => (SNAPS.find((s) => s.id === (st.detail?.snap || 'bar')) || SNAPS[0]).per;
  const changed = () => doc.dispatchEvent(new CustomEvent('hindsight:tape-changed'));
  const tapeNow = () => st.answer || st.detail?.tape || null;
  const tapeId = () => tapeNow()?.id || '';
  // Bringing the drawer forward -- a grab of this page's own, or a clip held
  // on the lane -- asks the instrument strip (lib/play/strip.js), if there is
  // one, to give way: the two take turns. Nothing listens with Play mode off.
  // (The bench was the buffer's panel; the event is named for it so the strip
  // need not use a buffer- class, which only this directory may: styles.test.js.)
  const forward = () => doc.dispatchEvent(new CustomEvent('hindsight:bench-forward'));
  // What K keeps from here, for the instrument's KEEP pad (lib/play/strip.js).
  // Said when it changes, and again on each poll for a strip that mounted later.
  const announceKeeps = () => doc.dispatchEvent(new CustomEvent('hindsight:keeps', { detail: { buffer: st.keeps } }));

  // --- the clip ------------------------------------------------------------------

  let said = '';
  // takeClip reads the clip the drawer is on from the tape: a clip gone
  // from the lane -- tossed, undone, on another device -- closes it.
  function takeClip() {
    const clip = clipOn(tapeNow(), st.sel);
    if (st.sel && !clip && tapeNow()) { st.sel = ''; st.open = false; }
    st.clip = clip;
    st.board = boardOf(clip);
    if (!st.open) audition.stop();
    else if (audition.playing && st.board) audition.play(boardKey(st.board)).catch(() => audition.stop());
    const now = st.open ? st.sel : '';
    onStack(!!now);
    if (now !== said) {
      said = now;
      doc.dispatchEvent(new CustomEvent('hindsight:cue-selected', { detail: { id: now } }));
    }
    render();
  }

  // The drawer is a drawer on the page's stack (lib/ui/layers.js): Back or
  // Escape closes it, as ✕ does.
  const layers = ctx?.layers || layersOf(doc);
  let layer = null;
  function onStack(on) {
    if (on && !layer?.open) {
      // Closed from outside (Escape, Back, a switch of rooms): put it away.
      // Closed by the drawer itself it is already away, and keeps what a
      // drop left for ↵.
      layer = layers?.open({ el: drawer, kind: 'drawer', onClose: () => { layer = null; if (st.open) select(''); } }) || null;
    } else if (!on && layer?.open) {
      const l = layer;
      layer = null;
      l.close();
    }
  }

  // select opens the drawer on a clip on the lane ('' closes it).
  function select(id) {
    st.sel = id || '';
    st.open = !!id;
    st.dropped = '';
    st.local = null;
    takeClip();
    if (id) forward();
  }

  // The tape's Undo: a GRAB's, a drop's, a toss's. `then` reopens the
  // drawer on what it brought back.
  function undoTape(then = '') {
    const id = tapeId();
    return api.undo(id)
      .then((b) => {
        if (b?.tape) st.answer = b.tape;
        changed();
        if (then) select(then);
        else takeClip();
      })
      .catch((e) => toast(`Could not undo: ${e.message}`, 'bad'));
  }

  // send runs a change, one at a time, and takes the tape it answers with.
  function send(run) {
    st.pending++;
    const p = st.chain.then(async () => {
      try {
        const b = await run();
        if (b && b.tape) st.answer = b.tape;
        changed();
        takeClip();
        return b;
      } finally {
        st.pending--;
      }
    });
    st.chain = p.catch(() => {});
    return p;
  }

  // --- GRAB ------------------------------------------------------------------------

  function sources() {
    const d = st.detail;
    const names = d && d.sources && d.sources.length ? d.sources.map((s) => s.name) : SOURCES;
    const pref = st.chosenSource && names.includes(st.chosenSource) ? st.chosenSource : null;
    const armed = d && d.rec_input && names.includes(d.rec_input) ? d.rec_input : names.includes('main') ? 'main' : names[0];
    const def = pref || armed;
    return (st.chosen || [def]).filter((n) => names.includes(n));
  }

  // again takes the open clip's span again from other inputs, if it can.
  function again(next) {
    const g = grabOf();
    if (!g || g.take || g.stale || !st.sel) return;
    send(() => api.grab(tapeId(), { clip: st.sel, sources: next }))
      .catch((e) => toast(`Could not take ${named(next.join(' + '))}: ${e.message}`, 'bad'));
  }

  // pickFeedSource picks the input GRAB takes from, by hand; '' goes back
  // to following the armed track's.
  function pickFeedSource(name) {
    st.chosenSource = name || null;
    writeSource(name || '', storage);
    st.chosen = null;
    const next = sources();
    st.chosen = next;
    again(next);
    render();
  }

  async function grab(req, what) {
    if (st.grabbing) return;
    const id = tapeId();
    if (!id) { toast('Load a tape first: GRAB lands on its cue lane', 'warn'); return; }
    st.dropped = '';
    st.grabbing = true;
    render();
    forward();
    try {
      const b = await send(() => api.grab(id, { ...req, sources: sources() }));
      const clip = b.edit?.cue_clip;
      if (clip) select(clip.id);
      const note = bufferNote(st.board);
      const g = clip?.grab;
      const kind = g && (g.wall || g.clamped) ? 'warn' : 'ok';
      const replaced = b.edit?.cue_replaced;
      if (replaced) {
        // Short, for the Undo to be seen: the drawer's own note line says the rest.
        raiseUndo(toast, grabbedWords(what, b.edit), kind, () => undoTape(replaced.id));
      } else {
        toast(`${grabbedWords(what, b.edit)}${note ? ` — ${note}` : ''}`, kind);
      }
    } catch (e) {
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
    if (g && (g.take || g.stale)) return; // its sources can't change
    const now = g ? g.sources : sources();
    const next = now.includes(name) ? now.filter((n) => n !== name) : [...now, name];
    if (!next.length) return; // a clip has a lane at least
    st.chosen = next;
    if (next.length === 1) {
      st.chosenSource = next[0];
      writeSource(next[0], storage);
    }
    if (!g) { render(); return; }
    again(next);
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
    send(() => api.trim(tapeId(), st.sel, to.in, to.out))
      .catch((e) => toast(`Could not move it: ${e.message}`, 'bad'))
      .finally(() => { if (st.local && st.local.in === to.in && st.local.out === to.out) { st.local = null; render(); } });
  }

  function shape(fields, done) {
    send(() => api.shape(tapeId(), st.sel, fields))
      .then(() => done && toast(done, 'ok'))
      .catch((e) => toast(`Could not change it: ${e.message}`, 'bad'));
  }

  // --- DROP ----------------------------------------------------------------------

  // `long`: a part longer than the loop, which DROP started at the loop's In
  // and which runs past its Out; `fitted`: DROP moved it back to fit the
  // tape. The toast says so.
  function dropAt(track, at, { long = false, fitted = false } = {}) {
    const b = st.board, tape = tapeNow();
    if (!b || !tape) return;
    const clip = st.sel;
    const count = b.tracks.length;
    const frames = windowFrames(st);
    // A drag can land over a clip, and the Pi lays the buffer over it: the
    // toast says so, with its Undo, rather than leaving a trimmed clip to be found.
    const over = overwritten(tape, { first: track, count, at, frames, board: b }).clips;
    const where = `${spanWords(tape.grid, at, frames, tape.sample_rate)}${long ? ' · runs past the loop' : ''}${fitted ? ' · moved back to fit the tape' : ''}${over ? ' · replaced what was under it' : ''}`;
    send(() => api.drop(tape.id, clip, track, at))
      .then((r) => {
        st.dropped = b.created;
        st.droppedAt = performance.now();
        st.open = false;
        st.lastDrop = { tape: tape.id, clip: r.clip && r.clip.id, created: b.created, seen: false };
        audition.stop();
        takeClip();
        // The lanes unfold first; then the window flies from where the
        // drawer was down to the new block, which glows once, where it is --
        // on a phone, where its lane is brought into sight.
        const from = el.win.getBoundingClientRect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (sheetMode()) doc.querySelectorAll('#lanes > .tape-track')[track - 1]?.scrollIntoView({ block: 'center' }); // clear of the docked bar
          overlay.fly(from.width ? from : null, boxesFor(doc, { track, count, at, frames, view: st.detail?.view }), { reduced: reducedMotion() });
        }));
        const what = count > 1 ? `tracks ${track}–${track + count - 1}` : `track ${track}`;
        toast(`Dropped on ${what} · ${where}`, 'ok', { action: { label: 'Undo', run: undoDrop } });
      })
      .catch((e) => toast(`Could not drop it: ${e.message}`, 'bad'));
  }

  // drop is ↵ and the DROP key: the armed track (with several armed, the
  // first), at the next bar line inside the loop, over what is there.
  function drop() {
    const b = st.board, d = st.detail, tape = tapeNow();
    // Nothing while a grab is on its way: the span would be the old one's.
    if (!b || !d || !tape || st.grabbing) return;
    const k = dropKey({ tape, armed: d.rec_track, armedAll: d.rec_tracks, count: b.tracks.length, frames: windowFrames(st), pos: d.pos, board: b });
    if (!k.can) { toast(`${k.word}: ${k.sub}`, 'warn', 7000); return; }
    dropAt(k.track, k.at, { long: k.long, fitted: k.fitted });
  }

  // Undo of a drop: the tape steps back, and the clip is back in hand.
  function undoDrop() {
    const t = st.lastDrop;
    if (!t) return;
    undoTape(t.created).then(() => { st.lastDrop = null; });
  }

  function backInHand() {
    const t = st.lastDrop;
    st.lastDrop = null;
    if (t && clipOn(tapeNow(), t.created)) select(t.created);
    else render();
  }

  // --- Loop ---------------------------------------------------------------------------

  // Loop: whether a launch plays the clip round and round, or once. cue-set
  // writes every field it's given: the clip goes whole.
  function loop() {
    const c = st.clip;
    if (!c) return;
    send(() => api.edit(tapeId(), 'cue-set', { cue_clip: { ...c, loop: !c.loop } }))
      .catch((e) => toast(`Could not change it: ${e.message}`, 'bad'));
  }

  // --- KEEP and TOSS ----------------------------------------------------------------

  function keepTake() {
    if (!st.board) return;
    send(() => api.keep(tapeId(), st.sel))
      .then((k) => {
        toast(`Kept “${named(k.label)}” as a take: it’s on the Listening Room’s shelf`, 'ok', {
          actions: [
            { label: 'Name it', run: () => {
              const url = `/takes.html?take=${encodeURIComponent(k.name)}`;
              if (ctx?.go) ctx.go(url);
              else location.assign(url);
            } },
            { label: 'Undo', run: () => untake(k.name, k.label) },
          ],
        });
      })
      .catch((e) => toast(`Could not keep it: ${e.message}`, 'bad'));
  }

  async function untake(name, label) {
    try { await takeBack(name); } catch (e) { toast(`Could not undo it: ${e.message}`, 'bad'); return; }
    toast(`Took back ${named(takeTitle({ name, label }, { day: true }))}: it’s in Recently deleted`, 'ok', {
      action: { label: 'Restore', run: () => restoreTake(name).then(() => toast('Restored, starred')).catch((e) => toast(`Could not restore: ${e.message}`, 'bad')) },
    });
  }

  function toss() {
    if (!st.board) return;
    const id = st.sel, name = st.clip?.name;
    audition.stop();
    send(() => api.edit(tapeId(), 'cue-remove', { clip: id }))
      .then(() => toast(`Tossed ${named(name || 'the part')} off the cue lane`, 'ok', {
        action: { label: 'Undo', run: () => undoTape(id) },
      }))
      .catch((e) => toast(`Could not toss it: ${e.message}`, 'bad'));
  }

  function close() {
    select('');
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
    // The audition's playhead, green as its key's lamp (and the feed's, in the bar).
    play: token('--go', '#6faa32'), mono: token('--mono', 'monospace'), font: token('--font', 'sans-serif'),
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
    const lanes = clips.map((cl) => ({ levels: levelsFor(cl, g, cols), name: g.take ? grabTitle(g) : cl.source, gain: 10 ** ((cl.gain_db || 0) / 20) }));
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

  // placeMark shades the open clip's span on the ribbon.
  function placeMark() {
    const g = grabOf();
    const ax = ribbon && ribbon.axis && ribbon.axis();
    // A clip grabbed before a restart isn't anywhere on this feed.
    // Nor is one grabbed from a take.
    if (!st.open || !g || g.stale || g.take || !ax || !viz) { mark.hidden = true; return; }
    const w = win();
    const buffered = ribbon.data?.buffered_seconds ?? ax.T;
    const fromAge = Math.min(ageOf(g.ring_from + w.in, ax.total, ax.sr), buffered);
    const toAge = Math.min(ageOf(g.ring_from + w.out, ax.total, ax.sr), buffered);
    const l = axisPct(fromAge, ax.A, ax.T), rr = axisPct(toAge, ax.A, ax.T);
    if (fromAge >= buffered && toAge >= buffered) { mark.hidden = true; return; }
    mark.hidden = false;
    mark.style.left = `${l.toFixed(2)}%`;
    mark.style.width = `${Math.max(0.6, rr - l).toFixed(2)}%`;
    const what = g.bars ? `${g.bars} bar${g.bars === 1 ? '' : 's'}` : `${(st.board.frames / sr()).toFixed(1)} s`;
    mark.firstChild.textContent = `Grabbed · ${what} · ${g.sources.join(' + ')}`;
  }

  // --- rendering ---------------------------------------------------------------------

  function render() {
    const b = st.board, g = grabOf(), d = st.detail;
    const open = st.open && (!!g || st.grabbing);
    const active = !ctx || ctx.active();
    setOpen(body, active && open);
    setFold(body, active && open && !st.unfolded);
    el.panel.hidden = !open;
    // GRAB on the feed: its words follow the tempo, and the picker its N.
    const hasGrid = !!d?.tape?.grid;
    const k = grabKey(st.n, hasGrid);
    el.grabWord.textContent = st.grabbing ? 'Grabbing…' : k.word;
    // The key says how much, and from which input: its ▾ is where they change.
    el.grabN.textContent = st.grabbing || !hasGrid ? '' : ` ${st.n} bar${st.n === 1 ? '' : 's'}`;
    const following = !st.chosenSource;
    if (el.grabFrom) el.grabFrom.textContent = st.grabbing ? '' : `from ${sources().join(' + ')}${following ? ' · armed' : ''}`;
    el.grab.setAttribute('aria-label', st.grabbing ? 'Grabbing' : k.label);
    el.grab.disabled = st.grabbing;
    for (const btn of el.picks.children) {
      const m = Number(btn.dataset.n);
      btn.textContent = k.pick(m);
      btn.setAttribute('aria-pressed', String(m === st.n));
    }
    el.unit.textContent = k.unit;
    el.unit.hidden = !k.unit;
    if (el.feedSources) {
      // The armed track's input first, then each input by name.
      const tapeSources = [{ name: '', label: 'Armed track' }, ...(d?.sources?.length ? d.sources : SOURCES.map((name) => ({ name })))];
      const activeSrcs = sources();
      if (el.feedSources.childElementCount !== tapeSources.length ||
          [...el.feedSources.children].some((c, i) => c.dataset.source !== tapeSources[i].name)) {
        el.feedSources.replaceChildren(...tapeSources.map((s) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.dataset.source = s.name;
          btn.textContent = s.label || s.name;
          btn.addEventListener('click', () => pickFeedSource(s.name));
          return btn;
        }));
      }
      tapeSources.forEach((s, i) => {
        const btn = el.feedSources.children[i];
        btn.setAttribute('aria-pressed', String(s.name ? !following && activeSrcs.includes(s.name) : following));
        btn.disabled = st.grabbing;
      });
    }
    if (el.grabSel) el.grabSel.disabled = st.grabbing;
    // KEEP names what it keeps: the window, in bars when there is a tempo.
    // K keeps it while the buffer is open, so the instrument's pad says so.
    const keepLen = g ? bufferKeepLength({ frames: windowFrames(st), barFrames: g.bar_frames, sampleRate: sr() }) : '';
    const keeps = open && g && !st.grabbing ? keepLen : '';
    if (keeps !== st.keeps) {
      st.keeps = keeps;
      announceKeeps();
    }
    if (!open) { placeMark(); return; }

    const rate = sr();
    // Its name, as the lane's pad says it.
    el.title.textContent = st.clip?.name || 'Cue';
    const winBoard = b && { ...b, frames: windowFrames(st) };
    const meta = st.grabbing && !g ? `grabbing the last ${hasGrid ? `${st.n} bar${st.n === 1 ? '' : 's'}` : `${grabSeconds(st.n)} s`}…` : g ? bufferMeta(winBoard, rate) : '';
    // A phone's line is shorter: no tempo, so the close key fits beside it.
    el.metaFull.textContent = meta;
    el.metaShort.textContent = g && !st.grabbing ? meta.split(' · ').slice(0, 2).join(' · ') : meta;
    const note = st.grabbing ? 'copying it off the feed: the bar after it is still being played' : bufferNote(b);
    el.note.textContent = note;
    el.note.hidden = !note;
    // The sources: a chip each, lit with signal; the buffer's own pressed.
    // A grab of a take's span has the take alone, fixed (chipsFor).
    const tapeSources = d?.sources?.length ? d.sources : SOURCES.map((name) => ({ name }));
    const chips = chipsFor(g, tapeSources.map((x) => x.name), sources());
    if (el.sources.childElementCount !== chips.length || [...el.sources.children].some((c, i) => c.dataset.name !== chips[i].name)) {
      el.sources.replaceChildren(...chips.map((ch) => {
        const c = doc.createElement('button');
        c.type = 'button';
        c.className = 'chip buffer-source';
        c.dataset.name = ch.name;
        c.innerHTML = '<span class="buffer-source-led" aria-hidden="true"></span><span class="buffer-source-name"></span>';
        c.lastChild.textContent = ch.label;
        if (!ch.name.startsWith('take:')) c.addEventListener('click', () => toggleSource(ch.name));
        return c;
      }));
    }
    chips.forEach((ch, i) => {
      const c = el.sources.children[i];
      const s = tapeSources.find((x) => x.name === ch.name);
      c.setAttribute('aria-pressed', String(ch.on));
      c.classList.toggle('signal', !!s && typeof s.peak_db === 'number' && s.peak_db > -50);
      c.disabled = st.grabbing || ch.fixed; // a take's own sound, or a span in a ring that's gone
    });
    // DROP: where ↵ would put it.
    const dk = g && d && d.tape ? dropKey({ tape: d.tape, armed: d.rec_track, armedAll: d.rec_tracks, count: b.tracks.length, frames: windowFrames(st), pos: d.pos, board: b }) : { word: 'Drop', sub: '', can: false };
    el.dropWord.textContent = dk.word;
    el.dropSub.textContent = dk.sub;
    el.drop.disabled = !dk.can || st.grabbing;
    el.keep.disabled = !g || st.grabbing;
    el.keepLen.textContent = keepLen;
    el.keep.setAttribute('aria-label', keepLabel(keepLen));
    el.toss.disabled = !g || st.grabbing;
    el.loop.setAttribute('aria-pressed', String(!!st.clip?.loop));
    el.loop.disabled = !st.clip || st.grabbing;
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
    const g = grabOf();
    lift = new Lift({
      doc, overlay, get: liftGet,
      label: `${g.take ? grabTitle(g) : g.sources.join(' + ')} · ${bufferMeta(st.board, sr())}`,
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
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!reducedQuery?.matches;
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
      // Pulled right down it is a peek still: it never closes (✕ does), so a
      // pull to see the lanes doesn't lose the buffer.
      el.panel.dataset.height = pulledTo(f);
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
  // GRAB's ▾: how much, and from which input, in a panel under the pair
  // (lib/ui/menu.js), on the Studio's stack of open things. A pick leaves it
  // open for the next; GRAB, a press elsewhere, Escape or Back closes it.
  // From a keyboard it opens on the bars chosen.
  if (el.grabMore && el.grabPop) splitKey(el.grab, el.grabMore, el.grabPop, { layers, doc, focus: 'checked', floor: barTop(doc) });
  el.grabSel?.addEventListener('click', grabSpan);
  for (const btn of el.picks.children) {
    btn.addEventListener('click', () => { st.n = Number(btn.dataset.n); writePick(st.n); render(); });
  }
  el.close.addEventListener('click', close);
  el.unfold.addEventListener('click', () => { st.unfolded = !st.unfolded; render(); });
  // The ruler's own snap, stepped on by the Studio (lib/tape/page.js), which
  // says it back in the detail: ⌗'s View menu sets the same one.
  el.snap.addEventListener('click', () => doc.dispatchEvent(new CustomEvent('hindsight:snap-next')));
  el.drop.addEventListener('click', drop);
  el.keep.addEventListener('click', keepTake);
  el.loop.addEventListener('click', loop);
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
  const onDoc = (type, fn, opts) => (ctx ? ctx.on(doc, type, fn, opts) : doc.addEventListener(type, fn, opts));
  const every = (fn, ms) => (ctx ? ctx.every(fn, ms) : setInterval(fn, ms));

  onDoc('keydown', (e) => { if (e.key === 'Escape' && lift) { e.preventDefault(); e.stopPropagation(); lift.end(false); } }, true);
  // ↵ drops it again only straight after a drop: any other key, or a press
  // anywhere, lets that go (state.js, HELD_MS, lets it go after a moment too).
  onDoc('keydown', (e) => { if (e.code !== 'Enter' && e.code !== 'NumpadEnter') st.dropped = ''; }, true);
  onDoc('pointerdown', () => { st.dropped = ''; }, true);

  bindBufferKeys(doc, {
    active: () => !ctx || ctx.active(),
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
  onDoc('hindsight:verb', (e) => {
    switch (e.detail?.verb) {
      case 'grab': grabBars(); e.preventDefault(); break;
      case 'drop': if (grabOf()) { drop(); e.preventDefault(); } break;
      case 'keep': if (st.open && grabOf() && !st.grabbing) { keepTake(); e.preventDefault(); } break;
      default:
    }
  });

  // The tape, as the page polls it. A drop undone -- by the toast, or by
  // ⌘Z on the page -- puts the clip back in hand.
  onDoc('hindsight:tape-state', (e) => {
    st.detail = e.detail || null;
    // The page has looked since the last change answered: its tape is newer.
    if (!st.pending) st.answer = null;
    // GRAB starts at the loop's length, and follows it.
    Object.assign(st, followLoop(st, st.detail?.tape));
    const t = st.lastDrop, tape = st.detail?.tape;
    if (t && tape && tape.id === t.tape && t.clip) {
      const there = tape.tracks.some((tr) => tr.clips.some((c) => c.id === t.clip));
      if (there) t.seen = true;
      else if (t.seen) backInHand();
    }
    if (openNoted()) return;
    takeClip();
    announceKeeps(); // again, for a pad that mounted later
  });
  // A GRAB made away from the Studio -- a take's, a note's, the bar's --
  // opens its clip here, once, and says what it took the place of: once
  // the Studio is shown, as a view mounted out of sight closes its drawers
  // when it goes quiet (lib/shell/view.js). The bar's GRAB comes back to a
  // Studio already mounted, so every show looks again.
  function openNoted() {
    const tape = st.detail?.tape;
    if (st.noted || !tape || (ctx && !ctx.active())) return false;
    st.noted = true;
    const n = recallNote(storage);
    if (!n || !clipOn(tape, n.by)) return false;
    select(n.by);
    if (n.line) raiseUndo(toast, n.line, 'ok', () => undoTape());
    return true;
  }
  // A clip held on the lane opens here (lib/tape/cuelane.js).
  onDoc('hindsight:cue-select', (e) => select(e.detail?.id || ''));
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => draw()).observe(el.win);
  every(() => { if (st.open && !doc.hidden) placeMark(); }, 1000);
  onDoc('visibilitychange', () => { if (doc.hidden) audition.stop(); });
  render();
  return {
    state: st,
    render,
    hide() {
      st.noted = false; // the next show looks for a GRAB made meanwhile
      audition.stop();
      lift?.end(false);
      setOpen(body, false);
      setFold(body, false);
    },
    show() {
      if (!openNoted()) render();
    },
  };
}
