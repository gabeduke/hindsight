// web/static/lib/bar/carry.js
// The bar's hand-off between pages (docs/superpowers/plans/2026-10-15-f4.md;
// docs/superpowers/specs/2026-10-15-flow-design.md, "It keeps playing as you
// move around"). Leaving a page, the bar writes down its take, the frame and
// whether it was playing in sessionStorage; the next page's bar reads that
// before it draws and picks up at the same spot, plus the time away if it
// was playing.
//
// Everything here is behind the rooms flag: with it off nothing is read or
// written and no listener is added. The pure parts -- the record, its
// validation and expiry, the frame maths -- have no DOM; the page's events,
// the storage and the clock are handed in, so tests stand in for all three.

import { on as roomsOn } from '../rooms/flag.js';
import { takeLength } from './take-source.js';

export const CARRY_KEY = 'hindsight.bar.carry';
export const FRAME_KEY = 'hindsight.bar.frame';

/**
 * CARRY_LIMIT_MS is how old a hand-off may be: five minutes. The take in the
 * bar is a person's focus, not a bookmark; a record older than a coffee break
 * is a take they forgot, and resuming it would be the page doing something
 * nobody asked for.
 */
export const CARRY_LIMIT_MS = 5 * 60 * 1000;
/** FRAME_LIMIT_MS is the shorter life of a frame taken for ✎: it is one click from the page it is for. */
export const FRAME_LIMIT_MS = 2 * 60 * 1000;
/** BOUND_MS is how long "I am going to the Studio for the tape" outranks the pagehide that follows. */
export const BOUND_MS = 10 * 1000;
// A record dated a little ahead of now is the same clock a moment apart; a
// lot ahead is a clock that moved.
const SKEW_MS = 5 * 1000;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const alive = (rec, now, limit) => num(rec.at) && now - rec.at <= limit && rec.at - now <= SKEW_MS;

function parse(raw) {
  if (typeof raw !== 'string') return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) && v.v === 1 ? v : null; } catch { return null; }
}

/** validTake: a take's record -- name, a frame at or after 0, a sample rate, whether it played, when. */
function validTake(r) {
  return typeof r.take === 'string' && r.take !== '' && num(r.frame) && r.frame >= 0 && num(r.sr) && r.sr > 0 && typeof r.playing === 'boolean';
}

/**
 * resumeAt says where a take left at `rec.frame` is now, for a take `length`
 * frames long: paused, at its frame; playing, at its frame plus the time
 * away. Null when it was playing and has played to its end meanwhile (the
 * bar has nothing to resume). {frame, playFrame, play}: the spot it was left
 * at, the spot to start from, and whether to start.
 */
export function resumeAt(rec, now, length) {
  const frame = Math.max(0, Math.min(length - 1, Math.round(rec.frame)));
  if (!rec.playing) return { frame, playFrame: frame, play: false };
  const away = Math.max(0, now - rec.at);
  const playFrame = Math.round(frame + (away * rec.sr) / 1000);
  if (playFrame >= length) return null;
  return { frame, playFrame, play: true };
}

/**
 * mayCarry says whether a take may go in this page's bar. The Studio's bar
 * is the tape's: with a tape loaded there, a take does not displace it.
 */
export function mayCarry({ studio, tapeLoaded }) {
  return !(studio && tapeLoaded);
}

/** isStudio: the pages that are the Studio with the rooms on (Capture is, with the tape off). */
export const isStudio = (pathname) => pathname === '/' || pathname === '/index.html' || pathname === '/tape.html';

export function createCarry({ storage, now = Date.now, enabled = () => true } = {}) {
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch { /* this tab only: nothing to carry */ } };
  const del = (k) => { try { storage.removeItem(k); } catch { /* as above */ } };
  const ok = () => !!storage && enabled();

  const self = {
    /**
     * read is the record the last page left, once: reading removes it, so a
     * reload can't play the same time away twice. Null when there is none, it
     * is stale, or it was left for the tape. The caller still checks that the
     * take is one it holds.
     */
    read() {
      if (!ok()) return null;
      const raw = get(CARRY_KEY);
      if (raw == null) return null;
      del(CARRY_KEY);
      const r = parse(raw);
      if (!r || r.for || !validTake(r) || !alive(r, now(), CARRY_LIMIT_MS)) return null;
      return r;
    },

    /**
     * leave writes the bar's state for the next page: `s` is {take, frame,
     * sr, playing}, or null for a bar that holds no take, which lets an older
     * record go so one never outlives the focus it describes. A page that said
     * it is going to the Studio for the tape (forTheTape) keeps that.
     */
    leave(s) {
      if (!ok()) return;
      const held = parse(get(CARRY_KEY));
      if (held && held.for === 'tape' && alive(held, now(), BOUND_MS)) return;
      if (!s) { del(CARRY_KEY); return; }
      set(CARRY_KEY, { v: 1, take: s.take, frame: Math.round(s.frame), sr: s.sr, playing: !!s.playing, at: now() });
    },

    /**
     * forTheTape is said just before a page goes to the Studio for the tape --
     * GRAB, Open in the Studio -- so the take does not go along: the Studio's
     * bar holds the tape. The pagehide that follows leaves it alone.
     */
    forTheTape() {
      if (!ok()) return;
      set(CARRY_KEY, { v: 1, for: 'tape', at: now() });
    },

    /** drop lets any record go: the Studio's own page, whose bar can't hold a take. */
    drop() { if (ok()) del(CARRY_KEY); },

    /**
     * wire writes on pagehide and when the page goes hidden -- on an iPhone
     * pagehide isn't reliable when the app is switched away or swiped off,
     * but visibilitychange is -- and lets the record go when the page is
     * restored from the back-forward cache, alive again. `state` returns the
     * bar's {take, frame, sr, playing}, null for none, or undefined to leave
     * the record as it is.
     */
    wire(target, doc, state) {
      if (!ok()) return;
      // undefined: nothing was done here to the take (the take page opened
      // and left alone); what the page before left stands.
      const write = () => { const s = state(); if (s !== undefined) self.leave(s); };
      target.addEventListener('pagehide', write);
      doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') write(); });
      target.addEventListener('pageshow', (e) => { if (e && e.persisted) self.drop(); });
    },

    /**
     * resume puts take source `src` (already in the bar) where the record
     * says. It tries to play if the take was playing, with audio.play() and
     * not the row's toggle, whose refusal toasts; if the browser refuses (a
     * new page, nothing tapped on it: Safari on an iPhone always) the take
     * lands at the frame it was left at, paused, with ▶ ready. Never throws.
     * 'playing' | 'ready' | 'paused' | 'gone'.
     */
    async resume(rec, src) {
      const at = resumeAt(rec, now(), src.length);
      if (!at) return 'gone';
      if (!at.play) { src.seek(at.frame); return 'paused'; }
      src.seek(at.playFrame);
      try {
        await src.audio.play();
        return 'playing';
      } catch {
        // Still where the attempt put it: back to the spot it was left at.
        // Moved by the person since: theirs.
        if (src.pos() === at.playFrame) src.seek(at.frame);
        return 'ready';
      }
    },

    /**
     * arrive is the whole arrival: `find(name)` answers what the page holds
     * for that take ({t, player}) or null, `load(entry)` puts it in the bar
     * and answers its source. A take it doesn't hold, or that ended while
     * away, is not loaded.
     */
    async arrive(rec, { find, load }) {
      if (!rec) return 'none';
      const entry = await find(rec.take);
      if (!entry) return 'gone';
      if (!resumeAt(rec, now(), takeLength(entry.t, entry.player.peaks))) return 'gone';
      return self.resume(rec, load(entry));
    },

    /** frameNow is the bar's take and frame at this moment, or null with none: ✎ takes it before the page changes. */
    frameNow(state) {
      const s = state();
      return s ? { take: s.take, frame: Math.round(s.frame), sr: s.sr, playing: !!s.playing, at: now() } : null;
    },

    /** stashFrame keeps the frame for the next page (the note ✎ starts there). Null with no take. */
    stashFrame(s) {
      if (!ok() || !s) return null;
      const f = { v: 1, take: s.take, frame: Math.round(s.frame), sr: s.sr, at: now() };
      set(FRAME_KEY, f);
      return f;
    },

    /**
     * takeStashedFrame is the frame stashFrame kept, once -- {take, frame, sr},
     * the frame at the tap and not moved by the gap -- or null when there is
     * none, it is stale, or `take` is given and it is another's.
     */
    takeStashedFrame(take) {
      if (!ok()) return null;
      const raw = get(FRAME_KEY);
      if (raw == null) return null;
      const r = parse(raw);
      if (r && take != null && r.take !== take) return null;
      del(FRAME_KEY);
      if (!r || typeof r.take !== 'string' || !num(r.frame) || r.frame < 0 || !num(r.sr) || !alive(r, now(), FRAME_LIMIT_MS)) return null;
      return { take: r.take, frame: r.frame, sr: r.sr };
    },
  };
  return self;
}

/** forTheTape: this page is going to the Studio for the tape -- a GRAB, Open in the Studio -- so no take goes along. */
export const forTheTape = () => pageCarry().forTheTape();

/** pageCarry is the hand-off for this page: this tab's sessionStorage, the rooms flag. */
export function pageCarry() {
  let storage = null;
  try { storage = globalThis.sessionStorage; } catch { /* blocked: nothing carries */ }
  return createCarry({ storage, enabled: roomsOn });
}
