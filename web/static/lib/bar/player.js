// web/static/lib/bar/player.js
// The phone's player. On a phone (upright, or on its side and short) the
// now-playing bar is a mini player above the tabs: its reel window, ▶, and
// on the tape Catch, with a hairline of where it has got to. A tap on the
// window pulls the player up over the page -- the whole bar, large, and on
// the tape its drawers -- and ▾, Back or Escape puts it away (styles.css,
// "the phone's player"). One button does both: #np-expand, in the window.
// The player up is a layer on the page's stack of open things
// (lib/ui/layers.js), the shell's: Back and Escape close what was opened
// over it first, then it, and a switch of rooms leaves it up.

import { layersOf } from '../ui/layers.js';

const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/** initPlayer wires the page's #np-expand, if it has one. */
export function initPlayer({ layers = layersOf(document) } = {}) {
  const btn = document.getElementById('np-expand');
  if (!btn) return;
  const np = btn.closest('.np');
  // The sheet: the tape page's dock (the bar and its drawers), or the bar.
  const sheet = np.closest('.np-dock') || np;
  const phone = matchMedia(PHONE);
  const isOpen = () => document.body.classList.contains('player-open');
  let layer = null;
  let stilled = [];

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
    still(on);
    btn.setAttribute('aria-expanded', String(on));
    btn.setAttribute('aria-label', on ? 'Put the player away' : 'Open the player');
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
    btn.focus({ preventScroll: true });
  }
  function close() {
    if (layer?.open) layer.close();
    else if (isOpen()) set(false);
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  // Wider than a phone, there's no player: the bar is the bar.
  phone.addEventListener('change', () => { if (!phone.matches) close(); });
  // The bar emptied (a take ended with no tape to go back to): so is the player.
  new MutationObserver(() => { if (np.hidden) close(); }).observe(np, { attributes: true, attributeFilter: ['hidden'] });

  initTransportFold(document);
}

export const NP_FOLD_KEY = 'hindsight.npFold';

/**
 * initTransportFold wires the desktop media player collapse toggle (#np-fold-btn).
 * Toggling it collapses the full 2-row transport bar into a slim compact bar,
 * freeing vertical height for the tape lanes.
 */
export function initTransportFold(doc = document, storage = null) {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const btn = doc.getElementById('np-fold-btn');
  if (!btn) return null;

  const applyFold = (folded) => {
    doc.body.classList.toggle('np-fold', folded);
    btn.setAttribute('aria-expanded', String(!folded));
    btn.setAttribute('aria-label', folded ? 'Expand transport' : 'Collapse transport');
    // Its ▾ turns over into ▴ by the body's np-fold (styles.css).
    try {
      if (store) {
        if (folded) store.setItem(NP_FOLD_KEY, '1');
        else store.removeItem(NP_FOLD_KEY);
      }
    } catch { /* private mode */ }
    doc.dispatchEvent(new CustomEvent('hindsight:np-fold', { detail: { folded } }));
  };

  try {
    if (store?.getItem(NP_FOLD_KEY) === '1') applyFold(true);
  } catch { /* fine */ }

  const onClick = () => {
    applyFold(!doc.body.classList.contains('np-fold'));
  };
  btn.addEventListener('click', onClick);

  return {
    apply: applyFold,
    destroy() {
      btn.removeEventListener('click', onClick);
    },
  };
}
