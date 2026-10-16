// web/static/lib/room/harness.js
// For tests only (nothing in the app imports it): the Listening Room's
// doorway (lib/room/doorway.js) -- the real module -- mounted on takes.html's
// real markup, built on a stand-in document, with the take list, its players,
// the bar and the Pi as stand-ins and the clock the test's. doorway.test.js
// and routes.test.js both stand on it.
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';

const takesHtml = readFileSync(new URL('../../takes.html', import.meta.url), 'utf8');

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
  const w = { intervals: [], navigated: [], search, session: store(), local: store({ 'hindsight.rooms': '1' }) };
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.setInterval = (fn, ms) => { w.intervals.push({ fn, ms }); return w.intervals.length; };
  globalThis.sessionStorage = w.session;
  globalThis.localStorage = w.local;
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
  doc.body.append(...parseHTML(doc, takesHtml).children);
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
  const h = {
    takes: list, toast: (m) => toasts.push(m), tapes: Promise.resolve(tapes),
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
  await mount(h);
  await Promise.resolve(tapes);
  await new Promise((r) => setImmediate(r));
  const q = (sel) => doc.querySelector(sel);
  const spine = (name) => doc.querySelector(`[data-key="take:${name}"]`);
  const touch = (el, type, extra = {}) => el.dispatchEvent({ type, target: el, button: 0, pointerType: 'touch', clientX: 5, clientY: 5, preventDefault() {}, ...extra });
  const settle = () => new Promise((r) => setImmediate(r));
  const tick = () => { for (const i of w.intervals) i.fn(); };
  // The page's list changed (a poll that brought something, a tag renamed): what shelf-page tells the room.
  const changed = () => { for (const f of hooks.change) f(); };
  return { w, doc, np, h, list, log, toasts, sheet, q, spine, touch, settle, tick, changed, players, mounted: true };
}
// The dialogs the room made (the page's own #confirm is the trash's).
export const roomDialogs = (r) => r.doc.querySelectorAll('dialog').filter((d) => d.id !== 'confirm').map((d) => d.className);
export const click = (el, extra = {}) => el.dispatchEvent({ type: 'click', target: el, detail: 1, preventDefault() {}, ...extra });

export const TAPES = { loaded: 't1', tapes: [{ id: 't1', name: 'Tuesday groove', seconds: 12, clips: 3 }, { id: 't2', name: 'Sunday loop', seconds: 30 }] };
