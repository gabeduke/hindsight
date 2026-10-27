// web/static/lib/objects/bench.js
// The object bench: every object, every state, on one page.
//
// It exists so that "make the tapes more realistic" is a job someone can pick
// up. An object drawn alone, in all its states, at a size you choose and at a
// speed you can actually watch, can be replaced wholesale and judged. The
// same object only ever seen in situ -- on a page, in one state, at one size,
// on a phone pointed at a Pi -- can only be nudged.
//
// Nothing here is shipped UI. It imports the real objects at their real
// paths; if the bench and a page disagree, the page is right and the bench
// has a bug.
//
// It runs on a scene (lib/scene), the way R2 onward will draw everything:
// each object that moves -- a needle, a pair of reels, a cassette -- is a
// scene object whose state the bench sets, stepped by its model on the
// bench's ticker and drawn by the DOM renderer with the object's own
// drawer. The reference states are landed at once with one hand-step at
// dt = Infinity, as reduced motion would land them.

import { vuFace, vuScale, vuAngle, VU_SWING } from './vu.js';
import { CassetteFace } from './cassette.js';
import { ribbonColors, drawRibbon } from './ribbon-draw.js';
import { token } from '../theme.js';
import { reelsDrawer, levelFrac } from './reel-window.js';
import { Ticker } from './motion.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { DomRenderer } from '../scene/dom.js';
import { tapeCounter, tapeMarquee, takeCounter, takeMarquee } from './lcd.js';
import { drawGrease } from './grease.js';
import { drawPennant, drawPennantName } from './pennant.js';
import { outIcon, OUT_MODES, icon, ICONS } from '../ui/icons.js';
import { still, download } from './bench-still.js';
import { paintOxide, oxideColors } from '../wave/tape-strip.js';
import { PIN_H, RULER_H } from '../wave/view.js';

const SVG = 'http://www.w3.org/2000/svg';
const NEEDLE_CX = 80, NEEDLE_CY = 112, NEEDLE_R = 80;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/** section is a titled block with a line saying what it is for. */
function section(root, title, note) {
  const s = el('section', 'bench-section');
  s.append(el('h2', null, title));
  if (note) s.append(el('p', 'bench-note', note));
  const grid = el('div', 'bench-grid');
  s.append(grid);
  root.append(s);
  return grid;
}

/** cell is one object with its state name under it. */
function cell(grid, name) {
  const c = el('div', 'bench-cell');
  const body = el('div', 'bench-body');
  c.append(body, el('span', 'bench-label', name));
  grid.append(c);
  return body;
}

/**
 * canvasCell is a canvas as wide as its cell, drawn by draw(ctx, W, H) at
 * the device's pixel ratio -- and drawn again when the cell's width changes
 * or the marker font arrives, so a cell is never a stretched picture of
 * another size.
 */
function canvasCell(body, H, draw) {
  const canvas = el('canvas', 'bench-canvas');
  canvas.style.height = `${H}px`;
  body.append(canvas);
  const paint = () => {
    const W = Math.round(canvas.getBoundingClientRect().width);
    if (!W) return;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // no 2d context (a test runner): the cell stays blank
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, W, H);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(paint).observe(canvas);
  else paint();
  globalThis.document?.fonts?.load?.('18px "Permanent Marker"').then(paint, () => {});
  return canvas;
}

/** A VU face with one needle, for the motion comparison. */
function needleFace(parent) {
  const scale = vuScale();
  const svg = svgEl('svg', { class: 'vu-face', viewBox: '0 0 160 96', 'aria-hidden': 'true' });
  svg.append(
    svgEl('path', { class: 'vu-ink', d: scale.arc }),
    svgEl('path', { class: 'vu-red vu-red-arc', d: scale.redArc }),
    svgEl('path', { class: 'vu-ink', d: scale.ticks }),
    svgEl('path', { class: 'vu-red', d: scale.redTicks }),
  );
  const needle = svgEl('g', { class: 'vu-needle' });
  needle.append(svgEl('line', { x1: NEEDLE_CX, y1: NEEDLE_CY, x2: NEEDLE_CX, y2: NEEDLE_CY - NEEDLE_R - 6 }));
  svg.append(needle, svgEl('rect', { class: 'vu-base', x: 0, y: 86, width: 160, height: 10 }));
  parent.append(svg);
  return needle;
}

/** A bare reel, sized for the bench rather than for the bar. */
function reelPair(parent) {
  const left = svgEl('svg', { class: 'np-reel bench-reel', viewBox: '0 0 160 160', 'aria-hidden': 'true' });
  const right = svgEl('svg', { class: 'np-reel bench-reel', viewBox: '0 0 160 160', 'aria-hidden': 'true' });
  const levels = el('span', 'np-levels');
  const row = el('div', 'bench-reels');
  row.append(left, levels, right);
  parent.append(row);
  return { left, right, levels };
}

export function mount(root, { raf, cancel, now, reduced } = {}) {
  // The bench drives its own clock so the speed control can slow everything
  // at once. Real time still passes; the objects are handed less of it.
  let scale = 1;
  let virtual = 0;
  let wall = (now || (() => performance.now()))();
  const clock = () => {
    const t = (now || (() => performance.now()))();
    virtual += (t - wall) * scale;
    wall = t;
    return virtual;
  };
  // Two clocks at the bench's speed. The Motion section's ignores reduced
  // motion deliberately: it is the comparison of two movements, and the
  // speed control is the accessible way to look at it. Everything else is
  // on one that honours the device, as the pages are -- so with reduced
  // motion the reels jump rather than turn, as they always did here.
  const ticker = new Ticker({ raf, cancel, now: clock, reduced: false });
  const device = new Ticker({ raf, cancel, now: clock, reduced });
  const motion = new Scene({ ticker });
  const motionRenderer = new DomRenderer();
  motionRenderer.mount(root, motion);
  const scene = new Scene({ ticker: device });
  const renderer = new DomRenderer();
  renderer.mount(root, scene);
  const bench = { scene, renderer, ticker, clock };

  // The bench's own controls, in one row: left out of a still.
  const tools = el('div', 'bench-tools');
  root.append(tools);
  buildSpeed(tools, (s) => { clock(); scale = s; });
  buildSize(tools, root);
  buildStill(tools, root);
  buildMotion(root, { scene: motion, renderer: motionRenderer, ticker });
  buildVu(root, bench);
  buildReels(root, bench);
  buildCassettes(root, bench);
  // Land every reference state now, and draw it, before the first frame;
  // then the scenes run on the bench's clocks. The bench's own steps (the
  // motion section's level, the running reel's polls) are on the motion
  // clock, added first, so each frame the models see what the bench set in
  // it.
  motion.step(Infinity, clock());
  scene.step(Infinity, clock());
  motion.start();
  scene.start();
  buildRibbon(root);
  buildLcd(root);
  buildGrease(root);
  buildPennants(root);
  buildMaskingTape(root);
  buildIcons(root);
  return ticker;
}

function buildSpeed(root, onPick) {
  const bar = el('div', 'bench-speed');
  bar.append(el('span', 'bench-note', 'Speed'));
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Speed');
  [['1×', 1], ['¼×', 0.25], ['⅒×', 0.1]].forEach(([label, s], i) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => {
      for (const k of group.querySelectorAll('button')) k.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onPick(s);
    });
    group.append(b);
  });
  bar.append(group);
  root.append(bar);
}

/**
 * The widths an object is checked at, named for where they come from: the
 * width the cassette is drawn at in Takes on a 390 px phone, on an 820 px
 * tablet held upright, and on the deck -- a 1280 px desktop, where the
 * cassette shares the screen with the shelf and so is narrower than on the
 * tablet.
 */
export const BENCH_SIZES = [['phone', 358], ['tablet', 788], ['deck', 654]];

/**
 * buildSize is the size slider: every cell's object at one width, so an
 * object is judged at the size it will be seen at rather than at whatever
 * the grid makes it. Objects that size to their container -- the cassette,
 * the ribbon, the LCD, the canvases -- redraw at it; ones with a fixed
 * size on the pages keep it here too, which is the honest answer.
 */
function buildSize(tools, root) {
  const bar = el('div', 'bench-speed');
  bar.append(el('span', 'bench-note', 'Size'));
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Size');
  const range = el('input', 'bench-range');
  range.type = 'range';
  range.min = '160';
  range.max = '1000';
  range.step = '2';
  range.value = String(BENCH_SIZES[0][1]);
  range.setAttribute('aria-label', 'Width of each object, in CSS pixels');
  const readout = el('span', 'bench-label');
  readout.setAttribute('aria-live', 'polite');

  const keys = [['Auto', 0], ...BENCH_SIZES.map(([n, w]) => [n[0].toUpperCase() + n.slice(1), w])].map(([label, w]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.addEventListener('click', () => set(w));
    group.append(b);
    return [b, w];
  });
  function set(w) {
    if (w) {
      root.dataset.w = String(w);
      root.style.setProperty('--bench-w', `${w}px`);
      range.value = String(w);
    } else {
      delete root.dataset.w;
      root.style.removeProperty('--bench-w');
    }
    const named = BENCH_SIZES.find(([, x]) => x === w);
    readout.textContent = !w ? 'as wide as the grid makes each' : `${w} px${named ? `, ${named[0]}` : ''}`;
    for (const [b, x] of keys) b.setAttribute('aria-pressed', String(x === w));
  }
  range.addEventListener('input', () => set(Number(range.value)));
  bar.append(group, range, readout);
  tools.append(bar);
  set(0);
}

/**
 * buildStill is the still button: the bench as it is on screen -- this
 * scheme, this size, the needles where they are -- as a PNG to download,
 * so two versions of an object can be put side by side after one of them
 * has gone. Its file is named for the scheme and the width.
 */
function buildStill(tools, root) {
  const bar = el('div', 'bench-speed');
  const group = el('div', 'seg');
  const button = el('button', null, 'Save a still');
  button.type = 'button';
  group.append(button);
  const note = el('span', 'bench-label bench-still-note');
  note.setAttribute('aria-live', 'polite');
  button.addEventListener('click', async () => {
    button.disabled = true;
    note.textContent = 'drawing…';
    try {
      const { blob, name } = await still(root, { skip: '.bench-tools' });
      download(blob, name);
      note.textContent = name.endsWith('.svg')
        ? `${name}: this browser would not hand the picture back as a PNG, so here it is as an SVG`
        : name;
    } catch (e) {
      note.textContent = `no still: ${e.message}`;
    } finally {
      button.disabled = false;
    }
  });
  bar.append(group, note);
  tools.append(bar);
}

/**
 * The motion section is the argument for motion.js, made visible: the same
 * step, driven two ways. The CSS needle is what the meters do today -- it
 * arrives and stops dead, which the eye reads as a bar that happens to be
 * rotating. The ballistic one overshoots a percent and settles, which is what
 * a moving-coil movement does and why it reads as a needle.
 */
function buildMotion(root, { scene, renderer, ticker }) {
  const grid = section(root, 'Motion',
    'The same step, driven two ways: the 140 ms CSS transition the meters used to have, and the ballistic movement they have now. Slow it to ⅒× to watch the overshoot.');

  const cssNeedle = needleFace(cell(grid, 'CSS transition, 140 ms — what it was'));
  cssNeedle.style.transition = 'transform 140ms cubic-bezier(.25, .8, .35, 1)';
  const ballNeedle = needleFace(cell(grid, 'ballistic: 300 ms to 99 %, 1 % overshoot — shipped'));

  cssNeedle.style.transform = `rotate(${-VU_SWING}deg)`;
  ballNeedle.style.transform = `rotate(${-VU_SWING}deg)`;

  // The shipped needle is a vu object, moved by the vu model; the CSS one is
  // the bench's own markup, as it was.
  const needle = scene.add(new SceneObject('motion:needle', 'vu'));
  renderer.part(needle.id, {
    draw: (view) => { ballNeedle.style.transform = `rotate(${view.angle.toFixed(2)}deg)`; },
  });

  // A step every two seconds, between the ends of the scale, forever: the
  // bench is for watching, so it doesn't need a play button. The bench is
  // the page here: it sets the level, and the model swings the needle.
  let next = 0, high = false;
  ticker.add((dt) => {
    next -= dt;
    if (next <= 0) {
      next = 2000;
      high = !high;
      const level = high ? -6 : -30;
      cssNeedle.style.transform = `rotate(${vuAngle(level).toFixed(1)}deg)`;
      needle.set({ level });
    }
    return true; // it is a loop; it always wants the next frame
  });
}

/** Every VU state, still, so a change to the face can be read off one screen. */
function buildVu(root, { scene, renderer }) {
  const grid = section(root, 'VU meter',
    'Levels in dBFS, 0 VU at −18. The peak lamp is held for 700 ms after a clip, shown here as its lit state.');

  // Chosen to land on the marks actually printed on the face, so a change to
  // the scale shows up as a needle that no longer points at its number.
  // 0 VU is the −18 dBFS line-up, so VU = dBFS + 18.
  // These cells are reference states, not an animation: mount() lands them
  // with one step at an infinite dt. The live needle is in the Motion
  // section above.
  const states = [
    ['silence (−∞)', -Infinity, false],
    ['−38 → −20 VU', -38, false],
    ['−28 → −10 VU', -28, false],
    ['−21 → −3 VU', -21, false],
    ['−18 → 0 VU', -18, false],
    ['−15 → +3 VU, peak lit', -15, true],
  ];
  for (const [name, db, peak] of states) {
    const meter = scene.add(new SceneObject(`vu:${name}`, 'vu', { level: db, peak }));
    renderer.part(meter.id, vuFace(cell(grid, name), 'L'));
  }
}

/** The reels at rest across the tape, plus one running. */
function buildReels(root, { scene, renderer, ticker, clock }) {
  const grid = section(root, 'Reels',
    'Pack radii across the length of a tape — area is conserved, so the packs fill and empty as real ones do.');

  const SR = 48000, LEN = 360 * SR;
  const stills = [['start', 0], ['quarter', 0.25], ['half', 0.5], ['three quarters', 0.75], ['end', 1]];
  for (const [name, frac] of stills) {
    const reels = scene.add(new SceneObject(`reels:${name}`, 'reels', { pos: frac * LEN, playing: false, length: LEN, sampleRate: SR, at: clock() }));
    renderer.part(reels.id, reelsDrawer(reelPair(cell(grid, name))));
  }

  // One running, polled on the bench clock so the speed control reaches it
  // -- the motion clock, so a poll comes every 200 ms even when the device
  // asks for less motion and the reels' own clock hands out dt = Infinity.
  const reels = scene.add(new SceneObject('reels:playing', 'reels', { pos: 0, playing: true, length: LEN, sampleRate: SR, at: clock() }));
  renderer.part(reels.id, reelsDrawer(reelPair(cell(grid, 'playing'))));
  let at = 0;
  ticker.add((dt) => {
    at += dt;
    // Re-poll as the page would, so it exercises the same path and never
    // runs away past AHEAD_S.
    if (at > 200) { at = 0; reels.set({ pos: reels.view.pos + 0.2 * SR, at: clock() }); }
    return true;
  });

  // One winding: it plays, and every two seconds jumps a minute on or back,
  // as a tap on the ruler or the loop coming round does. The reels wind to
  // it with the shutter open (spin.js's blurred cells).
  const winding = scene.add(new SceneObject('reels:winding', 'reels', { pos: 0.4 * LEN, playing: true, length: LEN, sampleRate: SR, at: clock() }));
  renderer.part(winding.id, reelsDrawer(reelPair(cell(grid, 'winding to a jump, and back'))));
  let since = 0, polls = 0;
  ticker.add((dt) => {
    since += dt;
    if (since > 200) {
      since = 0;
      polls += 1;
      const jump = polls % 10 === 0 ? (polls % 20 === 0 ? -60 : 60) * SR : 0;
      winding.set({ pos: winding.view.pos + 0.2 * SR + jump, at: clock() });
    }
    return true;
  });
}


/**
 * The cassette, across the tape and in each of the states its label can be
 * in. This is the cell that makes "make the tapes more realistic" a job
 * someone can pick up: the shell, the paper, the printed stripes, the hubs
 * and the packs, all on one screen and none of it needing a take, a server
 * or a playback path.
 */
function buildCassettes(root, { scene, renderer, ticker }) {
  const grid = section(root, 'Cassette',
    'Drawn with no audio, so each is a still. The stripe comes from the name, the stamp from the date in it, and the packs from how far through it is.');

  // Peaks shaped like /api/peaks: min/max pairs per bucket, per channel.
  const peaks = (n = 96) => {
    const data = [new Float32Array(n * 2), new Float32Array(n * 2)];
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < n; i++) {
        // A shape with a quiet intro and a loud middle, so the bars say
        // something rather than being a flat block.
        const t = i / n;
        const a = (0.18 + 0.75 * Math.sin(Math.PI * t) ** 1.5) * (c ? 0.86 : 1);
        data[c][2 * i] = -a;
        data[c][2 * i + 1] = a;
      }
    }
    return { buckets: n, channels: 2, data };
  };

  // The names are chosen so the stripes spread across the printed palette --
  // a name hashes to one of five (lib/objects/cassette-geom.js) -- because
  // showing the palette is most of the point of this cell.
  // The hash covers the whole name, date and all, so these are the exact
  // strings that give one of each of the five printed stripes. Showing the
  // palette is most of the point of this cell, so they are picked, not
  // invented -- change one and the stripe changes.
  const states = [
    ['stripe 1 · start', '2026-10-04_2015_drop', 0],
    ['stripe 2 · a third through', '2026-10-04_2015_jam', 1 / 3],
    ['stripe 3 · halfway', '2026-10-04_2015_chords', 0.5],
    ['stripe 4 · nearly done', '2026-10-04_2015_groove', 0.92],
    ['stripe 5 · almost at the end', '2026-10-04_2015_sketch', 0.99],
    ['no date in the name, so no stamp', 'untitled sketch', 0.4],
  ];

  for (const [label, name, frac] of states) {
    const id = `cassette:${name}`;
    scene.add(new SceneObject(id, 'cassette', { played: frac }));
    new CassetteFace({
      container: cell(grid, label),
      peaks: peaks(),
      duration: 212,
      audio: null,                 // a picture, not a player
      take: { name, duration: 212, stars: 0, tag: null },
      scene, renderer, id,
    });
  }

  // One playing, on the bench's clock: the hubs turn, the emptier spool the
  // faster, and the tape goes round again at the end.
  const id = 'cassette:playing';
  const playing = scene.add(new SceneObject(id, 'cassette', { played: 0.15, playing: true }));
  new CassetteFace({
    container: cell(grid, 'playing: the emptier spool turns faster'),
    peaks: peaks(),
    duration: 212,
    audio: null,
    take: { name: '2026-10-04_2015_jam', duration: 212, stars: 0, tag: null },
    scene, renderer, id,
  });
  ticker.add((dt) => {
    playing.set({ played: (playing.state.played + dt / 30000) % 1 });
    return true;
  });
}


/**
 * The ribbon: the ring as a glowing trace on brown oxide. The most tape-like
 * thing the app draws, and the one most worth looking at closely -- the
 * oxide's grain and sheen, the dark centre line, and the lit part where the
 * chosen length is.
 *
 * Drawn here from made-up levels rather than from a ring, so the states that
 * are awkward to get a real Pi into -- a ring that has not filled yet, a
 * silent one -- are a cell rather than an expedition.
 */
function buildRibbon(root) {
  const grid = section(root, 'Ribbon',
    'The ring as a meter: levels on the meters\' dB scale, not a waveform. The lit part is the chosen capture length; the unrecorded end gets no trace, because a flat line there would read as silence.');

  const H = 64;

  /** A plausible envelope: a quiet room, a jam, and a silent ring. */
  const envelopes = {
    jam: (n) => Float32Array.from({ length: n }, (_, i) => {
      const t = i / n;
      // A couple of loud passages with quieter joins, so the trace has shape.
      const body = 0.45 + 0.4 * Math.sin(t * Math.PI * 3) ** 2;
      const swell = 0.25 * Math.sin(t * Math.PI * 11);
      return Math.max(0.04, Math.min(1, body + swell));
    }),
    quiet: (n) => Float32Array.from({ length: n }, (_, i) => 0.10 + 0.04 * Math.sin(i / 3)),
    silent: (n) => new Float32Array(n),
  };

  // The lit span and where recording starts, for a ribbon W wide: drawn at
  // the cell's own width, so the size slider shows a ribbon of that size
  // rather than a 320 px one stretched.
  const states = [
    ['the whole ring lit', 'jam', (W) => [0, W], () => 0],
    ['a 30 s length lit at the head', 'jam', (W) => [W - 70 / 320 * W, W], () => 0],
    ['a span held mid-ribbon', 'jam', (W) => [110 / 320 * W, 190 / 320 * W], () => 0],
    ['the ring has not filled yet', 'jam', (W) => [W - 70 / 320 * W, W], (W) => W * 0.42],
    ['a quiet room', 'quiet', (W) => [0, W], () => 0],
    ['nothing on the ring', 'silent', (W) => [0, W], () => 0],
  ];

  for (const [label, env, lit, recordedFrom] of states) {
    const levels = envelopes[env](160);
    const canvas = canvasCell(cell(grid, label), H, (ctx, W) => drawRibbon(ctx, {
      W, H, levels, lit: lit(W), recordedFrom: recordedFrom(W), colors: ribbonColors(token),
    }));
    canvas.classList.add('bench-ribbon');
  }
}


/**
 * The LCD: the counter in the reel window, amber behind glass in both
 * schemes. Each cell is the markup the pages carry (.np-lcd), painted from
 * the same functions they paint it from (lib/objects/lcd.js) -- so the words
 * in a cell are the words a page would show in that state. The count-in, a
 * mixdown and a punch are the ones worth having here: getting a rig into
 * them takes a band.
 */
function buildLcd(root) {
  const grid = section(root, 'LCD',
    'Where it is, large, with the time beside it; the lamp; and the line that scrolls under them. A message takes the large place, and its details the line under it, still.');

  // 96 BPM in 4/4, so a bar is 2.5 s: sixteen bars, the loop on bars 5-8,
  // and the tape stopped 13.2 s in, which is bar 6, beat 2.
  const SR = 48000, BAR = 2.5 * SR;
  const tape = (over = {}) => ({
    id: 't1', name: 'Tuesday jam', sample_rate: SR, length: 16 * BAR,
    grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 4 * BAR, out: 8 * BAR, on: true }, ...over,
  });
  const live = (over = {}) => ({
    playing: false, heard: Math.round(13.2 * SR), out: 0, delivered: 0, count_in: 0,
    output: 'jam room', output_mode: 'jam', ...over,
  });
  const playing = live({ playing: true });
  const rec = live({ playing: true, record: { tape: 't1', track: 2, state: 'on' } });
  const armed = live({ record: { tape: 't1', track: 2, state: 'armed' } });
  // Two and a half beats of count-in left: "2 of 4".
  const counting = live({ playing: true, count_in: Math.round(2.5 * BAR / 4) });
  const mix = (state) => ({ state, from: 0, to: 8 * BAR });
  const take = { name: '2026-10-04_2015_JAM', bpm: 96, region: { start: 2 * SR, end: 30 * SR }, sampleRate: SR };
  const tracks = ['var(--t1)', 'var(--t2)'];
  const ink = ['var(--lcd-ink)', 'var(--lcd-ink)'];

  const states = [
    ['tape, stopped', tapeCounter(tape(), live(), null), tapeMarquee(tape(), live()), tracks, []],
    ['tape, playing', tapeCounter(tape(), playing, null), tapeMarquee(tape(), playing), tracks, [-12, -22]],
    ['recording track 2', tapeCounter(tape(), rec, null), tapeMarquee(tape(), rec), tracks, [-12, -6]],
    ['track 2 armed', tapeCounter(tape(), armed, null), tapeMarquee(tape(), armed), tracks, []],
    ['count-in', tapeCounter(tape(), counting, null), tapeMarquee(tape(), counting), tracks, []],
    ['mixing down', tapeCounter(tape(), playing, mix('playing')), '', tracks, [-12, -22]],
    ['letting it ring out', tapeCounter(tape(), playing, mix('tail')), '', tracks, []],
    ['saving the mixdown', tapeCounter(tape(), live(), mix('saving')), '', tracks, []],
    ['no tempo yet, no output', tapeCounter(tape({ grid: null }), live({ output: '' }), null), tapeMarquee(tape({ grid: null }), live()), tracks, []],
    ['a take, playing on its grid', takeCounter({ pos: 13.2 * SR, length: 212 * SR, sampleRate: SR, bar: '6.2', playing: true }), takeMarquee(take), ink, [-14, -16]],
    ['a take, paused, no tempo', takeCounter({ pos: 75.4 * SR, length: 212 * SR, sampleRate: SR, bar: null, playing: false }), takeMarquee({ ...take, name: 'untitled sketch', bpm: null, region: null }), ink, []],
  ];
  for (const [label, lcd, marquee, colours, levels] of states) lcdFace(cell(grid, label), lcd, marquee, colours, levels);
}

/**
 * lcdFace is one LCD, as the pages mark it up, painted as bar.js and the
 * tape and take pages paint theirs: the lamp, the unit, the position, the
 * time, a level bar per track, and the marquee -- still when it carries a
 * message.
 */
function lcdFace(parent, lcd, marquee, colours, levels) {
  const face = el('div', 'np-lcd');
  const top = el('div', 'np-lcd-top');
  const status = el('span', 'np-status');
  status.dataset.state = lcd.status;
  const bars = el('span', 'np-levels');
  colours.forEach((c, i) => {
    const b = el('i');
    b.style.background = c;
    b.style.color = c; // the glow is currentColor
    b.style.transform = `scaleY(${Math.max(0.08, levelFrac(levels[i])).toFixed(3)})`;
    bars.append(b);
  });
  top.append(status, el('span', 'np-unit', lcd.unit), el('span', 'np-pos', lcd.big), el('span', 'np-time', lcd.small), bars);
  const line = el('div', 'np-marquee');
  line.classList.toggle('still', !!lcd.note);
  line.append(el('span', null, lcd.note || marquee));
  face.append(top, line);
  const box = el('div', 'bench-lcd');
  box.append(face);
  parent.append(box);
}


/**
 * Grease pencil: a selection's In and Out, marked on the tape the way an
 * editor marked an edit point, drawn by the function the take page draws
 * them with. The cells are the places IN and OUT can be written -- inside a
 * wide selection, outside a narrow one, stacked at either end of the take
 * -- because those are the layouts that go wrong.
 */
function buildGrease(root) {
  const grid = section(root, 'Grease pencil',
    'In and Out on the tape, as the take page marks them: under the ruler, through the oxide, each mark\'s wobble its own and the same every frame. The words sit inside the selection when it holds them.');

  // Each case: where In and Out are, as fractions of the width, or px from
  // an end. Seeds are frames, as on the page.
  const states = [
    ['a wide selection: IN and OUT inside', (W) => [0.2 * W, 0.8 * W]],
    ['a narrow one: either side of it', (W) => [0.44 * W, 0.52 * W]],
    ['at the end of the take: both left, stacked', (W) => [W - 25, W - 16]],
    ['at the start: both right, stacked', () => [1, 12]],
    ['Out off the canvas: In alone', (W) => [0.3 * W, W + 50]],
  ];
  const H = 150, bottom = H - 30;
  for (const [label, at] of states) {
    canvasCell(cell(grid, label), H, (ctx, W) => {
      const [sx0, sx1] = at(W);
      ctx.fillStyle = token('--oxide-ruler', '#1d1209');
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(0, RULER_H);
      paintOxide(ctx, W, bottom - RULER_H, oxideColors(token));
      ctx.restore();
      drawGrease(ctx, {
        sx0, sx1, start: Math.round(sx0 * 4800), end: Math.round(sx1 * 4800), W,
        markTop: PIN_H + 2, markBottom: bottom - 2, labelTop: RULER_H + 6,
        ink: token('--grease-mark', '#f0c419'), halo: token('--well', '#161718'), font: token('--font', 'system-ui'),
      });
    });
  }
}


/**
 * Pennants: a flag stuck in the tape. The take page plants one in its ruler
 * for every flag on the take, drawn by lib/objects/pennant.js; the ribbon
 * on Capture plants its own as an element you can tap -- the same flag, but
 * a swallowtail (.rb-flag in styles.css) where the take page's is pointed.
 * Both are here, so a change to one can be held up against the other.
 */
function buildPennants(root) {
  const grid = section(root, 'Pennant',
    'A flag stuck in the tape: in the take page\'s ruler, with its line down through the audio and its name when there is room before the next; and on the ribbon, where it is a thing to tap.');

  const H = 96;
  const states = [
    ['a flag', [{ at: 0.4 }]],
    ['the flag selected', [{ at: 0.4, selected: true }]],
    ['a named flag', [{ at: 0.3, label: 'the riff' }]],
    ['two close together: the second name waits for room', [{ at: 0.25, label: 'verse' }, { at: 0.34, label: 'chorus' }]],
  ];
  for (const [label, flags] of states) {
    canvasCell(cell(grid, label), H, (ctx, W) => {
      ctx.fillStyle = token('--oxide-ruler', '#1d1209');
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(0, RULER_H);
      paintOxide(ctx, W, H - RULER_H, oxideColors(token));
      ctx.restore();
      // As the take page writes them: 11 px, and a name only where it won't
      // run into the one before.
      ctx.textBaseline = 'alphabetic';
      ctx.font = `11px ${token('--font', 'system-ui')}`;
      let lastRight = -Infinity;
      for (const f of flags) {
        const x = f.at * W;
        drawPennant(ctx, x, { pinH: PIN_H, bottom: H, selected: !!f.selected, ink: token('--flag', '#d99a0a') });
        if (f.label && x + 12 > lastRight) lastRight = drawPennantName(ctx, x, f.label, { pinH: PIN_H, ink: token('--well-ink', '#f2e6c8') });
      }
    });
  }

  // The ribbon's: the real .rb-flag element, over a ring drawn as the
  // ribbon draws it.
  const levels = Float32Array.from({ length: 160 }, (_, i) => 0.4 + 0.35 * Math.sin(i / 9) ** 2);
  for (const [label, ats] of [['on the ribbon', [0.55]], ['on the ribbon, two flags', [0.3, 0.72]]]) {
    const wrap = el('div', 'bench-rb');
    cell(grid, label).append(wrap);
    canvasCell(wrap, 64, (ctx, W, h) => drawRibbon(ctx, { W, H: h, levels, lit: [0, W], recordedFrom: 0, colors: ribbonColors(token) }));
    const layer = el('div', 'rb-layer');
    for (const a of ats) {
      const flag = el('div', 'rb-flag');
      flag.style.left = `${(a * 100).toFixed(2)}%`;
      layer.append(flag);
    }
    wrap.append(layer);
  }
}


/**
 * Icons: the app's one drawn set (lib/ui/icons.js, icons/ui.svg) in the ink
 * of a key, where the tape plays as the output button shows it, and the
 * app's own icon, from its files, at the sizes it is asked for: the top
 * bar's 24 px, and the home screen's.
 */
function buildIcons(root) {
  const grid = section(root, 'Icons',
    'Every icon in the sprite, by its name, at a bar key\'s 20 px. Where the tape plays, as the output button shows it: a speaker, headphones, both. Then the app\'s icon, a take as the shelf draws one, at the size of the top bar and of a home screen.');

  for (const name of ICONS) {
    const box = el('span', 'bench-ico');
    box.innerHTML = icon(name);
    cell(grid, name).append(box);
  }
  const names = { jam: 'Jam room: a speaker', phone: 'Phone: headphones', both: 'Both' };
  for (const mode of OUT_MODES) {
    const box = el('span', 'bench-ico');
    box.innerHTML = outIcon(mode);
    cell(grid, names[mode]).append(box);
  }
  // The same files, at the same addresses, the pages and the manifest ask for.
  // The top bar rounds its corners (.brand img); the OS rounds the full
  // bleed one itself, so it is shown square, as handed over.
  const files = [
    ['the top bar, 24 px (icon-small.svg)', '/icons/icon-small.svg?v=3', 24, '6px'],
    ['the app icon (icon.svg)', '/icons/icon.svg', 96, ''],
    ['full bleed, for the OS to round (icon-full.svg)', '/icons/icon-full.svg', 96, ''],
  ];
  for (const [label, src, size, radius] of files) {
    const img = el('img', 'bench-app-ico');
    img.src = src;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.style.borderRadius = radius;
    cell(grid, label).append(img);
  }
}


/**
 * Masking tape, written on in marker: a track's name on the tape page, and
 * a take's flags on its card in Takes. It is all CSS -- the strip's torn
 * ends, its lean, the tape and the marker -- so there is no module; these
 * cells are the pages' own markup (lib/tape/page.js, lib/shelf-detail.js),
 * with the classes styles.css styles them by.
 */
function buildMaskingTape(root) {
  const grid = section(root, 'Masking tape',
    'A track\'s name in marker on a strip of masking tape, as on a console\'s scribble strip, and a take\'s flags as tabs on its card. Styled in styles.css (.tt-head .tt-name, .detail-flag); the marker is a material, the tape a shade darker at night.');

  /** A track's head, as the tape page builds it, with only its name. */
  const track = (n, name) => {
    const row = el('div', 'tape-track');
    row.style.setProperty('--tc', `var(--t${((n - 1) % 4) + 1})`);
    const head = el('div', 'tt-head');
    const num = el('span', 'tt-num', String(n));
    num.setAttribute('aria-hidden', 'true');
    const label = el('button', 'tt-name', name);
    label.type = 'button';
    label.dataset.n = String(n);
    head.append(num, label);
    row.append(head);
    return row;
  };
  const stack = (rows) => {
    const box = el('div', 'bench-tracks');
    box.append(...rows);
    return box;
  };

  cell(grid, 'tracks 1 and 2: the strips lean opposite ways').append(stack([track(1, 'Drums'), track(2, 'Keys')]));
  cell(grid, 'nothing written on it yet').append(stack([track(3, '')]));
  // A head 200 px or wider prints the number in a ring of the track's
  // colour instead of on the tape (the tthead container query).
  const wide = track(1, 'Drums');
  wide.classList.add('bench-wide');
  cell(grid, 'a wide head: the number in its ring').append(stack([wide]));

  // A take's flags, as Takes builds them for the take's card.
  const flags = el('div', 'detail-flags');
  for (const [name, at] of [['the riff', '0:10'], ['big ending', '2:48']]) {
    const c = el('button', 'detail-flag');
    c.type = 'button';
    c.innerHTML = '<span aria-hidden="true">⚑</span><span class="flag-name"></span><span class="flag-at"></span>';
    c.querySelector('.flag-name').textContent = name;
    c.querySelector('.flag-at').textContent = at;
    flags.append(c);
  }
  cell(grid, 'a take\'s flags, on its card').append(flags);
}
