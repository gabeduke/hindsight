// The buffer ribbon: the capture ring drawn on a logarithmic age axis, with a
// marker at each capture tier and the selected tier's span shaded, so you can
// see which button catches your take before pressing it.
//
// Position comes from
//
//   left% = (1 - ln(age/A) / ln(T/A)) * 100
//
// with A = edge_seconds and T = ring_seconds, both read off the response so the
// server's bucketing and these markers cannot drift apart. The SVG viewBox is
// n-1 wide and vertex i sits at x = i, so bucket 0 (oldest) lands at 0% under
// the leftmost marker and bucket n-1 (newest) lands at 100% under "now".
//
// It replaces the live visualiser rather than sitting beside it. Resolution at
// the right edge improves (~50 px/s against the old flat 37.6), latency gets
// worse by 1-2s. Live level lives on the meters, still on the websocket.
//
// Hold, then drag, selects any span of the ring; Save as take saves exactly
// that span (POST /api/trigger?from=&to=, absolute ring frames), not the last
// N minutes. A hold released without a drag selects from there to now. A
// selection is kept in absolute frames, so it slides left as time passes,
// like the audio it names. Tapping a flag opens its sheet: Save from here to
// now, or delete it.

import { fmtDur } from '/lib/meter.js';
import { leftPct as axisPct, ageAt, frameAt, ageOf, fmtAge } from '/lib/ribbonmath.js';
import { isSilent } from '/lib/tape/levels.js';
import { ribbonLevels, tierPills, rulerTicks, ribbonColors, drawRibbon } from '/lib/ribbon-draw.js';
import { token } from '/lib/theme.js';

const HOLD_MS = 350;
const MOVE_PX = 8;
// The last ten seconds share the ribbon's last pixel or two: a finger
// stopping this close to the right edge means "now".
const NOW_ZONE_PX = 16;

const MAX_BUCKETS = 600;
const POLL_MS = 1000;

function add(parent, tag, cls) {
  const el = document.createElement(tag);
  el.className = cls;
  parent.appendChild(el);
  return el;
}

/** Decode the base64 envelope the server sends into bytes. */
function decode(b64) {
  const s = atob(b64 || '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class Ribbon {
  /**
   * @param {HTMLElement} wrap the existing .viz-wrap
   * @param {{onToast?: (msg: string, kind?: string) => void}} [opts]
   */
  constructor(wrap, { onToast, onSaved, selBar, flagSheet } = {}) {
    this.wrap = wrap;
    this.onToast = onToast;
    this.onSaved = onSaved;
    this.selBar = selBar || null;
    this.flagSheet = flagSheet || null;
    this.sel = null;   // {from, to}: absolute ring frames; to null means "now"
    this.press = null; // the pointer gesture in progress
    this.spans = [];      // capture tiers in seconds; 0 means the whole ring
    this.selected = null;
    this.data = null;
    this.dataSpans = null; // the spans this.data was actually fetched with
    this.timer = null;
    this._seq = 0; // monotonic guard against out-of-order poll responses

    wrap.textContent = '';
    this.hatch = add(wrap, 'div', 'rb-hatch');
    this.bandLayer = add(wrap, 'div', 'rb-layer');

    // The ring on tape (lib/ribbon-draw.js), under everything else.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rb-canvas';
    wrap.insertBefore(this.canvas, wrap.firstChild);
    this.ctx = this.canvas.getContext('2d');
    this.levels = new Float32Array(0);
    this.ro = new ResizeObserver(() => this.paint());
    this.ro.observe(wrap);

    this.markLayer = add(wrap, 'div', 'rb-layer');
    this.selLayer = add(wrap, 'div', 'rb-layer');
    this.flagLayer = add(wrap, 'div', 'rb-layer');
    this.labelLayer = add(wrap, 'div', 'rb-layer');
    add(wrap, 'div', 'rb-now');
    // The record head: always recording, so always lit.
    const now = add(this.labelLayer, 'span', 'rb-now-label');
    now.innerHTML = '<span class="rb-rec-dot" aria-hidden="true"></span>REC';
    // The strip under the tape: how long ago, from the ring's oldest end to now.
    this.ruler = add(wrap, 'div', 'rb-ruler');

    this.readout = add(wrap, 'p', 'rb-readout');
    this.readout.textContent = 'connecting';

    this._onVis = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener('visibilitychange', this._onVis);
    if (!document.hidden) this.start();

    this.wireSelect();
    this.wireBar();
    this.wireFlagSheet();
  }

  // --- selecting a span -------------------------------------------------------

  /** The axis of the data last drawn, or null before there is one that can
   * name frames (an older server's response has no total_frames). */
  axis() {
    const d = this.data;
    if (!d || !d.total_frames || !d.sample_rate) return null;
    return { A: d.edge_seconds, T: d.ring_seconds, total: d.total_frames, sr: d.sample_rate };
  }

  frameAtX(clientX) {
    const ax = this.axis();
    const r = this.wrap.getBoundingClientRect();
    if (r.right - clientX < NOW_ZONE_PX) return null; // at the right edge: now
    const pct = ((clientX - r.left) / r.width) * 100;
    return frameAt(ageAt(pct, ax.A, ax.T), ax.total, ax.sr);
  }

  wireSelect() {
    const w = this.wrap;
    w.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0 || e.target.closest('.rb-flag') || !this.axis()) return;
      if (this.press) clearTimeout(this.press.timer);
      const p = { id: e.pointerId, x: e.clientX, y: e.clientY, armed: false, anchor: null, end: null };
      p.timer = setTimeout(() => {
        p.armed = true;
        p.anchor = this.frameAtX(p.x) ?? this.axis().total;
        p.end = null;
        try { w.setPointerCapture(p.id); } catch { /* fine */ }
        try { navigator.vibrate?.(10); } catch { /* not everywhere */ }
        this.setSel({ from: p.anchor, to: null }, true);
      }, HOLD_MS);
      this.press = p;
    });
    w.addEventListener('pointermove', (e) => {
      const p = this.press;
      if (!p || e.pointerId !== p.id) return;
      if (!p.armed) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_PX) { clearTimeout(p.timer); this.press = null; }
        return;
      }
      e.preventDefault();
      p.end = Math.abs(e.clientX - p.x) > MOVE_PX ? this.frameAtX(e.clientX) : undefined;
      this.setSel(this.spanOf(p), true);
    });
    const finish = (e, commit) => {
      const p = this.press;
      if (!p || e.pointerId !== p.id) return;
      clearTimeout(p.timer);
      this.press = null;
      if (!p.armed) return;
      if (commit) this.setSel(this.spanOf(p));
      else this.setSel(this.prevSel ?? null);
    };
    w.addEventListener('pointerup', (e) => finish(e, true));
    w.addEventListener('pointercancel', (e) => finish(e, false));
    w.addEventListener('contextmenu', (e) => { if (this.press) e.preventDefault(); });
    // Once a hold has armed, a drag that starts out vertical must select, not
    // scroll the page: pan-y would otherwise take it and cancel the pointer.
    w.addEventListener('touchmove', (e) => { if (this.press?.armed) e.preventDefault(); }, { passive: false });
  }

  // A held press with no drag is "from here to now"; with one, the span
  // between the press and the finger, either way round.
  spanOf(p) {
    if (p.end == null) return { from: p.anchor, to: null }; // no drag, or dragged to now
    const a = Math.min(p.anchor, p.end);
    const b = Math.max(p.anchor, p.end);
    return { from: a, to: Math.max(b, a + 1) };
  }

  setSel(sel, provisional = false) {
    if (!provisional) this.prevSel = sel;
    this.sel = sel;
    if (this.data) this.renderSel(); // just the band and the bar, at finger speed
  }

  wireBar() {
    const bar = this.selBar;
    if (!bar) return;
    bar.querySelector('.rb-sel-clear').addEventListener('click', () => this.setSel(null));
    bar.querySelector('.rb-sel-save').addEventListener('click', () => this.saveSel());
    bar.querySelector('.rb-sel-copy')?.addEventListener('click', () => this.copySel());
  }

  // offerCopy shows Copy on the selection bar: the tape is on, so there's
  // somewhere to drop it.
  offerCopy(on) {
    const b = this.selBar?.querySelector('.rb-sel-copy');
    if (b) b.hidden = !on;
  }

  async copySel() {
    const sel = this.sel;
    if (!sel) return;
    const body = { ring_from: sel.from }; // MAIN, what the ribbon draws
    if (sel.to != null) body.ring_to = sel.to;
    try {
      const res = await fetch('/api/clipboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      const note = b.clamped ? ' (its start had already left the buffer)' : '';
      const clip = b.clipboard && b.clipboard.tracks && b.clipboard.tracks[0] && b.clipboard.tracks[0][0];
      if (clip && isSilent(clip.peak_db)) {
        this.onToast?.(`Copied ${fmtAge(b.seconds)}${note}, but it’s silent: nothing was coming in then`, 'warn');
      } else {
        this.onToast?.(`Copied ${fmtAge(b.seconds)}${note}: Drop it on a tape`, 'ok');
      }
    } catch (e) {
      this.onToast?.(`Could not copy: ${e.message}`, 'bad');
    }
  }

  async saveSpan(from, to) {
    const q = `from=${from}${to != null ? `&to=${to}` : ''}`;
    const res = await fetch(`/api/trigger?${q}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const note = body.clamped ? ' (its start had already left the buffer)' : '';
    this.onToast?.(`Saved ${fmtAge(body.seconds)} as a take${note}`, 'ok');
    this.onSaved?.(body.name);
    return body;
  }

  async saveSel() {
    const sel = this.sel;
    if (!sel) return;
    const btn = this.selBar?.querySelector('.rb-sel-save');
    if (btn) btn.disabled = true;
    try {
      await this.saveSpan(sel.from, sel.to);
      if (this.sel === sel) this.setSel(null); // not one made since
    } catch (e) {
      this.onToast?.(`Could not save: ${e.message}`, 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  renderBar(ax) {
    const bar = this.selBar;
    if (!bar) return;
    const sel = this.sel;
    bar.hidden = !sel;
    if (!sel || !ax) return;
    const to = sel.to ?? ax.total;
    const fromAge = ageOf(sel.from, ax.total, ax.sr);
    const toAge = sel.to == null ? 0 : ageOf(to, ax.total, ax.sr);
    const len = (to - sel.from) / ax.sr;
    const buffered = this.data?.buffered_seconds ?? Infinity;
    const allGone = sel.to != null && toAge > buffered;
    const gone = fromAge > buffered;
    const when = sel.to == null ? `${fmtAge(fromAge)} ago to now` : `${fmtAge(fromAge)}–${fmtAge(toAge)} ago`;
    bar.querySelector('.rb-sel-text').textContent = allGone
      ? 'This span has left the buffer'
      : `${fmtAge(len)} · ${when}${gone ? ' · starts before the oldest audio' : ''}`;
    bar.classList.toggle('gone', gone);
    bar.querySelector('.rb-sel-save').disabled = allGone;
    const copy = bar.querySelector('.rb-sel-copy');
    if (copy) copy.disabled = allGone;
  }

  // --- a flag's sheet ---------------------------------------------------------

  wireFlagSheet() {
    const sh = this.flagSheet;
    if (!sh) return;
    sh.querySelector('.rb-flag-save').addEventListener('click', async () => {
      const f = this.sheetFlag;
      sh.close();
      if (!f) return;
      try { await this.saveSpan(f.frame, null); } catch (e) { this.onToast?.(`Could not save: ${e.message}`, 'bad'); }
    });
    sh.querySelector('.rb-flag-delete').addEventListener('click', () => {
      const f = this.sheetFlag;
      sh.close();
      if (f) this.removeFlag(f.frame);
    });
    sh.querySelector('.rb-flag-cancel').addEventListener('click', () => sh.close());
  }

  openFlag(f) {
    const sh = this.flagSheet;
    if (!sh || typeof sh.showModal !== 'function') { this.removeFlag(f.frame); return; }
    this.sheetFlag = f;
    sh.querySelector('.rb-flag-title').textContent = `Flag, ${fmtAge(f.age_seconds)} ago`;
    sh.showModal();
  }

  /** @param {number[]} spans tier lengths in seconds; 0 means the whole ring */
  setSpans(spans) {
    this.spans = spans.slice();
    if (this.selected === null || !this.spans.includes(this.selected)) {
      this.selected = this.spans[0] ?? null;
    }
    this.render();
    this.poll();
  }

  setSelected(seconds) {
    this.selected = seconds;
    this.render();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
  }

  async poll() {
    const spans = this.spans.slice(); // the spans this request actually asks for
    const w = Math.round(this.wrap.clientWidth) || 340;
    const n = Math.min(MAX_BUCKETS, Math.max(60, w));
    const q = `buckets=${n}&spans=${spans.join(',')}`;
    const seq = ++this._seq;

    let data;
    try {
      const res = await fetch(`/api/envelope?${q}`, { cache: 'no-store' });
      if (!res.ok) return; // keep the last ribbon drawn
      data = await res.json();
    } catch {
      // Keep the last ribbon drawn. The health dot already reports that the
      // server is unreachable, and a second indicator would add nothing.
      return;
    }

    if (seq !== this._seq) return; // a newer poll already superseded this one

    // The ring's frames count from the Pi's start: fewer than before means it
    // restarted, and a selection or open flag would now name other audio.
    if (this.data && data.total_frames < this.data.total_frames) {
      this.sel = null;
      this.prevSel = null;
      if (this.flagSheet?.open) this.flagSheet.close();
    }

    this.data = data;
    this.dataSpans = spans;
    this.render();
  }

  /** Backs undo of a mistap: click a ribbon tick to remove that live mark. */
  async removeFlag(frame) {
    try {
      const res = await fetch(`/api/flag?frame=${frame}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.onToast?.(body.error || 'could not remove flag', 'bad');
        return;
      }
      this.poll(); // redraw the ribbon without waiting for the next tick
    } catch {
      this.onToast?.('could not remove flag', 'bad');
    }
  }

  render() {
    const d = this.data;
    if (!d) return;

    const T = d.ring_seconds;
    const A = d.edge_seconds;
    const leftPct = (age) => axisPct(age, A, T);
    const abs = (s) => (s === 0 ? T : s);

    this.levels = ribbonLevels(decode(d.buckets));

    // Everything older than what is buffered is time that was never recorded,
    // not silence. Drawing it flat would read as "twelve minutes of quiet".
    this.hatch.style.width = `${leftPct(d.buffered_seconds).toFixed(2)}%`;

    const tiers = this.spans.map((s) => ({ s, age: abs(s) }));
    const sel = this.selected;

    this.renderSel();

    this.bandLayer.textContent = '';
    for (const t of tiers) {
      if (t.s !== sel) continue;
      const band = add(this.bandLayer, 'div', 'rb-band');
      const l = leftPct(t.age);
      band.style.left = `${l.toFixed(2)}%`;
      band.style.width = `${(100 - l).toFixed(2)}%`;
    }

    this.markLayer.textContent = '';
    for (const t of tiers) {
      const mark = add(this.markLayer, 'div', 'rb-mark' + (t.s === sel ? ' on' : ''));
      mark.style.left = `${leftPct(t.age).toFixed(2)}%`;
    }

    // A pill at each capture length, the chosen one lit; the fixed REC stays.
    for (const old of this.labelLayer.querySelectorAll('.rb-label')) old.remove();
    for (const p of tierPills(this.spans, sel, T, leftPct)) {
      const label = document.createElement('span');
      label.className = 'rb-label' + (p.on ? ' on' : '') + (p.x <= 1 ? ' edge' : '');
      label.textContent = p.label;
      label.style.left = `${p.x.toFixed(2)}%`;
      this.labelLayer.appendChild(label);
    }

    this.ruler.textContent = '';
    for (const t of rulerTicks(T, leftPct, { width: this.wrap.clientWidth || 340, minPx: 44 })) {
      const tick = add(this.ruler, 'span', 'rb-tick' + (t.x <= 1 ? ' edge' : t.x >= 99.5 ? ' now' : ''));
      tick.textContent = t.label;
      tick.style.left = `${t.x.toFixed(2)}%`;
    }

    // Live marks, drawn on the same log axis as everything else. The server
    // sends each mark as {age_seconds, frame}: age for the log-axis position,
    // in the same currency the rest of the ribbon already thinks in, and frame
    // so a click can undo a mistap with DELETE /api/flag?frame=N without a
    // second round trip. `d.flags` is absent on an older response shape,
    // hence the fallback.
    this.flagLayer.textContent = '';
    for (const f of d.flags || []) {
      const flag = add(this.flagLayer, 'div', 'rb-flag');
      flag.style.left = `${leftPct(f.age_seconds).toFixed(2)}%`;
      flag.title = `flag at ${fmtDur(f.age_seconds)} ago — tap for its options`;
      flag.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFlag(f);
      });
    }

    this.readout.textContent = this.readoutText(d, abs(sel));
  }

  // A span selected on the ribbon, in place of the tier's shading.
  renderSel() {
    const d = this.data;
    const ax = this.axis();
    this.selLayer.textContent = '';
    if (this.sel && ax) {
      const fromAge = Math.min(ageOf(this.sel.from, ax.total, ax.sr), d.buffered_seconds);
      const toAge = this.sel.to == null ? 0 : Math.min(ageOf(this.sel.to, ax.total, ax.sr), d.buffered_seconds);
      const l = axisPct(fromAge, ax.A, ax.T);
      const r = this.sel.to == null ? 100 : axisPct(toAge, ax.A, ax.T);
      const band = add(this.selLayer, 'div', 'rb-sel-band');
      band.style.left = `${l.toFixed(2)}%`;
      band.style.width = `${Math.max(0.4, r - l).toFixed(2)}%`;
    }
    this.bandLayer.hidden = !!this.sel;
    this.renderBar(ax);
    this.paint();
  }

  // paint draws the tape: the whole ring, with the chosen length -- or a span
  // held on the ribbon -- lit.
  paint() {
    const d = this.data;
    const r = this.canvas.getBoundingClientRect();
    if (!d || r.width <= 0 || r.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = r.width, H = r.height;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const T = d.ring_seconds, A = d.edge_seconds;
    const px = (age) => (axisPct(age, A, T) / 100) * W;
    let lit = null;
    const ax = this.axis();
    if (this.sel && ax) {
      const fromAge = Math.min(ageOf(this.sel.from, ax.total, ax.sr), d.buffered_seconds);
      const toAge = this.sel.to == null ? 0 : Math.min(ageOf(this.sel.to, ax.total, ax.sr), d.buffered_seconds);
      lit = [px(fromAge), this.sel.to == null ? W : px(toAge)];
    } else if (this.selected != null) {
      lit = [px(this.selected === 0 ? T : this.selected), W];
    }
    this.colors ||= ribbonColors((name, fb) => token(name, fb, this.wrap));
    drawRibbon(ctx, { W, H, levels: this.levels, lit, recordedFrom: px(d.buffered_seconds), colors: this.colors });
  }

  readoutText(d, span) {
    if (d.buffered_seconds <= 0) return 'buffer empty';
    if (this.selected === null) return 'connecting';

    const i = this.dataSpans ? this.dataSpans.indexOf(this.selected) : -1;
    const signal = i >= 0 ? d.signal_seconds?.[i] : undefined;

    // Empty wins over under-buffered when both hold: if the buffer holds 90s,
    // the span is 7m and that 90s is silent, SILENT is the more actionable of
    // the two true statements. An unknown signal (index not found, or the
    // response predates the field) is not evidence of silence, so it reads as
    // a plain span — SILENT is the only line here that stops someone pressing
    // Capture, and it must earn that with positive evidence.
    if (signal === undefined) return `last ${fmtDur(span)}`;
    if (signal < 0.5) return `last ${fmtDur(span)} — SILENT, this would save nothing`;
    if (span > d.buffered_seconds + 0.5) {
      return `last ${fmtDur(span)} — only ${fmtDur(Math.round(d.buffered_seconds))} buffered`;
    }
    return `last ${fmtDur(span)}`;
  }
}
