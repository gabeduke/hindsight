// web/static/lib/rooms/nocrate.test.js
// F3 of the flow spec (docs/superpowers/specs/2026-10-15-flow-design.md): the
// crate and the clipboard line leave the Studio, and a part has no Keep; the
// buffer is the only view of what GRAB holds. tape.html's real markup, built
// on a stand-in document and trimmed as the Studio trims it; the rooms off
// are the markup as it is. The tape page's wiring is read from the source,
// as two-verbs.test.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { CRATE_PARTS, trimTapePage, trimTakePage, emptyTapeHint } from './nocrate.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const tapeHtml = read('../../tape.html');

function page() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, tapeHtml).children);
  return doc;
}

// What the crate drawer and the clipboard line hold, and the crate's sheet:
// every one is gone with the rooms on.
const GONE = [
  ...CRATE_PARTS,
  'clip-play', 'clip-clear', 'clip-keep-board', 'clip-audio', 'drop', 'insert', 'merge',
  'crate-q', 'crate-from', 'crate-list', 'crate-empty', 'crate-audio',
  'crate-title', 'crate-what', 'crate-name', 'crate-share', 'crate-take', 'crate-delete', 'crate-done',
];

test('the markup has them, so the rooms off keep the crate drawer, the clipboard line and a part’s Keep', () => {
  const doc = page();
  for (const id of GONE) assert.ok(doc.getElementById(id), `#${id} is not in tape.html: the rooms off would lose it`);
  assert.match(tapeHtml, /Send to → Tape/, 'and the empty tape’s hint, as it was');
});

test('with the rooms on the Studio has no crate drawer, clipboard line, crate sheet or Keep on a part', () => {
  const doc = page();
  trimTapePage(doc);
  for (const id of GONE) assert.equal(doc.getElementById(id), null, `#${id} is still on the Studio’s page`);
  assert.equal(doc.querySelectorAll('.crate-body, .crate-row, .np-drawer-close').length, 0);
  // What the rooms keep: the range bar’s Paste and Insert, the buffer’s
  // home, the transport and Catch.
  for (const id of ['range-paste', 'range-insert', 'catch-pass', 'play', 'np-dock', 'multi-split', 'multi-more', 'clip-reverse']) {
    assert.ok(doc.getElementById(id), `#${id} went with the crate`);
  }
});

test('trimming twice is harmless', () => {
  const doc = page();
  trimTapePage(doc);
  assert.doesNotThrow(() => trimTapePage(doc));
});

test('the empty tape’s hint no longer points at Send to → Tape', () => {
  const doc = page();
  const p = doc.getElementById('tape-empty-from');
  assert.ok(p, 'the hint has an id to be found by');
  assert.match(p.textContent, /Send to → Tape/);
  trimTapePage(doc);
  assert.doesNotMatch(p.textContent, /Send to|Tape\b.*choose/);
  assert.match(p.textContent, /GRAB a bit of a take/);
  assert.match(p.textContent, /Or start from a tempo:$/);
  assert.equal(p.querySelector('a').getAttribute('href'), '/takes.html', 'a take is chosen in the Listening Room');
});

test('the hint is words only: nothing of the old controls', () => {
  assert.equal(emptyTapeHint(), 'Or GRAB a bit of a take: open one, select the part and press GRAB. Or start from a tempo:');
});

test('the tape page trims itself only behind the flag, before it looks anything up', () => {
  const src = read('../tape/page.js');
  assert.match(src, /import \{[^}]*trimTapePage[^}]*\} from '\.\.\/rooms\/nocrate\.js'/);
  assert.match(src, /if \(ROOMS\) trimTapePage\(document\);/);
  const call = src.indexOf('if (ROOMS) trimTapePage(document);');
  assert.ok(call < src.indexOf('const state = {'), 'the page is trimmed before anything reads it');
  assert.ok(call > src.indexOf('const ROOMS = roomsOn();'));
});

test('the tape page wires the crate only for the rooms off, and reads no crate for the rooms', () => {
  const src = read('../tape/page.js');
  assert.match(src, /if \(!ROOMS\) \{\s*\n\s*\/\/ The bar's Crate key/, 'the Crate key is wired behind the flag');
  assert.match(src, /if \(!ROOMS\) wireCrate\(\);/);
  assert.doesNotMatch(src, /hindsight:crate-changed/, 'nothing tells the page a grab went to the crate: it does not');
  assert.match(src, /drawer: ROOMS \? '' : /, 'a remembered open drawer is not opened in the Studio');
});

// --- the take page -------------------------------------------------------------

const waveHtml = read('../../wave.html');
function takePage() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, waveHtml).children);
  return doc;
}

test('the take page has Split here, Send to → Crate and the ◫ chip, so the rooms off keep them', () => {
  const doc = takePage();
  for (const id of ['split-here', 'keep-clip', 'crate-chip']) assert.ok(doc.getElementById(id), `#${id} is not in wave.html`);
});

test('with the rooms on the take page offers no Split here, no Send to → Crate and no ◫ chip', () => {
  const doc = takePage();
  trimTakePage(doc);
  for (const id of ['split-here', 'keep-clip', 'crate-chip']) assert.equal(doc.getElementById(id), null, `#${id} is still on the take page`);
  // What stays: Send to is the page's GRAB (the chair makes it over), Save as
  // take is KEEP, and More keeps the DAW bundle, the downloads and Delete.
  for (const id of ['send-btn', 'send-menu', 'save-take', 'more-menu', 'bundle', 'delete-take']) assert.ok(doc.getElementById(id), `#${id} went with the crate`);
});

test('the take page trims itself only for the rooms, and does not unhide what is gone', () => {
  const src = read('../wave/page.js');
  assert.match(src, /import \{[^}]*trimTakePage[^}]*\} from '\.\.\/rooms\/nocrate\.js'/);
  assert.match(src, /if \(roomOn\(\)\) trimTakePage\(document\);/);
  assert.doesNotMatch(src, /for \(const id of \['send-btn', 'split-here'\]\) \$\(id\)\.hidden = false;/, 'Split here is not unhidden blindly: it may not be there');
  assert.match(src, /\$\('split-here'\)\?\.addEventListener/);
  assert.match(src, /\$\('keep-clip'\)\?\.addEventListener/);
});

test('a range’s Cut and Copy say what they replaced, with Undo, and ask the Pi to leave the crate alone', () => {
  const src = read('../tape/page.js');
  assert.match(src, /body: \{ op, \.\.\.editBody\(op, \{ track: state\.track, \.\.\.extra \}, ROOMS\) \}/, 'every edit’s body goes through editBody, and still names its op');
  assert.match(src, /if \(ROOMS && e\.replaced\) offerUndo\(e\)/, 'a Cut or Copy over an unused buffer offers Undo');
  assert.match(src, /raiseUndo\(toast, replacedLine\(e\.replaced, e\.replaced\.frames \/ state\.tape\.sample_rate\)/);
  assert.match(src, /restoreReplaced\(e\.clipboard\.created\)/, 'the Undo names the buffer it undoes');
});

test('a page that is not the Studio lets a take’s GRAB note go', () => {
  for (const f of ['../room/open.js', '../room/doorway.js']) {
    assert.match(read(f), /forget\(\)|forget\(sessionStorage|forgetNote\(\)/, `${f} lets the note go`);
  }
});

test('the Takes page does not count the crate’s clips with the rooms on', () => {
  const src = read('../shelf-page.js');
  assert.match(src, /if \(!roomOn\(\)\) \{\s*\n\s*fetch\('\/api\/crate'/, 'the ◫ line has nothing to count');
});
