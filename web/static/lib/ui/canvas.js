// web/static/lib/ui/canvas.js
// A canvas drawn at the screen's own pixels. The screen's density
// (devicePixelRatio) is the window's, which a component may not read
// (docs/architecture/components.md, Guardrail 15): it asks here, with the
// size its canvas is laid out at, and draws in CSS pixels.

/**
 * sizeCanvas gives canvas `cv` a backing store of `w` × `h` CSS pixels at
 * the density of the window it is in, and answers { ctx, dpr }: its 2D
 * context, scaled so a draw is in CSS pixels, and the density, for what
 * draws hairlines at it. The store is set only when it changes, since
 * setting it clears the canvas. Answers null for a canvas with no width
 * yet (one not laid out), which has nothing to draw.
 */
export function sizeCanvas(cv, w, h) {
  if (!cv || !(w > 0)) return null;
  const win = cv.ownerDocument?.defaultView || globalThis;
  const dpr = win.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(Math.max(0, h || 0) * dpr);
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, dpr };
}
