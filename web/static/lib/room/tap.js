// web/static/lib/room/tap.js
// A tap plays (docs/superpowers/specs/2026-10-15-flow-design.md, "One way to
// listen"): tapping a take anywhere in the Listening Room plays it in the
// bar, where you are, and tapping it again pauses it. Nothing opens. This is
// the one function every surface calls -- a spine on the shelf, a row of the
// List (a month's box opens to it, a search narrows it, a family's takes
// stand in it). The take list, its players and the bar are handed in.

import { report } from '../objects/motion.js';
import { spineTitle } from '../shelf.js';
import { named } from '../rooms/words.js';

/**
 * createTap answers {tap, warm}.
 *   takes  the page's TakesList: `all`, `player(name)`, `refresh()`
 *   bar    () -> the page's bar (pageBar's answer), or null before it is up
 *   toast  (message, kind, {action: {label, run}})
 *   pick   (name) -> the page's own pick, so Play all goes on from here
 *   go     (url) -> leave for that page (Open); later: setTimeout, for the retry
 *   onPlay (name, {placed, audio}) -> a take was just set playing: `placed` when it was not
 *          in the bar already; `audio` is its own element, for what lives as long as the sound (the flight to the deck runs beside the sound, and
 *          is only asked for once the sound has been)
 *   onStop (name) -> that take is not playing (paused, or the browser refused it)
 *
 * A take that can't play yet (no preview: still encoding, or no waveform to
 * play from) says so with **Open** on the toast -- its page needs no preview, so
 * the take is never a dead end -- and is looked for again every 1.5 s, ten
 * times. When it turns up it is put in the bar *paused*, ▶ ready, only if the
 * person has done nothing meanwhile: a retry is not inside the finger's tap (a
 * phone won't start sound from it), and it must never override what they did
 * (F4's rule). So nothing is loaded -- and nothing is paused or replaced -- if
 * anything is playing, if the bar's take is no longer the one it held when the
 * look began, if the bar has been used since (its keys, strip or ⏏), or if
 * another take was tapped; the toast then just says the take is ready. One toast
 * per take at a time: a new one puts the old away.
 */
export const RETRY_MS = 1500;
// A hook the page gave (the flight) is not the tap's to fail on: it is heard, and the tap goes on.
const hear = (fn, ...args) => { try { fn?.(...args); } catch (e) { report(e); } };
export const RETRIES = 10;
export const openHref = (name) => `/wave.html?file=${encodeURIComponent(name)}`;

export function createTap({ takes, bar, toast, pick, go = (u) => { location.href = u; }, later = setTimeout, onPlay, onStop }) {
  let last = null; // the take tapped last
  const looking = new Set();
  const shown = new Map(); // name -> its toast
  const say = (name, msg, kind, opts) => {
    shown.get(name)?.dismiss?.();
    shown.set(name, toast?.(msg, kind, opts));
  };
  const open = (name) => ({ action: { label: 'Open', run: () => go(openHref(name)) } });
  const cannot = (name) => {
    say(name, 'Still encoding — a moment', 'warn', open(name));
    look(name);
  };
  // What the bar was when the look began, to tell whether the person has done anything since.
  const stateOf = () => { const np = bar(); return { take: np?.takeName ?? null, touches: np?.touches ?? 0 }; };
  // look asks again until the take can play, then loads it paused -- or says it is ready.
  function look(name) {
    if (looking.has(name)) return;
    looking.add(name);
    const began = stateOf();
    let n = 0;
    const arrive = (t, p) => {
      const np = bar();
      const now = stateOf();
      const untouched = last === name && now.take === began.take && now.touches === began.touches && !np?.playing?.();
      if (np && untouched) { np.loadTake(t, p); say(name, 'Ready — tap to play', 'ok'); }
      else say(name, `${named(spineTitle(t))} is ready — tap it`, 'ok');
    };
    const step = async () => {
      n++;
      try { await takes.refresh?.(); } catch { /* the page's own poll will bring it */ }
      const t = takes.all.find((x) => x.name === name);
      const p = t && t.has_preview ? await takes.player(name).catch(() => null) : null;
      if (p) { looking.delete(name); arrive(t, p); return; }
      if (!t) { looking.delete(name); return; }
      if (n >= RETRIES) { looking.delete(name); say(name, 'Still no preview — open it to see why', 'warn', open(name)); return; }
      if (last !== name) { looking.delete(name); return; } // the person moved on
      later(step, RETRY_MS);
    };
    later(step, RETRY_MS);
  }
  return {
    /**
     * tap puts take `name` in the bar and plays it; the same take again
     * pauses it. Answers what happened: 'played', 'paused', 'encoding',
     * 'missing' or 'no bar'.
     */
    async tap(name) {
      const t = takes.all.find((x) => x.name === name);
      if (!t) return 'missing';
      const np = bar();
      if (!np) return 'no bar';
      last = name;
      if (!t.has_preview) { cannot(name); return 'encoding'; }
      const p = await takes.player(name);
      if (!p) { cannot(name); return 'encoding'; }
      pick?.(name);
      // The same take with the same player is left in the bar as it is.
      const placed = np.takeName !== name;
      np.loadTake(t, p);
      const was = p.audio.paused;
      // The sound is asked for first, inside the tap, and nothing below waits
      // for it or comes before it: the flight is only a picture of it.
      const sounding = p.toggle();
      hear(was ? onPlay : onStop, name, { placed, audio: p.audio });
      await sounding;
      if (was && p.audio.paused) hear(onStop, name); // refused: no flight for a sound that is not coming
      return was ? 'played' : 'paused';
    },
    /**
     * warm fetches a take's player now -- as the finger goes down -- so that
     * the toggle is in the press that asked, which a phone needs to play.
     */
    warm(name) {
      if (!takes.all.some((x) => x.name === name)) return;
      takes.player(name).catch(() => {});
    },
  };
}

/**
 * wireRack wires the List's rows (the rack's `.take` rows) to a tap: a click
 * on a row's body plays it, ⇧-click starts a selection with it, and Enter and
 * Space on a focused row do the same (⇧ selects; with a selection on a key
 * picks the row in or out). The row's own controls keep their press. With a
 * selection on, a click is select mode's (lib/takes.js wireSelect toggles it
 * on the way down), so it is left alone here. A hold on a finger is
 * wireSelect's too.
 */
export function wireRack(container, { takes, tap }) {
  // A row's own controls keep their press; so does its waveform, which is not a
  // play target. (On a spine the wave has pointer-events: none, so a click over it
  // arrives as the row's own, and the place it landed says whether it was on the
  // wave. That stretch -- about 7% of a phone's row -- does nothing, and nothing
  // there seeks either; a waveform that scrubs is Open's.)
  const OWN = 'button, a, input, .take-flag, .take-flag-edit, .wave';
  const onWave = (row, e) => {
    const w = row.querySelector('.wave');
    const r = w && w.getBoundingClientRect();
    return !!r && r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const rowOf = (e) => e.target.closest('.take');
  container.addEventListener('pointerdown', (e) => {
    const row = rowOf(e);
    if (row && !takes.selecting) tap.warm(row.dataset.name);
  });
  container.addEventListener('click', (e) => {
    if (takes.selecting) return;
    const row = rowOf(e);
    if (!row || e.target.closest(OWN) || onWave(row, e)) return;
    if (e.shiftKey) { takes.enterSelect(row.dataset.name); return; }
    tap.tap(row.dataset.name);
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = rowOf(e);
    if (!row || e.target !== row) return; // a row's own controls keep their keys
    e.preventDefault();
    const name = row.dataset.name;
    if (takes.selecting) takes.toggleSelected(name);
    else if (e.shiftKey) takes.enterSelect(name);
    else tap.tap(name);
  });
}

/**
 * askedTake is where `?take=NAME` goes. The Studio's *Name it*, and a held
 * spine, send the person to /takes.html?take=NAME to name a take, and the
 * sheet it used to open is gone: a take is named on Open, its page. Null
 * when there is nothing to go to (no such parameter).
 */
export function askedTake({ search }) {
  const name = new URLSearchParams(search).get('take');
  return name ? `/wave.html?file=${encodeURIComponent(name)}` : null;
}
