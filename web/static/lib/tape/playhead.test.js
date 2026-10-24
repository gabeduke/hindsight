import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heardAt, layer, blit, paintHead, compositeLane, headBand, bandFor, still } from './playhead.js';
import { paintTapeOverview, paintOverviewHead } from './overview.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const tape = { sample_rate: SR, length: SR * 1200, loop: { on: true, in: SR * 2, out: SR * 12 } };

test('the playhead runs on from the last poll at the tape’s rate, half a second at most', () => {
  const live = { playing: true, heard: SR * 4 };
  assert.equal(heardAt(tape, live, 1000, 1000), SR * 4);
  assert.equal(heardAt(tape, live, 1000, 1100), SR * 4 + SR / 10);
  assert.equal(heardAt(tape, live, 1000, 5000), SR * 4 + SR / 2, 'a poll that is late does not run it away');
  assert.equal(heardAt(tape, live, 1000, 900), SR * 4, 'nor back');
});

test('it goes round the loop as the engine does, and stays put stopped or counting in', () => {
  const live = { playing: true, heard: SR * 11.9 };
  assert.equal(heardAt(tape, live, 1000, 1200), SR * 2.1);
  assert.equal(heardAt({ ...tape, loop: { ...tape.loop, on: false } }, live, 1000, 1200), SR * 12.1, 'the loop off: on past its Out');
  assert.equal(heardAt(tape, { playing: true, heard: SR * 13 }, 1000, 1200), SR * 13.2, 'past the loop already: on');
  assert.equal(heardAt(tape, { playing: false, heard: SR * 4 }, 1000, 1200), SR * 4);
  assert.equal(heardAt(tape, { playing: true, count_in: 2, heard: SR * 4 }, 1000, 1200), SR * 4);
  assert.equal(heardAt({ ...tape, length: SR * 4 + 10, loop: { on: false } }, { playing: true, heard: SR * 4 }, 1000, 1400), SR * 4 + 10, 'never past the end');
  assert.equal(heardAt(tape, null, 1000, 1200), 0);
});

// A 2D context that writes down what is done to it, and has nothing else:
// no layout, no style, no reading back.
function recorder(width = 800, height = 70) {
  const ops = [];
  const ctx = { canvas: { width, height }, ops };
  for (const m of ['setTransform', 'clearRect', 'drawImage', 'fillRect', 'strokeRect', 'save', 'restore', 'beginPath', 'rect', 'clip', 'moveTo', 'lineTo', 'closePath', 'stroke', 'setLineDash']) {
    ctx[m] = (...a) => ops.push([m, ...a]);
  }
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalCompositeOperation']) {
    let v;
    Object.defineProperty(ctx, p, { get: () => v, set: (x) => { v = x; ops.push([`${p}=`, x]); } });
  }
  return ctx;
}

test('a frame is the two layers and the playhead: the same few calls however much is on the lane', () => {
  const lit = { id: 'lit', width: 800, height: 70 }, unlit = { id: 'unlit', width: 800, height: 70 };
  const ctx = recorder(800, 70);
  compositeLane(ctx, { lit, unlit }, 300.4, { W: 800, H: 70, dpr: 1, accent: '#cb4b16' });
  const names = ctx.ops.map((o) => o[0]);
  assert.deepEqual(names.filter((n) => n === 'drawImage').length, 2, 'two blits');
  assert.ok(names.length <= 24, `a fixed handful of calls, not a lane's drawing (${names.length})`);
  // Lit left of the playhead, unlit right of it, added at the pixel it splits.
  const clips = ctx.ops.filter((o) => o[0] === 'rect');
  assert.deepEqual(clips, [['rect', 0, 0, 300.4, 70], ['rect', 300.4, 0, 800 - 300.4, 70]]);
  const blits = ctx.ops.filter((o) => o[0] === 'drawImage').map((o) => o[1].id);
  assert.deepEqual(blits, ['lit', 'unlit']);
  assert.ok(ctx.ops.some((o) => o[0] === 'globalCompositeOperation=' && o[1] === 'lighter'));
  // The playhead where the lane drew it: 2 px from the rounded x.
  assert.deepEqual(ctx.ops.filter((o) => o[0] === 'fillRect').at(-1), ['fillRect', 300, 0, 2, 70]);
});

test('the cut is in device pixels on a dense screen, and a playhead off the lane draws none', () => {
  const L = (w, h) => ({ width: w, height: h });
  const ctx = recorder(1600, 140);
  compositeLane(ctx, { lit: L(1600, 140), unlit: L(1600, 140) }, 120.25, { W: 800, H: 70, dpr: 2, accent: '#c00' });
  assert.deepEqual(ctx.ops.filter((o) => o[0] === 'rect')[0], ['rect', 0, 0, 240.5, 140]);
  const off = recorder();
  compositeLane(off, { lit: L(800, 70), unlit: L(800, 70) }, -40, { W: 800, H: 70, dpr: 1, accent: '#c00' });
  assert.equal(off.ops.filter((o) => o[0] === 'fillRect').length, 0);
  assert.deepEqual(off.ops.filter((o) => o[0] === 'drawImage').length, 1, 'all of it unlit');
  const none = recorder();
  compositeLane(none, { lit: L(800, 70), unlit: L(800, 70) }, null, { W: 800, H: 70, dpr: 1, accent: '#c00' });
  assert.equal(none.ops.filter((o) => o[0] === 'fillRect').length, 0, 'no live state: no playhead');
});

test('a locate not yet heard is drawn over the playhead, dashed', () => {
  const ctx = recorder();
  compositeLane(ctx, { lit: { width: 800, height: 70 }, unlit: { width: 800, height: 70 } }, 300, { W: 800, H: 70, dpr: 1, accent: '#c00', ghostX: 500.2 });
  const at = ctx.ops.findIndex((o) => o[0] === 'setLineDash' && o[1].length);
  assert.ok(at > ctx.ops.findIndex((o) => o[0] === 'fillRect' && o[1] === 300), 'after the playhead');
  assert.ok(ctx.ops.some((o) => o[0] === 'moveTo' && o[1] === 500.5));
});

test('blit and paintHead put a layer back pixel for pixel and the playhead on it', () => {
  const ctx = recorder(400, 26);
  const base = { id: 'base', width: 400, height: 26 };
  blit(ctx, base);
  assert.deepEqual(ctx.ops.slice(0, 3), [['setTransform', 1, 0, 0, 1, 0, 0], ['clearRect', 0, 0, 400, 26], ['drawImage', base, 0, 0]]);
  const h = recorder();
  paintHead(h, 801, 800, 26, '#c00');
  assert.equal(h.ops.length, 0, 'off the end: none');
  paintHead(h, 0, 800, 26, '#c00');
  assert.deepEqual(h.ops.at(-1), ['fillRect', 0, 0, 2, 26]);
});

test('a canvas with no size, folded away or hidden on this screen, is put back as nothing, not an error', () => {
  // drawImage throws on a canvas 0 wide or high: the Studio's lanes folded,
  // and the ruler on a phone, are.
  const empty = { width: 0, height: 0 };
  const ctx = recorder(0, 0);
  blit(ctx, empty);
  compositeLane(ctx, { lit: empty, unlit: empty }, 10, { W: 0, H: 0, dpr: 1, accent: '#c00' });
  assert.equal(ctx.ops.filter((o) => o[0] === 'drawImage').length, 0);
});

// What one device pixel column of a lane shows with the playhead at `x`
// (CSS pixels, at `dpr`): how much of it is the lit layer (the cut at x*dpr)
// and how much of it the playhead's 2 px line covers. Two columns that say
// the same are the same pixels (compositeLane).
function column(c, x, dpr, cw, layered = true) {
  if (x == null) return '0|0';
  const cut = Math.max(0, Math.min(cw, x * dpr));
  const lit = layered ? Math.max(0, Math.min(1, cut - c)) : 0;
  const h0 = Math.round(x) * dpr, h1 = (Math.round(x) + 2) * dpr;
  const head = Math.max(0, Math.min(c + 1, h1) - Math.max(c, h0));
  return `${lit.toFixed(6)}|${head.toFixed(6)}`;
}

test('a frame puts back only the columns the playhead moved over, and the canvas comes out as if all of it were', () => {
  // The playhead's moves, frame by frame: on at a crawl and at a run, round
  // the loop, off either end and back, at the densities tablets have.
  // A lane is two layers cut at the playhead; the ruler and the overview
  // one picture with the line over it.
  for (const layered of [true, false]) {
    for (const dpr of [1, 1.5, 2, 2.625]) {
      const W = 400, cw = Math.round(W * dpr);
      const xs = [10, 10.4, 10.4, 10.45, 11.9, 12, 13.5, 40, 41.2, 399.3, 401, 405, 2.2, -3, -1, 0.4, 250.75, 251.1, 120, 119.5, 300];
      const shown = Array.from({ length: cw }, (_, c) => column(c, xs[0], dpr, cw, layered));
      let was = xs[0];
      for (const x of xs.slice(1)) {
        const band = headBand(was, x, dpr, cw, layered);
        const where = `${layered ? 'a lane' : 'the ruler'} at ${dpr}x, ${was} -> ${x}`;
        assert.ok(band && Number.isInteger(band.from) && Number.isInteger(band.to) && band.from >= 0 && band.to <= cw && band.from <= band.to, `whole columns on the canvas (${where})`);
        for (let c = band.from; c < band.to; c++) shown[c] = column(c, x, dpr, cw, layered);
        for (let c = 0; c < cw; c++) assert.equal(shown[c], column(c, x, dpr, cw, layered), `column ${c}, ${where}`);
        was = x;
      }
    }
  }
});

test('a band is a few columns at play speed, and none when the playhead hasn’t moved', () => {
  assert.deepEqual(headBand(100.2, 101.7, 1, 800), { from: 99, to: 105 });
  assert.deepEqual(headBand(100.2, 101.7, 2, 1600), { from: 199, to: 209 });
  assert.ok(still(headBand(100.2, 100.2, 1, 800)), 'not moved: nothing to put back');
  assert.ok(!still(headBand(100.2, 100.3, 2, 1600)), 'a lane\u2019s cut moved a fifth of a device pixel: put back');
  assert.ok(still(headBand(100.2, 100.4, 2, 1600, false)), 'the ruler\u2019s line hasn\u2019t moved a pixel: nothing');
  assert.ok(still(headBand(900, 950, 1, 800)), 'off the end both times: nothing changes');
  assert.ok(!still(null), 'all of it is not nothing');
  assert.equal(headBand(null, 10, 1, 800), null, 'the playhead come: all of it');
  assert.equal(headBand(10, null, 1, 800), null, 'and gone');
  assert.ok(still(headBand(null, null, 1, 800)), 'none, and still none: nothing');
});

test('a band is put back only over the picture the canvas already shows', () => {
  const ly = {}, other = {};
  const was = { pic: ly, x: 100.2, gx: null };
  assert.deepEqual(bandFor(was, { pic: ly, x: 101.7, gx: null }, 1, 800), headBand(100.2, 101.7, 1, 800));
  assert.equal(bandFor(null, { pic: ly, x: 101.7, gx: null }, 1, 800), null, 'nothing put back yet');
  assert.equal(bandFor(was, { pic: other, x: 101.7, gx: null }, 1, 800), null, 'the layers painted again: a part moved, the view paged');
  assert.equal(bandFor(was, { pic: ly, x: 101.7, gx: 300 }, 1, 800), null, 'a locate came');
  assert.equal(bandFor({ ...was, gx: 300 }, { pic: ly, x: 101.7, gx: null }, 1, 800), null, 'and went');
  assert.equal(bandFor({ pic: 3, x: 5, gx: null }, { pic: 4, x: 5, gx: null }, 1, 800), null, 'the ruler painted again');
});

test('a band frame draws in its columns only', () => {
  const L = (w, h) => ({ width: w, height: h });
  const ctx = recorder(800, 70);
  const band = headBand(300.1, 301.6, 1, 800);
  compositeLane(ctx, { lit: L(800, 70), unlit: L(800, 70) }, 301.6, { W: 800, H: 70, dpr: 1, accent: '#c00', ghostX: 500.2, band });
  assert.deepEqual(ctx.ops.find((o) => o[0] === 'clearRect'), ['clearRect', band.from, 0, band.to - band.from, 70]);
  const rects = ctx.ops.filter((o) => o[0] === 'rect');
  assert.equal(rects.length, 3, 'the lit part, the unlit part, and the marks');
  for (const [, x, , w] of rects) assert.ok(x >= band.from && x + w <= band.to + 1e-9, `a clip inside the band (${x}+${w})`);
  // The playhead and the locate's line are drawn under the band's clip: the
  // line, where it's outside the band, is already there, and drawn twice an
  // antialiased line darkens.
  const clipAt = ctx.ops.findLastIndex((o) => o[0] === 'clip');
  assert.ok(ctx.ops.findIndex((o) => o[0] === 'fillRect') > clipAt && ctx.ops.findIndex((o) => o[0] === 'stroke') > clipAt);
  const none = recorder(800, 70);
  compositeLane(none, { lit: L(800, 70), unlit: L(800, 70) }, 950, { W: 800, H: 70, dpr: 1, accent: '#c00', band: headBand(900, 950, 1, 800) });
  assert.equal(none.ops.filter((o) => o[0] === 'drawImage').length, 0, 'off the end and still: nothing put back');
  const b = recorder(400, 26);
  blit(b, { width: 400, height: 26 }, { from: 40, to: 47 });
  assert.deepEqual(b.ops.filter((o) => o[0] === 'drawImage').map((o) => o.slice(2)), [[40, 0, 7, 26, 40, 0, 7, 26]], 'the ruler and the overview: the band, copied');
});

test('a layer is reused at its size, and resized when the canvas is', () => {
  const made = [];
  const make = () => { const c = { width: 0, height: 0 }; made.push(c); return c; };
  const a = layer(null, 300, 70, make);
  assert.deepEqual([a.width, a.height], [300, 70]);
  assert.equal(layer(a, 300, 70, make), a);
  assert.equal(layer(a, 320, 70, make).width, 320);
  assert.equal(made.length, 1);
});

test('the overview’s playhead drawn on its own is the one it always drew', () => {
  const t = { length: SR * 60, loop: { in: 0, out: SR * 10, on: true }, tracks: [{ n: 1, clips: [{ at: 0, frames: SR * 10 }] }] };
  const col = (n, d) => d;
  const whole = recorder(600, 40);
  paintTapeOverview(whole, 600, 40, t, SR * 15, { col });
  const base = recorder(600, 40);
  paintTapeOverview(base, 600, 40, t, null, { col });
  paintOverviewHead(base, 600, 40, t, SR * 15, col);
  assert.deepEqual(base.ops, whole.ops);
  assert.deepEqual(whole.ops.at(-1), ['fillRect', 150, 0, 2, 40]);
});

// --- the guard ----------------------------------------------------------------
// The Studio dropped to 18 fps on a tablet while the tape played: every
// frame redrew the four lanes, the ruler and the overview, and wrote each
// lane's head before measuring its canvas, a forced layout a frame. What a
// frame does now is put painted pictures back. This walks what the
// playhead's step on the ticker calls, in page.js and the modules it draws
// with, and fails if any of it measures, reads style, writes the page, or
// paints a lane.

function bodies(src) {
  // Top-level declarations: `function f(`, `async function f(`, `export
  // function f(`, or `const f = (...) =>`, each up to the `}` that closes it
  // at the start of a line (or, for a one-line const, its own line).
  const lines = src.split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:export )?(?:async )?function (\w+)\(/.exec(lines[i]) || /^(?:export )?const (\w+) = (?:async )?(?:\([^)]*\)|\w+) =>/.exec(lines[i]);
    if (!m) continue;
    let j = i;
    if (!/^(?:export )?const /.test(lines[i]) || !/;\s*$/.test(lines[i])) {
      while (j < lines.length && !/^[)}]/.test(lines[j]) ) j++;
    }
    out.set(m[1], lines.slice(i, j + 1).join('\n'));
  }
  return out;
}

const strip = (s) => s.replace(/\/\/.*$/gm, '');

function calls(body) {
  return [...strip(body).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

// Reached only on a condition the step checks first, never as a frame's
// routine: a page turn repaints once (repaintView), and a mute or solo
// pressed on this phone rewrites the heads when it is heard (syncLaneRows).
const RARE = {
  repaintView: /if \(!lanesFresh\(view\)\) repaintView\(h\);/,
  syncLaneRows: /if \(lane\.pendingShown && !pending\.pending\(lane\.n, now\)\) \{ syncLaneRows\(/,
};
const FORBIDDEN = [
  [/getBoundingClientRect|getComputedStyle|offset(Width|Height|Top|Left)\b|client(Width|Height)\b|scroll(Width|Height|Top)\b/, 'measures layout or reads style'],
  [/textContent\s*=|innerHTML|setAttribute\(|classList\.|\.style\.|\.hidden\s*=|\.title\s*=/, 'writes the page'],
  [/\b(drawLanes|lanesDraw|refreshLanes|paintLane|drawRuler|drawOverview|drawSections|paintTapeOverview|render|getImageData)\(/, 'paints, rather than putting a picture back'],
];

function frameWork() {
  const page = fs.readFileSync(path.join(HERE, 'page.js'), 'utf8');
  const start = page.indexOf('const playheadLoop = new Loop(');
  assert.ok(start >= 0, 'page.js steps the playhead with a Loop');
  let depth = 0, end = start + 'const playheadLoop = new Loop'.length;
  for (; end < page.length; end++) {
    if (page[end] === '(') depth++;
    else if (page[end] === ')' && --depth === 0) break;
  }
  const step = page.slice(start, end + 1);
  const known = new Map([
    ...bodies(page),
    ...bodies(fs.readFileSync(path.join(HERE, 'playhead.js'), 'utf8')),
    ...['paintOverviewHead'].map((n) => [n, bodies(fs.readFileSync(path.join(HERE, 'overview.js'), 'utf8')).get(n)]),
  ]);
  const seen = new Map([['(the step)', step]]);
  const todo = calls(step);
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n) || !known.has(n) || n in RARE) continue;
    seen.set(n, known.get(n));
    todo.push(...calls(known.get(n)));
  }
  return { page, seen };
}

test('the playhead’s frame on the ticker measures nothing, writes nothing and paints no lane', () => {
  const { seen } = frameWork();
  for (const [name, body] of seen) {
    for (const [re, what] of FORBIDDEN) {
      const m = re.exec(strip(body));
      assert.equal(m, null, `${name}, which the playhead's frame calls, ${what}: ${m && m[0]}`);
    }
  }
  assert.ok(seen.has('compositeLanes') && seen.has('compositeLane') && seen.has('heardNow'), `the walk reaches the frame's work (${[...seen.keys()].join(', ')})`);
});

test('what a frame repaints, it repaints only when it must, and says so where it calls it', () => {
  const { page, seen } = frameWork();
  for (const [name, guard] of Object.entries(RARE)) {
    const callers = [...seen].filter(([, b]) => new RegExp(`\\b${name}\\(`).test(strip(b)));
    assert.ok(callers.length, `${name} is still the frame's to call`);
    for (const [caller, body] of callers) assert.match(body, guard, `${caller} calls ${name} only behind its check`);
  }
  assert.ok(page.includes('function lanesFresh(view)'));
});
