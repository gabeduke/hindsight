// web/static/lib/wave/rowwave.js
// A take's waveform in the list: drawn by the same renderer as the take page
// and the overview (draw.js, on the dB scale), played through a plain
// <audio> on the take's preview. Tap or drag to seek; the played part is
// brighter; the take's selection shows as a bracket.
//
// It replaces the vendored WaveSurfer, which drew on its own scale and was
// the one waveform in the app that couldn't show what the others do.
// The interface is the small part of WaveSurfer's the list used: on(),
// playPause(), pause(), isPlaying(), destroy().

import { peakColumns, foldChannels, drawColumns } from './draw.js';

const PLAYED = '#34d399';
const UNPLAYED = '#2c5f52';

export class RowWave {
  constructor({ container, peaks, duration, audio }) {
    this.container = container;
    this.peaks = peaks;
    this.duration = duration;
    this.audio = audio;
    this.handlers = {};
    this.selection = null; // {start, end} as fractions of the take
    this.raf = 0;
    this.cols = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'row-wave';
    this.canvas.style.touchAction = 'pan-y'; // a vertical swipe still scrolls the list
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    for (const ev of ['play', 'pause', 'ended', 'error']) {
      audio.addEventListener(ev, () => {
        if (ev === 'play') this.loop();
        this.fire(ev === 'ended' ? 'finish' : ev);
        this.draw();
      }, sig);
    }
    audio.addEventListener('seeked', () => this.draw(), sig);
    // Seeking: a tap, or a horizontal drag.
    let dragging = null;
    const seekTo = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.999);
      const d = this.audio.duration || this.duration;
      if (d) { this.audio.currentTime = f * d; this.draw(); }
    };
    this.canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; }, sig);
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      if (!dragging.moved && Math.abs(e.clientX - dragging.x) > 6 && Math.abs(e.clientX - dragging.x) > Math.abs(e.clientY - dragging.y)) {
        dragging.moved = true;
        this.canvas.setPointerCapture?.(e.pointerId);
      }
      if (dragging.moved) seekTo(e);
    }, sig);
    this.canvas.addEventListener('pointerup', (e) => {
      if (dragging && e.pointerId === dragging.id && !dragging.moved) seekTo(e);
      dragging = null;
    }, sig);
    this.canvas.addEventListener('pointercancel', () => { dragging = null; }, sig);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  fire(ev) { for (const fn of this.handlers[ev] || []) fn(); }

  isPlaying() { return !this.audio.paused && !this.audio.ended; }
  async playPause() {
    if (this.isPlaying()) { this.audio.pause(); return; }
    await this.audio.play();
  }
  pause() { this.audio.pause(); }

  /** setSelection draws the take's selection; frames out of totalFrames. */
  setSelection(trim, totalFrames) {
    const next = trim && totalFrames ? { start: trim.start_frame / totalFrames, end: trim.end_frame / totalFrames } : null;
    if (JSON.stringify(next) === JSON.stringify(this.selection)) return;
    this.selection = next;
    this.draw();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.cols = foldChannels(peakColumns(this.peaks, Math.round(r.width)), this.peaks.channels);
    this.draw();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      // Clear the id first: draw() treats a non-zero raf as "a frame is
      // coming", and a stale one would freeze the row after one play.
      this.raf = 0;
      this.paint();
      if (this.isPlaying()) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  paint() {
    if (!this.cols) return;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const d = this.audio.duration || this.duration;
    const played = d ? (this.audio.currentTime / d) * W : 0;
    if (this.selection) {
      const x0 = this.selection.start * W, x1 = this.selection.end * W;
      ctx.fillStyle = 'rgba(52,211,153,0.14)';
      ctx.fillRect(x0, 0, x1 - x0, H);
      // A bracket at each end, so the selection reads at a glance.
      ctx.fillStyle = PLAYED;
      ctx.fillRect(Math.round(x0), 0, 2, H);
      ctx.fillRect(Math.round(x0), 0, 5, 2);
      ctx.fillRect(Math.round(x0), H - 2, 5, 2);
      ctx.fillRect(Math.round(x1) - 2, 0, 2, H);
      ctx.fillRect(Math.round(x1) - 5, 0, 5, 2);
      ctx.fillRect(Math.round(x1) - 5, H - 2, 5, 2);
    }
    drawColumns(ctx, this.cols, 1, { top: 2, height: H - 4, color: (x) => (x < played ? PLAYED : UNPLAYED) });
    if (played > 0) {
      ctx.fillStyle = '#eef2f8';
      ctx.fillRect(Math.round(played), 0, 1, H);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.ro.disconnect();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load(); // let go of the stream, not just the attribute
    this.canvas.remove();
  }
}
