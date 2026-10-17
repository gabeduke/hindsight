// web/static/lib/room/tapes.test.js
// Tapes live in the Studio only (docs/superpowers/specs/2026-10-15-flow-
// design.md, "Answered by Gabe" 2): they are off the Listening Room's shelf,
// so the Studio is the one place to open one, and its title menu must stay
// there. tape.html's real markup. (The menu's listing and loading are the
// tape page's own, seen in the browser run.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const html = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');

test('the Studio has its tape menu: the title, and the list of every tape', () => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, html).children);
  const name = doc.getElementById('tape-name');
  assert.ok(name, 'the title is a button');
  assert.equal(name.getAttribute('aria-haspopup'), 'menu');
  assert.equal(name.dataset.tip, 'tape-menu');
  const menu = doc.getElementById('tape-menu');
  assert.ok(menu.contains(doc.getElementById('tape-list')), 'the list of tapes is in it');
  assert.ok(name.closest('.menu-anchor').contains(menu), 'and it opens from the title');
  assert.equal(name.hidden, false);
});
