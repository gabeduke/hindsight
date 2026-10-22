// web/static/lib/rooms/keymenu.js
// A key with a ▾ beside it (docs/plan/the-studio-on-one-screen.md): the key
// does its verb with what it took last time, and its ▾ opens a small panel
// of how much it takes, under the pair -- GRAB's bars and input, KEEP's
// length. A key and a ▾ of its own, not a part of one key as Catch's is, so a
// tap on the verb can never be read as the ▾, and each is a target of its
// own for a finger and for a screen reader.

/**
 * keyMenu wires `more` (the ▾ button) to open `pop` (the panel, hidden)
 * under `anchor` (the pair), and to shut it on the ▾ again, Escape, a press
 * on the key's verb, or a press anywhere but the pair and the panel. ↓ on
 * the ▾ opens it and puts the focus on the panel's first button. Answers
 * {open, close, isOpen}.
 */
export function keyMenu(more, pop, { anchor = more.parentElement, doc = document, win = doc.defaultView || globalThis } = {}) {
  more.setAttribute('aria-haspopup', 'dialog');
  more.setAttribute('aria-expanded', 'false');
  if (pop.id) more.setAttribute('aria-controls', pop.id);
  pop.hidden = true;

  // Fixed, so a panel's overflow never clips it: under the pair, its right
  // edge on the pair's, and moved in from the screen's sides.
  const place = () => {
    if (!anchor?.getBoundingClientRect || !pop.style) return;
    const a = anchor.getBoundingClientRect();
    const vw = win.innerWidth || 0;
    const w = pop.getBoundingClientRect?.().width || 0;
    const left = Math.max(8, Math.min(a.right - w, vw - w - 8));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(a.bottom + 6)}px`;
  };
  const open = (focus = false) => {
    pop.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    place();
    if (focus) pop.querySelector('button')?.focus?.();
  };
  const close = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    more.setAttribute('aria-expanded', 'false');
  };
  more.addEventListener('click', () => (pop.hidden ? open() : close()));
  // The verb, beside the ▾: it goes with what is chosen, and the panel shuts.
  anchor?.addEventListener?.('click', (e) => { if (!more.contains(e.target)) close(); });
  win.addEventListener?.('pointerdown', (e) => {
    if (!pop.hidden && !anchor?.contains(e.target) && !pop.contains(e.target)) close();
  }, true);
  win.addEventListener?.('resize', close);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) { close(); more.focus?.(); }
  });
  more.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault?.();
    open(true);
  });
  return { open, close, isOpen: () => !pop.hidden };
}
