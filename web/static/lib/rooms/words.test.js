// web/static/lib/rooms/words.test.js
// F8 of the flow spec (docs/architecture/rooms.md,
// Vocabulary): with the rooms on, no retired word on a rooms page --
// in its markup, its tips, or the strings its modules build.
//
// Three readings, none of which can see a page (AGENTS.md: look at it too):
//   1. each rooms page's static markup (text, aria-label, title, placeholder),
//      as words.js's applyWords leaves it;
//   2. every tip, as tipFor answers with the rooms on;
//   3. the string literals of the modules that run on a rooms page.
// A retired word that is meant (a code identifier, the rooms-off branch of a
// string chosen from the flag, a different sense of the word) is in ALLOW,
// with the reason beside it. An entry that no longer matches anything fails,
// so the list can only shrink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { rename as say, renameToast, tipForRooms } from './words.js';
import { TIPS } from '../help/tips.js';

// The spec's list, and the renames that go with it (clip -> part, ring -> feed,
// Buffer length -> Feed length, Keep free -> Leave free, Punch-in FX -> FX,
// flag -> note, mixdown/Mix down -> BOUNCE).
export const RETIRED = [
  /keep as (a )?clips?/i, /save as take/i, /cut a record/i, /mix(ing)? ?downs?/i, /records shelf/i,
  /\bcrates?\b/i, /clipboard/i, /stickers?/i, /PUT IT ON/, /SIT DOWN|Sit down with it/, /stand up/i,
  /TO THE STUDIO/, /send to\b/i, /punch/i, /\bflags?\b/i, /\bclips?\b/i, /\bring\b/i,
  /buffer length/i, /keep free/i,
];
const hits = (s) => RETIRED.filter((r) => r.test(s)).map(String);

const root = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const walk = (d) => readdirSync(new URL(d, root), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(`${d}${e.name}/`)
    : e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [`${d}${e.name}`] : []);

// ---- allow-list -----------------------------------------------------------
// [file, text the line holds, why]. Matched on the literal (or markup text).
const NO_CRATE = 'its control is taken out of sight by room/open.js (Send to ▾), so this is never shown';
const ALLOW = [
  // -- markup
  ['wave.html', 'Send to', 'Send to ▾ is taken out of sight by room/open.js: GRAB is its Tape and its Clipboard'],
  // -- strings: code, not text
  ['lib/room/open.js', 'tb-flag', 'a CSS class'],
  ['lib/room/tap.js', '.take-flag', 'a CSS selector'],
  ['lib/wave/page.js', 'detail-flag flags-item', 'CSS classes'],
  ['lib/flags.js', 'unknown flag op', 'a programmer error, never shown'],
  ['lib/objects/lcd.js', 'ring out', 'letting a tail ring out: the word’s other sense'],
  ['lib/wave/page.js', 'Could not send to tape', 'its Send to ▾ → Tape is taken out of sight by Open'],
  ['lib/wave/send.js', 'one clip, no loop', 'the hint under Send to ▾, which Open takes out of sight'],
];
const used = new Set();
// Strings that reach the screen only through a sink that says them (a toast's
// message, the Undo phrases): [file, text, why].
const SAID = [
  ['lib/toast.js', 'flag', 'the Undo phrases: they reach the screen only inside a toast, and toast() says its message'],
  ['lib/play/controls.js', 'The crate’s', 'a pad’s name in the bus’s list, which no page draws since the instrument strip went'],
];
const saidElsewhere = (file, s) => SAID.some(([f, t]) => f === file && s.includes(t));
const allowed = (file, s) => {
  const i = ALLOW.findIndex(([f, t]) => f === file && s.includes(t));
  if (i >= 0) used.add(i);
  return i >= 0;
};

// ---- 1. static markup -----------------------------------------------------
const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'path', 'circle', 'rect', 'line', 'use', 'stop']);
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-label'];

/** markupText is every [element id trail, text] a person could read in a page's HTML. */
export function markupText(html, skipIds = new Set()) {
  const out = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && (top.tag === 'script' || top.tag === 'style')) continue;
      const text = m[4].replace(/\s+/g, ' ').trim();
      if (text && !stack.some((s) => skipIds.has(s.id))) out.push([stack.map((s) => s.id).filter(Boolean).join(' > '), text]);
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length && stack.pop().tag !== tag); continue; }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const el = { tag, id: attrs.id || '' };
    if (!stack.some((s) => skipIds.has(s.id)) && !skipIds.has(el.id)) {
      for (const a of ATTRS) if (attrs[a]) out.push([`${stack.map((s) => s.id).filter(Boolean).join(' > ')} > ${el.id || tag}@${a}`, attrs[a]]);
      if (attrs['data-tip']) out.push([el.id || tag, attrs['data-tip'], 'tip']);
    }
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(el);
  }
  return out;
}

// Nothing is taken out of a page whole any more: every page is read as served.
const REMOVED = new Set();
const PAGES = ['shell.html', 'wave.html', 'rig.html', 'guide.html'];

test('no retired word in a rooms page’s markup, as the rooms’ pass leaves it', () => {
  const bad = [];
  for (const page of PAGES) {
    for (const [where, text, kind] of markupText(read(page).replace(/<head>[\s\S]*?<\/head>/, ''), REMOVED)) {
      if (kind === 'tip') continue;
      const s = say(text);
      if (hits(s).length && !allowed(page, s)) bad.push(`${page} ${where}: ${s.slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// guide.html is read above like any page: its header is said, because nav.js
// loads the words layer. Its body is docs/guide.md, fetched and drawn after
// that, so it is not renamed at run time: its rooms-on text is read here.
test('guide.html draws docs/guide.md, which is read below instead of renamed', () => {
  assert.match(read('guide.html'), /fetch\('\/guide\.md'\)/);
  assert.match(read('guide.html'), /nav\.js/, 'its header is said, because nav.js loads the words layer');
  // Statically: a words layer that loaded later, after the guide was drawn,
  // would rename the guide's text as well.
  assert.match(read('lib/nav.js'), /^import '\.\/rooms\/words\.js';$/m, 'nav.js loads the words layer as it loads');
});

// ---- 2. tips --------------------------------------------------------------
test('no retired word in a tip, as tipFor answers with the rooms on', () => {
  const bad = [];
  for (const t of TIPS) {
    const s = tipForRooms(t.ids[0], t.tip);
    if (hits(s).length && !allowed('tips', `${t.ids[0]}|`)) bad.push(`${t.ids[0]}: ${s.slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
});

// ---- 3. strings built in JS -----------------------------------------------
/** literals is every [line, text] of a quoted string in JS source, comments skipped. */
export function literals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = line;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') { line++; if (c !== '`') break; }
        s += src[j++];
      }
      out.push([start, s]);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

// Modules that run on a rooms page: the rooms' own, and the shared ones whose
// text the rooms reach. What is left out is left out for a reason.
const NOT_ROOMS_PAGES = new Map([
  ['lib/takes.js', 'the Takes page with the rooms off; with them on the Listening Room mounts over it and it never opens'],
  ['lib/shelf.js', 'the same: the Takes page’s shelf'],
  ['lib/shelf-detail.js', 'the same: the Takes page’s sheet, which the rooms replace with Open'],
  ['lib/shell/views/room.js', 'the same: the Takes page’s rack view, which the Listening Room mounts over'],
  ['lib/objects/bench.js', 'objects.html, the material bench: a developer page, not a room'],
  ['lib/help/tips.js', 'read whole by the tips test above'],
  ['lib/rooms/words.js', 'the table of old words itself'],
]);
const MODULES = [
  ...walk('lib/'), 'app.js',
].filter((f) => !NOT_ROOMS_PAGES.has(f));

// The text of a literal: its ${...} holes are code, and HTML is read for what it shows.
const stripHoles = (s) => {
  let out = '';
  for (let i = 0, depth = 0; i < s.length; i++) {
    if (depth === 0 && s[i] === '$' && s[i + 1] === '{') { depth = 1; i++; out += '#'; continue; }
    if (depth > 0) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; continue; }
    out += s[i];
  }
  return out;
};
const shown = (s) => (/^\s*</.test(s) ? markupText(s).map(([, t]) => t) : [s]);

// A literal reaches the screen in the rooms' words when it is wrapped in say()
// where it is made, or handed to toast(), which says its message.
const SAYS = /\bsay\(|\b\w*[tT]oast\(|onToast\??\.?\(/;

// ---- names a person typed must not go through the words layer unmarked ------
/** holes is the ${...} expressions of a template literal's text. */
export function holes(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < raw.length && depth; j++) { if (raw[j] === '{') depth++; else if (raw[j] === '}') depth--; }
      out.push(raw.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out;
}
const NAMEY = /\b(label|name|names|title|tag|section|sc|text|spineTitle|takeTitle|getTape)\b/;
// [file, expression it holds, why it is not a name a person typed]
const NOT_NAMES = [
  ['lib/tape/page.js', 'next.label.slice(1)', 'the label of an action button the page itself drew (Insert 1 bar), not typed by anyone'],
  ['lib/tape/page.js', 'sectionBars(e.section', 'a count of bars, not the section’s name'],
  ['lib/tape/page.js', 't.name', 'a button’s text set directly: the name is not passed through say(), only its clip count is'],
  ['lib/update.js', 'u.tag', 'a release tag the Pi names, not typed by anyone'],
];
test('a name a person typed goes into a toast or say() wrapped by named(), or is listed with its reason', () => {
  const bad = [];
  for (const f of MODULES) {
    const src = read(f);
    const lines = src.split('\n');
    for (const [line, raw] of literals(src)) {
      if (!SAYS.test(lines[line - 1])) continue;
      for (const h of holes(raw)) {
        if (!NAMEY.test(h) || h.includes('named(')) continue;
        if (NOT_NAMES.some(([nf, nh]) => nf === f && h.includes(nh))) continue;
        bad.push(`${f}:${line}: \${${h}} is not wrapped in named()`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('no retired word in a string a rooms page’s modules build, or it is said in the rooms’ words', () => {
  const bad = [];
  for (const f of MODULES) {
    const src = read(f);
    const lines = src.split('\n');
    for (const [line, raw] of literals(src)) {
      for (const text of shown(stripHoles(raw))) {
        if (!hits(text).length || !/\s|^[A-Z]/.test(text)) continue; // a bare identifier or class is not text
        if (allowed(f, text)) continue;
        if (SAYS.test(lines[line - 1]) || saidElsewhere(f, text)) {
          const left = hits(say(text));
          if (left.length) bad.push(`${f}:${line}: still says ${left} after say(): ${text.slice(0, 90)}`);
          continue;
        }
        bad.push(`${f}:${line}: ${text.replace(/\n/g, '\\n').slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});


// The crate's tips are allowed because their controls are not on a rooms page.
// Say so from the markup: none of them is on a rooms page outside what the
// rooms take out whole; the few that are there are hidden by code that is read.
test('a tip allowed as gone with the crate belongs to a control that really went', () => {
  const onPage = new Set();
  for (const page of ['shell.html', 'wave.html', 'rig.html']) {
    for (const [, id, kind] of markupText(read(page).replace(/<head>[\s\S]*?<\/head>/, ''), REMOVED)) if (kind === 'tip') onPage.add(id);
  }
  const allowedTips = ALLOW.filter(([f, , why]) => f === 'tips' && why === NO_CRATE).map(([, t]) => t.replace('|', ''));
  const open = read('lib/room/open.js');
  const found = [];
  for (const id of allowedTips) {
    if (!onPage.has(id)) continue;
    // on the page, so something must hide it: Open hides Send to ▾ and its menu
    if ((id === 'send-to' || id === 'send-clipboard') && /send-btn[\s\S]*display = 'none'/.test(open)) continue;
    found.push(id);
  }
  assert.deepEqual(found, [], 'on a rooms page and nothing in the rooms hides it');
  // and the controls the crate took with it are in no page and no module
  assert.doesNotMatch(read('lib/shelf-detail.js'), /data-tip="detail-crate"/, 'the take sheet’s ◫ line went with the crate');
  assert.doesNotMatch(read('shell.html'), /data-tip="ribbon-keep"/, 'no Keep as clip on a selection');
});

test('every allow-list entry still matches something', () => {
  const stale = ALLOW.filter((_, i) => !used.has(i)).map((a) => a.slice(0, 2).join(' '));
  assert.deepEqual(stale, []);
});

// ---- 4. the guide ---------------------------------------------------------
// docs/guide.md describes one app, the two rooms. Parts of it still say the
// older words (ring, clip, flag...), and its intro says so; but the sections
// that were written in the rooms' words from their first line must stay in
// them. That text must not hold a retired word, except in a line that says
// what a thing *was called* (GUIDE_ALLOW, one narrow entry and its reason
// each), or the words table's last column.
//
// The guide's tips table is not read here: help.test.js holds it to tips.js
// row for row, and test 2 reads tips.js as the rooms say it.
// Capture is retired as a page and as a verb (the spec's words table: Capture -> KEEP, the Studio).
// (Split here and "save as a take" are read here only: wave.html and lib/wave/page.js still carry them, which F8's scan of modules would flag.)
const GUIDE_RETIRED = [...RETIRED, /\bchair\b/i, /\bTOOLS\b/, /⚑/, /\bCapture\b/, /split here/i, /save as (a )?take/i];
const guideHits = (s) => GUIDE_RETIRED.filter((r) => r.test(s)).map(String);

// Sections in the rooms' words from the first line (matched on the heading).
const ROOMS_SECTIONS = [/^### 4\.1 /, /^### 8\.12 /, /^### 8\.14 /, /^### 8\.15 /];

// The words section: its table's last column, *It was called*, is not read.
const WORDS_SECTION = /^### 8\.14 /;

/** guideUnits cuts the guide into paragraphs, list items and table rows, each with the heading it is under and its list depth. */
export function guideUnits(src) {
  const units = [];
  let head = '';
  let cur = null;
  let inTips = false;
  const flush = () => { if (cur) units.push(cur); cur = null; };
  src.split('\n').forEach((raw, i) => {
    if (/^\| Control \| Tip \|/.test(raw)) inTips = true;
    if (/^\s*$/.test(raw)) { flush(); inTips = false; return; }
    if (inTips) return;
    if (/^#{1,6}\s/.test(raw)) { flush(); head = raw; units.push({ n: i + 1, head, indent: -1, text: raw, heading: true }); return; }
    if (/^\s*\|/.test(raw)) { flush(); units.push({ n: i + 1, head, indent: 0, text: raw }); return; }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(raw);
    if (li) { flush(); cur = { n: i + 1, head, indent: li[1].length, text: li[3], item: true }; return; }
    if (cur) { cur.text += ` ${raw.trim()}`; return; }
    cur = { n: i + 1, head, indent: 0, text: raw.trim() };
  });
  flush();
  return units;
}

/** roomsText is [line, text] for every unit of the sections that are in the rooms' words. */
export function roomsText(src) {
  const out = [];
  for (const u of guideUnits(src)) {
    if (u.heading) {
      if (ROOMS_SECTIONS.some((r) => r.test(u.text))) out.push([u.n, u.text]); // a rooms section's own heading
      continue;
    }
    if (!ROOMS_SECTIONS.some((r) => r.test(u.head))) continue;
    // The words table's last column says what a word was called: the one place an old word belongs.
    out.push([u.n, WORDS_SECTION.test(u.head) && /^\s*\|/.test(u.text) ? u.text.replace(/\|[^|]*\|\s*$/, '|') : u.text]);
  }
  return out;
}

// [text the line holds, why]
const GUIDE_ALLOW = [];
const guideUsed = new Set();
const guideAllowed = (s) => {
  const i = GUIDE_ALLOW.findIndex(([t]) => s.includes(t));
  if (i >= 0) guideUsed.add(i);
  return i >= 0;
};

test('the guide’s rooms sections are read whole, and nothing outside them', () => {
  const sample = [
    '## 1. A', '',
    'Old text with the crate.', '',
    '- the crate, as ever', '',
    '### 8.14 Words', '', 'A flag is a note.', '', '| **Note** | A moment | flag |',
  ].join('\n');
  const got = roomsText(sample).map(([, t]) => t);
  assert.deepEqual(got, ['### 8.14 Words', 'A flag is a note.', '| **Note** | A moment |']);
  assert.ok(guideHits(got[1]).length && !guideHits(got[2]).length, 'a retired word in what it reads is seen; the last column is not read');
  // the real guide gives it plenty to read
  assert.ok(roomsText(read('../../docs/guide.md')).length > 40, 'the parser lost the sections');
});

test('no retired word in the guide’s rooms sections, or it is a line that says what a thing was called', () => {
  const bad = [];
  for (const [n, text] of roomsText(read('../../docs/guide.md'))) {
    if (!guideHits(text).length || guideAllowed(text)) continue;
    bad.push(`docs/guide.md:${n}: ${guideHits(text)} in: ${text.slice(0, 140)}`);
  }
  assert.deepEqual(bad, []);
});

// The two rooms are the only layout: no passage is for the rooms on or off,
// and nothing sends a reader to a Two rooms switch that is gone.
test('the guide describes one app', () => {
  const guide = read('../../docs/guide.md');
  assert.doesNotMatch(guide, /with (?:the |both )?(?:two )?rooms (?:on|off)|with them (?:on|off)\b|two rooms only|rooms are off/i);
  assert.doesNotMatch(guide, /Preview features › Two rooms|Turn \*\*Two rooms\*\* on/);
  assert.doesNotMatch(guide, /Crate ▴|Send to ▾ → Crate|foot of Capture|◫ \d/, 'what the old layout had is not offered');
});

test('the guide’s retired words are matched as they are really written', () => {
  for (const t of ['Keep as a clip', 'Keep as clip', 'Mixing down', 'Mixed down? mixdown', 'Save as a take', 'Split here', 'Capture', 'the chair', '⚑', 'Cut a record']) {
    assert.ok(guideHits(t).length, t);
  }
  assert.equal(guideHits('KEEP, GRAB and DROP').length, 0);
});

test('the guide’s words table has three columns, the last of them the one that is not read', () => {
  const rows = guideUnits(read('../../docs/guide.md')).filter((u) => WORDS_SECTION.test(u.head) && /^\s*\|/.test(u.text));
  assert.ok(rows.length > 15, 'the words table is there');
  assert.match(rows[0].text, /\| Word \| Means \| It was called \|\s*$/);
  for (const r of rows) assert.equal(r.text.trim().replace(/^\||\|$/g, '').split('|').length, 3, r.text);
  // and its last column is what the reader drops: a retired word there is not a miss
  const dropped = roomsText(read('../../docs/guide.md')).filter(([n]) => rows.some((r) => r.n === n));
  assert.ok(dropped.every(([, t]) => !guideHits(t).length), 'the words table’s first two columns carry no retired word');
  assert.ok(rows.some((r) => guideHits(r.text).length), 'and its last column does name them');
});

test('every guide allow-list entry still matches something', () => {
  assert.deepEqual(GUIDE_ALLOW.filter((_, i) => !guideUsed.has(i)).map((a) => a[0]), []);
});

test('“Capture anything you want to keep first” is renamed at the start of a sentence too', () => {
  assert.equal(say('what it’s holding now is gone. Capture anything you want to keep first.'), 'what it’s holding now is gone. Keep anything you want from it first.');
  assert.equal(say('so capture anything you want to keep first.'), 'so keep anything you want from it first.');
});
