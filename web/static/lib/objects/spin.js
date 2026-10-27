// web/static/lib/objects/spin.js
// The turning parts, rendered: the bar's reels and the cassette's hubs, as
// sheets of frames from Blender (scripts/blender/spools.py). Each sheet is
// one turn of the part's symmetry -- 120 degrees for a reel's three
// windows, 60 for a hub's six teeth -- drawn a step further round in each
// cell, under a lamp that stays where it is. So the highlights hold still
// while the metal turns under them, as a real reel's do, where a drawing
// turned by a transform carries its light round with it.
//
// A part at any angle is the cell nearest it, turned the rest of the way
// by a transform: half a step at most, too little to move the light.
//
// A reel's sheet has two more sets, for winding: cells rendered with the
// shutter open while the reel turned through 36 degrees, and through a
// whole 120, where the windows smear into a ring.

/**
 * The sheets, as spools.py renders them: `cell` is the part's box in the
 * page's units (the reel's SVG viewBox, the hub's px), `cols` and `rows`
 * the grid, `period` the turn a sheet covers, and each set its first cell
 * and how many. Change these and spools.py's REEL and HUB together.
 */
export const REEL = Object.freeze({
  src: '/sprites/reel.webp?v=022b8db1',
  cell: 160, px: 160, cols: 4, rows: 5, period: 120,
  sets: Object.freeze({ still: { at: 0, n: 12 }, blur: { at: 12, n: 4 }, smear: { at: 16, n: 1 } }),
});

export const HUB = Object.freeze({
  src: '/sprites/hub.webp?v=a160f878',
  cell: 44, px: 96, cols: 6, rows: 2, period: 60,
  sets: Object.freeze({ still: { at: 0, n: 12 } }),
});

/**
 * spinCell is where `sheet` draws its part turned `angle` degrees
 * clockwise: the cell's column and row, `base`, the angle the cell was
 * rendered at, and `rest`, the degrees left to turn it by transform, never
 * more than half a step either way.
 */
export function spinCell(sheet, angle, set = 'still') {
  const { at, n } = sheet.sets[set];
  const step = sheet.period / n;
  const a = (((Number(angle) || 0) % sheet.period) + sheet.period) % sheet.period;
  const k = Math.round(a / step);
  const i = at + (k % n);
  return { col: i % sheet.cols, row: Math.floor(i / sheet.cols), base: (k % n) * step, rest: a - k * step };
}

/**
 * blurFor is which of a reel's sets draws it turning at `spin` degrees a
 * second: still up to a little over a turn a second, then the 36-degree
 * blur, then the smear once a frame (at 60 a second) would turn it further
 * than the blur reaches.
 */
export function blurFor(spin) {
  const s = Math.abs(spin) || 0;
  if (s < 420) return 'still';
  return s < 2400 ? 'blur' : 'smear';
}

const loads = new Map();

/**
 * sheetReady resolves once `sheet`'s picture has loaded and decoded, so a
 * drawer can show the drawn part until then and never a blank one. One
 * load per sheet for the page; it rejects where there are no images (node).
 */
export function sheetReady(sheet) {
  if (!loads.has(sheet.src)) {
    loads.set(sheet.src, typeof Image === 'function'
      ? new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
        img.onerror = reject;
        img.src = sheet.src;
      })
      : Promise.reject(new Error('no images here')));
    loads.get(sheet.src).catch(() => {});
  }
  return loads.get(sheet.src);
}
