// web/static/lib/css-tokens.test.js
// Canvas code takes its colours from the stylesheets by name (theme.js
// token(), and the getPropertyValue readers the drawers keep), with a
// fallback written beside each name for when it reads nothing. Nothing tied
// the two together: 59 colour fallbacks had kept an older palette (the
// Solarized blue #268bd2 stood in for --sel and --wave in six files, a cream
// for the black --well), and two names were read that no stylesheet defines:
// --ok, so the buffer's playhead drew in its fallback at noon and at night
// alike, and --trace-fill. So: every name JS reads is a token of the
// stylesheets, and every fallback beside one is its light value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cssOf, tokens } from './stylesheets.js';

const STATIC = new URL('../', import.meta.url);
const light = tokens(cssOf(), { scheme: 'light' });
const dark = tokens(cssOf(), { scheme: 'dark' });

const NAME = String.raw`'(--[a-z0-9-]+)'`;
const FALLBACK = String.raw`(?:\s*,\s*(?:'([^']*)'|"([^"]*)"))?`;

/**
 * readsIn is every token `src` reads, as { name, fallback, line }:
 * token('--x', fb) (theme.js), col('--x', fb) and the other little readers a
 * file defines over getPropertyValue or token(), either side of a ternary;
 * getPropertyValue('--x'); a { token: '--x', fallback } entry; and a
 * var(--x, fb) written into a style from JS.
 */
function readsIn(src) {
  const readers = new Set(['token', 'col', 'getPropertyValue']);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(\s*(\w+)\s*(?:,\s*\w+\s*)?\)\s*=>\s*(?:[\w.]+\.getPropertyValue\(\s*\2\s*\)|token\(\s*\2\b)/g)) readers.add(m[1]);
  const out = [];
  const at = (i) => src.slice(0, i).split('\n').length;
  const call = new RegExp(String.raw`\b(\w+)\(\s*(?:[^,()'"]+\?\s*${NAME}\s*:\s*${NAME}|${NAME})${FALLBACK}`, 'g');
  for (const m of src.matchAll(call)) {
    if (!readers.has(m[1])) continue;
    for (const name of [m[2], m[3], m[4]].filter(Boolean)) out.push({ name, fallback: m[5] ?? m[6], line: at(m.index) });
  }
  for (const m of src.matchAll(new RegExp(String.raw`token:\s*${NAME},\s*fallback:\s*'([^']*)'`, 'g'))) out.push({ name: m[1], fallback: m[2], line: at(m.index) });
  for (const m of src.matchAll(/var\((--[a-z0-9-]+)\s*,\s*([^()]+(?:\([^()]*\))?)\s*\)/g)) out.push({ name: m[1], fallback: m[2].trim(), line: at(m.index) });
  return out;
}

/** reads is every token read by the app's scripts (lib/ and app.js, not the tests): [{ file, name, fallback, line }]. */
function reads() {
  const files = readdirSync(new URL('lib/', STATIC), { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'stylesheets.js')
    .map((f) => `lib/${f}`);
  return [...files, 'app.js'].flatMap((file) => readsIn(readFileSync(new URL(file, STATIC), 'utf8')).map((r) => ({ file, ...r })));
}

/** value is a token's light value with its var()s resolved. */
function value(name, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const v = light[name];
  return v && v.replace(/var\((--[a-z0-9-]+)\)/g, (m, n) => value(n, seen) ?? m);
}

/** rgba is a colour as [r, g, b, a], or null when `c` is not one this reads. */
function rgba(c) {
  c = c.trim().toLowerCase();
  if (c === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    const h = m[1].length <= 4 ? [...m[1]].map((x) => x + x) : m[1].match(/../g);
    const [r, g, b, a = 'ff'] = h;
    return [r, g, b].map((x) => parseInt(x, 16)).concat(Math.round((parseInt(a, 16) / 255) * 1000) / 1000);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  return null;
}

/** families is a font stack's families, unquoted. */
const families = (v) => v.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

/**
 * agrees says whether a fallback stands in for a token's light value: the
 * same colour, or -- for a font stack -- families from the token's own stack
 * (the stack's named faces are web fonts; its generic ones are the fallback).
 */
function agrees(fallback, v) {
  const a = rgba(fallback), b = rgba(v);
  if (a || b) return !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) < 0.002);
  if (v.includes(',')) return families(fallback).every((f) => families(v).includes(f));
  return fallback.replace(/\s+/g, '') === v.replace(/\s+/g, '');
}

test('the reader finds each way a script reads a token', () => {
  const src = `
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;
    const tk = (name) => token(name, 'transparent', canvas);
    ctx.fillStyle = col('--a', '#fff');
    ctx.fillStyle = token(on ? '--b' : '--c', "rgba(0,0,0,.5)", el);
    const d = tk('--d');
    const e = getComputedStyle(x).getPropertyValue('--e');
    export const COLORS = [{ id: 'f', token: '--f', fallback: '#123456' }];
    const g = 'var(--g, #00ff00)', h = 'var(--h, rgba(1, 2, 3, .4))';
    el.style.setProperty('--set', '1px');
    ['--named-in-a-list'];`;
  assert.deepEqual(readsIn(src).map((r) => [r.name, r.fallback]), [
    ['--a', '#fff'], ['--b', 'rgba(0,0,0,.5)'], ['--c', 'rgba(0,0,0,.5)'], ['--d', undefined], ['--e', undefined],
    ['--f', '#123456'], ['--g', '#00ff00'], ['--h', 'rgba(1, 2, 3, .4)'],
  ], 'what a script sets, or merely names, is not a read');
});

test('the colour and font comparisons', () => {
  assert.ok(agrees('#4EBEB4', '#4ebeb4') && agrees('#fff', '#ffffff') && agrees('rgba(242,230,200,0.14)', 'rgba(242, 230, 200, .14)'));
  assert.ok(!agrees('#268bd2', '#4ebeb4') && !agrees('transparent', '#4ebeb4') && !agrees('#000', 'rgba(0,0,0,.5)'));
  const mono = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
  assert.ok(agrees('ui-monospace, monospace', mono) && agrees('monospace', mono));
  assert.ok(!agrees('serif', mono) && !agrees('Courier', mono));
});

test('the scripts read their colours from the stylesheets', () => {
  const all = reads();
  assert.ok(all.length > 100, `only ${all.length} reads found; the reader is probably wrong`);
  for (const [file, name] of [['lib/wave/view.js', '--sel'], ['lib/tape/page.js', '--rec'], ['lib/tape/sections.js', '--t1'], ['lib/objects/cassette.js', '--pack']]) {
    assert.ok(all.some((r) => r.file === file && r.name === name), `${file} reads ${name}`);
  }
});

test('every token a script reads is defined in the stylesheets, in both schemes', () => {
  const missing = reads().filter((r) => light[r.name] === undefined || dark[r.name] === undefined).map((r) => `${r.file}:${r.line} ${r.name}`);
  assert.deepEqual(missing, [], 'these read a token no stylesheet defines, so they draw in their fallback whatever the scheme');
});

test('every fallback a script writes beside a token is that token’s light value', () => {
  const drifted = reads().filter((r) => r.fallback !== undefined && light[r.name] !== undefined && !agrees(r.fallback, value(r.name)))
    .map((r) => `${r.file}:${r.line} ${r.name}: ${r.fallback}, but the stylesheet's is ${value(r.name)}`);
  assert.deepEqual(drifted, [], 'a fallback that has drifted from the palette');
});
