// web/static/lib/play/keymap.js
// The PC keyboard as a controller. One of the adapters over
// lib/play/surface.js; it does nothing the touch adapter and the MIDI one
// (midi.js) do not also do.
//
// Keys are read by `code`, the physical position, not by `key`, the letter
// printed on it. An instrument's layout should be where your fingers are, so
// the pads stay in the same places on AZERTY and Dvorak.
//
// The tables come from controls.js, the one list of actions: the strip's
// keys are the spec's "Play keys" column, and they are the strip's only
// while it has the keyboard (owns()). Folded, or given back by a tap on the
// lanes, the tape page's own keys are the page's again: R records and 1
// arms track 1.

import { keyTables, TRACK_PADS, TRICK_PADS } from './controls.js';

export { TRACK_PADS, TRICK_PADS };

/**
 * KEYMAP and COMMANDS are the play keys with every flag on: a code to the
 * pad it holds, and a code to the command (or the latch) it runs. Fixed,
 * deliberately -- remapping the computer's keys is a settings surface, and
 * MIDI LEARN is where remapping matters (the spec, "Not in this").
 */
export const { pads: KEYMAP, commands: COMMANDS } = keyTables(() => true);

/** padForKey is the pad a physical key plays, or null. */
export function padForKey(code, has = () => true) {
  return keyTables(has).pads[code] || null;
}

/** commandForKey is the command a key runs, or null. */
export function commandForKey(code, has = () => true) {
  return keyTables(has).commands[code] || null;
}

/**
 * typingInto says the key belongs to a field rather than to the instrument.
 * Without this, naming a take would play the tape. A level fader isn't a
 * field -- its focus mustn't swallow the keys, as on the page
 * (lib/tape/page.js) and in the buffer's keys. Nor is a knob, but it
 * keeps the keys that turn it: see knobKeeps.
 */
export function typingInto(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && el.type !== 'range';
}

// The keys a focused knob turns with (mods.js, knobStep). None of them is a
// play key.
const KNOB_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * knobKeeps says a key belongs to a focused knob -- a tape mod's, or the
 * bend: its arrows turn it, so they must reach it. Every other key is still
 * the instrument's, as with a level fader: a knob turned mid-jam mustn't
 * leave the pads deaf until something else is clicked.
 */
export function knobKeeps(el, code) {
  return !!el && typeof el.getAttribute === 'function' && el.getAttribute('role') === 'slider' && KNOB_KEYS.has(code);
}

// Where ↵ belongs to what has the focus, as the buffer's keys decide it
// (lib/buffer/keys.js): a link, a menu's item, anything in a sheet; and a
// button the keyboard brought the focus to -- Tab to it and ↵ presses it. A
// button that was clicked gives ↵ up to DROP, and ▶ never keeps it.
const OWN_ENTER = 'a[href], [role="menuitem"], [role="option"], [role="menu"], dialog';

/** keepsEnter says ↵ is the focused element's, not DROP's. `keyed(el)`: the keyboard focused el. */
export function keepsEnter(t, keyed = () => true) {
  if (!t || typeof t.closest !== 'function') return false;
  if (t.closest(OWN_ENTER)) return true;
  const b = t.closest('button:not(#play)');
  return !!b && keyed(b);
}

/**
 * bindKeyboard wires a surface to a target (the document, normally) and
 * returns a function that unwires it.
 *
 * `owns()` says whether the strip has the keyboard now; `has(need)` whether
 * a flag an action needs is on (the rooms' verbs). Commands go to
 * onCommand(name); the latch (⇧) goes to the surface.
 *
 * The part worth not getting wrong is letting go. A key held while the window
 * loses focus never sends its keyup -- alt-tab with break held and the tape
 * stays broken forever, with no key to press to fix it, because the browser
 * stopped telling us about that key the moment focus left. So blur and a
 * hidden tab both release everything. And a pad pressed here is let go here
 * on its keyup even if the keys have gone back to editing meanwhile.
 */
export function bindKeyboard(surface, {
  target = document,
  win = typeof window !== 'undefined' ? window : null,
  now = () => performance.now(),
  onCommand = () => {},
  owns = () => true,
  has = () => true,
  onLetGo = () => {},
} = {}) {
  const held = new Map(); // code → pad, for what this keyboard is holding
  let latched = false;    // the latch is down from a ⇧ here
  let byKey = false;            // the last input was a key, not a press
  const keyed = new WeakSet();  // what the keyboard brought the focus to
  const pressed = () => { byKey = false; };
  const focused = (e) => {
    if (!e.target || typeof e.target !== 'object') return;
    if (byKey) keyed.add(e.target); else keyed.delete(e.target);
  };
  // While the strip has the keyboard the tape page under it must not hear
  // a key: R is ● Rec there and 1–4 arm a track, so Stop would arm a punch
  // and a track key would move the record track on the Pi. So these listen
  // in the capture phase, ahead of every page listener, and stop each key
  // there, played or not. stopPropagation leaves the browser's own
  // shortcuts alone.
  const down = (e) => {
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (!enter) byKey = true;
    if (typingInto(e.target) || knobKeeps(e.target, e.code)) return;
    if (!owns()) return;
    if (enter && keepsEnter(e.target, (el) => keyed.has(el))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘Z is still the page's undo
    e.stopPropagation();
    if (e.repeat) return;              // autorepeat is not a new press
    const { pads, commands } = keyTables(has);
    const cmd = commands[e.code];
    if (cmd === 'latch') { latched = true; surface.latch(true, now()); return; }
    if (cmd) { e.preventDefault(); onCommand(cmd); return; }
    const pad = pads[e.code];
    if (!pad) return;
    e.preventDefault();                // Space must not scroll, / must not find
    held.set(e.code, pad);
    surface.press(pad, now());
  };
  const up = (e) => {
    // A pad this keyboard holds is let go whatever has the focus now: a key
    // pressed on the page and let up in a field must not stick.
    const pad = held.get(e.code);
    if (pad) {
      held.delete(e.code);
      surface.release(pad, now());
      if (owns() && !typingInto(e.target)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    // So is the latch.
    if (latched && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      latched = false;
      surface.latch(false, now());
    }
    if (typingInto(e.target) || knobKeeps(e.target, e.code)) return;
    if (owns()) e.stopPropagation();
  };
  // onLetGo: the same cue for what the strip holds outside the surface
  // (the bend).
  const letGo = () => { held.clear(); latched = false; surface.releaseAll(now()); onLetGo(); };
  const onHide = () => { if (target.hidden) letGo(); };

  target.addEventListener('keydown', down, true);
  target.addEventListener('keyup', up, true);
  target.addEventListener('pointerdown', pressed, true);
  target.addEventListener('focusin', focused, true);
  target.addEventListener('visibilitychange', onHide);
  win?.addEventListener('blur', letGo);

  return () => {
    target.removeEventListener('pointerdown', pressed, true);
    target.removeEventListener('focusin', focused, true);
    target.removeEventListener('keydown', down, true);
    target.removeEventListener('keyup', up, true);
    target.removeEventListener('visibilitychange', onHide);
    win?.removeEventListener('blur', letGo);
    letGo();
  };
}

/**
 * bindTouch wires one element to one pad. Pointer events cover mouse, touch
 * and pen together.
 *
 * setPointerCapture is what makes a pad behave like a key rather than like a
 * button: slide your finger off a held pad and the pad stays held, and the
 * release still arrives here when the finger finally lifts. Without it the
 * browser sends pointerup to whatever is under the finger and the tape stays
 * broken, which is the touch version of the alt-tab bug above.
 *
 * `instead(e)`, when it says so, takes the touch for something else -- MIDI
 * LEARN picking the pad -- and nothing is pressed.
 */
export function bindTouch(surface, el, pad, { now = () => performance.now(), instead = () => false } = {}) {
  let pressed = false;
  const down = (e) => {
    e.preventDefault();
    if (instead(e)) return;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* not all pointers */ }
    pressed = true;
    surface.press(pad, now());
  };
  const up = (e) => {
    e.preventDefault();
    try { el.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
    if (!pressed) return;
    pressed = false;
    surface.release(pad, now());
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
