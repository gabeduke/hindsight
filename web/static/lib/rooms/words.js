// web/static/lib/rooms/words.js
// The rooms' words (docs/superpowers/specs/2026-10-15-flow-design.md, "Every
// word on screen today"). The pages the rooms share with Capture, Takes and
// Tape carry the old words in their markup and in the strings they build; with
// the flag off that is exactly what is shown. With it on, say() gives the
// rooms' word for each: flag -> note, clip -> part, ring -> feed, clipboard ->
// buffer, mix down -> bounce, Punch-in FX -> FX.
//
// The choice is made here, at runtime, from the flag, so a shared string is
// never edited and the rooms off answer with the very same text. Two places
// call it for everything a page says:
//   - tipFor (lib/help/tips.js) for every tip and title;
//   - applyWords, once, for a page's own markup (nav.js, so every page);
// and the modules that build text -- a toast, an aria-label, a sheet -- wrap it
// in say() where it is made. words.test.js reads each of those literals.
//
// What a person typed is theirs: a take's, tape's or tag's name is never run
// through here. A toast puts a name in curly quotes (“…”) and say() leaves
// whatever is inside them alone.

import { on } from './flag.js';

const keepCase = (word, to) => (word[0] !== word[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to);

// Ordered: the specific phrases first, then the bare words.
const RULES = [
  [/Flag now/g, () => '✎ Note'],
  [/Punch-in FX/gi, () => 'FX'],
  [/Keep as clip/g, () => 'GRAB'], // the selection's other verb; the crate it filled is gone
  [/Save as take/g, () => 'KEEP'],
  [/Send to → Tape/g, () => 'GRAB'],
  [/Hold an empty part/g, () => 'Hold an empty spot'], // not the part a clip becomes
  [/A punch shows in red as it records/g, () => 'The Rec shows in red as it records'],
  [/\ba punch is recording\b/g, () => '● Rec is recording'],
  [/\bas a punch does\b/g, () => 'as ● Rec does'],
  [/The crate’s (\w+) clip/g, (_, n) => `The ${n} saved bit (not wired yet)`],
  [/\bmixing down\b/g, () => 'bouncing'],
  [/Mix down the whole tape/g, () => 'Bounce the whole tape'],
  [/Mix down the loop/g, () => 'Bounce the loop'],
  [/\bmix ?downs?\b/gi, (m) => keepCase(m, /s$/i.test(m) ? 'bounces' : 'bounce')],
  [/capture anything you want to keep first/g, () => 'keep anything you want from it first'],
  [/Buffer length/g, () => 'Feed length'],
  [/Inputs to keep/g, () => 'Inputs in TAKES'],
  [/Keep every input/g, () => 'Every input in TAKES'],
  [/Keep free/g, () => 'Leave free'],
  [/\bclipboard\b/gi, (m) => keepCase(m, 'buffer')],
  [/\bflags\b/gi, (m) => keepCase(m, 'notes')],
  [/\bflag\b/gi, (m) => keepCase(m, 'note')],
  [/\bclips\b/gi, (m) => keepCase(m, 'parts')],
  [/\bclip\b/gi, (m) => keepCase(m, 'part')],
  [/\bring\b/gi, (m) => keepCase(m, 'feed')],
];

/** rename gives the rooms' word for each old one in text, leaving “quoted” names alone. */
export function rename(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.split(/(“[^”]*”)/).map((part, i) => {
    if (i % 2) return part;
    let s = part;
    for (const [re, to] of RULES) s = s.replace(re, to);
    return s;
  }).join('');
}

/** say is rename with the rooms on, and the text unchanged without them. */
export function say(text) {
  return on() ? rename(text) : text;
}

// Tips whose control is the same but whose words are better said than renamed.
// By data-tip id.
const ROOMS_TIPS = {};

/** tipForRooms is a tip as the rooms say it, from its row of tips.js. */
export function tipForRooms(id, tip) {
  return ROOMS_TIPS[id] ?? rename(tip);
}

/** settingsGroup is a Settings group's heading: the Pi calls the feed's group Buffer, and the Studio's buffer is another thing. */
export function settingsGroup(name) {
  return on() && name === 'Buffer' ? 'Feed' : name;
}

const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-label'];

/**
 * applyWords says a page's own markup in the rooms' words: its text and its
 * labels, the templates the Studio clones from included. Run once, before the
 * page's modules fill it with what a person typed.
 */
export function applyWords(doc = globalThis.document) {
  if (!doc || typeof doc.createTreeWalker !== 'function' || !on()) return;
  const roots = [doc.body || doc];
  for (const t of doc.querySelectorAll('template')) roots.push(t.content);
  for (const root of roots) {
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const tag = n.parentNode?.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const to = rename(n.nodeValue);
      if (to !== n.nodeValue) n.nodeValue = to;
    }
    for (const el of root.querySelectorAll('*')) {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) { const to = rename(v); if (to !== v) el.setAttribute(a, to); }
      }
    }
  }
}

// Said once, here, when the first module that needs a word is loaded: before
// any page code has put a name a person typed into the page.
if (typeof document !== 'undefined' && document.body) applyWords(document);
