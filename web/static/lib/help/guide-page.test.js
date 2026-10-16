// web/static/lib/help/guide-page.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './markdown.js';
import { sectionize, contents, current } from './guide-page.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const guide = readFileSync(join(root, 'docs', 'guide.md'), 'utf8');

test('sectionize puts the cover and each part in a box of its own', () => {
  const html = sectionize(renderMarkdown('# Title\n\nIntro.\n\n## 1. One\n\nA.\n\n### 1.1 Sub\n\nB.\n\n## 2. Two\n\nC.'));
  assert.match(html, /^<header class="cover"><h1 id="title">Title<\/h1>\n<p>Intro.<\/p>\n<\/header>/);
  assert.match(html, /<section class="part" aria-labelledby="1-one"><h2 id="1-one"><span class="num">1.<\/span> One<\/h2>/);
  assert.match(html, /<h3 id="11-sub"><span class="num">1.1<\/span> Sub<\/h3>\n<p>B.<\/p>\n<\/section><section class="part" aria-labelledby="2-two">/);
  assert.match(html, /<p>C.<\/p><\/section>$/);
});

test('a heading without a number keeps its words as they were', () => {
  assert.equal(sectionize('<h2 id="words">Words</h2><p>x</p>'),
    '<section class="part" aria-labelledby="words"><h2 id="words">Words</h2><p>x</p></section>');
});

test('contents lists the h2s and h3s, number apart from title', () => {
  const html = renderMarkdown('# T\n\n## 1. The idea\n\n### 3.10 When `x` & y\n\n## Words');
  assert.deepEqual(contents(html), [
    { id: '1-the-idea', level: 2, num: '1', title: 'The idea' },
    { id: '310-when-x-y', level: 3, num: '3.10', title: 'When x & y' },
    { id: 'words', level: 2, num: '', title: 'Words' },
  ]);
});

test('current is the last heading scrolled past, else the first', () => {
  const tops = [{ id: 'a', top: -400 }, { id: 'b', top: 90 }, { id: 'c', top: 600 }];
  assert.equal(current(tops, 100), 'b');
  assert.equal(current(tops, 50), 'a');
  assert.equal(current([{ id: 'a', top: 300 }], 100), 'a');
  assert.equal(current([], 100), '');
});

test('the whole guide: every part is sectioned, every id survives', () => {
  const plain = renderMarkdown(guide);
  const html = sectionize(plain);
  const ids = (s) => [...s.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(html), ids(plain));
  assert.equal((html.match(/<section class="part"/g) || []).length, (guide.match(/^## /gm) || []).length);
  const toc = contents(plain);
  assert.equal(toc.length, (guide.match(/^###? /gm) || []).length);
  assert.ok(toc.every((t) => t.title && !/[<>]/.test(t.title)));
});
