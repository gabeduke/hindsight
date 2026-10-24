// web/static/lib/ui/menu.js
// Every menu, and every ▾ panel beside a key (docs/plan/the-studio-space.md,
// "Under the hood"): one way to place it, open it, move along it and close
// it. There were six, with five ways to place a menu and two to dismiss one,
// arrow keys in some and not others, and rows 40 px tall in one menu and 48
// in the one beside it.
//
//   place     where a panel goes beside its key: pure, so the tests read it
//   menu      a button and the panel it opens, on the page's stack of open
//             things (lib/ui/layers.js)
//   splitKey  a key with a ▾ of its own beside it, the ▾ opening a panel of
//             how the key does its verb (KEEP ▾, GRAB ▾)
//   menuItem, menuDivider, menuGroup
//             a menu's rows, in the one style (styles.css, "Menus")
//
// A menu closes only through its layer: a press outside it, Escape or Back,
// a pick, or a switch of rooms (lib/ui/layers.js). Tab closes it too, and
// the keyboard goes on from its button.
//
// It grows from its key: styles.css animates the panel by its data-state
// (open, closed), from the corner nearest the key (transform-origin, which
// place answers), and lets it fade on the way out.

import { layersOf } from './layers.js';

/**
 * place is where a panel `size` ({width, height}) goes beside `anchor` (a
 * rect: left, top, right, bottom) in a screen `view` ({width, height}):
 *
 *   side    'below' or 'above' the anchor, or 'auto': below where it fits,
 *           above where only that fits, else on the side with more room
 *   align   'end': its right edge on the anchor's; 'start': its left on the
 *           anchor's left
 *   gap     between the anchor and the panel
 *   margin  kept from the screen's sides, its top, and the floor
 *   floor   how far down it may reach (the bar docked at the foot of the
 *           page: #np's top); the screen's foot by default
 *
 * Moved in from a side it would run off; one too wide for the screen lines
 * up on its left edge, which carries the words. Answers { left, top,
 * maxHeight, side, origin }: maxHeight is null when it fits, or the room it
 * has, to scroll in; origin is the anchor's corner, as a transform-origin
 * in the panel, for it to grow from.
 */
export function place(anchor, size, view, { side = 'auto', align = 'end', gap = 6, margin = 8, floor } = {}) {
  const width = Math.max(0, Number(size?.width) || 0);
  const height = Math.max(0, Number(size?.height) || 0);
  const vw = Number(view?.width) || 0;
  const vh = Number(view?.height) || 0;
  const edge = align === 'start' ? anchor.left : anchor.right;
  const from = align === 'start' ? anchor.left : anchor.right - width;
  const left = width > vw - 2 * margin ? margin : Math.min(Math.max(from, margin), vw - margin - width);

  const foot = Math.min(floor ?? vh, vh) - margin;
  const below = foot - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  let down;
  if (side === 'below') down = true;
  else if (side === 'above') down = false;
  else down = height <= below || (height > above && below >= above);
  const room = Math.max(0, down ? below : above);
  const fits = height <= room;
  let top;
  if (down) top = anchor.bottom + gap;
  else top = fits ? anchor.top - gap - height : margin;

  const x = Math.min(Math.max(edge - left, 0), width);
  return {
    left: Math.round(left),
    top: Math.round(top),
    maxHeight: fits ? null : Math.round(room),
    side: down ? 'below' : 'above',
    origin: `${Math.round(x)}px ${down ? '0' : '100%'}`,
  };
}

// What the arrow keys move along: a menu's items, or a panel's buttons.
const ITEM = 'button, a, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
let made = 0;

/**
 * menu wires `button` to open `panel` (hidden until then) on the page's
 * stack (`layers`; layersOf the button's document by default):
 *
 *   role     'menu' (its rows are menuitems, and a pick closes it) or
 *            'dialog' (a ▾'s panel of choices, which closes when its owner
 *            says: a pick that settles it, its key's verb)
 *   anchor   what it is placed against (the button)
 *   side, align, gap, margin, floor
 *            as place's; floor may be a function, asked as it opens
 *   render(panel)
 *            fills it, each time it opens and on refresh()
 *   focus    where the keyboard lands when it is opened by a key: the
 *            'first' item, or the 'checked' (or pressed) one
 *
 * The button says what it opens (aria-haspopup, aria-expanded,
 * aria-controls). A press on it opens or closes the panel; ↓ or ↑ on it
 * opens it with the keyboard on the first or last item, as Enter and Space
 * do. While it is open, ↑ ↓ Home End move along it (← → too, in a panel),
 * Tab closes it and moves on from the button, and it follows its anchor
 * when the page scrolls or the window changes size. Answers { open, close,
 * toggle, refresh, isOpen }.
 */
export function menu(button, panel, {
  layers,
  role = 'menu',
  anchor = button,
  side = 'auto',
  align = 'end',
  gap = 6,
  margin = 8,
  floor,
  render,
  focus = 'first',
  doc = button.ownerDocument || globalThis.document,
  win = doc?.defaultView || globalThis,
} = {}) {
  const stack = layers || layersOf(doc);
  const kind = role === 'menu' ? 'menu' : 'popover';
  if (!panel.id) panel.id = `ui-menu-${++made}`;
  button.setAttribute('aria-haspopup', role);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panel.id);
  if (!panel.getAttribute('role')) panel.setAttribute('role', role);
  let layer = null;

  // Shown or not. While it closes it takes no press and no focus (inert),
  // and styles.css fades it out by data-state.
  const show = (on) => {
    panel.hidden = !on;
    panel.dataset.state = on ? 'open' : 'closed';
    panel.inert = !on;
    button.setAttribute('aria-expanded', String(on));
  };
  show(false);

  const shown = (el) => {
    for (let e = el; e && e !== panel; e = e.parentElement) if (e.hidden) return false;
    return true;
  };
  const items = () => [...panel.querySelectorAll(ITEM)].filter((el) => shown(el) && !el.disabled && !el.hasAttribute?.('disabled'));
  const isOpen = () => !!layer?.open && !panel.hidden;

  function view() {
    const de = doc?.documentElement;
    return { width: de?.clientWidth || win?.innerWidth || 0, height: win?.innerHeight || de?.clientHeight || Infinity };
  }

  // Measured at the screen's corner, so the last place it stood doesn't
  // squeeze it, then placed (fixed, by styles.css). offsetWidth, not the
  // box, which the growing scale shrinks.
  function placeNow() {
    const v = view();
    const s = panel.style;
    if (!v.width || !s || typeof anchor?.getBoundingClientRect !== 'function') return;
    s.left = '0px';
    s.top = '0px';
    s.maxHeight = '';
    const box = panel.getBoundingClientRect?.() || {};
    const size = { width: panel.offsetWidth || box.width || 0, height: panel.offsetHeight || box.height || 0 };
    const at = place(anchor.getBoundingClientRect(), size, v, {
      side, align, gap, margin, floor: typeof floor === 'function' ? floor() : floor,
    });
    s.left = `${at.left}px`;
    s.top = `${at.top}px`;
    s.maxHeight = at.maxHeight == null ? '' : `${at.maxHeight}px`;
    s.transformOrigin = at.origin;
  }

  function focusIn(last = false) {
    const list = items();
    if (!list.length) return;
    const lit = focus === 'checked'
      ? list.find((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true')
      : null;
    (lit || (last ? list[list.length - 1] : list[0])).focus?.();
  }

  // While it is open: the keys, and its anchor moving.
  const onKey = (e) => {
    if (e.defaultPrevented || !isOpen()) return;
    const at = doc.activeElement;
    const inside = !!at && panel.contains(at);
    if (e.key === 'Tab') {
      if (!inside) return;
      button.focus?.({ preventScroll: true }); // the Tab goes on from here
      close('program');
      return;
    }
    // The keyboard is in the menu, on its button, or nowhere (Safari
    // doesn't focus a button it clicks): not in a field elsewhere.
    if (!inside && at && at !== button && at !== doc.body && at !== doc.documentElement) return;
    const list = items();
    if (!list.length) return;
    const i = inside ? list.indexOf(at) : -1;
    const n = list.length;
    const step = {
      ArrowDown: (i + 1) % n,
      ArrowUp: i <= 0 ? n - 1 : i - 1,
      ...(inside ? { Home: 0, End: n - 1 } : {}),
      ...(inside && role !== 'menu' ? { ArrowRight: (i + 1) % n, ArrowLeft: i <= 0 ? n - 1 : i - 1 } : {}),
    }[e.key];
    if (step === undefined) return;
    list[step].focus?.();
    e.preventDefault?.();
  };
  const onMove = (e) => {
    if (e?.type === 'scroll' && e.target && panel.contains(e.target)) return;
    if (isOpen()) placeNow();
  };
  const listen = (on) => {
    const m = on ? 'addEventListener' : 'removeEventListener';
    doc[m]?.('keydown', onKey);
    win?.[m]?.('resize', onMove);
    win?.[m]?.('scroll', onMove, { capture: true, passive: true });
  };

  // Put away, however it closed: the keyboard goes back to the button
  // unless a press elsewhere or a page on its way took it.
  function putAway(reason) {
    layer = null;
    listen(false);
    const had = !!doc.activeElement && panel.contains(doc.activeElement);
    show(false);
    if (had && reason !== 'outside' && reason !== 'navigate') button.focus?.({ preventScroll: true });
  }

  function open({ byKey = false, last = false } = {}) {
    if (isOpen()) { if (byKey) focusIn(last); return; }
    render?.(panel);
    show(true);
    placeNow();
    // Shown again after a page hid it under its open layer (Open hides every
    // .menu as one of its own opens): the layer is still the one.
    if (!layer?.open) {
      layer = stack.open({ el: panel, kind, owner: button, onClose: putAway });
      listen(true);
    }
    if (byKey) focusIn(last);
  }

  function close(reason = 'program') {
    if (layer?.open) layer.close(reason);
    else if (!panel.hidden) show(false);
  }

  const toggle = (opts) => (isOpen() ? close() : open(opts));

  function refresh() {
    if (!isOpen()) return;
    render?.(panel);
    placeNow();
  }

  // A click from the keyboard (Enter, Space) has no pointer: its detail is 0.
  button.addEventListener('click', (e) => toggle({ byKey: e?.detail === 0 }));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault?.();
    open({ byKey: true, last: e.key === 'ArrowUp' });
  });
  // A pick closes a menu, before the item's own handler (which may stop the
  // click: help mode's does). A link leaves the history to the page it
  // loads; one to "#" loads nothing (the Studio's Export stems, which
  // downloads by a link of its own), and is a pick. An item that can't go
  // (aria-disabled) says why, and stays.
  if (role === 'menu') {
    panel.addEventListener('click', (e) => {
      if (!layer?.open) return;
      const item = items().find((c) => c.contains(e.target));
      if (!item || item.getAttribute('aria-disabled') === 'true') return;
      const leaves = item.tagName === 'A' && item.hasAttribute('href') && !item.getAttribute('href').startsWith('#');
      layer.close(leaves ? 'navigate' : 'pick');
    }, true);
  }

  return { open, close, toggle, refresh, isOpen };
}

/**
 * splitKey is a key and a ▾ of its own beside it (KEEP ▾, GRAB ▾): `verb`
 * does what the key says with what was chosen last, and `more` opens
 * `panel`, the choices, under the pair. Two targets, so a tap on the verb
 * is never read as the ▾. The verb closes the panel (a press on it is a
 * press outside, and Enter on it a pick). Takes menu's options; answers
 * its menu.
 */
export function splitKey(verb, more, panel, opts = {}) {
  const m = menu(more, panel, { role: 'dialog', anchor: more.parentElement || more, ...opts });
  verb.addEventListener('click', () => { if (m.isOpen()) m.close('pick'); });
  return m;
}

/**
 * barTop is a floor for a menu that must not reach under the bar docked at
 * the foot of the page (#np): its top, while it shows.
 */
export function barTop(doc = globalThis.document) {
  return () => {
    const r = doc?.getElementById?.('np')?.getBoundingClientRect?.();
    return r && r.height ? r.top : undefined;
  };
}

/**
 * menuItem is a menu's row, in the one style (styles.css, "Menus"): a
 * check's column, the word, a line under it (what it does, or why it
 * can't), and something at its end (a lamp). 48 px tall.
 *
 *   word             its word
 *   sub, subClass    the line under it ('' for one a module fills later),
 *                    and a class of its own for that module to find it by
 *   role             'menuitem', or 'menuitemcheckbox' with `checked`
 *   href             a link
 *   danger           it destroys something: red, and last (menuRows)
 *   end              an element for its end
 *   el               an element already in the page to make the row of
 *                    (its children are replaced, its id kept)
 *   className, attrs more of its own
 */
export function menuItem(doc, {
  word, sub, subClass = '', role = 'menuitem', href, checked, danger = false, end, el, className = '', attrs = {},
} = {}) {
  const span = (cls, text) => {
    const e = doc.createElement('span');
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const row = el || doc.createElement(href ? 'a' : 'button');
  row.className = ['menu-item', danger ? 'danger' : '', className].filter(Boolean).join(' ');
  if (href) row.setAttribute('href', href);
  else if (row.tagName === 'BUTTON') row.setAttribute('type', 'button');
  row.setAttribute('role', role);
  for (const [k, v] of Object.entries(attrs)) row.setAttribute(k, v);
  const parts = [];
  if (role === 'menuitemcheckbox' || role === 'menuitemradio') {
    row.setAttribute('aria-checked', String(!!checked));
    const tick = span('menu-check', '✓');
    tick.setAttribute('aria-hidden', 'true');
    parts.push(tick);
  }
  parts.push(span('menu-word', word));
  if (sub !== undefined) parts.push(span(['menu-sub', subClass].filter(Boolean).join(' '), sub));
  if (end) { end.classList?.add('menu-end'); parts.push(end); }
  row.replaceChildren(...parts);
  return row;
}

/** menuDivider is the line between a menu's groups. */
export function menuDivider(doc) {
  const hr = doc.createElement('div');
  hr.className = 'menu-divider';
  hr.setAttribute('role', 'separator');
  return hr;
}

/** menuGroup is a group's name over its rows: for the eye (a reader hears the rows). */
export function menuGroup(doc, label) {
  const p = doc.createElement('p');
  p.className = 'menu-group';
  p.setAttribute('aria-hidden', 'true');
  p.textContent = label;
  return p;
}

/**
 * menuRows puts a menu's rows in order: its groups as given (each a list of
 * rows, or { label, rows }), a divider between one and the next, and
 * whatever destroys something (a danger row) last, after a divider of its
 * own, so it is never the row a finger meant for its neighbour.
 */
export function menuRows(doc, groups) {
  const rowsOf = (g) => (Array.isArray(g) ? g : g?.rows || []);
  const isDanger = (r) => !!r?.classList?.contains('danger');
  const out = [];
  const add = (label, rows) => {
    if (!rows.length) return;
    if (out.length) out.push(menuDivider(doc));
    if (label) out.push(menuGroup(doc, label));
    out.push(...rows);
  };
  for (const g of groups) add(Array.isArray(g) ? '' : g?.label || '', rowsOf(g).filter((r) => !isDanger(r)));
  add('', groups.flatMap((g) => rowsOf(g).filter(isDanger)));
  return out;
}
