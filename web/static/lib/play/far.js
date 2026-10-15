// web/static/lib/play/far.js
// The pads another hand is playing -- a phone, a laptop, the controller in
// the Pi -- as this page draws them: bright, with no dim state, because the
// dim one is this hand's. Each change waits for when the Pi says it's heard.
//
// A mark never outlives the sound: any stop clears it, a press here makes
// the pad this hand's, and a (re)connect sets the marks to exactly what the
// Pi says is held. Pure, so it's tested without a page.

export class FarPads {
  constructor() {
    this.lit = new Set();
    this.pending = []; // {pad, on, at}, in the order they came
  }

  has(pad) { return this.lit.has(pad); }

  /** at: the Pi says pad sounds (on) or stops at atMs. */
  at(pad, on, atMs) { this.pending.push({ pad, on: !!on, at: atMs }); }

  /** pressed: this hand pressed pad, so it isn't another's to draw. Returns the pads changed. */
  pressed(pad) {
    this.pending = this.pending.filter((p) => p.pad !== pad || !p.on);
    return this.lit.delete(pad) ? [pad] : [];
  }

  /** hello: exactly these pads are held by others now. Returns the pads changed. */
  hello(held) {
    this.pending = [];
    const next = new Set(held);
    const changed = [...this.lit].filter((p) => !next.has(p)).concat([...next].filter((p) => !this.lit.has(p)));
    this.lit = next;
    return changed;
  }

  /**
   * put: the Pi's own list (held.js, against live.tricks) says pad is (on)
   * or isn't held by another hand. Returns the pads changed.
   */
  put(pad, on) {
    if (!!on === this.lit.has(pad)) return [];
    if (on) this.lit.add(pad); else this.lit.delete(pad);
    return [pad];
  }

  /** tick applies what's due by `now`; returns [{pad, on}] for what changed. */
  tick(now) {
    const out = [];
    const keep = [];
    for (const p of this.pending) {
      if (now < p.at) { keep.push(p); continue; }
      if (p.on === this.lit.has(p.pad)) continue;
      if (p.on) this.lit.add(p.pad); else this.lit.delete(p.pad);
      out.push({ pad: p.pad, on: p.on });
    }
    this.pending = keep;
    return out;
  }
}
