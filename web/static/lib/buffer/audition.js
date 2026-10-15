// web/static/lib/buffer/audition.js
// AUDITION: the buffer's window, looped on this device -- never through the
// Pi, so the jam carries on (docs/superpowers/specs/2026-10-15-studio-buffer-design.md).
// The audio is the clipboard's own (GET /api/clipboard/audio: its tracks
// summed, levels and fades as a drop plays them), looped by Web Audio, so
// the seam is sample-exact, not the gap an <audio loop> leaves.

export class Audition {
  /**
   * @param {{onChange?: () => void, fetchImpl?: typeof fetch, Ctx?: typeof AudioContext}} [o]
   */
  constructor({ onChange = () => {}, fetchImpl = globalThis.fetch, Ctx = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
    this.onChange = onChange;
    this.fetchImpl = fetchImpl;
    this.Ctx = Ctx;
    this.ctx = null;
    this.src = null;
    this.key = '';     // what's playing: the buffer as it was when fetched
    this.t0 = 0;       // ctx time its loop began
    this.length = 0;   // seconds
    this.ticket = 0;   // the latest start: one whose audio comes late is dropped
  }

  get playing() { return !!this.src; }

  /** at is how far into the loop it is, in seconds, or null when it's quiet. */
  at() {
    if (!this.src || !this.length) return null;
    return (this.ctx.currentTime - this.t0) % this.length;
  }

  /**
   * play loops the buffer's audio from its start. key names the buffer as
   * it is (model.js boardKey): a play with the same key as the one playing
   * leaves it be; another starts the new audio from its top.
   */
  async play(key) {
    if (this.src && key === this.key) return;
    const ticket = ++this.ticket;
    if (!this.Ctx) throw new Error('this browser can’t play it here');
    this.ctx ||= new this.Ctx();
    // A phone's context starts suspended until a touch resumes it: this
    // runs inside the AUDITION press.
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    const res = await this.fetchImpl(`/api/clipboard/audio?k=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'the buffer is empty' : `HTTP ${res.status}`);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    if (ticket !== this.ticket) return; // stopped, or asked again, meanwhile
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ctx.destination);
    this.t0 = this.ctx.currentTime + 0.02;
    src.start(this.t0);
    this.src = src;
    this.key = key;
    this.length = buf.duration;
    this.onChange();
  }

  stopSource() {
    if (!this.src) return;
    try { this.src.stop(); } catch { /* already */ }
    this.src.disconnect();
    this.src = null;
  }

  /** stop silences it. */
  stop() {
    this.ticket++;
    const was = !!this.src;
    this.stopSource();
    this.key = '';
    if (was) this.onChange();
  }
}
