// web/static/lib/help/help.js
// The app explains itself (editing model, "Help, tooltips and the guide"):
//
//   - on a computer, every control with a data-tip gets its tip as a title;
//   - on a phone, the ? button turns on help mode: tapping a control shows
//     its tip instead of using it, until ? is tapped again;
//   - the first time a page is opened on a device, a card with three hints
//     points at what matters most, and is dismissed for good.
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
      'Loop is a toggle. Off, ▶ plays straight through the selection and on.',
    ],
    guide: '/guide.html#4-the-take-page',
  },
};

const GUIDE = { take: '/guide.html#4-the-take-page', main: '/guide.html#3-the-main-page' };

function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

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
  function show(title, text, link) {
    pop.replaceChildren();
    const h = doc.createElement('b');
    h.textContent = title;
    const p = doc.createElement('span');
    p.textContent = text;
    pop.append(h, p);
    if (link) {
      const a = doc.createElement('a');
      a.href = link;
      a.textContent = 'More in the guide';
      pop.appendChild(a);
    }
    pop.hidden = false;
  }

  const btn = doc.getElementById('help');
  let on = false;
  function setOn(v) {
    on = v;
    doc.body.classList.toggle('help-mode', on);
    btn?.setAttribute('aria-pressed', String(on));
    if (on) show('Help mode', 'Tap anything to read what it does. Tap ? again to leave.', GUIDE[page]);
    else pop.hidden = true;
  }
  btn?.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on); });

  // In help mode, a tap on a control shows its tip and does nothing else.
  // Caught on the way down, before the control's own handlers or a
  // canvas's gestures see it.
  const intercept = (e) => {
    if (!on) return;
    const el = e.target.closest?.('[data-tip]');
    if (!el || el === btn || btn?.contains(el) || pop.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click') show(controlFor(el.dataset.tip), tipFor(el.dataset.tip), GUIDE[page]);
  };
  for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'change']) doc.addEventListener(t, intercept, true);

  // First-run hints, once per device per page.
  const hints = HINTS[page];
  if (hints && storageGet(`hints.${page}`) !== '1') {
    const card = doc.createElement('div');
    card.className = 'hints';
    const h = doc.createElement('b');
    h.textContent = hints.title;
    const ul = doc.createElement('ul');
    for (const line of hints.lines) {
      const li = doc.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    const row = doc.createElement('div');
    row.className = 'hints-actions';
    const more = doc.createElement('a');
    more.href = hints.guide;
    more.textContent = 'The guide';
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'icon-btn';
    ok.textContent = 'Got it';
    ok.addEventListener('click', () => { storageSet(`hints.${page}`, '1'); card.remove(); });
    row.append(more, ok);
    card.append(h, ul, row);
    const host = doc.querySelector('[data-hints]') || doc.querySelector('main');
    host?.prepend(card);
  }

  return { isOn: () => on, setOn };
}
