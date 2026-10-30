// web/static/lib/models/protocol.js
// The page's protocol client: the one module that names a route a model
// reads (docs/architecture/components.md, *The protocol client*;
// docs/plan/components.md, 2.3). A model asks it by noun, never by path, so
// a route renamed on the Pi is a line here and nothing else, and a model
// made over a fixture (fixture.js, the same three methods) runs with no Pi.
//
// What it speaks for so far: the takes (GET /api/jams). The tape and the
// transport join when their models move onto it (the spec's models step),
// with the verbs they send; until then they ask the Pi themselves.
//
// It has no DOM. Built on lib/link.js's timedFetch, so a read lost in a
// sleep ends as a failure rather than never.

import { timedFetch } from '../link.js';

/** READS are the routes a read asks, by noun: where it is, and how it is asked. */
const READS = Object.freeze({
  takes: Object.freeze({ path: () => '/api/jams' }),
});

/** NOUNS are the nouns this client reads. */
export const NOUNS = Object.freeze(Object.keys(READS));

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
 * init) (default lib/link.js's timedFetch).
 *
 * It answers:
 *   read(noun, {v})  a promise of the Pi's answer: {ok, status, v, body}.
 *                    v is the version it came with (today the ETag); given
 *                    the version already held, an answer that hasn't moved
 *                    is {ok: false, status: 304, body: null}. body is the
 *                    parsed JSON of an OK answer, else null. It rejects
 *                    only when the Pi couldn't be asked.
 *   nouns            what it reads (NOUNS)
 */
export function createProtocol(env = {}) {
  const { fetch: fetchImpl = (u, o) => timedFetch(u, o) } = env;
  return Object.freeze({
    nouns: NOUNS,
    async read(noun, { v = null } = {}) {
      const r = READS[noun];
      if (!r) throw new TypeError(`the protocol reads no ${noun}`);
      const headers = {};
      if (v) headers['If-None-Match'] = v;
      const res = await fetchImpl(r.path(), { headers, cache: 'no-store' });
      const tag = res.headers?.get?.('ETag') ?? null;
      if (!res.ok) return { ok: false, status: res.status, v: tag, body: null };
      return { ok: true, status: res.status, v: tag, body: await res.json() };
    },
  });
}
