// web/static/lib/bar/press-note.js
// The keyboard's press on the bar (docs/architecture/push.md, *The
// keyboard's press*): the banner's words over the bar's display for the second the
// keyboard shows them, marked as the keyboard's by its icon, in the press's
// colour (amber for a refusal), and what it changed lit for that second:
// ▶, ●, or (lightFor, from the Studio) a track's head.
//
// The press comes from the tape's changes socket (lib/tape/changes.js
// pressOf), through the bar's tape source (tape-source.js onPress). The note
// sits over the display, out of the layout (css/bar.css, .np-press), so
// nothing on the bar moves, and taps go through it to the display's keys.
//
// #np-press is a live region (role="status"), always in the page and in the
// accessibility tree, so a screen reader hears each press: what is shown or
// not is its data-kb (the role, while a press shows) and its words, which
// are emptied when it goes. It is never `hidden`, which would take it out
// of the tree and leave nothing to announce.

const LIT_CLASS = 'kb-lit';

// What is lit, and the timer that puts it out, per element: a second press
// on the same key starts its second again.
const lights = new WeakMap();

/**
 * lightFor lights els in p's role for what is left of p's second
 * (p.ms): data-kb carries the role, and data-kb-track a Mixer press's
 * track, for its colour. env's timers are for tests.
 */
export function lightFor(els, p, env = {}) {
  const wait = env.setTimeout ?? setTimeout;
  const unwait = env.clearTimeout ?? clearTimeout;
  for (const el of els) {
    if (!el) continue;
    const was = lights.get(el);
    if (was) unwait(was);
    el.classList.add(LIT_CLASS);
    el.dataset.kb = p.role;
    if (p.track) el.dataset.kbTrack = String(p.track); else delete el.dataset.kbTrack;
    lights.set(el, wait(() => putOut(el), p.ms));
  }
}

function putOut(el) {
  lights.delete(el);
  el.classList.remove(LIT_CLASS);
  delete el.dataset.kb;
  delete el.dataset.kbTrack;
}

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
 * lightTrackHead lights the head of the track p changed (p.track, 1 up),
 * among the Studio's lanes ({n, row}), when p lit a track: the Studio's own
 * part of a press (lib/tape/page.js). Answers the head lit, or null.
 */
export function lightTrackHead(lanes, p, env = {}) {
  if (!p || !p.lit.includes('track')) return null;
  const head = lanes.find((l) => l.n === p.track)?.row.querySelector('.tt-head') ?? null;
  if (head) lightFor([head], p, env);
  return head;
}

/** barPressNote is the bar's note in this document: shell.html's #np-press. */
export function barPressNote(doc = document) {
  const $ = (id) => doc.getElementById(id);
  return pressNote({ el: $('np-press'), words: $('np-press-words'), keys: { play: $('np-play'), rec: $('rec') } });
}
