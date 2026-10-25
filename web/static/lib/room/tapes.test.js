// web/static/lib/room/tapes.test.js
// Tapes live in the Studio only (docs/superpowers/specs/2026-10-15-flow-
// design.md, "Answered by Gabe" 2): they are off the Listening Room's shelf,
// so the Studio is the one place to open one, and its name's menu must stay
// there. The tape's name is its menu (docs/plan/the-studio-space.md, "The
// name is the menu; ⋯ goes"): the tapes, then what acts on this one, Delete
// last. shell.html's real markup. (The menu's listing and loading are the
// tape page's own, seen in the browser run: J3.2, J3.3.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const html = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const studio = () => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, html).children);
  return doc;
};

test('the Studio has its tape menu, on the tape’s name, opening from it', () => {
  const doc = studio();
  const name = doc.getElementById('tape-name');
  assert.ok(name, 'the title is a button');
  assert.equal(name.getAttribute('aria-haspopup'), 'menu');
  assert.equal(name.dataset.tip, 'tape-menu');
  const menu = doc.getElementById('tape-menu');
  assert.ok(name.closest('.menu-anchor').contains(menu), 'and it opens from the title');
  assert.equal(name.hidden, false);
});

test('the name’s menu: the tapes and New tape; Rename…, Duplicate; the mix and the bounces; Record from this phone…; Delete this tape… last, red, after a line', () => {
  const menu = studio().getElementById('tape-menu');
  // Its groups, as a reader of the screen sees them: a line between each.
  const groups = [[]];
  for (const el of menu.children) {
    if (el.classList.contains('menu-divider')) groups.push([]);
    else if (el.classList.contains('menu-group')) groups.at(-1).push(`[${el.textContent}]`);
    else groups.at(-1).push(el.querySelector('.menu-word').textContent);
  }
  assert.deepEqual(groups, [
    ['[The tapes]', 'New tape'],
    ['Rename…', 'Duplicate'],
    ['Share the mix', 'Bounce the loop', 'Bounce the whole tape', 'Export stems', 'Play the last bounce'],
    ['Record from this phone…'],
    ['Delete this tape…'],
  ]);
  const del = menu.children.at(-1);
  assert.equal(del.id, 'tape-delete');
  assert.ok(del.classList.contains('danger'), 'red');
  assert.ok(menu.querySelectorAll('[role="menuitem"]').every((b) => b.classList.contains('menu-item')), 'every row a menuItem’s, a finger tall');
});

test('⋯ goes: nothing beside the name holds what acts on the tape', () => {
  const doc = studio();
  assert.equal(doc.getElementById('tape-more'), null);
  assert.equal(doc.getElementById('tape-actions'), null);
  const tools = doc.getElementById('header-studio-end');
  assert.deepEqual(tools.children.map((c) => c.id), ['tape-undo', 'tape-redo'], 'the Studio’s tools are ↶ ↷, then ☰ (lib/nav.js)');
});

test('⌗ is the View menu: the snap, the loop’s lock, Fit, the fold and Ask before, and the only key beside the ruler but Fit', () => {
  const doc = studio();
  const keys = doc.querySelector('.ruler-keys');
  assert.deepEqual(keys.children.map((c) => c.id || c.className), ['menu-anchor ruler-more-anchor', 'view-fit']);
  const menu = doc.getElementById('ruler-menu');
  assert.equal(menu.getAttribute('aria-label'), 'View');
  assert.deepEqual(menu.querySelectorAll('[data-snap]').map((b) => b.dataset.snap), ['bar', 'beat', '8th', 'off']);
  assert.deepEqual(menu.querySelectorAll('.menu-item').map((b) => [b.id, b.getAttribute('role')]), [
    ['rm-lock', 'menuitemcheckbox'],
    ['rm-fit', 'menuitem'],
    ['tracks-fold-btn', 'menuitemcheckbox'],
    ['ask-first', 'menuitemcheckbox'],
  ]);
  for (const gone of ['snap-btn', 'loop-lock']) assert.equal(doc.getElementById(gone), null, gone);
});
