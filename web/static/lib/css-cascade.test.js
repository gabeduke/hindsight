// web/static/lib/css-cascade.test.js
// A declaration a later rule always overrides is dead text: it reads like the
// answer, and the fix made to it changes nothing on the screen. The tape-deck
// restyle (styles.css, "the deck") set the keys, the surfaces and the fields
// again three thousand lines below their first rules, in grouped lists, and
// left the first values standing: .icon-btn's corners were 9px at line 989
// and 10px at 3616, and the 10px won. The stylesheets had 181 of these.
//
// A selector in a list matches what it matches alone, with its own weight,
// so `.a { color: red }` is dead under a later `.a, .b { color: blue }` in
// the same @media (or none): .a is blue wherever it is. An earlier list is
// dead only when every selector in it is overridden; `.a, .b { … }` under a
// later `.a { … }` still styles .b. Not dead: an earlier !important under a
// later plain one, and anything under a list a browser may drop whole (a
// vendor-prefixed selector in it), as there the earlier one still applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decls, fileCss, linksOf, rules } from './stylesheets.js';

// The longhands a later shorthand sets too, so an earlier longhand under it
// is just as dead (`padding` after `padding-left`).
const SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat',
    'background-origin', 'background-clip', 'background-attachment'],
  border: ['border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  overflow: ['overflow-x', 'overflow-y'],
  gap: ['row-gap', 'column-gap'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
};
const covers = (later, earlier) => later.prop === earlier.prop || (SHORTHANDS[later.prop] || []).includes(earlier.prop);
// A list with one of these in it is dropped whole by a browser that doesn't
// know the selector, which then keeps the earlier value.
const DROPPABLE = /:{1,2}-[a-z]+-/i;

/**
 * overwritten is every declaration that later rules in the same at-rules
 * declare again (or under a shorthand) for every selector of its list, as
 * "file:line selectors [context] property (again at lines)", across `sheets`
 * in order.
 */
function overwritten(sheets) {
  const all = sheets.flatMap(({ file, css }) => rules(css, { file }).map((r) => ({ ...r, decls: decls(r.body) })));
  const out = [];
  all.forEach((r, i) => {
    const context = r.at.join(' / ');
    const later = all.slice(i + 1).filter((x) => x.at.join(' / ') === context && !x.sel.some((s) => DROPPABLE.test(s)));
    for (const d of r.decls) {
      const by = r.sel.map((s) => later.find((x) => x.sel.includes(s)
        && x.decls.some((y) => covers(y, d) && (y.important || !d.important))));
      if (by.every(Boolean)) {
        const at = [...new Set(by.map((x) => x.line))].sort((a, b) => a - b).join(', ');
        out.push(`${r.file}:${r.line} ${r.sel.join(', ')}${context ? ` [${context}]` : ''} ${d.prop} (again at ${at})`);
      }
    }
  });
  return out;
}

test('the checker finds a property said again for every selector of a list, under a shorthand too, in one context', () => {
  const css = `.a { color: red; padding-left: 2px; }
.a, .b { color: blue; }
@media (min-width: 9px) { .a { color: green; } }
.a { color: black; padding: 0; }
.b, .a { margin: 0; }
.b, .a { margin: 1px; }
.c, .d { color: red; }
.d { color: blue; }
.c, .e { color: green; }`;
  assert.deepEqual(overwritten([{ file: 'x.css', css }]), [
    'x.css:1 .a color (again at 2)',
    'x.css:1 .a padding-left (again at 4)',
    'x.css:5 .b, .a margin (again at 6)',
    'x.css:7 .c, .d color (again at 8, 9)',
  ], 'a selector is overridden by any later list that holds it; a list only when all of it is; a @media is its own context');
  assert.deepEqual(overwritten([{ file: 'a.css', css: ':root { --x: 1; }' }, { file: 'b.css', css: ':root { --x: 2; }' }]),
    ['a.css:1 :root --x (again at 1)'], 'across the files a page links, in their order');
  assert.deepEqual(overwritten([{ file: 'x.css', css: '.a { height: 100vh; height: 100dvh; }' }]), [],
    'a fallback pair inside one rule is the browser’s to choose between');
  assert.deepEqual(overwritten([{ file: 'x.css', css: '.a { color: red !important; }\n.a { color: blue; }\n.a { margin: 0 !important; }\n.a { margin: 1px !important; }' }]),
    ['x.css:3 .a margin (again at 4)'], 'a plain declaration does not override an !important one');
  assert.deepEqual(overwritten([{ file: 'x.css', css: '.a { color: red; }\n.a, .a::-webkit-x { color: blue; }' }]), [],
    'a list a browser may drop whole overrides nothing for certain');
});

test('no declaration is one a later rule always overrides', () => {
  const sheets = linksOf('shell.html').map((file) => ({ file, css: fileCss(file) }));
  assert.deepEqual(overwritten(sheets), [],
    'a later rule with these selectors, in the same @media, overrides these: delete the earlier one, or merge the two');
});
