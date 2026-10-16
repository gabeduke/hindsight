// web/static/lib/buffer/fold.js
// The lanes make room for the buffer: folded to strips while it's open, the
// one under a drag opened again (docs/superpowers/specs/2026-10-15-studio-buffer-design.md).
//
// Folding is a class and nothing else. The lanes' canvases are sized from
// their boxes when the tape page draws them (lib/tape/page.js, drawLanes),
// and a drawer that once reflowed them grew them taller every redraw: so
// nothing here touches a lane, its canvas or its bitmap. The class changes
// heights in CSS (styles.css, Rooms P2; styles.test.js holds it to heights),
// and the page's next draw fits each bitmap to its box, as it always does.

/** The body's classes: the buffer is open; the lanes are folded. */
export const OPEN = 'buffer-open';
export const FOLD = 'buffer-fold';
/** A lane's row while a drag is over it: it opens to full height. */
export const TARGET = 'buffer-target';

/** setOpen marks the buffer open or shut on the body. */
export function setOpen(body, on) {
  body.classList.toggle(OPEN, !!on);
}

/** setFold folds the lanes to strips, or gives them their height back. */
export function setFold(body, on) {
  body.classList.toggle(FOLD, !!on);
}

/** setTarget opens the one row under a drag (null: none) and lets the rest fold. */
export function setTarget(rows, row) {
  for (const r of rows) r.classList.toggle(TARGET, r === row);
}
