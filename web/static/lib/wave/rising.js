// web/static/lib/wave/rising.js
// Rising notes: a keyboard and a row of drum pads at the foot of a canvas,
// and every note that sounds grows *out of* its key and rises away. The
// view shows the past, a bar or two deep -- what was just played -- which is
// what reviewing your own take is for. Geometry up top is pure and tested
// under `node --test`; the RisingNotes class at the bottom owns the canvas.
import { alphaFor, laneColors } from './lanes.js';

export const PX_PER_BEAT = 44;
export const KEY_H = 88;
export const KEY_H_SHORT = 72;   // a short phone screen
export const CHIP_H = 40;
export const KEYS = 48;          // four octaves
export const FALLBACK_BPM = 120; // a take with no tempo scrolls at 2 beats/s
export const MIN_DRUM_PX = 6;
export const GLOW_BEATS = 1;     // a key's colour decays over one beat after note-off
export const PAD_FLASH_BEATS = 0.3;
const MAX_BPM = 400;

export const GM_NAMES = {
  36: ['kick', 'BD'], 38: ['snare', 'SD'], 42: ['closed hat', 'HH'], 46: ['open hat', 'OH'],
  41: ['floor tom', 'T4'], 43: ['floor tom', 'T4'], 45: ['low tom', 'T3'], 47: ['mid tom', 'T2'],
  48: ['mid tom', 'T2'], 50: ['high tom', 'T1'], 49: ['crash', 'CR'], 51: ['ride', 'RD'],
};

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
export function isBlack(p) { return !WHITE.has(((p % 12) + 12) % 12); }

/**
 * Four octaves, C-aligned, around the melodic pitch range. Empty: C2..B5.
 * A range that does not fit from the C at or below lo-2 is centred instead.
 */
export function keyWindow(tracks) {
  let lo = Infinity, hi = -Infinity;
  for (const t of tracks) {
    if (t.kind === 'drums') continue;
    for (const n of t.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  }
  if (lo === Infinity) return { lo: 36, hi: 83 };
  let klo = Math.floor((lo - 2) / 12) * 12;
  if (hi > klo + KEYS - 1) klo = Math.round(((lo + hi) / 2 - KEYS / 2) / 12) * 12;
  // Stays C-aligned even at the ends: a window may run past pitch 127,
  // and those keys are simply never lit.
  klo = Math.max(0, Math.min(84, klo));
  return { lo: klo, hi: klo + KEYS - 1 };
}

/**
 * Key rectangles across `width` CSS px, x from 0. Whites are equal columns;
 * blacks sit over the join at 62% width. xFor clamps to the edge keys so an
 * out-of-window pitch still lands somewhere visible.
 */
export function keyLayout(lo, width, keys = KEYS) {
  const hi = lo + keys - 1;
  let nWhite = 0;
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) nWhite++;
  const ww = width / Math.max(1, nWhite);
  const bw = ww * 0.62;
  const whites = [], blacks = [], byPitch = new Map();
  let i = 0;
  for (let p = lo; p <= hi; p++) {
    if (!isBlack(p)) {
      const k = { p, x: i * ww, w: ww, black: false };
      whites.push(k); byPitch.set(p, k); i++;
    } else {
      const k = { p, x: Math.max(0, i * ww - bw / 2), w: bw, black: true };
      blacks.push(k); byPitch.set(p, k);
    }
  }
  const xFor = (p) => byPitch.get(Math.max(lo, Math.min(hi, p)));
  return { lo, hi, whites, blacks, ww, xFor };
}

/**
 * One pad per distinct drum pitch, the `cap` most-played kept, ascending
 * left to right. colFor maps any pitch to the nearest kept pad's column.
 */
export function padLayout(tracks, cap = 8) {
  const counts = new Map();
  for (const t of tracks) {
    if (t.kind !== 'drums') continue;
    for (const n of t.notes) counts.set(n.p, (counts.get(n.p) || 0) + 1);
  }
  const kept = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, cap)
    .map(([p]) => p)
    .sort((a, b) => a - b);
  const pads = kept.map((p, col) => {
    const gm = GM_NAMES[p];
    return { p, label: gm ? gm[0] : `#${p}`, short: gm ? gm[1] : String(p), col };
  });
  const colFor = (p) => {
    if (!kept.length) return -1;
    let best = 0;
    for (let i = 1; i < kept.length; i++) if (Math.abs(kept[i] - p) < Math.abs(kept[best] - p)) best = i;
    return best;
  };
  return { pads, colFor };
}

/** Each pad's width: a fifth of the canvas shared out, never under 12 or over 32. */
export function padWidth(width, npads) {
  if (!npads) return 0;
  return Math.max(12, Math.min(32, Math.floor((0.2 * width) / npads)));
}

/** The tempo in force at `frame`: the last entry at or before it, the first before any. */
export function bpmAt(tempo, frame, fallback = FALLBACK_BPM) {
  if (!tempo || !tempo.length) return fallback;
  let bpm = tempo[0].bpm;
  for (const t of tempo) { if (t.frame <= frame) bpm = t.bpm; else break; }
  if (!(bpm > 0) || bpm > MAX_BPM) return fallback;
  return bpm;
}

// ---------------------------------------------------------------- per frame

/** y of a frame on the canvas: the keyboard top is `now`, the past is above. */
export function yAt(frame, now, fpb, keyTop) {
  return keyTop - ((now - frame) / fpb) * PX_PER_BEAT;
}

/** First index whose start is at or after `frame`. Notes are sorted by s. */
export function lowerBound(notes, frame) {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].s < frame) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Notes are sorted by start, not end, so the oldest bar still on screen can
// have started long before the visible window (a held chord). Scanning from
// `now - horizon - longest note` covers it; the length is computed once.
const maxLenCache = new WeakMap();
export function trackMaxLen(track) {
  let m = maxLenCache.get(track);
  if (m == null) {
    m = 0;
    for (const n of track.notes) if (n.e - n.s > m) m = n.e - n.s;
    maxLenCache.set(track, m);
  }
  return m;
}

/**
 * Every bar to draw for one frame. A sounding note is anchored at keyTop and
 * grows upward; a finished note has lifted off and fades to nothing by the
 * time its bottom edge reaches the top. Drums rise from their pad column.
 */
export function noteBars(tracks, now, geo) {
  const { fpb, keyTop, riseH, keys, pads, padW, padCol, muted, colors } = geo;
  const horizon = (riseH / PX_PER_BEAT) * fpb;
  const out = [];
  tracks.forEach((t, ti) => {
    if (muted.has(t.name)) return;
    const color = colors[ti];
    const notes = t.notes;
    for (let i = lowerBound(notes, now - horizon - trackMaxLen(t)); i < notes.length; i++) {
      const n = notes[i];
      if (n.s > now) break;
      if (n.e < now - horizon) continue;
      const sounding = n.e > now;
      const y0 = Math.max(0, yAt(n.s, now, fpb, keyTop));
      const y1 = sounding ? keyTop : yAt(n.e, now, fpb, keyTop);
      if (y1 <= 0) continue;
      let alpha = alphaFor(n.v);
      if (!sounding) alpha *= Math.max(0, 1 - (keyTop - y1) / riseH);
      if (alpha <= 0) continue;
      if (t.kind === 'drums') {
        const col = pads.colFor(n.p);
        if (col < 0) continue;
        const h = Math.max(MIN_DRUM_PX, y1 - y0);
        out.push({ x: col * padW, w: padW, y0: y1 - h, y1, alpha, color, drum: true, clamp: 0 });
      } else {
        const k = keys.xFor(n.p);
        const clamp = n.p < keys.lo ? -1 : n.p > keys.hi ? 1 : 0;
        out.push({ x: k.x + padCol, w: k.w, y0, y1, alpha, color, drum: false, clamp });
      }
    }
  });
  return out;
}

/**
 * How lit each key and pad is: a sounding note's velocity alpha, decaying to
 * nothing over GLOW_BEATS (keys) or PAD_FLASH_BEATS (pads) after note-off.
 * Two notes on one key: the brighter wins.
 */
export function glow(tracks, now, geo) {
  const { fpb, pads, muted, colors } = geo;
  const keysOut = new Map(), padsOut = new Map();
  const put = (map, key, alpha, color) => {
    const cur = map.get(key);
    if (!cur || alpha > cur.alpha) map.set(key, { alpha, color });
  };
  tracks.forEach((t, ti) => {
    if (muted.has(t.name)) return;
    const drum = t.kind === 'drums';
    const tail = (drum ? PAD_FLASH_BEATS : GLOW_BEATS) * fpb;
    const notes = t.notes;
    for (let i = lowerBound(notes, now - tail - trackMaxLen(t)); i < notes.length; i++) {
      const n = notes[i];
      if (n.s > now) break;
      if (n.e + tail < now) continue;
      const base = alphaFor(n.v);
      const alpha = n.e > now ? base : base * (1 - (now - n.e) / tail);
      if (alpha <= 0) continue;
      if (drum) {
        const col = pads.colFor(n.p);
        if (col >= 0) put(padsOut, col, alpha, colors[ti]);
      } else {
        put(keysOut, n.p, alpha, colors[ti]);
      }
    }
  });
  return { keys: keysOut, pads: padsOut };
}

// ---------------------------------------------------------------- DOM

const SPEEDS = [0.5, 1, 2];
const fmtSpeed = (r) => `${r}×`;

/**
 * One canvas: chips are built into `chips`, the speed button (if given) is
 * wired to the clock. Reads clock.position() every frame while running;
 * draw() paints a single frame for a paused page.
 */
export class RisingNotes {
  constructor({ canvas, chips, speedButton, tracks, tempo, sampleRate, getState, getClock, storageKey }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chips = chips;
    this.tracks = tracks;
    this.tempo = tempo || [];
    this.sr = sampleRate;
    this.getState = getState;
    this.getClock = getClock;
    this.storageKey = storageKey;
    this.muted = new Set();
    try { this.muted = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch {}
    this.running = false;
    this.raf = 0;
    this.layoutKey = '';
    this.layout = null;
    this.ac = new AbortController();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    this.buildChips(speedButton);
    this.draw();
  }

  destroy() {
    this.stop();
    this.ac.abort();
    this.ro.disconnect();
    this.chips.replaceChildren();
  }

  buildChips(speedButton) {
    const sig = { signal: this.ac.signal };
    this.chips.replaceChildren();
    this.chipEls = this.tracks.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      const sw = document.createElement('span');
      sw.className = 'chip-swatch';
      b.append(sw, document.createTextNode(t.name));
      b.title = 'Tap to mute this track in the view';
      b.addEventListener('click', () => {
        if (this.muted.has(t.name)) this.muted.delete(t.name); else this.muted.add(t.name);
        try { localStorage.setItem(this.storageKey, JSON.stringify([...this.muted])); } catch {}
        this.syncChips();
        this.draw();
      }, sig);
      this.chips.appendChild(b);
      return b;
    });
    this.syncChips();
    if (speedButton) {
      const clock = this.getClock();
      speedButton.textContent = fmtSpeed(clock.rate || 1);
      speedButton.addEventListener('click', () => {
        const c = this.getClock();
        const next = SPEEDS[(SPEEDS.indexOf(c.rate || 1) + 1) % SPEEDS.length];
        c.setRate(next);
        speedButton.textContent = fmtSpeed(next);
      }, sig);
    }
  }

  /** Colours follow the lanes, including a kind flipped after the chips were built. */
  syncChips() {
    const colors = laneColors(this.tracks);
    this.chipEls.forEach((b, i) => {
      b.querySelector('.chip-swatch').style.background = colors[i];
      b.setAttribute('aria-pressed', this.muted.has(this.tracks[i].name) ? 'true' : 'false');
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (!this.running) return;
      this.paint();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  draw() {
    if (this.running || this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  // Key window and pads depend on the track kinds, which the lanes can flip
  // under us (hold a lane header); recomputed when the kinds or width change.
  layoutFor(W) {
    const key = `${W}|${this.tracks.map((t) => t.kind).join(',')}`;
    if (key !== this.layoutKey) {
      const pads = padLayout(this.tracks);
      const padW = padWidth(W, pads.pads.length);
      const padCol = padW * pads.pads.length;
      const keys = keyLayout(keyWindow(this.tracks).lo, W - padCol);
      this.layout = { pads, padW, padCol, keys };
      this.layoutKey = key;
      this.syncChips();
    }
    return this.layout;
  }

  paint() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = r.width, H = r.height;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.canvas);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;

    const st = this.getState();
    const clock = this.getClock();
    const now = clock.position();
    const bpm = bpmAt(this.tempo, now);
    const hasTempo = this.tempo.length > 0 && bpmAt(this.tempo, now, 0) > 0;
    const fpb = (this.sr * 60) / bpm;
    const keyH = H < 480 ? KEY_H_SHORT : KEY_H;
    const keyTop = H - keyH;
    const riseH = keyTop;
    const { pads, padW, padCol, keys } = this.layoutFor(W);
    const geo = { fpb, keyTop, riseH, keys, pads, padW, padCol, muted: this.muted, colors: laneColors(this.tracks) };

    // Ground
    ctx.fillStyle = col('--bg', '#0b1120');
    ctx.fillRect(0, 0, W, H);

    // Beat lines from the downbeat, scrolling up with the notes. Without a
    // tempo the grid is a guess, so it is drawn faint and without bars.
    const downbeat = st.grid.downbeat || 0;
    let b = Math.floor((now - downbeat) / fpb);
    for (;;) {
      const y = yAt(downbeat + b * fpb, now, fpb, keyTop);
      if (y < 0) break;
      const bar = hasTempo && ((b % 4) + 4) % 4 === 0;
      ctx.fillStyle = bar ? col('--line', '#26324a') : 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, Math.round(y), W, 1);
      b--;
    }

    // Bars
    for (const n of noteBars(this.tracks, now, geo)) {
      ctx.globalAlpha = n.alpha;
      ctx.fillStyle = n.color;
      ctx.fillRect(n.x, n.y0, n.w, n.y1 - n.y0);
      // A lighter top edge, so the growing end of a sounding bar reads as an edge.
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(n.x, n.y0, n.w, 1);
      if (n.clamp) {
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.font = `10px ${col('--mono', 'ui-monospace, monospace')}`;
        ctx.textAlign = 'center';
        ctx.fillText(n.clamp < 0 ? '▾' : '▴', n.x + n.w / 2, Math.min(n.y1 - 2, n.y0 + 10));
      }
    }
    ctx.globalAlpha = 1;

    // Keyboard
    const lit = glow(this.tracks, now, geo);
    const mono = col('--mono', 'ui-monospace, monospace');
    for (const k of keys.whites) {
      ctx.fillStyle = col('--panel', '#131c2e');
      ctx.fillRect(padCol + k.x, keyTop, k.w, keyH);
      const g = lit.keys.get(k.p);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(padCol + k.x, keyTop, k.w, keyH); ctx.globalAlpha = 1; }
      ctx.fillStyle = col('--line', '#26324a');
      ctx.fillRect(padCol + k.x, keyTop, 1, keyH);
      if (k.p % 12 === 0 && k.w >= 9) {
        ctx.fillStyle = col('--ink-faint', '#5d6b85');
        ctx.font = `${k.w >= 14 ? 10 : 8}px ${mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(`C${Math.floor(k.p / 12) - 1}`, padCol + k.x + k.w / 2, H - 6);
      }
    }
    ctx.fillStyle = col('--line', '#26324a');
    ctx.fillRect(padCol, keyTop, W - padCol, 1);
    for (const k of keys.blacks) {
      ctx.fillStyle = '#060a14';
      ctx.fillRect(padCol + k.x, keyTop, k.w, keyH * 0.6);
      const g = lit.keys.get(k.p);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(padCol + k.x, keyTop, k.w, keyH * 0.6); ctx.globalAlpha = 1; }
    }

    // Pads: a row at the left, lowest pitch first, each padW wide.
    for (const p of pads.pads) {
      const x = p.col * padW;
      ctx.fillStyle = col('--panel-2', '#1a2437');
      ctx.fillRect(x + 1, keyTop + 1, padW - 2, keyH - 2);
      const g = lit.pads.get(p.col);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(x + 1, keyTop + 1, padW - 2, keyH - 2); ctx.globalAlpha = 1; }
      if (padW >= 16) {
        ctx.fillStyle = col('--ink-dim', '#8b9ab4');
        ctx.font = `9px ${mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(p.short, x + padW / 2, H - 6);
      }
    }
    if (pads.pads.length) {
      ctx.fillStyle = col('--line', '#26324a');
      ctx.fillRect(padCol - 1, keyTop, 2, keyH);
    }
  }
}
