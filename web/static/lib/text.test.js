import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setText } from './text.js';

// An element with what setText touches: its children, and textContent,
// which replaces them all (a child taken out and one put in).
function el(text) {
  const e = { childNodes: [], replaced: 0 };
  const node = (data) => ({ nodeType: 3, data, nextSibling: null });
  Object.defineProperty(e, 'firstChild', { get: () => e.childNodes[0] || null });
  Object.defineProperty(e, 'textContent', {
    get: () => e.childNodes.map((n) => n.data).join(''),
    set: (v) => { e.replaced++; e.childNodes = v ? [node(v)] : []; },
  });
  if (text != null) e.childNodes = [node(text)];
  return e;
}

test('changing text is written into its node, not a node put in its place', () => {
  const e = el('3.4');
  const n = e.firstChild;
  setText(e, '3.5');
  assert.equal(e.textContent, '3.5');
  assert.equal(e.firstChild, n, 'the same node');
  assert.equal(e.replaced, 0);
  setText(e, 3.5);
  assert.equal(e.replaced, 0, 'the same text is left alone');
});

test('becoming empty or filling an empty one goes through textContent, for :empty', () => {
  const e = el(null);
  setText(e, '1.1');
  assert.equal(e.textContent, '1.1');
  assert.equal(e.replaced, 1);
  setText(e, '');
  assert.equal(e.childNodes.length, 0, 'no empty text node left behind');
  assert.equal(e.replaced, 2);
  setText(e, '');
  assert.equal(e.replaced, 2);
});

test('an element holding more than one node is written whole, as before', () => {
  const e = el('a');
  e.childNodes.push({ nodeType: 1, data: 'b', nextSibling: null });
  e.childNodes[0].nextSibling = e.childNodes[1];
  setText(e, 'c');
  assert.equal(e.textContent, 'c');
  assert.equal(e.replaced, 1);
});

test('no :has() tests :empty, or every text that changes restyles the page', () => {
  // Writing into the node (setText) spares the :has() rules above it only
  // while none of them looks at :empty: one that does, anywhere, makes
  // Chromium look again at every :has() above any text that changes --
  // styles.css's body:has() rules -- and the bar's counter, ten times a
  // second, restyled most of the page.
  for (const f of ['../styles.css', '../objects.css']) {
    const css = fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (let i = css.indexOf(':has('); i >= 0; i = css.indexOf(':has(', i + 1)) {
      let depth = 0, j = i + 4;
      for (; j < css.length; j++) { if (css[j] === '(') depth++; else if (css[j] === ')' && --depth === 0) break; }
      assert.doesNotMatch(css.slice(i, j + 1), /:empty/, `${f}: ${css.slice(i, j + 1)}`);
    }
  }
});
