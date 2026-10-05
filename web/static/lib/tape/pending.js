// Mutes and solos asked for on a page that hears the tape late: the key
// lights at once, but the track sounds as before until the change reaches
// the speaker.
export class Pending {
  constructor() { this.marks = new Map(); }

  ask(n, before, delayMs, now) {
    const m = this.marks.get(n);
    if (m && now < m.until) m.until = now + delayMs;
    else this.marks.set(n, { mute: !!before.mute, solo: !!before.solo, until: now + delayMs });
  }

  pending(n, now) {
    const m = this.marks.get(n);
    return !!m && now < m.until;
  }

  heard(n, current, now) {
    const m = this.marks.get(n);
    if (m && now < m.until) return { mute: m.mute, solo: m.solo };
    this.marks.delete(n);
    return { mute: !!current.mute, solo: !!current.solo };
  }
}
