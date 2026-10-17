// web/static/lib/room/harness.js
// For tests only (nothing in the app imports it): the Listening Room's
// doorway (lib/room/doorway.js) -- the real module -- mounted on takes.html's
// real markup, built on a stand-in document, with the take list, its players,
// the bar and the Pi as stand-ins and the clock the test's. doorway.test.js
// and routes.test.js both stand on it.
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { Ticker } from '../objects/motion.js';

const takesHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');

export const NOW = Date.now();
export const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
export const MIN = 60_000;
export const take = (n, extra = {}) => ({
  name: `jam_${n}.wav`, label: n, created: iso(10 * MIN), duration_seconds: 119, sample_rate: 48000, has_preview: true, ...extra,
});

// What the page leaves in the world for the room: globals the room reads.
export function world(search = '') {
  const store = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
  };
  const w = { intervals: [], navigated: [], search, session: store(), local: store() };
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.setInterval = (fn, ms) => { w.intervals.push({ fn, ms }); return w.intervals.length; };
  globalThis.sessionStorage = w.session;
  globalThis.localStorage = w.local;
  // The window the flight listens on, and the screen it flies across.
  w.winListeners = {};
  globalThis.window = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener: (t, f) => { (w.winListeners[t] ??= new Set()).add(f); },
    removeEventListener: (t, f) => { w.winListeners[t]?.delete(f); },
  };
  w.reducedMotion = false;
  globalThis.matchMedia = (q) => ({ matches: w.reducedMotion && /reduced-motion/.test(q), addEventListener() {} });
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const loc = {
    _href: '', search: w.search || '',
    get href() { return this._href; }, set href(v) { w.navigated.push(v); this._href = v; },
    replace(u) { w.navigated.push(`replace ${u}`); },
  };
  globalThis.location = loc;
  return w;
}

/** A page with the Listening Room mounted on it. */
export async function room({ takes = [take('a'), take('b'), take('c')], tapes = null, barTake = null, selecting = false, search = '' } = {}) {
  const w = world(search);
  const doc = fakeDoc();
  globalThis.document = doc;
  const roomOnly = takesHtml
    .replace(/<main id="view-studio"[\s\S]*?<\/main>/, '')
    .replace(/<template\b[\s\S]*?<\/template>/g, '');
  doc.body.append(...parseHTML(doc, roomOnly).children);
  // The bar the page has: pageBar's face, and its answer.
  const np = { takeName: barTake, loads: [] };
  np.loadTake = (t, p) => { np.takeName = t.name; np.loads.push(t.name); np.player = p; };
  const players = new Map();
  const log = [];
  const hooks = { change: new Set(), selected: new Set() };
  const list = {
    all: takes,
    selecting,
    selected: new Set(),
    async player(name) {
      if (!players.has(name)) {
        const audio = { paused: true };
        players.set(name, { audio, toggle: async () => { audio.paused = !audio.paused; log.push(`${audio.paused ? 'pause' : 'play'} ${name}`); doc.getElementById('np-play').classList.toggle('playing', !audio.paused); } });
      }
      return players.get(name);
    },
    enterSelect(name) { this.selecting = true; this.selected = new Set(name ? [name] : []); log.push(`select ${name}`); for (const f of hooks.selected) f(); },
    toggleSelected(name) { if (this.selected.has(name)) this.selected.delete(name); else this.selected.add(name); for (const f of hooks.selected) f(); },
    exitSelect() { this.selecting = false; this.selected.clear(); for (const f of hooks.selected) f(); },
  };
  const toasts = [];
  const sheet = { opened: 0 };
  // The flight's clock and ticker are the test's: run(ms) moves time on, a frame per 16 ms, and fires the timers that fall due.
  const clock = { now: 0, raf: [], timers: [] };
  const ticker = new Ticker({ raf: (fn) => { clock.raf.push(fn); return clock.raf.length; }, cancel: () => {}, now: () => clock.now, reduced: false });
  const flightTimers = { set: (fn, ms) => { const t = { fn, at: clock.now + ms }; clock.timers.push(t); return t; }, clear: (t) => { clock.timers = clock.timers.filter((x) => x !== t); } };
  const run = (ms) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + 16);
      for (const f of clock.raf.splice(0)) f();
      for (const t of [...clock.timers].sort((a, b) => a.at - b.at)) if (t.at <= clock.now) { clock.timers = clock.timers.filter((x) => x !== t); t.fn(); }
    }
  };
  const h = {
    takes: list, toast: (m) => toasts.push(m), tapes: Promise.resolve(tapes), ticker, flightTimers,
    get np() { return np; },
    opts: () => ({}),
    // The page's rack and its select bar, which the room wires.
    rack: doc.getElementById('takes'), selectBar: doc.getElementById('select-bar'),
    pick: (n) => log.push(`pick ${n}`),
    setFilter: () => {}, clearFilter: () => {},
    onChange: (f) => hooks.change.add(f),
    onSelected: (f) => hooks.selected.add(f),
    // What the page handed the room before the sheet went: they must never be used.
    openSheet: () => { sheet.opened++; }, closeSheet: () => { sheet.opened++; }, sheetOpen: () => null,
    onShow: () => {}, onClosed: () => {},
    detail: { el: () => doc.createElement('div') },
    playAll: { running: () => false, from: () => { sheet.opened++; }, stop: () => {} },
  };
  const { mount } = await import('./doorway.js');
  const mounted = await mount(h);
  await Promise.resolve(tapes);
  await new Promise((r) => setImmediate(r));
  const q = (sel) => doc.querySelector(sel);
  const spine = (name) => doc.querySelector(`[data-key="take:${name}"]`);
  const touch = (el, type, extra = {}) => el.dispatchEvent({ type, target: el, button: 0, pointerType: 'touch', clientX: 5, clientY: 5, preventDefault() {}, ...extra });
  const settle = () => new Promise((r) => setImmediate(r));
  const tick = () => { mounted?.renderPlaces?.(); for (const i of w.intervals) i.fn(); };
  // The page's list changed (a poll that brought something, a tag renamed): what shelf-page tells the room.
  const changed = () => { for (const f of hooks.change) f(); };
  const ghosts = () => doc.body.querySelectorAll('.room-carry');
  return { w, doc, np, h, list, log, toasts, sheet, q, spine, touch, settle, tick, changed, players, mounted: true, clock, run, ghosts };
}
const SHELL_DIALOGS = new Set(['confirm', 'jam-only', 'away-sheet', 'clip-sheet', 'track-sheet', 'section-sheet', 'rename-sheet']);
export const roomDialogs = (r) => r.doc.querySelectorAll('dialog').filter((d) => !SHELL_DIALOGS.has(d.id)).map((d) => d.className);
export const click = (el, extra = {}) => el.dispatchEvent({ type: 'click', target: el, detail: 1, preventDefault() {}, ...extra });

export const TAPES = { loaded: 't1', tapes: [{ id: 't1', name: 'Tuesday groove', seconds: 12, clips: 3 }, { id: 't2', name: 'Sunday loop', seconds: 30 }] };
