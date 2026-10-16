// web/static/lib/room/art/shell.js
// The room's shell: the back wall (with the ceiling's edge and the skirting)
// and the floorboards. The lamp's light on them is worked out from where the
// lamp is (ROOM.lights): its shade is a drum, open at the top and the bottom,
// so the wall gets the classic hourglass -- full light in the cones above and
// below, the shade's glow through the linen between -- and the floor a pool
// under it, falling off as the cosine over the distance squared.

import { f, d, fill, op, rng } from './kit.js';
import { keyLight, fillLight } from '../space.js';

const FAR = 900; // how far past the crop the shell is drawn, for any frame

/** wall: the back wall, its light, the ceiling's edge above and the skirting below. */
export function wall(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room), W = fillLight(ctx.room);
  const H = o.size.h;
  const x0 = -FAR, x1 = o.size.w + FAR;
  let s = '';
  // The plaster: dusk at the top, warmer low down where the lamp is.
  const g = defs.linear([[0, '--room-plaster-hi'], [0.55, '--room-plaster'], [1, '--room-plaster-lo']], { x1: 0, y1: -H, x2: 0, y2: 0, user: true });
  s += `<rect x="${x0}" y="${-H}" width="${x1 - x0}" height="${H}" fill="${g}"/>`;
  s += `<rect x="${x0}" y="${-H}" width="${x1 - x0}" height="${H}" ${fill('--room-plaster')} filter="url(#${id}-plaster)" opacity=".5"/>`;
  // The lamp's light on the wall, as the cosine law gives it: from a bulb
  // L.at.z in front of it, E(r) ∝ (z / √(z² + r²))³.
  const z = L.at.z;
  const E = (r) => (z / Math.hypot(z, r)) ** 3;
  const rs = [0, 0.25, 0.5, 0.8, 1.2, 1.8, 2.6, 3.6].map((m) => m * z);
  const max = rs[rs.length - 1];
  const stops = rs.map((r) => [r / max, '--room-key-light', 0.36 * E(r)]);
  const glow = defs.radial(stops, { cx: L.at.x, cy: -L.at.y, rx: max });
  s += `<rect x="${x0}" y="${-H}" width="${x1 - x0}" height="${H}" fill="${glow}"/>`;
  // The cones: where the drum doesn't stand between the bulb and the wall.
  // A wall point at height y and dx across is in a cone when
  // |y - Ly| > (shade's half-height / its radius) · √(z² + dx²).
  const lamp = ctx.room.objects.find((x) => x.art === 'lamp');
  const ratio = lamp ? (15 / 18) : 0.85;
  const cone = (sign) => {
    const pts = [];
    for (let dx = -max; dx <= max; dx += max / 24) {
      const y = L.at.y + sign * ratio * Math.hypot(z, dx);
      pts.push({ x: L.at.x + dx, y: -Math.min(H + 40, Math.max(-40, y)) });
    }
    pts.push({ x: L.at.x + max, y: sign > 0 ? -H - 40 : 40 }, { x: L.at.x - max, y: sign > 0 ? -H - 40 : 40 });
    return d(pts);
  };
  const coneGlow = defs.radial(rs.map((r) => [r / max, '--room-key-light', 0.62 * Math.sqrt(E(r))]), { cx: L.at.x, cy: -L.at.y, rx: max });
  s += `<g filter="url(#${id}-soft-l)"><path d="${cone(1)}" fill="${coneGlow}"/><path d="${cone(-1)}" fill="${coneGlow}"/></g>`;
  // The window's cool light, faint, around it.
  const wg = defs.radial([[0, '--room-fill-light', 0.16], [0.5, '--room-fill-light', 0.05], [1, '--room-fill-light', 0]], { cx: W.at.x, cy: -W.at.y, rx: 220, ry: 190 });
  s += `<rect x="${x0}" y="${-H}" width="${x1 - x0}" height="${H}" fill="${wg}"/>`;
  // The ceiling: its edge, a cornice, and the ceiling going off above,
  // lit from the shade's open top.
  const top = [P(x0, H, 0), P(x1, H, 0), P(x1, H, 380), P(x0, H, 380)];
  s += `<path d="${d(top)}" ${fill('--room-ceiling')}/>`;
  const cl = P(L.at.x, H, L.at.z);
  const ceilGlow = defs.radial([[0, '--room-key-light', 0.32], [0.35, '--room-key-light', 0.12], [1, '--room-key-light', 0]], { cx: cl.x, cy: cl.y, rx: 260, ry: 70 });
  s += `<path d="${d(top)}" fill="${ceilGlow}"/>`;
  s += `<rect x="${x0}" y="${-H - 1}" width="${x1 - x0}" height="7" ${fill('--room-cornice')}/>`;
  s += `<rect x="${x0}" y="${-H + 6}" width="${x1 - x0}" height="1.2" ${fill('--room-shadow', 0.5)}/>`;
  // The skirting: a board along the foot of the wall, catching the lamp.
  const sk = 12;
  s += `<rect x="${x0}" y="${-sk}" width="${x1 - x0}" height="${sk}" ${fill('--room-skirting')}/>`;
  s += `<rect x="${x0}" y="${-sk}" width="${x1 - x0}" height="1.6" ${fill('--room-walnut-hi', 0.55)}/>`;
  const skGlow = defs.radial([[0, '--room-key-light', 0.42], [0.4, '--room-key-light', 0.15], [1, '--room-key-light', 0]], { cx: L.at.x, cy: -sk / 2, rx: 210, ry: 14 });
  s += `<rect x="${x0}" y="${-sk}" width="${x1 - x0}" height="${sk}" fill="${skGlow}"/>`;
  return s;
}

/** floor: the boards, running out from the wall to the doorway, varnished. */
export function floor(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room), W = fillLight(ctx.room);
  const x0 = -FAR, x1 = o.size.w + FAR, z1 = Math.min(o.size.d + 600, ctx.view.eye.z - 60); // on out through the doorway, for a tall frame, but never past the eye
  let s = '';
  const all = [P(x0, 0, 0), P(x1, 0, 0), P(x1, 0, z1), P(x0, 0, z1)];
  // Darker far (the light doesn't reach the wall's foot), a little lighter near.
  const near = P(0, 0, z1).y;
  const g = defs.linear([[0, '--room-board', 1], [1, '--room-board-hi', 1]], { x1: 0, y1: 0, x2: 0, y2: near, user: true });
  s += `<path d="${d(all)}" fill="${g}"/>`;
  // The boards: a seam every 14 cm, and their ends staggered, each board a
  // shade of its own.
  const r = rng(29);
  const w = 14;
  let boards = '';
  let seams = '';
  for (let x = Math.floor(x0 / w) * w; x < x1; x += w) {
    let z = -r() * 120;
    while (z < z1) {
      const len = 90 + r() * 140;
      const za = Math.max(0, z), zb = Math.min(z1, z + len);
      if (zb > za) {
        const t = r();
        const pts = [P(x, 0, za), P(x + w, 0, za), P(x + w, 0, zb), P(x, 0, zb)];
        if (t > 0.55) boards += `<path d="${d(pts)}" ${fill('--room-board-hi', (t - 0.55) * 0.5)}/>`;
        else if (t < 0.3) boards += `<path d="${d(pts)}" ${fill('--room-shadow', (0.3 - t) * 0.5)}/>`;
        if (z + len < z1 && z + len > 0) {
          const a = P(x, 0, z + len), b = P(x + w, 0, z + len);
          seams += `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
        }
      }
      z += len;
    }
    const a = P(x, 0, 0), b = P(x, 0, z1);
    seams += `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
  }
  s += `<g filter="url(#${id}-wood)">${boards}<path d="${d(all)}" fill="transparent"/></g>`;
  s += `<path d="${seams}" fill="none" style="stroke:var(--room-board-line)" stroke-width=".45" vector-effect="non-scaling-stroke"/>`;
  // The window's light, cool, on the boards before it.
  const wp = [P(W.at.x - 60, 0, 30), P(W.at.x + 70, 0, 30), P(W.at.x + 110, 0, 170), P(W.at.x - 40, 0, 170)];
  s += `<path d="${d(wp)}" ${fill('--room-fill-light', 0.07)} filter="url(#${id}-soft-xl)"/>`;
  // The lamp's pool: E(r) ∝ (h / √(h² + r²))³ from a bulb h above the
  // floor, squashed as the floor recedes.
  const h = L.at.y;
  const E = (rr) => (h / Math.hypot(h, rr)) ** 3;
  const c = P(L.at.x, 0, L.at.z);
  const ahead = P(L.at.x, 0, L.at.z + 100), behind = P(L.at.x, 0, Math.max(0, L.at.z - 100));
  const side = P(L.at.x + 100, 0, L.at.z);
  const rx = (side.x - c.x) * 2.6;
  const ry = ((ahead.y - behind.y) / 2) * 2.6;
  const rs = [0, 0.3, 0.6, 1, 1.5, 2.2, 2.6].map((m) => m * 100);
  const pool = defs.radial(rs.map((rr) => [rr / 260, '--room-key-light', 0.42 * E(rr)]), { cx: c.x, cy: c.y, rx, ry });
  s += `<path d="${d(all)}" fill="${pool}"/>`;
  // Varnish: the lamp and the window caught in it, as long soft streaks.
  const streak = (x, zs, ze, wdt, token, a) => {
    const pts = [P(x - wdt, 0, zs), P(x + wdt, 0, zs), P(x + wdt * 1.6, 0, ze), P(x - wdt * 1.6, 0, ze)];
    return `<path d="${d(pts)}" ${fill(token, a)} filter="url(#${id}-soft-l)"/>`;
  };
  s += streak(L.at.x, L.at.z + 6, L.at.z + 150, 9, '--room-key-light', 0.14);
  s += streak(W.at.x + 6, 4, 120, 22, '--room-fill-light', 0.06);
  // Where the floor meets the wall, a crease of shadow.
  s += `<rect x="${x0}" y="0" width="${x1 - x0}" height="3" ${fill('--room-shadow', op(0.55))} filter="url(#${id}-soft-s)"/>`;
  return s;
}
