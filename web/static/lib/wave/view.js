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
import { drawColumns } from './draw.js';
import { GestureSurface } from '../edit/gestures.js';

export { HOLD_MS } from '../edit/gestures.js';

export const PIN_H = 16;     // the ruler's top half: flag pins
export const RULER_H = 36;   // the whole ruler
export const GRIP_H = 30;    // the strip under the waveform
const PIN_HIT = 12;          // px each side of a pin
const PLAYHEAD_HIT = 16;
const DOWNBEAT_HIT = 18;
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
      if (st.cursor != null && Math.abs(x - frameToX(st.cursor, v)) <= PLAYHEAD_HIT) return { kind: 'playhead', grab: true };
      if (st.grid.bpm && Math.abs(x - frameToX(st.grid.downbeat, v)) <= DOWNBEAT_HIT) return { kind: 'downbeat', grab: true };
      return { kind: 'ruler' };
    }
    if (y >= this.bodyBottom() && st.region) {
      const x0 = frameToX(st.region.start, v), x1 = frameToX(st.region.end, v);
      // The grips sit just outside the selection's ends, so even a selection
      // a pixel wide keeps two separate tabs to hold.
      if (x >= x0 - GRIP_W - 4 && x <= x0 + GRIP_IN) return { kind: 'grip', grab: true, edge: 'start' };
      if (x >= x1 - GRIP_IN && x <= x1 + GRIP_W + 4) return { kind: 'grip', grab: true, edge: 'end' };
      const mid = (x0 + x1) / 2;
      if (this.moveHandleShown(x0, x1) && Math.abs(x - mid) <= MOVE_W / 2 + 4) return { kind: 'move', grab: true };
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
      case 'playhead':
        this.emit('scrubStart', {});
        return { what: 'playhead', prev: st.cursor, grabOffset: p.x - frameToX(st.cursor, this.view) };
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
      case 'pin': this.emit('flagMove', { flag: g.flag, frame: Math.min(this.total - 1, at(p.x - g.grabOffset)), final: false }); break;
      case 'playhead': this.emit('scrub', { frame: Math.max(0, Math.min(this.total - 1, xToFrame(p.x - g.grabOffset, this.view))) }); break;
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
      case 'pin':
        if (tap) this.emit('selectFlag', { flag: g.flag });
        else if (g.moved) this.emit('flagMove', { flag: g.flag, frame: g.flag.frame, final: true });
        break;
      case 'playhead':
        // A tap on the handle is a tap on the ruler: it seeks to itself.
        this.emit('scrubEnd', { frame: st.cursor });
        break;
      case 'downbeat':
        if (g.moved) this.emit('downbeatChange', { frame: st.grid.downbeat, final: true });
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
      case 'playhead': this.emit('scrubEnd', { frame: g.prev }); break;
      case 'downbeat': this.emit('downbeatChange', { frame: g.prev, final: true }); break;
      case 'grip':
      case 'move': this.emit('regionChange', { region: g.region, final: true }); break;
      default: break;
    }
  }

  // A tap moves the playhead (snapped); the second of two taps on the
  // waveform adds a flag there.
  tapAt(p, h, double) {
    const frame = this.snapX(p.x);
    if (double && h.kind === 'body') this.emit('addFlag', { frame: Math.min(this.total - 1, frame) });
    else this.emit('seek', { frame });
  }

  // --- painting ---------------------------------------------------------------
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
    ctx.fillStyle = col('--panel', '#131c2e');
    ctx.fillRect(0, 0, W, H);
    // The ruler and the grip strip are a shade apart from the waveform.
    ctx.fillStyle = col('--panel-2', '#1a2437');
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillRect(0, bottom, W, H - bottom);

    const sel = st.region;
    const sx0 = sel ? frameToX(sel.start, view) : 0, sx1 = sel ? frameToX(sel.end, view) : 0;

    // Selection band, across ruler, body and grips, so its extent reads at
    // a glance wherever the eye is.
    if (sel) {
      ctx.fillStyle = 'rgba(52,211,153,0.13)';
      ctx.fillRect(sx0, 0, sx1 - sx0, H);
    }

    // Beat and bar lines in the body.
    for (const g of gridLines(view, st.grid)) {
      const x = frameToX(g.frame, view);
      ctx.fillStyle = g.bar ? col('--line', '#26324a') : 'rgba(255,255,255,0.06)';
      ctx.fillRect(Math.round(x), top, 1, bottom - top);
    }

    // The waveform, on the shared dB scale.
    const { cols, channels } = this.tiles.columns(view, dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top, W, bottom - top); ctx.clip();
    drawColumns(ctx, cols, channels, { top: top + 2, height: bottom - top - 4, color: col('--accent', '#34d399') });
    ctx.restore();

    // Selection edges.
    if (sel) {
      ctx.fillStyle = col('--accent', '#34d399');
      ctx.fillRect(Math.round(sx0) - 1, PIN_H, 2, bottom - PIN_H);
      ctx.fillRect(Math.round(sx1) - 1, PIN_H, 2, bottom - PIN_H);
    }

    // A pending In or Out, waiting for its other half.
    if (st.pending) {
      const x = frameToX(st.pending.frame, view);
      ctx.strokeStyle = col('--accent', '#34d399');
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PIN_H); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 10px ${col('--font', 'system-ui')}`;
      ctx.fillStyle = col('--accent', '#34d399');
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
      ctx.fillStyle = isDownbeat ? col('--warn', '#fbbf24') : col('--ink-faint', '#5d6b85');
      ctx.fillRect(Math.round(x), PIN_H + 6, 1, RULER_H - PIN_H - 6);
      ctx.fillStyle = isDownbeat ? col('--warn', '#fbbf24') : col('--ink-dim', '#8b9ab4');
      ctx.fillText(t.label, x + 3, PIN_H + (RULER_H - PIN_H) / 2 + 1);
    }
    // The downbeat itself, when it isn't on a labelled tick at this zoom.
    if (st.grid.bpm) {
      const x = frameToX(st.grid.downbeat, view);
      ctx.fillStyle = col('--warn', '#fbbf24');
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
      ctx.fillStyle = col('--flag', '#ffb020');
      ctx.fillRect(Math.round(x) - (selected ? 1 : 0), PIN_H, selected ? 3 : 1, bottom - PIN_H);
      // The pin: a small pennant on a stem.
      ctx.fillRect(Math.round(x), 2, 2, PIN_H - 2);
      ctx.beginPath(); ctx.moveTo(x + 2, 2); ctx.lineTo(x + 10, 6); ctx.lineTo(x + 2, 10); ctx.closePath(); ctx.fill();
      if (f.label && x + 12 > lastRight) {
        const w = Math.min(140, ctx.measureText(f.label).width);
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.fillText(f.label, x + 12, PIN_H - 4, 140);
        lastRight = x + 12 + w + 6;
      }
    }

    // Grips and the move handle.
    if (sel) {
      ctx.fillStyle = col('--accent', '#34d399');
      const gy = bottom + 3, gh = H - bottom - 6;
      roundRect(ctx, sx0 - GRIP_W, gy, GRIP_W, gh, 5); ctx.fill();
      roundRect(ctx, sx1, gy, GRIP_W, gh, 5); ctx.fill();
      ctx.fillStyle = '#062015';
      ctx.font = `700 11px ${col('--font', 'system-ui')}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('◀', sx0 - GRIP_W + 6, gy + gh / 2 + 1);
      ctx.fillText('▶', sx1 + 6, gy + gh / 2 + 1);
      if (this.moveHandleShown(sx0, sx1)) {
        const mx = (sx0 + sx1) / 2;
        ctx.fillStyle = 'rgba(52,211,153,0.35)';
        roundRect(ctx, mx - MOVE_W / 2, gy + 4, MOVE_W, gh - 8, (gh - 8) / 2); ctx.fill();
        ctx.fillStyle = col('--accent', '#34d399');
        for (const dy of [-3, 0, 3]) ctx.fillRect(mx - 8, gy + gh / 2 + dy, 16, 1);
      }
      ctx.textBaseline = 'alphabetic';
    }

    // The playhead: a line, and the handle in the ruler.
    if (st.cursor != null) {
      const cx = frameToX(st.cursor, view);
      ctx.fillStyle = col('--ink', '#eef2f8');
      ctx.fillRect(Math.round(cx), PIN_H, 1, bottom - PIN_H);
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
