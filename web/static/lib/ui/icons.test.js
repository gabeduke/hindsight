// The icon sprite (icons/ui.svg) and lib/ui/icons.js: every icon a page or a
// script asks for is drawn, every drawn one is named in ICONS, the markup a
// page writes is what icon() would, and the sprite is cached for offline.
// A name the sprite hasn't got draws nothing at all, with no error anywhere:
// these are the only place it is caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { fileCss, rules } from '../stylesheets.js';
import { ICONS, SPRITE, icon, setIcon, iconOf, outIcon, OUT_MODES } from './icons.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // web/static
const sprite = readFileSync(join(ROOT, 'icons', 'ui.svg'), 'utf8');
const symbols = [...sprite.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)]
  .map(([, attrs, inner]) => ({ id: /\bid="([^"]+)"/.exec(attrs)?.[1], attrs, inner }));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(name) && !name.endsWith('.test.js')) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => ({ p: p.slice(ROOT.length), src: readFileSync(p, 'utf8') }));

/** arg is argument `n` of a call whose arguments start `text`, by its brackets. */
function arg(text, n) {
  let depth = 0, at = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && depth-- === 0) return at === n ? text.slice(from, i) : '';
    else if (c === ',' && depth === 0) {
      if (at === n) return text.slice(from, i);
      at++;
      from = i + 1;
    }
  }
  return at === n ? text.slice(from) : '';
}

test('the sprite draws every icon in ICONS, and nothing ICONS leaves out', () => {
  const ids = symbols.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `an id twice in the sprite: ${ids}`);
  assert.equal(new Set(ICONS).size, ICONS.length, 'a name twice in ICONS');
  assert.deepEqual(ICONS.filter((n) => !ids.includes(n)), [], 'in ICONS, not in icons/ui.svg');
  assert.deepEqual(ids.filter((n) => !ICONS.includes(n)), [], 'in icons/ui.svg, not in ICONS');
  // Every <symbol> is matched: one left open would swallow the next.
  assert.equal((sprite.match(/<symbol\b/g) || []).length, symbols.length);
});

test('each icon is line art on the 24 grid, in the ink of its key, its stroke’s width the stylesheet’s', () => {
  for (const s of symbols) {
    assert.match(s.attrs, /viewBox="0 0 24 24"/, s.id);
    assert.match(s.attrs, /fill="none"/, s.id);
    assert.match(s.attrs, /stroke="currentColor"/, s.id);
    assert.match(s.attrs, /stroke-linecap="round"/, s.id);
    assert.match(s.attrs, /stroke-linejoin="round"/, s.id);
    // On the symbol it would beat svg.i's, and a chevron couldn't be drawn heavier.
    assert.doesNotMatch(s.attrs, /stroke-width/, s.id);
    // One colour, the key's: a written-in colour wouldn't follow the scheme.
    assert.doesNotMatch(s.inner, /#[0-9a-f]{3,6}\b|rgb/i, s.id);
    // Every element the symbol opens, it closes (or closes itself).
    const open = (s.inner.match(/<(path|rect|circle|g)\b[^>]*[^/]>/g) || []).length;
    const close = (s.inner.match(/<\/(path|rect|circle|g)>/g) || []).length;
    assert.equal(open, close, `${s.id}: unclosed element`);
  }
  // The kit's 1.75, on every icon a page draws.
  const r = rules(fileCss('styles.css')).find((x) => x.sel.includes('svg.i') && !x.media);
  assert.ok(r, 'styles.css should style svg.i');
  assert.match(r.body, /stroke-width:\s*1\.75/);
});

test('every icon a page or a script names is in the sprite and in ICONS', () => {
  const used = new Map();
  const add = (name, where) => used.set(name, [...(used.get(name) || []), where]);
  for (const { p, src } of files) {
    for (const m of src.matchAll(/ui\.svg#([\w-]+)/g)) add(m[1], p);
    // icon('x'), setIcon(key, 'x'), and each name a ternary picks between.
    for (const m of src.matchAll(/\b(icon|setIcon)\(([^;\n]*)/g)) {
      const name = m[1] === 'setIcon' ? arg(m[2], 1) : arg(m[2], 0);
      for (const q of name.matchAll(/'([\w-]+)'/g)) add(q[1], p);
    }
  }
  // outIcon's own two, at the least: else the scan is wrong, not the pages.
  assert.ok(used.has('speaker') && used.has('phones'), `the scan found only ${[...used.keys()]}`);
  const unknown = [...used].filter(([n]) => !ICONS.includes(n)).map(([n, w]) => `${n} (${[...new Set(w)].join(', ')})`);
  assert.deepEqual(unknown, []);
});

test('a page’s icon is written as icon() writes it: the class names the icon it shows, and a screen reader skips it', () => {
  let n = 0, uses = 0;
  for (const { p, src } of files.filter((f) => f.p.endsWith('.html'))) {
    uses += (src.match(/<svg class="i[ "]/g) || []).length;
    for (const m of src.matchAll(/<svg class="(i [^"]*)"([^>]*)>/g)) {
      const [tag, cls, rest] = m;
      // Its own first <use>, before the </svg> that closes it.
      const inner = src.slice(m.index, src.indexOf('</svg>', m.index));
      const use = inner.match(/<use href="\/icons\/ui\.svg#([\w-]+)"/);
      assert.ok(use, `${p}: ${tag} draws no icon`);
      assert.ok(cls.split(' ').includes(`i-${use[1]}`), `${p}: ${tag} shows ${use[1]}`);
      assert.match(rest, /aria-hidden="true"/, `${p}: ${tag}: the key says what it does`);
      n++;
    }
  }
  // Every icon a page has was read: one with no name of its own (class="i") too.
  assert.equal(n, uses, 'an icon in a page has no i-NAME class');
});

// The keys of the header, the bar and the ruler, on every page that has
// them: each draws its icon, and none is a glyph a fallback font would draw.
const DRAWN = {
  'shell.html': ['tape-undo', 'tape-redo', 'tape-more', 'out-btn', 'tape-name', 'tape-sub', 'tape-out',
    'np-expand', 'np-start', 'np-back5', 'np-play', 'np-loop', 'np-eject', 'np-fold-btn',
    'snap-btn', 'loop-lock', 'tracks-fold-btn', 'ruler-more', 'buffer-snap'],
  'wave.html': ['take-undo', 'menu-btn', 'np-expand', 'to-start', 'back5', 'play', 'loop'],
};
const GLYPHS = /[↶↷⋯☰▾▴▸▶❚■⟲↺⏏✎⌗]/;

test('the header’s, the bar’s and the ruler’s keys are drawn from the sprite, not typed in a glyph', () => {
  for (const [page, ids] of Object.entries(DRAWN)) {
    const doc = fakeDoc();
    doc.body.append(...parseHTML(doc, readFileSync(join(ROOT, page), 'utf8')).nodes);
    // The buffer's keys are a template's: they count too.
    const all = [...doc.body.descendants(), ...doc.body.descendants().filter((e) => e.content).flatMap((t) => t.content.descendants())];
    for (const id of ids) {
      const key = all.find((e) => e.id === id);
      assert.ok(key, `${page}: #${id}`);
      assert.ok(iconOf(key), `${page}: #${id} draws no icon`);
      assert.doesNotMatch(key.textContent, GLYPHS, `${page}: #${id} has a glyph in it`);
    }
  }
});

test('the sprite and its module are in the offline shell', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const shell = [.../SHELL\s*=\s*\[([\s\S]*?)\]/.exec(sw)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.includes(SPRITE), `${SPRITE} is not in sw.js SHELL: offline, every key would be blank`);
  assert.ok(shell.includes('/lib/ui/icons.js'));
});

test('icon() is an <svg> of the one sprite, sized, hidden from a screen reader unless it is labelled', () => {
  assert.equal(icon('undo', { size: 22 }),
    '<svg class="i i-undo" width="22" height="22" aria-hidden="true"><use href="/icons/ui.svg#undo"/></svg>');
  assert.match(icon('play'), /width="20" height="20"/);
  assert.match(icon('down', { cls: 'pill-chev-ico' }), /class="i i-down pill-chev-ico"/);
  const said = icon('star', { label: 'Starred "best"' });
  assert.match(said, /role="img" aria-label="Starred &quot;best&quot;"/);
  assert.doesNotMatch(said, /aria-hidden/);
  assert.throws(() => icon('pencil'), /no icon "pencil"/);
});

test('setIcon swaps the picture a key shows, and writes only when it changes', () => {
  const doc = fakeDoc();
  const key = parseHTML(doc, `<button>${icon('play')}</button>`).children[0];
  doc.body.append(key);
  const use = key.querySelector('use');
  let writes = 0;
  const set = use.setAttribute.bind(use);
  use.setAttribute = (k, v) => { writes++; set(k, v); };
  setIcon(key, 'pause');
  assert.equal(iconOf(key), 'pause');
  assert.equal(key.querySelector('svg').getAttribute('class'), 'i i-pause');
  assert.equal(writes, 1);
  setIcon(key, 'pause');
  assert.equal(writes, 1, 'the same picture again is no write: the bar sets it every frame');
  assert.throws(() => setIcon(key, 'nope'));
  // A key with none yet gets one.
  const bare = doc.createElement('button');
  setIcon(bare, 'eject');
  assert.equal(iconOf(bare), 'eject');
  assert.equal(iconOf(doc.createElement('button')), null);
});

test('where the tape plays: a speaker, headphones, or both, each its own picture in the key’s ink', () => {
  assert.equal(iconOf(parseHTML(fakeDoc(), outIcon('jam'))), 'speaker');
  assert.equal(iconOf(parseHTML(fakeDoc(), outIcon('phone'))), 'phones');
  assert.match(outIcon('both'), /#speaker"[^>]*\/><use href="\/icons\/ui\.svg#phones" x="18"/);
  assert.match(outIcon('both'), /width="38"/);
  assert.equal(outIcon('anything'), outIcon('jam'));
  const pictures = OUT_MODES.map(outIcon);
  assert.equal(new Set(pictures).size, OUT_MODES.length);
  for (const p of pictures) {
    assert.match(p, /class="i [^"]*out-ico"/);
    assert.match(p, /aria-hidden="true"/);
  }
});
