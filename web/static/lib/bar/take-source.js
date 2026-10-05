// web/static/lib/bar/take-source.js
// A take in the now-playing bar on Takes and Capture. It plays through its
// list row's own player (TakesList.player), so the bar, the spine and the
// cassette are one player: Play in any of them is Play in all, and each
// follows the audio element's events. Loop repeats the take's selection, or
// the whole take without one.

import { takeCounter, takeMarquee } from './lcd.js';
import { peakDbAt } from './reel-window.js';
import { levelsFor, takeGain } from '../wave/draw.js';
import { drawTrace, paintOxide, oxideColors } from '../wave/tape-strip.js';
import { barBeat } from '../wave/geometry.js';

const stamp = (name) => (name || '').replace(/^jam_|\.wav$/g, '');

/**
 * takeSource is the bar's source for take `t`, played by `player` ({audio,
 * peaks, toggle}). onGone hears when its row lets the audio go (the take
 * deleted, or off the shelf): the bar mustn't keep a player that's empty.
 */
export function takeSource(t, player, { onGone } = {}) {
  const sr = t.sample_rate || 48000;
  const { audio, peaks } = player;
  const length = Math.max(1, Math.round((peaks.duration || t.duration_seconds || 0) * sr));
  const gain = takeGain(peaks);
  const region = t.trim ? { start: t.trim.start_frame, end: t.trim.end_frame } : null;
  const grid = { bpm: t.bpm || null, sampleRate: sr, downbeat: t.downbeat_frame || 0 };
  const title = t.label || stamp(t.name);
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };
  const ac = new AbortController();
  for (const ev of ['play', 'pause', 'ended', 'seeked', 'loadedmetadata']) audio.addEventListener(ev, fire, { signal: ac.signal });
  audio.addEventListener('emptied', () => onGone?.(), { signal: ac.signal });
  let loop = false;
  let cache = null; // the trace on tape, drawn once per size

  const pos = () => Math.min(length, Math.round((audio.currentTime || 0) * sr));
  const playing = () => !audio.paused && !audio.ended;
  const seek = (frame) => {
    audio.currentTime = Math.max(0, Math.min(length - 1, frame)) / sr;
    fire();
  };
  return {
    kind: 'take',
    name: t.name,
    audio,
    title,
    href: `/wave.html?file=${encodeURIComponent(t.name)}`,
    sampleRate: sr,
    length,
    pos,
    playing,
    canPlay: () => true,
    play: () => { if (audio.paused) player.toggle(); },
    pause: () => { if (!audio.paused) player.toggle(); },
    seek,
    // |◂: back to In, or to the start.
    start: () => (region ? region.start : 0),
    startLabel: () => (region ? 'Back to In' : 'Back to the start'),
    step: () => sr,
    get loop() { return loop; },
    canLoop: () => true,
    // Without a selection the audio loops itself, so a missed frame or a
    // hidden page can't let it end; a selection is looped by tick().
    setLoop(on) { loop = on; audio.loop = on && !region; fire(); },
    // Each frame while playing: Loop takes the playhead back to In at Out.
    tick() {
      if (!loop || !playing()) return;
      const a = region ? region.start : 0, b = region ? region.end : length;
      if (pos() >= b - Math.round(sr / 50)) seek(a);
    },
    lcd: () => takeCounter({ pos: pos(), length, sampleRate: sr, bar: barBeat(pos(), grid), playing: playing() }),
    marquee: () => takeMarquee({ name: title, bpm: t.bpm, region, sampleRate: sr }),
    levels: {
      colors: Array.from({ length: Math.min(2, peaks.channels || 1) }, () => 'var(--lcd-ink)'),
      at: (frame) => peakDbAt(peaks, frame / length, gain),
    },
    out: () => 'This device',
    // The whole take on tape, its selection lit, and the playhead.
    paint(ctx, W, H, col, dpr) {
      const key = `${W}x${H}@${dpr}`;
      if (!cache || cache.key !== key) {
        const c = document.createElement('canvas');
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        const cc = c.getContext('2d');
        cc.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintOxide(cc, W, H, oxideColors(col));
        const lv = levelsFor(peaks, Math.max(1, Math.round(W)));
        cc.globalAlpha = 0.7;
        drawTrace(cc, lv, lv, { cy: H / 2, half: H / 2 - 3, gain, line: col('--trace', '#f6e7c4') });
        cache = { key, c };
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(cache.c, 0, 0, W, H);
      if (region) {
        ctx.fillStyle = 'rgba(240,196,25,.16)';
        const x0 = (region.start / length) * W, x1 = (region.end / length) * W;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
      }
      const px = Math.round((pos() / length) * W);
      ctx.fillStyle = col('--accent', '#cb4b16');
      ctx.fillRect(px - 1, 0, 2, H);
    },
    on(fn) { listeners.add(fn); },
    destroy() { ac.abort(); listeners.clear(); cache = null; audio.loop = false; },
  };
}
