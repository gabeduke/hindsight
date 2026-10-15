// web/static/lib/rig/route.js
// Where each cable's rope is led across the desk: the waypoints it is
// threaded through (`via`, which lib/scene/cable.js pins the rope to), so a
// cable runs through the gaps between the sockets and their names instead
// of across them.
//
// A rope with nothing but its two ends hangs wherever gravity and its length
// put it, and knows nothing of what is on the desk: from the Sidekick's USB-C
// down to the kit's USB socket it swung across the kit's row, through CH1,
// and a KEEP cable ran through the word KEEP. So the page measures what a
// rope must not cross -- every jack's hole, every name and title -- and this
// finds each cable a way: a search over a grid for the cheapest route, where
// crossing something costs a great deal (not infinity: on a phone the gaps are
// narrow, and a cable that cannot avoid something should cross as little of it
// as it can) and a turn costs a little (a tidy cable is a straight one).
// Cables are led one after another, and a later cable keeps off the lanes the
// earlier ones took, so two between the same places run side by side, not one
// on the other.
//
// Pure: rectangles and points in, points out. A cable's own hole is not an
// obstacle to it: that is where it plugs in.

/** The search grid's cell, in px. */
export const CELL = 4;
/** What a rope costs to cross a jack's hole, or a name, a cell at a time. */
const CROSS = 60;
/** The room a rope is given around what it must not cross, in px: its half-width and a little air. */
export const CLEAR = 6;
/**
 * A rope hangs: over a run it sags, by about this much in the middle, so a
 * rope led just above something would sag onto it. The room above is this much more.
 */
export const HANG = 10;
/** A turn costs this many cells' length: a bend is dearer than a short detour. */
const BEND = 5;
/** The lane a cable took costs this a cell, and the cells beside it less, out to LANES cells. */
const LANE = [16, 9, 4];
/** A cable's waypoints, at most: a route that wanders more than this is not tidy, and is cut short. */
const MAX_VIA = 8;

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** A binary heap of [priority, value]: the search's frontier. */
class Heap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.p.length; }
  push(p, v) {
    const { p: P, v: V } = this;
    let i = P.length;
    P.push(p); V.push(v);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (P[j] <= p) break;
      P[i] = P[j]; V[i] = V[j];
      i = j;
    }
    P[i] = p; V[i] = v;
  }
  pop() {
    const { p: P, v: V } = this;
    const top = V[0];
    const lp = P.pop(), lv = V.pop();
    const n = P.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= lp) break;
        P[i] = P[c]; V[i] = V[c];
        i = c;
      }
      P[i] = lp; V[i] = lv;
    }
    return top;
  }
}

/** Grid is the desk cut into cells, with what each costs to cross. */
class Grid {
  constructor(size, obstacles) {
    this.w = Math.max(1, Math.ceil(size.w / CELL));
    this.h = Math.max(1, Math.ceil(size.h / CELL));
    this.base = new Float32Array(this.w * this.h); // what is on the desk
    this.lane = new Float32Array(this.w * this.h); // what the cables so far took
    this.holes = new Map(); // owner → [[cell, cost]…] of its own hole: free to that socket's cables
    for (const o of obstacles) this.add(o);
  }

  at(x, y) { return [Math.min(this.w - 1, Math.max(0, Math.floor(x / CELL))), Math.min(this.h - 1, Math.max(0, Math.floor(y / CELL)))]; }

  add(o) {
    const [x0, y0] = this.at(o.x - CLEAR, o.y - CLEAR - HANG);
    const [x1, y1] = this.at(o.x + o.w + CLEAR, o.y + o.h + CLEAR);
    const own = o.type === 'hole' && o.owner ? [] : null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
        if (cx < o.x - CLEAR || cx > o.x + o.w + CLEAR || cy < o.y - CLEAR - HANG || cy > o.y + o.h + CLEAR) continue;
        this.base[y * this.w + x] += CROSS;
        if (own) own.push(y * this.w + x);
      }
    }
    if (own) this.holes.set(o.owner, [...(this.holes.get(o.owner) || []), ...own]);
  }

  /** take marks a route's cells as a lane: the cables after it keep off. */
  take(cells) {
    for (const c of cells) {
      const cx = c % this.w, cy = (c / this.w) | 0;
      for (let dy = -LANES; dy <= LANES; dy++) {
        for (let dx = -LANES; dx <= LANES; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d > LANES) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const i = y * this.w + x;
          this.lane[i] = Math.max(this.lane[i], LANE[d]);
        }
      }
    }
  }
}
const LANES = LANE.length - 1;

/**
 * search is the cheapest way from cell `s` to cell `t` on the grid, as the
 * cells it runs through, with `free` (cell → cost to take off) the cable's
 * own holes.
 */
function search(grid, s, t, free) {
  const { w, h } = grid;
  const n = w * h;
  const best = new Float32Array(n * 4).fill(Infinity);
  const from = new Int32Array(n * 4).fill(-1);
  const done = new Uint8Array(n * 4);
  const tx = t % w, ty = (t / w) | 0;
  const heur = (c) => Math.abs((c % w) - tx) + Math.abs(((c / w) | 0) - ty);
  const heap = new Heap();
  const cost = (c) => Math.max(0, grid.base[c] - (free.get(c) || 0)) + grid.lane[c];
  for (let d = 0; d < 4; d++) {
    best[s * 4 + d] = 0;
    heap.push(heur(s), s * 4 + d);
  }
  let goal = -1;
  while (heap.size) {
    const st = heap.pop();
    const c = (st / 4) | 0, d = st % 4;
    if (c === t) { goal = st; break; }
    if (done[st]) continue;
    done[st] = 1;
    const g = best[st];
    const cx = c % w, cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nc = ny * w + nx;
      const turn = c === s || k === d ? 0 : BEND;
      const ng = g + 1 + turn + cost(nc);
      const ns = nc * 4 + k;
      if (ng < best[ns]) {
        best[ns] = ng;
        from[ns] = st;
        heap.push(ng + heur(nc), ns);
      }
    }
  }
  if (goal < 0) return null;
  const cells = [];
  for (let st = goal; st >= 0; st = from[st]) cells.push((st / 4) | 0);
  return cells.reverse();
}

/**
 * waypoints turns a run of cells into the corners the rope is led round:
 * its straight legs, the first from `a` and the last into `b` exactly where
 * those are, and a corner where one leg meets the next. A route that is one
 * straight leg has none.
 */
function waypoints(cells, w, a, b) {
  const legs = []; // {vertical, at: where on the other axis, from, to}
  let dir = null;
  for (let i = 1; i < cells.length; i++) {
    const dx = (cells[i] % w) - (cells[i - 1] % w);
    const vertical = dx === 0;
    if (dir !== vertical) {
      legs.push({ vertical, cell: cells[i - 1] });
      dir = vertical;
    }
  }
  if (legs.length < 2) return [];
  const centre = (c) => ({ x: ((c % w) + 0.5) * CELL, y: (((c / w) | 0) + 0.5) * CELL });
  const fixed = legs.map((l, i) => {
    if (i === 0) return l.vertical ? a.x : a.y;
    if (i === legs.length - 1) return l.vertical ? b.x : b.y;
    return l.vertical ? centre(l.cell).x : centre(l.cell).y;
  });
  const pts = [];
  for (let i = 0; i + 1 < legs.length; i++) {
    // Legs alternate: the corner takes x from the vertical one and y from the other.
    const v = legs[i].vertical ? i : i + 1, hz = legs[i].vertical ? i + 1 : i;
    pts.push({ x: fixed[v], y: fixed[hz] });
  }
  return pts;
}

/** Corners closer than this are one: a jog that small is a kink, not a turn. */
const JOG = 10;

/**
 * tidy cleans a run of corners: those on top of an end are dropped, and two
 * corners a jog apart are made one, so a cable doesn't step sideways by a
 * few pixels.
 */
function tidy(a, via, b) {
  let pts = via.filter((p) => Math.hypot(p.x - a.x, p.y - a.y) >= 3 && Math.hypot(p.x - b.x, p.y - b.y) >= 3);
  for (let i = 0; i + 1 < pts.length; ) {
    const p = pts[i], q = pts[i + 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) < JOG) pts.splice(i, 2, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    else i++;
  }
  // A corner on the line between its neighbours isn't one.
  for (let i = 0; i < pts.length; ) {
    const u = pts[i - 1] || a, w = pts[i + 1] || b, p = pts[i];
    const dx = w.x - u.x, dy = w.y - u.y;
    const off = Math.abs(dx * (p.y - u.y) - dy * (p.x - u.x)) / (Math.hypot(dx, dy) || 1);
    if (off < 4) pts.splice(i, 1);
    else i++;
  }
  return pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}

/**
 * routeAll leads every cable across the desk.
 *   cables: [{id, from, to, a, b}] -- the cable's two sockets (ids) and where
 *     their holes are, in desk px. A cable with `declared` is a label, taut:
 *     it isn't routed.
 *   obstacles: [{x, y, w, h, type, owner}] -- what a rope must not cross: a
 *     jack's `hole` (owner: its socket's id), and `text` (a name, a title).
 *   size: {w, h}, the desk.
 * It answers a Map of cable id → its waypoints, a list of {x, y} between a and
 * b ([] for a cable that runs straight). The same cables on the same desk get
 * the same routes.
 */
export function routeAll({ cables, obstacles, size }) {
  const out = new Map();
  const grid = new Grid(size, obstacles);
  const todo = cables.filter((c) => !c.declared && c.a && c.b).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  for (const c of todo) {
    const free = new Map();
    for (const owner of [c.from, c.to]) for (const cell of grid.holes.get(owner) || []) free.set(cell, (free.get(cell) || 0) + CROSS);
    const s = grid.at(c.a.x, c.a.y), t = grid.at(c.b.x, c.b.y);
    const sc = s[1] * grid.w + s[0], tc = t[1] * grid.w + t[0];
    const cells = sc === tc ? null : search(grid, sc, tc, free);
    if (!cells) { out.set(c.id, []); continue; }
    grid.take(cells);
    const via = tidy(c.a, waypoints(cells, grid.w, c.a, c.b), c.b);
    out.set(c.id, via.length > MAX_VIA ? [] : via);
  }
  return out;
}
