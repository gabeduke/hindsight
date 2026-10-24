// web/static/lib/css-cascade.test.js
// A selector list says a thing once in any one context. Two rules with the
// same selectors in the same @media (or none) match the same elements with
// the same weight, so the later one always wins and the earlier one's
// declaration of that property is dead text: it reads like the answer, and
// the fix made to it changes nothing on the screen. The stylesheets had 47 of
// them, most a thousand lines from the rule that overrode them -- .capture-
// btn's corners were set at 627 and again at 3739.
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
const covers = (later, earlier) => later === earlier || (SHORTHANDS[later] || []).includes(earlier);

/**
 * overwritten is every declaration a later rule with the same selector list,
 * in the same at-rules, declares again (or under a shorthand), as
 * "file:line selectors [context] property", across `sheets` in order.
 */
function overwritten(sheets) {
  const all = sheets.flatMap(({ file, css }) => rules(css, { file }));
  const groups = new Map();
  for (const r of all) {
    const key = `${r.at.join(' / ')}\n${r.sel.join(', ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const rs of groups.values()) {
    rs.forEach((r, i) => {
      const later = rs.slice(i + 1).flatMap((x) => decls(x.body).map((d) => ({ ...d, line: x.line })));
      for (const d of decls(r.body)) {
        const by = later.find((x) => covers(x.prop, d.prop));
        if (by) out.push(`${r.file}:${r.line} ${r.sel.join(', ')}${r.at.length ? ` [${r.at.join(' / ')}]` : ''} ${d.prop} (again at ${by.line})`);
      }
    });
  }
  return out;
}

test('the checker finds a property said twice, under a shorthand too, and only in one context', () => {
  const css = `.a { color: red; padding-left: 2px; }
.a, .b { color: blue; }
@media (min-width: 9px) { .a { color: green; } }
.a { color: black; padding: 0; }
.b, .a { margin: 0; }
.b, .a { margin: 1px; }`;
  assert.deepEqual(overwritten([{ file: 'x.css', css }]), [
    'x.css:1 .a color (again at 4)',
    'x.css:1 .a padding-left (again at 4)',
    'x.css:5 .b, .a margin (again at 6)',
  ], 'a list is its own selector; a @media its own context');
  assert.deepEqual(overwritten([{ file: 'a.css', css: ':root { --x: 1; }' }, { file: 'b.css', css: ':root { --x: 2; }' }]),
    ['a.css:1 :root --x (again at 1)'], 'across the files a page links, in their order');
  assert.deepEqual(overwritten([{ file: 'x.css', css: '.a { height: 100vh; height: 100dvh; }' }]), [],
    'a fallback pair inside one rule is the browser’s to choose between');
});

test('no selector list declares a property twice in one context', () => {
  const sheets = linksOf('shell.html').map((file) => ({ file, css: fileCss(file) }));
  assert.deepEqual(overwritten(sheets), [],
    'a later rule with the same selectors and the same @media overrides these: delete the earlier one, or merge the two');
});
