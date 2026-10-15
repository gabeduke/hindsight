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
