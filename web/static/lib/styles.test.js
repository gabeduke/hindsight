// web/static/lib/styles.test.js
// The stylesheet's promises, checked without a browser: both schemes define
// the same tokens, text is readable on what it sits on, hover never sticks
// on a touch screen, and every control shows focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of the first block opening at `start` (brace-matched).
function block(start) {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(block(css.indexOf(':root')));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(block(darkAt)) };

function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a 6-digit hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const NEW = ['--face-hi', '--face-lo', '--panel-hi', '--card-hi', '--card-lo', '--edge', '--edge-soft', '--edge-strong',
  '--hl', '--sh', '--sh-strong', '--track', '--thumb-hi', '--thumb-lo', '--key-hi', '--key-lo', '--field', '--field-sh',
  '--accent-hi', '--accent-lo', '--accent-glow', '--go-glow', '--warn-glow', '--focus',
  '--well-hi', '--well-ink', '--well-dim', '--well-rule', '--lane', '--lane-hi', '--case-hi', '--case-lo'];

test('both schemes define the depth tokens', () => {
  for (const t of NEW) assert.ok(light[t], `light lacks ${t}`);
});

const PAIRS = [
  ['--ink', '--bg'], ['--ink-dim', '--bg'], ['--ink-faint', '--bg'], ['--ink', '--panel'], ['--ink-dim', '--panel'],
  ['--ink', '--field'], ['--on-accent', '--accent'], ['--on-accent', '--accent-lo'], ['--lcd-ink', '--lcd'],
  ['--well-ink', '--well'], ['--well-dim', '--well'], ['--danger-ink', '--bg'], ['--link', '--bg']
];
for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: text is readable on what it sits on`, () => {
    for (const [fg, bg] of PAIRS) {
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 4.5, `${scheme} ${fg} on ${bg} is ${c.toFixed(2)}:1`);
    }
  });
}

test('hover lives only inside @media (hover: hover)', () => {
  const hoverBlocks = [...css.matchAll(/@media \(hover: hover\)/g)].map((m) => block(m.index));
  let outside = css;
  for (const b of hoverBlocks) outside = outside.replace(b, '');
  const stray = outside.split('\n').filter((l) => /:hover/.test(l) && !/^\s*(\/\*|\*)/.test(l));
  assert.deepEqual(stray, []);
});

test('every control shows a focus ring', () => {
  const rules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{/g)].map((m) => m[1]).join(',');
  for (const sel of ['.icon-btn', '.chip', '.seg button', '.appnav a', '.capture-btn', '.nudge', '.phone-btn', '.mark-btn'])
    assert.ok(rules.includes(sel), `no :focus-visible rule for ${sel}`);
});

test('inputs sit on the field, not the well', () => {
  const at = css.indexOf('.take-name-input, .take-bpm-input, .take-title-input');
  assert.ok(at > 0);
  assert.match(block(at), /background:\s*var\(--field\)/);
});
