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

import { VUMeters, vuScale, vuAngle, VU_SWING } from './vu.js';
import { CassetteFace } from './cassette.js';
import { ribbonColors, drawRibbon } from './ribbon-draw.js';
import { token } from '../theme.js';
import { ReelWindow, levelFrac } from './reel-window.js';
import { ballistic, spin, settled, Ticker } from './motion.js';
import { tapeCounter, tapeMarquee, takeCounter, takeMarquee } from './lcd.js';
import { drawGrease } from './grease.js';
import { drawPennant, drawPennantName } from './pennant.js';
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

export function mount(root, { raf, cancel, now } = {}) {
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
  // reduced: false deliberately. The bench's whole job is to show motion, and
  // the speed control is the accessible way to look at it. The shipped pages
  // honour prefers-reduced-motion through the shared ticker.
  const ticker = new Ticker({ raf, cancel, now: clock, reduced: false });

  buildSpeed(root, (s) => { clock(); scale = s; });
  buildMotion(root, ticker);
  buildVu(root);
  buildReels(root, ticker, clock);
  buildCassettes(root);
  buildRibbon(root);
  buildLcd(root);
  buildGrease(root);
  buildPennants(root);
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
 * The motion section is the argument for motion.js, made visible: the same
 * step, driven two ways. The CSS needle is what the meters do today -- it
 * arrives and stops dead, which the eye reads as a bar that happens to be
 * rotating. The ballistic one overshoots a percent and settles, which is what
 * a moving-coil movement does and why it reads as a needle.
 */
function buildMotion(root, ticker) {
  const grid = section(root, 'Motion',
    'The same step, driven two ways: the 140 ms CSS transition the meters used to have, and the ballistic movement they have now. Slow it to ⅒× to watch the overshoot.');

  const cssNeedle = needleFace(cell(grid, 'CSS transition, 140 ms — what it was'));
  cssNeedle.style.transition = 'transform 140ms cubic-bezier(.25, .8, .35, 1)';
  const ballNeedle = needleFace(cell(grid, 'ballistic: 300 ms to 99 %, 1 % overshoot — shipped'));

  let value = -VU_SWING, velocity = 0, target = -VU_SWING;
  cssNeedle.style.transform = `rotate(${value}deg)`;
  ballNeedle.style.transform = `rotate(${value}deg)`;

  // A step every two seconds, between the ends of the scale, forever: the
  // bench is for watching, so it doesn't need a play button.
  let next = 0;
  ticker.add((dt) => {
    next -= dt;
    if (next <= 0) {
      next = 2000;
      target = target > 0 ? vuAngle(-30) : vuAngle(-6);
      cssNeedle.style.transform = `rotate(${target.toFixed(1)}deg)`;
    }
    ({ value, velocity } = ballistic(value, velocity, target, dt));
    ballNeedle.style.transform = `rotate(${value.toFixed(2)}deg)`;
    return true; // it is a loop; it always wants the next frame
  });
}

/** Every VU state, still, so a change to the face can be read off one screen. */
function buildVu(root) {
  const grid = section(root, 'VU meter',
    'Levels in dBFS, 0 VU at −18. The peak lamp is held for 700 ms after a clip, shown here as its lit state.');

  // Chosen to land on the marks actually printed on the face, so a change to
  // the scale shows up as a needle that no longer points at its number.
  // 0 VU is the −18 dBFS line-up, so VU = dBFS + 18.
  // These cells are reference states, not an animation, so they are stepped
  // once with an infinite dt and land on their mark immediately. The live
  // needles are in the Motion section above.
  const immediate = { add: (step) => { step(Infinity); return () => {}; }, start: () => {} };
  const states = [
    ['silence (−∞)', -Infinity, false],
    ['−38 → −20 VU', -38, false],
    ['−28 → −10 VU', -28, false],
    ['−21 → −3 VU', -21, false],
    ['−18 → 0 VU', -18, false],
    ['−15 → +3 VU, peak lit', -15, true],
  ];
  for (const [name, db, peak] of states) {
    const meters = new VUMeters(cell(grid, name), { labels: ['L'], ticker: immediate });
    meters.update([db], [peak ? 0 : -60], [peak]);
    meters.step(Infinity); // update() set the target; land on it now
  }
}

/** The reels at rest across the tape, plus one running. */
function buildReels(root, ticker, clock) {
  const grid = section(root, 'Reels',
    'Pack radii across the length of a tape — area is conserved, so the packs fill and empty as real ones do.');

  const SR = 48000, LEN = 360 * SR;
  const stills = [['start', 0], ['quarter', 0.25], ['half', 0.5], ['three quarters', 0.75], ['end', 1]];
  for (const [name, frac] of stills) {
    const { left, right, levels } = reelPair(cell(grid, name));
    const rw = new ReelWindow({ left, right, levels });
    rw.poll({ heard: frac * LEN, playing: false, length: LEN, sampleRate: SR });
    rw.stop();
    rw.draw(clock());
  }

  // One running, driven by the bench clock so the speed control reaches it.
  const { left, right, levels } = reelPair(cell(grid, 'playing'));
  const rw = new ReelWindow({ left, right, levels });
  rw.poll({ heard: 0, playing: true, length: LEN, sampleRate: SR });
  rw.stop();
  let at = 0;
  ticker.add((dt) => {
    at += dt;
    // Re-poll as the page would, so it exercises the same path and never
    // runs away past AHEAD_S.
    if (at > 200) { at = 0; rw.motion.poll(rw.motion.pos + 0.2 * SR, true, clock()); }
    rw.draw(clock());
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
function buildCassettes(root) {
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
    const face = new CassetteFace({
      container: cell(grid, label),
      peaks: peaks(),
      duration: 212,
      audio: null,                 // a picture, not a player
      take: { name, duration: 212, stars: 0, tag: null },
    });
    face.setFraction(frac);
  }
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

  const W = 320, H = 64;

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

  const states = [
    ['the whole ring lit', 'jam', [0, W], 0],
    ['a 30 s length lit at the head', 'jam', [W - 70, W], 0],
    ['a span held mid-ribbon', 'jam', [110, 190], 0],
    ['the ring has not filled yet', 'jam', [W - 70, W], W * 0.42],
    ['a quiet room', 'quiet', [0, W], 0],
    ['nothing on the ring', 'silent', [0, W], 0],
  ];

  for (const [label, env, lit, recordedFrom] of states) {
    const body = cell(grid, label);
    const canvas = el('canvas', 'bench-ribbon');
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.height = `${H}px`;
    body.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue; // no 2d context (a test runner): the cell stays blank
    ctx.scale(dpr, dpr);
    drawRibbon(ctx, {
      W, H,
      levels: envelopes[env](160),
      lit,
      recordedFrom,
      colors: ribbonColors(token),
    });
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
        ink: token('--grease-mark', '#f0c419'), halo: token('--well', '#0a0a0b'), font: token('--font', 'system-ui'),
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
        drawPennant(ctx, x, { pinH: PIN_H, bottom: H, selected: !!f.selected, ink: token('--flag', '#b58900') });
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
