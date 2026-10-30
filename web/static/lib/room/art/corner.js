// web/static/lib/room/art/corner.js
// The reading corner: the floor lamp (the room's key light is its bulb), the
// side table and a glass of something on it. Each is drawn
// from its box in the room, projected, and lit from where the lamp is.

import { f, d, fill, ring } from './kit.js';
import { keyLight } from '../space.js';
import { grounded, wash } from './hifi.js';

/** lamp: a heavy round base, a brass pole, and a linen drum with the bulb in it. */
export function lamp(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const cx = o.at.x + o.size.w / 2, cz = o.at.z + o.size.d / 2;
  const top = o.size.h, shadeH = 30, r = 18;
  const sb = top - shadeH;
  let s = '';
  // The base, and its shadow (a lamp casts none of its own light's).
  const base = ring(P, cx, 0, cz, 13, 40);
  s += `<path d="${d(ring(P, cx, 0, cz, 15, 40))}" ${fill('--room-shadow', 0.55)} filter="url(#${id}-soft-m)"/>`;
  const bt = ring(P, cx, 2.5, cz, 12, 40);
  s += `<path d="${d(base)}" ${fill('--room-pole')}/><path d="${d(bt)}" ${fill('--room-plate-lo')}/>`;
  const bh = P(cx - 4, 2.5, cz - 6);
  s += `<ellipse cx="${f(bh.x)}" cy="${f(bh.y)}" rx="5" ry="1.2" ${fill('--room-plate-hi', 0.7)}/>`;
  // The pole: brass, lit on the side away from the eye's... on the bulb's side, which is above.
  const p0 = P(cx, 2.5, cz), p1 = P(cx, sb + 4, cz);
  const pg = defs.linear([[0, '--room-plate-lo'], [0.45, '--room-plate-hi'], [1, '--room-walnut-deep']], { x1: p0.x - 1.2, y1: 0, x2: p0.x + 1.2, y2: 0, user: true });
  s += `<rect x="${f(p0.x - 1.1)}" y="${f(p1.y)}" width="2.2" height="${f(p0.y - p1.y)}" fill="${pg}"/>`;
  // Its glow up the pole, near the shade.
  const pglow = defs.linear([[0, '--room-key-light', 0], [1, '--room-key-light', 0.6]], { x1: 0, y1: P(cx, sb - 40, cz).y, x2: 0, y2: p1.y, user: true });
  s += `<rect x="${f(p0.x - 1.1)}" y="${f(p1.y)}" width="2.2" height="${f(p0.y - p1.y)}" fill="${pglow}"/>`;
  // The bloom around the shade: the bulb in the air.
  const sc = P(L.at.x, L.at.y, L.at.z);
  const bloom = defs.radial([[0, '--room-key-light', 0.55], [0.25, '--room-key-light', 0.22], [0.6, '--room-key-light', 0.06], [1, '--room-key-light', 0]], { cx: sc.x, cy: sc.y, rx: 70 });
  s += `<circle cx="${f(sc.x)}" cy="${f(sc.y)}" r="70" fill="${bloom}"/>`;
  // The drum: the front between its top ring's front arc and its bottom's.
  const arc = (y, from, to, n = 24) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = from + (to - from) * (i / n);
      out.push(P(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
    return out;
  };
  const tFront = arc(top, Math.PI, 0); // left to right, through the front
  const bFront = arc(sb, 0, Math.PI); // right to left
  const drum = d([...tFront, ...bFront]);
  const lin = defs.radial([[0, '--room-shade-hot'], [0.45, '--room-shade-hi'], [0.85, '--room-shade-lo'], [1, '--room-shade-edge']], { cx: sc.x, cy: sc.y + 1, rx: r * sc.k * 1.05, ry: shadeH * sc.k * 0.75 });
  s += `<path d="${drum}" fill="${lin}"/>`;
  // The top's lip, and the light out of the top opening.
  const tBack = arc(top, 0, -Math.PI);
  s += `<path d="${d([...tFront, ...tBack.slice(1, -1)])}" ${fill('--room-shade-lo', 0.6)}/>`;
  s += `<path d="${d(arc(sb, Math.PI, 0))}" fill="none" style="stroke:var(--room-shade-edge)" stroke-width=".9"/>`;
  s += `<path d="${d(tFront)}" fill="none" style="stroke:var(--room-shade-edge)" stroke-width=".7"/>`;
  // The glow spilling out of the bottom, onto the pole's top and below.
  const under = P(cx, sb - 4, cz);
  const ug = defs.radial([[0, '--room-shade-hot', 0.75], [1, '--room-shade-hot', 0]], { cx: under.x, cy: under.y, rx: 14, ry: 5 });
  s += `<ellipse cx="${f(under.x)}" cy="${f(under.y)}" rx="14" ry="5" fill="${ug}"/>`;
  return s;
}

/** table: a round walnut side table on three legs. */
export function table(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const cx = o.at.x + o.size.w / 2, cz = o.at.z + o.size.d / 2, r = o.size.w / 2, h = o.size.h;
  let s = grounded(ctx, { at: { x: cx - r * 0.7, y: 0, z: cz - r * 0.7 }, size: { w: r * 1.4, h, d: r * 1.4 } }, { strength: 0.8 });
  // Three legs, splayed, from under the top to the floor.
  for (const a of [Math.PI * 0.15, Math.PI * 0.85, Math.PI * 1.5]) {
    const t1 = P(cx + Math.cos(a) * r * 0.32, h - 4, cz + Math.sin(a) * r * 0.32);
    const b1 = P(cx + Math.cos(a) * r * 0.8, 0, cz + Math.sin(a) * r * 0.8);
    const lg = defs.linear([[0, '--room-walnut-hi'], [1, '--room-walnut-deep']], { x1: t1.x - 1.4, y1: 0, x2: t1.x + 1.4, y2: 0, user: true });
    s += `<path d="M${f(t1.x - 1.6)},${f(t1.y)}L${f(t1.x + 1.6)},${f(t1.y)}L${f(b1.x + 0.8)},${f(b1.y)}L${f(b1.x - 0.8)},${f(b1.y)}Z" fill="${lg}"/>`;
  }
  // The top's edge, then its face.
  const topR = ring(P, cx, h, cz, r, 56), lowR = ring(P, cx, h - 3, cz, r, 56);
  const edge = [];
  for (let i = 0; i <= 28; i++) edge.push(topR[i % 56]);
  for (let i = 28; i >= 0; i--) edge.push(lowR[i % 56]);
  s += `<path d="${d(edge)}" ${fill('--room-walnut-lo')}/>`;
  s += `<path d="${d(edge)}" ${fill('--room-shadow', 0.35)}/>`;
  const c = P(cx, h, cz);
  const tg = defs.radial([[0, '--room-walnut-hi'], [0.7, '--room-walnut'], [1, '--room-walnut-lo']], { cx: c.x, cy: c.y - 2, rx: r * c.k, ry: r * c.k * 0.3 });
  s += `<path d="${d(topR)}" fill="${tg}" filter="url(#${id}-wood)"/>`;
  s += wash(ctx, d(topR), { x: 0, y: 1, z: 0 }, { x: cx, y: h, z: cz - r }, { x: cx, y: h, z: cz + r }, P(cx, h, cz - r), P(cx, h, cz + r), { warm: 0.5, dark: 0.3 });
  // The lamp in the varnish: on the top, on the line toward the lamp.
  const toward = { x: L.at.x - cx, z: L.at.z - cz };
  const n = Math.hypot(toward.x, toward.z) || 1;
  const hl = P(cx + (toward.x / n) * r * 0.45, h, cz + (toward.z / n) * r * 0.45);
  s += `<ellipse cx="${f(hl.x)}" cy="${f(hl.y)}" rx="${f(r * 0.35 * hl.k)}" ry="${f(r * 0.07 * hl.k)}" ${fill('--room-glint', 0.18)} filter="url(#${id}-soft-m)"/>`;
  return s;
}

/** glass: a tumbler with two fingers of whisky and a cube of ice. */
export function glass(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const cx = o.at.x + o.size.w / 2, cz = o.at.z + o.size.d / 2, r = o.size.w / 2, y0 = o.at.y, h = o.size.h;
  const lvl = y0 + h * 0.42;
  const rim = ring(P, cx, y0 + h, cz, r, 32), base = ring(P, cx, y0, cz, r * 0.92, 32), liq = ring(P, cx, lvl, cz, r * 0.94, 32);
  const half = (top, bot) => d([...top.slice(0, 17), ...bot.slice(0, 17).reverse()]);
  // The amber light it throws on the table, away from the lamp.
  const away = { x: cx - L.at.x, z: cz - L.at.z };
  const n = Math.hypot(away.x, away.z) || 1;
  const cau = P(cx + (away.x / n) * r * 2.2, y0, cz + (away.z / n) * r * 2.2);
  let s = `<ellipse cx="${f(cau.x)}" cy="${f(cau.y)}" rx="${f(r * 1.8 * cau.k)}" ry="${f(r * 0.6 * cau.k)}" ${fill('--room-whisky', 0.32)} filter="url(#${id}-soft-m)"/>`;
  s += `<path d="${d(base)}" ${fill('--room-shadow', 0.4)}/>`;
  // The whisky, its surface, the ice.
  const lg = defs.linear([[0, '--room-whisky-lo'], [0.5, '--room-whisky'], [1, '--room-whisky-lo']], { x1: P(cx - r, lvl, cz).x, y1: 0, x2: P(cx + r, lvl, cz).x, y2: 0, user: true });
  s += `<path d="${half(liq, base)}" fill="${lg}"/>`;
  s += `<path d="${d(liq)}" ${fill('--room-whisky-hi', 0.85)}/>`;
  const ic = P(cx - r * 0.15, lvl + 1.2, cz);
  s += `<rect x="${f(ic.x - 2.6)}" y="${f(ic.y - 2.4)}" width="5" height="4.2" rx=".9" transform="rotate(-12 ${f(ic.x)} ${f(ic.y)})" ${fill('--room-glint', 0.42)}/>`;
  // The glass itself: its walls, the rim, a long highlight on the lamp's side.
  s += `<path d="${half(rim, base)}" ${fill('--room-glass')}/>`;
  s += `<path d="${d(rim)}" fill="none" style="stroke:var(--room-glint)" stroke-opacity=".55" stroke-width=".35"/>`;
  const side = L.at.x < cx ? -1 : 1;
  const h1 = P(cx + side * r * 0.62, y0 + h * 0.92, cz + r * 0.6), h2 = P(cx + side * r * 0.6, y0 + h * 0.12, cz + r * 0.6);
  s += `<path d="M${f(h1.x)},${f(h1.y)}L${f(h2.x)},${f(h2.y)}" style="stroke:var(--room-glint)" stroke-opacity=".75" stroke-width=".7" stroke-linecap="round"/>`;
  return s;
}
