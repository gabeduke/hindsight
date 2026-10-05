// web/static/lib/tape/align.js
// Aligning a clip on the tape: where it sounds, how tape frames map to its
// pool file's frames, the view of its file under a tape view, and the moves
// Hit → Grid and Hit → Track make, and the clip editor's sums: where a move
// lands, the view about the hit, how the readout reads, finding a hit near a
// pool file's start, and finding the reference track's hit for Hit → Track.
// Pure; node-tested.
import { snapFrame, nudgeFrames } from './geometry.js';
import { viewAbout, fmtSample, beatOffset, fmtOffset } from '../wave/boundary.js';
import { MIN_FPP } from '../edit/gestures.js';
import { findAttack } from '../wave/onset.js';

/** soundingAt is the tape frame a clip's first frame is heard at: its at plus its nudge. */
export function soundingAt(clip, sampleRate) {
  return clip.at + nudgeFrames(clip, sampleRate);
}

/** toFile is the clip's pool-file frame heard at tape frame f. */
export function toFile(clip, f, sampleRate) {
  return f - soundingAt(clip, sampleRate) + clip.src;
}

/** toTape is the tape frame where the clip's pool-file frame k is heard. */
export function toTape(clip, k, sampleRate) {
  return k - clip.src + soundingAt(clip, sampleRate);
}

/**
 * fileView is the view of a clip's pool file under a tape view ({from, to})
 * width px wide: { start, fpp, width } in file frames, for the take page's
 * tile cache.
 */
export function fileView(clip, view, width, sampleRate) {
  const fpp = (view.to - view.from) / width;
  return { start: toFile(clip, view.from, sampleRate), fpp, width };
}

/**
 * gridMove is how far Hit → Grid moves a clip whose hit sounds at tape frame
 * hit: to the nearest line of the snap (the beat with the snap off). 0
 * without a grid.
 */
export function gridMove(hit, grid, snap) {
  if (!grid) return 0;
  return snapFrame(grid, hit, snap === 'off' ? 'beat' : snap) - hit;
}

/** beatGrid is the tape grid as the take page's beat maths wants it. */
export function beatGrid(grid, sampleRate) {
  if (!grid) return { bpm: null, sampleRate, downbeat: 0 };
  return { bpm: (grid.bars * 4 * 60 * sampleRate) / grid.frames, sampleRate, downbeat: 0 };
}

/**
 * clipUnder is the clip on a track heard at tape frame f -- the top layer
 * where several are -- or null.
 */
export function clipUnder(track, f, sampleRate) {
  let best = null;
  for (const c of track.clips || []) {
    const s = soundingAt(c, sampleRate);
    if (f >= s && f < s + c.frames && (!best || c.layer > best.layer)) best = c;
  }
  return best;
}

/**
 * placeAt is where a clip moved by delta may go: a whole frame, not before
 * the tape's start, and starting before its end (as a slide allows).
 */
export function placeAt(clip, delta, length) {
  return Math.min(length - 1, Math.max(0, Math.round(clip.at + delta)));
}

/**
 * alignLand is where the clip editor's move of a clip's point -- its first
 * hit, hitOff frames into where it sounds -- to tape frame f lands, with the
 * clip at `at` now: { at, point }, the clip kept on the tape (placeAt).
 */
export function alignLand(clip, at, hitOff, f, length, sampleRate) {
  const c = { ...clip, at };
  const next = placeAt(c, f - (soundingAt(c, sampleRate) + hitOff), length);
  return { at: next, point: soundingAt({ ...clip, at: next }, sampleRate) + hitOff };
}

/**
 * alignEdge is the tape's end that stops a move of the point to tape frame f
 * short of it (as alignLand clamps): 'start', 'end', or '' when it gets there.
 */
export function alignEdge(clip, at, hitOff, f, length, sampleRate) {
  const want = Math.round(at + f - (soundingAt({ ...clip, at }, sampleRate) + hitOff));
  return want < 0 ? 'start' : want > length - 1 ? 'end' : '';
}

/**
 * alignView is the tape view ({from, to}, whole frames) width px wide at
 * fpp with frame in the middle, or as near as the tape's ends allow: no
 * closer than MIN_FPP, no wider than the tape.
 */
export function alignView(frame, fpp, width, length) {
  const v = viewAbout(frame, fpp, width, length, MIN_FPP);
  const span = Math.min(length, Math.max(1, Math.round(MIN_FPP * width), Math.round(v.width * v.fpp)));
  const from = Math.min(Math.max(0, Math.round(frame - span / 2)), Math.max(0, length - span));
  return { from, to: from + span };
}

/** clipNumber is a clip's place on its track, counting from 1 by where each starts. */
export function clipNumber(track, clip) {
  const order = [...(track.clips || [])].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return order.findIndex((c) => c.id === clip.id) + 1;
}

/**
 * alignReadout is the clip editor's readout: the clip, its point to the
 * sample, the point's offset from the nearest beat (with a tempo), and from
 * the reference track's hit once Hit → Track has found one (ref: { track,
 * hit }): "Clip 2.1 0:02.500 +31 · +2.5 ms from 5.1 · −1.3 ms from track 1".
 * With no hit found, the point is the clip's start, and says so (start).
 */
export function alignReadout({ track, n, point, sampleRate, grid, ref, start = false }) {
  const parts = [`Clip ${track}.${n} ${start ? 'start ' : ''}${fmtSample(point, sampleRate)}`];
  const off = fmtOffset(beatOffset(point, beatGrid(grid, sampleRate)));
  if (off) parts.push(off);
  if (ref) {
    const ms = ((point - ref.hit) * 1000) / sampleRate;
    const sign = Math.abs(ms) < 0.05 ? '' : ms > 0 ? '+' : '−';
    parts.push(`${sign}${Math.abs(ms).toFixed(1)} ms from track ${ref.track}`);
  }
  return parts.join(' · ');
}

/** PAD_MS is how far before its pool file's start padStart lengthens the audio. */
export const PAD_MS = 150;

/**
 * padStart lengthens audio that begins at its pool file's start ({ x, from:
 * 0 }) by at least PAD_MS in front, the file's overhang before the clip --
 * x[0, over) -- mirrored back and forth: { x, from } with from below 0. A
 * pool file keeps only a few ms before a clip's src, and findAttack needs
 * about 105 ms behind where it looks to see a hit, so a clip's first hit
 * would be out of its sight. Zeros wouldn't do: anything after silence is a
 * rise. Audio further in, or with no overhang, comes back as it is.
 */
export function padStart(audio, over, sampleRate) {
  const { x, from } = audio;
  const o = Math.min(Math.round(over), x.length);
  if (from !== 0 || o < 1) return audio;
  const P = Math.round((sampleRate * PAD_MS) / 1000);
  const y = new Float32Array(P + x.length);
  y.set(x, P);
  for (let k = 1; k <= P; k++) {
    const m = Math.floor((k - 1) / o), r = (k - 1) % o;
    y[P - k] = x[m % 2 === 0 ? r : o - 1 - r];
  }
  return { x: y, from: -P };
}

/**
 * hitIn is where the strongest hit starting within file frames [a, b] of
 * audio { x, from } starts, in file frames, or -1 (findAttack declines
 * rather than guesses).
 */
export function hitIn(audio, a, b, sampleRate) {
  const { x, from } = audio;
  const i0 = Math.round(a) - from, i1 = Math.round(b) - from;
  if (i1 < i0 || i1 < 0 || i0 >= x.length) return -1;
  const j = findAttack(x, sampleRate, Math.round((i0 + i1) / 2), Math.ceil((i1 - i0) / 2));
  return j < 0 ? -1 : from + j;
}

/** REACH_MS is how far either side of the point Hit → Track looks, at any zoom. */
export const REACH_MS = 60;

/**
 * refClipsNear is what of a reference track is heard within reach of tape
 * frame p, [p − reach, p + reach]: { clip, from, to } (tape frames, to
 * not included) in order, the top layer where clips overlap, as clipUnder
 * has it. A hit right at a clip's start, just after p, is its own; on a
 * tiled loop each copy is searched, not only the one under p.
 */
export function refClipsNear(track, p, reach, sampleRate) {
  const lo = Math.round(p - reach), hi = Math.round(p + reach) + 1;
  const cuts = new Set([lo, hi]);
  for (const c of track.clips || []) {
    const s = soundingAt(c, sampleRate);
    for (const f of [s, s + c.frames]) if (f > lo && f < hi) cuts.add(f);
  }
  const at = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const clip = clipUnder(track, at[i], sampleRate);
    if (!clip) continue;
    const last = out[out.length - 1];
    if (last && last.clip === clip && last.to === at[i]) last.to = at[i + 1];
    else out.push({ clip, from: at[i], to: at[i + 1] });
  }
  return out;
}

/**
 * refHitNear is the hit on a reference track nearest tape frame p, searching
 * each stretch refClipsNear found in its clip's own audio: { clip, k, at },
 * k in the clip's file and at on the tape, or null. audioOf(clip, a, b)
 * answers the clip's file's audio { x, from } round file frames [a, b],
 * with room for Attack either side; near the file's start it is padded
 * (padStart), as for a clip's own first hit.
 */
export async function refHitNear(spans, p, sampleRate, audioOf) {
  let best = null;
  for (const { clip, from, to } of spans) {
    const a = Math.round(toFile(clip, from, sampleRate)), b = Math.round(toFile(clip, to - 1, sampleRate));
    const k = hitIn(padStart(await audioOf(clip, a, b), clip.src, sampleRate), a, b, sampleRate);
    if (k < 0) continue;
    const at = toTape(clip, k, sampleRate);
    if (!best || Math.abs(at - p) < Math.abs(best.at - p)) best = { clip, k, at };
  }
  return best;
}
