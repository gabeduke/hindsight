// web/static/lib/ui/press.js
// What a press is, anywhere in the app: one table of the gestures' times and
// distances (GESTURE), one small machine for a key's tap, double tap and hold
// (pressMachine), and bindPress, which wires the machine to an element.
//
// The table holds what each surface already used, each by what it is for:
// gathering them here changed no value. A new hold or double tap takes its
// time from here; lib/architecture.test.js fails on a literal one anywhere
// else, so the app keeps one feel for a hold instead of growing another copy.

export const GESTURE = Object.freeze({
  /** HOLD is how long a still press lasts before it is a hold, by what the hold does. */
  HOLD: Object.freeze({
    select: 500, // a take, held, starts selecting several: the Listening Room's spines, the Takes list
    tape: 300, // the Studio's tape: a part held to slide it, the ruler's range, a section, ● arming another track
    wave: 350, // Open's waveform: hold, then drag, selects (lib/edit/gestures.js)
    ribbon: 350, // the feed's ribbon: hold, then drag, picks a span
    lift: 350, // the buffer sheet's grip, held, lifts the buffer onto a lane
    repeat: 500, // Open's nudge keys (In, Out, bar 1), held, start repeating...
  }),
  REPEAT_MS: 120, // ...a step this often
  TAP_MS: 300, // a press let go this soon, having never moved, is a tap (Open's waveform and its overview)
  SLOP_PX: 8, // a finger this still is a press, not a drag
  SLOP_FINE_PX: 6, // the same on a strip or a grip: the overviews, the buffer's grips
  DOUBLE_MS: 300, // a second tap this soon after the first is a double tap...
  DOUBLE_PX: 20, // ...this near it (Open's waveform, and pressMachine's onDouble)
  DOUBLE_WIDE_PX: 24, // ...or this near, sideways, on the Studio's overview strip
  GRACE_MS: 600, // a click this soon after a drag on the tape ends the drag: it is no tap
  LIFT_GRACE_MS: 400, // how long the click a hold's or a drag's lift leaves behind is waited for (the Takes list, the rig)
  OUTRANK_MS: 400, // a hand's own move of a knob outranks the Pi's echo of it this long (lib/play/amounts.js)
});

// The keys bound with bindPress, by their options: their callers spread
// these, and press.test.js runs every case with them, so a key's feel lives
// in one place and no test keeps its own copy.
/** SPINE_PRESS is a take's spine on the Listening Room's shelf (lib/room/doorway.js). */
export const SPINE_PRESS = Object.freeze({ hold: GESTURE.HOLD.select, slop: GESTURE.SLOP_PX });
/**
 * ARM_PRESS is a track's ● in the Studio (lib/tape/page.js). It never had a
 * slop: a finger that wanders on the key still holds; a scroll cancels it.
 * A long press on a phone is its hold, never the browser's menu.
 */
export const ARM_PRESS = Object.freeze({ hold: GESTURE.HOLD.tape, slop: Infinity, menu: false });

/**
 * pressMachine is a key that taps, double taps and holds. It answers {down,
 * move, up, cancel, click, active}: the element's pointerdown, pointermove,
 * pointerup, pointercancel and pointerleave, and click; bindPress wires them.
 *
 *   onTap     a plain click, a keyboard one (Enter, Space) included. It fires
 *             at once: no tap ever waits to see whether a second is coming.
 *   onDouble  the second of two taps DOUBLE_MS and DOUBLE_PX apart, in place
 *             of its tap (the first has already tapped). Without it, every
 *             tap is a tap.
 *   onHold    the hold, fired while the finger is still down so it is felt,
 *             after `hold` ms (one of GESTURE.HOLD) of a press that never
 *             moved `slop` px; and a ⇧-click, ⇧-Enter included, which is how
 *             a mouse or a keyboard holds. The click that ends a hold is
 *             swallowed, so it does not also tap.
 *   holdBy    the pointers that hold. A mouse's press would catch a slow
 *             click, so it never holds unless a caller lets it.
 *   selecting () -> a selection is on: a tap picks, so there is no hold to
 *             wait for, and two quick taps are two picks, not a double.
 *   now, setTimer, clearTimer   the clock, handed in for the tests.
 */
export function pressMachine({
  onTap, onDouble = null, onHold = null, hold = null, holdBy = ['touch', 'pen'], slop = GESTURE.SLOP_PX,
  selecting = () => false, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  if (onHold && !(hold > 0)) throw new TypeError('pressMachine: a hold needs its time, one of GESTURE.HOLD');
  let timer = null;
  let held = false; // a hold fired, and the click its lift sends is still to come
  let down = false; // the pointer is still on the key
  let byHand = false; // ... and it is one that holds
  let at = null; // where it went down
  let last = null; // the last plain tap, {t, x, y}: the first half of a double
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };
  return {
    down(e) {
      if (e.button > 0) return; // a right or middle button is not a press
      stop();
      held = false;
      down = true;
      byHand = holdBy.includes(e.pointerType);
      at = { x: e.clientX, y: e.clientY };
      // A mouse never holds, and a selection already on needs no hold.
      if (!onHold || !byHand || selecting()) return;
      timer = setTimer(() => {
        timer = null;
        held = true;
        last = null; // a hold is never half of a double
        onHold();
      }, hold);
    },
    move(e) {
      if (timer !== null && at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > slop) stop();
    },
    up() {
      stop();
      down = false;
    },
    // Leaving the key with the finger down, or a scroll taking the touch: no
    // click follows. A touch's pointerleave comes after its lift and before
    // its click, and is not that: the click is still to come.
    cancel() {
      if (!down) return;
      down = false;
      stop();
      held = false;
    },
    /**
     * active says a finger or a pen is on the key, or a hold has just fired:
     * the browser's long-press menu (a contextmenu event) is then not wanted.
     */
    active() { return (down && byHand) || held; },
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
      if (e.shiftKey && onHold) { last = null; onHold(); return; }
      // A keyboard's click, or a tap that picks, is never half of a double.
      if (!onDouble || e.detail === 0 || selecting()) { last = null; onTap(); return; }
      const t = now();
      const p = Number.isFinite(e.clientX) ? { x: e.clientX, y: e.clientY } : at;
      const near = !last?.p || !p || Math.hypot(p.x - last.p.x, p.y - last.p.y) < GESTURE.DOUBLE_PX;
      if (last && t - last.t < GESTURE.DOUBLE_MS && near) {
        last = null;
        onDouble();
        return;
      }
      last = { t, p };
      onTap();
    },
  };
}

/**
 * bindPress makes a pressMachine of opts and wires it to el, and returns it.
 * Besides pressMachine's own, opts take:
 *   onDown(e)  called before the machine sees a pointerdown (the Listening
 *              Room warms a take's player there, so its play is in the tap)
 *   menu       false: the browser's context menu never opens on el. Else it
 *              is held back only while a finger is on el or a hold has just
 *              fired, since a long press on a phone is the menu too.
 */
export function bindPress(el, { onDown = null, menu = true, ...opts }) {
  const press = pressMachine(opts);
  el.addEventListener('pointerdown', (e) => { onDown?.(e); press.down(e); });
  el.addEventListener('pointermove', press.move);
  el.addEventListener('pointerup', press.up);
  for (const ev of ['pointercancel', 'pointerleave']) el.addEventListener(ev, press.cancel);
  el.addEventListener('click', press.click);
  el.addEventListener('contextmenu', (e) => { if (!menu || press.active()) e.preventDefault(); });
  return press;
}
