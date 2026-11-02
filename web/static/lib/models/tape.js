// web/static/lib/models/tape.js
// The tape: the loaded tape and the Pi's state around it, as a page holds
// them, and its verbs for ●, Catch and the click (docs/architecture/tape.md,
// *The tape model*; docs/plan/components.md, 2.2).
//
// One per page, made by the page (lib/shell/boot.js) and handed down: to the
// bar's engine, whose transport (transport.js) reads the tape from it, and
// to the Studio (lib/tape/page.js) on ctx.tape. It has no DOM and names no
// route: it reads the tape's state from the page's protocol client
// (protocol.js; a fixture's in the tests) and sends its verbs through it.
//
// It is the page's one poller of the tape. Each reader says how often it
// wants an answer (every): the bar 500 ms, or 5 s with a take in it; the
// Studio 200 ms while it is shown. It asks at the quickest of them, never
// while the page is out of view, and never two at once (lib/tape/
// poll-gate.js): a nudge while one is out asks once more when it ends, and
// a forced ask (back in view, back online) goes ahead of one that may be
// lost, whose answer is then dropped.
//
// A change (change(send), and every verb) counts as it is sent and again as
// its answer arrives: a poll in flight across either may answer with the
// tape from before the change, and is dropped. An answer that carries the
// tape is shown at once.
//
// Another device loaded another tape: it follows, asking for that one.

import { pollGate } from '../tape/poll-gate.js';
import { createProtocol } from './protocol.js';

/**
 * createTape makes the page's tape. env: protocol (the page's client,
 * protocol.js; a fixture's in the tests), link (lib/link.js's watchLink:
 * ok('tape') on an answer, fail('tape') on none), and for tests hidden()
 * (the page out of view), setTimeout and clearTimeout.
 *
 * It answers:
 *   load(id)      the tape loaded on the Pi: starts asking about it, at once
 *   id()          the tape it asks about, null before load
 *   snapshot()    {v, id, loaded, tape, live, suggest_bpm, sources, …}: the
 *                 Pi's last answer about the tape, frozen, the same object
 *                 until the next; v counts the answers. Before the first,
 *                 {v: 0, id, tape: null, live: null}
 *   onChange(fn)  fn(snapshot) on each answer; a way off
 *   every(who, ms)
 *                 `who` wants an answer every ms (null: no longer)
 *   refresh(force)
 *                 asks now, unless an ask is out (force: ahead of it)
 *   nudge()       the Pi says the tape changed: asks now, or once more
 *                 after the ask that is out
 *   change(send)  sends one change, send() a promise of the Pi's answer:
 *                 drops a poll it overtakes, and shows the tape the answer
 *                 carries. Answers the answer, or throws what send threw
 * Its verbs, each a change, answering the Pi's answer or throwing a Refusal
 * (protocol.js) to whoever pressed:
 *   record(body)  ●: arm or punch in onto the armed tracks ({tracks, …},
 *                 lib/tape/record-body.js)
 *   punchOut()    ● again: end it, and keep what it has ({kept})
 *   cancelRecord()
 *                 end it and keep nothing
 *   catch(body)   Catch: the last pass ({pass: 1}) or the last bars
 *                 ({bars}) onto the armed tracks
 *   setClick(on)  the click on or off
 * And destroy().
 */
export function createTape(env = {}) {
  const {
    protocol = createProtocol(),
    link = null,
    hidden = () => !!globalThis.document?.hidden,
    setTimeout: later = (f, ms) => setTimeout(f, ms),
    clearTimeout: cancel = (h) => clearTimeout(h),
  } = env;

  let id = null, loaded = false, stopped = false;
  let answer = null, snap = null, moves = 0;
  const listeners = new Set();
  const take = (s) => {
    answer = s;
    if (s.tape && s.tape.id) id = s.tape.id;
    snap = null;
    const now = snapshot();
    for (const f of listeners) f(now);
  };
  function snapshot() {
    if (!snap) snap = Object.freeze(answer ? { ...answer, v: moves = moves + 1, id } : { v: 0, id, tape: null, live: null });
    return snap;
  }

  // Only an empty tape with no grid can use a suggested tempo, so only then
  // is one asked for.
  const bare = () => {
    const t = answer && answer.tape;
    return !!t && !t.grid && t.tracks.every((tr) => tr.clips.length === 0);
  };

  const gate = pollGate();
  let gen = 0;
  async function poll(force = false) {
    if (!loaded || stopped) return;
    const mine = gate.begin(force === true);
    if (!mine) return;
    const g = gen;
    let heard = null;
    try {
      const r = await protocol.read('tape', { id, suggest: bare() });
      // An answer of any kind (a 404) was the Pi; none at all is the link.
      link?.ok('tape');
      if (g !== gen || !gate.current(mine)) return;
      if (!r.ok) { if (r.status === 404) await follow(); return; }
      if (!r.body.loaded) { await follow(); return; }
      heard = r.body;
    } catch {
      link?.fail('tape');
    } finally {
      if (gate.end(mine)) poll();
    }
    // Outside the ask: a listener that throws is its own bug, not the link.
    if (heard) take(heard);
  }
  // follow switches to the tape that's loaded now, because another device
  // loaded it.
  async function follow() {
    try {
      const l = await protocol.read('tapes');
      if (!l.ok || !l.body.loaded || l.body.loaded === id) return;
      const s = await protocol.read('tape', { id: l.body.loaded });
      if (!s.ok || stopped) return;
      id = l.body.loaded;
      take(s.body);
    } catch { /* the next poll tries again */ }
  }

  // How often: the quickest any reader wants.
  // A tick of a rate since changed is dropped, should it still come.
  const rates = new Map();
  let timer = 0, every = 0, ticks = 0;
  const schedule = () => { const mine = ++ticks; timer = later(() => tick(mine), every); };
  const tick = (mine) => {
    if (mine !== ticks || stopped || !every) return;
    if (!hidden()) poll();
    schedule();
  };
  const reschedule = () => {
    const ms = rates.size ? Math.min(...rates.values()) : 0;
    if (ms === every) return;
    if (timer) cancel(timer);
    timer = 0;
    ticks++;
    every = ms;
    if (ms && !stopped) schedule();
  };

  async function change(send) {
    gen++;
    try {
      const s = await send();
      gen++;
      if (s && s.tape) take(s);
      return s;
    } catch (e) {
      gen++;
      throw e;
    }
  }
  const verb = (name, args = {}) => change(() => protocol.verb('tape', name, args, { id }));

  return {
    load(loadedId) {
      if (!loadedId || loaded) return;
      loaded = true;
      id = loadedId;
      poll();
    },
    id: () => id,
    snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    every(who, ms) {
      if (ms) rates.set(who, ms);
      else rates.delete(who);
      reschedule();
    },
    refresh: (force = false) => poll(force),
    nudge() { if (gate.nudge()) poll(); },
    change,
    record: (body) => verb('record', body),
    punchOut: () => verb('punchOut'),
    cancelRecord: () => verb('cancelRecord'),
    catch: (body) => verb('catch', body),
    setClick: (on) => verb('setClick', { on }),
    destroy() {
      stopped = true;
      if (timer) cancel(timer);
      timer = 0;
      ticks++;
      listeners.clear();
    },
  };
}
