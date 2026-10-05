// web/static/lib/wave/view.js
// The take page's editing canvas. It paints from state it is handed and turns
// gestures into events; the page owns the take. It owns one piece of state
// of its own, the viewport {start, fpp, width}.
//
// The canvas is three zones, so gestures never compete (see the editing
// model spec, "One set of gestures"):
//
//   ruler   top half: flag pins -- tap one to open it, drag to move it.
//           bottom half: bar numbers (or seconds), the playhead handle ▾ to
//           scrub silently, and bar 1 to drag the downbeat.
//   body    the waveform. A drag pans, always, inside the selection too; a
//           hold then a drag selects; a tap moves the playhead; two taps
//           add a flag.
//   grips   below the waveform: the In and Out grips at the selection's
//           ends, and the move handle between them, the only way to move a
//           whole selection, so it can't happen by accident.
//
// The pointer machinery is lib/edit/gestures.js, shared with the tape page.

import { frameToX, xToFrame, gridLines, rulerTicks, snapFrame, clampRegion } from './geometry.js';
import { levelsOfColumns, laneChannels, takeGain } from './draw.js';
import { drawTrace, traceLines, sliceLines, paintOxide, oxideColors } from './tape-strip.js';
import { GestureSurface } from '../edit/gestures.js';
import { withAlpha } from '../theme.js';
import { greaseStroke, labelPlaces } from './grease.js';
import { seamHalves } from './boundary.js';

export { HOLD_MS } from '../edit/gestures.js';

export const PIN_H = 16;     // the ruler's top half: flag pins
export const RULER_H = 36;   // the whole ruler
export const GRIP_H = 30;    // the strip under the waveform
const PIN_HIT = 12;          // px each side of a pin
const PLAYHEAD_HIT = 16;
const DOWNBEAT_HIT = 18;
const DOWNBEAT_LABEL = 7;    // the middle of bar 1's "1", right of its line
const GRIP_W = 22;           // a grip tab's width, outside the selection's edge
const GRIP_IN = 8;           // how far a grip's hit zone reaches inside it
const MOVE_W = 36;           // the move handle's width

export class WaveView extends GestureSurface {
  constructor({ canvas, tiles, totalFrames, sampleRate, getState, emit }) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tiles = tiles;
    this.total = totalFrames;
    this.sr = sampleRate;
    this.getState = getState;
    this.emit = emit;
    this.view = { start: 0, fpp: 1, width: 1 };
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = 0;
    this.cssH = 0;
    this.raf = 0;
    this.fitted = false;
    this.destroyed = false;
    this.minLen = Math.floor(sampleRate * 3 / 1000) * 2 + 1;
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(canvas);
    this.initGestures(canvas);
    this.resize();
  }

  destroy() {
    this.destroyed = true;
    this.destroyGestures();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.cssW = r.width; this.cssH = r.height;
    // A zero-width layout (a hidden panel) carries no information: keep the
    // viewport and wait for a real one, or maxFpp() goes infinite.
    if (r.width <= 0) return;
    this.view.width = r.width;
    if (!this.fitted) { this.fitted = true; this.fitAll(); } else { this.clampView(); }
    this.draw();
  }

  changed() { this.emit('viewChange', { view: { ...this.view } }); this.draw(); }

  draw() {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  // --- zones ---------------------------------------------------------------
  bodyTop() { return RULER_H; }
  bodyBottom() { return Math.max(RULER_H + 1, this.cssH - GRIP_H); }

  /** The move handle shows only when the selection has room for it between the grips. */
  moveHandleShown(x0, x1) { return x1 - x0 >= MOVE_W + 2 * GRIP_IN + 8; }

  hit(x, y, st = this.getState()) {
    const v = this.view;
    // The seam view is two halves, not one continuous view: the body is the
    // only target, and which half decides the side the encoders move. Pins,
    // the playhead, the downbeat and the grips are not hit-tested.
    if (st.edit?.seam && st.region) {
      if (y >= RULER_H && y < this.bodyBottom()) return { kind: 'seam', side: x < this.cssW / 2 ? 'end' : 'start' };
      return { kind: 'seamOff' };
    }
    if (y < PIN_H) {
      let best = null;
      for (const f of st.flags || []) {
        const d = Math.abs(x - frameToX(f.frame, v));
        if (d <= PIN_HIT && (!best || d < best.d)) best = { f, d };
      }
      if (best) return { kind: 'pin', grab: true, flag: best.f };
      return { kind: 'ruler' };
    }
    if (y < RULER_H) {
      // The playhead's handle is centred on its line; bar 1's target is its
      // "1", just right of the line. Both open at frame 0, so neither may
      // simply win: the nearer target does, and the playhead on a tie.
      let best = null;
      if (st.cursor != null) {
        const d = Math.abs(x - frameToX(st.cursor, v));
        if (d <= PLAYHEAD_HIT) best = { kind: 'playhead', grab: true, d };
      }
      if (st.grid.bpm) {
        const bx = frameToX(st.grid.downbeat, v);
        if (x >= bx - DOWNBEAT_HIT / 2 && x <= bx + DOWNBEAT_HIT + 8) {
          const d = Math.abs(x - (bx + DOWNBEAT_LABEL));
          if (!best || d < best.d) best = { kind: 'downbeat', grab: true, d };
        }
      }
      if (best) { delete best.d; return best; }
      return { kind: 'ruler' };
    }
    if (y >= this.bodyBottom()) {
      if (st.region) {
        const x0 = frameToX(st.region.start, v), x1 = frameToX(st.region.end, v);
        const mid = (x0 + x1) / 2;
        // The grips sit just outside the selection's ends, so even a selection
        // a pixel wide keeps two separate tabs to hold. Their reach inside
        // overlaps on a narrow one; the side of the middle decides.
        const inStart = x >= x0 - GRIP_W - 4 && x <= x0 + GRIP_IN;
        const inEnd = x >= x1 - GRIP_IN && x <= x1 + GRIP_W + 4;
        if (inStart && inEnd) return { kind: 'grip', grab: true, edge: x < mid ? 'start' : 'end' };
        if (inStart) return { kind: 'grip', grab: true, edge: 'start' };
        if (inEnd) return { kind: 'grip', grab: true, edge: 'end' };
        if (this.moveHandleShown(x0, x1) && Math.abs(x - mid) <= MOVE_W / 2 + 4) return { kind: 'move', grab: true };
      }
      // Below the waveform: a hold still selects, but two taps don't flag.
      return { kind: 'body', select: true, strip: true };
    }
    return { kind: 'body', select: true };
  }

  snapX(x) {
    const st = this.getState();
    return Math.max(0, Math.min(this.total, snapFrame(xToFrame(x, this.view), st.grid, st.snap)));
  }

  // --- grabs ----------------------------------------------------------------
  grabStart(h, p) {
    const st = this.getState();
    switch (h.kind) {
      case 'pin': return { what: 'pin', flag: h.flag, prev: h.flag.frame, grabOffset: p.x - frameToX(h.flag.frame, this.view) };
      // The take goes quiet only once the handle actually moves (grabMove), so
      // a press that is cancelled or released still leaves it playing.
      case 'playhead': return { what: 'playhead', prev: st.cursor, grabOffset: p.x - frameToX(st.cursor, this.view), scrubbing: false };
      case 'downbeat': return { what: 'downbeat', prev: st.grid.downbeat, grabOffset: p.x - frameToX(st.grid.downbeat, this.view) };
      case 'grip': return { what: 'grip', edge: h.edge, region: { ...st.region }, grabOffset: p.x - frameToX(st.region[h.edge], this.view) };
      case 'move': return { what: 'move', region: { ...st.region } };
      default: return null;
    }
  }

  grabMove(g, p) {
    const st = this.getState();
    const at = (x) => Math.max(0, Math.min(this.total, snapFrame(xToFrame(x, this.view), st.grid, st.snap)));
    switch (g.what) {
      case 'pin':
        g.frame = Math.min(this.total - 1, at(p.x - g.grabOffset));
        this.emit('flagMove', { flag: g.flag, frame: g.frame, final: false });
        break;
      case 'playhead':
        if (!g.scrubbing) { g.scrubbing = true; this.emit('scrubStart', {}); }
        this.emit('scrub', { frame: Math.max(0, Math.min(this.total - 1, xToFrame(p.x - g.grabOffset, this.view))) });
        break;
      case 'downbeat': this.emit('downbeatChange', { frame: Math.max(0, Math.min(this.total - 1, xToFrame(p.x - g.grabOffset, this.view))), final: false }); break;
      case 'grip': {
        const f = at(p.x - g.grabOffset);
        const r = { ...g.region, [g.edge]: f };
        if (g.edge === 'start') r.start = Math.min(r.start, r.end - this.minLen);
        else r.end = Math.max(r.end, r.start + this.minLen);
        this.emit('regionChange', { region: clampRegion(r, this.total, this.minLen), final: false });
        break;
      }
      case 'move': {
        const len = g.region.end - g.region.start;
        // Snap where the selection's start lands, and keep its length.
        let start = at(frameToX(g.region.start, this.view) + g.dx);
        start = Math.max(0, Math.min(this.total - len, start));
        this.emit('regionChange', { region: { start, end: start + len }, final: false });
        break;
      }
      default: break;
    }
  }

  grabEnd(g, p, tap) {
    const st = this.getState();
    switch (g.what) {
      case 'pin': {
        // By id, and to where the finger left it: the page may have swapped
        // its flag list for the server's answer mid-drag, and g.flag would
        // then be a stale copy holding the old frame.
        const f = (st.flags || []).find((x) => x.id === g.flag.id) || g.flag;
        if (tap) this.emit('selectFlag', { flag: f });
        else if (g.moved) this.emit('flagMove', { flag: f, frame: g.frame ?? f.frame, final: true });
        break;
      }
      case 'playhead':
        // A still press on the handle changes nothing.
        if (g.scrubbing) this.emit('scrubEnd', { frame: st.cursor });
        break;
      case 'downbeat':
        // A still press on bar 1 opens it for editing (the boundary editor).
        if (g.moved) this.emit('downbeatChange', { frame: st.grid.downbeat, final: true });
        else this.emit('downbeatTap', {});
        break;
      case 'grip':
      case 'move':
        if (g.moved) this.emit('regionChange', { region: st.region, final: true });
        break;
      default: break;
    }
  }

  grabRollback(g) {
    switch (g.what) {
      case 'pin': this.emit('flagMove', { flag: g.flag, frame: g.prev, final: true }); break;
      case 'playhead': if (g.scrubbing) this.emit('scrubEnd', { frame: g.prev }); break;
      case 'downbeat': this.emit('downbeatChange', { frame: g.prev, final: true }); break;
      case 'grip':
      case 'move': this.emit('regionChange', { region: g.region, final: true }); break;
      default: break;
    }
  }

  // A tap moves the playhead (snapped); the second of two taps on the
  // waveform adds a flag there.
  tapAt(p, h, double) {
    if (h.kind === 'seam') { this.emit('seamSide', { side: h.side }); return; }
    if (h.kind === 'seamOff') return;
    const frame = this.snapX(p.x);
    if (double && h.kind === 'body' && !h.strip) this.emit('addFlag', { frame: Math.min(this.total - 1, frame) });
    else this.emit('seek', { frame });
  }

  // --- painting ---------------------------------------------------------------
  // paintBody draws the grid lines and the take's trace for v into the
  // canvas strip [x0, x0 + v.width), clipped to it: once for the whole
  // view, or once for each half of the seam view. The seam view's halves can
  // reach before the take's first frame or past its last (a loop shorter than
  // half the screen): inTake leaves that stretch empty tape, with no grid
  // lines and no trace. (The columns there are already zero, never NaN.)
  paintBody(v, x0, top, bottom, col, st, inTake = false) {
    const { ctx, dpr } = this;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, top, v.width, bottom - top); ctx.clip();
    ctx.translate(x0, 0);
    // Beat and bar lines in the body.
    for (const g of gridLines(v, st.grid)) {
      if (inTake && (g.frame < 0 || g.frame > this.total)) continue;
      const x = frameToX(g.frame, v);
      ctx.fillStyle = g.bar ? col('--well-rule', 'rgba(242,230,200,.14)') : withAlpha(col('--well-ink', '#f2e6c8'), 0.07);
      ctx.fillRect(Math.round(x), top, 1, bottom - top);
    }

    // The take as a trace on the tape (lib/wave/tape-strip.js), on its own
    // scale: levels from the tiles, scaled by the take's peak (takeGain, once
    // per file), the same scale as its cassette on the takes page. A stereo
    // take is two lanes, left above right; the part played is lit.
    const { cols, channels } = this.tiles.columns(v, dpr);
    this.gain ??= takeGain(this.tiles.filePeaks);
    const laneCh = laneChannels(channels);
    const lanes = laneCh.length;
    const laneH = (bottom - top) / lanes;
    const edge = col('--oxide-edge', '#23150b');
    ctx.save();
    const tx0 = inTake ? Math.max(0, frameToX(0, v)) : 0;
    const tx1 = inTake ? Math.min(v.width, frameToX(this.total, v)) : v.width;
    ctx.beginPath(); ctx.rect(tx0, top, Math.max(0, tx1 - tx0), bottom - top); ctx.clip();
    if (lanes === 2) { ctx.fillStyle = edge; ctx.fillRect(0, top + laneH - 1.25, v.width, 2.5); }
    const glow = col('--trace-glow', 'rgba(255,226,170,.75)');
    const cx = st.cursor != null ? frameToX(st.cursor, v) : 0;
    for (let i = 0; i < lanes; i++) {
      const lv = levelsOfColumns(cols, channels, laneCh[i]);
      const opts = { cy: top + laneH * (i + 0.5), half: laneH / 2 - 7, gain: this.gain };
      // Worked out once; the lit pass draws only the part played.
      const lines = traceLines(lv, lv, opts);
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawTrace(ctx, null, null, { ...opts, lines, line: col('--trace', '#f6e7c4'), glow: [{ color: withAlpha(glow, 0.25), blur: 3 }] });
      ctx.restore();
      if (cx > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, top, cx, bottom - top); ctx.clip();
        drawTrace(ctx, null, null, {
          ...opts, lines: sliceLines(lines, cx), line: col('--trace-hot', '#fff8e8'), fillAlpha: 0.14, width: 1.3,
          glow: [{ color: glow, blur: 2 }, { color: withAlpha(glow, 0.35), blur: 8 }],
        });
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  paint() {
    const { ctx, view, dpr } = this;
    const st = this.getState();
    const W = this.cssW, H = this.cssH;
    if (!W || !H) return;
    const css = getComputedStyle(this.canvas);
    const col = (name, fb) => css.getPropertyValue(name).trim() || fb;
    const top = this.bodyTop(), bottom = this.bodyBottom();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // The take on tape: brown oxide between a dark ruler and grip strip.
    ctx.fillStyle = col('--oxide-ruler', '#1d1209');
    ctx.fillRect(0, 0, W, H);
    // The oxide doesn't change with the view: painted once per size into a
    // cache (its three gradients are most of a frame's cost where the canvas
    // is drawn on the CPU), then copied.
    const bodyH = bottom - top;
    const okey = `${W}x${bodyH}@${dpr}`;
    if (this.oxideKey !== okey) {
      this.oxide ||= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      this.oxide.width = Math.max(1, Math.round(W * dpr));
      this.oxide.height = Math.max(1, Math.round(bodyH * dpr));
      const octx = this.oxide.getContext('2d');
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintOxide(octx, W, bodyH, oxideColors(col));
      this.oxideKey = okey;
    }
    ctx.drawImage(this.oxide, 0, top, W, bodyH);

    const sel = st.region;

    // The seam view: Out's side of the loop joined to In's, in two halves.
    // What belongs to one continuous view (the selection band, the grease
    // marks, the pending mark, the ruler's ticks, the flags, the grips and
    // the playhead) is left out; the oxide above is the same, across the
    // whole body.
    if (st.edit?.seam && sel) {
      const { left, right } = seamHalves(sel, view.fpp, W);
      this.paintBody(left, 0, top, bottom, col, st, true);
      this.paintBody(right, W / 2, top, bottom, col, st, true);
      // The join, and a wash over the side the encoders move.
      ctx.save();
      const mid = Math.round(W / 2) + 0.5;
      ctx.strokeStyle = col('--sel', '#4ebeb4');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, bottom); ctx.stroke();
      ctx.fillStyle = withAlpha(col('--sel', '#4ebeb4'), 0.12);
      ctx.fillRect(st.edit.side === 'end' ? 0 : W / 2, top, W / 2, bottom - top);
      ctx.font = `600 11px ${col('--font', 'system-ui')}`;
      ctx.fillStyle = col('--well-dim', '#a39d90');
      ctx.textBaseline = 'top';
      ctx.fillText('…end', 6, top + 4);
      ctx.fillText('start…', W / 2 + 6, top + 4);
      ctx.restore();
      return;
    }

    const sx0 = sel ? frameToX(sel.start, view) : 0, sx1 = sel ? frameToX(sel.end, view) : 0;

    // Selection band, across ruler, body and grips, so its extent reads at
    // a glance wherever the eye is.
    if (sel) {
      // A little stronger over the tape, where brown takes some of it.
      ctx.fillStyle = withAlpha(col('--sel', '#268bd2'), 0.14);
      ctx.fillRect(sx0, 0, sx1 - sx0, H);
      ctx.fillStyle = withAlpha(col('--sel', '#268bd2'), 0.08);
      ctx.fillRect(sx0, top, sx1 - sx0, bottom - top);
    }

    this.paintBody(view, 0, top, bottom, col, st);

    // Selection edges: grease pencil, the way an edit point was marked on
    // tape. Each mark's wobble is seeded by its frame, so it stays put on
    // the audio as the view moves. IN and OUT are written inside the
    // selection, or outside it when it's too narrow to hold them.
    if (sel) {
      const grease = col('--grease-mark', '#f0c419');
      ctx.save();
      ctx.strokeStyle = grease;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [x, frame] of [[sx0, sel.start], [sx1, sel.end]]) {
        if (x < -4 || x > W + 4) continue;
        const pts = greaseStroke(x, PIN_H + 2, bottom - 2, frame);
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      }
      // The labels, with a halo of the well behind them so they read over
      // loud audio.
      ctx.font = `18px "Permanent Marker", ${col('--font', 'system-ui')}`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = col('--well', '#e9e2cd');
      ctx.fillStyle = grease;
      const wIn = ctx.measureText('IN').width, wOut = ctx.measureText('OUT').width;
      const at = labelPlaces(sx0, sx1, wIn, wOut, W);
      for (const [text, p] of [['IN', at.in], ['OUT', at.out]]) {
        if (!p) continue;
        ctx.strokeText(text, p.x, top + 6 + p.y);
        ctx.fillText(text, p.x, top + 6 + p.y);
      }
      ctx.restore();
    }

    // The boundary being edited: a bright line through ruler and body, and
    // its name, so it reads at any zoom.
    const ed = st.edit;
    if (ed && !ed.seam) {
      const frame = ed.edge === 'start' ? sel?.start : ed.edge === 'end' ? sel?.end : st.grid.downbeat;
      if (frame != null) {
        const x = Math.round(frameToX(frame, view)) + 0.5;
        const c = ed.edge === 'downbeat' ? col('--warn', '#b58900') : col('--sel', '#268bd2');
        ctx.save();
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.font = `600 11px ${col('--font', 'system-ui')}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = c;
        const label = ed.edge === 'start' ? 'In' : ed.edge === 'end' ? 'Out' : '1';
        ctx.fillText(label, x + 4, top + 4);
        ctx.restore();
      }
    }

    // A pending In or Out, waiting for its other half.
    if (st.pending) {
      const x = frameToX(st.pending.frame, view);
      // On tape the orange is too dark to find: the trace's own light ink.
      ctx.strokeStyle = col('--trace-hot', '#fff8e8');
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PIN_H); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 10px ${col('--font', 'system-ui')}`;
      ctx.fillStyle = col('--accent', '#cb4b16');
      const label = st.pending.edge === 'start' ? 'In' : 'Out';
      ctx.fillText(label, st.pending.edge === 'start' ? x + 4 : x - 4 - ctx.measureText(label).width, bottom - 6);
    }

    // Ruler: bar numbers (or seconds), with the downbeat's "1" in its own
    // colour when it can be dragged.
    ctx.font = `11px ${col('--mono', 'monospace')}`;
    ctx.textBaseline = 'middle';
    for (const t of rulerTicks(view, st.grid)) {
      const x = frameToX(t.frame, view);
      const isDownbeat = st.grid.bpm && t.frame === Math.round(st.grid.downbeat);
      ctx.fillStyle = isDownbeat ? col('--warn', '#b58900') : col('--well-dim', '#a39d90');
      ctx.fillRect(Math.round(x), PIN_H + 6, 1, RULER_H - PIN_H - 6);
      ctx.fillStyle = isDownbeat ? col('--warn', '#b58900') : col('--well-dim', '#a39d90');
      ctx.fillText(t.label, x + 3, PIN_H + (RULER_H - PIN_H) / 2 + 1);
    }
    // The downbeat itself, when it isn't on a labelled tick at this zoom.
    if (st.grid.bpm) {
      const x = frameToX(st.grid.downbeat, view);
      ctx.fillStyle = col('--warn', '#b58900');
      ctx.fillRect(Math.round(x) - 1, PIN_H, 2, RULER_H - PIN_H);
    }

    // Flags: a line through the body, a pin in the ruler, and its name when
    // there is room before the next one.
    ctx.textBaseline = 'alphabetic';
    ctx.font = `11px ${col('--font', 'system-ui')}`;
    let lastRight = -Infinity;
    for (const f of st.flags || []) {
      const x = frameToX(f.frame, view);
      if (x < -200 || x > W + 200) continue;
      const selected = st.selectedFlag && st.selectedFlag.id === f.id;
      ctx.fillStyle = col('--flag', '#b58900');
      ctx.fillRect(Math.round(x) - (selected ? 1 : 0), PIN_H, selected ? 3 : 1, bottom - PIN_H);
      // The pin: a small pennant on a stem.
      ctx.fillRect(Math.round(x), 2, 2, PIN_H - 2);
      ctx.beginPath(); ctx.moveTo(x + 2, 2); ctx.lineTo(x + 10, 6); ctx.lineTo(x + 2, 10); ctx.closePath(); ctx.fill();
      if (f.label && x + 12 > lastRight) {
        const w = Math.min(140, ctx.measureText(f.label).width);
        ctx.fillStyle = col('--well-ink', '#f2e6c8');
        ctx.fillText(f.label, x + 12, PIN_H - 4, 140);
        lastRight = x + 12 + w + 6;
      }
    }

    // Grips and the move handle.
    if (sel) {
      ctx.fillStyle = col('--sel', '#268bd2');
      const gy = bottom + 3, gh = H - bottom - 6;
      roundRect(ctx, sx0 - GRIP_W, gy, GRIP_W, gh, 5); ctx.fill();
      roundRect(ctx, sx1, gy, GRIP_W, gh, 5); ctx.fill();
      ctx.fillStyle = col('--on-accent', '#fdf6e3');
      ctx.font = `700 11px ${col('--font', 'system-ui')}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('◀', sx0 - GRIP_W + 6, gy + gh / 2 + 1);
      ctx.fillText('▶', sx1 + 6, gy + gh / 2 + 1);
      if (this.moveHandleShown(sx0, sx1)) {
        const mx = (sx0 + sx1) / 2;
        ctx.fillStyle = withAlpha(col('--sel', '#268bd2'), 0.35);
        roundRect(ctx, mx - MOVE_W / 2, gy + 4, MOVE_W, gh - 8, (gh - 8) / 2); ctx.fill();
        ctx.fillStyle = col('--sel', '#268bd2');
        for (const dy of [-3, 0, 3]) ctx.fillRect(mx - 8, gy + gh / 2 + dy, 16, 1);
      }
      ctx.textBaseline = 'alphabetic';
    }

    // The playhead: a line, and the handle in the ruler.
    if (st.cursor != null) {
      const cx = frameToX(st.cursor, view);
      // A light line with a dark edge either side, so it reads on oxide (the
      // orange alone is under 2:1 there); the handle in the ruler stays orange.
      ctx.fillStyle = col('--oxide-edge', '#23150b');
      ctx.fillRect(Math.round(cx) - 1, PIN_H + 11, 4, bottom - PIN_H - 11);
      ctx.fillStyle = col('--trace-hot', '#fff8e8');
      ctx.fillRect(Math.round(cx), PIN_H + 11, 2, bottom - PIN_H - 11);
      ctx.fillStyle = col('--accent', '#cb4b16');
      ctx.beginPath();
      ctx.moveTo(cx - 7, PIN_H + 1); ctx.lineTo(cx + 7, PIN_H + 1); ctx.lineTo(cx, PIN_H + 11); ctx.closePath();
      ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.rect(x, y, w, h);
}
