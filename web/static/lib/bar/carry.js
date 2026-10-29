// web/static/lib/bar/carry.js
// The bar's hand-off between pages (docs/superpowers/plans/2026-10-15-f4.md;
// docs/decisions/0002-two-nouns-takes-and-tapes.md: it keeps playing as
// you move around). Leaving a page, the bar writes down its take, the frame and
// whether it was playing in sessionStorage; the next page's bar reads that
// before it draws and picks up at the same spot, plus the time away if it
// was playing.
//
// With no storage (blocked) nothing is read or written and no listener is
// added. The pure parts -- the record, its validation and expiry, the frame
// maths -- have no DOM; the page's events, the storage and the clock are
// handed in, so tests stand in for all three.

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
  return typeof r.take === 'string' && r.take !== '' && num(r.frame) && r.frame >= 0 && num(r.sr) && r.sr > 0 && typeof r.playing === 'boolean'
    && (r.loop === undefined || typeof r.loop === 'boolean'); // a record without loop: not repeating
}

/**
 * resumeAt says where a take left at `rec.frame` is now, for a take `length`
 * frames long: paused, at its frame; playing, at its frame plus the time
 * away. A take on Repeat (`rec.loop`) never ends: the gap wraps round it.
 * Null when it was playing and has played to its end meanwhile (the bar has
 * nothing to resume). {frame, playFrame, play}: the spot it was left at, the
 * spot to start from, and whether to start.
 */
export function resumeAt(rec, now, length) {
  const frame = Math.max(0, Math.min(length - 1, Math.round(rec.frame)));
  if (!rec.playing) return { frame, playFrame: frame, play: false };
  const away = Math.max(0, now - rec.at);
  let playFrame = Math.round(frame + (away * rec.sr) / 1000);
  if (rec.loop) playFrame %= length;
  else if (playFrame >= length) return null;
  return { frame, playFrame, play: true };
}

/**
 * mayCarry says whether a take may go in this page's bar. Both rooms share
 * NowPlaying, so a take carries into the Studio too.
 */
export function mayCarry() {
  return true;
}

/** isStudio: the pages that are the Studio (`/` is, with the tape off). */
export const isStudio = (pathname) => pathname === '/' || pathname === '/index.html' || pathname === '/tape.html';

export function createCarry({ storage, now = Date.now } = {}) {
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch { /* this tab only: nothing to carry */ } };
  const del = (k) => { try { storage.removeItem(k); } catch { /* as above */ } };
  const ok = () => !!storage;

  const self = {
    /**
     * peek is the record the last page left, or null: none, stale, dated in
     * the future, garbage, or left for the tape -- those are let go. A good
     * record stays where it is until it is applied or judged (consume): a
     * page that cannot hold the take, or hears of it late, leaves it for the
     * next page.
     */
    peek() {
      if (!ok()) return null;
      const raw = get(CARRY_KEY);
      if (raw == null) return null;
      const r = parse(raw);
      if (!r || r.for || !validTake(r) || !alive(r, now(), CARRY_LIMIT_MS)) { del(CARRY_KEY); return null; }
      return r;
    },

    /**
     * loopOf is whether Repeat was on in the record for `take`, without using
     * the record up: undefined when there is none, it is for another take, or
     * it is stale. The take page carries it on (its own Repeat is a
     * selection's, not the bar's).
     */
    loopOf(take) {
      if (!ok()) return undefined;
      const r = parse(get(CARRY_KEY));
      if (!r || r.for || !validTake(r) || r.take !== take || !alive(r, now(), CARRY_LIMIT_MS)) return undefined;
      return !!r.loop;
    },

    /** consume lets `rec` go once it is used, unless a newer record has replaced it since. */
    consume(rec) {
      if (!ok() || !rec) return;
      const held = parse(get(CARRY_KEY));
      if (held && held.at === rec.at) del(CARRY_KEY);
    },

    /** read is peek and consume in one: the record, once. */
    read() {
      const r = self.peek();
      self.consume(r);
      return r;
    },

    /**
     * leave writes the bar's state for the next page: `s` is {take, frame,
     * sr, playing, loop}, or null for a bar that holds no take, which lets an
     * older record go so one never outlives the focus it describes. A page
     * that said it is going to the Studio for the tape (forTheTape) keeps
     * that. Answers the record it wrote, or null.
     */
    leave(s) {
      if (!ok()) return null;
      const held = parse(get(CARRY_KEY));
      if (held && held.for === 'tape' && alive(held, now(), BOUND_MS)) return null;
      if (!s) { del(CARRY_KEY); return null; }
      const rec = { v: 1, take: s.take, frame: Math.round(s.frame), sr: s.sr, playing: !!s.playing, loop: !!s.loop, at: now() };
      set(CARRY_KEY, rec);
      return rec;
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
      // The record a hidden page wrote: if the page comes back visible it was
      // not leaving after all, and a page killed some other way (iOS does)
      // must not leave a "playing" for a later page to apply.
      let hidden = null;
      const write = () => { const s = state(); return s === undefined ? null : self.leave(s); };
      target.addEventListener('pagehide', () => { hidden = null; write(); });
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') hidden = write();
        else if (hidden) { self.consume(hidden); hidden = null; }
      });
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
      if (rec.loop) src.setLoop?.(true); // Repeat was on: it still is
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
     * arrive is the whole arrival. `find(name)` answers what the page holds
     * for that take ({t, player}), 'missing' when the take no longer exists,
     * or null when this page can't hold it (not on its shelf, still
     * encoding); it may take as long as the page's list does. `load(entry)`
     * puts it in the bar and answers its source; `stillWanted()` says the
     * person hasn't picked something else meanwhile. The record is used up
     * only when it is applied or judged -- a take that is gone, stale, or
     * ended while away -- and left for the next page when this one can't hold
     * the take. 'applied' results are resume's: 'playing' | 'ready' |
     * 'paused'; the rest: 'none' | 'later' | 'superseded' | 'gone' | 'stale'.
     */
    async arrive(rec, { find, load, stillWanted = () => true }) {
      if (!rec) return 'none';
      const entry = await find(rec.take);
      if (entry === 'missing') { self.consume(rec); return 'gone'; }
      if (!entry) return 'later';
      if (!stillWanted()) { self.consume(rec); return 'superseded'; } // the person moved on: spent
      if (!alive(rec, now(), CARRY_LIMIT_MS)) { self.consume(rec); return 'stale'; }
      if (!resumeAt(rec, now(), takeLength(entry.t, entry.player.peaks))) { self.consume(rec); return 'gone'; }
      const src = load(entry);
      self.consume(rec);
      return self.resume(rec, src);
    },

    /** frameNow is the bar's take and frame at this moment, or null with none: ✎ takes it before the page changes. */
    frameNow(state) {
      const s = state();
      return s ? { take: s.take, frame: Math.round(s.frame), sr: s.sr, playing: !!s.playing, ...(num(s.length) ? { length: s.length } : {}), at: now() } : null;
    },

    /**
     * stashFrame keeps the frame for the next page (the note ✎ starts there).
     * Null with no take. A take that has ended sits at its length, one frame
     * past its last: with `s.length` known the frame is clamped to length - 1.
     */
    stashFrame(s) {
      if (!ok() || !s) return null;
      let frame = Math.round(s.frame);
      if (num(s.length) && s.length > 0) frame = Math.min(frame, s.length - 1);
      const f = { v: 1, take: s.take, frame, sr: s.sr, at: now() };
      set(FRAME_KEY, f);
      return f;
    },

    /**
     * takeStashedFrame is the frame stashFrame kept, once -- {take, frame, sr},
     * the frame at the tap and not moved by the gap -- or null when there is
     * none, it is stale, or it is another take's. `take` is the page's own
     * take and is required: a page that does not name it is handed nothing
     * (and the stash stays), so a stale stash from another take can't apply.
     */
    takeStashedFrame(take) {
      if (!ok()) return null;
      const raw = get(FRAME_KEY);
      if (raw == null) return null;
      const r = parse(raw);
      if (r && r.take !== take) return null;
      del(FRAME_KEY);
      if (!r || typeof r.take !== 'string' || !num(r.frame) || r.frame < 0 || !num(r.sr) || !alive(r, now(), FRAME_LIMIT_MS)) return null;
      return { take: r.take, frame: r.frame, sr: r.sr };
    },

    /**
     * arrival is where Open (the take page with the rooms on) starts for take
     * `file`, `length` frames long: {frame, left, play, note}. `left` is the frame the bar left it at; `frame` and `play`
     * are the bar's own spot, as resumeAt reads the record the page before
     * left -- its frame, plus the time away if it was playing -- so the page
     * opens where the bar was and the take plays on. `note` is the frame ✎
     * took, held inside the take, or null: the page makes a note there. The
     * record is left standing (the page's own say, takePageState, judges it);
     * the stash is used up. Anything else: the top, paused, no note.
     */
    arrival(file, length) {
      const none = { frame: 0, left: 0, play: false, note: null };
      if (!ok() || typeof file !== 'string' || !(length > 0)) return none;
      const inside = (f) => Math.max(0, Math.min(length - 1, Math.round(f)));
      const stash = self.takeStashedFrame(file);
      const note = stash ? inside(stash.frame) : null;
      const rec = self.peek();
      const at = rec && rec.take === file ? resumeAt(rec, now(), length) : null;
      if (at) return { frame: at.play ? at.playFrame : at.frame, left: at.frame, play: at.play, note };
      return { frame: note ?? 0, left: note ?? 0, play: false, note };
    },
  };
  return self;
}

/**
 * startOpen puts Open where `arrival` says and tries to play on. A sound the
 * browser refuses (nothing tapped on this page: Safari on an iPhone always)
 * leaves the take waiting at the frame the bar left it, paused, unless the
 * person moved the playhead meanwhile. 'playing' | 'ready' | 'paused'. Never throws.
 */
export async function startOpen(arrival, { seek, pos, play }) {
  seek(arrival.frame);
  if (!arrival.play) return 'paused';
  try { await play(); return 'playing'; } catch {
    if (pos() === arrival.frame) seek(arrival.left);
    return 'ready';
  }
}

/** forTheTape: this page is going to the Studio for the tape -- a GRAB, Open in the Studio -- so no take goes along. */
export const forTheTape = () => pageCarry().forTheTape();

/** pageCarry is the hand-off for this page: this tab's sessionStorage. */
export function pageCarry() {
  let storage = null;
  try { storage = globalThis.sessionStorage; } catch { /* blocked: nothing carries */ }
  return createCarry({ storage });
}

/**
 * studioVisit is what the Studio's own page (tape.html) does with the hand-off:
 * nothing. Its bar is the tape's and never reads the record, so a take can't
 * displace the tape; and it writes none, so the Room's record stands while
 * the person is there -- the Rig and the guide are the same -- and the
 * Listening Room, back, finds the take (the record's own five minutes
 * and its `at` cover the gap). It answers what it did, for the test.
 */
export function studioVisit(carry) { void carry; return 'transparent'; }

/** openTheTape: go to the Studio for the tape from a page with its own deck (the take page's toasts): no take goes along. */
export function openTheTape({ carry = pageCarry(), go = (u) => { location.href = u; } } = {}) {
  carry.forTheTape();
  go('/tape.html');
}

/**
 * takePageState is the take page's say in the hand-off: its take, the cursor
 * and whether it plays -- but only once something was done there (played, or
 * the playhead moved from where it began). Opened and left alone it answers
 * undefined, so the record the Room left stands. `now()` is {frame, playing};
 * `loop` is the Repeat flag the Room's record had for this take (carry.loopOf),
 * so playing here doesn't lose it.
 */
export function takePageState({ file, sr, from, now, loop }) {
  let touched = false;
  return () => {
    const n = now();
    touched = touched || n.playing || n.frame !== from;
    if (!touched) return undefined;
    const s = { take: file, frame: n.frame, sr, playing: n.playing };
    if (loop !== undefined) s.loop = loop; // the Room's Repeat for this take, as it left it
    return s;
  };
}
