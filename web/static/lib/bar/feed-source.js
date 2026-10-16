// web/static/lib/bar/feed-source.js
// The live studio feed in the now-playing bar (with the two rooms on):
// streams /api/stream.wav (or monitors the live ring) through the same
// Media Player (#np) as the tape mix and shelf takes, so switching between
// Feed, Tape, and Shelf is a single click on the player.

import { paintOxide, oxideColors } from '../wave/tape-strip.js';

const SR = 48000;
const WINDOW_FRAMES = 60 * SR;

function fmtSecs(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * feedSource creates a NowPlaying source for the live studio feed.
 */
export function feedSource({ createAudio = () => (typeof Audio === 'function' ? new Audio() : null) } = {}) {
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };
  let audio = null;
  let active = false;
  let startedAt = 0;
  let elapsedBefore = 0;

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const elapsedSec = () => {
    if (!active) return elapsedBefore;
    return elapsedBefore + Math.max(0, (nowMs() - startedAt) / 1000);
  };
  const pos = () => Math.round((elapsedSec() * SR) % WINDOW_FRAMES);
  const playing = () => active;

  function play() {
    if (active) return;
    active = true;
    startedAt = nowMs();
    try {
      if (!audio) audio = createAudio();
      if (audio) {
        audio.src = `/api/stream.wav?t=${Date.now()}`;
        audio.play?.().catch(() => {
          // Demo or browser without live stream endpoint: keep visual monitor active.
        });
      }
    } catch { /* stand-in environment */ }
    fire();
  }

  function pause() {
    if (!active) return;
    elapsedBefore = elapsedSec();
    active = false;
    try {
      if (audio) {
        audio.pause?.();
        audio.removeAttribute?.('src');
      }
    } catch { /* fine */ }
    fire();
  }

  return {
    kind: 'feed',
    title: 'Studio feed',
    href: '/tape.html',
    sampleRate: SR,
    length: WINDOW_FRAMES,
    pos,
    heardHere: pos,
    playing,
    canPlay: () => true,
    play,
    pause,
    seek() { fire(); },
    start: () => 0,
    startLabel: () => 'Live studio feed',
    step: () => SR,
    loop: false,
    canLoop: () => false,
    setLoop() {},
    tick() {},
    lcd: () => ({
      big: active ? 'LIVE' : 'FEED',
      small: fmtSecs(elapsedSec()),
      note: '',
      status: active ? 'play' : 'stop',
      unit: 'IN',
    }),
    marquee: () => 'STUDIO FEED · LIVE MONITOR',
    levels: null,
    out: () => 'This device',
    paint(ctx, W, H, col) {
      ctx.clearRect(0, 0, W, H);
      paintOxide(ctx, W, H, oxideColors(col));
      const px = Math.max(2, W - 4);
      ctx.fillStyle = col('--go', '#2ea043');
      ctx.fillRect(px - 1, 0, 2, H);
    },
    on(fn) { listeners.add(fn); },
    destroy() {
      pause();
      listeners.clear();
    },
  };
}
