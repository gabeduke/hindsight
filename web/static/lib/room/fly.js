// web/static/lib/room/fly.js
// The flight of a take from its spine on the shelf to the deck, alongside its
// sound (docs/superpowers/plans/2026-10-15-f5b.md; decision 13 of the flow
// spec: "R2 starts the sound at the tap, not at SEAT; the flight runs
// alongside it"). The sound is not in here at all: a tap plays at once
// (lib/room/tap.js), and only then is the flight asked for, so nothing in
// this file can hold the sound back, and a flight that fails draws nothing
// and says so (`report`) without throwing into the tap.
//
// The motion is the scene's (lib/scene): a `flight` object whose model
// (lib/scene/flight.js, on R2's timeline, choreo.js) is stepped on the shared
// ticker, and a ghost (ghost.js) that draws what the model derived. The page
// writes the flight's state -- where it starts and where it is going -- and
// the model moves it. What the flight *means* is on a clock, not on frames:
// it lands at the end of the timeline (a dropped frame, a parked ticker or a
// hidden tab leaves no ghost behind) and the page hears of it (`onLand`).
//
// One flight at a time. A tap on another take lands the first at once and
// starts its own; a pause, a navigation (pagehide), a tab put away or a play
// that was refused cancels it. Reduced motion has no flight at all: the deck
// just changes. Idle, nothing exists: no scene, no frame, no timer, no
// listener -- all of it is made at launch and gone at landing.

import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { DomRenderer } from '../scene/dom.js';
import { SEAT_AT } from '../scene/choreo.js';
import { report } from '../objects/motion.js';
import { FLIGHT_MODELS, GhostDrawer } from './ghost.js';

/** LAND_MS is when a flight is over, on the clock: the model's SEAT, and a frame's grace to draw its last pose. */
export const LAND_MS = SEAT_AT + 40;
/** REMEASURE_MS is when the page measures again: the flight is about to fly (FLY, 500 ms), and what it flies to has settled. */
export const REMEASURE_MS = 500;

const TIMERS = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h) };

/** rectOf is an element's box as the flight takes it: {x, y, w, h}, viewport px. */
export const rectOf = (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * createFlights answers {launch, cancel, active}.
 *   doc, win      the page's document and window
 *   host          the element a ghost is put in (fixed over the room)
 *   reduced()     the device asks for less motion
 *   spine(key)    the take's spine on the shelf, or null with none on the page
 *   target()      where it is going, {x, y, w, h}, or null with nowhere to go
 *   face(key)     what the ghost's face shows: {name, stripe}
 *   onLand(key)   a flight reached its end (not one that was cancelled)
 *   ticker        the scene's clock (the pages' shared one)
 *   timers        {set, clear}, for tests
 *   onError(e)    where a failure is heard
 */
export function createFlights({ doc, win, host, reduced = () => false, spine, target, face, onLand, ticker, timers = TIMERS, onError = report }) {
  let cur = null;

  const seen = (r) => {
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return false;
    const vw = win.innerWidth, vh = win.innerHeight;
    return !(Number.isFinite(vw) && Number.isFinite(vh) && (r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= vw || r.y >= vh));
  };

  function end(c, landed) {
    if (!c || c.over) return;
    c.over = true;
    for (const h of c.timers) timers.clear(h);
    c.timers = [];
    win.removeEventListener('pagehide', c.hide);
    doc.removeEventListener('visibilitychange', c.away);
    for (const ev of ['pause', 'ended']) c.audio?.removeEventListener?.(ev, c.hide);
    try { c.renderer.destroy(); } catch (e) { onError(e); }
    c.scene.stop();
    if (cur === c) cur = null;
    if (landed) {
      try { onLand?.(c.key); } catch (e) { onError(e); }
    }
  }

  function measure(c) {
    try {
      const s = spine(c.key), to = target();
      const patch = {};
      const from = s ? rectOf(s) : null;
      if (seen(from)) patch.from = from;
      if (to && to.w > 0 && to.h > 0) patch.to = to;
      c.obj.set(patch);
    } catch (e) { onError(e); }
  }

  return {
    /**
     * launch flies take `key` from its spine to the target. `audio` is the
     * take's own audio element: the flight is a picture of that sound, so it
     * ends with the sound -- a pause from the bar's ▶ as much as from a tap, or
     * the take reaching its end -- and does not land. Answers what
     * happened: 'flew', or why not -- 'reduced', 'no spine', 'no target',
     * 'error'. It never throws: the sound that was asked for just before is
     * already playing.
     */
    launch(key, { audio = null } = {}) {
      let c = null;
      try {
        if (reduced()) return 'reduced';
        if (cur) end(cur, false); // a second tap lands the first at once
        const src = spine(key);
        const from = src ? rectOf(src) : null;
        if (!seen(from)) return 'no spine';
        const to = target();
        if (!to || !(to.w > 0 && to.h > 0)) return 'no target';
        const scene = new Scene({ ticker, models: FLIGHT_MODELS, onError });
        const renderer = new DomRenderer();
        const obj = new SceneObject('flight', 'flight', { goal: 'deck', from, to, turn: true, vanish: true, t0: 0 });
        c = { key, scene, renderer, obj, audio, timers: [], over: false, hide: null, away: null };
        c.hide = () => end(c, false);
        c.away = () => { if (doc.visibilityState === 'hidden') end(c, false); };
        scene.add(obj);
        renderer.mount(host, scene);
        renderer.part('flight', new GhostDrawer({ doc, host, source: src, face: face(key) }));
        cur = c;
        win.addEventListener('pagehide', c.hide);
        doc.addEventListener('visibilitychange', c.away);
        for (const ev of ['pause', 'ended']) audio?.addEventListener?.(ev, c.hide);
        c.timers.push(timers.set(() => measure(c), REMEASURE_MS));
        c.timers.push(timers.set(() => end(c, true), LAND_MS));
        scene.start();
        return 'flew';
      } catch (e) {
        if (c) end(c, false);
        onError(e);
        return 'error';
      }
    },
    /** cancel takes a flight in the air away at once: no landing. */
    cancel() { end(cur, false); },
    /** active is the key of the take in the air, or null. */
    active() { return cur ? cur.key : null; },
  };
}
