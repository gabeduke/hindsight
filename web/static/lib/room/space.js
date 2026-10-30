// web/static/lib/room/space.js
// The Listening Room as a place: what is in it, where, what it is made of,
// and where the light comes from -- as plain data, in centimetres, so a
// renderer of any kind draws the same room. Today's renderer is flat SVG
// over the page's own markup (lib/room/stage.js); the scene contract's R3
// (planes with depth) and anything later in 3D read this same list.
//
// Axes: x runs along the back wall from its left corner, y up from the
// floor, z out from the wall toward the doorway. Every object is a box: `at`
// is its corner nearest the floor, the wall and the left (its least x, y and
// z), and `size` is {w, h, d} along x, y, z. A wall object (a window, a
// poster) has d of a few centimetres. A view is a camera at the doorway,
// looking square at the back wall: `eye` is where it stands, `crop` the part
// of the wall plane (z = 0) the frame shows, in the same centimetres.
//
// The light is two lights: the floor lamp's bulb (the key, warm) and the
// window (the fill, cool). Shading and shadows are derived from where they
// are (lit, floorShadow, wallShadow), not painted per object, so a lamp moved
// here moves every highlight and shadow with it.
//
// Pure: no DOM. Tested in space.test.js.

/** ROOM is the Listening Room. */
export const ROOM = Object.freeze({
  unit: 'cm',
  size: { w: 600, h: 270, d: 420 },
  views: {
    // A laptop or a landscape tablet: the whole wall, the window to the hi-fi
    // and the shelves, with the chair in the near left.
    wide: { aspect: 1.6, eye: { x: 300, y: 138, z: 900 }, crop: { left: 0, top: 262, width: 600, height: 375 } },
    // A portrait tablet: a step in, to the left, eyes higher -- looking down
    // into the room as you stand in it, so the chair and the rug fill the
    // floor and everything from the window to the shelves fits a narrower
    // frame.
    tall: { aspect: 0.8, eye: { x: 170, y: 210, z: 520 }, crop: { left: 0, top: 276, width: 632, height: 790 } },
  },
  lights: [
    { id: 'lamp', kind: 'key', at: { x: 200, y: 150, z: 88 }, color: '--room-key-light', power: 1, reach: 230 },
    { id: 'window', kind: 'fill', at: { x: 100, y: 160, z: 0 }, size: { w: 130, h: 130 }, color: '--room-fill-light', power: 0.35, reach: 340 },
  ],
  objects: [
    // The shell. Drawn first, whatever their z.
    { id: 'wall', art: 'wall', at: { x: 0, y: 0, z: 0 }, size: { w: 600, h: 270, d: 0 }, mount: 'shell', material: { base: '--room-plaster', hi: '--room-plaster-hi', lo: '--room-plaster-lo' } },
    { id: 'floor', art: 'floor', at: { x: 0, y: 0, z: 0 }, size: { w: 600, h: 0, d: 420 }, mount: 'shell', material: { base: '--room-board', line: '--room-board-line', skirting: '--room-skirting' } },
    // On the wall.
    { id: 'window', art: 'window', at: { x: 46, y: 92, z: 0 }, size: { w: 128, h: 132, d: 14 }, mount: 'wall', material: { frame: '--room-sash', sky: '--room-sky-hi', city: '--room-city' } },
    { id: 'curtain', art: 'curtain', at: { x: 18, y: 6, z: 2 }, size: { w: 190, h: 248, d: 14 }, mount: 'wall', material: { base: '--room-curtain', hi: '--room-curtain-hi', lo: '--room-curtain-lo' } },
    { id: 'poster', art: 'poster', at: { x: 262, y: 168, z: 0 }, size: { w: 72, h: 54, d: 3 }, mount: 'wall', material: { frame: '--room-walnut-deep', paper: '--room-poster' } },
    // Against the wall: the shelves (the page's own markup: the twin), the
    // console and the deck on it.
    { id: 'shelves', art: 'shelves', twin: 'shelves', at: { x: 392, y: 0, z: 0 }, size: { w: 204, h: 214, d: 34 }, mount: 'floor', material: { base: '--room-walnut', hi: '--room-walnut-hi', lo: '--room-walnut-lo' } },
    { id: 'console', art: 'console', at: { x: 226, y: 0, z: 0 }, size: { w: 150, h: 58, d: 44 }, mount: 'floor', material: { base: '--room-walnut', hi: '--room-walnut-hi', lo: '--room-walnut-lo' } },
    { id: 'deck', art: 'deck', twin: 'deck', at: { x: 254, y: 58, z: 8 }, size: { w: 94, h: 86, d: 30 }, mount: 'on:console', material: { base: '--room-silver', hi: '--room-silver-hi', lo: '--room-silver-lo' } },
    { id: 'speaker-l', art: 'speaker', at: { x: 230, y: 58, z: 12 }, size: { w: 22, h: 36, d: 24 }, mount: 'on:console', material: { base: '--room-walnut-lo' } },
    { id: 'speaker-r', art: 'speaker', at: { x: 351, y: 58, z: 12 }, size: { w: 22, h: 36, d: 24 }, mount: 'on:console', material: { base: '--room-walnut-lo' } },
    // On the floor, nearer.
    { id: 'rug', art: 'rug', at: { x: 46, y: 0, z: 60 }, size: { w: 420, h: 1, d: 286 }, mount: 'floor', material: { base: '--room-rug', band: '--room-rug-band', mid: '--room-rug-mid', edge: '--room-rug-edge' } },
    { id: 'amp', art: 'amp', at: { x: 452, y: 0, z: 266 }, size: { w: 58, h: 34, d: 24 }, mount: 'floor', material: { base: '--room-tweed', grille: '--room-amp-grille' } },
    { id: 'lamp', art: 'lamp', at: { x: 182, y: 0, z: 70 }, size: { w: 36, h: 166, d: 36 }, mount: 'floor', material: { shade: '--room-shade-hi', shadeLo: '--room-shade-lo', pole: '--room-pole' } },
    { id: 'table', art: 'table', at: { x: 204, y: 0, z: 158 }, size: { w: 54, h: 56, d: 54 }, mount: 'floor', material: { base: '--room-walnut', hi: '--room-walnut-hi', lo: '--room-walnut-lo' } },
    { id: 'glass', art: 'glass', at: { x: 240, y: 56, z: 176 }, size: { w: 8, h: 10, d: 8 }, mount: 'on:table', material: { glass: '--room-glass', drink: '--room-whisky' } },
    { id: 'chair', art: 'chair', at: { x: 72, y: 0, z: 138 }, size: { w: 112, h: 98, d: 92 }, mount: 'floor', material: { base: '--room-leather', hi: '--room-leather-hi', lo: '--room-leather-lo', piping: '--room-leather-edge', throw: '--room-throw' } },
  ],
});

/** viewFor picks the view whose frame suits a box `aspect` (width / height) wide. */
export function viewFor(aspect, room = ROOM) {
  return aspect < 1.1 ? 'tall' : 'wide';
}

/**
 * project is where a point in the room lands in a view's picture, in the
 * picture's own units: centimetres on the wall plane, x to the right and y
 * down (SVG's way), so a point on the wall is where it is. Nearer points
 * spread from the eye, as a camera sees them.
 */
export function project(p, view) {
  const e = view.eye;
  const k = e.z / (e.z - p.z);
  return { x: e.x + (p.x - e.x) * k, y: -(e.y + (p.y - e.y) * k), k };
}

/** corners are a box's eight corners, named by side: l/r, b/t (bottom, top), w/f (at the wall, at the front). */
export function corners(o) {
  const { x, y, z } = o.at, { w, h, d } = o.size;
  const c = {};
  for (const [cx, X] of [['l', x], ['r', x + w]]) for (const [cy, Y] of [['b', y], ['t', y + h]]) for (const [cz, Z] of [['w', z], ['f', z + d]]) c[cx + cy + cz] = { x: X, y: Y, z: Z };
  return c;
}

/** face is a box's front face in a view: {x, y, w, h} in picture units, and k, its scale. */
export function face(o, view) {
  const c = corners(o);
  const a = project(c.ltf, view), b = project(c.rbf, view);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, k: a.k };
}

/** inFrame is a rect in picture units as fractions of the view's frame (0..1 across, 0..1 down). */
export function inFrame(r, view) {
  const c = view.crop;
  return { left: (r.x - c.left) / c.width, top: (r.y + c.top) / c.height, width: r.w / c.width, height: r.h / c.height };
}

const center = (o) => ({ x: o.at.x + o.size.w / 2, y: o.at.y + o.size.h / 2, z: o.at.z + o.size.d / 2 });
const len = (v) => Math.hypot(v.x, v.y, v.z || 0);

/**
 * lit is how each light falls on an object: for each light, `amount` (0..1,
 * an inverse-square falloff within its reach), and `dir`, the way to it
 * across the picture (a unit {x, y}, y down), so a renderer puts the
 * highlight on that side and the shade on the other. `side` is -1 when the
 * light is to the object's left, 1 to its right.
 */
export function lit(o, lights = ROOM.lights) {
  const c = center(o);
  const out = {};
  for (const L of lights) {
    const v = { x: L.at.x - c.x, y: L.at.y - c.y, z: L.at.z - c.z };
    const d = len(v);
    const amount = Math.max(0, Math.min(1, L.power / (1 + (d / L.reach) ** 2)));
    const flat = Math.hypot(v.x, v.y) || 1;
    out[L.id] = { amount, dir: { x: v.x / flat, y: -v.y / flat }, side: v.x < 0 ? -1 : 1, above: v.y > 0, dist: d, light: L };
  }
  return out;
}

/**
 * diffuse is how brightly each light lights a face that looks along `normal`
 * (room axes, need not be unit length) at `point`: Lambert's cosine times
 * the light's falloff, 0..1. The window is an area light, so it is taken from
 * the nearest point of its pane. Answers {key, fill}.
 */
export function diffuse(normal, point, lights = ROOM.lights) {
  const n = len(normal) || 1;
  const out = { key: 0, fill: 0 };
  for (const L of lights) {
    let at = L.at;
    if (L.size) {
      at = {
        x: Math.max(L.at.x - L.size.w / 2, Math.min(L.at.x + L.size.w / 2, point.x)),
        y: Math.max(L.at.y - L.size.h / 2, Math.min(L.at.y + L.size.h / 2, point.y)),
        z: L.at.z,
      };
    }
    const v = { x: at.x - point.x, y: at.y - point.y, z: at.z - point.z };
    const dd = len(v) || 1;
    let cos = (v.x * normal.x + v.y * normal.y + v.z * normal.z) / (dd * n);
    // A window only shines into the room.
    if (L.size && v.z > 0) cos = 0;
    const fall = L.power / (1 + (dd / L.reach) ** 2);
    out[L.kind] += Math.max(0, cos) * fall;
  }
  out.key = Math.min(1, out.key);
  out.fill = Math.min(1, out.fill);
  return out;
}

/** key and fill are the room's two lights. */
export const keyLight = (room = ROOM) => room.lights.find((l) => l.kind === 'key');
export const fillLight = (room = ROOM) => room.lights.find((l) => l.kind === 'fill');

/**
 * floorShadow is the shadow a floor object casts from a point light, as a
 * polygon on the floor (room points, y 0): its footprint, stretched away from
 * the light by how tall it is against how high the light is (h / (H - h)
 * of its distance from the lamp), but never more than `cap` times it: a
 * thing near the lamp's height would throw a shadow across the room, which
 * the room's other light -- the bounce off the walls -- fills in.
 */
export function floorShadow(o, L = keyLight(), cap = 0.9) {
  const h = Math.min(o.size.h, L.at.y - 1);
  const stretch = Math.min(cap, h / Math.max(1, L.at.y - h));
  const foot = [
    { x: o.at.x, z: o.at.z }, { x: o.at.x + o.size.w, z: o.at.z },
    { x: o.at.x + o.size.w, z: o.at.z + o.size.d }, { x: o.at.x, z: o.at.z + o.size.d },
  ];
  // Each corner of the footprint, and the same corner pushed away from the
  // light: the hull of the eight is the shadow.
  const far = foot.map((p) => {
    const dx = p.x - L.at.x, dz = p.z - L.at.z;
    return { x: p.x + dx * stretch, z: p.z + dz * stretch };
  });
  return hull([...foot, ...far]).map((p) => ({ x: p.x, y: 0, z: Math.max(0, p.z) }));
}

/**
 * wallShadow is how far the shadow of an object standing off the wall lands
 * from it on the wall, from a point light: {dx, dy} in centimetres (y down),
 * for the point at the object's front-centre -- never further than the
 * object stands off the wall -- and `soft`, how far it is from the wall (the
 * further, the softer).
 */
export function wallShadow(o, L = keyLight()) {
  const p = { x: o.at.x + o.size.w / 2, y: o.at.y + o.size.h / 2, z: o.at.z + o.size.d };
  if (L.at.z <= p.z) return { dx: 0, dy: 0, soft: p.z };
  const t = L.at.z / (L.at.z - p.z);
  // A lamp's shade is no point: past about the object's own depth the
  // shadow is all penumbra, so the offset stops there.
  const lim = o.size.d * 0.9;
  const clamp = (n) => Math.max(-lim, Math.min(lim, n));
  return { dx: clamp((p.x - L.at.x) * (t - 1)), dy: clamp(-(p.y - L.at.y) * (t - 1)), soft: p.z };
}

/** hull is the convex hull of points {x, z} (Andrew's monotone chain). */
export function hull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/**
 * drawOrder is the objects as a painter draws them: the shell, then what is
 * on the wall, then everything else back to front by its front edge (an
 * object on another just after what it stands on).
 */
export function drawOrder(objects = ROOM.objects) {
  const rank = (o) => (o.mount === 'shell' ? 0 : o.mount === 'wall' ? 1 : 2);
  const front = (o) => {
    if (o.mount && o.mount.startsWith('on:')) {
      const base = objects.find((b) => b.id === o.mount.slice(3));
      return base ? front(base) + 0.01 + o.at.z / 1e4 : o.at.z + o.size.d;
    }
    return o.art === 'rug' ? 0.5 : o.at.z + o.size.d;
  };
  return [...objects].sort((a, b) => rank(a) - rank(b) || front(a) - front(b));
}
