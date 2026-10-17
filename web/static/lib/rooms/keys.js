// web/static/lib/rooms/keys.js
// The Studio's own keys, while the page has the keyboard (the instrument
// strip folded, or the keys given back to editing): the rooms' verbs from
// lib/play/controls.js's one list. The buffer's keys are lib/buffer/keys.js.

import { blocked } from '../buffer/keys.js';
import { STUDIO_KEYS } from '../play/controls.js';

/**
 * bindStudioKeys gives the Studio its keys while the page has the keyboard
 * (lib/play/controls.js, STUDIO_KEYS): C catches, K keeps the feed -- the
 * dashcam's one action gets the plain key -- and the click moves to M
 * (lib/tape/page.js). Bound on the root element in the capture phase, after
 * the buffer's (whose K, while it's open, is KEEP AS TAKE: it prevents the
 * default, and this leaves it), and ahead of the tape page's own.
 */
export function bindStudioKeys(doc, { active = () => true } = {}) {
  const own = new Map(STUDIO_KEYS.filter((k) => k.action !== 'click').map((k) => [k.code, k.action]));
  const down = (e) => {
    if (!active()) return;
    const verb = own.get(e.code);
    if (!verb || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (blocked(e, doc)) return;
    e.preventDefault();
    e.stopPropagation();
    doc.dispatchEvent(new CustomEvent('hindsight:verb', { detail: { verb }, cancelable: true }));
  };
  doc.documentElement.addEventListener('keydown', down, true);
  return () => doc.documentElement.removeEventListener('keydown', down, true);
}
