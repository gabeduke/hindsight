import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFold, setOpen, setTarget, FOLD, OPEN, TARGET } from './fold.js';

// A body that is only its class list: anything else touched -- a lane, its
// canvas, a size, a style -- throws. Folding the lanes must be a class, and
// never a reflow of the lanes' bitmaps from script (the drawers' lesson:
// lib/tape/page.js sizes each bitmap from its box when it draws).
function onlyClasses() {
  const calls = [];
  const classList = new Proxy({}, {
    get: (_, k) => {
      if (k !== 'toggle') throw new Error(`classList.${String(k)} touched`);
      return (c, on) => calls.push([c, on]);
    },
  });
  const body = new Proxy({}, {
    get: (_, k) => {
      if (k === 'classList') return classList;
      throw new Error(`body.${String(k)} touched`);
    },
  });
  return { body, calls };
}

test('folding the lanes is a class on the body, and touches nothing else', () => {
  const { body, calls } = onlyClasses();
  setFold(body, true);
  setFold(body, false);
  setOpen(body, true);
  assert.deepEqual(calls, [[FOLD, true], [FOLD, false], [OPEN, true]]);
  assert.equal(FOLD, 'buffer-fold');
  assert.equal(OPEN, 'buffer-open');
});

test('the lane under a drag opens by a class on its row alone', () => {
  const rows = [1, 2, 3].map(() => onlyClasses());
  setTarget(rows.map((r) => r.body), rows[1].body);
  assert.deepEqual(rows.map((r) => r.calls), [[[TARGET, false]], [[TARGET, true]], [[TARGET, false]]]);
});

test('the folded lanes’ rules change heights and nothing else', () => {
  // The CSS side of the same promise: under the fold, a lane's row, its
  // head and its canvas only get shorter. A width, a grid column or a
  // position there would move the lane's x axis under the playhead and its
  // clips: a reflow, not a fold.
  const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* ---------- Rooms P2:');
  assert.ok(start >= 0, 'the Rooms P2 block');
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  const body = css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
  const HEIGHTS = new Set(['height', 'min-height', 'max-height', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
    'overflow', 'overflow-y', 'transition', 'align-content', 'align-self', 'gap', 'row-gap', 'padding-block', 'opacity']);
  const offenders = [];
  let folded = 0;
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/\.buffer-fold\b/.test(sel) || !/\.(tape-track|tt-lane|tt-head|tape-lanes)\b/.test(sel)) continue;
    folded++;
    for (const d of m[2].split(';').map((x) => x.trim()).filter(Boolean)) {
      const prop = d.slice(0, d.indexOf(':')).trim();
      if (!HEIGHTS.has(prop)) offenders.push(`${sel} { ${d} }`);
    }
  }
  assert.ok(folded > 0, 'no folded lane rules found');
  assert.deepEqual(offenders, [], 'a fold that changes more than heights reflows the lanes');
});
