// web/static/lib/toast.js
// Toasts for both pages: a short message at the bottom, optionally with one
// action -- "Flag deleted · Undo". A toast with an action stays longer, and
// the action runs at most once, then the toast goes.
//
// The message is set as text, never markup: names come from the Pi and from
// whoever named a take.

const host = () => document.getElementById('toasts');

/**
 * toast shows msg. kind is 'ok', 'bad' or 'warn'. opts.ms is how long it
 * stays (default 4 s, 8 s with an action); opts.action is {label, run}.
 * Returns the element, and a dismiss() on it.
 */
export function toast(msg, kind = 'ok', opts = {}) {
  if (typeof opts === 'number') opts = { ms: opts }; // the old signature
  const { action } = opts;
  const ms = opts.ms ?? (action ? 8000 : 4000);
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = msg;
  t.appendChild(text);
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    t.style.transition = 'opacity 240ms';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 260);
  };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      b.disabled = true;
      dismiss();
      action.run();
    }, { once: true });
    t.appendChild(b);
  }
  host()?.appendChild(t);
  timer = setTimeout(dismiss, ms);
  t.dismiss = dismiss;
  return t;
}

// A toast for the next page: the take page deletes a take and goes back to
// the list, which shows "Deleted · Undo" there. Kept for this tab only.
const NEXT_KEY = 'hindsight.nextToast';

/** toastNext queues {msg, kind?, restore?} for the next page load; restore
 * names a take the toast's Undo brings back from the trash. */
export function toastNext(t) {
  try { sessionStorage.setItem(NEXT_KEY, JSON.stringify(t)); } catch {}
}

/** takeNextToast returns and clears what toastNext queued, or null. */
export function takeNextToast() {
  try {
    const raw = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// What an operation is about, for "Not undone" -- the Pi names operations
// by what they did ("rename", "flag moved"); this names the thing.
const SUBJECTS = { rename: 'name', tempo: 'tempo', selection: 'selection', downbeat: 'downbeat', lanes: 'lanes' };

// How Undo names a step: "Undo the rename", "Undone: deleting a flag".
const PHRASES = {
  rename: 'the rename', tempo: 'the tempo change', selection: 'the selection change',
  downbeat: 'the downbeat move', lanes: 'the lane change',
  'flag added': 'adding a flag', 'flag moved': 'moving a flag',
  'flag renamed': 'renaming a flag', 'flag deleted': 'deleting a flag',
};

/** undoPhrase names an operation the Pi reports ("flag deleted") for Undo. */
export function undoPhrase(what) {
  return PHRASES[what] || 'the last change';
}

/** undoSkipped is the message for an Undo the Pi skipped. */
export function undoSkipped(what) {
  const thing = SUBJECTS[what] || (String(what).startsWith('flag') ? 'flag' : 'take');
  return `Not undone: the ${thing} has changed since`;
}
