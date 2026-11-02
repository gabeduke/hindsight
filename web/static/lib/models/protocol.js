// web/static/lib/models/protocol.js
// The page's protocol client: the one module that names a route a model
// reads (docs/architecture/components.md, *The protocol client*;
// docs/plan/components.md, 2.3). A model asks it by noun, never by path, so
// a route renamed on the Pi is a line here and nothing else, and a model
// made over a fixture (fixture.js, the same three methods) runs with no Pi.
//
// What it speaks for so far: the takes (GET /api/jams); the tape
// (lib/models/tape.js): its state, which tape is loaded, and its verbs for
// ●, Catch and the click; and the transport (lib/models/transport.js): ▶ ■
// and a locate, the loop, where it plays, the tempo and a free loop's tap.
// The tape's other edits join in the PRs after; until then the Studio sends
// them itself, through the tape's change().
//
// It has no DOM. Built on lib/link.js's timedFetch, so a read lost in a
// sleep ends as a failure rather than never; a verb is never timed out (a
// press the Pi took and answered late is still the Pi's).

import { timedFetch } from '../link.js';
import { refusal } from '../tape/refusal.js';
import { watchChanges } from '../tape/changes.js';

const at = (path, id) => (id == null ? path : `${path}?id=${encodeURIComponent(id)}`);

/**
 * READS are the routes a read asks, by noun: where it is (from the read's
 * options), and how long a read may wait before it is taken for lost.
 */
const READS = Object.freeze({
  takes: Object.freeze({ path: () => '/api/jams' }),
  // The loaded tape and its live state: the tape's poll. suggest asks for
  // the tempo you were playing, which only an empty tape with no grid uses.
  tape: Object.freeze({ path: ({ id, suggest }) => `${at('/api/tapes/state', id)}${suggest ? '&suggest=1' : ''}`, ms: 4000 }),
  // The list of tapes and which is loaded: the tape following the Pi.
  tapes: Object.freeze({ path: () => '/api/tapes' }),
});

/** NOUNS are the nouns this client reads. */
export const NOUNS = Object.freeze(Object.keys(READS));

/**
 * VERBS are the routes a verb sends, by noun and name: the method, the
 * path, and the body made from the verb's arguments. A route's id is the
 * verb's option (the tape it is for), never its body's.
 */
const VERBS = Object.freeze({
  tape: Object.freeze({
    // ●: arm or punch in onto the armed tracks ({tracks, …},
    // lib/tape/record-body.js); again, end it and keep what it has; or
    // cancel it, keeping nothing.
    record: { method: 'POST', path: '/api/tapes/record', id: true, body: (b) => b },
    punchOut: { method: 'DELETE', path: '/api/tapes/record', id: true, body: () => null },
    cancelRecord: { method: 'DELETE', path: '/api/tapes/record', id: true, query: 'cancel=1', body: () => null },
    // Catch: the last pass, or the last bars, onto the armed tracks.
    catch: { method: 'POST', path: '/api/tapes/catch', id: true, body: (b) => b },
    setClick: { method: 'PATCH', path: '/api/tapes', id: true, body: ({ on }) => ({ click: on }) },
  }),
  transport: Object.freeze({
    play: { method: 'POST', path: '/api/tapes/transport', id: true, body: () => ({ action: 'play' }) },
    stop: { method: 'POST', path: '/api/tapes/transport', id: true, body: () => ({ action: 'stop' }) },
    locate: { method: 'POST', path: '/api/tapes/transport', id: true, body: ({ pos }) => ({ action: 'locate', pos }) },
    setLoop: { method: 'PATCH', path: '/api/tapes', id: true, body: (loop) => ({ loop }) },
    // Where it plays: the jam room, a phone, both. The Pi's one output, so no id.
    setOutput: { method: 'PUT', path: '/api/tapes/output', body: ({ mode }) => ({ mode }) },
    // A re-grid (decision 0062): a new BPM over the same bars, or the same
    // frames counted as another number of bars.
    setTempo: { method: 'PATCH', path: '/api/tapes', id: true, body: ({ bpm }) => ({ tempo: { bpm } }) },
    setBars: { method: 'PATCH', path: '/api/tapes', id: true, body: ({ bars }) => ({ bars }) },
    // A free loop's tap onto the armed tracks, and starting it over.
    tapLoop: { method: 'POST', path: '/api/tapes/tap', id: true, body: (b) => b },
    tapCancel: { method: 'DELETE', path: '/api/tapes/tap', id: true, body: () => null },
  }),
});

/** VERB_NAMES are the verbs this client sends, as noun.name. */
export const VERB_NAMES = Object.freeze(Object.entries(VERBS).flatMap(([noun, vs]) => Object.keys(vs).map((n) => `${noun}.${n}`)));

/**
 * Refusal is the one kind of error a model's verb throws (the spec's 3.4):
 * the Pi said no (`status` its HTTP status), or it couldn't be asked
 * (`code` 'offline'). `message` is for a person, in the Pi's words; `code`
 * is what a page tests, never the words; `words` is the short form a key or
 * the keyboard's banner shows, when the Pi gives one. `reason` and
 * `recording` are today's 409 while Rec is armed (lib/tape/refusal.js).
 */
export class Refusal extends Error {
  constructor({ message = 'refused', code = '', words = '', status = 0, reason = '', recording = false, detail = '' } = {}) {
    super(message);
    this.name = 'Refusal';
    this.code = code || reason || (status ? `http_${status}` : '');
    this.words = words;
    this.status = status;
    this.reason = reason;
    this.recording = recording;
    this.detail = detail;
  }
}

/**
 * createProtocol makes the page's client. env is for tests: fetch(url,
 * init, ms) for reads (default lib/link.js's timedFetch), send(url, init)
 * for verbs (default fetch), and watch (lib/tape/changes.js's
 * watchChanges).
 *
 * It answers:
 *   read(noun, {v})  a promise of the Pi's answer: {ok, status, v, body}.
 *                    v is the version it came with (today the ETag); given
 *                    the version already held, an answer that hasn't moved
 *                    is {ok: false, status: 304, body: null}. body is the
 *                    parsed JSON of an OK answer, else null. It rejects
 *                    only when the Pi couldn't be asked. The tape's read
 *                    takes {id, suggest}: the tape it asks about, and
 *                    whether to suggest a tempo.
 *   verb(noun, name, args, {id})
 *                    sends a verb (VERBS), for the tape `id`: a promise of
 *                    the Pi's answer, its parsed body ({} with none), or a
 *                    Refusal: the Pi's no, or 'offline' when it couldn't
 *                    be asked
 *   watch({onNudge, onPress, onTakes})
 *                    the page's changes socket (lib/tape/changes.js):
 *                    answers {close()}
 *   nouns            what it reads (NOUNS)
 */
export function createProtocol(env = {}) {
  const {
    fetch: fetchImpl = (u, o, ms) => timedFetch(u, o, ms),
    send: sendImpl = (u, o) => globalThis.fetch(u, o),
    watch = watchChanges,
  } = env;
  return Object.freeze({
    nouns: NOUNS,
    async read(noun, { v = null, id = null, suggest = false } = {}) {
      const r = READS[noun];
      if (!r) throw new TypeError(`the protocol reads no ${noun}`);
      const headers = {};
      if (v) headers['If-None-Match'] = v;
      const res = await fetchImpl(r.path({ id, suggest }), { headers, cache: 'no-store' }, r.ms);
      const tag = res.headers?.get?.('ETag') ?? null;
      if (!res.ok) return { ok: false, status: res.status, v: tag, body: null };
      return { ok: true, status: res.status, v: tag, body: await res.json() };
    },
    async verb(noun, name, args = {}, { id = null } = {}) {
      const d = VERBS[noun]?.[name];
      if (!d) throw new TypeError(`the protocol sends no ${noun}.${name}`);
      const body = d.body(args);
      let res;
      try {
        const path = d.id ? at(d.path, id) : d.path;
        res = await sendImpl(d.query ? `${path}${path.includes('?') ? '&' : '?'}${d.query}` : path, {
          method: d.method, cache: 'no-store',
          headers: body == null ? undefined : { 'Content-Type': 'application/json' },
          body: body == null ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        throw new Refusal({ code: 'offline', message: e.message });
      }
      const b = await res.json().catch(() => ({}));
      if (res.ok) return b;
      const why = refusal(res.status, b);
      throw new Refusal({ status: res.status, message: why.message, reason: why.reason, recording: why.recording, detail: why.detail, code: typeof b.code === 'string' ? b.code : '' });
    },
    watch: (handlers) => watch(handlers),
  });
}
