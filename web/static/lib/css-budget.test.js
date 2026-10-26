// web/static/lib/css-budget.test.js
// A ratchet on the stylesheets, as scripts/flows/layout-known.json is on the
// layout: the counts of what makes CSS expensive to change, as they stood
// when this came in. A count may go down and never up. When one drops, the
// test says so and asks for its number here to be lowered with it, so the
// next change can't spend what the last one saved.
//
// What is counted, over every stylesheet the pages link:
//   hex     colours written as #hex outside the :root token blocks
//   rgba    rgb()/rgba() colours outside the :root token blocks (a
//           keyframe's included)
//   zIndex  distinct z-index numbers (a token is not a number)
//   important  !important declarations
//   media   distinct @media conditions
//   durations  times written into a transition or an animation, not tokens
//   weights    font-weights no @font-face has: the browser fakes them, or
//              takes the nearest face, and the two read differently
import test from 'node:test';
import assert from 'node:assert/strict';
import { cssOf, decls, rules, stripComments } from './stylesheets.js';

const BUDGET = {
  hex: 2,
  rgba: 94,
  zIndex: 22,
  important: 3,
  media: 51,
  durations: 46,
  weights: 3,
};

/** count is each of BUDGET's numbers for the CSS `css`. */
function count(css) {
  const all = rules(css, { keyframes: true });
  const tokenBlock = (r) => r.sel.length === 1 && r.sel[0] === ':root';
  const n = { hex: 0, rgba: 0, zIndex: 0, important: 0, media: 0, durations: 0, weights: 0 };
  const z = new Set();
  const faces = new Set();
  for (const m of stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    for (const d of decls(m[1])) if (d.prop === 'font-weight') for (const w of d.value.split(/\s+/)) faces.add(Number(w));
  }
  const weight = (w) => ({ normal: 400, bold: 700 })[w] ?? Number(w);
  for (const r of all) {
    for (const d of decls(r.body)) {
      if (d.important) n.important++;
      if (!(tokenBlock(r) && d.prop.startsWith('--'))) {
        n.hex += (d.value.match(/#[0-9a-f]{3,8}\b/gi) || []).length;
        n.rgba += (d.value.match(/\brgba?\(/gi) || []).length;
      }
      if (d.prop === 'z-index' && /^-?\d+$/.test(d.value)) z.add(d.value);
      if (/^(transition|animation)(-duration|-delay)?$/.test(d.prop)) {
        n.durations += (d.value.replace(/var\([^)]*\)/g, '').match(/(?<![\w.-])\d*\.?\d+m?s\b/g) || []).length;
      }
      const ws = d.prop === 'font-weight' ? [d.value]
        : d.prop === 'font' ? (/^(?:(?:italic|oblique|normal|small-caps)\s+)*(\d{3}|bold)\s/.exec(d.value) || []).slice(1) : [];
      for (const w of ws) if (!Number.isNaN(weight(w)) && !faces.has(weight(w))) n.weights++;
    }
  }
  n.zIndex = z.size;
  n.media = new Set(all.flatMap((r) => r.at.filter((a) => a.startsWith('@media')))).size;
  return n;
}

test('the counts are what they say', () => {
  const css = `@font-face { font-family: X; font-weight: 400; } @font-face { font-family: X; font-weight: 700; }
:root { --a: #fff; --b: rgba(0,0,0,.5); }
.a { color: #000; background: linear-gradient(#111, rgb(1 2 3)); z-index: 2; transition: color .2s, transform 120ms var(--ease); }
.b { z-index: 2; font: 600 12px X; animation: spin var(--t) linear; animation-delay: 1s; }
@media (min-width: 9px) { .c { z-index: var(--z); font-weight: bold; color: red !important; } }
@media (min-width: 9px) { .d { font-weight: 650; } }
@media (max-width: 9px) { .e { font: italic 300 1em X; } }`;
  assert.deepEqual(count(css), { hex: 2, rgba: 1, zIndex: 1, important: 1, media: 2, durations: 3, weights: 3 });
});

test('the stylesheets spend no more than they did', () => {
  const now = count(cssOf());
  const over = Object.keys(BUDGET).filter((k) => now[k] > BUDGET[k]).map((k) => `${k}: ${now[k]}, over its ${BUDGET[k]}`);
  const under = Object.keys(BUDGET).filter((k) => now[k] < BUDGET[k]);
  for (const k of under) {
    console.log(`css budget: ${k} is down to ${now[k]} from ${BUDGET[k]}. Lower BUDGET.${k} in web/static/lib/css-budget.test.js to ${now[k]}, so it stays down.`);
  }
  assert.deepEqual(over, [], 'these went up: use a token (or an existing z-index, condition, duration or weight) instead');
});
