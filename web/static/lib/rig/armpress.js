// web/static/lib/rig/armpress.js
// What a press on a track's ● is (docs/superpowers/specs/
// 2026-10-15-flow-design.md, "● arms one; holding ● adds one"): a tap arms
// just that track, and a hold -- or a ⇧-click, or ⇧-Enter, on a laptop -- arms
// it as well. A small machine with the clock handed in, so it is tested
// without a finger; the page wires its events to it (tape/page.js).
import { HOLD_MS } from '../tape/clipgestures.js';

/**
 * armPress answers {down, up, cancel, click}, the ● button's pointerdown,
 * pointerup, pointercancel/pointerleave and click. onAdd fires once, at the
 * hold (while the finger is still down, so it is felt), and the click that
 * follows the lift is swallowed -- for a finger or a pen; a mouse has no hold,
 * it adds with a ⇧-click. onTap fires on a plain click, a keyboard
 * one included.
 */
export function armPress({ onTap, onAdd, hold = HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let held = false;
  let down = false; // the finger or button is still on it
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };
  return {
    down(e) {
      if (e.button > 0) return; // a right or middle button is not a press
      stop();
      held = false;
      down = true;
      // A hold is a finger's or a pen's. A mouse adds with ⇧-click; a slow
      // click is only a tap.
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      timer = setTimer(() => {
        timer = null;
        held = true;
        onAdd();
      }, hold);
    },
    up() {
      stop();
      down = false;
    },
    // Leaving the ● with the finger down, or a scroll taking the touch: no
    // click follows. A touch's pointerleave comes after its lift and before
    // its click, and is not that: the click is still to come.
    cancel() {
      if (!down) return;
      down = false;
      stop();
      held = false;
    },
    click(e) {
      stop();
      // The click after a hold is the lift, not a second gesture. One with
      // no pointer (Enter, Space) never is.
      if (held && e.detail !== 0) {
        held = false;
        if (e.preventDefault) e.preventDefault();
        return;
      }
      held = false;
      if (e.shiftKey) onAdd();
      else onTap();
    },
  };
}
