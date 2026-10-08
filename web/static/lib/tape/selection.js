// web/static/lib/tape/selection.js
// Which clips on the tape are selected
// (docs/superpowers/specs/2026-10-07-click-to-select-design.md): one clip
// (`picked`, which shows its trim grips) or several (`multi`, a Set). A
// click selects one clip in place of the rest; Shift, ⌘ or Ctrl with a click
// (or Select more's taps) adds one or takes it off. Pure: page.js keeps the
// state and draws it.

/** none is nothing selected. */
export const none = () => ({ picked: null, multi: null });

/** only selects one clip, in place of whatever was selected. */
export const only = (id) => ({ picked: id, multi: null });

/** all selects every clip in ids: one is that clip alone. */
export function all(ids) {
  if (!ids.length) return none();
  return ids.length === 1 ? only(ids[0]) : { picked: null, multi: new Set(ids) };
}

/**
 * toggle adds clip id to the selection, or takes it off. Several selected
 * that come down to one are that clip alone again (its grips show), unless
 * `adding`: Select more's taps keep collecting from one.
 */
export function toggle(sel, id, adding = false) {
  const s = sel.multi ? new Set(sel.multi) : new Set(sel.picked ? [sel.picked] : []);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  if (!s.size) return none();
  if (s.size === 1 && !adding) return only([...s][0]);
  return { picked: null, multi: s };
}

/** ids is what's selected, as a list. */
export const ids = (sel) => (sel.multi ? [...sel.multi] : sel.picked ? [sel.picked] : []);

/**
 * keep is the selection less the clips no longer on the tape (removed
 * here, or by another device), given the ids that are.
 */
export function keep(sel, present) {
  const has = (id) => present.has(id);
  if (sel.multi) {
    const left = [...sel.multi].filter(has);
    if (left.length === sel.multi.size) return sel;
    return left.length ? { picked: null, multi: new Set(left) } : none();
  }
  return sel.picked && !has(sel.picked) ? none() : sel;
}

/**
 * settle is the selection with the last of several clips left on its own,
 * once Select more isn't collecting: Split, Keep and Details… are one
 * clip's, and a selection of one is that clip.
 */
export function settle(sel) {
  if (!sel.multi) return sel;
  if (!sel.multi.size) return none();
  return sel.multi.size === 1 ? only([...sel.multi][0]) : sel;
}
