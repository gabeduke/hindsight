// web/static/lib/ui/keys.js
// The deck's keys go down the moment a finger is on them, and a quick tap
// still shows it. CSS draws the down pose (styles.css: a key's :active and
// .down rules, taken at once and let go on the snap spring); this adds the
// .down that :active can't be trusted for:
//
//   - a touch: Chrome on Android waits to see whether a touch is a scroll
//     before it applies :active, and on a tap that is often never;
//   - a quick tap: on glass a tap can be 30-60 ms, over before its frame
//     is drawn, so the down pose is held DOWN_MS at the least;
//   - iPad Safari, which applies :active only where a touchstart listener
//     is: one passive, empty one on the document.
//
// It only ever adds and removes a class. Every listener is passive: it
// never prevents, stops or holds up anything, so the click comes as it
// always did. The press is heard as it bubbles to the document, so help
// mode, which catches a press on its way down and stops it, still decides
// what a tap in help mode does (show a tip), and this adds nothing there,
// whichever of the two a page wires first.

/** KEYS are what takes the down pose: the deck's keys and what a finger presses like one. */
export const KEYS = [
  // Raised keys and chips; the keys you play on (the bar's among them, ▶ ● Catch GRAB KEEP)
  '.icon-btn', '.chip', '.nudge', '.phone-btn', '.passes-row .pass',
  // A segmented switch's buttons, Flag, Capture, the tape's name and tempo
  '.seg button', '.mark-btn', '.capture-btn', '.tape-pill',
  // What sinks under a finger rather than going down like a key: a
  // cassette's spine, a cue clip (their modules give them .sinks)
  '.sinks',
].join(', ');

/** DOWN_MS is the least a tap's down pose is shown: five frames, long enough to see, short enough never to lag. */
export const DOWN_MS = 80;

/**
 * showPresses wires the press to every key under `doc`, once, at a page's
 * boot (after initHelp). It answers a function that takes it off again.
 * The clock and the timers are handed in for the tests.
 */
export function showPresses(doc = document, {
  win = doc.defaultView, keys = KEYS, min = DOWN_MS,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const pressed = new Map(); // pointerId -> { key, at }
  const lifting = new Map(); // key -> the timer that lets it up
  const up = (key) => {
    lifting.delete(key);
    key.classList.remove('down');
  };
  const lift = (id, at) => {
    const p = pressed.get(id);
    if (!p) return;
    pressed.delete(id);
    // A second finger still on it keeps it down.
    for (const q of pressed.values()) if (q.key === p.key) return;
    const left = at === null ? 0 : min - (at - p.at);
    if (left <= 0) up(p.key);
    else lifting.set(p.key, setTimer(() => up(p.key), left));
  };
  const onDown = (e) => {
    if (e.button > 0) return; // a right or middle button is not a press
    const key = e.target?.closest?.(keys);
    // A disabled key can't be pressed. One that is only aria-disabled can:
    // Catch, waiting for a whole pass, still answers a press with why.
    if (!key || key.disabled) return;
    lift(e.pointerId, null); // its last press never came up (the window lost it): done with
    const t = lifting.get(key);
    if (t !== undefined) {
      clearTimer(t);
      lifting.delete(key);
    }
    key.classList.add('down');
    pressed.set(e.pointerId, { key, at: now() });
  };
  // Up is heard first, on the window, on its way down: nothing a key does
  // with it can leave the key stuck down. A cancel is a scroll or a lost
  // touch, not a press: up at once.
  const onUp = (e) => lift(e.pointerId, e.type === 'pointercancel' ? null : now());
  const onBlur = () => { for (const id of [...pressed.keys()]) lift(id, null); };
  const touch = () => {};
  const passive = { passive: true };
  const early = { passive: true, capture: true };
  doc.addEventListener('pointerdown', onDown, passive);
  doc.addEventListener('touchstart', touch, passive);
  win?.addEventListener('pointerup', onUp, early);
  win?.addEventListener('pointercancel', onUp, early);
  win?.addEventListener('blur', onBlur);
  return () => {
    doc.removeEventListener('pointerdown', onDown, passive);
    doc.removeEventListener('touchstart', touch, passive);
    win?.removeEventListener('pointerup', onUp, early);
    win?.removeEventListener('pointercancel', onUp, early);
    win?.removeEventListener('blur', onBlur);
    for (const [key, t] of lifting) { clearTimer(t); key.classList.remove('down'); }
    for (const { key } of pressed.values()) key.classList.remove('down');
    lifting.clear();
    pressed.clear();
  };
}
