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

// A whole word, and not a piece of a hyphenated one ("Ring-a-ling"). No
// lookbehind: an older iPhone would refuse the whole module for it.
const word = (src, fn) => [new RegExp(`(^|[^\\w-])(${src})(?![\\w-])`, 'gi'), (_, pre, w) => pre + fn(w)];

// Ordered: the specific phrases first, then the bare words.
const RULES = [
  [/Flag now/g, () => 'Note'],
  [/⚑/g, () => '✎'], // a note's mark is the pencil
  [/Punch-in FX/gi, () => 'FX'],
  [/Keep as clip/g, () => 'GRAB'], // the selection's other verb; the crate it filled is gone
  [/Save as take/g, () => 'KEEP'],
  [/Send to → Tape/g, () => 'GRAB'],
  [/for a part a little early or late/g, () => 'for playing a little early or late'],
  [/Hold an empty part/g, () => 'Hold an empty spot'], // not the part a clip becomes
  [/A punch shows in red as it records/g, () => 'The Rec shows in red as it records'],
  word('a punch is recording', () => '● Rec is recording'),
  word('as a punch does', () => 'as ● Rec does'),
  [/The crate’s (\w+) clip/g, (_, n) => `The ${n} saved bit (not wired yet)`],
  word('mixing down', () => 'bouncing'),
  [/Mix down the whole tape/g, () => 'Bounce the whole tape'],
  [/Mix down the loop/g, () => 'Bounce the loop'],
  word('mix ?downs?', (m) => keepCase(m, /s$/i.test(m) ? 'bounces' : 'bounce')),
  [/capture anything you want to keep first/g, () => 'keep anything you want from it first'],
  [/Buffer length/g, () => 'Feed length'],
  [/Inputs to keep/g, () => 'Inputs in TAKES'],
  [/Keep every input/g, () => 'Every input in TAKES'],
  [/Keep free/g, () => 'Leave free'],
  word('clipboard', (m) => keepCase(m, 'buffer')),
  word('flags', (m) => keepCase(m, 'notes')),
  word('flag', (m) => keepCase(m, 'note')),
  word('clips', (m) => keepCase(m, 'parts')),
  word('clip', (m) => keepCase(m, 'part')),
  word('ring', (m) => keepCase(m, 'feed')),
];

// What a person typed is theirs: a name in quotes of any kind is left alone.
const QUOTED = /(“[^”]*”|"[^"]*")/;

function renameFree(text) {
  return text.split(QUOTED).map((part, i) => {
    if (i % 2) return part;
    let s = part;
    for (const [re, to] of RULES) s = s.replace(re, to);
    return s;
  }).join('');
}

/** rename gives the rooms' word for each old one in text, leaving “quoted” names alone. */
export function rename(text) {
  if (typeof text !== 'string' || !text) return text;
  return renameFree(text);
}

/**
 * renameToast is rename for a toast, which may carry what the Pi said or what
 * someone named a thing without quoting it. After "Could not …: " it is the
 * Pi's, so it is left as it came; a failure with no colon is the Pi's whole.
 */
export function renameToast(msg, kind = 'ok') {
  if (typeof msg !== 'string' || !msg) return msg;
  const m = /^(Could not|Couldn’t|Couldn't)[^:]*: /.exec(msg);
  if (m) return renameFree(m[0]) + msg.slice(m[0].length);
  if (kind === 'bad') return msg;
  return renameFree(msg);
}

/** sayToast is renameToast with the rooms on, and the message unchanged without them. */
export function sayToast(msg, kind) {
  return on() ? renameToast(msg, kind) : msg;
}

/** quoted puts a name a person typed in quotes, with the rooms on, so no word in it is renamed. */
export function quoted(name) {
  return on() ? `“${name}”` : name;
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
