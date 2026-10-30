// web/static/lib/models/takes.js
// The takes: the take library as a page holds it (docs/architecture/push.md,
// *The takes' revision*; docs/plan/the-ecosystem.md, *Models per noun*).
//
// One per page, made by the page (the shell's boot.js, Open's wave/page.js)
// and handed to whoever lists takes: the Listening Room's and Capture's
// TakesList, the bar's source menu and its find, the Studio's bounce, Open's
// family lines and its ◂ ▸. None of them asks /api/jams for itself, so a
// page asks once for all of them, and only when the list may have moved.
//
// It has no DOM. It knows the list the Pi last answered and its ETag, asks
// again with If-None-Match (an unchanged list is a 304, costing the Pi one
// directory listing), and tells its listeners when the list changed.
//
// When it asks:
//   - when told (heard) that the Pi's take revision moved: the changes
//     socket's takes_rev, from whichever of the bar's and the Studio's is
//     open (lib/tape/changes.js). A nudge, not the list (decision 0013);
//   - when asked (refresh), as a page that has just written a take does;
//   - when get() or find() is asked for a list it can't vouch for: none
//     yet, one POLL_MS old with no push heard in the last PUSH_QUIET_MS,
//     or one STALE_MS old with it. That is the fallback poll: the shown
//     room's tick (ctx.every, every POLL_MS as before) calls get(), so a
//     room not shown, or a page that lists nothing (the Studio), asks
//     nothing, and a shown one asks every POLL_MS without the push and
//     every STALE_MS with it.
// Asks never overlap: one asked for while another is out is made once more
// when that one ends, and every caller in between shares it.

import { timedFetch } from '../link.js';

export const JAMS_PATH = '/api/jams';

/** POLL_MS is how old a list may grow with no push heard: the pages' poll, before. */
export const POLL_MS = 5000;
/** STALE_MS is how old the list may grow while the push is heard. */
export const STALE_MS = 30000;
/** PUSH_QUIET_MS is how long without a word from the socket before the push is taken for gone: lib/socket.js's. */
export const PUSH_QUIET_MS = 4000;

/**
 * createTakes makes the page's takes. The env is for tests: fetch (default
 * lib/link.js's timedFetch) and now() in ms.
 *
 * It answers:
 *   list()        the takes as last answered, newest first, or null before
 *                 the first answer
 *   etag          the ETag of that list, or null
 *   refresh({force})
 *                 asks the Pi now, and answers the list. force leaves
 *                 If-None-Match off, so the list is answered (and listeners
 *                 told) even when it hasn't changed
 *   get()         the list: as held, when the push or a recent answer
 *                 vouches for it, else as refresh() answers it
 *   find(name)    the take called name, or null: from get(), asking once
 *                 more if it isn't there (a take this page has just made)
 *   heard(m)      a message from the changes socket ({takes_rev, …}): a
 *                 revision not heard before asks the Pi
 *   onChange(fn)  fn(list) each time an answer differs from the last; a
 *                 way off
 */
export function createTakes(env = {}) {
  const {
    fetch: fetchImpl = (u, o) => timedFetch(u, o),
    now = () => Date.now(),
  } = env;

  let list = null;
  let etag = null;
  let at = -Infinity;      // when the last answer was asked for: its age is timed from the ask
  let pushAt = -Infinity;  // when the socket last said a takes_rev
  let rev = null;          // the takes_rev last heard
  let out = null;          // the ask out, a promise of the list
  let again = null;        // {force}: asked for while one was out
  const listeners = new Set();

  const pushed = () => now() - pushAt < PUSH_QUIET_MS;
  const trusted = () => list !== null && now() - at < (pushed() ? STALE_MS : POLL_MS);

  async function ask(force) {
    const asked = now();
    const headers = {};
    if (etag && !force) headers['If-None-Match'] = etag;
    const res = await fetchImpl(JAMS_PATH, { headers, cache: 'no-store' });
    if (res.status === 304 && list !== null) { at = asked; return list; }
    if (!res.ok) throw new Error(`takes: HTTP ${res.status}`);
    const body = await res.json();
    const next = Array.isArray(body) ? body : [];
    const tag = res.headers?.get?.('ETag') ?? null;
    const changed = force || tag === null || tag !== etag || list === null;
    list = next;
    etag = tag;
    at = asked;
    if (changed) for (const fn of [...listeners]) { try { fn(list); } catch (e) { console.error(e); } }
    return list;
  }

  function refresh({ force = false } = {}) {
    if (out) {
      // The one out may have left before what this caller is asking about:
      // ask once more when it ends, and answer that.
      if (!again) {
        again = { force };
        const after = out.catch(() => {}).then(() => { const a = again; again = null; return run(a.force); });
        again.p = after;
      } else if (force) again.force = true;
      return again.p;
    }
    return run(force);
  }
  // out stays set until a queued ask has started, so a refresh in between
  // joins that one rather than starting a second beside it.
  function run(force) {
    out = ask(force).finally(() => { if (!again) out = null; });
    return out;
  }

  return {
    list: () => list,
    get etag() { return etag; },
    refresh,
    get() { return trusted() ? Promise.resolve(list) : refresh(); },
    async find(name) {
      const has = (l) => (Array.isArray(l) ? l.find((t) => t.name === name) : null) || null;
      const t = has(await this.get());
      return t || has(await refresh());
    },
    heard(m) {
      if (!m || typeof m.takes_rev !== 'number') return;
      pushAt = now();
      if (m.takes_rev === rev) return;
      rev = m.takes_rev;
      refresh().catch(() => { /* the next word or the poll asks again */ });
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
