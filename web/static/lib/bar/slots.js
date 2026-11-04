// web/static/lib/bar/slots.js
// The bar's shape (css/bar.css; docs/architecture/bar.md): five zones
// in a row -- the deck, the transport, the verb, the modes and the end -- and
// the strip under them, each a named slot in the page's markup
// (data-slot="…"). The keys are the markup's, each in its slot, saying which
// sources it is for (data-for, data-mini). A script that adds something to
// the bar puts it into a slot by name, never after whatever was added last:
// the bar once grew a key at its right end each time a script appended one,
// until the end ran off a tablet.
//
// Also here: the bar's size (the phone's mini player, or the full bar) and
// its height, measured once by one observer (--np-h on the root), for the
// pages that keep clear of it -- never a number written into the CSS for each
// state and device, as thirteen were.

import { measureInto } from '../ui/measure.js';

/**
 * SLOTS are the bar's places, in order along it: the zones, then the strip,
 * then the foot (where it plays, shown in the phone's player alone).
 */
export const SLOTS = Object.freeze(['deck', 'transport', 'verb', 'modes', 'end', 'strip', 'foot']);

/** SOURCES are what the bar can hold, as #np's data-source says them. */
export const SOURCES = Object.freeze(['tape', 'take', 'feed']);

/**
 * slotOf is the slot `name` of the bar whose root is `root` (#np): the
 * element a script puts into. It throws on a name the bar hasn't got, which
 * would otherwise put a key nowhere, silently.
 */
export function slotOf(root, name) {
  if (!SLOTS.includes(name)) throw new TypeError(`the bar has no slot "${name}" (it has ${SLOTS.join(', ')})`);
  return root.querySelector(`[data-slot="${name}"]`);
}

/**
 * putIn puts `node` in slot `name` of the bar at `root`: at its end, or
 * with `first` at its start. Answers the slot, or null on a bar without it.
 */
export function putIn(root, name, node, { first = false } = {}) {
  const slot = slotOf(root, name);
  if (!slot) return null;
  if (first) slot.prepend(node);
  else slot.append(node);
  return slot;
}

/**
 * barSize is what #np's data-size says: 'mini' for the phone's mini player
 * (a phone, with the player down), 'full' for the bar anywhere else and for
 * the player pulled up.
 */
export const barSize = ({ phone, open }) => (phone && !open ? 'mini' : 'full');

/**
 * hereWord is where a take, or the feed, plays: on this device, said as
 * the display says it, by the kind of device it is.
 */
export function hereWord({ phone = false, coarse = false } = {}) {
  if (phone) return 'THIS PHONE';
  return coarse ? 'THIS TABLET' : 'THIS COMPUTER';
}

/**
 * PHONE is a phone's screen: upright, or on its side and short. The mini
 * player is a phone's (player.js), and so is THIS PHONE.
 */
export const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/** COARSE is a finger for a pointer: THIS TABLET, wider than a phone. */
export const COARSE = '(pointer: coarse)';

/**
 * deviceOf reads the screen for hereWord: a phone, and a finger for a
 * pointer. `media(query)` answers a MediaQueryList (a component's
 * cx.media, or the page's matchMedia): the screen is asked through it,
 * never through the window.
 */
export function deviceOf(media) {
  const mq = (q) => !!media?.(q)?.matches;
  return { phone: mq(PHONE), coarse: mq(COARSE) };
}

/**
 * partOf answers a look-up of the bar's parts inside its `root`, by name:
 * partOf(np)('play') is #np-play, the id a component's cx.id('play') gives
 * a part of root #np. Never the document's: a part is found in the root a
 * module is handed, or not at all (null). A part found is kept, so the
 * bar's frame, which writes some twenty of them, looks each up once.
 */
export function partOf(root) {
  const kept = new Map();
  return (name) => {
    let el = kept.get(name);
    if (!el) {
      el = root.querySelector(`#${root.id}-${name}`);
      if (el) kept.set(name, el);
    }
    return el;
  };
}

/**
 * measureBar writes the bar's height, as it is drawn, into --np-h on `root`
 * (the page's <html>), now and whenever it changes: folded, a strip across
 * its top, the phone's mini player, a row of Play's. Hidden, it is 0. One
 * observer, whatever changed its height. Answers its disconnect.
 */
export function measureBar(np, opts = {}) {
  return measureInto(np, '--np-h', opts);
}
