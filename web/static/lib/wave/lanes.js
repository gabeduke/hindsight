// MIDI lanes under the waveform: one per (device, channel) track of the
// take's .mid, painted from the wave view's own viewport so a note sits
// exactly under its audio at every zoom. The geometry here is pure and
// tested; the Lanes class at the bottom owns the DOM and the canvases.
import { frameToX, gridLines } from './geometry.js';
import { withAlpha } from '../theme.js';

export const LANE_H = { notes: 56, drums: 36, collapsed: 18 };
// Solarized: drums yellow, melodic parts blue, cyan, magenta, violet -- the
// tape's track colours, so a part keeps its colour from lane to tape.
export const DRUM_COLOR = '#b58900';
export const MELODIC_COLORS = ['#268bd2', '#2aa198', '#d33682', '#6c71c4'];
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

/**
 * One card per track: a header (swatch, name, meta, chevron) and a canvas
 * body. Tapping the header opens a small menu: collapse or expand, show as
 * drums or as notes, and hide. (It used to be a tap to collapse and a hidden
 * half-second hold to flip drums/notes, which nobody could discover.)
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
    this.hidden = new Set();
    try { this.hidden = new Set(JSON.parse(localStorage.getItem(`${storageKey}.hidden`) || '[]')); } catch {}
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
      head.setAttribute('role', 'button');
      head.setAttribute('aria-haspopup', 'menu');
      head.tabIndex = 0;
      head.dataset.tip = 'lane';
      head.append(swatch, name, meta, chev);
      const menu = document.createElement('div');
      menu.className = 'lane-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      const body = document.createElement('canvas');
      body.className = 'lane-body';
      card.append(head, menu, body);
      this.container.appendChild(card);
      const c = { track: t, color: colors[i], card, head, menu, meta, chev, body, ctx: body.getContext('2d') };
      this.cards.push(c);
      this.wireHeader(c);
      this.applyCollapse(c);
    });
    this.showAll = document.createElement('button');
    this.showAll.type = 'button';
    this.showAll.className = 'linkish lane-show-all';
    this.showAll.addEventListener('click', () => {
      this.hidden.clear();
      this.saveHidden();
      this.cards.forEach((c) => this.applyCollapse(c));
      this.draw();
    }, { signal: this.ac.signal });
    this.container.appendChild(this.showAll);
    this.syncShowAll();
  }

  saveHidden() {
    try { localStorage.setItem(`${this.storageKey}.hidden`, JSON.stringify([...this.hidden])); } catch {}
    this.syncShowAll();
  }

  syncShowAll() {
    const n = this.hidden.size;
    this.showAll.hidden = n === 0;
    this.showAll.textContent = n === 1 ? 'Show the hidden lane' : `Show ${n} hidden lanes`;
  }

  applyCollapse(c) {
    const collapsed = !!this.collapsed[c.track.name];
    c.card.hidden = this.hidden.has(c.track.name);
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
    const item = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); c.menu.hidden = true; fn(); }, sig);
      return b;
    };
    const open = () => {
      const collapsed = !!this.collapsed[c.track.name];
      const other = c.track.kind === 'drums' ? 'notes' : 'drums';
      c.menu.replaceChildren(
        item(collapsed ? 'Expand' : 'Collapse', () => {
          this.collapsed[c.track.name] = !collapsed;
          try { localStorage.setItem(this.storageKey, JSON.stringify(this.collapsed)); } catch {}
          this.applyCollapse(c);
          this.draw();
        }),
        item(other === 'drums' ? 'Show as drums' : 'Show as notes', () => {
          this.setKind(c.track.name, other);
          this.onKindChange?.(c.track.name, other);
        }),
        item('Hide', () => {
          this.hidden.add(c.track.name);
          this.saveHidden();
          this.applyCollapse(c);
          this.draw();
        }),
      );
      for (const k of this.cards) if (k !== c) k.menu.hidden = true;
      c.menu.hidden = !c.menu.hidden;
    };
    c.head.addEventListener('click', (e) => { e.stopPropagation(); open(); }, sig);
    c.head.addEventListener('keydown', (e) => {
      // Handled here, so the page's Space-for-Play never sees it too.
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(); }
    }, sig);
    // Like the page's other menus: a tap anywhere else, or Escape, closes it.
    document.addEventListener('click', (e) => { if (!c.menu.hidden && !c.menu.contains(e.target)) c.menu.hidden = true; }, sig);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') c.menu.hidden = true; }, sig);
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
      ctx.fillStyle = col('--well', '#e9e2cd');
      ctx.fillRect(0, 0, W, H);
      const layout = laneLayout(c.track, !!this.collapsed[c.track.name]);
      // Rows
      for (const row of layout.rows) {
        if (!row.tint) continue;
        ctx.fillStyle = withAlpha(col('--ink', '#073642'), 0.04);
        ctx.fillRect(0, row.top, W, row.h);
      }
      // Bar lines, from the same call the wave makes.
      for (const g of gridLines(view, st.grid)) {
        ctx.fillStyle = g.bar ? col('--rule', '#c9c0a4') : withAlpha(col('--ink', '#073642'), 0.07);
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
        ctx.fillStyle = withAlpha(col('--sel', '#268bd2'), 0.14);
        ctx.fillRect(x0, 0, x1 - x0, H);
        ctx.fillStyle = col('--sel', '#268bd2');
        for (const x of [x0, x1]) ctx.fillRect(Math.round(x) - 1, 0, 2, H);
      }
      // Cursor
      if (st.cursor != null) {
        ctx.fillStyle = col('--accent', '#cb4b16');
        ctx.fillRect(Math.round(frameToX(st.cursor, view)), 0, 1, H);
      }
    }
  }
}
