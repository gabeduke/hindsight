// web/static/lib/play/styles.test.js
// The instrument strip's CSS (styles.css, "Rooms P3") reaches only the
// strip, and is drawn in the pad controller's materials. It's behind
// hindsight.play, but styles.css is on every page of every kit: a bare rule
// here would restyle the kits that never turned it on (AGENTS.md, CSS), and
// a token that follows the scheme would turn the instrument pale at noon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

function block(name) {
  const start = css.indexOf(`/* ---------- Rooms ${name}:`);
  assert.ok(start >= 0, `the Rooms ${name} block`);
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  return css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
}
// P3's strip, and P4's FX and mods drawn into it.
const blocks = () => block('P3') + block('P4');
const p3Block = blocks;

test('every rule in the strip’s blocks (P3, P4) hangs off a play- class', () => {
  const loose = [];
  for (const m of p3Block().matchAll(/([^{}]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue;
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
      if (!/\.play-[a-z0-9-]+/.test(sel)) loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'these could match something that is not the strip');
});

test('the strip is drawn in its own materials, the same in both schemes', () => {
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const open = css.indexOf('{', darkAt);
  let depth = 0, end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const scheme = new Set([...css.slice(open, end).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const offenders = [];
  for (const m of p3Block().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const v of m[2].matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (scheme.has(v[1])) offenders.push(`${m[1].trim()}: ${v[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'these follow the scheme; use a --pad- material from objects.css');
});

test('the overlay is gone: no full-screen sheet, and no rule locks the page', () => {
  assert.doesNotMatch(css, /\.play-mode\b/);
  assert.doesNotMatch(css, /\.play-enter\b/);
  assert.doesNotMatch(css, /body\.play-open/);
});

test('a laptop’s height keeps two lanes in sight while the strip is unfolded', () => {
  // At 1440 × 790 (a 900-px laptop's real window) the unfolded strip and the
  // feed once left no lane at all, so the track keys dropped out tracks no
  // one could see. Under 1000 px tall the strip is compact and the feed
  // folds to its keys; the browser check measures the lanes
  // (docs/superpowers/plans/2026-10-15-p3-strip.md, Look).
  const block = p3Block();
  const at = block.search(/@media[^{]*\(max-height: 1000px\)/);
  assert.ok(at >= 0, 'a block for a laptop’s height');
  let depth = 0, end = block.indexOf('{', at);
  for (; end < block.length; end++) {
    if (block[end] === '{') depth++;
    else if (block[end] === '}' && --depth === 0) break;
  }
  const rules = block.slice(at, end);
  assert.match(rules, /body\.play-unfolded \.studio-feed > \.viz-wrap \{ display: none; \}/);
  assert.match(rules, /\.play-tracks \.play-track \{ min-height: (\d+)px/);
  assert.ok(Number(/\.play-tracks \.play-track \{ min-height: (\d+)px/.exec(rules)[1]) <= 48, 'short track keys');
});

test('at a laptop’s height the FX and the mods go up beside the tracks, not beside the tricks', () => {
  // P4's one-row grid (min-width: 1100px) once overrode P3's compact one:
  // at 1280–1440 wide and under 1000 tall the tricks and the bus were
  // crushed into one column, ½× and 2× 24 px wide and KEEP under the FX.
  // So inside P4's laptop-height block the tricks' row spans every column
  // after the reel, and the FX and the mods sit in the first row. The
  // browser check measures the pads (the P4 plan, Look).
  const p4 = block('P4');
  const at = p4.search(/@media \(min-width: 1100px\) and \(min-height: 441px\) and \(max-height: 1000px\)/);
  assert.ok(at >= 0, 'P4 has a block for a laptop’s height');
  let depth = 0, end = p4.indexOf('{', at);
  for (; end < p4.length; end++) {
    if (p4[end] === '{') depth++;
    else if (p4[end] === '}' && --depth === 0) break;
  }
  const rules = p4.slice(at, end);
  assert.match(rules, /\.play-body:has\(> \.play-slot-fx:not\(\[hidden\]\)\) > \.play-side \{ grid-column: 2 \/ -1; grid-row: 2; \}/);
  assert.match(rules, /\.play-slot-fx:not\(\[hidden\]\) \{ grid-column: 3; grid-row: 1; \}/);
  assert.match(rules, /\.play-slot-mods:not\(\[hidden\]\) \{ grid-column: 4; grid-row: 1; \}/);
  // And it comes after the one-row grid, so it wins where both apply.
  assert.ok(at > p4.search(/@media \(min-width: 1100px\) \{/), 'after the one-row grid');
});
