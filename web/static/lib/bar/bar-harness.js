// web/static/lib/bar/bar-harness.js
// For tests only (nothing in the app imports it): the real NowPlaying
// (lib/bar/bar.js) built on takes.html's own markup, on a stand-in document,
// with the clock, the storage, the location and the audio the test's. The
// bar's page wiring -- what a click on ✎ does, what the strip hears -- is
// run, not read.
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML, FakeEl } from '../play/fake-dom.js';
import { ticker } from '../objects/motion.js';

const takesHtml = readFileSync(new URL('../../takes.html', import.meta.url), 'utf8');
const SR = 48000;

// A canvas that draws nothing: the strip is painted, and the test is not looking.
const nop = new Proxy(function nop() {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : typeof k === 'symbol' ? undefined : nop), apply: () => nop, set: () => true });
FakeEl.prototype.getContext = function getContext() { return nop; };

class FakeAudio {
  constructor() { this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.l = {}; }
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

/** barPage builds the world and NowPlaying in it. */
export async function barPage({ session = {} } = {}) {
  // The pages share one ticker: a page the last test left must not run in this one.
  ticker.stop();
  ticker.steps.clear();
  const w = { navigated: [], windowListeners: {}, raf: [], toasts: [] };
  const doc = fakeDoc();
  w.session = store(session);
  w.local = store();
  const loc = { pathname: '/takes.html', search: '', get href() { return this._h || ''; }, set href(v) { w.onNavigate?.(v); w.navigated.push(v); this._h = v; } };
  Object.assign(globalThis, {
    document: doc,
    location: loc,
    sessionStorage: w.session,
    localStorage: w.local,
    // The ticker's frames are the test's to run (frames()).
    requestAnimationFrame: (fn) => { w.raf.push(fn); return w.raf.length; },
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    history: { state: null, replaceState() {}, pushState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: (type, fn) => { (w.windowListeners[type] ??= []).push(fn); },
    window: { addEventListener: (type, fn) => { (w.windowListeners[type] ??= []).push(fn); } },
  });
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  doc.body.append(...parseHTML(doc, takesHtml).children);
  const { pageBar } = await import('./bar.js');
  const bar = pageBar({ tapes: Promise.resolve(null), onToast: (m) => w.toasts.push(m), find: null });
  await bar.ready;
  // Run the frames the bar and the reels asked for, as the browser would.
  const frames = (n = 3) => { for (let i = 0; i < n; i++) { const q = w.raf.splice(0); for (const f of q) f(); } };
  const $ = (id) => doc.getElementById(id);
  const click = (el, extra = {}) => el.dispatchEvent({ type: 'click', target: el, detail: 1, preventDefault() {}, ...extra });
  const pointer = (type, el, x, extra = {}) => el.dispatchEvent({ type, target: el, button: 0, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 5, preventDefault() {}, ...extra });
  // The strip is 300 px wide on this page, starting at 10: a tap at x is x-10 of 300.
  $('np-scrub').getBoundingClientRect = () => ({ left: 10, top: 0, right: 310, bottom: 40, width: 300, height: 40 });
  return { w, doc, bar, frames, $, click, pointer, SR, windowKey: (e) => { for (const f of w.windowListeners.keydown || []) f(e); } };
}
