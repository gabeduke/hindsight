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
export const CLEAR = 8;
/**
 * A rope hangs: over a run it sags, by about this much in the middle, so a
 * rope led just above something would sag onto it. The room above is this much more.
 */
export const HANG = 10;
/** A turn costs this many cells' length: a bend is dearer than a short detour. */
const BEND = 5;
/** The lane a cable took costs this a cell, and the cells beside it less, out to LANES cells. */
const LANE = [16, 9, 4];
/**
 * A route with more corners than this is simplified: pulled taut between
 * its corners wherever that crosses nothing and takes no other cable's lane.
 * Up to this many it is kept as the search found it, square and tidy.
 */
const SIMPLE_OVER = 6;

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
    this.free = new Float32Array(this.w * this.h); // what the cable being led owns: its sockets' holes
    this.holes = new Map(); // owner → [[cell, cost]…] of its own hole: free to that socket's cables
    // The search's working arrays, made once for every cable and told apart
    // from the last cable's by a generation, not cleared: they are big (a
    // long phone desk is megabytes of them).
    this.best = new Float32Array(this.w * this.h * 4);
    this.from = new Int32Array(this.w * this.h * 4);
    this.seen = new Uint32Array(this.w * this.h * 4);
    this.shut = new Uint32Array(this.w * this.h * 4);
    this.gen = 0;
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
 * cells it runs through. The cable's own holes are `grid.free`: crossing
 * them costs nothing.
 */
function search(grid, s, t) {
  const { w, h, best, from, seen, shut } = grid;
  const gen = ++grid.gen;
  const tx = t % w, ty = (t / w) | 0;
  const heur = (c) => Math.abs((c % w) - tx) + Math.abs(((c / w) | 0) - ty);
  const heap = new Heap();
  const { base, lane, free } = grid;
  const cost = (c) => Math.max(0, base[c] - free[c]) + lane[c];
  for (let d = 0; d < 4; d++) {
    const st = s * 4 + d;
    best[st] = 0;
    from[st] = -1;
    seen[st] = gen;
    heap.push(heur(s), st);
  }
  let goal = -1;
  while (heap.size) {
    const st = heap.pop();
    const c = (st / 4) | 0, d = st % 4;
    if (c === t) { goal = st; break; }
    if (shut[st] === gen) continue;
    shut[st] = gen;
    const g = best[st];
    const cx = c % w, cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nc = ny * w + nx;
      const turn = c === s || k === d ? 0 : BEND;
      const ng = g + 1 + turn + cost(nc);
      const ns = nc * 4 + k;
      if (seen[ns] !== gen || ng < best[ns]) {
        seen[ns] = gen;
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
 * clear says a straight line from p to q crosses nothing, and none of the
 * lanes the cables so far took: every cell it passes costs nothing.
 */
function clear(grid, free, p, q) {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (CELL / 2)));
  for (let i = 0; i <= n; i++) {
    const [x, y] = grid.at(p.x + ((q.x - p.x) * i) / n, p.y + ((q.y - p.y) * i) / n);
    const c = y * grid.w + x;
    if (grid.base[c] - free[c] > 0 || grid.lane[c] > 0) return false;
  }
  return true;
}

/**
 * pull simplifies a route that has too many corners: from each point, the
 * furthest one it can reach in a straight line over clear ground, skipping
 * the corners between. The ends stay where they are.
 */
function pull(grid, free, a, via, b) {
  const pts = [a, ...via, b];
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(grid, free, pts[i], pts[j])) j--;
    if (j < pts.length - 1) out.push(pts[j]);
    i = j;
  }
  return out;
}

/** cellsOf is the cells a route a, via..., b runs through. */
function cellsOf(grid, a, via, b) {
  const pts = [a, ...via, b];
  const seen = new Set();
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (CELL / 2)));
    for (let i = 0; i <= n; i++) {
      const [x, y] = grid.at(p.x + ((q.x - p.x) * i) / n, p.y + ((q.y - p.y) * i) / n);
      seen.add(y * grid.w + x);
    }
  }
  return seen;
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
    const free = grid.free;
    const own = [c.from, c.to].flatMap((owner) => grid.holes.get(owner) || []);
    for (const cell of own) free[cell] += CROSS;
    const s = grid.at(c.a.x, c.a.y), t = grid.at(c.b.x, c.b.y);
    const sc = s[1] * grid.w + s[0], tc = t[1] * grid.w + t[0];
    const cells = sc === tc ? null : search(grid, sc, tc);
    if (!cells) { out.set(c.id, []); for (const cell of own) free[cell] = 0; continue; }
    let via = tidy(c.a, waypoints(cells, grid.w, c.a, c.b), c.b);
    // A route found is a route kept: a long one is simplified, not dropped.
    if (via.length > SIMPLE_OVER) via = tidy(c.a, pull(grid, free, c.a, via, c.b), c.b);
    // The lane it takes is the one it runs in, as simplified.
    grid.take(cellsOf(grid, c.a, via, c.b));
    out.set(c.id, via);
    for (const cell of own) free[cell] = 0;
  }
  return out;
}

// --- when to route -----------------------------------------------------------------

/** How long a changed layout waits for others, in ms: a first paint lays the desk out three times in a few frames. */
export const LEAD_MS = 100;

const r1 = (v) => Math.round(v);

/**
 * layoutKey is a signature of everything the router reads: the desk's size,
 * every obstacle's rectangle, and each cable's sockets and where its ends
 * are, to the pixel. The same layout has the same key, so it is not routed
 * twice; any layout the router would answer differently for has another.
 */
export function layoutKey({ size, obstacles, cables }) {
  return JSON.stringify([
    r1(size.w), r1(size.h),
    obstacles.map((o) => [o.type, o.owner, r1(o.x), r1(o.y), r1(o.w), r1(o.h)]),
    cables.map((c) => [c.id, c.from, c.to, !!c.declared, c.a ? [r1(c.a.x), r1(c.a.y)] : null, c.b ? [r1(c.b.x), r1(c.b.y)] : null]),
  ]);
}

const cablesKey = (cables) => JSON.stringify(cables.map((c) => [c.id, c.from, c.to]).sort());

/**
 * Leader decides when the router runs, because it is not free (about a tenth
 * of a second for a busy phone desk, four times that on a slow phone) and a
 * page lays its desk out several times as it loads.
 *   - the same layout as the last run: not at all;
 *   - a cable that is new or gone: at once, so that connecting one feels
 *     instant and the first paint has its routes;
 *   - any other change (a resize, a label that grew, details unfolded, the
 *     fonts arriving): once, LEAD_MS later, with the latest layout, however
 *     many changes came in the meantime. Until then the last routes stand.
 * `later`, `cancel` and `run` are what a test replaces; `onRoutes` is told
 * when a run that came later has new routes.
 */
export class Leader {
  constructor({ run = routeAll, later = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t), onRoutes = () => {}, wait = LEAD_MS } = {}) {
    Object.assign(this, { run, later, cancel, onRoutes, wait });
    this.routes = new Map();
    this.key = null; // the layout last routed
    this.cables = null; // and its cables
    this.input = null; // a layout waiting its turn
    this.timer = null;
  }

  /** lead answers the routes to use now for this layout: those of the last run, unless it has to be routed at once. */
  lead(input) {
    const key = layoutKey(input);
    if (key === this.key) {
      this.drop(); // it came back to the layout that was routed: nothing is owed
      return this.routes;
    }
    const cables = cablesKey(input.cables);
    if (this.key === null || cables !== this.cables) {
      this.drop();
      this.go(input, key, cables);
      return this.routes;
    }
    this.input = input;
    if (!this.timer) this.timer = this.later(() => this.fire(), this.wait);
    return this.routes;
  }

  go(input, key, cables) {
    this.routes = this.run(input);
    this.key = key;
    this.cables = cables;
  }

  drop() {
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
    this.input = null;
  }

  fire() {
    const input = this.input;
    this.timer = null;
    this.input = null;
    if (!input) return;
    const key = layoutKey(input);
    if (key === this.key) return;
    this.go(input, key, cablesKey(input.cables));
    this.onRoutes(this.routes);
  }
}
