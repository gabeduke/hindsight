// web/static/lib/scene/plug.js
// A plug's rules (docs/superpowers/specs/2026-10-15-r4-cables-design.md):
// where a plug in the hand goes, and when one in a socket comes out. Pure,
// and in the same coordinates the page measures its sockets in.

/** A plug in the hand snaps into a socket this close to its hole, in px. */
export const SNAP_PX = 24;
/** A plug comes out of its socket once pulled this far from it, in px. */
export const PULL_PX = 48;
/** How far a plug still in its socket leans toward a pull, at most, in px. */
const LEAN_PX = 6;

/**
 * snap is the socket a plug held at `p` goes into, or null: of `targets`
 * ({id, x, y} at each hole's centre, and the socket's button as `box`
 * {left, top, right, bottom}), the nearest within `r` of its hole, or the
 * one whose button the plug is over -- where a drop landed in P6, so
 * nothing that worked stops working.
 */
export function snap(p, targets, r = SNAP_PX) {
  let best = null;
  let bestD = Infinity;
  for (const t of targets) {
    const b = t.box;
    const over = !!b && p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom;
    const d = over ? 0 : Math.hypot(p.x - t.x, p.y - t.y);
    if (d <= r && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * pull says whether a plug held at `p` is out of its socket at `hole`,
 * given whether it was `out` already. It comes out once pulled more than
 * PULL_PX away, and once out stays out until it's brought back within
 * SNAP_PX: a tug isn't a pull, and a plug let go next to its socket goes
 * back in.
 */
export function pull(out, hole, p) {
  const d = Math.hypot(p.x - hole.x, p.y - hole.y);
  return out ? d > SNAP_PX : d > PULL_PX;
}

/**
 * lean is where a plug still in its socket is drawn while it's pulled at:
 * a little toward the finger, never more than LEAN_PX, so a tug can be
 * felt before the pull.
 */
export function lean(hole, p) {
  const dx = p.x - hole.x;
  const dy = p.y - hole.y;
  const d = Math.hypot(dx, dy);
  if (!d) return { x: hole.x, y: hole.y };
  const k = Math.min(LEAN_PX, d * 0.125) / d;
  return { x: hole.x + dx * k, y: hole.y + dy * k };
}
