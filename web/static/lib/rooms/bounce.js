// web/static/lib/rooms/bounce.js
// BOUNCE (docs/architecture.md, Vocabulary, the verbs table
// and "The Studio: one selection, two verbs"): the Studio's ⋯ makes a take
// from the tape by playing it once through the mixer. It is the request Mix
// down always sent (POST /api/tapes/mixdown), and the take it saves is what a
// tape's family already holds: origin "tape" and the tape's id. Nothing is
// attached here; this module only says which take that is (Last bounce),
// words the menu and the toasts, and plays a take on this device for ▶.

import { spineTitle } from '../shelf.js';
import { named } from './words.js';

export const BOUNCE_WORDS = Object.freeze({
  loop: 'Bounce the loop',
  whole: 'Bounce the whole tape',
  last: 'Last bounce',
});

const NONE_YET = 'No bounce of this tape yet';
const NONE_SHORT = 'none yet';

/**
 * bounceMenu puts BOUNCE in the tape page's ⋯ menu: the two Mix down items
 * are renamed (they stay the same buttons, so they send the same requests)
 * and Last bounce follows them. Answers {last, take, setLast(take)}, or null
 * on a page without the menu.
 */
export function bounceMenu(doc) {
  const loop = doc.getElementById('tape-mixdown');
  const whole = doc.getElementById('tape-mixdown-all');
  if (!loop || !whole) return null;
  for (const [b, words] of [[loop, BOUNCE_WORDS.loop], [whole, BOUNCE_WORDS.whole]]) {
    b.textContent = words;
    b.setAttribute('data-tip', 'bounce');
  }
  let last = doc.getElementById('tape-last-bounce');
  if (!last) {
    last = doc.createElement('button');
    last.id = 'tape-last-bounce';
    last.type = 'button';
    last.setAttribute('role', 'menuitem');
    last.setAttribute('data-tip', 'last-bounce');
    last.textContent = BOUNCE_WORDS.last;
    last.disabled = true;
    last.title = NONE_YET;
    whole.after(last);
  }
  // A disabled item says why on its face: a phone has no tooltip.
  let note = last.querySelector('.bounce-note');
  if (!note) {
    note = doc.createElement('span');
    note.className = 'bounce-note';
    last.append(note);
  }
  note.textContent = ` ${NONE_SHORT}`;
  let current = null;
  return {
    last,
    /** take is the newest bounce setLast was told of, or null. */
    get take() { return current; },
    setLast(take) {
      current = take || null;
      last.disabled = !take;
      note.textContent = take ? '' : ` ${NONE_SHORT}`;
      last.title = take ? `${spineTitle(take)}: play it, or open it` : NONE_YET;
    },
  };
}

const atMs = (t) => {
  const w = t.created ? Date.parse(t.created) : NaN;
  return Number.isNaN(w) ? -Infinity : w;
};

/**
 * lastBounce is the newest take bounced from `tape` ({id, name}), or null.
 * A bounce is a take with origin "tape" that is not a cut of another take;
 * it is the tape's by its tape_id. One saved before takes carried that id is
 * the tape's when its label is the tape's name and no other tape's bounces
 * wear that label (lib/shelf.js `fold` makes the same call).
 */
export function lastBounce(takes, tape) {
  if (!Array.isArray(takes) || !tape) return null;
  const bounces = takes.filter((t) => t && t.origin === 'tape' && !t.source);
  const othersWear = new Set(bounces.filter((t) => t.tape_id && t.tape_id !== tape.id).map((t) => t.label || ''));
  const mine = bounces.filter((t) => (t.tape_id
    ? t.tape_id === tape.id
    : (t.label || '') === (tape.name || '') && !othersWear.has(t.label || '')));
  let best = null;
  for (const t of mine) {
    if (!best || atMs(t) > atMs(best) || (atMs(t) === atMs(best) && t.name > best.name)) best = t;
  }
  return best;
}

/**
 * lastBounceKeeper is which take the menu's Last bounce stands for, and the
 * tape it is the bounce of. A bounce of another tape is never offered for
 * this one: the line is off the moment the loaded tape differs, and an answer
 * from the Pi that returns after the tape changed is dropped.
 * tapeNow() is the loaded tape ({id, name}) or null.
 */
export function lastBounceKeeper({ menu, tapeNow, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  let forTape = null, asks = 0;
  const set = (take, id) => {
    forTape = take ? id : null;
    menu.setLast(take || null);
  };
  return {
    /** set says the newest bounce of tape `id` (one just made, or an answer). */
    set,
    /** take is Last bounce's take for the tape loaded now, or null. */
    take() {
      const t = tapeNow();
      return t && forTape === t.id ? menu.take : null;
    },
    /** changed is told the loaded tape is `id`: another tape's bounce goes. */
    changed(id) {
      if (forTape !== null && forTape !== id) { asks++; set(null); }
    },
    /** refresh asks the Pi which take is the loaded tape's newest bounce. */
    async refresh() {
      const tape = tapeNow();
      if (!tape) return;
      this.changed(tape.id);
      const mine = ++asks;
      let list;
      try {
        const res = await fetchImpl('/api/jams', { cache: 'no-store' });
        if (!res.ok) return;
        list = await res.json();
      } catch { return; } // the next time the menu opens
      const now = tapeNow();
      if (mine !== asks || !now || now.id !== tape.id) return;
      set(lastBounce(list, tape), tape.id);
    },
  };
}

/** bounceStartWords is the toast that says a bounce has begun: `length` is how long the tape plays. */
export const bounceStartWords = (length) => `Bouncing ${length}: the tape plays it once, then it’s a take`;

/** openHref is the take's own page. */
export const openHref = (name) => `/wave.html?file=${encodeURIComponent(name)}`;

const TOAST_MS = 10000;

/**
 * bounceToast tells of a bounce, with ▶ (plays it, here) and Open (its
 * page). player is takePlayer's; go(url) navigates; take, when known, is the
 * take as /api/jams lists it, which saves the lookup.
 */
export function bounceToast({ toast, name, message, player, go = (u) => location.assign(u), take = null }) {
  // The take is looked up now, and its audio built, so that ▶ is one
  // synchronous call to play() inside the tap: iOS refuses sound that starts
  // after an await.
  player.prepare(name, take);
  return toast(message, 'ok', {
    ms: TOAST_MS,
    actions: [
      { label: '▶', run: () => player.toggle(name) },
      { label: 'Open', run: () => go(openHref(name)) },
    ],
  });
}

/** lastBounceToast is the same toast for the tape's newest bounce, from the menu, when the first has gone. */
export function lastBounceToast({ toast, take, player, go }) {
  if (!take) return toast(`${NONE_YET}. Bounce the loop or the whole tape from this menu.`, 'ok');
  return bounceToast({ toast, name: take.name, message: `${BOUNCE_WORDS.last}: ${named(spineTitle(take))}`, player, go, take });
}

const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));
const PREVIEW_TRIES = 10;
const PREVIEW_EVERY_MS = 1500;

/**
 * takePlayer plays a take on this device for ▶ -- its preview, as every row
 * of the takes page does -- and never touches the tape. While it plays, a
 * toast of its own holds ■ and Open, and goes when it ends. (The Studio's bar
 * holds the tape; a take in the bar there arrives with the tap that plays.)
 *
 * prepare(name, known) looks the take up (or takes `known`, a take as
 * /api/jams lists it) and builds its audio, waiting for a preview that is
 * still being encoded; toggle(name) is then synchronous as far as play(), so
 * it runs inside the tap that asked, as iOS demands. A prepare overtaken by
 * another leaves nothing behind. toggle plays it, or pauses it when it is
 * the one playing.
 */
export function takePlayer({
  toast, fetchImpl = (...a) => globalThis.fetch(...a), Audio = globalThis.Audio,
  go = (u) => location.assign(u), sleep = sleepFor, tries = PREVIEW_TRIES,
}) {
  let audio = null, playing = null, note = null;
  let ready = null;   // {name, take, audio}: built, waiting for a tap
  let pending = null; // the name a lookup is out for
  let failed = null;  // {name, why}: the last lookup that found nothing to play
  let prep = 0;       // the latest prepare: an older one's answer is dropped
  let lastPrep = Promise.resolve(false);

  function settle() {
    audio = null;
    playing = null;
    note?.dismiss?.();
    note = null;
  }
  function stop() {
    const a = audio;
    settle();
    a?.pause();
  }

  async function lookup(name, mine) {
    for (let i = 0; i < tries; i++) {
      let t;
      try {
        const res = await fetchImpl('/api/jams', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        t = (await res.json()).find((x) => x.name === name);
      } catch (e) {
        return { why: e.message };
      }
      if (!t) return { why: 'the Pi doesn’t list it yet' };
      if (t.has_preview) return { take: t };
      await sleep(PREVIEW_EVERY_MS);
      if (mine !== prep) return null; // overtaken: stop asking
    }
    return {}; // still encoding
  }

  function prepare(name, known = null) {
    const mine = ++prep;
    ready = null;
    pending = name;
    lastPrep = (async () => {
      const r = known && known.has_preview && known.preview_name ? { take: known } : await lookup(name, mine);
      if (mine !== prep) return false; // overtaken: leave nothing behind
      pending = null;
      if (!r || !r.take) { failed = r && r.why ? { name, why: r.why } : null; return false; }
      failed = null;
      const a = new Audio();
      a.preload = 'auto';
      a.src = `/api/download?file=${encodeURIComponent(r.take.preview_name)}`;
      const over = () => { if (audio === a) settle(); };
      a.addEventListener('ended', over);
      a.addEventListener('pause', over);
      ready = { name, take: r.take, audio: a };
      return true;
    })();
    return lastPrep;
  }

  function toggle(name) {
    if (audio && playing === name && !audio.paused) { stop(); return Promise.resolve(); }
    stop();
    if (!ready || ready.name !== name) {
      const open = [{ label: 'Open', run: () => go(openHref(name)) }];
      if (failed && failed.name === name) {
        toast(`Couldn’t play it: ${failed.why}`, 'bad', { actions: open });
        prepare(name); // a tap again may find it
      } else {
        toast('Still encoding — a moment', 'warn', { actions: open });
        if (pending !== name) prepare(name);
      }
      return Promise.resolve();
    }
    const { audio: a, take: t } = ready;
    audio = a;
    playing = name;
    let played;
    try {
      if (a.currentTime) a.currentTime = 0;
      played = a.play(); // inside the tap: nothing above awaited
    } catch (e) {
      played = Promise.reject(e);
    }
    return Promise.resolve(played).then(() => {
      if (audio !== a) return; // it ended, or was stopped, before play() answered
      note = toast(`Playing ${named(spineTitle(t))}`, 'ok', {
        ms: ((t.duration_seconds || 0) + 3) * 1000,
        actions: [{ label: '■', run: stop }, { label: 'Open', run: () => go(openHref(name)) }],
      });
    }, (e) => {
      if (audio === a) settle();
      // The toast that carried ▶ went when it was tapped: this one keeps Open.
      toast(`Couldn’t play it: ${e && e.message ? e.message : 'the browser held its sound back'}`, 'bad', {
        actions: [{ label: 'Open', run: () => go(openHref(name)) }],
      });
    });
  }
  return { prepare, toggle, stop, whenReady: () => lastPrep, get playing() { return playing; } };
}
