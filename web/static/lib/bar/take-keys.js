// web/static/lib/bar/take-keys.js
// The keys the bar has for what it holds besides the transport
// (docs/architecture.md, Vocabulary, "A tap plays"; listening-back.md, "The
// way in"): with a take, ✎ at its end, which takes the frame being heard
// for a note, beside Open › (bar.js gives it its page); with the feed, GRAB,
// which sends the feed into the Studio's buffer; and ⟲ called Repeat for a
// take, since the tape's loop is another thing. The keys are the page's
// markup, each in its slot and saying which source it is for (css/bar.css,
// slots.js); this wires them and says what each does now. It makes none:
// a key a script appends lands wherever the last one did.

import { takeHref } from './take-source.js';

const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

/** clock is a frame count as the ✎'s name says it: "1:23". */
export function clock(frames, sampleRate) {
  const s = Math.max(0, Math.floor(frames / sampleRate));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * takeKeys wires the bar's ✎ (`onNote`, the page's) and the feed's GRAB
 * (`onGrabFeed`), and answers paint(src), which says what ✎ and ⟲ say for
 * the bar's source (null for none).
 */
export function takeKeys({ doc, onNote, onGrabFeed }) {
  const loop = doc.getElementById('np-loop');
  // ⟲'s word is a span of its own beside its icon: Repeat replaces Loop
  // there and leaves the icon, which writing the key's text would wipe.
  const loopWord = loop?.querySelector('.loop-word');
  const note = doc.getElementById('np-note');
  note?.addEventListener('click', () => onNote?.());
  doc.getElementById('np-feed-grab')?.addEventListener('click', () => onGrabFeed?.());
  return {
    paint(src) {
      const take = src?.kind === 'take';
      if (take && note) setAttr(note, 'aria-label', `A note at ${clock(src.pos(), src.sampleRate)}`);
      // ⟲ is the tape's loop for the tape, and for a take it is Repeat:
      // the word changes, the icon beside it stays.
      if (loop) {
        setText(loopWord, take ? 'Repeat' : 'Loop');
        const tip = take ? 'np-repeat' : 'np-loop';
        if (loop.dataset.tip !== tip) loop.dataset.tip = tip;
      }
    },
  };
}

/**
 * noteHere is ✎: the take in the bar and its frame at this moment are taken
 * first -- before the page changes, and before anything else runs, so the gap
 * does not move it -- and kept for the next page; then the take opens. Null,
 * and nothing happens, when the bar holds no take. The take page does not
 * read the kept frame until F6 (nor does it pick up where the bar is), so
 * until then ✎ simply opens the take.
 */
export function noteHere({ frameNow, stash, go }) {
  const f = frameNow();
  if (!f) return null;
  stash(f);
  go(takeHref(f.take));
  return f;
}
