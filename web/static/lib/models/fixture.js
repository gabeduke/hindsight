// web/static/lib/models/fixture.js
// A protocol client with no Pi, for the tests and the components' harness
// (scripts/components.mjs; docs/architecture/components.md, *Fixtures*).
// It answers reads from JSON snapshots, saved answers of the Pi's
// (testdata/protocol/<noun>/<case>.json), records the verbs it is sent, and
// can refuse one, so a component's refused press is checked too. It names no
// route and opens nothing: it is protocol.js's three methods over plain data.
//
// Not shipped to a phone: nothing a page loads imports it, and it stays out
// of sw.js's SHELL.

import { Refusal } from './protocol.js';
import { createTakes } from './takes.js';
import { createTransport } from './transport.js';

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
 *                 answers or throws its Refusal: the methods the real
 *                 client gains as each model's verbs move onto it
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

// What a fixture answers the transport, as the Pi's /api/tapes/state would
// be: until the transport's model is on the protocol client (the spec's
// models step), it is made over the fetch, send and socket its tests stand
// in for. Its one read is the tape's state, its commands are ▶ ■, a locate
// and the loop, and asking which tape is loaded answers the fixture's.
function transportEnv(fx) {
  const answer = (ok, body, status = ok ? 200 : 409) => ({ ok, status, json: async () => body });
  return {
    fetch: async () => {
      const r = await fx.read('tape');
      return answer(r.ok, r.body, r.status);
    },
    send: async (_url, o = {}) => {
      if (!o.method) return answer(true, { loaded: fx.peek('tape')?.tape?.id ?? null });
      const body = JSON.parse(o.body || '{}');
      const [noun, name, args] = body.action
        ? ['transport', body.action, body.pos == null ? {} : { pos: body.pos }]
        : ['tape', 'setLoop', body.loop ?? {}];
      try {
        return answer(true, await fx.verb(noun, name, args));
      } catch (e) {
        return answer(false, { error: e.message, reason: e.reason || undefined }, e.status || 409);
      }
    },
    watch: (h) => fx.watch(h),
  };
}

/** MAKERS make each model a component may need over a fixture, and set it going. */
const MAKERS = {
  takes(fx) {
    const takes = createTakes({ protocol: fx });
    const sock = fx.watch({ onTakes: (m) => takes.heard(m) });
    return { model: takes, ready: takes.refresh().catch(() => null), stop: () => sock.close() };
  },
  transport(fx, { onError = null } = {}) {
    const transport = createTransport({ ...transportEnv(fx), onError });
    const id = fx.peek('tape')?.tape?.id;
    if (!id) return { model: transport, ready: Promise.resolve(), stop: () => transport.destroy() };
    const ready = new Promise((resolve) => {
      const off = transport.onChange(() => { if (transport.tape) { off(); resolve(); } });
    });
    transport.load(id);
    transport.setActive(true);
    return { model: transport, ready, stop: () => transport.destroy() };
  },
};

/** MODELS are the nouns a fixture can make a model of. */
export const MODELS = Object.freeze(Object.keys(MAKERS));

/**
 * fixtureModels makes the models named in `needs` over the fixture `fx`:
 * {models, ready, stop()}. ready is a promise of each model holding the
 * fixture's first answer; stop() ends their polls and sockets. opts.onError
 * hears what the transport's refused presses say, as the bar's toast does.
 */
export function fixtureModels(fx, needs, opts = {}) {
  const made = needs.map((noun) => {
    const make = MAKERS[noun];
    if (!make) throw new TypeError(`no fixture model for ${noun}: one of ${MODELS.join(', ')}`);
    return [noun, make(fx, opts)];
  });
  return {
    models: Object.freeze(Object.fromEntries(made.map(([noun, m]) => [noun, m.model]))),
    ready: Promise.all(made.map(([, m]) => m.ready)).then(() => {}),
    stop() { for (const [, m] of made) m.stop(); },
  };
}
