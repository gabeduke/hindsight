// web/static/lib/room/tap.js
// A tap plays (docs/superpowers/specs/2026-10-15-flow-design.md, "One way to
// listen"): tapping a take anywhere in the Listening Room plays it in the
// bar, where you are, and tapping it again pauses it. Nothing opens. This is
// the one function every surface calls -- a spine on the shelf, a row of the
// List (a month's box opens to it, a search narrows it, a family's takes
// stand in it). The take list, its players and the bar are handed in.

/**
 * createTap answers {tap, warm}.
 *   takes  the page's TakesList: `all`, `player(name)`, `refresh()`
 *   bar    () -> the page's bar (pageBar's answer), or null before it is up
 *   toast  (message, kind, {action: {label, run}})
 *   pick   (name) -> the page's own pick, so Play all goes on from here
 *   go     (url) -> leave for that page (Open); later: setTimeout, for the retry
 *
 * A take that can't play yet (no preview: still encoding, or no waveform to
 * play from) says so with **Open** on the toast -- its page needs no preview, so
 * the take is never a dead end -- and is looked for again every 1.5 s, ten
 * times. When it turns up it is put in the bar *paused*, ▶ ready: a retry is
 * not inside the finger's tap, and a phone won't start sound from it.
 */
export const RETRY_MS = 1500;
export const RETRIES = 10;
export const openHref = (name) => `/wave.html?file=${encodeURIComponent(name)}`;

export function createTap({ takes, bar, toast, pick, go = (u) => { location.href = u; }, later = setTimeout }) {
  let last = null; // the take tapped last: a late arrival must not displace a newer choice
  const looking = new Set();
  const cannot = (name) => {
    toast?.('Still encoding — a moment', 'warn', { action: { label: 'Open', run: () => go(openHref(name)) } });
    look(name);
  };
  // look asks again until the take can play, then loads it paused.
  function look(name) {
    if (looking.has(name)) return;
    looking.add(name);
    let n = 0;
    const step = async () => {
      n++;
      try { await takes.refresh?.(); } catch { /* the page's own poll will bring it */ }
      const t = takes.all.find((x) => x.name === name);
      const p = t && t.has_preview ? await takes.player(name).catch(() => null) : null;
      if (p && last === name) {
        looking.delete(name);
        const np = bar();
        if (np) { np.loadTake(t, p); toast?.('Ready — tap to play', 'ok'); }
        return;
      }
      if (!t || n >= RETRIES || last !== name) { looking.delete(name); return; }
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
      np.loadTake(t, p);
      const was = p.audio.paused;
      await p.toggle();
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
  // A row's own controls keep their press; so does its waveform, which is the
  // scrub surface, not a play target. (A spine's wave lets the press through to
  // the row, so the place the click landed says whether it was on the wave.)
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
 * askedTake is where `?take=NAME` goes with the rooms on. The Capture page's
 * and the Studio's *Name it*, and a held Capture spine, send the person to
 * /takes.html?take=NAME to name a take, and the sheet it used to open is
 * gone: a take is named on Open, its page. Null when there is nothing to go
 * to (no such parameter, or the rooms are off and the sheet still is).
 */
export function askedTake({ rooms, search }) {
  if (!rooms) return null;
  const name = new URLSearchParams(search).get('take');
  return name ? `/wave.html?file=${encodeURIComponent(name)}` : null;
}
