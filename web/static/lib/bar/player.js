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

import { layersOf } from '../ui/layers.js';
import { createSheet } from '../ui/sheet.js';
import { barSize } from './slots.js';

export const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/** initPlayer wires the page's #np-expand, if it has one. Answers its sheet. */
export function initPlayer({ layers = layersOf(document) } = {}) {
  const btn = document.getElementById('np-expand');
  if (!btn) return null;
  const np = btn.closest('.np');
  const grabber = document.getElementById('np-grabber');
  // The sheet: the tape page's dock (the bar and its drawers), or the bar.
  const el = np.closest('.np-dock') || np;
  const phone = matchMedia(PHONE);
  const isOpen = () => document.body.classList.contains('player-open');
  let stilled = [];
  // Where the mini player stood, as the sheet's offset from the top of the
  // screen: the sheet comes up from there and goes back down to it, so the
  // mini player grows into the full one.
  let mini = null;

  const size = () => { np.dataset.size = barSize({ phone: phone.matches, open: isOpen() }); };
  size();

  // What the player covers can't be reached by Tab while it's up. Toasts,
  // tips and sheets stay live; what something else made inert is left be.
  function still(on) {
    for (const e of stilled) e.inert = false;
    stilled = [];
    if (!on) return;
    for (const e of document.body.children) {
      if (e === el || e.inert || e.matches('script, template, dialog, .sheet, #toasts, .tip-pop')) continue;
      e.inert = true;
      stilled.push(e);
    }
  }
  function set(on) {
    document.body.classList.toggle('player-open', on);
    size();
    still(on);
    btn.setAttribute('aria-expanded', String(on));
    if (grabber && phone.matches) {
      grabber.setAttribute('aria-expanded', String(on));
      grabber.setAttribute('aria-label', on ? 'Put the player away' : 'Fold the bar');
    }
  }

  const sheet = createSheet(el, {
    layers, kind: 'player', modal: true, owner: btn,
    // From the mini player's top, measured while it is one; once it is
    // up, back to where it was.
    closed: () => {
      if (!isOpen()) mini = np.getBoundingClientRect().top;
      return mini ?? innerHeight;
    },
    // A drag starts on the mini player's window (up opens it), the grabber,
    // or the art; the keys and the strip are pressed, not dragged.
    handles: [btn, grabber, np.querySelector('.np-window')],
    when: () => phone.matches && !np.hidden,
    onShow: () => {
      set(true);
      (grabber || btn).focus({ preventScroll: true });
    },
    onHide: () => {
      set(false);
      if (!np.hidden && !document.activeElement?.closest?.('.menu, dialog')) btn.focus({ preventScroll: true });
    },
  });

  btn.addEventListener('click', () => {
    if (isOpen()) sheet.close();
    else if (phone.matches && !np.hidden) sheet.open();
  });
  // The grabber at the top of the player puts it away (wider, it folds the
  // bar: lib/bar/fold.js, which leaves a phone's to this).
  grabber?.addEventListener('click', () => { if (phone.matches && isOpen()) sheet.close(); });
  // Wider than a phone, there's no player: the bar is the bar.
  phone.addEventListener('change', () => { if (!phone.matches) sheet.close(); size(); });
  // The bar emptied (a take ended with no tape to go back to): so is the player.
  new MutationObserver(() => { if (np.hidden) sheet.close(); }).observe(np, { attributes: true, attributeFilter: ['hidden'] });
  return sheet;
}
