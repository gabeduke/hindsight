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
//
// look 'spine' is a cassette spine's printed bars instead (the takes page's
// rack): rounded bars from the take's own levels (draw.js levelsFor, scaled
// by takeGain), in the J-card's ink, darker on the picked spine. A spine is
// for picking, so that look takes no pointer input and draws no playhead.

import { peakColumns, foldChannels, drawColumns, levelsFor, takeGain, smooth, drawBars } from './draw.js';
import { token, withAlpha } from '../theme.js';

/** spineBarCount is how many printed bars fit a spine `w` px wide. */
export function spineBarCount(w, pitch = 4) {
  return w >= 4 ? Math.floor((w - 4) / pitch) + 1 : 0;
}

// The played part in the waveform colour, the rest the same colour, fainter;
// read from the stylesheet at paint time so they follow light and dark.
const playedColor = (el) => token('--wave', '#268bd2', el);
const unplayed = (el) => withAlpha(playedColor(el), 0.5);

export class RowWave {
  constructor({ container, peaks, duration, audio, look = 'row' }) {
    this.look = look;
    this.picked = false;
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
    if (look === 'spine') {
      this.gain = takeGain(peaks);
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
      this.resize();
      return;
    }
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
      // A mouse released somewhere this canvas didn't hear (the list's
      // select mode swallows the release): the drag is over.
      if (e.pointerType === 'mouse' && e.buttons === 0) { dragging = null; return; }
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
    if (this.look === 'spine') this.levels = smooth(levelsFor(this.peaks, spineBarCount(r.width)));
    else this.cols = foldChannels(peakColumns(this.peaks, Math.round(r.width)), this.peaks.channels);
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

  /** setPicked prints the spine's bars darker while it's the picked take. */
  setPicked(on) {
    if (on === this.picked) return;
    this.picked = on;
    this.draw();
  }

  paintSpine() {
    if (!this.levels) return;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = token(this.picked ? '--paper-bars-on' : '--paper-bars', 'transparent', this.canvas);
    drawBars(ctx, this.levels, { x0: 2, pitch: 4, cy: H / 2, half: H / 2 - 2, gain: this.gain, width: 2, color: ink });
  }

  paint() {
    if (this.look === 'spine') { this.paintSpine(); return; }
    if (!this.cols) return;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const d = this.audio.duration || this.duration;
    const played = d ? (this.audio.currentTime / d) * W : 0;
    const PLAYED = playedColor(this.canvas), UNPLAYED = unplayed(this.canvas);
    if (this.selection) {
      const x0 = this.selection.start * W, x1 = this.selection.end * W;
      ctx.fillStyle = withAlpha(PLAYED, 0.14);
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
      ctx.fillStyle = token('--accent', '#cb4b16', this.canvas);
      ctx.fillRect(Math.round(played), 0, 1, H);
    }
  }

  /** detach stops drawing and listening, and leaves the audio alone: for a
   *  second view of a player someone else owns (the takes page's detail). */
  detach() {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.ro.disconnect();
    this.canvas.remove();
  }

  destroy() {
    this.detach();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load(); // let go of the stream, not just the attribute
  }
}
