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
import { ReelWindow } from './reel-window.js';
import { ballistic, spin, settled, Ticker } from './motion.js';

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
