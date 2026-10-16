// web/static/lib/room/art/hifi.js
// The hi-fi wall: the walnut console, the speakers on it, and what the page's
// own markup draws the face of -- the deck and the shelves (their DOM twins,
// placed by lib/room/stage.js over where these boxes project). For those two
// this draws only what the markup can't: the sides the eye sees, the shadows
// they cast on the wall and the floor, and where they sit.

import { f, d, fill, op, rng } from './kit.js';
import { keyLight, wallShadow, floorShadow } from '../space.js';

/** wash is a face's lamp light as a gradient between two of its room points. */
function wash(ctx, shape, normal, a, b, A, B, { warm = 0.45, dark = 0.5 } = {}) {
  const la = ctx.light(normal, a), lb = ctx.light(normal, b);
  const dk = (l) => Math.max(0, 0.85 - l.key * 1.6 - l.fill * 0.6) * dark;
  const g = ctx.defs.linear([[0, '--room-key-light', la.key * warm], [1, '--room-key-light', lb.key * warm]], { x1: A.x, y1: A.y, x2: B.x, y2: B.y, user: true });
  const s = ctx.defs.linear([[0, '--room-shadow', dk(la)], [1, '--room-shadow', dk(lb)]], { x1: A.x, y1: A.y, x2: B.x, y2: B.y, user: true });
  return `<path d="${shape}" fill="${g}"/><path d="${shape}" fill="${s}"/>`;
}
export { wash };

/** contact is the dark line where a thing stands on something, and its cast shadow on the floor. */
export function grounded(ctx, o, { cast = true, strength = 0.6 } = {}) {
  const { P, id } = ctx;
  let s = '';
  if (cast && o.at.y === 0) {
    const poly = floorShadow(o, keyLight(ctx.room)).map((p) => P(p.x, 0, p.z));
    s += `<path d="${d(poly)}" ${fill('--room-shadow', 0.42 * strength)} filter="url(#${id}-soft-l)"/>`;
  }
  const { x, y, z } = o.at, { w, d: dd } = o.size;
  const foot = [P(x - 1, y, z + dd + 1), P(x + w + 1, y, z + dd + 1), P(x + w + 1, y, z - 1), P(x - 1, y, z - 1)];
  s += `<path d="${d(foot)}" ${fill('--room-shadow', 0.7 * strength)} filter="url(#${id}-soft-m)"/>`;
  return s;
}

/** onWall is the shadow a box standing against the wall throws onto it, away from the lamp. */
export function onWall(ctx, o, strength = 0.55) {
  const { P, id } = ctx;
  const sh = wallShadow(o, keyLight(ctx.room));
  const { x, y } = o.at, { w, h } = o.size;
  const r = [P(x, y, 0), P(x + w, y, 0), P(x + w, y + h, 0), P(x, y + h, 0)].map((p) => ({ x: p.x + sh.dx, y: p.y + sh.dy }));
  return `<path d="${d(r)}" ${fill('--room-shadow', strength * 0.8)} filter="url(#${id}-soft-xl)"/>`;
}

/** console: a low walnut cabinet on tapered legs, two slatted doors and a cubby of LPs. */
export function credenza(o, ctx) {
  const { defs, P, id } = ctx;
  const { x, z } = o.at, { w, h, d: dd } = o.size;
  const leg = 14;
  const zf = z + dd;
  let s = onWall(ctx, { at: { x, y: leg, z }, size: { w, h: h - leg, d: dd } }) + grounded(ctx, o, { strength: 0.8 });
  // Legs, splayed a little.
  for (const lx of [x + 8, x + w - 8]) for (const lz of [z + 6, zf - 5]) {
    const t = P(lx, leg, lz), b = P(lx + (lx < x + w / 2 ? -2 : 2), 0, lz + (lz > z + dd / 2 ? 2 : -1));
    s += `<path d="M${f(t.x - 1.6)},${f(t.y)}L${f(t.x + 1.6)},${f(t.y)}L${f(b.x + 0.7)},${f(b.y)}L${f(b.x - 0.7)},${f(b.y)}Z" ${fill('--room-walnut-lo')}/>`;
  }
  // The top, which the eye sees from above.
  const top = [P(x, h, z), P(x + w, h, z), P(x + w, h, zf), P(x, h, zf)];
  const tg = defs.linear([[0, '--room-walnut-lo'], [1, '--room-walnut-hi']], { x1: 0, y1: top[0].y, x2: 0, y2: top[2].y, user: true });
  s += `<path d="${d(top)}" fill="${tg}" filter="url(#${id}-wood)"/>`;
  s += wash(ctx, d(top), { x: 0, y: 1, z: 0 }, { x, y: h, z: zf }, { x: x + w, y: h, z: zf }, top[3], top[2], { warm: 0.55 });
  // The lamp in the varnish of the top: a soft bright streak.
  const lx = Math.max(x + 6, Math.min(x + w - 6, keyLight(ctx.room).at.x + 14));
  s += `<path d="${d([P(lx - 8, h, z + 2), P(lx + 4, h, z + 2), P(lx + 10, h, zf - 2), P(lx - 4, h, zf - 2)])}" ${fill('--room-glint', 0.12)} filter="url(#${id}-soft-m)"/>`;
  // The front: one board, then its doors and cubby set into it.
  const front = [P(x, h, zf), P(x + w, h, zf), P(x + w, leg, zf), P(x, leg, zf)];
  s += `<path d="${d(front)}" ${fill('--room-walnut')} filter="url(#${id}-wood)"/>`;
  const cw = w * 0.3, dw = (w - cw - 12) / 2;
  const door = (dx) => {
    const a = P(dx, h - 4, zf), b = P(dx + dw, leg + 4, zf);
    const W = b.x - a.x, H = b.y - a.y;
    let q = `<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(W)}" height="${f(H)}" ${fill('--room-walnut-lo')}/>`;
    // Slats: a tambour, each with its own lit edge.
    const n = Math.round(W / 2.4);
    let edges = '', darks = '';
    for (let i = 0; i < n; i++) {
      const sx = a.x + (i / n) * W;
      edges += `M${f(sx + 0.3)},${f(a.y + 0.5)}v${f(H - 1)}`;
      darks += `M${f(sx + W / n - 0.3)},${f(a.y + 0.5)}v${f(H - 1)}`;
    }
    q += `<path d="${edges}" style="stroke:var(--room-walnut-hi)" stroke-width=".7" stroke-opacity=".8"/>`;
    q += `<path d="${darks}" style="stroke:var(--room-walnut-deep)" stroke-width=".55"/>`;
    // A brass pull.
    const pull = P(dx + (dx < x + w / 2 ? dw - 4 : 4), (h + leg) / 2, zf + 1);
    q += `<rect x="${f(pull.x - 0.7)}" y="${f(pull.y - 5)}" width="1.4" height="10" rx=".7" ${fill('--room-plate-lo')}/><rect x="${f(pull.x - 0.7)}" y="${f(pull.y - 5)}" width=".6" height="10" ${fill('--room-plate-hi', 0.8)}/>`;
    return q;
  };
  s += door(x + 4) + door(x + w - 4 - dw);
  // The cubby: dark inside, a row of LP spines.
  const ca = P(x + 4 + dw + 2, h - 4, zf), cb = P(x + w - 4 - dw - 2, leg + 4, zf);
  const CW = cb.x - ca.x, CH = cb.y - ca.y;
  s += `<rect x="${f(ca.x)}" y="${f(ca.y)}" width="${f(CW)}" height="${f(CH)}" ${fill('--room-walnut-deep')}/>`;
  const r = rng(41);
  const lps = ['--room-lp-1', '--room-lp-2', '--room-lp-3', '--room-lp-4', '--room-lp-5', '--room-cardboard-hi', '--room-paper'];
  let lx2 = ca.x + 1;
  while (lx2 < cb.x - 2) {
    const lw = 0.8 + r() * 1.3;
    const lh = CH * (0.82 + r() * 0.12);
    s += `<rect x="${f(lx2)}" y="${f(cb.y - lh)}" width="${f(lw)}" height="${f(lh)}" ${fill(lps[Math.floor(r() * lps.length)], 0.85)}/>`;
    lx2 += lw + 0.15;
  }
  // The cubby's top casts down into it.
  const cg = defs.linear([[0, '--room-shadow', 0.75], [0.4, '--room-shadow', 0.15], [1, '--room-shadow', 0.3]], { x1: 0, y1: ca.y, x2: 0, y2: cb.y, user: true });
  s += `<rect x="${f(ca.x)}" y="${f(ca.y)}" width="${f(CW)}" height="${f(CH)}" fill="${cg}"/>`;
  s += wash(ctx, d(front), { x: 0, y: 0, z: 1 }, { x, y: h / 2, z: zf }, { x: x + w, y: h / 2, z: zf }, front[3], front[2]);
  // The top's front edge, a thin bright line.
  s += `<path d="M${f(top[3].x)},${f(top[3].y)}L${f(top[2].x)},${f(top[2].y)}" style="stroke:var(--room-walnut-hi)" stroke-width=".8"/>`;
  return s;
}

/** speaker: a small walnut box with a cloth grille. */
export function speaker(o, ctx) {
  const { defs, P, id } = ctx;
  const { x, y, z } = o.at, { w, h, d: dd } = o.size;
  const zf = z + dd;
  let s = onWall(ctx, o, 0.4) + grounded(ctx, o, { cast: false });
  const top = [P(x, y + h, z), P(x + w, y + h, z), P(x + w, y + h, zf), P(x, y + h, zf)];
  s += `<path d="${d(top)}" ${fill('--room-walnut-hi')}/>`;
  s += wash(ctx, d(top), { x: 0, y: 1, z: 0 }, { x, y: y + h, z: zf }, { x: x + w, y: y + h, z: zf }, top[3], top[2]);
  const front = [P(x, y + h, zf), P(x + w, y + h, zf), P(x + w, y, zf), P(x, y, zf)];
  s += `<path d="${d(front)}" ${fill('--room-walnut')} filter="url(#${id}-wood)"/>`;
  const m = 2;
  const g = [P(x + m, y + h - m, zf), P(x + w - m, y + h - m, zf), P(x + w - m, y + m, zf), P(x + m, y + m, zf)];
  s += `<path d="${d(g)}" ${fill('--room-grille')} filter="url(#${id}-knit)"/>`;
  // The cones behind the cloth, just there.
  const c1 = P(x + w / 2, y + h * 0.36, zf), c2 = P(x + w / 2, y + h * 0.76, zf);
  const k = c1.k;
  s += `<circle cx="${f(c1.x)}" cy="${f(c1.y)}" r="${f(w * 0.36 * k)}" fill="none" style="stroke:var(--room-shadow)" stroke-opacity=".35" stroke-width="1"/>`;
  s += `<circle cx="${f(c2.x)}" cy="${f(c2.y)}" r="${f(w * 0.14 * k)}" fill="none" style="stroke:var(--room-shadow)" stroke-opacity=".35" stroke-width=".8"/>`;
  s += wash(ctx, d(front), { x: 0, y: 0, z: 1 }, { x, y: y + h / 2, z: zf }, { x: x + w, y: y + h / 2, z: zf }, front[3], front[2]);
  void defs;
  return s;
}

/**
 * deck: the deck's face is the page's markup (.room-deck-art); here, only
 * where it stands -- its shadow on the wall and on the console under it,
 * and its feet.
 */
export function deck(o, ctx) {
  const { P, id } = ctx;
  const { x, y, z } = o.at, { w, d: dd } = o.size;
  let s = onWall(ctx, o, 0.6);
  const foot = [P(x - 2, y, z + dd + 2), P(x + w + 2, y, z + dd + 2), P(x + w + 2, y, z), P(x - 2, y, z)];
  s += `<path d="${d(foot)}" ${fill('--room-shadow', 0.75)} filter="url(#${id}-soft-m)"/>`;
  for (const fx of [x + 6, x + w - 6]) {
    const p = P(fx, y + 1, z + dd - 3);
    s += `<rect x="${f(p.x - 3)}" y="${f(p.y - 2.2)}" width="6" height="2.6" rx=".6" ${fill('--room-key-lo')}/>`;
  }
  return s;
}

/**
 * shelves: the shelves' front is the page's markup (.room-shelves); here,
 * the side of the unit the eye sees, its plinth's shadow, and the shadow it
 * throws on the wall.
 */
export function shelves(o, ctx) {
  const { defs, P } = ctx;
  const { x, y, z } = o.at, { w, h, d: dd } = o.size;
  const eye = ctx.view.eye;
  let s = onWall(ctx, o, 0.5) + grounded(ctx, o, { strength: 0.9 });
  // The side toward the eye.
  const sx = eye.x < x ? x : eye.x > x + w ? x + w : null;
  if (sx != null) {
    const side = [P(sx, y, z), P(sx, y + h, z), P(sx, y + h, z + dd), P(sx, y, z + dd)];
    const g = defs.linear([[0, '--room-walnut-deep'], [1, '--room-walnut-lo']], { x1: side[0].x, y1: 0, x2: side[3].x, y2: 0, user: true });
    s += `<path d="${d(side)}" fill="${g}"/>`;
    s += wash(ctx, d(side), { x: sx === x ? -1 : 1, y: 0, z: 0 }, { x: sx, y: h * 0.7, z: z + dd / 2 }, { x: sx, y: h * 0.2, z: z + dd / 2 }, side[1], side[0], { warm: 0.4 });
  }
  return s;
}

void op;
