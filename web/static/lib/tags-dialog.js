// web/static/lib/tags-dialog.js
// The tag manager: add, rename, recolor and delete tags. It works on a copy
// and saves the whole list on Save, so a half-typed name never reaches the
// other devices. (The list lives on the server: lib/tags.js.)

import { tagStore, MAX_TAGS, TAG_COLORS } from './tags.js';

const MAX_NAME = 24;

/** nextColor is the first color no tag wears yet, or the one worn least. */
export function nextColor(list) {
  const used = Array.from({ length: TAG_COLORS + 1 }, () => 0);
  for (const t of list) used[t.color]++;
  let best = 1;
  for (let c = 2; c <= TAG_COLORS; c++) if (used[c] < used[best]) best = c;
  return best;
}

/**
 * openTagManager shows the dialog; resolves true if the list was saved.
 * `onToast(msg, kind)` reports a save that failed.
 */
export function openTagManager({ onToast } = {}) {
  return new Promise((resolve) => {
    const draft = tagStore.list.map((t) => ({ ...t }));
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet tag-sheet';
    dlg.setAttribute('aria-label', 'Tags');
    dlg.innerHTML = `
      <form method="dialog" class="sheet-inner">
        <h3>Tags</h3>
        <p class="tag-help">A tag is a color. Give one to a take and its cassette wears it; then filter or sort the takes page by it.</p>
        <ul class="tag-edit-list"></ul>
        <button class="icon-btn tag-add" type="button">+ Add a tag</button>
        <p class="tag-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button class="icon-btn" value="cancel">Cancel</button>
          <button class="icon-btn confirm tag-save" value="save">Save</button>
        </div>
      </form>`;
    const ul = dlg.querySelector('.tag-edit-list');
    const add = dlg.querySelector('.tag-add');
    const err = dlg.querySelector('.tag-error');

    const draw = () => {
      ul.replaceChildren(...draft.map((t, i) => {
        const li = document.createElement('li');
        li.className = `tag-edit stripe-${t.color}`;
        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = MAX_NAME;
        name.value = t.name;
        name.placeholder = 'Name';
        name.setAttribute('aria-label', 'Tag name');
        name.addEventListener('input', () => { t.name = name.value; });
        const sw = document.createElement('span');
        sw.className = 'tag-swatches';
        sw.setAttribute('role', 'group');
        sw.setAttribute('aria-label', `Color for ${t.name || 'this tag'}`);
        for (let c = 1; c <= TAG_COLORS; c++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tag-swatch';
          b.style.background = `var(--stripe-${c})`;
          b.setAttribute('aria-label', `Color ${c}`);
          b.setAttribute('aria-pressed', String(c === t.color));
          b.addEventListener('click', () => { t.color = c; draw(); });
          sw.append(b);
        }
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon-btn danger tag-del';
        del.textContent = 'Delete';
        del.setAttribute('aria-label', `Delete ${t.name || 'this tag'}`);
        del.addEventListener('click', () => { draft.splice(i, 1); draw(); });
        li.append(name, sw, del);
        return li;
      }));
      add.disabled = draft.length >= MAX_TAGS;
    };
    add.addEventListener('click', () => {
      draft.push({ id: '', name: '', color: nextColor(draft) });
      draw();
      ul.querySelector('li:last-child input')?.focus();
    });
    draw();

    // Save checks here too, so a mistake is said beside the form, not as a toast.
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      const clean = draft.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name);
      const seen = new Set();
      for (const t of clean) {
        const k = t.name.toLowerCase();
        if (seen.has(k)) { err.textContent = `Two tags are called “${t.name}”.`; err.hidden = false; return; }
        seen.add(k);
      }
      try {
        await tagStore.save(clean);
        dlg.close('save');
      } catch (ex) {
        err.textContent = `Could not save: ${ex.message}`;
        err.hidden = false;
        onToast?.(`Could not save tags: ${ex.message}`, 'bad');
      }
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'save'); });
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  });
}
