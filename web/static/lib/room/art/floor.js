// web/static/lib/room/art/floor.js
// What lies on the floor: the rug (a worn Persian, its borders and medallion
// laid out flat in the room and projected, so it recedes as a rug does), and
// a crate of records by the shelves.

import { f, d, fill, rng } from './kit.js';
import { keyLight } from '../space.js';
import { grounded, wash } from './hifi.js';

/** inset is a floor rectangle drawn in by m on every side, projected. */
const rect = (P, x0, z0, x1, z1, y = 0.4) => [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)];

/** rug: a field, its borders, a medallion, corner pieces, a fringe; lit by the lamp's pool. */
export function rug(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const x0 = o.at.x, z0 = o.at.z, x1 = x0 + o.size.w, z1 = z0 + o.size.d;
  const ring = (m) => d(rect(P, x0 + m, z0 + m, x1 - m, z1 - m));
  let s = `<path d="${d(rect(P, x0 - 1, z0 - 1, x1 + 1, z1 + 2, 0))}" ${fill('--room-shadow', 0.5)} filter="url(#${id}-soft-s)"/>`;
  let pile = '';
  pile += `<path d="${ring(0)}" ${fill('--room-rug-edge')}/>`;
  pile += `<path d="${ring(5)}" ${fill('--room-rug-band')}/>`;
  // The main border: a chain of lozenges along it.
  const band = (m0, m1, n, token) => {
    let b = '';
    const mm = (m0 + m1) / 2, hw = (m1 - m0) * 0.42;
    const sides = [
      [x0 + mm, z0 + mm, x1 - mm, z0 + mm], [x1 - mm, z0 + mm, x1 - mm, z1 - mm],
      [x1 - mm, z1 - mm, x0 + mm, z1 - mm], [x0 + mm, z1 - mm, x0 + mm, z0 + mm],
    ];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az), k = Math.max(2, Math.round(len / n));
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let i = 0; i < k; i++) {
        const t = (i + 0.5) * (len / k);
        const cx = ax + ux * t, cz = az + uz * t;
        const q = len / k / 2 * 0.8;
        b += `<path d="${d([P(cx - ux * q, 0.5, cz - uz * q), P(cx - uz * hw, 0.5, cz + ux * hw), P(cx + ux * q, 0.5, cz + uz * q), P(cx + uz * hw, 0.5, cz - ux * hw)])}" ${fill(token)}/>`;
      }
    }
    return b;
  };
  pile += band(5, 21, 13, '--room-rug-mid');
  pile += `<path d="${ring(21)}" ${fill('--room-rug-edge')}/>`;
  pile += `<path d="${ring(23)}" ${fill('--room-rug')}/>`;
  // The medallion: a stepped lozenge, then a smaller one inside it.
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const loz = (rx, rz, steps) => {
    const pts = [];
    for (let i = 0; i < 4 * steps; i++) {
      const a = (i / (4 * steps)) * Math.PI * 2;
      const kk = i % 2 ? 0.86 : 1;
      pts.push(P(cx + Math.cos(a) * rx * kk * (Math.abs(Math.cos(a)) ** 0.2), 0.6, cz + Math.sin(a) * rz * kk * (Math.abs(Math.sin(a)) ** 0.2)));
    }
    return d(pts);
  };
  pile += `<path d="${loz(o.size.w * 0.3, o.size.d * 0.3, 10)}" ${fill('--room-rug-mid')}/>`;
  pile += `<path d="${loz(o.size.w * 0.24, o.size.d * 0.24, 10)}" ${fill('--room-rug-band')}/>`;
  pile += `<path d="${loz(o.size.w * 0.12, o.size.d * 0.12, 8)}" ${fill('--room-rug-ivory')}/>`;
  pile += `<path d="${loz(o.size.w * 0.06, o.size.d * 0.06, 6)}" ${fill('--room-rug-band')}/>`;
  // Corner pieces.
  for (const [ax, az, sx, sz] of [[x0 + 23, z0 + 23, 1, 1], [x1 - 23, z0 + 23, -1, 1], [x1 - 23, z1 - 23, -1, -1], [x0 + 23, z1 - 23, 1, -1]]) {
    pile += `<path d="${d([P(ax, 0.6, az), P(ax + sx * 46, 0.6, az), P(ax, 0.6, az + sz * 34)])}" ${fill('--room-rug-mid', 0.85)}/>`;
    pile += `<path d="${d([P(ax, 0.6, az), P(ax + sx * 24, 0.6, az), P(ax, 0.6, az + sz * 18)])}" ${fill('--room-rug-ivory', 0.7)}/>`;
  }
  s += `<g filter="url(#${id}-knit)">${pile}</g>`;
  // Wear: the pile flattened where feet go, in front of the chair.
  const wear = P(cx - 40, 0.6, z1 - 50);
  s += `<ellipse cx="${f(wear.x)}" cy="${f(wear.y)}" rx="${f(50 * wear.k)}" ry="${f(14 * wear.k)}" ${fill('--room-rug-ivory', 0.08)} filter="url(#${id}-soft-l)"/>`;
  // The light: the lamp's pool, warm, and the far edge dimmer.
  const c = P(L.at.x, 0, L.at.z);
  const ahead = P(L.at.x, 0, L.at.z + 100), side = P(L.at.x + 100, 0, L.at.z);
  const pool = defs.radial([[0, '--room-key-light', 0.42], [0.3, '--room-key-light', 0.25], [0.6, '--room-key-light', 0.08], [1, '--room-key-light', 0]], { cx: c.x, cy: c.y, rx: (side.x - c.x) * 2.2, ry: (ahead.y - c.y) * 2 });
  s += `<path d="${ring(0)}" fill="${pool}"/>`;
  s += wash(ctx, ring(0), { x: 0, y: 1, z: 0 }, { x: cx, y: 0, z: z0 }, { x: cx, y: 0, z: z1 }, P(cx, 0, z0), P(cx, 0, z1), { warm: 0, dark: 0.55 });
  // The fringe, at both ends.
  const r = rng(5);
  let fr = '';
  for (let x = x0 + 2; x < x1 - 1; x += 2.2) {
    for (const [z, dz] of [[z0, -1], [z1, 1]]) {
      const a = P(x, 0.3, z), b = P(x + (r() - 0.5) * 1.6, 0.3, z + dz * (4 + r() * 2));
      fr += `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
    }
  }
  s += `<path d="${fr}" fill="none" style="stroke:var(--room-rug-ivory)" stroke-width=".55" stroke-opacity=".75"/>`;
  return s;
}

/** amp: a small tweed combo on the floor, its pilot light on -- a musician's room. */
export function amp(o, ctx) {
  const { defs, P, id } = ctx;
  const { x, y, z } = o.at, { w, h, d: dd } = o.size;
  const zf = z + dd;
  let s = grounded(ctx, o, { strength: 0.9 });
  const tweed = (pts, a, b) => {
    const g = defs.linear([[0, '--room-tweed'], [1, '--room-tweed-lo']], { x1: a.x, y1: a.y, x2: b.x, y2: b.y, user: true });
    return `<path d="${d(pts)}" fill="${g}" filter="url(#${id}-knit)"/>`;
  };
  // The left side, if the eye is to its left; the top, with its handle.
  if (ctx.view.eye.x < x) {
    const side = [P(x, y, z), P(x, y + h, z), P(x, y + h, zf), P(x, y, zf)];
    s += tweed(side, side[1], side[3]);
    s += wash(ctx, d(side), { x: -1, y: 0, z: 0 }, { x, y: h / 2, z }, { x, y: h / 2, z: zf }, side[1], side[2], { warm: 0.5, dark: 0.5 });
  }
  const top = [P(x, y + h, z), P(x + w, y + h, z), P(x + w, y + h, zf), P(x, y + h, zf)];
  s += tweed(top, top[0], top[2]);
  s += wash(ctx, d(top), { x: 0, y: 1, z: 0 }, { x, y: h, z: zf }, { x: x + w, y: h, z: zf }, top[3], top[2], { warm: 0.55, dark: 0.3 });
  const h0 = P(x + w * 0.35, y + h + 0.5, z + dd * 0.5), h1 = P(x + w * 0.65, y + h + 0.5, z + dd * 0.5);
  s += `<path d="M${f(h0.x)},${f(h0.y)}Q${f((h0.x + h1.x) / 2)},${f(h0.y - 4)} ${f(h1.x)},${f(h1.y)}" fill="none" style="stroke:var(--room-walnut-deep)" stroke-width="2.4" stroke-linecap="round"/>`;
  // The front: tweed, a control strip, the grille cloth.
  const front = [P(x, y + h, zf), P(x + w, y + h, zf), P(x + w, y, zf), P(x, y, zf)];
  s += tweed(front, front[0], front[2]);
  const pa = P(x + 3, y + h - 2.5, zf), pb = P(x + w - 3, y + h - 9, zf);
  s += `<rect x="${f(pa.x)}" y="${f(pa.y)}" width="${f(pb.x - pa.x)}" height="${f(pb.y - pa.y)}" rx=".6" ${fill('--room-key-lo')}/>`;
  for (let i = 0; i < 5; i++) {
    const k = P(x + 10 + i * 9, y + h - 5.8, zf + 1);
    s += `<circle cx="${f(k.x)}" cy="${f(k.y)}" r="${f(1.6 * k.k)}" ${fill('--room-silver')}/><circle cx="${f(k.x - 0.4)}" cy="${f(k.y - 0.4)}" r="${f(0.6 * k.k)}" ${fill('--room-glint', 0.8)}/>`;
  }
  const jewel = P(x + w - 8, y + h - 5.8, zf + 1);
  s += `<circle cx="${f(jewel.x)}" cy="${f(jewel.y)}" r="${f(4 * jewel.k)}" ${fill('--room-amp-jewel', 0.25)} filter="url(#${id}-soft-s)"/><circle cx="${f(jewel.x)}" cy="${f(jewel.y)}" r="${f(1.3 * jewel.k)}" ${fill('--room-amp-jewel')}/>`;
  const ga = P(x + 4, y + h - 12, zf), gb = P(x + w - 4, y + 4, zf);
  s += `<rect x="${f(ga.x)}" y="${f(ga.y)}" width="${f(gb.x - ga.x)}" height="${f(gb.y - ga.y)}" rx="1" ${fill('--room-amp-grille')} filter="url(#${id}-knit)"/>`;
  s += `<rect x="${f(ga.x)}" y="${f(ga.y)}" width="${f(gb.x - ga.x)}" height="${f(gb.y - ga.y)}" rx="1" fill="none" style="stroke:var(--room-walnut-deep)" stroke-width=".9"/>`;
  s += wash(ctx, d(front), { x: 0, y: 0, z: 1 }, { x, y: h / 2, z: zf }, { x: x + w, y: h / 2, z: zf }, front[0], front[1], { warm: 0.4, dark: 0.55 });
  return s;
}
