// web/static/lib/tape/playhead.js
// The Studio's playhead, frame by frame. What a frame does while the tape
// plays is here, and is all it does: where the playhead is now, and putting
// pictures that are already painted back on the canvases with the playhead
// over them. No layout or style is read and no lane is drawn in a frame:
// the lanes, the ruler and the overview are painted only when what they
// show changes (lib/tape/page.js, drawLanes), and a frame is blits and two
// lines. A forced layout a frame took the Studio to 18 fps on a tablet.

/**
 * heardAt is the tape frame the playhead is at `now` (performance.now()),
 * from the last poll's `live` taken at `liveAt`: run on at the tape's rate
 * while it plays (half a second at most past a poll), round the loop as the
 * engine goes round it, and never past the tape's end.
 */
export function heardAt(t, live, liveAt, now) {
  if (!live) return 0;
  let p = live.heard || 0;
  if (live.playing && !(live.count_in > 0) && t && liveAt > 0) {
    const dt = Math.max(0, Math.min(0.5, (now - liveAt) / 1000));
    p += dt * (t.sample_rate || 48000);
    const lp = t.loop;
    if (lp && lp.on && lp.out > lp.in && live.heard < lp.out && p >= lp.out) {
      p = lp.in + ((p - lp.in) % (lp.out - lp.in));
    }
  }
  return t ? Math.min(Math.round(p), t.length) : Math.round(p);
}

/** layer is an offscreen canvas `w` x `h` device pixels, reusing `cv`. */
export function layer(cv, w, h, make = () => document.createElement('canvas')) {
  const c = cv || make();
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

// The playhead's line is this many CSS pixels wide (paintHead).
const HEAD_PX = 2;

/**
 * headBand is the strip of a canvas `cw` device pixels wide that a frame
 * changes when the playhead moves from `was` to `x` (CSS pixels, the canvas
 * at `dpr`): from where the layers were cut and the line was drawn to where
 * they are now, and a device pixel either side for antialiased edges, in
 * whole device pixels, { from, to }. Everything between the two changes --
 * lit to unlit, when the loop comes round -- and nothing outside them does,
 * so the rest of the canvas is left as it is: a frame copies a few columns,
 * not the canvas. Without `cut` (the ruler, the overview: one picture, no
 * layers to cut), only the line moves, a whole CSS pixel at a time. An
 * empty band (from == to) when nothing moved: the frame leaves the canvas
 * be. null when the playhead has come or gone (an x of null: none, or off
 * the ruler): the frame puts back all of it.
 */
export function headBand(was, x, dpr, cw, cut = true) {
  if (was == null && x == null) return { from: 0, to: 0 };
  if (was == null || x == null) return null;
  if (Math.round(was) === Math.round(x) && (!cut || was === x)) return { from: 0, to: 0 };
  const at = (v) => [...(cut ? [v * dpr] : []), Math.round(v) * dpr, (Math.round(v) + HEAD_PX) * dpr];
  const edges = [...at(was), ...at(x)];
  const from = Math.min(cw, Math.max(0, Math.floor(Math.min(...edges)) - 1));
  return { from, to: Math.max(from, Math.min(cw, Math.ceil(Math.max(...edges)) + 1)) };
}

/**
 * bandFor is the band (headBand) a frame puts back on a canvas showing
 * `was` to make it show `now`, each { pic, x, gx }: the picture put back
 * (a lane's layers, the ruler's base as last painted), the playhead's x and
 * a locate's (null: none). Over another picture, or with the locate come,
 * gone or moved, nothing on the canvas can be kept: null, all of it.
 * `cut`: the canvas is two layers cut at the playhead (headBand).
 */
export function bandFor(was, now, dpr, cw, cut = true) {
  if (!was || was.pic !== now.pic || was.gx !== now.gx) return null;
  return headBand(was.x, now.x, dpr, cw, cut);
}

/** still says a band leaves the canvas as it is: there is nothing to put back. */
export const still = (band) => !!band && band.to <= band.from;

// clipTo limits what is drawn next to `band`'s columns (none: the canvas).
function clipTo(ctx, band) {
  ctx.save();
  if (!band) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.rect(band.from, 0, band.to - band.from, ctx.canvas.height); ctx.clip();
}

/**
 * blit puts a painted layer back on `ctx`, pixel for pixel: all of it, or
 * the columns of `band` (headBand). A canvas with no size (folded away, or
 * hidden on this screen) has nothing to put back, and drawImage throws on
 * one.
 */
export function blit(ctx, base, band = null) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const from = band ? band.from : 0, to = band ? band.to : cw;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(from, 0, to - from, ch);
  if (!(base.width > 0 && base.height > 0 && to > from)) return;
  if (band) ctx.drawImage(base, from, 0, to - from, ch, from, 0, to - from, ch);
  else ctx.drawImage(base, 0, 0);
}

/**
 * paintMarks draws what goes over a picture put back -- `draw(ctx)`, in CSS
 * pixels at `dpr` -- inside `band` only: the rest of the canvas has them
 * already, and an antialiased line drawn twice over itself darkens.
 */
export function paintMarks(ctx, band, dpr, draw) {
  clipTo(ctx, band);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx);
  ctx.restore();
}

/**
 * paintHead draws the playhead, a 2 px line at `x` across a canvas `W` x `H`
 * (CSS pixels, the context scaled to them), when it's on it.
 */
export function paintHead(ctx, x, W, H, color) {
  if (!(x >= 0 && x <= W)) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), 0, 2, H);
}

/** paintLaneGhost draws a locate not yet heard on a lane: a dashed line. */
export function paintLaneGhost(ctx, gx, W, H, color) {
  if (!(gx >= 0 && gx <= W)) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(Math.round(gx) + 0.5, 0); ctx.lineTo(Math.round(gx) + 0.5, H); ctx.stroke();
  ctx.setLineDash([]);
}

/** paintRulerGhost draws it on the ruler: a hollow marker. */
export function paintRulerGhost(ctx, x, W, color) {
  if (!(x >= 0 && x <= W)) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x - 5, 1); ctx.lineTo(x + 5, 1); ctx.lineTo(x, 9); ctx.closePath(); ctx.stroke();
}

/**
 * compositeLane puts a lane back for a frame from its two layers: `lit`,
 * the lane painted as if all of it had played (its parts' bars glow), left
 * of the playhead at `x` (CSS pixels; null: none of it has), and `unlit`,
 * painted as if none had, right of it; then the playhead, and the dashed
 * line of a locate not yet heard (`ghostX`, or null). The lane drew the
 * played part lit when it was painted every frame, clipped at the playhead;
 * this is the same picture. The two halves are cut with complementary clips
 * and added ('lighter'), so the device pixel the playhead splits is the
 * same blend of the two the lane's own clip made of it. With `band`
 * (headBand), only its columns are put back: what the playhead's move
 * changed since the last frame.
 */
export function compositeLane(ctx, { lit, unlit }, x, { W, H, dpr, accent, ghostX = null, band = null }) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const from = band ? band.from : 0, to = band ? band.to : cw;
  const cut = x == null ? 0 : Math.max(0, Math.min(cw, x * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(from, 0, to - from, ch);
  if (!(lit.width > 0 && lit.height > 0 && unlit.width > 0 && unlit.height > 0)) return; // no size: nothing to put back (blit)
  if (to <= from) return; // the playhead hasn't moved: nothing to put back
  const litTo = Math.min(cut, to), unlitFrom = Math.max(cut, from);
  if (litTo > from) {
    ctx.save();
    ctx.beginPath(); ctx.rect(from, 0, litTo - from, ch); ctx.clip();
    ctx.drawImage(lit, 0, 0);
    ctx.restore();
  }
  if (unlitFrom < to) {
    ctx.save();
    ctx.beginPath(); ctx.rect(unlitFrom, 0, to - unlitFrom, ch); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(unlit, 0, 0);
    ctx.restore();
  }
  paintMarks(ctx, band, dpr, (c) => {
    if (x != null) paintHead(c, x, W, H, accent);
    if (ghostX != null) paintLaneGhost(c, ghostX, W, H, accent);
  });
}
