// web/static/lib/room/press.js
// What a press on a take is in the Listening Room (docs/superpowers/specs/
// 2026-10-15-flow-design.md, "A tap plays"): a tap plays it, and holding
// selects, as the list's Select does. The hold is a finger's or a pen's: a
// mouse's press would catch a slow click, so a mouse selects with ⇧-click
// (and the keyboard with ⇧-Enter, which the browser sends as a click with
// the ⇧ key and no pointer). With a selection on there is nothing to wait for:
// the caller turns a tap into picking the take in or out.
//
// A small machine with the clock handed in, so it is tested without a
// finger; the page's elements wire their pointer events to it.

import { SELECT_HOLD_MS } from '../shelf.js';

/** SLOP_PX is how far a finger may wander and still be holding. */
const SLOP_PX = 8;

/**
 * pressMachine answers {down, move, up, cancel, click}: a take's pointerdown,
 * pointermove, pointerup, pointercancel/pointerleave and click.
 *   onTap     a plain click, a keyboard one included
 *   onSelect  the hold (while the finger is still down, so it is felt), or a
 *             ⇧-click
 *   selecting () -> a selection is on, so there is no hold to wait for
 * The click that ends a hold is swallowed, so it does not also play.
 */
export function pressMachine({ onTap, onSelect, selecting = () => false, hold = SELECT_HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let held = false;
  let down = false; // the finger is still on it
  let touching = false; // ... and it is a finger or a pen
  let at = null;
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };
  return {
    down(e) {
      if (e.button > 0) return; // a right or middle button is not a press
      stop();
      held = false;
      down = true;
      touching = e.pointerType !== 'mouse';
      at = { x: e.clientX, y: e.clientY };
      // A mouse never holds, and a selection already on needs no hold.
      if (e.pointerType === 'mouse' || selecting()) return;
      timer = setTimer(() => {
        timer = null;
        held = true;
        onSelect();
      }, hold);
    },
    move(e) {
      if (timer !== null && at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > SLOP_PX) stop();
    },
    up() {
      stop();
      down = false;
    },
    // Leaving the take with the finger down, or a scroll taking the touch: no
    // click follows. A touch's pointerleave comes after its lift and before
    // its click, and is not that: the click is still to come.
    cancel() {
      if (!down) return;
      down = false;
      stop();
      held = false;
    },
    /**
     * active says a finger or a pen is on the take, or a hold has just fired:
     * the browser's long-press menu (a contextmenu event) is then not wanted.
     */
    active() { return (down && touching) || held; },
    click(e) {
      stop();
      // The click after a hold is the lift, not a second gesture. One with no
      // pointer (Enter, Space) never is.
      if (held && e.detail !== 0) {
        held = false;
        e.preventDefault?.();
        return;
      }
      held = false;
      if (e.shiftKey) onSelect();
      else onTap();
    },
  };
}
