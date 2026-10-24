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

/**
 * blit puts a painted layer back on `ctx`, pixel for pixel. A canvas with
 * no size (folded away, or hidden on this screen) has nothing to put back,
 * and drawImage throws on one.
 */
export function blit(ctx, base) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (base.width > 0 && base.height > 0) ctx.drawImage(base, 0, 0);
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
 * same blend of the two the lane's own clip made of it.
 */
export function compositeLane(ctx, { lit, unlit }, x, { W, H, dpr, accent, ghostX = null }) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const cut = x == null ? 0 : Math.max(0, Math.min(cw, x * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!(lit.width > 0 && lit.height > 0 && unlit.width > 0 && unlit.height > 0)) return; // no size: nothing to put back (blit)
  if (cut > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, cut, ch); ctx.clip();
    ctx.drawImage(lit, 0, 0);
    ctx.restore();
  }
  if (cut < cw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(cut, 0, cw - cut, ch); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(unlit, 0, 0);
    ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (x != null) paintHead(ctx, x, W, H, accent);
  if (ghostX != null) paintLaneGhost(ctx, ghostX, W, H, accent);
}
