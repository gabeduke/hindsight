// web/static/lib/bar/player.js
// The phone's player. On a phone (upright, or on its side and short) the
// bar is a mini player above the tabs: its reel window, |◀ ▶, and the
// source's own keys (css/bar.css, "the phone"), with a hairline of where it
// has got to. A tap on the window (#np-expand) pulls the player up over the
// page -- the whole bar, large, and on the tape page its drawers -- and its
// grabber (#np-grabber), Back or Escape puts it away. #np's data-size says
// which it is: 'mini', or 'full' (the player up, and the bar anywhere wider
// than a phone).
// The player up is a layer on the page's stack of open things
// (lib/ui/layers.js), the shell's: Back and Escape close what was opened
// over it first, then it, and a switch of rooms leaves it up.

import { layersOf } from '../ui/layers.js';
import { barSize } from './slots.js';

export const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/** initPlayer wires the page's #np-expand, if it has one. */
export function initPlayer({ layers = layersOf(document) } = {}) {
  const btn = document.getElementById('np-expand');
  if (!btn) return;
  const np = btn.closest('.np');
  const grabber = document.getElementById('np-grabber');
  // The sheet: the tape page's dock (the bar and its drawers), or the bar.
  const sheet = np.closest('.np-dock') || np;
  const phone = matchMedia(PHONE);
  const isOpen = () => document.body.classList.contains('player-open');
  let layer = null;
  let stilled = [];

  const size = () => { np.dataset.size = barSize({ phone: phone.matches, open: isOpen() }); };
  size();

  // What the player covers can't be reached by Tab while it's up. Toasts,
  // tips and sheets stay live; what something else made inert is left be.
  function still(on) {
    for (const el of stilled) el.inert = false;
    stilled = [];
    if (!on) return;
    for (const el of document.body.children) {
      if (el === sheet || el.inert || el.matches('script, template, dialog, .sheet, #toasts, .tip-pop')) continue;
      el.inert = true;
      stilled.push(el);
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
  function open() {
    if (isOpen() || !phone.matches || np.hidden) return;
    set(true);
    // On the stack, made in the tap that pulled it up: Back and Escape put
    // it away, after a sheet or a menu opened over it.
    layer = layers.open({
      el: sheet, kind: 'player', modal: true, owner: btn,
      onClose: () => {
        layer = null;
        set(false);
        if (!np.hidden) btn.focus({ preventScroll: true });
      },
    });
    (grabber || btn).focus({ preventScroll: true });
  }
  function close() {
    if (layer?.open) layer.close();
    else if (isOpen()) set(false);
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  // The grabber at the top of the player puts it away (wider, it folds the
  // bar: lib/bar/fold.js, which leaves a phone's to this).
  grabber?.addEventListener('click', () => { if (phone.matches && isOpen()) close(); });
  // Wider than a phone, there's no player: the bar is the bar.
  phone.addEventListener('change', () => { if (!phone.matches) close(); size(); });
  // The bar emptied (a take ended with no tape to go back to): so is the player.
  new MutationObserver(() => { if (np.hidden) close(); }).observe(np, { attributes: true, attributeFilter: ['hidden'] });
}
