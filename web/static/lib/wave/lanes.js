// MIDI lanes under the waveform: one per (device, channel) track of the
// take's .mid, painted from the wave view's own viewport so a note sits
// exactly under its audio at every zoom. The geometry here is pure and
// tested; the Lanes class at the bottom owns the DOM and the canvases.
import { frameToX, gridLines } from './geometry.js';

export const LANE_H = { notes: 56, drums: 36, collapsed: 18 };
export const DRUM_COLOR = '#fbbf24';
export const MELODIC_COLORS = ['#34d399', '#3b9dd4', '#f87171', '#a78bfa'];
const MIN_ROW_PX = 4;
const MIN_NOTE_PX = 2;
const DRUM_TICK_PX = 2;

export function alphaFor(v) { return 0.3 + 0.7 * (v / 127); }

/** Drums are always amber; melodic tracks take the palette in order. */
export function laneColors(tracks) {
  let m = 0;
  return tracks.map((t) => (t.kind === 'drums' ? DRUM_COLOR : MELODIC_COLORS[m++ % MELODIC_COLORS.length]));
}

/**
 * Where the rows are for one lane. Melodic: one row per semitone across the
 * track's pitch range, hi at the top, C rows tinted. Drums: one row per
 * distinct pitch, lowest at the bottom. Collapsed: a bare strip.
 */
export function laneLayout(track, collapsed) {
  if (collapsed) return { h: LANE_H.collapsed, rows: [], rowH: LANE_H.collapsed, lo: 0, hi: 0, pitchRow: null };
  const ps = track.notes.map((n) => n.p);
  if (track.kind === 'drums') {
    const distinct = [...new Set(ps)].sort((a, b) => a - b);
    const n = Math.max(1, distinct.length);
    const rowH = LANE_H.drums / n;
    const pitchRow = new Map();
    // lowest pitch -> bottom row (index n-1)
    distinct.forEach((p, i) => pitchRow.set(p, n - 1 - i));
    const rows = Array.from({ length: n }, (_, i) => ({ top: i * rowH, h: rowH, tint: i % 2 === 1 }));
    return { h: LANE_H.drums, rows, rowH, lo: distinct[0] ?? 0, hi: distinct[n - 1] ?? 0, pitchRow };
  }
  const lo = ps.length ? Math.min(...ps) : 60;
  const hi = ps.length ? Math.max(...ps) : 60;
  const span = hi - lo + 1;
  // LANE_H.notes (56) is a minimum, not a fixed height: a span wide enough
  // that 56px would floor rowH below MIN_ROW_PX instead grows the body so
  // every row stays at least 4px tall.
  const h = Math.max(LANE_H.notes, span * MIN_ROW_PX);
  const rowH = h / span;
  const rows = [];
  for (let p = hi; p >= lo; p--) rows.push({ top: (hi - p) * rowH, h: rowH, tint: p % 12 === 0 });
  return { h, rows, rowH, lo, hi, pitchRow: null };
}

/** Rects for the notes inside the view, in CSS px of the lane body. */
export function noteRects(track, layout, view) {
  const first = view.start;
  const last = view.start + view.width * view.fpp;
  const out = [];
  const collapsed = layout.rows.length === 0 && layout.pitchRow === null && layout.h === LANE_H.collapsed;
  for (const n of track.notes) {
    if (n.e < first || n.s > last) continue;
    const x = frameToX(n.s, view);
    const alpha = alphaFor(n.v);
    if (collapsed) {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: 0.15 * layout.h, h: 0.7 * layout.h, alpha });
    } else if (track.kind === 'drums') {
      const row = layout.pitchRow.get(n.p) ?? layout.rows.length - 1;
      const floor = (row + 1) * layout.rowH;
      const h = layout.rowH * (0.25 + 0.7 * (n.v / 127));
      out.push({ x, w: DRUM_TICK_PX, y: floor - h, h, alpha });
    } else {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: (layout.hi - n.p) * layout.rowH, h: layout.rowH, alpha });
    }
  }
  return out;
}

// ---------------------------------------------------------------- DOM

const HOLD_MS = 500;
const HOLD_MOVE = 8;

/**
 * One card per track: a header (swatch, name, meta, chevron) and a canvas
 * body. Tap the header to collapse; hold it to flip drums/notes.
 */
export class Lanes {
  constructor({ container, tracks, storageKey, getState, getView, onKindChange }) {
    this.container = container;
    this.tracks = tracks;
    this.storageKey = storageKey;
    this.getState = getState;
    this.getView = getView;
    this.onKindChange = onKindChange;
    this.collapsed = {};
    try { this.collapsed = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    this.cards = [];
    this.raf = 0;
    this.ac = new AbortController();
    this.ro = new ResizeObserver(() => this.draw());
    this.build();
    this.ro.observe(container);
  }

  destroy() {
    this.ac.abort();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.container.replaceChildren();
  }

  build() {
    this.container.replaceChildren();
    this.cards = [];
    const colors = laneColors(this.tracks);
    this.tracks.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'lane';
      const head = document.createElement('div');
      head.className = 'lane-head';
      const swatch = document.createElement('span');
      swatch.className = 'lane-swatch';
      swatch.style.background = colors[i];
      const name = document.createElement('span');
      name.className = 'lane-name';
      name.textContent = t.name;
      const meta = document.createElement('span');
      meta.className = 'lane-meta mono';
      const chev = document.createElement('span');
      chev.className = 'lane-chev';
      head.title = 'Tap to collapse · hold to switch drums/notes';
      head.append(swatch, name, meta, chev);
      const body = document.createElement('canvas');
      body.className = 'lane-body';
      card.append(head, body);
      this.container.appendChild(card);
      const c = { track: t, color: colors[i], card, head, meta, chev, body, ctx: body.getContext('2d') };
      this.cards.push(c);
      this.wireHeader(c);
      this.applyCollapse(c);
    });
  }

  applyCollapse(c) {
    const collapsed = !!this.collapsed[c.track.name];
    c.card.classList.toggle('collapsed', collapsed);
    c.chev.textContent = collapsed ? '▸' : '▾';
    const notes = c.track.notes.length;
    c.meta.textContent = c.track.kind === 'drums'
      ? `${notes} notes · triggers`
      : `${notes} notes · ${c.track.device} · piano roll`;
    c.body.style.height = `${laneLayout(c.track, collapsed).h}px`;
  }

  wireHeader(c) {
    const sig = { signal: this.ac.signal };
    let hold = 0, held = false, x0 = 0, y0 = 0;
    c.head.addEventListener('pointerdown', (e) => {
      held = false; x0 = e.clientX; y0 = e.clientY;
      hold = setTimeout(() => {
        held = true;
        const kind = c.track.kind === 'drums' ? 'notes' : 'drums';
        this.setKind(c.track.name, kind);
        this.onKindChange?.(c.track.name, kind);
      }, HOLD_MS);
    }, sig);
    c.head.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > HOLD_MOVE) clearTimeout(hold);
    }, sig);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      c.head.addEventListener(ev, () => clearTimeout(hold), sig);
    }
    c.head.addEventListener('click', () => {
      if (held) { held = false; return; } // the hold already acted
      this.collapsed[c.track.name] = !this.collapsed[c.track.name];
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.collapsed)); } catch {}
      this.applyCollapse(c);
      this.draw();
    }, sig);
  }

  /** Flip a track's kind locally: colour, rows and meta follow. */
  setKind(name, kind) {
    const c = this.cards.find((k) => k.track.name === name);
    if (!c) return;
    c.track.kind = kind;
    const colors = laneColors(this.tracks);
    this.cards.forEach((k, i) => { k.color = colors[i]; k.head.querySelector('.lane-swatch').style.background = colors[i]; });
    this.applyCollapse(c);
    this.draw();
  }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  paint() {
    const view = this.getView();
    const st = this.getState();
    const dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(this.container);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;
    for (const c of this.cards) {
      const r = c.body.getBoundingClientRect();
      if (r.width <= 0) continue;
      const W = r.width, H = r.height;
      if (c.body.width !== Math.round(W * dpr) || c.body.height !== Math.round(H * dpr)) {
        c.body.width = Math.round(W * dpr); c.body.height = Math.round(H * dpr);
      }
      const ctx = c.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = col('--bg', '#0b1120');
      ctx.fillRect(0, 0, W, H);
      const layout = laneLayout(c.track, !!this.collapsed[c.track.name]);
      // Rows
      for (const row of layout.rows) {
        if (!row.tint) continue;
        ctx.fillStyle = col('--panel-2', '#1a2437');
        ctx.fillRect(0, row.top, W, row.h);
      }
      // Bar lines, from the same call the wave makes.
      for (const g of gridLines(view, st.grid)) {
        ctx.fillStyle = g.bar ? col('--line', '#26324a') : 'rgba(255,255,255,0.06)';
        ctx.fillRect(Math.round(frameToX(g.frame, view)), 0, 1, H);
      }
      // Notes
      ctx.fillStyle = c.color;
      for (const n of noteRects(c.track, layout, { ...view, width: W })) {
        ctx.globalAlpha = n.alpha;
        ctx.fillRect(n.x, n.y, n.w, n.h);
      }
      ctx.globalAlpha = 1;
      // Region: the wave's exact shade and edges.
      if (st.region) {
        const x0 = frameToX(st.region.start, view), x1 = frameToX(st.region.end, view);
        ctx.fillStyle = 'rgba(52,211,153,0.14)';
        ctx.fillRect(x0, 0, x1 - x0, H);
        ctx.fillStyle = col('--accent', '#34d399');
        for (const x of [x0, x1]) ctx.fillRect(Math.round(x) - 1, 0, 2, H);
      }
      // Cursor
      if (st.cursor != null) {
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.fillRect(Math.round(frameToX(st.cursor, view)), 0, 1, H);
      }
    }
  }
}
