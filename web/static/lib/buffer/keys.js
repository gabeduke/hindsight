// web/static/lib/buffer/keys.js
// The buffer's keys, as their own small table (docs/superpowers/specs/2026-10-15-studio-buffer-design.md).
// G grabs whenever the Studio is up; the rest mean something only while the
// buffer is open -- [ ] move IN, ⇧[ ⇧] move OUT, K keeps it as a take, ⌫
// tosses it -- and ↵ drops it while it's open, or again further on just
// after a drop. P3's control bus (lib/play, controls.js) is to fold this
// table into its own; until then bindBufferKeys listens for it.
//
// By physical key (`code`), so they're where the fingers are on any layout,
// as the tape page's and Play mode's are.

/**
 * BUFFER_KEYS: `when` is 'studio' (always), 'open' (the buffer is open) or
 * 'held' (it's open, or was just dropped and the clipboard still has it).
 * `shift` must match: ⇧[ is OUT's, [ is IN's. `repeat` lets a held key
 * step on, as holding [ walks IN back bar by bar.
 */
export const BUFFER_KEYS = [
  { code: 'KeyG', shift: false, action: 'grab', when: 'studio', label: 'G', what: 'Grab the last bars into the buffer' },
  { code: 'BracketLeft', shift: false, action: 'in-back', when: 'open', label: '[', what: 'IN back a step', repeat: true },
  { code: 'BracketRight', shift: false, action: 'in-on', when: 'open', label: ']', what: 'IN on a step', repeat: true },
  { code: 'BracketLeft', shift: true, action: 'out-back', when: 'open', label: '⇧[', what: 'OUT back a step', repeat: true },
  { code: 'BracketRight', shift: true, action: 'out-on', when: 'open', label: '⇧]', what: 'OUT on a step', repeat: true },
  { code: 'Enter', shift: false, action: 'drop', when: 'held', label: '↵', what: 'Drop it on the armed track, at the next free span' },
  { code: 'NumpadEnter', shift: false, action: 'drop', when: 'held', label: '↵', what: 'Drop it on the armed track, at the next free span' },
  { code: 'KeyK', shift: false, action: 'keep', when: 'open', label: 'K', what: 'Keep it as a take' },
  { code: 'Backspace', shift: false, action: 'toss', when: 'open', label: '⌫', what: 'Toss it' },
  { code: 'Delete', shift: false, action: 'toss', when: 'open', label: '⌦', what: 'Toss it' },
];

/** keyAction is the action a key press means now, or null. */
export function keyAction(e, { open = false, held = false } = {}) {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = BUFFER_KEYS.find((x) => x.code === e.code && x.shift === !!e.shiftKey);
  if (!k) return null;
  if (k.when === 'open' && !open) return null;
  if (k.when === 'held' && !open && !held) return null;
  if (e.repeat && !k.repeat) return null;
  return k.action;
}

/** typingInto says the key belongs to a field: naming a take never grabs. */
export function typingInto(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && el.type !== 'range';
}

// Where ↵ belongs to what has the focus, however it got there: a link, a
// menu's item, anything in a sheet or a menu, and the buffer's own keys.
const OWN_ENTER = 'a[href], [role="menuitem"], [role="option"], [role="menu"], dialog, .buffer-panel, .buffer-grab';
// And a button -- a toast's Undo, Loop -- but only one the keyboard brought
// the focus to. Chrome focuses a button that's clicked: arm a track with its
// ●, press ↵ for DROP, and the ↵ went to the ●, which disarmed it. ▶ never
// keeps it: ↵ there would stop the tape mid-jam.
const BUTTON = 'button:not(#play)';

/**
 * blocked says the page isn't the buffer's to answer: a key typed into a
 * field; a sheet open over the page (Settings, a flag's, Releases); the
 * keys inside the inspector; or ↵ where the focus has a use for it.
 * byKeyboard(el) says whether the keyboard brought the focus to el (a
 * clicked button gives ↵ up); without it, every focused button keeps it.
 * (Play mode, which owns the keyboard while it's open, stops every key at
 * the document before it gets here: see bindBufferKeys.)
 */
export function blocked(e, doc, byKeyboard = () => true) {
  const t = e.target;
  if (typingInto(t)) return true;
  if ([...doc.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('inspector'))) return true;
  if (t && t.closest && t.closest('dialog.inspector')) return true;
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && t && t.closest) {
    if (t.closest(OWN_ENTER)) return true;
    const b = t.closest(BUTTON);
    if (b && byKeyboard(b)) return true;
  }
  return false;
}

/**
 * bindBufferKeys listens for the table on the page's root element, in the
 * capture phase. That puts it after Play mode's keys, which listen on the
 * document in the capture phase and stop every key there while Play mode is
 * open; and before the tape page's own, which listen on the document as the
 * key bubbles back up: K is the click there and ⌫ removes clips, so while
 * the buffer is open they must be its, and stop here. `state()` says whether
 * it's open or held; `run(action)` does it. It returns the unbinder.
 *
 * It also notes how the focus moves -- by a press, or by a key -- so that a
 * button clicked a moment ago doesn't keep ↵ from DROP (blocked).
 */
export function bindBufferKeys(doc, { state, run }) {
  const root = doc.documentElement;
  let byKey = false;            // the last input was a key, not a press
  const keyed = new WeakSet();  // what the keyboard brought the focus to
  const press = () => { byKey = false; };
  const focus = (e) => { if (e.target && typeof e.target === 'object') { if (byKey) keyed.add(e.target); else keyed.delete(e.target); } };
  const down = (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') byKey = true;
    if (blocked(e, doc, (el) => keyed.has(el))) return;
    const a = keyAction(e, state());
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    run(a, e);
  };
  root.addEventListener('pointerdown', press, true);
  root.addEventListener('focusin', focus, true);
  root.addEventListener('keydown', down, true);
  return () => {
    root.removeEventListener('pointerdown', press, true);
    root.removeEventListener('focusin', focus, true);
    root.removeEventListener('keydown', down, true);
  };
}
