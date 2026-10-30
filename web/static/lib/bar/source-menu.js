// web/static/lib/bar/source-menu.js
// The display's source key opens what the bar can play (the agreed design,
// "The display says what plays", docs/plan): the tape, the live feed,
// the last few takes, and the shelf. It replaced a Feed | Tape | Shelf switch
// on the bar, a segmented control that sometimes changed rooms and sometimes
// did nothing, and took 160 px of a bar that ran off the tablet.
//
// One menu (lib/ui/menu.js), placed by its key; the rows are menuItems, the
// one playing checked. A pick is the engine's to make (engine.js).

import { menu, menuItem, menuDivider, menuGroup } from '../ui/menu.js';
import { takeTitle } from '../rooms/takename.js';
import { icon } from '../ui/icons.js';

/** RECENT is how many of the newest takes the menu offers. */
export const RECENT = 3;

/**
 * recentTakes is the newest `n` of `takes` (as /api/jams lists them), newest first:
 * by the time in their names, which is when they were cut.
 */
export function recentTakes(takes, n = RECENT) {
  return [...(takes || [])].sort((a, b) => String(b.name).localeCompare(String(a.name))).slice(0, n);
}

/**
 * sourceRows are the menu's rows for what plays now (`kind`, and the take's
 * `takeName`), whether there is a tape, and the `recent` takes: each row
 * { id, word, sub, checked, disabled, href }. Pure, for the tests.
 */
export function sourceRows({ kind, takeName = null, tape = null, recent = [] }) {
  const rows = [
    { id: 'tape', word: 'The tape', sub: tape ? tape : 'no tape is loaded', checked: kind === 'tape', disabled: !tape },
    { id: 'feed', word: 'The live feed', sub: 'what the room hears now', checked: kind === 'feed', disabled: false },
  ];
  const takes = recent.map((t) => ({
    id: `take:${t.name}`, word: takeTitle(t), sub: lengthOf(t), checked: kind === 'take' && takeName === t.name, disabled: false,
  }));
  return { rows, takes, shelf: { id: 'shelf', word: 'Go to the shelf', href: '/takes.html' } };
}

function lengthOf(t) {
  const s = Math.max(0, Math.round(t.duration_seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * sourceMenu wires the display's source key (`button`) to `panel`:
 *   now()       what plays: { kind, takeName, tape } (tape: the loaded tape's name, or null)
 *   list()      a promise of the takes (the page's, lib/models/takes.js get())
 *   pick(id)    'tape', 'feed' or 'take:<name>'
 *   layers      the page's stack
 * Answers its menu.
 */
export function sourceMenu({ doc = document, button, panel, now, list, pick, layers, floor }) {
  let recent = [];
  let asked = 0;
  const render = (p) => {
    const { rows, takes, shelf } = sourceRows({ ...now(), recent });
    const item = (r) => {
      const el = menuItem(doc, { word: r.word, sub: r.sub, role: 'menuitemradio', checked: r.checked, attrs: { 'data-source': r.id } });
      if (r.disabled) el.setAttribute('aria-disabled', 'true');
      else el.addEventListener('click', () => pick(r.id));
      return el;
    };
    const parts = [...rows.map(item)];
    if (takes.length) parts.push(menuDivider(doc), menuGroup(doc, 'Recent takes'), ...takes.map(item));
    const go = menuItem(doc, { word: shelf.word, href: shelf.href, end: chevron(doc), attrs: { 'data-source': 'shelf' } });
    parts.push(menuDivider(doc), go);
    p.replaceChildren(...parts);
  };
  const m = menu(button, panel, { layers, doc, align: 'start', floor, render, focus: 'checked' });
  // The takes are asked for as it opens; it shows the last answer until
  // the new one comes, then again with it.
  button.addEventListener('click', () => {
    if (!m.isOpen()) return;
    const n = ++asked;
    Promise.resolve(list()).then((all) => {
      if (n !== asked) return;
      recent = recentTakes(all);
      m.refresh();
    }, () => {});
  });
  return m;
}

function chevron(doc) {
  const s = doc.createElement('span');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = icon('right', { size: 16 });
  return s;
}
