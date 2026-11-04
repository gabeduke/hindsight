// web/static/lib/bar/player.js
// The phone's player. On a phone (upright, or on its side and short) the
// bar is a mini player above the tabs: its reel window, |◀ ▶ ● ▾, and the
// source's own keys (css/bar.css, "the phone"), with a hairline of where it
// has got to. A tap on the window (#np-expand), or a drag up from it, pulls
// the player up over the page -- the whole bar, large, and on the tape page
// its drawers -- as a sheet you drag (lib/ui/sheet.js): it follows the
// finger, settles on a spring, and a swipe down on its grabber or its art
// puts it away, as Back, Escape and a tap on the grabber do. #np's
// data-size says which it is: 'mini', or 'full' (the player up, and the bar
// anywhere wider than a phone).
// The player up is a layer on the page's stack of open things
// (lib/ui/layers.js), the shell's: Back and Escape close what was opened
// over it first, then it, and a switch of rooms leaves it up.
//
// Two halves (docs/architecture/bar.md, *The Transport's extraction*, D5): the sheet is the
// surface's (playerSheet: the shell's boot makes it over #np-dock, the bar
// and its drawers; Open over its own bar), which moves what is outside the
// bar and stills the page under it; the keys are the bar's (playerKeys: ▣,
// the grabber and the window), which open it, put it away and hand it a
// drag, and lend it the key the focus goes back to. initPlayer is both, for
// a page whose bar is its own (Open).

import { createSheet } from '../ui/sheet.js';
import { barSize } from './slots.js';

// A phone's screen, where alone there is a player: slots.js's, said here
// too for the modules that ask it of the player.
export { PHONE } from './slots.js';

/**
 * playerSheet makes `el` the phone's player, the surface's: `el` is what
 * comes up (the shell's #np-dock, or the bar itself), `root` the bar's
 * root, which it comes up from. `layout` (barLayout, layout.js) says the
 * player up to the page; `phone` is a MediaQueryList for a phone, where
 * alone there is a player. Answers { open(), close(), grab(e), isOpen,
 * lend(keys) }: the bar's keys call open, close and grab (a handle's
 * pointerdown), and lend { owner, shown(), hidden() } -- the key the focus
 * goes back to as it is put away, and what the bar does as it is laid out
 * and put away -- answering a way to take them back.
 */
export function playerSheet(el, { root, layers, layout, phone, doc = el.ownerDocument }) {
  let keys = null;
  let stilled = [];
  // Where the mini player stood, as the sheet's offset from the top of the
  // screen: the sheet comes up from there and goes back down to it, so the
  // mini player grows into the full one.
  let mini = null;

  // What the player covers can't be reached by Tab while it's up. Toasts,
  // tips and sheets stay live; what something else made inert is left be.
  function still(on) {
    for (const e of stilled) e.inert = false;
    stilled = [];
    if (!on) return;
    for (const e of doc.body.children) {
      if (e === el || e.inert || e.matches('script, template, dialog, .sheet, #toasts, .tip-pop')) continue;
      e.inert = true;
      stilled.push(e);
    }
  }

  const sheet = createSheet(el, {
    layers, kind: 'player', modal: true, owner: () => keys?.owner || null,
    // From the mini player's top, measured while it is one; once it is
    // up, back to where it was.
    closed: () => {
      if (!layout.open) mini = root.getBoundingClientRect().top;
      return mini ?? innerHeight;
    },
    // A drag starts on the bar's handles, which hand it their pointerdown
    // (grab): the keys and the strip are pressed, not dragged.
    handles: [],
    when: () => phone.matches && !root.hidden,
    onShow: () => {
      layout.set({ open: true });
      still(true);
      keys?.shown?.();
    },
    onHide: () => {
      layout.set({ open: false });
      still(false);
      keys?.hidden?.();
      // The focus goes back to the key that opened it, unless the bar
      // emptied or the focus has gone on to a menu or a dialog. The
      // surface's to say: the bar's keys never read the document. The
      // stack gives the owner the focus back on Escape or Back as the
      // sheet leaves it (createSheet's owner, layers.js focusBack): then
      // it has it already, and it is given once, not again.
      const owner = keys?.owner;
      const at = doc?.activeElement;
      if (owner && at !== owner && !root.hidden && !at?.closest?.('.menu, dialog')) owner.focus({ preventScroll: true });
    },
  });

  // Wider than a phone, there's no player: the bar is the bar.
  phone.addEventListener('change', () => { if (!phone.matches) sheet.close(); });
  // The bar emptied (a take ended with no tape to go back to): so is the player.
  new MutationObserver(() => { if (root.hidden) sheet.close(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });

  return {
    open() { if (phone.matches && !root.hidden) sheet.open(); },
    close() { sheet.close(); },
    grab: (e) => sheet.grab(e),
    get isOpen() { return sheet.isOpen; },
    lend(k) {
      keys = k;
      return () => { if (keys === k) keys = null; };
    },
  };
}

/**
 * playerKeys wires the bar's keys to the page's player (playerSheet's):
 * `btn` (▣, #np-expand) opens it and puts it away, the grabber puts it away
 * on a phone, and a drag on the grabber or the window (`handles`) moves it.
 * It keeps the bar's data-size ('mini' or 'full') and says the player's
 * state on its keys. `phone` is a MediaQueryList for a phone, whose change
 * it hears through `on(target, type, fn)` (a component's cx.on); the
 * player gives ▣ the focus back as it is put away (playerSheet). It never
 * reads the document. Answers a way off.
 */
export function playerKeys(root, { player, layout, phone, on, btn, grabber = null, handles = [] }) {
  const size = () => { root.dataset.size = barSize({ phone: phone.matches, open: layout.open }); };
  size();
  const say = (on) => {
    btn.setAttribute('aria-expanded', String(on));
    if (grabber && phone.matches) {
      grabber.setAttribute('aria-expanded', String(on));
      grabber.setAttribute('aria-label', on ? 'Put the player away' : 'Fold the bar');
    }
  };
  const off = player.lend({
    owner: btn,
    shown: () => {
      size();
      say(true);
      (grabber || btn).focus({ preventScroll: true });
    },
    hidden: () => {
      size();
      say(false);
    },
  });
  btn.addEventListener('click', () => {
    if (layout.open) player.close();
    else player.open();
  });
  // The grabber at the top of the player puts it away (wider, it folds the
  // bar: lib/components/transport/fold.js, which leaves a phone's to this).
  grabber?.addEventListener('click', () => { if (phone.matches && layout.open) player.close(); });
  // A drag starts on the window (the mini player's, whose handle #np-expand
  // is inside it: up opens it; or the player's art) or the grabber.
  for (const h of handles.filter(Boolean)) h.addEventListener('pointerdown', (e) => player.grab(e));
  on(phone, 'change', size);
  return off;
}

/**
 * initPlayer is the phone's player on a page whose bar is its own (Open):
 * the sheet over the bar, or the dock it is in, and the bar's keys on it.
 * The page hands it its parts and what is the page's: `btn` (its
 * #np-expand; none, and there is no player: null), `grabber`, `layers`
 * (its stack), `layout` (barLayout, layout.js, which says the player up to
 * the page and on the bar's root), `phone` (a MediaQueryList for a phone)
 * and `on(target, type, fn)`. Answers the player.
 */
export function initPlayer({ btn, grabber = null, layers, layout, phone, on }) {
  if (!btn) return null;
  const np = btn.closest('.np');
  // The sheet: the tape page's dock (the bar and its drawers), or the bar.
  const player = playerSheet(np.closest('.np-dock') || np, { root: np, layers, layout, phone });
  playerKeys(np, { player, layout, phone, on, btn, grabber, handles: [grabber, np.querySelector('.np-deck')] });
  return player;
}
