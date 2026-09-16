// web/static/lib/wave/clock.js
// One clock for the page. Everything that needs "where are we" calls
// position(); nothing keeps its own time. Two engines sit behind it and
// exactly one is active:
//   preview -- an <audio> on the take's mp3, for scrubbing the whole take
//              and for looping regions too long to slice.
//   slice   -- /api/slice decoded into Web Audio and looped with an
//              AudioBufferSourceNode, so the loop point is sample-exact
//              and what plays is exactly what a cut will be.

export const SLICE_CAP_SECONDS = 60;

// How far past the element's last reported time the preview position may be
// extrapolated. Generous next to the ~250 ms between Safari's updates, small
// enough that a stalled element cannot run visibly ahead.
export const MAX_EXTRAPOLATE_S = 0.5;

/**
 * The preview's position between the element's coarse currentTime updates.
 * Safari reports currentTime only a few times a second; drawing straight
 * from it makes anything moving at 44 px/beat jump in visible steps. `s`
 * remembers the last reported value and the wall-clock moment it changed;
 * while the report stands still the position advances with the wall clock,
 * scaled by the playback rate, and every new report resyncs exactly, so a
 * seek or a loop wrap never carries extrapolation over.
 */
export function smoothTime(s, reported, nowMs, rate) {
  if (reported !== s.t) { s.t = reported; s.at = nowMs; return reported; }
  return reported + Math.min(MAX_EXTRAPOLATE_S, ((nowMs - s.at) / 1000) * rate);
}

export class Clock {
  constructor({ previewUrl, sampleRate, file, onTick, onError, onEnded }) {
    this.sr = sampleRate;
    this.file = file;
    this.onTick = onTick;
    this.onError = onError;
    this.onEnded = onEnded;
    this.audio = new Audio(previewUrl);
    this.audio.preload = 'auto';
    this.ctx = null;          // AudioContext, created on first play (iOS gesture rule)
    this.engine = 'preview';
    this.loop = null;
    this.playing = false;
    this.slice = null;        // { buffer, start, end } decoded region
    this.src = null;          // AudioBufferSourceNode while playing a slice
    this.sliceStartedAt = 0;  // ctx.currentTime when src started
    this.sliceOffset = 0;     // frame offset into the slice at start
    this.raf = 0;
    this.pendingFetch = 0;
    // Playback speed of the preview engine. The slice engine ignores it: a
    // loop is for hearing the cut exactly, and pitch-preserved 0.5× through
    // an AudioBufferSourceNode is not something the browser gives us.
    this.rate = 1;
    this.audio.preservesPitch = true;
    this.audio.webkitPreservesPitch = true; // older iPadOS
    this.smooth = { t: -1, at: 0 }; // see smoothTime
    // The preview running out is a stop nobody asked for: settle the cursor
    // at the end, then tell the page so its Play button stops lying.
    this.audio.addEventListener('ended', () => {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.onTick?.(this.position());
      this.onEnded?.();
    });
  }

  position() {
    if (this.engine === 'slice' && this.src && this.playing) {
      const elapsed = (this.ctx.currentTime - this.sliceStartedAt) * this.sr + this.sliceOffset;
      const len = this.slice.end - this.slice.start;
      return this.slice.start + Math.floor(elapsed % len);
    }
    const t = this.audio.currentTime;
    if (!this.playing) return Math.floor(t * this.sr);
    return Math.floor(smoothTime(this.smooth, t, performance.now(), this.rate) * this.sr);
  }

  seek(frame) {
    frame = Math.max(0, frame);
    if (this.engine === 'slice' && this.slice) {
      const inside = frame >= this.slice.start && frame < this.slice.end;
      if (inside && this.playing) { this.stopSource(); this.startSource(frame - this.slice.start); return; }
      if (!inside) this.setLoop(null);
    }
    this.audio.currentTime = frame / this.sr;
  }

  async play() {
    if (this.playing) return;
    if (this.engine === 'slice' && this.slice) {
      this.ensureCtx();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      // The cursor can sit outside the slice: a paused tap past the region
      // leaves position() on the tapped frame while the slice still covers
      // the old region (setLoop resolves with playing === false and never
      // re-offsets). Subtracting start would then hand startSource an offset
      // past the buffer, so fall back to the region's head, mirroring the
      // same guard setLoop applies when it switches slices while playing.
      const at = this.position();
      this.startSource(at >= this.slice.start && at < this.slice.end ? at - this.slice.start : 0);
    } else {
      try { await this.audio.play(); } catch (e) { this.onError?.('could not play the preview'); return; }
    }
    this.playing = true;
    this.tick();
  }

  pause() {
    if (this.engine === 'slice') {
      const at = this.position();
      this.stopSource();
      this.audio.currentTime = at / this.sr; // keep the preview in step
    } else {
      this.audio.pause();
    }
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  /** 0.5, 1 or 2: the preview plays at this speed; a slice loop stays at 1×. */
  setRate(rate) {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }

  // region null clears the loop and returns to the preview engine at the
  // current position. A region over the cap loops through the preview by
  // seeking back at its end (see tick).
  async setLoop(region) {
    if (region && region.end <= region.start) region = null;
    const wasPlaying = this.playing;
    const at = this.position();
    this.loop = region;
    if (!region || region.end - region.start > SLICE_CAP_SECONDS * this.sr) {
      if (this.engine === 'slice') { this.stopSource(); this.engine = 'preview'; this.slice = null; }
      this.audio.currentTime = at / this.sr;
      if (wasPlaying) this.audio.play().catch(() => {});
      return;
    }
    const id = ++this.pendingFetch;
    let buffer;
    try {
      const res = await fetch(`/api/slice?file=${encodeURIComponent(this.file)}&from=${region.start}&to=${region.end}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      this.ensureCtx();
      buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      if (id !== this.pendingFetch) return;
      this.stopSource();
      this.slice = null;
      this.loop = null;
      this.engine = 'preview';
      this.audio.currentTime = at / this.sr;
      if (wasPlaying) this.audio.play().catch(() => {});
      this.onError?.('could not load the region for looping; using the preview');
      return;
    }
    if (id !== this.pendingFetch) return; // a newer region superseded this one
    // Keep the old slice playing until the new one is ready, then switch
    // without a gap of silence.
    const playing = this.playing;
    const now = this.position();
    this.stopSource();
    this.audio.pause();
    this.slice = { buffer, start: region.start, end: region.end };
    this.engine = 'slice';
    if (playing) {
      const off = now >= region.start && now < region.end ? now - region.start : 0;
      this.startSource(off);
      this.playing = true;
      this.tick();
    }
  }

  ensureCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sr });
  }

  startSource(offsetFrames) {
    this.ensureCtx();
    const src = this.ctx.createBufferSource();
    src.buffer = this.slice.buffer;
    src.loop = true;
    src.connect(this.ctx.destination);
    src.start(0, offsetFrames / this.sr);
    this.src = src;
    this.sliceStartedAt = this.ctx.currentTime;
    this.sliceOffset = offsetFrames;
  }

  stopSource() {
    if (this.src) { try { this.src.stop(); } catch {} this.src.disconnect(); this.src = null; }
  }

  tick() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (!this.playing) return;
      if (this.engine === 'preview' && this.loop) {
        const p = this.position();
        if (p >= this.loop.end || p < this.loop.start) this.audio.currentTime = this.loop.start / this.sr;
      }
      this.onTick?.(this.position());
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    this.pause();
    this.audio.src = '';
    this.ctx?.close?.();
    this.ctx = null;
    this.src = null;
    this.slice = null;
  }
}
