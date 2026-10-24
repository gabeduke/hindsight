// web/static/lib/bar/feed-source.js
// The live studio feed in the now-playing bar (with the two rooms on):
// monitors the live ring (/api/status + /api/envelope), lets you scrub into
// the ring buffer from any page, and offers a one-tap GRAB into the Studio's
// buffer from the scrubbed position.

import { paintOxide, oxideColors, drawTrace, traceLines } from '../wave/tape-strip.js';
import { withAlpha } from '../theme.js';
import { replacedLine, remember } from '../buffer/replaced.js';
import { forTheTape } from './carry.js';

const SR = 48000;
const DEFAULT_RING_SEC = 120;

function fmtSecs(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * feedSource creates a NowPlaying source for the live studio feed.
 */
export function feedSource({
  fetchImpl = (...a) => (typeof fetch === 'function' ? fetch(...a) : Promise.reject(new Error('no fetch'))),
  storage = (() => { try { return globalThis.sessionStorage || null; } catch { return null; } })(),
  forTape = forTheTape,
} = {}) {
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };
  let active = false;
  let ringSec = DEFAULT_RING_SEC;
  let bufferedSec = DEFAULT_RING_SEC;
  let healthy = true;
  let peakDb = -60;
  let bins = []; // normalized [0..1] amplitude envelope
  let offsetFromHeadFrames = 0; // 0 = live head; > 0 = scrubbed back into the ring
  let pollTimer = null;

  const lengthFrames = () => Math.max(SR, Math.round(bufferedSec * SR));
  const pos = () => Math.max(0, Math.min(lengthFrames(), lengthFrames() - offsetFromHeadFrames));
  const playing = () => active;

  async function poll() {
    try {
      const [stRes, envRes] = await Promise.all([
        fetchImpl('/api/status', { cache: 'no-store' }).catch(() => null),
        fetchImpl('/api/envelope', { cache: 'no-store' }).catch(() => null),
      ]);
      if (stRes && stRes.ok) {
        const st = await stRes.json();
        if (st.ring_seconds > 0) ringSec = st.ring_seconds;
        if (st.buffered_seconds > 0) bufferedSec = Math.min(ringSec, st.buffered_seconds);
        healthy = !!st.capture_healthy;
        if (Array.isArray(st.channel_rms) && st.channel_rms.length) {
          peakDb = Math.max(...st.channel_rms);
        }
      }
      if (envRes && envRes.ok) {
        const env = await envRes.json();
        if (Array.isArray(env.bins) && env.bins.length) {
          bins = env.bins.map((b) => Math.max(0, Math.min(1, Number(b?.max ?? b) || 0)));
        }
      }
      fire();
    } catch { /* next poll retries */ }
  }

  function startPolling() {
    if (pollTimer) return;
    poll();
    if (typeof setInterval === 'function') {
      pollTimer = setInterval(poll, 2000);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function play() {
    if (active) return;
    active = true;
    startPolling();
    fire();
  }

  function pause() {
    if (!active) return;
    active = false;
    stopPolling();
    fire();
  }

  function toggle() {
    if (active) pause();
    else play();
  }

  function release() {
    pause();
    offsetFromHeadFrames = 0;
  }

  /**
   * grabToStudio sends a window around the current feed scrub position into
   * the Studio's clipboard buffer (`POST /api/clipboard`) and returns `/tape.html`.
   */
  async function grabToStudio({ seconds = 8 } = {}) {
    const res = await fetchImpl('/api/clipboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds, crate: false }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
    if (b.replaced && b.clipboard) {
      remember(storage, { by: b.clipboard.created, line: replacedLine(b.replaced, b.replaced_seconds) });
    }
    forTape();
    return '/tape.html';
  }

  return {
    kind: 'feed',
    title: 'Studio feed',
    href: '/tape.html',
    sampleRate: SR,
    get length() { return lengthFrames(); },
    pos,
    heardHere: pos,
    playing,
    canPlay: () => true,
    play,
    pause,
    toggle,
    release,
    grabToStudio,
    get offsetSeconds() { return Math.round(offsetFromHeadFrames / SR); },
    seek(targetFrame) {
      const len = lengthFrames();
      const clamped = Math.max(0, Math.min(len, Math.round(targetFrame)));
      offsetFromHeadFrames = Math.max(0, len - clamped);
      fire();
    },
    start: () => lengthFrames(),
    startLabel: () => 'Jump to live head',
    step: () => 5 * SR,
    loop: false,
    canLoop: () => false,
    setLoop() {},
    tick() {},
    lcd: () => {
      const agoSec = Math.round(offsetFromHeadFrames / SR);
      return {
        big: agoSec > 0 ? `-${fmtSecs(agoSec)}` : (active ? 'LIVE' : 'FEED'),
        small: `${fmtSecs(bufferedSec)} buf`,
        note: '',
        status: active && healthy ? 'play' : 'stop',
        unit: 'IN',
      };
    },
    marquee: () => {
      const agoSec = Math.round(offsetFromHeadFrames / SR);
      return agoSec > 0
        ? `STUDIO FEED · ${agoSec}S AGO · GRAB TO BUFFER`
        : `STUDIO FEED · ${healthy ? 'LIVE RING' : 'WAITING'}`;
    },
    levels: {
      colors: ['var(--go, #6faa32)', 'var(--go, #6faa32)'],
      at: () => (active && healthy ? [peakDb, peakDb] : [-60, -60]),
    },
    out: () => 'Studio feed',
    paint(ctx, W, H, col, dpr = 1) {
      ctx.clearRect(0, 0, W, H);
      paintOxide(ctx, W, H, oxideColors(col));
      if (bins.length > 1) {
        const lines = traceLines(bins, W, H, 1);
        // The trace, and under it the trace at .18. (These are not
        // traceLines' and drawTrace's arguments, so the strip shows the
        // oxide and the marker only: the trace has never drawn here.)
        drawTrace(ctx, lines, { stroke: col('--trace', '#f6e7c4'), fill: withAlpha(col('--trace', '#f6e7c4'), 0.18) }, dpr);
      }
      const len = lengthFrames();
      const frac = len > 0 ? Math.max(0, Math.min(1, pos() / len)) : 1;
      const px = Math.max(2, Math.min(W - 2, Math.round(frac * (W - 4)) + 2));
      ctx.fillStyle = col('--go', '#6faa32');
      ctx.fillRect(px - 1, 0, 2, H);
    },
    /** on hears every change to what the bar shows of the feed, and answers its off. */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      stopPolling();
      active = false;
      listeners.clear();
    },
  };
}

