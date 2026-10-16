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

/**
 * cablePath is the SVG path of a cable from a to b. Between two sockets
 * side by side it hangs in a loop below them; from one socket down to
 * another it drops out of the upper and into the lower, an S that keeps
 * clear of the sockets' names between.
 */
export function cablePath(a, b) {
  const s = sag(a, b);
  const dy = b.y - a.y;
  let c1, c2;
  if (Math.abs(dy) < 30) {
    const low = Math.max(a.y, b.y) + s;
    c1 = { x: a.x + (b.x - a.x) * 0.15, y: low };
    c2 = { x: b.x - (b.x - a.x) * 0.15, y: low };
  } else {
    const k = Math.abs(dy) * 0.55 + s * 0.35;
    c1 = { x: a.x, y: a.y + Math.sign(dy) * k };
    c2 = { x: b.x, y: b.y - Math.sign(dy) * k };
  }
  return `M${r1(a.x)} ${r1(a.y)} C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(b.x)} ${r1(b.y)}`;
}

/** centreIn is a box's centre, relative to another box (the desk). */
export function centreIn(box, desk) {
  return { x: box.left - desk.left + box.width / 2, y: box.top - desk.top + box.height / 2 };
}
