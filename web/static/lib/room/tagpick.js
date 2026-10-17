// web/static/lib/room/tagpick.js
// Tag: the selection's fourth key (docs/superpowers/specs/2026-10-15-flow-
// design.md, "A tap plays": holding a spine or a row selects, as the list's
// Select does -- ★, Delete, Export, and now Tag). It gives every selected
// take one tag, or takes the tag off: the same chips the sheet had under a
// take's name, for several takes at once. The room makes the key in script:
// the takes page has no such markup.

/**
 * tagKey puts a Tag key on the select bar (before Export) and answers
 * {key, sync, open}. `sync` is the key's state with the selection's: off with
 * nothing picked, as ★ and Export are.
 *   doc     the document
 *   bar     the select bar (lib/takes.js selectBar)
 *   takes   the page's TakesList: `all`, `selected`, `bulkTag(id)`
 *   tags    the tag store: `list`
 *   manage  the tag manager (lib/tags-dialog.js openTagManager), for a new tag
 */
export function tagKey({ doc, bar, takes, tags, manage }) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const key = el('button', 'icon-btn', 'Tag');
  key.type = 'button';
  key.id = 'sel-tag';
  key.dataset.tip = 'bulk-tag';
  key.setAttribute('aria-label', 'Tag the selected takes');
  const export_ = bar.querySelector('#sel-export');
  if (export_) export_.before(key); else bar.append(key);

  const sync = () => { key.disabled = takes.selected.size === 0; };
  sync();

  function open() {
    const names = [...takes.selected];
    if (!names.length) return;
    // The tag every selected take wears, if there is one: its chip is lit, and
    // pressing it takes it off (a press on the other chips gives that tag).
    const own = names.map((n) => takes.all.find((t) => t.name === n)?.tag || '');
    const shared = own.every((g) => g && g === own[0]) ? own[0] : '';

    const dlg = el('dialog', 'sheet tag-pick');
    dlg.setAttribute('aria-label', 'Tag the selected takes');
    const inner = el('div', 'sheet-inner');
    inner.append(el('h3', '', names.length === 1 ? 'Tag 1 take' : `Tag ${names.length} takes`));
    // The sheet's own chips (styles.css .detail-tags): reused as they are.
    const chips = el('div', 'detail-tags');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Tag');
    const close = () => { if (typeof dlg.close === 'function') dlg.close(); dlg.remove(); };
    const apply = async (id) => { close(); await takes.bulkTag(id); };
    for (const g of tags.list) {
      const b = el('button', `tag-chip stripe-${g.color}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(g.id === shared));
      const dot = el('span', 'tag-dot');
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, g.name);
      b.addEventListener('click', () => apply(g.id === shared ? '' : g.id));
      chips.append(b);
    }
    if (tags.list.length) {
      const none = el('button', 'chip', 'No tag');
      none.type = 'button';
      none.addEventListener('click', () => apply(''));
      chips.append(none);
    }
    const add = el('button', 'chip tag-edit-btn', tags.list.length ? 'Edit tags' : '+ New tag');
    add.type = 'button';
    // The manager's own dialog takes over (as the sheet's did); a tag it makes
    // goes to the selection.
    add.addEventListener('click', () => { close(); manage({ onCreated: (g) => takes.bulkTag(g.id) }); });
    chips.append(add);
    inner.append(chips);
    const actions = el('div', 'sheet-actions');
    const done = el('button', 'icon-btn', 'Close');
    done.type = 'button';
    done.addEventListener('click', close);
    actions.append(done);
    inner.append(actions);
    dlg.append(inner);
    dlg.addEventListener('close', () => dlg.remove());
    doc.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  key.addEventListener('click', open);
  return { key, sync, open };
}
