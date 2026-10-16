// web/static/lib/room/art/window.js
// What is on the wall: the window onto the night city, its curtains, and a
// framed print over the hi-fi. The window is set into the wall, so its
// reveal and sill show as the eye sees them (projected), and the lamp is
// caught in the glass.

import { f, d, fill, op, rng } from './kit.js';
import { keyLight, wallShadow } from '../space.js';

/** window: a sash window, four panes, the city at night beyond it. */
export function sash(o, ctx) {
  const { defs, P, id } = ctx;
  const { x, y } = o.at, { w, h, d: depth } = o.size;
  const L = keyLight(ctx.room);
  let s = '';
  // The opening in the wall, and the glass at the back of it.
  const g = [P(x, y, -depth), P(x + w, y, -depth), P(x + w, y + h, -depth), P(x, y + h, -depth)];
  const gx = g[0].x, gw = g[1].x - g[0].x, gy = g[2].y, gh = g[0].y - g[2].y;
  const clip = defs.id('clip');
  defs.add(`<clipPath id="${clip}"><path d="${d(g)}"/></clipPath>`);
  // The sky: deep at the top, the city's own glow along the bottom.
  const sky = defs.linear([[0, '--room-sky-hi'], [0.62, '--room-sky-lo'], [1, '--room-sky-glow']], { x1: 0, y1: gy, x2: 0, y2: gy + gh, user: true });
  s += `<g clip-path="url(#${clip})"><rect x="${f(gx)}" y="${f(gy)}" width="${f(gw)}" height="${f(gh)}" fill="${sky}"/>`;
  const r = rng(7);
  // A few stars, and the moon behind a thin cloud.
  for (let i = 0; i < 14; i++) s += `<circle cx="${f(gx + r() * gw)}" cy="${f(gy + r() * gh * 0.4)}" r="${f(0.25 + r() * 0.35)}" ${fill('--room-city-cool', 0.35 + r() * 0.4)}/>`;
  const mx = gx + gw * 0.74, my = gy + gh * 0.17;
  const moon = defs.radial([[0, '--room-moon', 0.9], [0.18, '--room-moon', 0.75], [0.22, '--room-moon', 0.18], [1, '--room-moon', 0]], { cx: mx, cy: my, rx: 26 });
  s += `<circle cx="${f(mx)}" cy="${f(my)}" r="26" fill="${moon}"/>`;
  s += `<ellipse cx="${f(mx - 4)}" cy="${f(my + 4)}" rx="22" ry="2.4" ${fill('--room-sky-lo', 0.55)} filter="url(#${id}-soft-s)"/>`;
  // Three ranks of buildings: far and blue, then nearer and darker, each
  // with its lit windows, and a water tower on a near roof.
  const ranks = [
    { base: gy + gh, top: 0.42, tone: '--room-city-far', lit: 0.25, a: 0.9, wmin: 7, wmax: 16 },
    { base: gy + gh, top: 0.58, tone: '--room-city-mid', lit: 0.45, a: 1, wmin: 9, wmax: 20 },
    { base: gy + gh, top: 0.74, tone: '--room-city', lit: 0.6, a: 1, wmin: 12, wmax: 26 },
  ];
  for (const [ri, k] of ranks.entries()) {
    let bx = gx - 4;
    while (bx < gx + gw + 4) {
      const bw = k.wmin + r() * (k.wmax - k.wmin);
      const bh = gh * (1 - k.top) * (0.45 + r() * 0.75);
      const by = k.base - bh;
      s += `<rect x="${f(bx)}" y="${f(by)}" width="${f(bw + 0.4)}" height="${f(bh + 2)}" ${fill(k.tone, k.a)}/>`;
      // A ledge of roof, catching nothing.
      if (r() > 0.5) s += `<rect x="${f(bx + bw * 0.2)}" y="${f(by - 2.2)}" width="${f(bw * 0.35)}" height="2.4" ${fill(k.tone, k.a)}/>`;
      // Windows: a grid, some lit warm, a few cool (a television).
      for (let wy = by + 3; wy < k.base - 2; wy += 3.6) {
        for (let wx = bx + 1.6; wx < bx + bw - 1.6; wx += 3) {
          const q = r();
          if (q < k.lit * 0.42) s += `<rect x="${f(wx)}" y="${f(wy)}" width="1.5" height="1.9" ${fill(q < k.lit * 0.07 ? '--room-city-cool' : '--room-city-warm', (0.35 + r() * 0.55) * (ri === 0 ? 0.6 : 1))}/>`;
        }
      }
      if (ri === 2 && bx > gx + gw * 0.15 && bx < gx + gw * 0.4 && !s.includes('data-tower')) {
        const tx = bx + bw * 0.4, ty = by;
        s += `<g data-tower="1" ${fill('--room-city')}><rect x="${f(tx - 0.4)}" y="${f(ty - 7)}" width=".8" height="7"/><rect x="${f(tx + 6.2)}" y="${f(ty - 7)}" width=".8" height="7"/>`
          + `<path d="M${f(tx - 1)},${f(ty - 7)}h9v-8.5q-4.5,-1.6 -9,0z"/><path d="M${f(tx - 1.6)},${f(ty - 15.5)}l5.1,-4.2l5.1,4.2z"/></g>`;
      }
      bx += bw + 0.3 + r() * 1.8;
    }
  }
  // Haze: the city's light in the air low down.
  const haze = defs.linear([[0, '--room-sky-glow', 0], [1, '--room-sky-glow', 0.35]], { x1: 0, y1: gy + gh * 0.45, x2: 0, y2: gy + gh, user: true });
  s += `<rect x="${f(gx)}" y="${f(gy)}" width="${f(gw)}" height="${f(gh)}" fill="${haze}"/>`;
  // The glass: the lamp caught in it, and a sheen across.
  const lr = P(L.at.x, L.at.y, -2 * depth);
  const refl = defs.radial([[0, '--room-key-light', 0.32], [0.3, '--room-key-light', 0.1], [1, '--room-key-light', 0]], { cx: gx + gw * 0.82, cy: -L.at.y + 6, rx: 30, ry: 22 });
  s += `<rect x="${f(gx)}" y="${f(gy)}" width="${f(gw)}" height="${f(gh)}" fill="${refl}"/>`;
  s += `<path d="M${f(gx + gw * 0.08)},${f(gy + gh)}L${f(gx + gw * 0.36)},${f(gy)}h${f(gw * 0.12)}L${f(gx + gw * 0.2)},${f(gy + gh)}z" ${fill('--room-glint', 0.05)}/>`;
  s += `<path d="M${f(gx + gw * 0.55)},${f(gy + gh)}L${f(gx + gw * 0.72)},${f(gy)}h${f(gw * 0.05)}L${f(gx + gw * 0.6)},${f(gy + gh)}z" ${fill('--room-glint', 0.04)}/>`;
  void lr;
  s += '</g>';
  // The reveal: the opening's left side and its foot, which the eye sees
  // from the right and above.
  const lj = [P(x, y, 0), P(x, y + h, 0), P(x, y + h, -depth), P(x, y, -depth)];
  s += `<path d="${d(lj)}" ${fill('--room-plaster-lo')}/><path d="${d(lj)}" ${fill('--room-fill-light', 0.12)}/>`;
  const sillIn = [P(x, y, 0), P(x + w, y, 0), P(x + w, y, -depth), P(x, y, -depth)];
  s += `<path d="${d(sillIn)}" ${fill('--room-plaster-hi')}/>`;
  // The sash: a frame and its bars, painted wood, set back at the glass.
  const fr = (ax, ay, bx2, by2) => d([P(ax, ay, -depth + 1), P(bx2, ay, -depth + 1), P(bx2, by2, -depth + 1), P(ax, by2, -depth + 1)]);
  const t = 5;
  let sash = fr(x, y, x + w, y + t) + fr(x, y + h - t, x + w, y + h) + fr(x, y, x + t, y + h) + fr(x + w - t, y, x + w, y + h);
  sash += fr(x + w / 2 - 2.5, y, x + w / 2 + 2.5, y + h) + fr(x, y + h * 0.48 - 3, x + w, y + h * 0.48 + 3);
  s += `<path d="${sash}" ${fill('--room-sash')}/>`;
  // The meeting rail's top catches the city's light.
  s += `<path d="${fr(x + t, y + h * 0.48 + 2.2, x + w - t, y + h * 0.48 + 3)}" ${fill('--room-fill-light', 0.3)}/>`;
  // The sill: a board standing out of the wall, its top lit.
  const sd = 9, sy = y - 1;
  const top = [P(x - 6, sy, 0), P(x + w + 6, sy, 0), P(x + w + 6, sy, sd), P(x - 6, sy, sd)];
  const front = [P(x - 6, sy, sd), P(x + w + 6, sy, sd), P(x + w + 6, sy - 4, sd), P(x - 6, sy - 4, sd)];
  s += `<path d="${d(front)}" ${fill('--room-sash')}/><path d="${d(top)}" ${fill('--room-sash-hi')}/>`;
  s += `<path d="${d(top)}" ${fill('--room-fill-light', 0.2)}/>`;
  const shade = wallShadow({ at: { x: x - 6, y: sy - 4, z: 0 }, size: { w: w + 12, h: 4, d: sd } }, L);
  s = `<path d="${d(front.map((p) => ({ x: p.x + shade.dx * 0.6, y: p.y + 3 })))}" ${fill('--room-shadow', 0.5)} filter="url(#${id}-soft-m)"/>` + s;
  return s;
}

/** curtain: two heavy drapes on a brass rod, folds lit from the lamp's side. */
export function curtain(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const { x, y, z } = o.at, { w, h } = o.size;
  const top = y + h;
  let s = '';
  // The rod, and its rings.
  const rod = [P(x - 6, top + 2, z + 6), P(x + w + 6, top + 2, z + 6), P(x + w + 6, top - 1, z + 6), P(x - 6, top - 1, z + 6)];
  const panel = (px, pw, tie, seed) => {
    const r = rng(seed);
    const folds = Math.round(pw / 7);
    const pts = [];
    // The top edge, gathered, and the hem.
    const fold = [];
    for (let i = 0; i <= folds; i++) {
      const u = i / folds;
      fold.push({ u, dz: (i % 2 ? 5 : 0) + r() * 2 });
    }
    // The drape narrows at a tie-back (tie: the height, and which side it pulls to).
    const xAt = (u, yy) => {
      if (!tie) return px + u * pw;
      const k = Math.max(0, 1 - Math.abs(yy - tie.y) / tie.spread);
      const pull = tie.to === 'left' ? px : px + pw;
      return px + u * pw + (pull - (px + u * pw)) * k * tie.amount;
    };
    const ys = [];
    for (let yy = top; yy >= y; yy -= 6) ys.push(yy);
    ys.push(y);
    const left = ys.map((yy) => P(xAt(0, yy), yy, z));
    const right = ys.map((yy) => P(xAt(1, yy), yy, z)).reverse();
    // The hem waves with the folds.
    const hem = fold.map((fo) => P(xAt(fo.u, y), y - (fo.dz > 3 ? 1.5 : 0), z + fo.dz)).reverse();
    pts.push(...left, ...hem.reverse().reverse(), ...right);
    const shape = d([...left, ...[...fold].map((fo) => P(xAt(fo.u, y), y - (fo.dz > 3 ? 1.6 : 0), z + fo.dz)), ...right]);
    // The folds as a gradient across the panel: each ridge lit on the side
    // the lamp is on, its valley dark.
    const a = P(xAt(0, top), top, z), b = P(xAt(1, top), top, z);
    const lampRight = L.at.x > px + pw / 2;
    const stops = [];
    for (let i = 0; i < folds; i++) {
      const u0 = i / folds, u1 = (i + 1) / folds, um = (u0 + u1) / 2;
      const lit = lampRight ? [u0, '--room-curtain-lo'] : [u0, '--room-curtain-hi'];
      stops.push([lit[0], lit[1]], [um, '--room-curtain'], [u1 - 0.002, lampRight ? '--room-curtain-hi' : '--room-curtain-lo']);
    }
    const g = defs.linear(stops, { x1: a.x, y1: 0, x2: b.x, y2: 0, user: true });
    let p = `<path d="${shape}" fill="${g}" filter="url(#${id}-grain)"/>`;
    // The light on the panel as a whole: how near the lamp it hangs.
    const c = { x: px + pw / 2, y: y + h * 0.5, z: z + 4 };
    const lv = ctx.light({ x: 0.2 * Math.sign(L.at.x - c.x), y: 0, z: 1 }, c);
    const lg = defs.linear([[0, '--room-key-light', 0], [0.55, '--room-key-light', lv.key * 0.32], [1, '--room-key-light', lv.key * 0.12]], { x1: 0, y1: -top, x2: 0, y2: -y, user: true });
    p += `<path d="${shape}" fill="${lg}"/>`;
    p += `<path d="${shape}" ${fill('--room-fill-light', lv.fill * 0.25)}/>`;
    // Shade toward the floor and at the top under the rod.
    const sg = defs.linear([[0, '--room-shadow', 0.55], [0.12, '--room-shadow', 0], [0.8, '--room-shadow', 0], [1, '--room-shadow', 0.35]], { x1: 0, y1: -top, x2: 0, y2: -y, user: true });
    p += `<path d="${shape}" fill="${sg}"/>`;
    // A shadow it casts on the wall, away from the lamp.
    const sh = wallShadow({ at: { x: px, y, z: 0 }, size: { w: pw, h, d: 10 } }, L);
    const shadow = `<path d="${shape}" ${fill('--room-shadow', 0.45)} transform="translate(${f(sh.dx * 0.5)} ${f(Math.max(1, sh.dy * 0.2))})" filter="url(#${id}-soft-l)"/>`;
    const cord = '';
    return shadow + p + cord;
  };
  const wl = 46, wr = 50;
  s += panel(x, wl, { y: 108, spread: 70, to: 'left', amount: 0.25 }, 3);
  s += panel(x + w - wr, wr, { y: 108, spread: 70, to: 'right', amount: 0.3 }, 5);
  const rg = defs.linear([[0, '--room-plate-hi'], [0.5, '--room-plate-lo'], [1, '--room-walnut-deep']], { x1: 0, y1: rod[2].y, x2: 0, y2: rod[0].y, user: true });
  s += `<path d="${d(rod)}" fill="${rg}"/>`;
  for (const ex of [x - 8, x + w + 8]) {
    const e = P(ex, top + 0.5, z + 6);
    s += `<circle cx="${f(e.x)}" cy="${f(e.y)}" r="2.6" ${fill('--room-plate-lo')}/><circle cx="${f(e.x - 0.7)}" cy="${f(e.y - 0.7)}" r="1" ${fill('--room-plate-hi', 0.8)}/>`;
  }
  return s;
}

/** poster: a framed print over the hi-fi -- a record, drawn big, no words. */
export function poster(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const { x, y } = o.at, { w, h } = o.size;
  const a = P(x, y + h, 3), b = P(x + w, y, 3);
  const W = b.x - a.x, H = b.y - a.y;
  const sh = wallShadow(o, L);
  let s = `<rect x="${f(a.x + sh.dx * 3)}" y="${f(a.y + Math.max(2, sh.dy * 3))}" width="${f(W)}" height="${f(H)}" ${fill('--room-shadow', 0.55)} filter="url(#${id}-soft-m)"/>`;
  s += `<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(W)}" height="${f(H)}" rx=".6" ${fill('--room-walnut-deep')}/>`;
  const m = 3.2;
  s += `<rect x="${f(a.x + m)}" y="${f(a.y + m)}" width="${f(W - 2 * m)}" height="${f(H - 2 * m)}" ${fill('--room-poster')}/>`;
  // The print: a sunset band, and a record half out of its sleeve.
  const px = a.x + m + 4, py = a.y + m + 4, pw = W - 2 * m - 8, ph = H - 2 * m - 8;
  s += `<rect x="${f(px)}" y="${f(py)}" width="${f(pw)}" height="${f(ph)}" ${fill('--room-poster-ink')}/>`;
  const band = defs.linear([[0, '--room-poster-sun'], [1, '--stripe-1']], { x1: 0, y1: 0, x2: 0, y2: 1 });
  s += `<rect x="${f(px)}" y="${f(py + ph * 0.55)}" width="${f(pw)}" height="${f(ph * 0.45)}" fill="${band}"/>`;
  const cx = px + pw * 0.58, cy = py + ph * 0.52, rr = ph * 0.36;
  s += `<rect x="${f(px + pw * 0.12)}" y="${f(cy - rr)}" width="${f(rr * 2)}" height="${f(rr * 2)}" ${fill('--room-poster')}/>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr)}" ${fill('--room-vinyl')}/>`;
  for (let i = 1; i < 5; i++) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr * (0.45 + i * 0.12))}" fill="none" style="stroke:var(--room-glint)" stroke-opacity=".08" stroke-width=".3"/>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr * 0.32)}" ${fill('--stripe-4')}/><circle cx="${f(cx)}" cy="${f(cy)}" r=".7" ${fill('--room-poster-ink')}/>`;
  // Glass over it: the lamp's light falls across from the left.
  const gl = ctx.light({ x: 0, y: 0, z: 1 }, { x: x + w / 2, y: y + h / 2, z: 3 });
  const glare = defs.linear([[0, '--room-glint', 0.18 * (0.5 + gl.key)], [0.35, '--room-glint', 0.02], [1, '--room-glint', 0]], { x1: 0, y1: 0, x2: 1, y2: 0.4 });
  s += `<rect x="${f(a.x + m)}" y="${f(a.y + m)}" width="${f(W - 2 * m)}" height="${f(H - 2 * m)}" fill="${glare}"/>`;
  s += `<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(W)}" height="${f(H)}" ${fill('--room-key-light', gl.key * 0.25)}/>`;
  s += `<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(W)}" height="1" ${fill('--room-walnut-hi', 0.7)}/>`;
  return s;
}

void op;
