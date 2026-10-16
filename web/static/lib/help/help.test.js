import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIPS, tipFor } from './tips.js';
import { renderMarkdown, slug, inline } from './markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..'); // the repository
const guide = readFileSync(join(root, 'docs', 'guide.md'), 'utf8');

// The guide's §9 table, as [control, tip] rows.
function guideTips() {
  const start = guide.indexOf('| Control | Tip |');
  assert.ok(start >= 0, 'the guide has a tips table');
  const block = guide.slice(start, guide.indexOf('\n\n', start)).split('\n').slice(2);
  return block.map((l) => {
    const cells = l.replace(/^\|/, '').replace(/\|$/, '').split(' | ').map((c) => c.trim());
    return [cells[0], cells.slice(1).join(' | ')];
  });
}

test('the guide and tips.js list the same tips, in the same order', () => {
  assert.deepEqual(guideTips(), TIPS.map((t) => [t.control, t.tip]));
});

test('every tip id is unique', () => {
  const ids = TIPS.flatMap((t) => t.ids);
  assert.equal(new Set(ids).size, ids.length);
});

// Every data-tip named in the UI -- in the HTML, or set from script -- has a tip.
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : walk(p);
    return /\.(html|js)$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

test('every control in the UI that names a tip has one', () => {
  const missing = [];
  for (const f of walk(join(root, 'web', 'static'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/data-tip="([^"]+)"|dataset\.tip\s*=\s*(['"`])([^'"`$]+)\2/g)) {
      const id = m[1] || m[3];
      if (!tipFor(id)) missing.push(`${f.slice(root.length + 1)}: ${id}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every control on the take page has a tip', () => {
  const html = readFileSync(join(root, 'web', 'static', 'wave.html'), 'utf8');
  // Buttons and links in the page's chrome; the flag sheet's and the flags
  // list's Done, and the delete dialog's buttons, speak for themselves.
  const untipped = [...html.matchAll(/<(button|a)\b([^>]*)>/g)]
    .filter(([, , attrs]) => !/data-tip=/.test(attrs) && !/id="flags?-done"|value="(cancel|delete)"/.test(attrs));
  assert.deepEqual(untipped.map((m) => m[0]), []);
});

test('headings get ids the guide links use', () => {
  assert.equal(slug('4. The take page'), '4-the-take-page');
  assert.equal(slug('8.5 Editing like an OP-1'), '85-editing-like-an-op-1');
  assert.match(renderMarkdown('## 4. The take page'), /<h2 id="4-the-take-page">/);
});

test('the renderer handles the guide: tables, nested lists, code, links', () => {
  const html = renderMarkdown([
    '**Bold** and *italic* and `code <b>`.',
    '',
    '- one',
    '  - nested',
    '- two, wrapped',
    '  onto a second line',
    '',
    '| A | B |',
    '|---|---|',
    '| `x` | y |',
    '',
    '```',
    'a < b',
    '```',
  ].join('\n'));
  assert.match(html, /<strong>Bold<\/strong> and <em>italic<\/em> and <code>code &lt;b&gt;<\/code>/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two, wrapped onto a second line<\/li><\/ul>/);
  assert.match(html, /<th>A<\/th><th>B<\/th>.*<td data-label="A"><code>x<\/code><\/td><td data-label="B">y<\/td>/s);
  assert.match(html, /<pre><code>a &lt; b<\/code><\/pre>/);
});

// A phone stacks a table's rows into cards, so each cell says its column.
test('a table cell carries its column name, and the wrap its column count', () => {
  const html = renderMarkdown('| You see | It **means** | Do |\n|---|---|---|\n| a | b | c |');
  assert.match(html, /<div class="table-wrap cols-3" tabindex="0">/);
  assert.match(html, /<td data-label="You see">a<\/td><td data-label="It means">b<\/td><td data-label="Do">c<\/td>/);
  assert.match(renderMarkdown('| "x" | y |\n|---|---|\n| 1 | 2 |'), /data-label="&quot;x&quot;"/);
});

test('a part\'s checks are one block, each check tagged with where it runs', () => {
  const html = renderMarkdown([
    '**Checks — step 1** (data safety):',
    '',
    '- [demo] Tap *Capture* → a cassette',
    '- [rig] Switch the interface off',
    '- [phone] Calibrate',
    '- Not tagged',
  ].join('\n'));
  assert.match(html, /^<div class="checks"><p class="checks-head"><strong>Checks — step 1<\/strong> \(data safety\):<\/p><ul>/);
  assert.match(html, /<li class="check"><span class="check-tag demo">demo<\/span> Tap <em>Capture<\/em> → a cassette<\/li>/);
  assert.match(html, /<span class="check-tag rig">rig<\/span>/);
  assert.match(html, /<span class="check-tag phone">phone<\/span>/);
  assert.match(html, /<li>Not tagged<\/li><\/ul><\/div>$/);
  // The guide's own key to the tags gets the same chips.
  assert.match(renderMarkdown('- **[demo]** checks pass'), /<li class="check"><span class="check-tag demo">demo<\/span> checks pass<\/li>/);
  // A "Checks" line with no list under it stays a paragraph.
  assert.equal(renderMarkdown('**Checks** are below.\n\nText.'), '<p class="checks-head"><strong>Checks</strong> are below.</p>\n<p>Text.</p>');
});

test('the words that open a section say when, or what must be on, and nothing else is marked', () => {
  assert.equal(renderMarkdown('## 3. The main page\n\n*Today.*'), '<h2 id="3-the-main-page">3. The main page</h2>\n<p><span class="when today"><em>Today.</em></span></p>');
  assert.match(renderMarkdown('## 5. Undo\n\n*Step 4.* Then more.'), /<p><span class="when step"><em>Step 4.<\/em><\/span> Then more.<\/p>/);
  assert.match(renderMarkdown('### 8.12 B\n\n*With the two rooms on (Settings).* The'), /<span class="when preview"><em>With the two rooms on \(Settings\).<\/em><\/span> The/);
  // Not under a heading, or not one of those words: left as it was.
  assert.equal(renderMarkdown('Text.\n\n*Today.*'), '<p>Text.</p>\n<p><em>Today.</em></p>');
  assert.equal(renderMarkdown('## A\n\n*Nice* words.'), '<h2 id="a">A</h2>\n<p><em>Nice</em> words.</p>');
});

test('the whole guide\'s checks render as checks blocks, and its opening words are marked', () => {
  const html = renderMarkdown(guide);
  const lists = [...guide.matchAll(/^\*\*Checks\b[^\n]*(?:\n[^\n]+)*\n\n- /gm)].length;
  assert.ok(lists > 10);
  assert.equal((html.match(/<div class="checks">/g) || []).length, lists);
  // No check in the guide is left as a bare "[demo]".
  assert.doesNotMatch(html, /<li>\[(demo|rig|phone)\]/);
  assert.ok((html.match(/class="when /g) || []).length >= 15);
});

test('the renderer escapes HTML and refuses script links', () => {
  assert.equal(inline('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(inline('[x](javascript:alert(1))'), 'x');
  assert.match(inline('[guide](#9-tips-in-the-app)'), /<a href="#9-tips-in-the-app">guide<\/a>/);
  // Any scheme but http(s) and mailto leaves just the label.
  assert.equal(inline('[x](data:text/html,hi)'), 'x');
  assert.equal(inline('[x](vbscript:msgbox)'), 'x');
  assert.equal(inline('[x](JavaScript:alert)'), 'x');
  assert.match(inline('[mail](mailto:a@b.c)'), /<a href="mailto:a@b.c">mail<\/a>/);
  assert.match(inline('[site](https://example.com/a_b_c)'), /<a href="https:\/\/example.com\/a_b_c">site<\/a>/);
});

test('emphasis never reaches inside a link or code', () => {
  assert.equal(inline('[spec](superpowers/specs/2026_10_03_x.md)'),
    '<a href="https://github.com/gabeduke/hindsight/blob/main/docs/superpowers/specs/2026_10_03_x.md">spec</a>');
  assert.equal(inline('`a_b_c` and _this_'), '<code>a_b_c</code> and <em>this</em>');
  assert.equal(inline('[the `x_y_z` call](#calls)'), '<a href="#calls">the <code>x_y_z</code> call</a>');
});

test('a line that only looks like a table is a paragraph, not a hang', () => {
  assert.equal(renderMarkdown('|'), '<p>|</p>');
  assert.equal(renderMarkdown('| a | b |\nno separator'), '<p>| a | b | no separator</p>');
});

test('the whole guide renders, and its section links resolve', () => {
  const html = renderMarkdown(guide);
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const broken = links.filter((l) => !ids.has(l));
  assert.deepEqual(broken, []);
  for (const want of ['4-the-take-page', '3-the-main-page', '9-tips-in-the-app']) assert.ok(ids.has(want), want);
});

// With the two rooms off, a tip is the text the page has always shown: no
// word of the Listening Room, the Studio or "the two rooms" in it. The
// guide's table keeps the full text (above); a row's `off` is the old one.
test('with the rooms off a tip is its old text, and says nothing of the rooms', () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null };
  const sayRooms = /two rooms|Listening Room|Studio/;
  const offs = TIPS.filter((t) => t.off !== undefined);
  assert.ok(offs.length >= 7);
  for (const t of offs) {
    for (const id of t.ids) {
      assert.equal(tipFor(id), t.off, id);
      assert.doesNotMatch(tipFor(id), sayRooms, id);
    }
  }
  assert.equal(tipFor('select'), 'Pick several takes to star, export or delete together. Holding a take does the same');
  assert.ok(tipFor('np-expand').endsWith('Down, Back or Esc puts it away'));
  store['hindsight.rooms'] = '1';
  for (const t of offs) assert.notEqual(tipFor(t.ids[0]), t.off, t.ids[0]);
  delete globalThis.localStorage;
});
