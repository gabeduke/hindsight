// web/static/lib/bar/take-keys.js
// What the bar adds with the rooms on (docs/superpowers/specs/2026-10-15-
// flow-design.md, "A tap plays"; docs/superpowers/plans/2026-10-15-f5b.md):
// with a take in it, the take's name, which opens it, and ✎, which takes the
// frame being heard and opens the take; and ⟲ called Repeat, since the tape's
// loop is another thing. They are made here, in script, so a page with the
// rooms off has none of the markup; every rule that styles them hangs on the
// `np-take` class this adds to the bar, which only a take in the bar under the
// rooms ever wears.

import { takeHref } from './take-source.js';

const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

/** clock is a frame count as the ✎'s name says it: "1:23". */
export function clock(frames, sampleRate) {
  const s = Math.max(0, Math.floor(frames / sampleRate));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * takeKeys makes the name and ✎ in the bar's own keys, after ⏏, and answers
 * paint(src), which says what they and ⟲ show for the bar's source (null for
 * none). `onNote` is what ✎ does; the page gives it.
 */
export function takeKeys({ doc, root, onNote }) {
  const own = doc.getElementById('np-eject')?.parentElement;
  const loop = doc.getElementById('np-loop');
  const name = doc.createElement('a');
  name.id = 'np-name';
  name.className = 'np-name';
  name.setAttribute('data-tip', 'np-name');
  name.hidden = true;
  const note = doc.createElement('button');
  note.id = 'np-note';
  note.className = 'icon-btn np-note';
  note.setAttribute('type', 'button');
  note.setAttribute('data-tip', 'np-note');
  note.textContent = '✎';
  note.hidden = true;
  note.addEventListener('click', () => onNote?.());
  own?.append(name, note);
  return {
    paint(src) {
      const take = !!src && src.kind === 'take';
      root.classList.toggle('np-take', take);
      name.hidden = !take;
      note.hidden = !take;
      if (take) {
        setText(name, src.title);
        setAttr(name, 'href', src.href);
        setAttr(name, 'aria-label', `Open ${src.title}`);
        setAttr(note, 'aria-label', `Note at ${clock(src.pos(), src.sampleRate)}`);
      }
      // ⟲ is the tape's loop for the tape, and for a take it is Repeat.
      if (loop) {
        setText(loop, take ? '⟲ Repeat' : '⟲ Loop');
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
 * read the kept frame until F6, so until then ✎ opens the take where the
 * bar is.
 */
export function noteHere({ frameNow, stash, go }) {
  const f = frameNow();
  if (!f) return null;
  stash(f);
  go(takeHref(f.take));
  return f;
}
