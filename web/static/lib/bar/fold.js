// web/static/lib/bar/fold.js
// The bar folds by the grabber on its top edge (docs/architecture/
// bar.md, "It folds by its grabber"): a tap folds it or unfolds it, a drag
// down folds it and a drag up unfolds it. Folded, it is one row of keys and
// no strip, so the Studio's lanes have the room (css/bar.css). It stays
// folded for the visit, through a reload: the page's layout keeps it
// (layout.js, with the page's sessionStorage).
//
// It slides, not jumps: the page takes its new layout at once, then the bar
// is moved back to where it was by a transform and let go on the lid spring
// (a FLIP), so nothing but a transform moves on each frame. On a phone the
// grabber belongs to the player pulled up, which it puts away (player.js).

import { GESTURE } from '../ui/press.js';
import { partOf } from './slots.js';

/** REDUCED is the screen asking for less motion: the fold is a change, not a slide. */
export const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * initFold wires the grabber of the bar at `root` (#np-grabber, inside it),
 * if it has one: answers { apply(folded), toggle(), destroy() }, or null.
 * `layout` is the page's (barLayout, layout.js), which says the fold to the
 * page and keeps it for the visit, so a page reloaded folded is folded
 * before this is wired; `phone` is a MediaQueryList for a phone, whose
 * grabber is the player's, and `reduced` one for less motion (REDUCED),
 * each a component's cx.media; `slide` moves the bar from where it was
 * (slideFrom, below), handed in for the tests.
 */
export function initFold(root, {
  layout,
  phone = { matches: false },
  reduced = { matches: false },
  slide = (np, change) => slideFrom(np, change, { still: !!reduced.matches }),
} = {}) {
  const grabber = partOf(root)('grabber');
  if (!grabber) return null;
  const np = root;
  const folded = () => layout.folded;

  const say = (on) => {
    grabber.setAttribute('aria-expanded', String(!on));
    grabber.setAttribute('aria-label', on ? 'Unfold the bar' : 'Fold the bar');
  };
  const apply = (on, { moved = true } = {}) => {
    const change = () => {
      layout.set({ folded: on });
      say(on);
    };
    if (moved && np) slide(np, change);
    else change();
  };

  say(folded());

  // A press on the grabber: a tap toggles (the click), a drag decides by
  // its direction, and the click its lift sends is then not a tap.
  let down = null; // { id, y }
  let dragged = false;
  const onDown = (e) => {
    if (e.button > 0 || phone.matches) return;
    down = { id: e.pointerId, y: e.clientY };
    dragged = false;
    grabber.classList.add('down');
    grabber.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dy = e.clientY - down.y;
    down = null;
    grabber.classList.remove('down');
    if (Math.abs(dy) <= GESTURE.SLOP_PX) return; // a tap: the click does it
    dragged = true;
    if (dy > 0 && !folded()) apply(true);
    else if (dy < 0 && folded()) apply(false);
  };
  const onCancel = () => { down = null; grabber.classList.remove('down'); };
  const onClick = () => {
    if (dragged) { dragged = false; return; }
    if (phone.matches) return; // the player's: player.js
    apply(!folded());
  };
  grabber.addEventListener('pointerdown', onDown);
  grabber.addEventListener('pointerup', onUp);
  grabber.addEventListener('pointercancel', onCancel);
  grabber.addEventListener('click', onClick);

  return {
    apply,
    toggle: () => apply(!folded()),
    destroy() {
      grabber.removeEventListener('pointerdown', onDown);
      grabber.removeEventListener('pointerup', onUp);
      grabber.removeEventListener('pointercancel', onCancel);
      grabber.removeEventListener('click', onClick);
    },
  };
}

/**
 * slideFrom makes `change` (a new layout for the bar) and moves the bar from
 * where it stood before it to where it stands after, by a transform on the
 * lid spring (css/bar.css, .np-sliding): read, change, read, invert, play.
 * With less motion (`still`, which the caller asks of the screen: REDUCED),
 * or nothing moved, it is only the change.
 */
export function slideFrom(np, change, { still = false } = {}) {
  const before = np.getBoundingClientRect().top;
  np.classList.remove('np-sliding');
  np.style.transform = '';
  change();
  const dy = before - np.getBoundingClientRect().top;
  if (still || Math.abs(dy) < 1) return;
  const strip = np.querySelector('.np-row-2');
  np.style.transform = `translateY(${dy}px)`;
  if (strip) strip.style.opacity = '0';
  np.getBoundingClientRect(); // the start, laid down before the move
  np.classList.add('np-sliding');
  np.style.transform = '';
  if (strip) strip.style.opacity = '';
  const done = (e) => {
    if (e && (e.target !== np || e.propertyName !== 'transform')) return;
    np.classList.remove('np-sliding');
    np.removeEventListener('transitionend', done);
    np.removeEventListener('transitioncancel', done);
  };
  np.addEventListener('transitionend', done);
  np.addEventListener('transitioncancel', done);
}
