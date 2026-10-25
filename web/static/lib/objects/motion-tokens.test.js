import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decls, fileCss, rules, tokens } from '../stylesheets.js';
import { T, EASES, SPRINGS, springEasing } from './motion.js';
import { BEGIN, END, CSS_SPRINGS, TRAVEL, curveOf, gap, motionCss } from './motion-css.js';

// The motion tokens are motion.js's numbers, carried by styles.css for the
// CSS to use. They drift apart the quiet way -- a time changed in one and
// not the other moves nothing that fails -- so this fails instead, and says
// to run the script that writes them.
const css = fileCss('styles.css');
const objects = fileCss('objects.css');
const light = tokens(css);
const RUN = 'run `node scripts/motion-tokens.mjs --write`';
const ms = (v) => (/^(-?[\d.]+)ms$/.exec(v) || [])[1];
const pts = (v) => /cubic-bezier\(([^)]+)\)/.exec(v)[1].split(',').map(Number);

/** The :root rules inside exactly these at-rules, as {token: value}. */
function rootIn(...at) {
  const out = {};
  for (const r of rules(css)) {
    if (r.sel.length !== 1 || r.sel[0] !== ':root' || r.at.join(' / ') !== at.join(' / ')) continue;
    for (const d of decls(r.body)) if (d.prop.startsWith('--')) out[d.prop] = d.value;
  }
  return out;
}
const SUPPORTS = '@supports not (transition-timing-function: linear(0, 1))';
const LESS = '@media (prefers-reduced-motion: reduce)';

test('the times in styles.css are motion.js’s', () => {
  for (const [k, v] of Object.entries(T)) assert.equal(ms(light[`--t-${k}`]), String(v), `--t-${k}: ${RUN}`);
});

test('the eases in styles.css are motion.js’s', () => {
  for (const [k, v] of Object.entries(EASES)) assert.deepEqual(pts(light[`--ease-${k}`]), [...v], `--ease-${k}: ${RUN}`);
});

test('each spring CSS plays is motion.js’s, with its own time', () => {
  for (const name of CSS_SPRINGS) {
    const { duration, easing } = springEasing(SPRINGS[name]);
    assert.equal(light[`--spring-${name}`], easing, `--spring-${name}: ${RUN}`);
    assert.equal(ms(light[`--t-spring-${name}`]), String(duration), `--t-spring-${name}: ${RUN}`);
  }
});

test('the block between the markers is the script’s, word for word', () => {
  const from = css.indexOf(BEGIN), to = css.indexOf(END);
  assert.ok(from >= 0 && to > from, `styles.css should carry the generated block: ${RUN}`);
  assert.equal(css.slice(from, to + END.length), motionCss(), RUN);
});

test('a browser without linear() gets a cubic-bézier near each spring', () => {
  const fallback = rootIn(SUPPORTS);
  for (const name of CSS_SPRINGS) {
    const v = fallback[`--spring-${name}`];
    assert.ok(v, `--spring-${name} has a fallback`);
    // Near enough to read as the same move: within 5% of the way, all along.
    assert.ok(gap(pts(v), curveOf(SPRINGS[name])) < 0.05, `--spring-${name}'s fallback strays`);
  }
});

test('less motion zeroes what travels, in one block, and leaves the fades', () => {
  const less = rootIn(LESS);
  for (const k of TRAVEL) assert.equal(ms(less[`--t-${k}`]), '0', `--t-${k} is 0 with less motion`);
  for (const name of CSS_SPRINGS) assert.equal(ms(less[`--t-spring-${name}`]), '0');
  for (const k of ['touch', 'exit']) assert.equal(less[`--t-${k}`], undefined, `--t-${k} is a fade, and stays`);
  // One place: no other :root block for less motion says a time again.
  const blocks = rules(css).filter((r) => r.sel.includes(':root') && r.at.some((a) => /prefers-reduced-motion/.test(a)));
  assert.equal(blocks.length, 1);
});

test('the motion tokens follow no scheme and are no material', () => {
  const names = Object.keys(light).filter((t) => /^--(t|ease|spring)-/.test(t));
  assert.ok(names.length >= Object.keys(T).length + Object.keys(EASES).length + 2 * CSS_SPRINGS.length);
  const dark = tokens(css, { scheme: 'dark', only: true });
  for (const t of names) {
    assert.ok(!(t in dark), `${t} has no dark value`);
    assert.ok(!objects.includes(`${t}:`), `${t} is not a material`);
  }
});

test('every time token a stylesheet uses is one styles.css defines', () => {
  const sheets = `${css}\n${objects}`;
  const used = new Set([...sheets.matchAll(/var\((--(?:t|ease|spring)-[a-z-]+)/g)].map((m) => m[1]));
  for (const t of used) assert.ok(t in light, `${t} is used and never defined`);
});
