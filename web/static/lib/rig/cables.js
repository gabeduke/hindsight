// web/static/lib/rig/cables.js
// Where a cable runs, from one socket's centre to another's: a curve that
// sags as a real cable does, more the further it reaches. Flat (brief R4 in
// the scene contract gives cables physics; this is the drawing that works
// without it). Pure: points in, an SVG path out.

/** sag is how far a cable between a and b hangs below the lower end. */
export function sag(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(140, 18 + d * 0.22);
}

const r1 = (v) => Math.round(v * 10) / 10;

/** cablePath is the SVG path of a cable from a to b. */
export function cablePath(a, b) {
  const s = sag(a, b);
  const low = Math.max(a.y, b.y) + s;
  // Each end leaves its socket downward, then curves across.
  const c1 = { x: a.x + (b.x - a.x) * 0.15, y: low };
  const c2 = { x: b.x - (b.x - a.x) * 0.15, y: low };
  return `M${r1(a.x)} ${r1(a.y)} C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(b.x)} ${r1(b.y)}`;
}

/** centreIn is a box's centre, relative to another box (the desk). */
export function centreIn(box, desk) {
  return { x: box.left - desk.left + box.width / 2, y: box.top - desk.top + box.height / 2 };
}
