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

/**
 * SLOTS are the bar's places, in order along it: the zones, then the strip,
 * then the foot (where it plays, shown in the phone's player alone).
 */
export const SLOTS = Object.freeze(['deck', 'transport', 'verb', 'modes', 'end', 'strip', 'foot']);

/** SOURCES are what the bar can hold, as #np's data-source says them. */
export const SOURCES = Object.freeze(['tape', 'take', 'feed']);

/**
 * slotOf is the bar's slot `name` in `doc`: the element a script puts into.
 * It throws on a name the bar hasn't got, which would otherwise put a key
 * nowhere, silently.
 */
export function slotOf(doc, name) {
  if (!SLOTS.includes(name)) throw new TypeError(`the bar has no slot "${name}" (it has ${SLOTS.join(', ')})`);
  return doc.querySelector(`#np [data-slot="${name}"]`);
}

/**
 * putIn puts `node` in slot `name`: at its end, or with `first` at its start.
 * Answers the slot, or null on a page whose bar hasn't got it.
 */
export function putIn(doc, name, node, { first = false } = {}) {
  const slot = slotOf(doc, name);
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

/** deviceOf reads `win`'s screen for hereWord: a phone, and a finger for a pointer. */
export function deviceOf(win = globalThis) {
  const mq = (q) => !!win.matchMedia?.(q)?.matches;
  return {
    phone: mq('(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)'),
    coarse: mq('(pointer: coarse)'),
  };
}

/**
 * measureBar writes the bar's height, as it is drawn, into --np-h on `root`
 * (the page's <html>), now and whenever it changes: folded, a strip across
 * its top, the phone's mini player, a row of Play's. Hidden, it is 0. One
 * observer, whatever changed its height. Answers its disconnect.
 */
export function measureBar(np, { root = np?.ownerDocument?.documentElement, RO = globalThis.ResizeObserver } = {}) {
  if (!np || !root || typeof RO !== 'function') return () => {};
  let last = null;
  const write = (h) => {
    const v = `${Math.round(h)}px`;
    if (v === last) return;
    last = v;
    root.style.setProperty('--np-h', v);
  };
  const ro = new RO(([e]) => {
    const b = e?.borderBoxSize?.[0];
    write(b ? b.blockSize : (np.getBoundingClientRect?.().height || 0));
  });
  ro.observe(np);
  return () => ro.disconnect();
}
