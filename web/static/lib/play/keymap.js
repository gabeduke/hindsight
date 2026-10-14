// web/static/lib/play/keymap.js
// The PC keyboard as a controller. One of the three adapters over
// lib/play/surface.js; it does nothing the touch adapter and, later, the MIDI
// one do not also do.
//
// Keys are read by `code`, the physical position, not by `key`, the letter
// printed on it. An instrument's layout should be where your fingers are, so
// the pads stay in the same places on AZERTY and Dvorak.

/** The pads, in the order they sit on the screen. */
export const TRACK_PADS = ['track1', 'track2', 'track3', 'track4'];
export const TRICK_PADS = ['break', 'reverse', 'chop', 'stop', 'half', 'double'];

/**
 * The map. Fixed, deliberately: remapping is a settings surface, and settings
 * surfaces are the thing Play mode exists to get away from. It becomes worth
 * having when MIDI learn arrives, where it actually matters.
 */
export const KEYMAP = {
  Digit1: 'track1', Digit2: 'track2', Digit3: 'track3', Digit4: 'track4',
  KeyQ: 'break', KeyW: 'reverse', KeyE: 'chop', KeyR: 'stop',
  KeyZ: 'half', KeyX: 'double',
};

/** Keys that are commands rather than pads. */
export const COMMANDS = {
  Space: 'transport',
  Escape: 'exit',
};

/** padForKey is the pad a physical key plays, or null. */
export function padForKey(code) {
  return KEYMAP[code] || null;
}

/** commandForKey is the command a key runs, or null. */
export function commandForKey(code) {
  return COMMANDS[code] || null;
}

/**
 * typingInto says the key belongs to a field rather than to the instrument.
 * Without this, naming a take would play the tape.
 */
export function typingInto(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * bindKeyboard wires a surface to a target (the document, normally) and
 * returns a function that unwires it.
 *
 * The part worth not getting wrong is letting go. A key held while the window
 * loses focus never sends its keyup -- alt-tab with break held and the tape
 * stays broken forever, with no key to press to fix it, because the browser
 * stopped telling us about that key the moment focus left. So blur and a
 * hidden tab both release everything.
 */
export function bindKeyboard(surface, {
  target = document,
  win = typeof window !== 'undefined' ? window : null,
  now = () => performance.now(),
  onCommand = () => {},
} = {}) {
  const down = (e) => {
    if (e.repeat) return;              // autorepeat is not a new press
    if (typingInto(e.target)) return;
    const cmd = commandForKey(e.code);
    if (cmd) { e.preventDefault(); onCommand(cmd); return; }
    const pad = padForKey(e.code);
    if (!pad) return;
    e.preventDefault();                // Space must not scroll, / must not find
    surface.press(pad, now());
  };
  const up = (e) => {
    if (typingInto(e.target)) return;
    const pad = padForKey(e.code);
    if (!pad) return;
    e.preventDefault();
    surface.release(pad, now());
  };
  const letGo = () => surface.releaseAll(now());
  const onHide = () => { if (target.hidden) letGo(); };

  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('visibilitychange', onHide);
  win?.addEventListener('blur', letGo);

  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
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
 */
export function bindTouch(surface, el, pad, { now = () => performance.now() } = {}) {
  const down = (e) => {
    e.preventDefault();
    try { el.setPointerCapture?.(e.pointerId); } catch { /* not all pointers */ }
    surface.press(pad, now());
  };
  const up = (e) => {
    e.preventDefault();
    try { el.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
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
