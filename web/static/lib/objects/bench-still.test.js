import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontUrls, inlineUrls, tokenNames, pinned, stillName, svgOf } from './bench-still.js';
import { cssOf, fileCss } from '../stylesheets.js';

test('every font the stylesheets load is found, once', () => {
  const urls = fontUrls(fileCss('styles.css'));
  assert.ok(urls.length >= 7, `only ${urls.length} fonts found`);
  assert.ok(urls.every((u) => u.startsWith('/fonts/') && u.endsWith('.woff2')));
  assert.equal(new Set(urls).size, urls.length);
  // Quoted, double-quoted and bare all count.
  assert.deepEqual(fontUrls(`a{src:url('/a.woff2')} b{src:url("/b.woff2")} c{src:url(/c.woff2)} d{src:url('/a.woff2')}`),
    ['/a.woff2', '/b.woff2', '/c.woff2']);
});

test('a font is swapped for its data, and one that would not load is left alone', () => {
  const css = `@font-face{src:url('/fonts/a.woff2') format('woff2')} @font-face{src:url('/fonts/b.woff2')}`;
  const out = inlineUrls(css, { '/fonts/a.woff2': 'data:font/woff2;base64,AAAA' });
  assert.match(out, /url\("data:font\/woff2;base64,AAAA"\) format\('woff2'\)/);
  assert.match(out, /url\('\/fonts\/b\.woff2'\)/);
});

test('the tokens pinned on a still are every one the two stylesheets declare', () => {
  // The bench's page links objects.css, then styles.css.
  const names = tokenNames(cssOf('objects.html'));
  for (const t of ['--bg', '--ink', '--panel', '--oxide', '--lcd', '--lcd-ink', '--grease-mark', '--marker', '--flag']) {
    assert.ok(names.includes(t), `${t} should be pinned`);
  }
  assert.equal(new Set(names).size, names.length);
});

test('pinning writes each token at its value, and skips one with none', () => {
  assert.equal(pinned({ '--bg': '#141516', '--ink': '#ecebe6', '--gone': '' }), '--bg: #141516; --ink: #ecebe6;');
});

test('a still is named for its scheme and width, so two can be told apart', () => {
  assert.equal(stillName({ scheme: 'dark', width: 390 }), 'hindsight-bench-dark-390px.png');
  assert.equal(stillName({ scheme: 'light', width: 1279.6, ext: 'svg' }), 'hindsight-bench-light-1280px.svg');
});

test('the copy is wrapped in an SVG of its own size', () => {
  const svg = svgOf('<div xmlns="http://www.w3.org/1999/xhtml">x</div>', 390, 1200);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="390" height="1200" viewBox="0 0 390 1200">/);
  assert.match(svg, /<foreignObject x="0" y="0" width="390" height="1200"><div /);
  assert.match(svg, /<\/foreignObject><\/svg>$/);
});
