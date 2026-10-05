// web/static/lib/cassette.js
// The picked take as a cassette: a label with the take's stripe, HINDSIGHT,
// the date stamp and its name in marker; a window where the take's bars sit
// between two reels that turn while it plays, the tape packs trading tape as
// the playhead moves, and the selection's In and Out in grease pencil. A tap
// or a horizontal drag in the window seeks.
//
// It has RowWave's interface -- on(), isPlaying(), playPause(), pause(),
// setSelection(), detach(), destroy() -- so the takes page's pane draws it
// over the row's own player, plus setTake() for the label. Geometry is
// cassette-geom.js; colours are the cassette tokens in styles.css.

import { levelsFor, takeGain, smooth, drawBars } from './wave/draw.js';
import { token, withAlpha } from './theme.js';
import { stripeOf, stampOf, packRadii, windowLayout, playedX, fracAt, inOutLabels, greaseMark } from './cassette-geom.js';

// A reel hub: a ring, a disc, a dark core and six teeth.
function hubSVG() {
  const teeth = [0, 60, 120, 180, 240, 300]
    .map((a) => `<rect class="cas-tooth" x="20.2" y="7" width="3.6" height="6" rx="1" transform="rotate(${a} 22 22)"/>`).join('');
  return `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
    <circle class="cas-hub-ring" cx="22" cy="22" r="20" fill="none" stroke-width="3"/>
    <circle class="cas-hub-disc" cx="22" cy="22" r="13"/><circle class="cas-hub-core" cx="22" cy="22" r="9"/>${teeth}</svg>`;
}

export class CassetteFace {
  constructor({ container, peaks, duration, audio, take }) {
    this.container = container;
    this.peaks = peaks;
    this.duration = duration;
    this.audio = audio;
    this.handlers = {};
    this.selection = null; // {start, end} as fractions of the take
    this.raf = 0;
    this.gain = takeGain(peaks);
    this.el = document.createElement('div');
    this.el.className = 'cassette';
    this.el.innerHTML = `
      <svg class="cas-screws" aria-hidden="true"></svg>
      <div class="cas-label">
        <div class="cas-band"></div><div class="cas-under"></div>
        <span class="cas-side" aria-hidden="true">A</span>
        <span class="cas-brand" aria-hidden="true">HINDSIGHT</span>
        <span class="cas-stamp"></span>
        <div class="cas-rule"></div>
        <span class="cas-name"></span>
        <div class="cas-window">
          <canvas class="cas-canvas"></canvas>
          <div class="cas-hub"><div class="cas-spin">${hubSVG()}</div></div>
          <div class="cas-hub"><div class="cas-spin">${hubSVG()}</div></div>
          <div class="cas-glare"></div>
        </div>
      </div>
      <div class="cas-foot" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`;
    container.prepend(this.el);
    const q = (s) => this.el.querySelector(s);
    this.parts = {
      screws: q('.cas-screws'), label: q('.cas-label'), band: q('.cas-band'), under: q('.cas-under'),
      side: q('.cas-side'), brand: q('.cas-brand'), stamp: q('.cas-stamp'), rule: q('.cas-rule'), name: q('.cas-name'),
      win: q('.cas-window'), canvas: q('.cas-canvas'), hubs: [...this.el.querySelectorAll('.cas-hub')], foot: q('.cas-foot'),
    };
    this.ctx = this.parts.canvas.getContext('2d');
    this.setTake(take);

    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    for (const ev of ['play', 'pause', 'ended', 'error']) {
      audio.addEventListener(ev, () => {
        this.el.classList.toggle('playing', this.isPlaying());
        if (ev === 'play') this.loop();
        this.fire(ev === 'ended' ? 'finish' : ev);
        this.draw();
      }, sig);
    }
    audio.addEventListener('seeked', () => this.draw(), sig);
    this.el.classList.toggle('playing', this.isPlaying());

    // Seeking, as a row's wave: a tap, or a horizontal drag.
    const cv = this.parts.canvas;
    cv.style.touchAction = 'pan-y';
    let dragging = null;
    const seekTo = (e) => {
      const r = cv.getBoundingClientRect();
      const f = Math.min(fracAt(e.clientX - r.left, this.layout), 0.999);
      const d = this.audio.duration || this.duration;
      if (d) { this.audio.currentTime = f * d; this.draw(); }
    };
    cv.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; }, sig);
    cv.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { dragging = null; return; }
      if (!dragging.moved && Math.abs(e.clientX - dragging.x) > 6 && Math.abs(e.clientX - dragging.x) > Math.abs(e.clientY - dragging.y)) {
        dragging.moved = true;
        cv.setPointerCapture?.(e.pointerId);
      }
      if (dragging.moved) seekTo(e);
    }, sig);
    cv.addEventListener('pointerup', (e) => {
      if (dragging && e.pointerId === dragging.id && !dragging.moved) seekTo(e);
      dragging = null;
    }, sig);
    cv.addEventListener('pointercancel', () => { dragging = null; }, sig);

    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(container);
    this.relayout();
    // The IN and OUT labels are in marker: draw again once it has loaded.
    document.fonts?.ready.then(() => this.draw());
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  fire(ev) { for (const fn of this.handlers[ev] || []) fn(); }
  isPlaying() { return !this.audio.paused && !this.audio.ended; }
  async playPause() {
    if (this.isPlaying()) { this.audio.pause(); return; }
    await this.audio.play();
  }
  pause() { this.audio.pause(); }

  /** setTake writes the take on the label: its stripe, stamp and name. */
  setTake(take) {
    this.take = take;
    for (let n = 1; n <= 5; n++) this.el.classList.remove(`stripe-${n}`);
    this.el.classList.add(`stripe-${stripeOf(take.name)}`);
    this.parts.stamp.textContent = stampOf(take);
    this.parts.name.textContent = take.label || take.name.replace(/^jam_|\.wav$/g, '');
  }

  /** setSelection draws the take's selection; frames out of totalFrames. */
  setSelection(trim, totalFrames) {
    const next = trim && totalFrames ? { start: trim.start_frame / totalFrames, end: trim.end_frame / totalFrames } : null;
    if (JSON.stringify(next) === JSON.stringify(this.selection)) return;
    this.selection = next;
    this.draw();
  }

  // relayout places every part for the container's width: the phone's
  // cassette under 600 px, the desk's above.
  relayout() {
    const W = Math.round(this.container.getBoundingClientRect().width);
    if (W <= 0 || W === this.layout?.W) return;
    const L = windowLayout(W, W < 600 ? 'phone' : 'desk');
    this.layout = L;
    const px = (v) => `${v}px`;
    const s = this.el.style;
    s.height = px(L.H);
    s.borderRadius = px(L.radius);
    this.el.classList.toggle('phone', L.kind === 'phone');
    const { label: lb, win } = L;
    Object.assign(this.parts.label.style, { left: px(lb.x), top: px(lb.y), width: px(lb.w), height: px(lb.h) });
    this.parts.band.style.height = px(lb.band);
    Object.assign(this.parts.under.style, { top: px(lb.band + 2) });
    Object.assign(this.parts.side.style, { width: px(lb.side), height: px(lb.side), top: px((lb.band - lb.side) / 2), fontSize: px(lb.side * 0.65) });
    Object.assign(this.parts.brand.style, { left: px(lb.side + 20), lineHeight: px(lb.band), fontSize: px(lb.brand) });
    Object.assign(this.parts.stamp.style, { lineHeight: px(lb.band), fontSize: px(lb.stamp) });
    this.parts.rule.style.top = px(lb.titleTop + lb.titleSize + 8);
    Object.assign(this.parts.name.style, { top: px(lb.titleTop), fontSize: px(lb.titleSize) });
    Object.assign(this.parts.win.style, { left: px(win.x), top: px(win.y), width: px(win.w), height: px(win.h), borderRadius: px(win.h / 2) });
    this.parts.hubs.forEach((h, i) => Object.assign(h.style, {
      left: px(i ? win.w - win.rc : win.rc), top: px(win.cy), transform: `translate(-50%, -50%) scale(${win.hub})`,
    }));
    Object.assign(this.parts.foot.style, { width: px(L.foot.w), height: px(L.foot.h), marginLeft: px(-L.foot.w / 2) });
    // Screws: four corners and the middle of the foot.
    const { r, inset: si } = L.screws;
    this.parts.screws.setAttribute('viewBox', `0 0 ${W} ${L.H}`);
    this.parts.screws.innerHTML = [[si, si], [W - si, si], [si, L.H - si], [W - si, L.H - si], [W / 2, L.H - si]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - r * 0.6} ${y}h${r * 1.2}"/>`).join('');
    const dpr = window.devicePixelRatio || 1;
    const cv = this.parts.canvas;
    cv.width = Math.round(win.w * dpr);
    cv.height = Math.round(win.h * dpr);
    cv.style.width = px(win.w);
    cv.style.height = px(win.h);
    this.levels = smooth(levelsFor(this.peaks, win.n));
    this.draw();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
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
    const L = this.layout;
    if (!L || !this.levels) return;
    const { win } = L;
    const cv = this.parts.canvas;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    const tk = (name) => token(name, 'transparent', cv);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, win.w, win.h);
    const d = this.audio.duration || this.duration;
    const frac = d ? this.audio.currentTime / d : 0;
    const px = playedX(frac, L);

    // The tape packs: the left reel gives tape to the right one.
    const [rl, rr] = packRadii(frac, win.rMin, win.rMax);
    ctx.lineWidth = 2;
    for (const [x, r] of [[win.rc, rl], [win.w - win.rc, rr]]) {
      ctx.beginPath();
      ctx.arc(x, win.cy, r, 0, Math.PI * 2);
      ctx.fillStyle = tk('--pack');
      ctx.fill();
      ctx.strokeStyle = tk('--pack-edge');
      ctx.stroke();
    }

    // The selection, a faint grease wash between its marks.
    const grease = tk('--grease-mark');
    const sel = this.selection;
    const sx0 = sel ? playedX(sel.start, L) : 0, sx1 = sel ? playedX(sel.end, L) : 0;
    if (sel) {
      ctx.fillStyle = withAlpha(grease, 0.12);
      ctx.beginPath();
      ctx.roundRect(sx0 - 4, 7, sx1 - sx0 + 8, win.h - 14, 6);
      ctx.fill();
    }

    // The bars: unplayed, then the played part lit, clipped to the playhead.
    const bars = { x0: win.x0, pitch: win.pitch, cy: win.cy, half: win.half, gain: this.gain };
    drawBars(ctx, this.levels, { ...bars, color: withAlpha(tk('--wave'), 0.55) });
    if (frac > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, px + 2, win.h);
      ctx.clip();
      ctx.shadowColor = withAlpha(tk('--wave-hot'), 0.7);
      ctx.shadowBlur = 4 * dpr;
      drawBars(ctx, this.levels, { ...bars, color: tk('--wave-hot') });
      ctx.restore();
    }

    // In and Out in grease pencil, with their labels when there's room.
    if (sel) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = grease;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [x, dir, seed] of [[sx0 - 4, 1, Math.round(sel.start * 1e6)], [sx1 + 4, -1, Math.round(sel.end * 1e6) + 1]]) {
        const pts = greaseMark(x, dir, seed, L);
        ctx.beginPath();
        pts.forEach(([gx, gy], i) => (i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy)));
        ctx.stroke();
      }
      ctx.restore();
      const lab = inOutLabels(sel, L);
      if (lab) {
        ctx.save();
        ctx.fillStyle = grease;
        ctx.font = `${win.marks}px 'Permanent Marker', ${tk('--font')}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText('IN', lab.inX, 3);
        ctx.textAlign = 'right';
        ctx.fillText('OUT', lab.outX, 3);
        ctx.restore();
      }
    }

    // The playhead, once there's somewhere to show it.
    if (this.isPlaying() || frac > 0) {
      ctx.save();
      ctx.fillStyle = tk('--accent');
      ctx.shadowColor = tk('--accent-glow');
      ctx.shadowBlur = 8 * dpr;
      ctx.fillRect(px - 1, 7, 2, win.h - 14);
      ctx.restore();
    }
  }

  /** detach stops drawing and listening and leaves the audio alone. */
  detach() {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.ro.disconnect();
    this.el.remove();
  }

  destroy() {
    this.detach();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}
