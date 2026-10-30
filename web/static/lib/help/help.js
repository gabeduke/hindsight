// web/static/lib/help/help.js
// The app explains itself (editing model, "Help, tooltips and the guide"):
//
//   - on a computer, every control with a data-tip gets its tip as a title;
//   - Help mode, in the header's menu (#help, lib/nav.js), turns on help
//     mode: tapping a control shows its tip instead of using it, until the
//     tip's Done, Escape or Help mode again (a control with data-tip-pass,
//     the menu's own button among them, shows its tip and is used too);
//     on a page with HINTS, help mode starts with them: what matters most
//     there, said once you have asked.
//
// Tips come from tips.js. A long press couldn't do this job: the nudges
// already repeat when held.

import { tipFor, controlFor } from './tips.js';

export const HINTS = {
  take: {
    title: 'Three things worth knowing',
    lines: [
      'Hold, then drag, on the waveform to select. The grips underneath adjust the ends.',
      'A plain drag always moves along the take; it never moves the selection.',
      'Repeat is a toggle. Off, ▶ plays straight through the selection and on.',
    ],
    guide: '/guide.html#4-the-take-page',
  },
};

const GUIDE = { take: '/guide.html#4-the-take-page', main: '/guide.html#3-the-main-page', takes: '/guide.html#31-the-takes-page', tape: '/guide.html#8-tape' };

/** applyTitles gives every data-tip element under root its tip as a title. */
export function applyTitles(root) {
  const els = root.querySelectorAll ? [...root.querySelectorAll('[data-tip]')] : [];
  if (root.dataset && root.dataset.tip) els.push(root);
  for (const el of els) {
    const tip = tipFor(el.dataset.tip);
    if (tip && !el.title) el.title = tip;
  }
}

export function initHelp({ page, doc = document } = {}) {
  applyTitles(doc);
  // Lanes, list rows and menus are built later; they get titles as they land.
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) applyTitles(n);
  }).observe(doc.body, { childList: true, subtree: true });

  const pop = doc.createElement('div');
  pop.className = 'tip-pop';
  pop.setAttribute('role', 'status');
  pop.hidden = true;
  doc.body.appendChild(pop);
  function show(title, text, link, lines = []) {
    pop.replaceChildren();
    const h = doc.createElement('b');
    h.textContent = title;
    const p = doc.createElement('span');
    p.textContent = text;
    pop.append(h, p);
    if (lines.length) {
      const ul = doc.createElement('ul');
      ul.className = 'tip-pop-hints';
      for (const line of lines) {
        const li = doc.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      }
      pop.appendChild(ul);
    }
    if (link) {
      const a = doc.createElement('a');
      a.href = link;
      a.textContent = 'More in the guide';
      pop.appendChild(a);
    }
    // The way out, on every tip while help mode is on: the menu that turned
    // it on is shut by then, and a phone has no Escape.
    if (on) {
      const done = doc.createElement('button');
      done.type = 'button';
      done.className = 'icon-btn tip-pop-done';
      done.textContent = 'Done';
      done.addEventListener('click', () => setOn(false));
      pop.appendChild(done);
    }
    pop.hidden = false;
  }

  const btn = doc.getElementById('help');
  let on = false;
  function setOn(v) {
    on = v;
    doc.body.classList.toggle('help-mode', on);
    // A menu's item is checked; a button of its own is pressed.
    btn?.setAttribute(btn.getAttribute('role') === 'menuitemcheckbox' ? 'aria-checked' : 'aria-pressed', String(on));
    if (on) show(HINTS[page]?.title || 'Help mode', 'Tap anything to read what it does. Done, or Escape, leaves it.', GUIDE[page], HINTS[page]?.lines);
    else pop.hidden = true;
  }
  btn?.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on); });
  // The header menu's guide opens at the page you're on, as each page's ⋯
  // once did (help mode, above, explains it instead).
  doc.addEventListener('click', (e) => {
    const a = e.target?.closest?.('.appbar-guide-link');
    if (a && GUIDE[page]) a.setAttribute('href', GUIDE[page]);
  }, true);

  // In help mode, a tap on a control shows its tip and does nothing else.
  // Caught on the way down, before the control's own handlers or a
  // canvas's gestures see it.
  const intercept = (e) => {
    if (!on) return;
    const el = e.target.closest?.('[data-tip]');
    if (!el || el === btn || btn?.contains(el) || pop.contains(e.target)) return;
    // A control marked to pass (the phone's player handle) shows its tip and
    // still works: the controls it opens onto have tips of their own.
    if (el.hasAttribute('data-tip-pass')) {
      if (e.type === 'click') show(controlFor(el.dataset.tip), tipFor(el.dataset.tip), GUIDE[page]);
      return;
    }
    // A wheel over the waveform must not zoom it, but the page under it
    // may still scroll, so that one is stopped without being prevented.
    if (e.type !== 'wheel') e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click') show(controlFor(el.dataset.tip), tipFor(el.dataset.tip), GUIDE[page]);
  };
  for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'change', 'wheel']) doc.addEventListener(t, intercept, true);
  // Keyboard shortcuts are actions too: in help mode only Escape works, and
  // it leaves help mode.
  doc.addEventListener('keydown', (e) => {
    if (!on) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Enter or Space on a focused control presses it, and that click shows
    // its tip (above): how help mode works from a keyboard.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-tip]')) return;
    if (e.key === 'Escape') setOn(false);
    if (e.key !== 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  return { isOn: () => on, setOn, setPage: (p) => { page = p; } };
}

