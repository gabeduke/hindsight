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
  const phone = matchMedia(PHONE);
  const isOpen = () => document.body.classList.contains('player-open');
  let pushed = false;

  function set(on) {
    document.body.classList.toggle('player-open', on);
    btn.setAttribute('aria-expanded', String(on));
    btn.setAttribute('aria-label', on ? 'Put the player away' : 'Open the player');
  }
  function open() {
    if (isOpen() || !phone.matches) return;
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
    btn.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  addEventListener('popstate', () => { if (isOpen() && !history.state?.player) close(true); });
  // Escape puts the player away first, before a drawer or anything under it.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen() || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, true);
  // Wider than a phone, there's no player: the bar is the bar.
  phone.addEventListener('change', () => { if (!phone.matches) close(); });
}
