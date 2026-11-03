// web/static/lib/models/fixture.js
// A protocol client with no Pi, for the tests and the components' harness
// (scripts/components.mjs; docs/architecture/components.md, *Fixtures*).
// It answers reads from JSON snapshots, saved answers of the Pi's
// (testdata/protocol/<noun>/<case>.json), records the verbs it is sent, and
// can refuse one, so a component's refused press is checked too. It names no
// route and opens nothing: it is protocol.js's three methods over plain data.
//
// It is in a release like everything under web/static, but nothing a page
// loads imports it, and it stays out of sw.js's SHELL: no phone caches it.

import { Refusal } from './protocol.js';
import { createTakes } from './takes.js';
import { createTape } from './tape.js';
import { createTransport } from './transport.js';
import { createEngine } from './engine.js';
import { barLayout } from '../bar/layout.js';

const clone = (v) => (v == null ? v : structuredClone(v));

/**
 * fixture makes a protocol client over `snapshots`, a body per noun
 * ({takes: [...], tape: {tape, loaded, live, …}}). opts:
 *   refuse   verbs it refuses, by name or noun.name: a code
 *            ({play: 'no_audio_out'}) or a Refusal's fields
 *   answers  what a verb answers, by name or noun.name (default {})
 *
 * It answers protocol.js's read(noun, {v}) and nouns, and:
 *   verb(noun, name, body)  records {noun, name, body} in calls, then
 *                 answers or throws its Refusal, as protocol.js's verb
 *                 does (the tape's id it is sent for is not recorded)
 *   watch({onNudge, onPress, onTakes})
 *                 the changes socket, as lib/tape/changes.js's
 *                 watchChanges is: answers {close()}
 *   calls         the verbs sent, in order
 *   peek(noun)    the body held now
 *   set(noun, body)
 *                 the Pi's state moved: a new body and version, and the
 *                 socket says so (the tape's rev, or takes_rev)
 *   press(p)      the keyboard pressed something (the socket's press)
 */
export function fixture(snapshots = {}, { refuse = {}, answers = {} } = {}) {
  const held = new Map();
  let n = 0;
  const hold = (noun, body) => held.set(noun, { body: clone(body), v: `"fx-${noun}-${++n}"` });
  for (const [noun, body] of Object.entries(snapshots)) hold(noun, body);
  const calls = [];
  const watchers = new Set();
  const tell = (k, m) => { for (const w of [...watchers]) w[k]?.(m); };
  const pick = (table, noun, name) => table[`${noun}.${name}`] ?? table[name];

  return Object.freeze({
    get nouns() { return [...held.keys()]; },
    async read(noun, { v = null } = {}) {
      const h = held.get(noun);
      if (!h) return { ok: false, status: 404, v: null, body: null };
      if (v && v === h.v) return { ok: false, status: 304, v: h.v, body: null };
      return { ok: true, status: 200, v: h.v, body: clone(h.body) };
    },
    async verb(noun, name, body = {}) {
      calls.push({ noun, name, body: clone(body) });
      const no = pick(refuse, noun, name);
      if (no) {
        const why = typeof no === 'string' ? { code: no, message: no } : no;
        throw new Refusal({ status: 409, ...why });
      }
      return clone(pick(answers, noun, name) ?? {});
    },
    watch(handlers) {
      const w = { ...handlers };
      watchers.add(w);
      return { close() { watchers.delete(w); } };
    },
    calls,
    peek: (noun) => clone(held.get(noun)?.body),
    set(noun, body) {
      hold(noun, body);
      if (noun === 'takes') tell('onTakes', { takes_rev: n });
      else tell('onNudge', { rev: n });
    },
    press(p) { tell('onPress', p); },
  });
}

/** MAKERS make each model a component may need over a fixture, and set it going. */
const MAKERS = {
  takes(fx) {
    const takes = createTakes({ protocol: fx });
    const sock = fx.watch({ onTakes: (m) => takes.heard(m) });
    // A fixture with no takes is a mistake in the check: ready says so.
    return { model: takes, ready: takes.refresh(), stop: () => sock.close() };
  },
  tape(fx) {
    const tape = createTape({ protocol: fx });
    const sock = fx.watch({ onNudge: () => tape.nudge() });
    const stop = () => { sock.close(); tape.destroy(); };
    const id = fx.peek('tape')?.tape?.id;
    if (!id) return { model: tape, ready: Promise.resolve(), stop };
    const ready = new Promise((resolve) => {
      const off = tape.onChange((s) => { if (s.tape) { off(); resolve(); } });
    });
    tape.load(id);
    return { model: tape, ready, stop };
  },
  transport(fx) {
    const state = fx.peek('tape');
    // The transport follows the Pi to whichever tape is loaded: a fixture
    // of one that isn't would have it ask for ever.
    if (state && !state.loaded) throw new TypeError('a tape fixture for the transport is the loaded tape’s: loaded: true');
    const transport = createTransport({ protocol: fx });
    const id = state?.tape?.id;
    if (!id) return { model: transport, ready: Promise.resolve(), stop: () => transport.destroy() };
    const ready = new Promise((resolve) => {
      const off = transport.onChange(() => { if (transport.snapshot().tape) { off(); resolve(); } });
    });
    transport.load(id);
    transport.setActive(true);
    return { model: transport, ready, stop: () => transport.destroy() };
  },
  // The engine's bar (lib/models/engine.js), what plays in the bar, over
  // the fixture: the tape, when its fixture is the loaded one. The engine
  // owns the bar's audio, so it needs a page (Audio, location, storage): a
  // browser, or bar-harness.js's stand-in one. A take in it needs its Audio
  // and peaks, which no fixture serves yet.
  bar(fx) {
    const state = fx.peek('tape');
    const loaded = state?.loaded ? state.tape?.id || null : null;
    const engine = createEngine({ tapes: { loaded }, protocol: fx, onToast: () => {} });
    const stop = () => { engine.tape?.destroy(); engine.transport.destroy(); engine.feed?.destroy(); };
    return { model: engine.bar, ready: engine.bar.ready, stop };
  },
  // The phone's recorder (lib/phone/recorder.js) as a component sees it:
  // its snapshot, {mode, seconds}, from the fixture's `recorder` body
  // (closed, by default), and its verbs, recorded (or refused) as the Pi's
  // are, as recorder.open, .quick and .stop. A verb moves nothing: the
  // check moves it with fx.set('recorder', …), as it does the Pi's state.
  recorder(fx) {
    const fns = new Set();
    let snap = null;
    const snapshot = () => {
      const r = fx.peek('recorder') || {};
      const mode = r.mode || 'closed';
      const seconds = Math.floor(Number(r.seconds) || 0);
      if (!snap || snap.mode !== mode || snap.seconds !== seconds) snap = Object.freeze({ mode, seconds });
      return snap;
    };
    const sock = fx.watch({
      onNudge: () => {
        const before = snap;
        if (snapshot() !== before) for (const fn of [...fns]) fn(snap);
      },
    });
    snapshot();
    const verb = (name) => () => fx.verb('recorder', name);
    const model = Object.freeze({
      snapshot,
      state: () => ({ ...snapshot() }),
      onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
      open: verb('open'),
      quick: verb('quick'),
      stop: verb('stop'),
    });
    return { model, ready: Promise.resolve(), stop: () => sock.close() };
  },
  // The bar's layout (lib/bar/layout.js), the page's: barLayout itself, on
  // a body of its own that no page shows, from the fixture's `layout`
  // ({folded, open}, both false by default). set() moves it, as the
  // surface's grabber and the player do.
  layout(fx) {
    const at = fx.peek('layout') || {};
    const classes = new Set([at.folded ? 'np-fold' : '', at.open ? 'player-open' : ''].filter(Boolean));
    const classList = {
      contains: (c) => classes.has(c),
      toggle(c, on = !classes.has(c)) { if (on) classes.add(c); else classes.delete(c); return on; },
    };
    return { model: barLayout({ body: { classList } }), ready: Promise.resolve(), stop() {} };
  },
};

/** MODELS are the nouns a fixture can make a model of. */
export const MODELS = Object.freeze(Object.keys(MAKERS));

/**
 * fixtureModels makes the models named in `needs` over the fixture `fx`:
 * {models, ready, stop()}. ready is a promise of each model holding the
 * fixture's first answer; stop() ends their polls and sockets. A refused
 * verb throws its Refusal to whoever pressed, as on the page.
 */
export function fixtureModels(fx, needs) {
  const made = needs.map((noun) => {
    const make = MAKERS[noun];
    if (!make) throw new TypeError(`no fixture model for ${noun}: one of ${MODELS.join(', ')}`);
    return [noun, make(fx)];
  });
  return {
    models: Object.freeze(Object.fromEntries(made.map(([noun, m]) => [noun, m.model]))),
    ready: Promise.all(made.map(([, m]) => m.ready)).then(() => {}),
    stop() { for (const [, m] of made) m.stop(); },
  };
}
