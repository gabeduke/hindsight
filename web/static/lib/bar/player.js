// web/static/lib/bar/player.js
// The phone's player. On a phone (upright, or on its side and short) the
// now-playing bar is a mini player above the tabs: its reel window, ▶, and
// on the tape Catch, with a hairline of where it has got to. A tap on the
// window pulls the player up over the page -- the whole bar, large, and on
// the tape its drawers -- and ▾, Back or Escape puts it away (styles.css,
// "the phone's player"). One button does both: #np-expand, in the window.

const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/** initPlayer wires the page's #np-expand, if it has one. */
export function initPlayer() {
  const btn = document.getElementById('np-expand');
  if (!btn) return;
  const np = btn.closest('.np');
  // The sheet: the tape page's dock (the bar and its drawers), or the bar.
  const sheet = np.closest('.np-dock') || np;
  const phone = matchMedia(PHONE);
  const isOpen = () => document.body.classList.contains('player-open');
  let pushed = false;
  let stilled = [];

  // A reload keeps the history entry the player was open on: not open now.
  if (history.state?.player) {
    const { player, ...rest } = history.state;
    history.replaceState(Object.keys(rest).length ? rest : null, '');
  }

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
    // Back puts it away, as it does the takes page's cassette.
    history.pushState({ ...(history.state || {}), player: 1 }, '');
    pushed = true;
    btn.focus({ preventScroll: true });
  }
  function close(fromHistory = false) {
    if (!isOpen()) return;
    set(false);
    if (pushed && !fromHistory) history.back();
    pushed = false;
    if (!np.hidden) btn.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  // Any move in the history while it's up leaves the player's entry.
  addEventListener('popstate', () => close(true));
  // Escape puts the player away first, before a drawer or anything under it.
  addEventListener('keydown', (e) => {
    // A sheet open takes Escape first; the tape's inspector, hidden under the
    // player, doesn't.
    const sheet = [...document.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('inspector'));
    if (e.key !== 'Escape' || !isOpen() || sheet) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, true);
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
  const glyph = btn.querySelector('.np-fold-glyph') || btn;

  const applyFold = (folded) => {
    doc.body.classList.toggle('np-fold', folded);
    btn.setAttribute('aria-expanded', String(!folded));
    btn.setAttribute('aria-label', folded ? 'Expand transport' : 'Collapse transport');
    if (glyph.classList?.contains('np-fold-glyph')) {
      glyph.textContent = folded ? '▴' : '▾';
    } else {
      btn.textContent = folded ? '▴' : '▾';
    }
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
