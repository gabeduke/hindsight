// web/static/lib/components/transport/press-note.js
// The keyboard's press on the bar (docs/architecture/push.md, *The
// keyboard's press*): the banner's words over the bar's display for the second the
// keyboard shows them, marked as the keyboard's by its icon, in the press's
// colour (amber for a refusal), and what it changed lit for that second:
// ▶ or ● (lightFor, lib/bar/press-light.js, which lights a track's head
// for the Studio too).
//
// The press comes from the tape's changes socket (lib/tape/changes.js
// pressOf), through the bar's tape source (lib/models/tape-source.js onPress). The note
// sits over the display, out of the layout (css/bar.css, .np-press), so
// nothing on the bar moves, and taps go through it to the display's keys.
//
// #np-press is a live region (role="status"), always in the page and in the
// accessibility tree, so a screen reader hears each press: what is shown or
// not is its data-kb (the role, while a press shows) and its words, which
// are emptied when it goes. It is never `hidden`, which would take it out
// of the tree and leave nothing to announce.

import { partOf } from '../../bar/slots.js';
import { lightFor } from '../../bar/press-light.js';

/**
 * pressNote is the note on the bar's display: `el` (#np-press), its words
 * (`words`), and the keys a press can light by what it lit (`keys`: play,
 * rec). show(p) says p until its second is up, a new press replacing the
 * one showing. Answers { show(p), clear(), get showing() }.
 */
export function pressNote({ el, words, keys = {} }, env = {}) {
  const wait = env.setTimeout ?? setTimeout;
  const unwait = env.clearTimeout ?? clearTimeout;
  let timer = 0;
  let showing = null;
  function clear() {
    if (timer) unwait(timer);
    timer = 0;
    showing = null;
    if (!el) return;
    delete el.dataset.kb;
    delete el.dataset.kbTrack;
    words.textContent = '';
  }
  return {
    show(p) {
      if (!el || !p) return;
      clear();
      showing = p;
      words.textContent = p.words;
      el.dataset.kb = p.role;
      if (p.track) el.dataset.kbTrack = String(p.track);
      lightFor(p.lit.map((k) => keys[k]), p, env);
      timer = wait(clear, p.ms);
    },
    clear,
    get showing() { return showing; },
  };
}

/**
 * barPressNote is the note of the bar at `root` (#np): its #np-press, found
 * inside it, and the ▶ and ● it lights.
 */
export function barPressNote(root) {
  const part = partOf(root);
  return pressNote({ el: part('press'), words: part('press-words'), keys: { play: part('play'), rec: part('rec') } });
}
