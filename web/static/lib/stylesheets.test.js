// web/static/lib/stylesheets.test.js
// The CSS reader every stylesheet test stands on. A reader that slips -- a
// brace in a comment, a comma inside :is(), a semicolon in a url() -- makes
// the tests above it pass for the wrong reason, so it is pinned here on
// small sheets that hold each of those, and then on the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  block, cssOf, decls, fileCss, linksIn, linksOf, rules, section, splitList, stripComments, tokens,
} from './stylesheets.js';

const SHEET = `/* a { b } -- a brace in a comment is not a block */
@font-face { font-family: 'X'; src: url('/x.woff2'); }
:root { --a: #fff; }
.a, .b :is(.c, .d) { color: red; background: url("x;{y}") }
@media (min-width: 700px) {
  .a { color: blue }
  @media (hover: hover) {
    .a:hover,
    .e { color: green !important }
  }
  @keyframes k { from { opacity: 0 } to { opacity: 1 } }
}
@supports (display: grid) { .g { display: grid } }
.s::before { content: '}' }
`;

test('linksIn: a page’s stylesheets in link order, and nothing that is not one', () => {
  const html = `<link rel="stylesheet" href="/a.css">
<!-- <link rel="stylesheet" href="/old.css"> -->
<link rel="preload" href="/font.woff2" as="font">
<link href="/b.css" rel="stylesheet">
<link rel=stylesheet href='/c.css'>`;
  assert.deepEqual(linksIn(html), ['/a.css', '/b.css', '/c.css']);
});

// cssOf() reads shell.html's cascade; every other page has the same one,
// a page with the header (css/chrome.css, the frame) its stylesheet next,
// a page with the bar the bar's after that, and the notes drawer's (✎ is
// on the bar), and every page the moves between rooms last, so what the
// tests find
// there holds on every page.
test('linksOf: every page takes the materials, then the chrome, then its places, then the moves between rooms', () => {
  const pages = readdirSync(new URL('../', import.meta.url)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 5, `found only ${pages.length} pages`);
  const frame = new Set(['shell.html', 'wave.html', 'rig.html', 'guide.html']);
  const bar = new Set(['shell.html', 'wave.html']);
  for (const page of pages) {
    assert.deepEqual(linksOf(page), ['/objects.css', '/styles.css', ...(frame.has(page) ? ['/css/chrome.css'] : []), ...(bar.has(page) ? ['/css/bar.css', '/css/notes.css'] : []), '/css/rooms-motion.css'], page);
  }
});

test('it is the tests’ alone: no page imports it, so the shell does not cache it', () => {
  // It reads the disk (node:fs), which a browser has not got.
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(!sw.includes('/lib/stylesheets.js'), 'sw.js SHELL lists it');
});

test('cssOf is the page’s stylesheets end to end; fileCss is one, with or without its comments', () => {
  assert.equal(cssOf(), `${fileCss('objects.css')}\n${fileCss('styles.css')}\n${fileCss('css/chrome.css')}\n${fileCss('css/bar.css')}\n${fileCss('css/notes.css')}\n${fileCss('css/rooms-motion.css')}`);
  assert.equal(cssOf('shell.html'), cssOf());
  assert.equal(fileCss('/styles.css'), fileCss('styles.css'));
  const bare = fileCss('styles.css', { comments: false });
  assert.ok(!bare.includes('/*') && bare.length < fileCss('styles.css').length);
  assert.equal(cssOf('shell.html', { comments: false }), `${fileCss('objects.css', { comments: false })}\n${bare}\n${fileCss('css/chrome.css', { comments: false })}\n${fileCss('css/bar.css', { comments: false })}\n${fileCss('css/notes.css', { comments: false })}\n${fileCss('css/rooms-motion.css', { comments: false })}`);
});

test('stripComments takes comments out and leaves a string that looks like one', () => {
  assert.equal(stripComments('a { b: c; /* d */ }\n/* e\n f */g { content: "/* h */" }'), 'a { b: c;  }\ng { content: "/* h */" }');
});

test('splitList splits at top-level commas only', () => {
  assert.deepEqual(splitList('.a, .b :is(.c, .d),\n  .e[data-x="1,2"] , :not(.f, .g)'), ['.a', '.b :is(.c, .d)', '.e[data-x="1,2"]', ':not(.f, .g)']);
  assert.deepEqual(splitList(''), []);
});

test('decls reads a body, a semicolon in a url, a function or a string not ending one', () => {
  assert.deepEqual(decls(' color: red ; background: url("x;y") no-repeat;\n  --t: rgba(0, 0, 0, .5); margin:0 !important; '), [
    { prop: 'color', value: 'red', important: false },
    { prop: 'background', value: 'url("x;y") no-repeat', important: false },
    { prop: '--t', value: 'rgba(0, 0, 0, .5)', important: false },
    { prop: 'margin', value: '0', important: true },
  ]);
  assert.deepEqual(decls('grid-template-areas: "a b" "c d"; content: \';\''), [
    { prop: 'grid-template-areas', value: '"a b" "c d"', important: false },
    { prop: 'content', value: "';'", important: false },
  ]);
});

test('rules: every style rule with the at-rules it sits in, and its line', () => {
  const rs = rules(SHEET, { file: 'x.css' });
  assert.deepEqual(rs.map((r) => [r.sel, r.media, r.at, r.line]), [
    [[':root'], '', [], 3],
    [['.a', '.b :is(.c, .d)'], '', [], 4],
    [['.a'], '(min-width: 700px)', ['@media (min-width: 700px)'], 6],
    [['.a:hover', '.e'], '(min-width: 700px) / (hover: hover)', ['@media (min-width: 700px)', '@media (hover: hover)'], 8],
    [['.g'], '', ['@supports (display: grid)'], 13],
    [['.s::before'], '', [], 14],
  ], 'a keyframe’s steps and @font-face are not style rules');
  assert.ok(rs.every((r) => r.file === 'x.css'));
  const steps = rules(SHEET, { keyframes: true }).filter((r) => r.at.at(-1) === '@keyframes k');
  assert.deepEqual(steps.map((r) => [r.sel, r.body.trim()]), [[['from'], 'opacity: 0'], [['to'], 'opacity: 1']], 'and a keyframe’s steps, when asked');
  assert.equal(rs[1].body, ' color: red; background: url("x;{y}") ', 'a brace in a string is the string’s');
  assert.equal(rs[5].body, " content: '}' ");
  assert.deepEqual(decls(rs[3].body), [{ prop: 'color', value: 'green', important: true }]);
});

test('block: the braces of the first block at or after a point, matched past comments and strings', () => {
  assert.equal(block(SHEET, '@supports'), ' .g { display: grid } ');
  const media = block(SHEET, SHEET.indexOf('@media (min-width'));
  assert.ok(media.startsWith('\n  .a { color: blue }') && media.trimEnd().endsWith('to { opacity: 1 } }'), media);
  assert.equal(block('a { b: "}" /* } */ } c { }', 0), ' b: "}" /* } */ ');
  assert.throws(() => block(SHEET, '@container'), /no block/);
  assert.throws(() => block('a { b { }', 0), /never closes/);
});

test('section: from a header comment to the next, its comments gone', () => {
  const css = `a { }\n/* ---------- One: the first */\n.b { c: d; } /* e */\n/* ----- Two */\n.f { }\n`;
  assert.equal(section(css, '/* ---------- One:'), '\n.b { c: d; } \n');
  assert.equal(section(css, '/* ----- Two'), '\n.f { }\n', 'the last runs to the end');
  assert.throws(() => section(css, '/* ---------- Three:'), /no section/);
});

test('tokens: light is :root outside any at-rule; dark is the cascade with the dark block; only, the dark block alone', () => {
  const css = `:root { --a: #fff; --b: #eee; }
@media (prefers-color-scheme: dark) { :root { --a: #000; --c: #111; } }
@media (max-width: 600px) { :root { --a: #f00; } }
:root, body { --d: #222; }
.x { --e: #333; }
:root { --b: #ddd;
  --font: "A B",
          serif; }`;
  assert.deepEqual(tokens(css), { '--a': '#fff', '--b': '#ddd', '--font': '"A B", serif' });
  assert.deepEqual(tokens(css, { scheme: 'dark' }), { '--a': '#000', '--b': '#ddd', '--c': '#111', '--font': '"A B", serif' });
  assert.deepEqual(tokens(css, { scheme: 'dark', only: true }), { '--a': '#000', '--c': '#111' });
  assert.throws(() => tokens(css, { scheme: 'dusk' }), /no scheme/);
});

test('the real stylesheets read whole: every rule closed, none inside another, and the tokens of both schemes', () => {
  for (const name of ['styles.css', 'objects.css', 'css/chrome.css', 'css/bar.css']) {
    const rs = rules(fileCss(name));
    assert.ok(rs.length > (name === 'styles.css' ? 1800 : 3), `${name}: only ${rs.length} rules`);
    for (const r of rs) {
      assert.ok(r.sel.length > 0, `${name}:${r.line} has no selector`);
      assert.ok(!/[{}]/.test(r.body.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')), `${name}:${r.line} ${r.sel[0]} holds a block`);
    }
  }
  const light = tokens(cssOf()), dark = tokens(cssOf(), { scheme: 'dark' });
  assert.equal(light['--bg'], '#e4e3dd');
  assert.equal(dark['--bg'], '#141516');
  assert.equal(light['--oxide'], dark['--oxide'], 'a material is the same in both');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'the dark block redefines, it adds nothing');
});
