// web/static/lib/tape/timeedit.js
// Insert and Delete time as the tape page previews them
// (internal/tape/timeedit.go): the tape as it would be, worked out here
// from the tape as it is, so the lanes can draw it before the edit is sent.
// Pure: page.js draws what these answer.

// cutAt splits each clip of a track's list that runs across pos in two there.
function cutAt(clips, pos) {
  const out = [];
  for (const c of clips) {
    if (c.at < pos && pos < c.at + c.frames) {
      out.push({ ...c, frames: pos - c.at, fade_out: 0 });
      out.push({ ...c, id: `${c.id}~`, at: pos, src: c.src + (pos - c.at), frames: c.at + c.frames - pos, fade_in: 0 });
    } else out.push(c);
  }
  return out;
}

// shiftSpan moves a span [at, end) that starts at or after pos by d, and
// stretches one across pos at its end.
function shiftSpan(sp, pos, d, a = 'at', b = 'end') {
  if (sp[a] >= pos) return { ...sp, [a]: sp[a] + d, [b]: sp[b] + d };
  if (sp[b] > pos) return { ...sp, [b]: sp[b] + d };
  return sp;
}

// lowestFree is the lowest layer a clip [at, at+frames) is free on among
// clips, as the Pi's Place finds it.
function lowestFree(clips, at, frames) {
  for (let layer = 0; ; layer++) {
    if (!clips.some((o) => o.layer === layer && o.at < at + frames && at < o.at + o.frames)) return layer;
  }
}

/**
 * insertPreview is the tape after an Insert at frame at of a board (the
 * clipboard, or a kept clip: {tracks, frames}) from track down: every clip
 * from at on pushed later by its length, the sections and loop with them,
 * and the board's clips in the gap, each marked ghost, stacked as the Pi
 * stacks them.
 */
export function insertPreview(tape, at, board, track) {
  const n = board.frames;
  const tracks = tape.tracks.map((tr, i) => {
    const clips = cutAt(tr.clips, at).map((c) => (c.at >= at ? { ...c, at: c.at + n } : c));
    const b = board.tracks[i - (track - 1)];
    if (b) {
      b.forEach((c, j) => {
        const g = { ...c, id: `ghost-${i}-${j}`, at: at + c.at, ghost: true };
        clips.push({ ...g, layer: lowestFree(clips, g.at, g.frames) });
      });
    }
    return { ...tr, clips };
  });
  const loop = tape.loop.out > tape.loop.in ? shiftSpan(tape.loop, at, n, 'in', 'out') : tape.loop;
  return { ...tape, tracks, loop, sections: (tape.sections || []).map((sc) => shiftSpan(sc, at, n)) };
}

// lastFrame is where the last thing on the tape ends: a clip, a section or
// the loop (internal/tape State.lastFrame).
function lastFrame(tape) {
  let end = tape.loop && tape.loop.out > tape.loop.in ? tape.loop.out : 0;
  for (const tr of tape.tracks) for (const c of tr.clips) end = Math.max(end, c.at + c.frames);
  for (const sc of tape.sections || []) end = Math.max(end, sc.end);
  return end;
}

/**
 * insertRefusal is why the Pi would refuse an Insert at frame at of a board
 * from track down, or '' when it wouldn't: the board's tracks don't fit from
 * there, or pushing everything on would run past the tape's end. The page
 * previews only what will happen.
 */
export function insertRefusal(tape, at, board, track) {
  if (track < 1 || track + board.tracks.length - 1 > tape.tracks.length) return 'tracks';
  if (Math.max(lastFrame(tape), at) + board.frames > tape.length) return 'length';
  return '';
}

/**
 * deletePreview is the tape after Delete time on [from, to): that span cut
 * out of every track and the gap closed, the sections cut with it.
 */
export function deletePreview(tape, from, to) {
  const n = to - from;
  const tracks = tape.tracks.map((tr) => {
    const clips = [];
    for (const c of cutAt(cutAt(tr.clips, from), to)) {
      if (c.at >= from && c.at < to) continue; // inside: gone
      clips.push(c.at >= to ? { ...c, at: c.at - n } : c);
    }
    return { ...tr, clips };
  });
  const sections = [];
  for (const sc of tape.sections || []) {
    if (sc.end <= from) sections.push(sc);
    else if (sc.at >= to) sections.push({ ...sc, at: sc.at - n, end: sc.end - n });
    else {
      const a = Math.min(sc.at, from), b = sc.end > to ? sc.end - n : from;
      if (b > a) sections.push({ ...sc, at: a, end: b });
    }
  }
  return { ...tape, tracks, sections };
}

/**
 * spanWords is a length as the toasts and the ruler say it: in bars with a
 * tempo ("4 bars"), else seconds.
 */
export function spanWords(frames, grid, sampleRate) {
  if (grid && grid.frames > 0 && grid.bars > 0) {
    const bars = Math.round((frames / (grid.frames / grid.bars)) * 10) / 10;
    return `${bars} bar${bars === 1 ? '' : 's'}`;
  }
  return `${(frames / sampleRate).toFixed(1)} s`;
}

/**
 * barOf is the bar (from 1) a frame is in, with a tempo, as the Pi counts it
 * (Grid.BarAt): its bar lines are whole frames, rounded, so on most tempos
 * half of them fall a fraction below n bars.
 */
export function barOf(frame, grid) {
  const bar = grid.frames / grid.bars;
  const start = (n) => Math.round(n * bar);
  let n = Math.floor(frame / bar);
  while (start(n + 1) <= frame) n++;
  while (n > 0 && start(n) > frame) n--;
  return n + 1;
}
