// web/static/lib/rooms/nocrate.js
// The crate leaves the Studio (docs/superpowers/specs/2026-10-15-flow-design.md,
// F3). The buffer is the only view of what GRAB, Cut and Copy hold, so the
// crate's drawer -- with the clipboard line, its first slot -- the sheet of a
// kept clip, the bar's Crate key and the Keep on a part (a clip's sheet, the
// action bar) are not offered. The crate leaves the screen, not the Pi
// (decision 9): its routes and its clips stay where they are, untouched.
//
// tape.html keeps all of it, so with the rooms off the page is as it was; the
// tape page calls trimTapePage once, before it looks anything up, only with
// the flag on (lib/tape/page.js).

/** CRATE_PARTS are the pieces taken out whole; what they hold goes with them. */
export const CRATE_PARTS = ['drawer-crate', 'crate-sheet', 'np-drawer-crate', 'clip-keep', 'multi-keep'];

/**
 * emptyTapeHint is what an empty tape says it can be started from, besides
 * Tap and a tempo: a bit of a take, GRABbed -- the Send to → Tape it replaces
 * is gone from the take page.
 */
export const emptyTapeHint = () => 'Or GRAB a bit of a take: open one, select the part and press GRAB. Or start from a tempo:';

/** TAKE_PARTS are the crate's on the take page: Send to → Crate, Split here, and the ◫ chip. */
export const TAKE_PARTS = ['keep-clip', 'split-here', 'crate-chip'];

/** trimTakePage takes the crate's pieces out of the take page. */
export function trimTakePage(doc) {
  for (const id of TAKE_PARTS) doc.getElementById(id)?.remove();
}

/** trimTapePage takes the crate's parts out of the tape page and rewrites the empty tape's hint. */
export function trimTapePage(doc) {
  for (const id of CRATE_PARTS) doc.getElementById(id)?.remove();
  const hint = doc.getElementById('tape-empty-from');
  if (hint) {
    const take = doc.createElement('a');
    take.setAttribute('href', '/takes.html'); // a take is chosen in the Listening Room
    take.textContent = 'GRAB a bit of a take';
    const [, rest] = emptyTapeHint().split('GRAB a bit of a take');
    hint.replaceChildren('Or ', take, rest);
  }
}
