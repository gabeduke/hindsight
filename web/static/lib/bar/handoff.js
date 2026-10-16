// web/static/lib/bar/handoff.js
// pageBar's side of the hand-off (carry.js has the record): the take the last
// page left is found on this page's list and put in the bar, and what this
// page writes when it is left in turn. Everything the DOM, the clock and the
// storage would give is handed in, so the order of events -- a list that
// comes late, a tap that gets in first, a take this page doesn't hold -- is
// tested as it happens (handoff.test.js).

import { mayCarry } from './carry.js';

/**
 * HOLD_MS is how long the bar stays blank for the carried take to turn up,
 * before it shows the tape. It only caps the blank: a take that turns up
 * later is still put in the bar, within the record's own limit.
 */
export const HOLD_MS = 4000;

/**
 * createHandoff reads the record at once -- before the bar draws anything --
 * and carries it out as the page allows.
 *   carry     createCarry's answer
 *   find      (name) -> {t, player} | 'missing' | null (takesFinder)
 *   tapes     the nav's answer about the tape (a promise: {loaded} or null)
 *   studio    () -> this page is the Studio
 *   takeInBar () -> a take is in the bar now
 *   loadTake  ({t, player}) -> the bar's source for it, now in the bar
 *   showTape  () -> the bar shows the tape (or nothing) after all
 *   state     () -> the bar's take as {take, frame, sr, playing, loop} or null
 *   win, doc  for pagehide and visibilitychange
 *   later     setTimeout
 */
export function createHandoff({ carry, find, tapes, studio, takeInBar, loadTake, showTape, state, win, doc, later = setTimeout }) {
  const rec = carry.peek();
  let holding = !!rec; // the tape waits in the wings
  let pending = !!rec; // the record is still to be applied or judged
  const release = () => { if (!holding) return; holding = false; showTape(); };
  if (rec) later(release, HOLD_MS);

  // What this page writes when it is left: its take; or, with no take in the
  // bar and a record this page has not dealt with, nothing -- the record
  // stands for the next page.
  carry.wire(win, doc, () => {
    const s = state();
    if (s) return s;
    return pending ? undefined : null;
  });

  async function start() {
    if (!rec) return 'none';
    let how;
    try {
      const list = await Promise.resolve(tapes).catch(() => null);
      if (!find || !mayCarry({ studio: studio(), tapeLoaded: !!(list && list.loaded) })) { release(); return 'studio'; }
      how = await carry.arrive(rec, {
        find,
        stillWanted: () => !takeInBar(),
        load: (entry) => { const src = loadTake(entry); release(); return src; },
      });
    } catch (e) {
      console.error('The bar could not pick up its take:', e);
      how = 'later';
    }
    // The record is spent unless this page couldn't hold the take.
    if (how !== 'later') pending = false;
    release();
    return how;
  }

  return { start, holding: () => holding, pending: () => pending, record: rec };
}

/**
 * takesFinder is createHandoff's `find` for a page that lists its takes in a
 * TakesList (`loaded` settles with its first list): the take and its row's
 * player; 'missing' for a take that is not in the list at all; null for one
 * the page doesn't hold (not on its shelf, still encoding).
 */
export function takesFinder(takes) {
  return async (name) => {
    await takes.loaded;
    const t = takes.all.find((x) => x.name === name);
    if (!t) return 'missing';
    const player = await takes.player(name);
    return player ? { t, player } : null;
  };
}
