// web/static/lib/objects/spin.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REEL, HUB, spinCell, blurFor } from './spin.js';

const STATIC = fileURLToPath(new URL('../../', import.meta.url)); // web/static
const REPO = join(STATIC, '..', '..');
const fileOf = (src) => join(STATIC, src.replace(/^\//, '').replace(/\?.*$/, ''));

test('a reel at any angle is its nearest cell, turned the rest of the way', () => {
  assert.deepEqual(spinCell(REEL, 0), { col: 0, row: 0, base: 0, rest: 0 });
  // Ten degrees a cell, four to a row.
  const c = spinCell(REEL, 14);
  assert.deepEqual([c.col, c.row, c.base], [1, 0, 10]);
  assert.ok(Math.abs(c.rest - 4) < 1e-9);
  const d = spinCell(REEL, 56);
  assert.deepEqual([d.col, d.row, d.base], [2, 1, 60]);
  assert.ok(Math.abs(d.rest + 4) < 1e-9);
  // The windows come round every 120 degrees, so 125 is 5, and -14 is 106.
  assert.deepEqual(spinCell(REEL, 125), spinCell(REEL, 5));
  const back = spinCell(REEL, -14);
  assert.deepEqual([back.col, back.row, back.base], [3, 2, 110]);
  assert.ok(Math.abs(back.rest + 4) < 1e-9);
  // Just short of a whole period is the first cell, turned back a little.
  const wrap = spinCell(REEL, 119);
  assert.deepEqual([wrap.col, wrap.row, wrap.base], [0, 0, 0]);
  assert.ok(Math.abs(wrap.rest + 1) < 1e-9);
  assert.deepEqual(spinCell(REEL, NaN), spinCell(REEL, 0));
});

test('the rest of the turn is never more than half a step: too little to carry the light round', () => {
  for (const [sheet, set] of [[REEL, 'still'], [REEL, 'blur'], [REEL, 'smear'], [HUB, 'still']]) {
    const { at, n } = sheet.sets[set];
    const half = sheet.period / n / 2;
    for (let a = -720; a <= 720; a += 0.7) {
      const c = spinCell(sheet, a, set);
      assert.ok(Math.abs(c.rest) <= half + 1e-9, `${set} ${a}: ${c.rest}`);
      const i = c.row * sheet.cols + c.col;
      assert.ok(i >= at && i < at + n, `${set} ${a}: cell ${i} is not one of the set's`);
      // The cell's angle and the rest come back to where the part is.
      const turned = (((c.base + c.rest - a) % sheet.period) + sheet.period) % sheet.period;
      assert.ok(turned < 1e-6 || sheet.period - turned < 1e-6, `${set} ${a}: lands at ${c.base + c.rest}`);
    }
  }
});

test('a reel winding is blurred, a reel playing never is', () => {
  // ReelMotion's fastest play: 45 radius units a second on the 17-unit hub.
  assert.equal(blurFor((45 / 17) * (180 / Math.PI)), 'still');
  assert.equal(blurFor(0), 'still');
  assert.equal(blurFor(undefined), 'still');
  assert.equal(blurFor(-900), 'blur', 'either way round');
  assert.equal(blurFor(36 * 60), 'blur', 'a frame turning it as far as the blur was rendered');
  assert.equal(blurFor(6000), 'smear');
});

// WebP's extended header: the canvas is 24-bit width-1 and height-1 at 24.
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  assert.equal(buf.toString('ascii', 12, 16), 'VP8X', 'a sheet with alpha has the extended header');
  return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
}

test('each sheet is the grid spin.js reads it as, and its address is its own hash', () => {
  const sw = readFileSync(join(STATIC, 'sw.js'), 'utf8');
  const shell = /SHELL\s*=\s*\[([\s\S]*?)\]/.exec(sw)[1];
  for (const sheet of [REEL, HUB]) {
    const buf = readFileSync(fileOf(sheet.src));
    assert.deepEqual(webpSize(buf), { w: sheet.cols * sheet.px, h: sheet.rows * sheet.px }, sheet.src);
    const used = Object.values(sheet.sets).reduce((m, s) => Math.max(m, s.at + s.n), 0);
    assert.ok(used <= sheet.cols * sheet.rows, `${sheet.src}: ${used} cells in a ${sheet.cols}×${sheet.rows} grid`);
    // A phone keeps a picture by its address: new pixels need a new one.
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    assert.equal(sheet.src.split('?v=')[1], hash, `${sheet.src} was rendered again: its ?v= is ${hash} now`);
    assert.ok(shell.includes(`'${sheet.src}'`), `sw.js's SHELL should have ${sheet.src}`);
  }
});

test('spools.py renders the sheets spin.js reads: the same grid, periods and sets', () => {
  const py = readFileSync(join(REPO, 'scripts', 'blender', 'spools.py'), 'utf8');
  for (const [name, sheet] of [['REEL', REEL], ['HUB', HUB]]) {
    const m = new RegExp(`^${name} = dict\\(([\\s\\S]*?)\\)\\n`, 'm').exec(py);
    assert.ok(m, `spools.py should define ${name}`);
    const num = (k) => Number(new RegExp(`\\b${k}=(\\d+)`).exec(m[1])?.[1]);
    for (const k of ['cell', 'px', 'cols', 'rows', 'period']) assert.equal(num(k), sheet[k], `${name}.${k}`);
    const sets = [...m[1].matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(([, at, n]) => ({ at: Number(at), n: Number(n) }));
    assert.deepEqual(sets, Object.values(sheet.sets).map(({ at, n }) => ({ at, n })), `${name}'s sets`);
  }
});
