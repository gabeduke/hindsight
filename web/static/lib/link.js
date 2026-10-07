// The page's link to the Pi, and what to do when it has been asleep.
//
// A tablet that sleeps freezes the page: timers stop, and a request or socket
// that was in flight is often neither answered nor failed -- it just never
// comes back. A page that waits for it waits for good (the tape page used to
// poll only when its last poll was done, so one lost poll stopped them all).
// Three small parts, all pure apart from the browser objects they are given,
// so node can test them with fakes:
//
//   timedFetch   a fetch that gives up, so a lost request ends as a failure
//   onResume     the page is back: visible again, shown again, online again,
//                or the clock jumped (timers were frozen, whatever the events)
//   createLink   which sources of data are failing, and the "Reconnecting…"
//                note, held back for a moment so a quick retry never shows it

export const FETCH_TIMEOUT_MS = 8000;
export const NOTE_DELAY_MS = 1000; // how long a link is down before the note shows
const WAKE_TICK_MS = 1000;
const WAKE_GAP_MS = 3500; // a 1 s tick this late means the page was frozen

/**
 * timedFetch is fetch that rejects (an AbortError) after `ms` instead of
 * waiting for ever for an answer. A signal in `init` still works. The wait is
 * for the response to start; a body that stalls half way is not covered.
 */
export function timedFetch(input, init = {}, ms = FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctl.abort();
    else outer.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return fetchImpl(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

/**
 * onResume calls fn(reason) when the page may have been asleep: 'visible'
 * (it came back into view), 'pageshow' (shown again, from the back-forward
 * cache or not), 'online' (the network came back) or 'wake' (the clock jumped
 * more than it can while the page is running). Returns a function that stops
 * listening. The env is for tests.
 */
export function onResume(fn, env = {}) {
  const doc = env.doc ?? document;
  const win = env.win ?? window;
  const now = env.now ?? Date.now;
  const every = env.setInterval ?? setInterval;
  const stopEvery = env.clearInterval ?? clearInterval;

  const vis = () => { if (!doc.hidden) fn('visible'); };
  const show = () => fn('pageshow');
  const online = () => fn('online');
  doc.addEventListener('visibilitychange', vis);
  win.addEventListener('pageshow', show);
  win.addEventListener('online', online);

  let last = now();
  const tick = every(() => {
    const t = now();
    const gap = t - last;
    last = t;
    if (gap > WAKE_GAP_MS && !doc.hidden) fn('wake');
  }, WAKE_TICK_MS);
  tick?.unref?.();

  return () => {
    doc.removeEventListener('visibilitychange', vis);
    win.removeEventListener('pageshow', show);
    win.removeEventListener('online', online);
    stopEvery(tick);
  };
}

/**
 * createLink tracks whether the Pi is being heard. Each source of data
 * (the tape's poll, the live meters) reports ok(source) or fail(source); the
 * link is down while any has failed since it last answered. onChange(true)
 * fires once it has been down for `delay` ms, onChange(false) when every
 * source is answering again -- a failure that clears inside the delay is never
 * announced. onResume(reason) is called when the page comes back; the caller
 * refetches its state there.
 */
export function createLink({ onChange = () => {}, onResume: resume = () => {}, delay = NOTE_DELAY_MS, env = {} } = {}) {
  const wait = env.setTimeout ?? setTimeout;
  const unwait = env.clearTimeout ?? clearTimeout;
  const bad = new Set();
  let timer = null;
  let shown = false;

  const update = () => {
    if (bad.size) {
      if (!timer && !shown) {
        timer = wait(() => {
          timer = null;
          if (bad.size && !shown) { shown = true; onChange(true); }
        }, delay);
      }
    } else {
      if (timer) { unwait(timer); timer = null; }
      if (shown) { shown = false; onChange(false); }
    }
  };

  const stopResume = onResume((why) => resume(why), env);

  return {
    ok(source = 'page') { bad.delete(source); update(); },
    fail(source = 'page') { bad.add(source); update(); },
    get down() { return bad.size > 0; },
    get shown() { return shown; },
    stop() {
      stopResume();
      if (timer) unwait(timer);
      timer = null;
    },
  };
}

/**
 * reconnectNote makes the "Reconnecting…" note, hidden, and returns
 * show(bool). The words are the phone recorder's.
 */
export function reconnectNote(doc = document) {
  const el = doc.createElement('div');
  el.className = 'link-note';
  el.setAttribute('role', 'status');
  el.hidden = true;
  el.textContent = 'Reconnecting…';
  (doc.body || doc.documentElement).appendChild(el);
  return (on) => { el.hidden = !on; };
}

/**
 * watchLink is createLink with the note on the page. onResume(reason) is where
 * the page fetches its state again.
 */
export function watchLink(onResumeFn) {
  const show = reconnectNote();
  return createLink({ onChange: show, onResume: onResumeFn });
}
