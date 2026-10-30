// web/static/lib/rooms/two-verbs.test.js
// F1 of the flow spec (docs/architecture/rooms.md, Vocabulary): a
// selection of the feed offers GRAB and KEEP and nothing else; every KEEP
// names what it keeps; a take's TO THE STUDIO and Send to become GRAB. The
// markup and the wiring, read from the source -- the pure parts are in
// keeplabel.test.js and grab.test.js; the pad's and the buffer's behaviour is
// run, on a stand-in document, in play/keeps.test.js and buffer/keeps.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const tape = strip(read('../../shell.html'));
const capture = /<main id="view-capture"[\s\S]*?<\/main>/.exec(tape)[0];
const selBar = (html, id = 'rb-sel') => new RegExp(`<div class="rb-sel" id="${id}"[\\s\\S]*?<\\/div>`).exec(html)[0];

test('the Studio’s selection offers KEEP, and GRAB beside it: no Copy, no Keep as clip, no Save as take', () => {
  const bar = selBar(tape);
  assert.doesNotMatch(bar, /rb-sel-copy|>Copy</, 'Copy was the same request as GRAB');
  assert.doesNotMatch(bar, /rb-sel-keep|Keep as clip/, 'the crate is not offered on a selection');
  assert.doesNotMatch(bar, /Save as take|KEEP AS TAKE/i, 'a selection’s verb is KEEP');
  assert.match(bar, /class="icon-btn primary rb-sel-save"[^>]*>Keep</, 'the one primary key is KEEP');
  assert.match(tape, /<template id="buffer-sel-tpl">\s*<button[^>]*buffer-grab-sel[^>]*>GRAB</, 'and GRAB, which the buffer puts in');
});

test('GRAB goes into the selection bar by the KEEP key, not by Copy’s place', () => {
  const buffer = read('../buffer/buffer.js');
  assert.doesNotMatch(buffer, /rb-sel-copy/, 'Copy is gone: nothing may be placed by it');
  assert.match(buffer, /\.rb-sel-save'\)\?\.before\(/, 'GRAB sits before KEEP');
});

test('`/` with the tape off offers Save as take on a selection, and nothing for the crate or the clipboard', () => {
  const bar = selBar(capture, 'capture-rb-sel');
  assert.doesNotMatch(bar, /rb-sel-copy|>Copy</, 'Copy filled the clipboard for a tape there is none of');
  assert.doesNotMatch(bar, /rb-sel-keep|Keep as clip/, 'the crate is not offered on a selection');
  assert.match(bar, /rb-sel-save[^>]*>Save as take</);
  assert.match(capture, /id="cap-word"/);
});

test('the feed’s KEEP key carries its length, the buffer’s its own', () => {
  assert.match(tape, /id="studio-keep-word">Keep<\/span><span class="studio-keep-len" id="studio-keep-len"><\/span>/);
  const keep = /<button[^>]*id="buffer-keep"[\s\S]*?<\/button>/.exec(tape)[0];
  assert.doesNotMatch(keep, /Keep as take/, 'the buffer’s KEEP is not "as take"');
  assert.match(keep, /id="buffer-keep-word">Keep</);
  assert.match(keep, /id="buffer-keep-len"/);
});

test('the ribbon names the selection’s KEEP when it is told to, and only then', () => {
  const ribbon = read('../objects/ribbon.js');
  assert.match(ribbon, /keepWords/, 'the Studio hands it a way to word KEEP');
  const studio = read('./studio.js');
  assert.match(studio, /keepWords:/);
  assert.match(studio, /setAttribute\('aria-label', keepAria\(len\)\)/, 'the feed key’s name comes from keepAria, which contains the label');
  assert.doesNotMatch(read('../../app.js'), /keepWords/, 'Capture does not');
});

test('a take’s GRAB: Open, the notes, and no Send to (the sheet that carried one is gone, F5a)', () => {
  const doorway = read('../room/doorway.js');
  const chair = read('../room/open.js');
  assert.match(chair, /rooms\/grab\.js/, 'Open gets its span and its N from lib/rooms/grab.js');
  assert.doesNotMatch(chair, /'(TO THE STUDIO|To the Studio)'[^\n]*take|toStudio = el\([^\n]*'TO THE STUDIO'/, 'Open: a take’s TO THE STUDIO is GRAB');
  // The shelf has no GRAB key of its own: a tap plays, and GRAB is on Open.
  assert.doesNotMatch(doorway, /'room-studio'|sendToStudio|takeGrabSpan/, 'the doorway no longer carries a take’s GRAB');
  assert.doesNotMatch(chair, /'to the studio'/, 'a note’s key says GRAB');
  assert.doesNotMatch(read('../../wave.html'), /send-btn|send-menu/, 'the take page has no Send to ▾: GRAB is its Tape and its Clipboard');
  assert.doesNotMatch(chair, /send-grab/, 'and has no GRAB of its own');
});
