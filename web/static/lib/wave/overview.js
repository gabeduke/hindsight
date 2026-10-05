// web/static/lib/wave/overview.js
// The whole-take strip above the main waveform: navigation across the whole
// take. Drag the window to pan, tap outside it to centre the view there, and
// double-tap to fit the whole take. The pure functions are what the tests cover; the class is the canvas
// and pointer plumbing around them.
import { levelsFor, takeGain } from './draw.js';
import { drawTrace, paintOxide, oxideColors } from './tape-strip.js';
import { withAlpha } from '../theme.js';

export const OVERVIEW_MIN_WINDOW_PX = 24;
const TAP_MOVE = 6;
const TAP_MS = 300;

export function windowRect(view, totalFrames, stripWidth) {
  const span = view.width * view.fpp;
  let w = Math.max(OVERVIEW_MIN_WINDOW_PX, (span / totalFrames) * stripWidth);
  w = Math.min(w, stripWidth);
  let x = (view.start / totalFrames) * stripWidth;
  x = Math.max(0, Math.min(stripWidth - w, x));
  return { x, w };
}

export function stripXToFrame(x, totalFrames, stripWidth) {
  return Math.round(Math.max(0, Math.min(stripWidth, x)) / stripWidth * totalFrames);
}

export function dragToStart(x, grabOffset, view, totalFrames, stripWidth) {
  const span = view.width * view.fpp;
  const maxStart = Math.max(0, totalFrames - span);
  const start = ((x - grabOffset) / stripWidth) * totalFrames;
  return Math.round(Math.max(0, Math.min(maxStart, start)));
}

export class Overview {
  constructor({ canvas, filePeaks, totalFrames, getState, getView, emit }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.peaks = filePeaks;
    this.total = totalFrames;
    this.getState = getState;
    this.getView = getView;
    this.emit = emit;
    this.raf = 0;
    this.gesture = null;
    this.lastTap = 0;
    this.ac = new AbortController();
    canvas.style.touchAction = 'none';
    const s = this.ac.signal;
    canvas.addEventListener('pointerdown', (e) => this.down(e), { signal: s });
    canvas.addEventListener('pointermove', (e) => this.move(e), { signal: s });
    canvas.addEventListener('pointerup', (e) => this.up(e), { signal: s });
    canvas.addEventListener('pointercancel', (e) => this.up(e), { signal: s });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  // Drop the cache too: it is a full-strip backing canvas, and a destroyed
  // overview that outlives its page should not keep one pinned.
  destroy() { this.ac.abort(); this.ro.disconnect(); cancelAnimationFrame(this.raf); this.destroyed = true; this.waveCache = null; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr; this.cssW = r.width; this.cssH = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.draw();
  }

  draw() {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  // Renders the static, whole-take waveform (channels folded into one lane,
  // on the shared dB scale) into this.waveCache at the current device-pixel
  // size. paint() only re-runs it when the size changes, not on every tick.
  renderWaveCache() {
    const { dpr, cssW: W, cssH: H } = this;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (!this.waveCache) {
      this.waveCache = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(pw, ph)
        : document.createElement('canvas');
    }
    this.waveCache.width = pw;
    this.waveCache.height = ph;
    const cctx = this.waveCache.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.canvas);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;
    // The whole take on a strip of tape: its trace, folded to one lane, on
    // the take's own scale (as its zoomed view and its cassette).
    paintOxide(cctx, W, H, oxideColors(col));
    const lv = levelsFor(this.peaks, Math.max(1, Math.round(W)));
    cctx.globalAlpha = 0.7;
    drawTrace(cctx, lv, lv, { cy: H / 2, half: H / 2 - 3, gain: takeGain(this.peaks), line: col('--trace', '#f6e7c4') });
    cctx.globalAlpha = 1;
    this.cachedKey = `${W}x${H}@${dpr}`;
  }

  paint() {
    const { ctx, dpr, cssW: W, cssH: H } = this;
    // A zero-width or zero-height layout would render a 0-px cache that
    // drawImage then refuses to draw.
    if (!W || !H) return;
    const st = this.getState();
    const css = getComputedStyle(this.canvas);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;
    const key = `${W}x${H}@${dpr}`;
    if (key !== this.cachedKey) this.renderWaveCache();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.waveCache, 0, 0, W, H);

    // Selection band and flags
    if (st.region) {
      ctx.fillStyle = withAlpha(col('--sel', '#268bd2'), 0.25);
      const x0 = (st.region.start / this.total) * W, x1 = (st.region.end / this.total) * W;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
    }
    ctx.fillStyle = col('--flag', '#b58900');
    for (const f of st.flags || []) ctx.fillRect(Math.round((f.frame / this.total) * W), 0, 1, H);

    // Playhead
    ctx.fillStyle = col('--accent', '#cb4b16');
    ctx.fillRect(Math.round((st.cursor / this.total) * W), 0, 1, H);

    // Viewport window
    const { x, w } = windowRect(this.getView(), this.total, W);
    ctx.fillStyle = withAlpha(col('--well-ink', '#f2e6c8'), 0.08);
    ctx.fillRect(x, 0, w, H);
    ctx.strokeStyle = col('--well-ink', '#f2e6c8');
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 0.5, w - 1, H - 1);
  }

  pt(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  down(e) {
    // A second pointer landing on the strip while one gesture is already
    // live is ignored entirely -- it does not steer or end the first
    // finger's drag, and it does not start a gesture of its own.
    if (this.gesture && this.gesture.id !== e.pointerId) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pt(e);
    const { x, w } = windowRect(this.getView(), this.total, this.cssW);
    const inside = p.x >= x && p.x <= x + w;
    this.gesture = { id: e.pointerId, x0: p.x, t0: performance.now(), moved: false, inside, grabOffset: p.x - x };
  }

  move(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const p = this.pt(e);
    if (Math.abs(p.x - g.x0) > TAP_MOVE) g.moved = true;
    if (g.inside && g.moved) {
      this.emit('panTo', { start: dragToStart(p.x, g.grabOffset, this.getView(), this.total, this.cssW) });
    }
  }

  up(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    const p = this.pt(e);
    const isTap = !g.moved && performance.now() - g.t0 < TAP_MS;
    if (!isTap) return;
    const now = performance.now();
    if (now - this.lastTap < TAP_MS) { this.lastTap = 0; this.emit('fitAll', {}); return; }
    this.lastTap = now;
    if (!g.inside) this.emit('centerOn', { frame: stripXToFrame(p.x, this.total, this.cssW) });
  }
}
