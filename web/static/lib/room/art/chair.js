// web/static/lib/room/art/chair.js
// The chair: a leather club chair, the one you sit down in. Built from its
// parts as boxes in the room -- the plinth, two rolled arms, the back, the
// seat cushion and a loose cushion against the back -- each projected and lit
// face by face from where the lamp and the window are, so the tops and the
// side toward the lamp catch it and the fronts sit in the chair's own shade.
// A knitted throw over its left arm.

import { f, d, fill, rng } from './kit.js';
import { keyLight } from '../space.js';
import { grounded } from './hifi.js';

/** rr is a rounded rectangle in picture units, with its own corner radii (tl, tr, br, bl). */
function rr(x, y, w, h, [tl, tr, br, bl]) {
  return `M${f(x + tl)},${f(y)}H${f(x + w - tr)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + tr)}V${f(y + h - br)}Q${f(x + w)},${f(y + h)} ${f(x + w - br)},${f(y + h)}H${f(x + bl)}Q${f(x)},${f(y + h)} ${f(x)},${f(y + h - bl)}V${f(y + tl)}Q${f(x)},${f(y)} ${f(x + tl)},${f(y)}Z`;
}

/** leather paints a face: the hide, its grain, its light, and an edge of piping. */
function leather(ctx, shape, normal, point, grad, { piping = true, sheen = 0 } = {}) {
  const { id } = ctx;
  const l = ctx.light(normal, point);
  let s = `<path d="${shape}" fill="${grad}" filter="url(#${id}-grain)"/>`;
  if (l.key > 0.01) s += `<path d="${shape}" ${fill('--room-key-light', l.key * 0.5)}/>`;
  if (l.fill > 0.01) s += `<path d="${shape}" ${fill('--room-fill-light', l.fill * 0.35)}/>`;
  const dark = Math.max(0, 0.62 - l.key * 1.3 - l.fill * 0.4);
  if (dark > 0.01) s += `<path d="${shape}" ${fill('--room-shadow', dark)}/>`;
  if (sheen) s += `<path d="${shape}" ${fill('#000')} filter="url(#${id}-sheen)" opacity="${f(sheen)}"/>`;
  if (piping) s += `<path d="${shape}" fill="none" style="stroke:var(--room-leather-edge)" stroke-width="1.1" stroke-opacity=".9"/>`;
  return s;
}

export function chair(o, ctx) {
  const { defs, P, id } = ctx;
  const L = keyLight(ctx.room);
  const X = o.at.x, Z = o.at.z, W = o.size.w, D = o.size.d, H = o.size.h;
  const zF = Z + D; // the arms' fronts
  const armW = 27, armH = 64, seatY = 50, plinthY = 7;
  const xl0 = X, xl1 = X + armW, xr0 = X + W - armW, xr1 = X + W;
  const backZ0 = Z, backZ1 = Z + 26;
  const eyeRight = ctx.view.eye.x > xr1;
  const hide = (a, b, c) => defs.linear([[0, '--room-leather-hi'], [0.45, '--room-leather'], [1, '--room-leather-lo']], { x1: a.x, y1: a.y, x2: b.x, y2: b.y, user: true, ...(c || {}) });
  let s = grounded(ctx, o, { strength: 1 });

  // Bun feet.
  for (const fx of [xl0 + 6, xr1 - 6]) for (const fz of [Z + 8, zF - 6]) {
    const p = P(fx, 3, fz);
    s += `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(4 * p.k)}" ry="${f(3.2 * p.k)}" ${fill('--room-walnut-deep')}/>`;
  }

  // The back: its top (rolled), its face above the seat, and the side the eye sees.
  const bt = [P(X + 4, H, backZ0), P(X + W - 4, H, backZ0), P(X + W - 4, H - 3, backZ1), P(X + W / 2, H, backZ1 + 3), P(X + 4, H - 3, backZ1)];
  const bf0 = P(X + 4, H, backZ1), bf1 = P(X + W - 4, seatY, backZ1);
  const backFace = rr(bf0.x, bf0.y - 3, bf1.x - bf0.x, bf1.y - bf0.y + 3, [10, 10, 0, 0]);
  if (eyeRight) {
    const side = [P(X + W - 4, plinthY, backZ0), P(X + W - 4, H - 6, backZ0), P(X + W - 4, H - 6, backZ1), P(X + W - 4, plinthY, backZ1)];
    s += leather(ctx, d(side), { x: 1, y: 0, z: 0 }, { x: X + W, y: H * 0.7, z: (backZ0 + backZ1) / 2 }, hide(side[1], side[0]), { piping: false });
  }
  s += leather(ctx, d(bt), { x: 0, y: 1, z: 0.2 }, { x: X + W / 2, y: H, z: backZ0 + 13 }, hide(bt[0], bt[3]), { piping: false, sheen: 0.9 });
  s += leather(ctx, backFace, { x: 0, y: 0.15, z: 1 }, { x: X + W / 2, y: (H + seatY) / 2, z: backZ1 }, hide(bf0, P(X + W / 2, seatY, backZ1)), { sheen: 0.5 });
  // A welt across the back, under its roll.
  const w0 = P(X + 8, H - 9, backZ1), w1 = P(X + W - 8, H - 9, backZ1);
  s += `<path d="M${f(w0.x)},${f(w0.y)}L${f(w1.x)},${f(w1.y)}" style="stroke:var(--room-leather-crease)" stroke-width="1" stroke-opacity=".8"/>`;
  s += `<path d="M${f(w0.x)},${f(w0.y + 1)}L${f(w1.x)},${f(w1.y + 1)}" style="stroke:var(--room-leather-hi)" stroke-width=".5" stroke-opacity=".4"/>`;

  // The loose cushion against the back, plump, its seams showing.
  const c0 = P(xl1 + 3, seatY + 38, backZ1 + 6), c1 = P(xr0 - 3, seatY + 2, backZ1 + 6);
  const cush = rr(c0.x, c0.y, c1.x - c0.x, c1.y - c0.y, [12, 12, 6, 6]);
  s += `<path d="${cush}" ${fill('--room-shadow', 0.5)} transform="translate(2 3)" filter="url(#${id}-soft-m)"/>`;
  s += leather(ctx, cush, { x: 0, y: 0.35, z: 1 }, { x: X + W / 2, y: seatY + 20, z: backZ1 + 6 }, hide(c0, c1), { sheen: 0.8 });
  const seam = rr(c0.x + 3, c0.y + 3, c1.x - c0.x - 6, c1.y - c0.y - 6, [10, 10, 4, 4]);
  s += `<path d="${seam}" fill="none" style="stroke:var(--room-leather-crease)" stroke-width=".5" stroke-dasharray="1.4 1" stroke-opacity=".8"/>`;

  // The seat cushion: its top, then its front, with a welt along the edge.
  const st = [P(xl1, seatY, backZ1 + 8), P(xr0, seatY, backZ1 + 8), P(xr0 + 1, seatY, zF - 1), P(xl1 - 1, seatY, zF - 1)];
  s += leather(ctx, d(st), { x: 0, y: 1, z: 0.1 }, { x: X + W / 2, y: seatY, z: (backZ1 + zF) / 2 }, hide(st[0], st[3]), { piping: false, sheen: 0.7 });
  // The shadow the cushion behind throws onto the seat.
  const sg = defs.linear([[0, '--room-shadow', 0.6], [1, '--room-shadow', 0]], { x1: 0, y1: st[0].y, x2: 0, y2: st[0].y + (st[3].y - st[0].y) * 0.45, user: true });
  s += `<path d="${d(st)}" fill="${sg}"/>`;
  const sf0 = P(xl1 - 1, seatY, zF - 1), sf1 = P(xr0 + 1, seatY - 14, zF - 1);
  const seatFront = rr(sf0.x, sf0.y, sf1.x - sf0.x, sf1.y - sf0.y, [5, 5, 3, 3]);
  s += leather(ctx, seatFront, { x: 0, y: 0, z: 1 }, { x: X + W / 2, y: seatY - 7, z: zF }, hide(sf0, sf1));

  // The plinth under the cushion, between the arms: a deep band.
  const pf0 = P(xl1, seatY - 14, zF - 2), pf1 = P(xr0, plinthY, zF - 2);
  const plinth = rr(pf0.x, pf0.y, pf1.x - pf0.x, pf1.y - pf0.y, [0, 0, 3, 3]);
  s += leather(ctx, plinth, { x: 0, y: 0, z: 1 }, { x: X + W / 2, y: 20, z: zF }, hide(pf0, pf1), { piping: false });
  s += `<path d="M${f(pf0.x)},${f(pf0.y + 1)}H${f(pf1.x)}" style="stroke:var(--room-shadow)" stroke-opacity=".55" stroke-width="2.2" filter="url(#${id}-soft-s)"/>`;

  // The arms: the inner face of the left one (it faces the lamp), the outer
  // face of the right one (it faces the eye), then their rolled tops and
  // their scrolled fronts.
  const arm = (x0, x1, left) => {
    let a = '';
    if (left) {
      const inner = [P(x1, seatY, backZ1), P(x1, armH, backZ1), P(x1, armH, zF), P(x1, seatY, zF)];
      a += leather(ctx, d(inner), { x: 1, y: 0, z: 0 }, { x: x1, y: (seatY + armH) / 2, z: (backZ1 + zF) / 2 }, hide(inner[1], inner[0]), { piping: false });
    } else if (eyeRight) {
      const outer = [P(x1, plinthY, backZ0 + 4), P(x1, armH - 4, backZ0 + 4), P(x1, armH - 4, zF - 4), P(x1, plinthY, zF - 4)];
      a += leather(ctx, d(outer), { x: 1, y: 0, z: 0 }, { x: x1, y: armH * 0.6, z: (backZ0 + zF) / 2 }, hide(outer[1], outer[0]), { piping: false });
    }
    // The roll: the top as a band, lightest along its crown, its front end
    // rounded in plan so it turns down into the scroll.
    const rad = (x1 - x0) / 2 + 1, mid = (x0 + x1) / 2, ty = armH + 2;
    const roll = [P(x0 - 1, ty, backZ0 + 8)];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      roll.push(P(mid + Math.cos(a) * rad, ty, zF - rad * 0.55 - Math.sin(a) * rad * 0.55));
    }
    roll.push(P(x1 + 1, ty, backZ0 + 8));
    const crown = defs.linear([[0, '--room-leather-lo'], [0.5, '--room-leather'], [1, '--room-leather-lo']], { x1: roll[1].x, y1: 0, x2: roll[13].x, y2: 0, user: true });
    a += leather(ctx, d(roll), { x: 0, y: 0.6, z: 0.4 }, { x: mid, y: armH, z: (backZ0 + zF) / 2 }, crown, { piping: false });
    a += `<path d="${d(roll)}" ${fill('--room-leather-hi', 0.18)}/>`;
    // It turns down toward the front: darker as it goes over.
    const over = defs.linear([[0, '--room-shadow', 0], [0.75, '--room-shadow', 0], [1, '--room-shadow', 0.3]], { x1: 0, y1: roll[0].y, x2: 0, y2: roll[7].y, user: true });
    a += `<path d="${d(roll)}" fill="${over}"/>`;
    // The crown's highlight, where the lamp catches the roll.
    const c0 = P(mid, ty, backZ0 + 12), c1 = P(mid, ty, zF - rad * 0.5);
    a += `<path d="M${f(c0.x)},${f(c0.y)}L${f(c1.x)},${f(c1.y)}" style="stroke:var(--room-glint)" stroke-opacity="${f(0.1 + ctx.light({ x: 0, y: 1, z: 0 }, { x: mid, y: ty, z: zF - 20 }).key * 0.35)}" stroke-width="2.4" stroke-linecap="round" filter="url(#${id}-soft-s)"/>`;
    // The scroll at the front: a panel, rounded at the top, its pleats
    // radiating from a button.
    const f0 = P(x0 - 1, armH + 3, zF), f1 = P(x1 + 1, plinthY, zF);
    const fw = f1.x - f0.x, fh = f1.y - f0.y;
    const front = rr(f0.x, f0.y, fw, fh, [fw * 0.48, fw * 0.48, 4, 4]);
    const dome = defs.radial([[0, '--room-leather-hi'], [0.55, '--room-leather'], [1, '--room-leather-lo']], { cx: f0.x + fw / 2, cy: f0.y + fw * 0.4, rx: fw * 0.75, ry: fh * 0.8 });
    a += leather(ctx, front, { x: 0, y: 0.2, z: 1 }, { x: (x0 + x1) / 2, y: armH / 2, z: zF }, dome, { sheen: 0.4 });
    const cx = f0.x + fw / 2, cy = f0.y + fw * 0.48;
    let pleats = '';
    for (let i = 0; i < 9; i++) {
      const ang = Math.PI * (1 + i / 8);
      const r0 = fw * 0.12, r1 = fw * 0.44;
      pleats += `M${f(cx + Math.cos(ang) * r0)},${f(cy + Math.sin(ang) * r0)}L${f(cx + Math.cos(ang) * r1)},${f(cy + Math.sin(ang) * r1)}`;
    }
    a += `<path d="${pleats}" fill="none" style="stroke:var(--room-leather-crease)" stroke-width=".7" stroke-opacity=".75"/>`;
    a += `<path d="${pleats}" fill="none" style="stroke:var(--room-leather-hi)" stroke-width=".4" stroke-opacity=".3" transform="translate(.6 .5)"/>`;
    a += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(fw * 0.1)}" ${fill('--room-leather-lo')}/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(fw * 0.1)}" fill="none" style="stroke:var(--room-leather-edge)" stroke-width=".6"/>`;
    // A row of brass nails along the front's foot.
    for (let i = 0; i < 7; i++) {
      const nx = f0.x + 3 + ((fw - 6) * i) / 6;
      a += `<circle cx="${f(nx)}" cy="${f(f1.y - 3.4)}" r=".8" ${fill('--room-plate-lo')}/><circle cx="${f(nx - 0.2)}" cy="${f(f1.y - 3.6)}" r=".35" ${fill('--room-plate-hi')}/>`;
    }
    return a;
  };
  s += arm(xr0, xr1, false);
  s += arm(xl0, xl1, true);

  // The throw, over the left arm: across its top, down its front, in
  // folds, with a fringe.
  {
    const r = rng(17);
    const t0 = P(xl0 + 1, armH + 3, Z + 50), t1 = P(xl1 + 1, armH + 3, Z + 44);
    const t2 = P(xl1 + 2, armH + 3, zF - 9), t3 = P(xl0, armH + 3, zF - 9);
    const drop = P(xl0 - 4, 18, zF + 2), drop2 = P(xl1 + 6, 26, zF + 2);
    const pts = [t0, t1, t2];
    // Down over the scroll, waving at the hem.
    const hem = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      hem.push({ x: drop2.x + (drop.x - drop2.x) * u, y: drop2.y + (drop.y - drop2.y) * u + (i % 2 ? 2.2 : -0.6) + r() });
    }
    const shape = `M${f(t0.x)},${f(t0.y)}Q${f((t0.x + t1.x) / 2)},${f((t0.y + t1.y) / 2 + 2.5)} ${f(t1.x)},${f(t1.y)}L${f(t2.x)},${f(t2.y)}Q${f(drop2.x + 3)},${f(t2.y + 8)} ${f(drop2.x)},${f(drop2.y)}`
      + hem.slice(1).map((p) => `L${f(p.x)},${f(p.y)}`).join('') + `Q${f(drop.x - 4)},${f(t3.y + 10)} ${f(t3.x)},${f(t3.y)}Z`;
    void pts;
    s += `<path d="${shape}" ${fill('--room-shadow', 0.55)} transform="translate(2.2 2)" filter="url(#${id}-soft-m)"/>`;
    const tg = defs.linear([[0, '--room-throw-hi'], [0.5, '--room-throw'], [1, '--room-throw-lo']], { x1: t0.x, y1: t0.y, x2: drop.x, y2: drop.y, user: true });
    s += `<path d="${shape}" fill="${tg}" filter="url(#${id}-knit)"/>`;
    // Folds.
    s += `<path d="M${f(t2.x - 3)},${f(t2.y + 2)}Q${f(drop2.x - 2)},${f(t2.y + 14)} ${f(drop2.x - 4)},${f(drop2.y - 2)}M${f(t3.x + 5)},${f(t3.y + 3)}Q${f(drop.x + 4)},${f(t3.y + 16)} ${f(drop.x + 5)},${f(drop.y - 3)}" fill="none" style="stroke:var(--room-throw-lo)" stroke-width="1.6" stroke-opacity=".55" filter="url(#${id}-soft-s)"/>`;
    const l = ctx.light({ x: 0.3, y: 0.6, z: 0.6 }, { x: X + armW / 2, y: armH, z: zF - 10 });
    s += `<path d="${shape}" ${fill('--room-key-light', l.key * 0.3)}/><path d="${shape}" ${fill('--room-shadow', Math.max(0, 0.3 - l.key))}/>`;
    let fringe = '';
    for (const p of hem) fringe += `M${f(p.x)},${f(p.y)}l${f(-0.3 + r() * 0.6)},${f(2.4 + r() * 1.2)}`;
    s += `<path d="${fringe}" fill="none" style="stroke:var(--room-throw-hi)" stroke-width=".55"/>`;
  }

  void L;
  return s;
}
