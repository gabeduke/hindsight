// web/static/lib/bar/bar-harness.js
// For tests only (nothing in the app imports it): the real Transport
// (lib/components/transport/, NowPlaying its mount) and the engine it draws
// (lib/models/engine.js), mounted as the shell mounts it, in shell.html's
// own page, on a stand-in document, with the clock, the
// storage, the location, the audio and the Pi the test's. The bar's page
// wiring -- what a click on ✎ does, what the strip hears -- is run, not read.
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML, FakeEl } from '../play/fake-dom.js';
import { ticker } from '../objects/motion.js';

const takesHtml = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const SR = 48000;

// A canvas that draws nothing: the strip is painted, and the test is not looking.
const nop = new Proxy(function nop() {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : typeof k === 'symbol' ? undefined : nop), apply: () => nop, set: () => true });
FakeEl.prototype.getContext = function getContext() { return nop; };

class FakeAudio {
  constructor() { this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.preload = ''; this._src = ''; this.l = {}; }
  get src() { return this._src; }
  set src(v) { this._src = String(v || ''); }
  getAttribute(k) { return k === 'src' ? (this._src || null) : null; }
  removeAttribute(k) { if (k === 'src') this._src = ''; }
  load() { if (!this._src) this.emit('emptied'); }
  async play() { this.paused = false; this.emit('play'); }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
  addEventListener(ev, fn, opts) {
    (this.l[ev] ??= []).push(fn);
    opts?.signal?.addEventListener('abort', () => { this.l[ev] = this.l[ev].filter((f) => f !== fn); });
  }
  removeEventListener(ev, fn) { this.l[ev] = (this.l[ev] || []).filter((f) => f !== fn); }
  emit(ev) { for (const f of this.l[ev] || []) f(); }
}

/** aTake is take `name` as the list would hand it to the bar: {t, player, audio}. */
export function aTake(name = 'jam_x.wav', { seconds = 120, label = '' } = {}) {
  const audio = new FakeAudio();
  const peaks = { buckets: 4, channels: 2, duration: seconds, data: [new Float32Array(8), new Float32Array(8)] };
  const player = { audio, peaks, toggle: async () => { audio.paused = !audio.paused; audio.emit(audio.paused ? 'pause' : 'play'); } };
  const t = { name, label, sample_rate: SR, duration_seconds: seconds, bpm: null, trim: null };
  return { t, player, audio };
}

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};

/**
 * barPage builds the world and the bar in it, as the shell has it: the
 * engine and the NowPlaying that draws it (`np`). `bar` is the engine's
 * `bar`; with `engine` it answers the whole engine too, and with `drawn`
 * false it makes no NowPlaying: the engine on its own, as a model; with
 * `tape` the page's tape model is made and handed to both, as the shell
 * does (and answered as `tape`). `tapes` is initNav's answer ({loaded: id} puts a tape on the Pi), and
 * `answer(url, init)` is what the Pi says to a fetch: undefined is a 404.
 */
export async function barPage({ session = {}, tapes = null, answer = () => undefined, engine: whole = false, drawn = true, tape: withTape = false } = {}) {
  // The pages share one ticker: a page the last test left must not run in this one.
  ticker.stop();
  ticker.steps.clear();
  const w = { navigated: [], windowListeners: {}, raf: [], toasts: [], fetched: [], sockets: [] };
  // The Pi's sockets (the tape's changes, lib/tape/changes.js): made, and
  // never opened, as a Pi that is slow to answer leaves them.
  class FakeSocket {
    constructor(url) { this.url = url; this.closed = false; w.sockets.push(this); }
    close() { this.closed = true; }
  }
  const addL = (type, fn) => { (w.windowListeners[type] ??= []).push(fn); };
  const removeL = (type, fn) => { w.windowListeners[type] = (w.windowListeners[type] || []).filter((f) => f !== fn); };
  const doc = fakeDoc();
  w.session = store(session);
  w.local = store();
  const loc = { pathname: '/takes.html', search: '', get href() { return this._h || ''; }, set href(v) { w.onNavigate?.(v); w.navigated.push(v); this._h = v; } };
    Object.assign(globalThis, {
    Audio: FakeAudio,
    document: doc,
    location: loc,
    sessionStorage: w.session,
    localStorage: w.local,
    // The ticker's frames are the test's to run (frames()).
    requestAnimationFrame: (fn) => { w.raf.push(fn); return w.raf.length; },
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    history: { state: null, replaceState() {}, pushState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    WebSocket: FakeSocket,
    addEventListener: addL,
    removeEventListener: removeL,
    window: { addEventListener: addL, removeEventListener: removeL },
    fetch: async (url, init) => {
      w.fetched.push(url);
      const body = answer(url, init);
      return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body ?? {} };
    },
  });
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  doc.body.append(...parseHTML(doc, takesHtml).children);
  const { createEngine } = await import('../models/engine.js');
  const { mountComponent } = await import('../components/mount.js');
  const { default: transport, TAPE_KEYS } = await import('../components/transport/index.js');
  const onToast = (m) => w.toasts.push(m);
  // The page's tape model, as the shell makes it and hands it to the engine
  // and the bar (the Studio's keys, the lamp, the output strip): with `tape`.
  const { createTape } = await import('../models/tape.js');
  const pageTape = withTape ? createTape({}) : null;
  const made = createEngine({ tapes: Promise.resolve(tapes), onToast, find: null, tape: pageTape });
  // The room shown, as the shell's router says it (w.room).
  w.room = null;
  // What the shell mounts the Transport in (lib/shell/boot.js): its shell
  // scope's ctx, stood in for here, on the stand-in window and document,
  // and the surface's props. The bar is handed a tape model and a phone
  // recorder, as the shell's always is: without `tape` one nothing loads,
  // and a recorder that stays closed.
  const { layersOf } = await import('../ui/layers.js');
  const { barLayout } = await import('./layout.js');
  const { relay } = await import('../components/relay.js');
  const ctx = {
    on: (target, type, fn, opts) => { target.addEventListener(type, fn, opts); return () => target.removeEventListener(type, fn, opts); },
    media: (q) => globalThis.matchMedia(q),
    layers: layersOf(doc),
    active: () => true,
    toast: onToast,
  };
  const closed = Object.freeze({ mode: 'closed', seconds: 0 });
  const recorder = { snapshot: () => closed, state: () => ({ ...closed }), onChange: () => () => {}, open() {}, quick() {}, stop() {}, input: () => '', inputs: async () => [] };
  const rooms = new Set();
  const tapeKeys = relay(TAPE_KEYS);
  const models = { bar: made.bar, transport: made.transport, tape: pageTape || createTape({}), takes: made.takes, recorder };
  // Help's titles, as the shell hands them (lib/help/help.js applyTitles).
  const { applyTitles } = await import('../help/help.js');
  const props = { layout: barLayout(doc), room: () => w.room, onRoom: (fn) => { rooms.add(fn); return () => rooms.delete(fn); }, tapeKeys, titles: applyTitles };
  const mounted = drawn ? mountComponent(transport, doc.getElementById('np'), models, ctx, props) : null;
  // The bar as a test drives it: its keys' relay (the Studio's ctx.tapeKeys),
  // and the shell's kick as the room switches (onRoom).
  const np = mounted ? { tapeKeys: tapeKeys.api, kick: () => { for (const fn of rooms) fn(); }, unmount: () => mounted.unmount() } : null;
  // What the shell does around the bar it makes (lib/shell/boot.js): its
  // height into --np-h, measured on its root.
  if (np) (await import('./slots.js')).measureBar(doc.getElementById('np'));
  const engine = whole ? made : null;
  const bar = made.bar;
  await bar.ready;
  // Run the frames the bar and the reels asked for, as the browser would.
  const frames = (n = 3) => { for (let i = 0; i < n; i++) { const q = w.raf.splice(0); for (const f of q) f(); } };
  const $ = (id) => doc.getElementById(id);
  const click = (el, extra = {}) => el.dispatchEvent({ type: 'click', target: el, detail: 1, preventDefault() {}, ...extra });
  const pointer = (type, el, x, extra = {}) => el.dispatchEvent({ type, target: el, button: 0, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 5, preventDefault() {}, ...extra });
  // The strip is 300 px wide on this page, starting at 10: a tap at x is x-10 of 300.
  // (With no bar drawn, there is no strip.)
  const scrub = $('np-scrub');
  if (scrub) scrub.getBoundingClientRect = () => ({ left: 10, top: 0, right: 310, bottom: 40, width: 300, height: 40 });
  return { w, doc, bar, engine, np, tape: pageTape, frames, $, click, pointer, SR, windowKey: (e) => { for (const f of w.windowListeners.keydown || []) f(e); } };
}
