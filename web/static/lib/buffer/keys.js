// web/static/lib/buffer/keys.js
// The buffer's keys, as their own small table (docs/superpowers/specs/2026-10-15-studio-buffer-design.md).
// G grabs whenever the Studio is up; the rest mean something only while the
// buffer is open -- [ ] move IN, ⇧[ ⇧] move OUT, K keeps it as a take, ⌫
// tosses it -- and ↵ drops it while it's open, or again further on just
// after a drop. The table is the control bus's (lib/play/controls.js, the
// one list of actions), and bindBufferKeys listens for it while the page
// has the keyboard.
//
// By physical key (`code`), so they're where the fingers are on any layout,
// as the tape page's and Play mode's are.

/**
 * BUFFER_KEYS: `when` is 'studio' (always), 'open' (the buffer is open) or
 * 'held' (it's open, or was just dropped and the clipboard still has it).
 * `shift` must match: ⇧[ is OUT's, [ is IN's. `repeat` lets a held key
 * step on, as holding [ walks IN back bar by bar. Derived from controls.js.
 */
import { BUFFER_KEYS } from '../play/controls.js';

export { BUFFER_KEYS };

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

// Where ↵ belongs to what has the focus: any button -- a toast's Undo,
// Loop, the buffer's own keys -- a link, a menu's item, anything in a sheet
// or a menu. All but ▶: it keeps the focus after it's clicked, and ↵ there
// would stop the tape mid-jam instead of dropping.
const OWN_ENTER = 'button:not(#play), a[href], [role="menuitem"], [role="option"], [role="menu"], dialog, .buffer-panel, .buffer-grab';

/**
 * blocked says the page isn't the buffer's to answer: a key typed into a
 * field; a sheet open over the page (Settings, a flag's, Releases); the
 * keys inside the inspector; or ↵ where the focus has a use for it.
 * (Play mode, which owns the keyboard while it's open, stops every key at
 * the document before it gets here: see bindBufferKeys.)
 */
export function blocked(e, doc) {
  const t = e.target;
  if (typingInto(t)) return true;
  if ([...doc.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('inspector'))) return true;
  if (t && t.closest && t.closest('dialog.inspector')) return true;
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && t && t.closest && t.closest(OWN_ENTER)) return true;
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
 */
export function bindBufferKeys(doc, { state, run }) {
  const root = doc.documentElement;
  const down = (e) => {
    if (blocked(e, doc)) return;
    const a = keyAction(e, state());
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    run(a, e);
  };
  root.addEventListener('keydown', down, true);
  return () => root.removeEventListener('keydown', down, true);
}
