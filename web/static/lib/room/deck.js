// web/static/lib/room/deck.js
// The room's deck, as a picture of the bar (docs/superpowers/specs/2026-10-15-
// flow-design.md, "What happens to today's surfaces"): what the bar holds and
// how far it has got. It has no keys of its own -- no PUT IT ON, no ▶, no
// Play from… -- because the bar is the only transport; a tap on it is Open.
// Pure, but for readBar, which reads the bar's face off the page.

import { spineTitle } from '../shelf.js';

/** fmtLen is a length as the cards say it: "1:59". */
export function fmtLen(s) {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
}

/**
 * deckOf is what the deck holds: the take in the bar (when the list still has
 * it), else the tape the Pi has loaded -- which the bar shows when it holds no
 * take -- else nothing.
 *   takeName  the take in the bar, or null
 *   takes     the page's takes
 *   tapes     GET /api/tapes's answer ({loaded, tapes}), or null with the tape off
 */
export function deckOf({ takeName, takes, tapes }) {
  const t = takeName ? takes.find((x) => x.name === takeName) : null;
  if (t) return { kind: 'take', take: t };
  if (tapes && tapes.loaded) {
    return { kind: 'tape', tape: (tapes.tapes || []).find((x) => x.id === tapes.loaded) || { id: tapes.loaded, name: 'the tape' } };
  }
  return null;
}

/**
 * deckWords is what the deck says, from what it holds and the bar's face
 * ({playing, pos}): its place's plate, its aria label, a line of meta, the
 * LCD, and where a tap on it goes (null with nothing in the bar). A tape is
 * opened in the Studio, saying so first (`forTape`), so no take goes along.
 */
export function deckWords(d, { playing = false, pos = '' } = {}) {
  if (!d) {
    return {
      place: 'The bar · empty', label: 'The bar is empty: tap a take on the shelves to play it',
      meta: 'tap a take to play it', lcd: '--:--', href: null, forTape: false,
    };
  }
  const lcd = pos || '00:00';
  if (d.kind === 'take') {
    const name = spineTitle(d.take);
    return {
      place: `In the bar: ${name}`,
      label: `In the bar: ${name}, a take${playing ? ', playing' : ''}. Open it`,
      meta: `take · ${fmtLen(d.take.duration_seconds)}${playing ? ' · playing' : ''}`,
      lcd, href: `/wave.html?file=${encodeURIComponent(d.take.name)}`, forTape: false,
    };
  }
  const name = d.tape.name;
  return {
    place: `In the bar: ${name}`,
    label: `In the bar: ${name}, the Studio’s tape${playing ? ', playing' : ''}. Open it in the Studio`,
    meta: `tape · in the Studio${playing ? ' · playing' : ''}`,
    lcd, href: '/tape.html', forTape: true,
  };
}

/**
 * readBar reads the bar's own face: whether ▶ is lit, how far its strip is
 * ({0..1}) and its clock's words. The bar has no events of its own for the
 * room to hear, and a take can be moved by its keys, its strip, a page's
 * hand-off or the take's end, so the deck is of what the bar shows.
 */
export function readBar(doc) {
  const playing = !!doc.getElementById('np-play')?.classList.contains('playing');
  const scrub = doc.getElementById('np-scrub');
  const max = Number(scrub?.getAttribute('aria-valuemax')) || 0;
  const frac = max > 0 ? Math.max(0, Math.min(1, Number(scrub.getAttribute('aria-valuenow')) / max)) : 0;
  const pos = doc.getElementById('position')?.textContent || '';
  return { playing, frac, pos };
}
