// web/static/lib/room/art/kit.js
// What every piece of the room's art is drawn with: a defs registry for
// gradients and filters, the room's colours by token (materials in
// objects.css, so the SVG follows them and the room is the same in both
// schemes), and light: how bright a face of an object is from where the
// room's lights are (lib/room/space.js), so shading is derived, not painted.
//
// An art function is
//
//   draw(o, ctx) → an SVG string for the object o (an entry of ROOM.objects)
//
// where ctx is {view, P, defs, lights, light(normal, point), room}. P projects a
// room point to the picture. Nothing here touches the DOM.

/** f rounds a number for the SVG: a tenth of a centimetre is plenty. */
export const f = (n) => Math.round(n * 10) / 10;
/** v is a token as an SVG paint, for a style attribute. */
export const v = (t) => `var(${t})`;
/** d is a closed path through picture points. */
export const d = (pts) => `M${pts.map((p) => `${f(p.x)},${f(p.y)}`).join('L')}Z`;
/** fill is a style attribute painting a token, at an opacity. */
export const fill = (token, op = 1) => `style="fill:${token.startsWith('--') ? v(token) : token}${op < 1 ? `;fill-opacity:${f3(op)}` : ''}"`;
const f3 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
export const op = f3;

/** Defs collects what the drawing references by id. */
export class Defs {
  constructor(prefix = 'ra') { this.p = prefix; this.n = 0; this.items = []; }
  id(kind) { return `${this.p}-${kind}${++this.n}`; }
  add(markup) { this.items.push(markup); }
  /** stops: [[offset 0..1, token or colour, opacity]]. */
  stops(stops) {
    return stops.map(([o, c, a = 1]) => `<stop offset="${f3(o)}" style="stop-color:${c.startsWith('--') ? v(c) : c};stop-opacity:${f3(a)}"/>`).join('');
  }
  /** linear between two picture points (user space), or across a box (0..1). */
  linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false } = {}) {
    const id = this.id('l');
    this.add(`<linearGradient id="${id}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${this.stops(stops)}</linearGradient>`);
    return `url(#${id})`;
  }
  /** radial about a picture point (user space), squashed by ry/rx. */
  radial(stops, { cx, cy, rx, ry = rx, user = true, fx, fy } = {}) {
    const id = this.id('r');
    const t = user && ry !== rx ? ` gradientTransform="translate(${f(cx)} ${f(cy)}) scale(1 ${f3(ry / rx) || 0.001}) translate(${f(-cx)} ${f(-cy)})"` : '';
    const focal = fx != null ? ` fx="${f(fx)}" fy="${f(fy)}"` : '';
    this.add(user
      ? `<radialGradient id="${id}" cx="${f(cx)}" cy="${f(cy)}" r="${f(rx)}"${focal} gradientUnits="userSpaceOnUse"${t}>${this.stops(stops)}</radialGradient>`
      : `<radialGradient id="${id}" cx="${cx ?? 0.5}" cy="${cy ?? 0.5}" r="${rx ?? 0.5}"${focal}>${this.stops(stops)}</radialGradient>`);
    return `url(#${id})`;
  }
  toString() { return this.items.join(''); }
}

/**
 * The textures, once per drawing, as filters any piece can wear:
 * - room-grain: a fine noise multiplied in (fabric, plaster, leather);
 * - room-wood: a long, stretched noise (grain along x);
 * - room-knit: a coarse noise for the throw;
 * - room-soft-*: blurs, for shadows and glows.
 * All static: rendered once, never animated.
 */
export function textures(prefix) {
  const n = (id, freq, oct, amount, seed = 3) => `<filter id="${prefix}-${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" result="n"/>`
    + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -${amount} ${amount * 0.62}" result="a"/>`
    + `<feComposite in="a" in2="SourceAlpha" operator="in" result="m"/>`
    + `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="m"/></feMerge></filter>`;
  const blur = (id, s) => `<filter id="${prefix}-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${s}"/></filter>`;
  return n('grain', '2.4', 2, 0.7) + n('wood', '0.012 0.55', 3, 1.4, 7) + n('knit', '1.3 0.7', 2, 0.9, 11) + n('plaster', '0.06', 3, 0.5, 5)
    + blur('soft-s', 0.8) + blur('soft-m', 2.5) + blur('soft-l', 7) + blur('soft-xl', 18)
    // Leather's sheen: only the specular, from the lamp, off the shape's
    // alpha as its height (the shape itself is not drawn).
    + `<filter id="${prefix}-sheen" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">`
    + `<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>`
    + `<feSpecularLighting in="h" surfaceScale="4" specularConstant=".55" specularExponent="18" lighting-color="#ffd9a8" result="s"><fePointLight x="SX" y="SY" z="160"/></feSpecularLighting>`
    + `<feComposite in="s" in2="SourceAlpha" operator="in"/></filter>`;
}

/** ellipse on the floor (or any level y): a projected circle as a polygon. */
export function ring(P, cx, y, cz, r, n = 48, rz = r) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(P(cx + Math.cos(a) * r, y, cz + Math.sin(a) * rz));
  }
  return out;
}

/** rng is a small seeded random, so the city's windows and the books stay put. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
