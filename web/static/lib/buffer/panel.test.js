// web/static/lib/buffer/panel.test.js
// What a cue clip's drawer holds, and in what order
// (docs/plan/the-calm-studio.md, decisions 6 and 7, step 6a): small, its
// window, DROP, Trim, Toss and ✕; Trim opens on how it plays (Audition,
// Repeat, Reverse, the fades), then IN and OUT, the gain, Normalize and its
// inputs, and last To the shelf. One word, one meaning: no KEEP and no Loop
// in it, and no snap of its own. Read from shell.html's template, in the
// order a person (and a phone's sheet, which has no small state) meets them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { cssOf, rules } from '../stylesheets.js';

const html = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const tpl = /<template id="buffer-panel-tpl">([\s\S]*?)<\/template>/.exec(html)[1];

function drawer() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, tpl).children);
  return doc.getElementById('buffer');
}
// The keys in a part of it, by id, in the order they are in it.
const keysIn = (el) => el.querySelectorAll('button, input').map((k) => k.id || k.className);

test('the small panel is the clip’s window, DROP, Trim, Toss and ✕, in that order', () => {
  const d = drawer();
  const body = d.querySelector('.buffer-body');
  assert.deepEqual(body.children.map((c) => c.className.split(' ').find((x) => x.startsWith('buffer-'))),
    ['buffer-grip', 'buffer-window', 'buffer-acts']);
  assert.deepEqual(keysIn(d.querySelector('.buffer-acts')), ['buffer-drop', 'buffer-trim', 'buffer-toss', 'buffer-close']);
});

test('Trim opens on how it plays, then IN and OUT, the gain, Normalize, its inputs, and last To the shelf', () => {
  const d = drawer();
  const parts = d.children.map((c) => c.className.split(' ').find((x) => x.startsWith('buffer-')));
  assert.deepEqual(parts, ['buffer-sheet-grip', 'buffer-head', 'buffer-body', 'buffer-play', 'buffer-foot']);
  assert.deepEqual(keysIn(d.querySelector('.buffer-play')), ['buffer-audition', 'buffer-repeat', 'buffer-reverse', 'buffer-fades']);
  const foot = d.querySelector('.buffer-foot');
  assert.deepEqual(foot.children.map((c) => c.id || c.className.split(' ').find((x) => x.startsWith('buffer-'))),
    ['buffer-edge', 'buffer-edge', 'buffer-gain', 'buffer-normalize', 'buffer-sources', 'buffer-keep']);
  assert.deepEqual(foot.children.slice(0, 2).map((e) => e.getAttribute('aria-label')), ['IN', 'OUT']);
});

test('one word, one meaning: the drawer says To the shelf and Repeat, never KEEP or Loop, and has no snap of its own', () => {
  const d = drawer();
  assert.equal(d.querySelector('#buffer-keep-word').textContent, 'To the shelf');
  assert.equal(d.querySelector('#buffer-repeat').textContent, 'Repeat');
  // Every word a person reads in it, and every key's name.
  const words = [d.textContent, ...d.querySelectorAll('[aria-label]').map((e) => e.getAttribute('aria-label'))].join(' · ');
  assert.doesNotMatch(words, /\bkeep\b/i, 'KEEP is the feed’s');
  assert.doesNotMatch(words, /\bloop\b/i, 'Loop is the bar’s, the tape’s loop');
  // ⌗ beside the ruler is the Studio's one snap; IN and OUT step by it.
  assert.equal(d.querySelector('#buffer-snap'), null);
  assert.equal(d.querySelector('#buffer-unfold'), null, 'shutting Trim gives the lanes their height back');
  assert.doesNotMatch(tpl, /data-tip="tape-snap"/);
});

test('on a tablet the small panel hides everything Trim opens, and nothing else', () => {
  const tablet = rules(cssOf('shell.html')).filter((r) => /min-width: 700px\) and \(min-height: 441px/.test(r.media || ''));
  const hidden = tablet.filter((r) => r.sel.some((s) => s.startsWith('.buffer-panel[data-trim="shut"]')) && /display:\s*none/.test(r.body));
  const what = hidden.flatMap((r) => r.sel).join(' ');
  for (const part of ['.buffer-head', '.buffer-play', '.buffer-foot']) assert.match(what, new RegExp(part.replace('.', '\\.')), `${part} waits for Trim`);
  for (const key of ['.buffer-drop', '.buffer-trim', '.buffer-toss', '.buffer-close', '.buffer-window']) {
    assert.doesNotMatch(what, new RegExp(`${key.replace('.', '\\.')}\\b`), `${key} is in the small panel`);
  }
});
