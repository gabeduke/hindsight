// web/static/lib/rooms/bounce.js
// BOUNCE (docs/superpowers/specs/2026-10-15-flow-design.md, the verbs table
// and "The Studio: one selection, two verbs"): the Studio's ⋯ makes a take
// from the tape by playing it once through the mixer. It is the request Mix
// down always sent (POST /api/tapes/mixdown), and the take it saves is what a
// tape's family already holds: origin "tape" and the tape's id. Nothing is
// attached here; this module only says which take that is (Last bounce),
// words the menu and the toasts, and plays a take on this device for ▶.
//
// With the rooms off the tape page keeps Mix down; bounceMenu does nothing.

import { spineTitle } from '../shelf.js';

export const BOUNCE_WORDS = Object.freeze({
  loop: 'Bounce the loop',
  whole: 'Bounce the whole tape',
  last: 'Last bounce',
});

const NONE_YET = 'No bounce of this tape yet';

/**
 * bounceMenu puts BOUNCE in the tape page's ⋯ menu: the two Mix down items
 * are renamed (they stay the same buttons, so they send the same requests)
 * and Last bounce follows them. Answers {last, take, setLast(take)}, or null with
 * the rooms off, when the menu is left as it is.
 */
export function bounceMenu(doc, { rooms }) {
  if (!rooms) return null;
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
  let current = null;
  return {
    last,
    /** take is the newest bounce setLast was told of, or null. */
    get take() { return current; },
    setLast(take) {
      current = take || null;
      last.disabled = !take;
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

/** bounceStartWords is the toast that says a bounce has begun: `length` is how long the tape plays. */
export const bounceStartWords = (length) => `Bouncing ${length}: the tape plays it once, then it’s a take`;

/** openHref is the take's own page. */
export const openHref = (name) => `/wave.html?file=${encodeURIComponent(name)}`;

const TOAST_MS = 10000;

/**
 * bounceToast tells of a bounce, with ▶ (plays it, here) and Open (its
 * page). player is takePlayer's; go(url) navigates.
 */
export function bounceToast({ toast, name, message, player, go = (u) => location.assign(u) }) {
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
  return bounceToast({ toast, name: take.name, message: `${BOUNCE_WORDS.last}: ${spineTitle(take)}`, player, go });
}

/**
 * takePlayer plays a take on this device for ▶ -- its preview, as every row
 * of the takes page does -- and never touches the tape. While it plays, a
 * toast of its own holds ■ and Open, and goes when it ends. (The Studio's bar
 * holds the tape; a take in the bar there arrives with the tap that plays.)
 * toggle(name) plays it, or pauses it when it is the one playing.
 */
export function takePlayer({ toast, fetchImpl = (...a) => globalThis.fetch(...a), Audio = globalThis.Audio, go = (u) => location.assign(u) }) {
  let audio = null, playing = null, note = null, ticket = 0;

  function settle() {
    audio = null;
    playing = null;
    note?.dismiss?.();
    note = null;
  }
  function stop() {
    ticket++;
    const a = audio;
    settle();
    a?.pause();
  }
  async function toggle(name) {
    if (audio && playing === name && !audio.paused) { stop(); return; }
    stop();
    const mine = ++ticket;
    let t;
    try {
      const res = await fetchImpl('/api/jams', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      t = (await res.json()).find((x) => x.name === name);
    } catch (e) {
      toast(`Couldn’t play it: ${e.message}`, 'bad');
      return;
    }
    if (mine !== ticket) return; // stopped, or asked again, meanwhile
    if (!t) { toast('Couldn’t play it: the Pi doesn’t list it yet', 'bad'); return; }
    if (!t.has_preview) { toast('Still encoding — a moment', 'warn'); return; }
    const a = new Audio();
    a.src = `/api/download?file=${encodeURIComponent(t.preview_name)}`;
    const over = () => { if (audio === a) settle(); };
    a.addEventListener('ended', over);
    a.addEventListener('pause', over);
    audio = a;
    playing = name;
    try {
      await a.play();
    } catch (e) {
      settle();
      toast(`Couldn’t play it: ${e.message || 'the browser held its sound back'}`, 'bad');
      return;
    }
    if (audio !== a) return; // it ended, or was stopped, before play() answered
    note = toast(`Playing ${spineTitle(t)}`, 'ok', {
      ms: ((t.duration_seconds || 0) + 3) * 1000,
      actions: [{ label: '■', run: stop }, { label: 'Open', run: () => go(openHref(name)) }],
    });
  }
  return { toggle, stop, get playing() { return playing; } };
}
