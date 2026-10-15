// web/static/lib/play/midi.js
// A controller plugged into this computer, through Web MIDI: the fallback
// (docs/superpowers/specs/2026-10-15-instrument-strip-design.md, "MIDI in a
// browser"). The first choice is the controller in the Pi, which needs no
// page and no Wi-Fi hop (internal/api/controls.go); this is for a laptop
// away from the Pi.
//
// Like the keyboard and touch adapters it only calls the surface's press,
// release and latch, and hands commands on; the list of actions and their
// default notes are controls.js's. Its bindings are this device's, keyed by
// the controller's port name, in localStorage.
//
// Its limits, said where it's offered:
// - Web MIDI needs a secure page: the hub's HTTPS address, or localhost;
// - Safari has none, so on an iPhone or iPad the controller goes into the Pi.

import {
  actionFor, defaultBindings, control, live, HELD, AMOUNT, LATCHED, COMMAND, MODIFIER, learned, bind as bindAll, FX_PADS,
} from './controls.js';

const FX = new Set(FX_PADS);

export const BINDINGS_KEY = 'hindsight.play.midi';

/**
 * Parser turns a byte stream into whole messages. Running status (a status
 * byte left out because it's the same as the last), realtime bytes arriving
 * between a message's bytes, and SysEx (skipped) are all MIDI 1.0, and a
 * browser may hand any of them over as they came.
 */
export class Parser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.status = 0;
    this.data = [];
    this.sysex = false;
  }

  feed(bytes) {
    for (const b of bytes) {
      if (b >= 0xF8) { this.onMessage([b]); continue; } // realtime, anywhere
      if (b === 0xF0) { this.sysex = true; this.status = 0; continue; }
      if (b === 0xF7) { this.sysex = false; continue; }
      if (b & 0x80) {
        this.sysex = false;
        // System common (F1–F6) ends running status; its data is dropped.
        this.status = b < 0xF0 ? b : 0;
        this.data = [];
        continue;
      }
      if (this.sysex || !this.status) continue;
      this.data.push(b);
      const need = (this.status & 0xF0) === 0xC0 || (this.status & 0xF0) === 0xD0 ? 1 : 2;
      if (this.data.length === need) {
        this.onMessage([this.status, ...this.data]);
        this.data = []; // the status runs on
      }
    }
  }
}

/**
 * decode reads one message as controls.js matches them:
 * {type: 'on'|'off'|'cc'|'bend'|'program'|'pressure'|'polypressure'|'rt',
 * ch (1–16), note, vel, cc, value, rt}, or null for what nothing here plays.
 * A note-on with velocity 0 is a note-off, as MIDI says.
 */
export function decode([s, d1 = 0, d2 = 0]) {
  if (s === 0xFA || s === 0xFB) return { type: 'rt', rt: 'start' };
  if (s === 0xFC) return { type: 'rt', rt: 'stop' };
  const ch = (s & 0x0F) + 1;
  switch (s & 0xF0) {
    case 0x90: return d2 > 0 ? { type: 'on', ch, note: d1, vel: d2 } : { type: 'off', ch, note: d1, vel: 0 };
    case 0x80: return { type: 'off', ch, note: d1, vel: d2 };
    case 0xB0: return { type: 'cc', ch, cc: d1, value: d2 };
    case 0xC0: return { type: 'program', ch, value: d1 };
    case 0xD0: return { type: 'pressure', ch, value: d1 };
    case 0xA0: return { type: 'polypressure', ch, note: d1, value: d2 };
    case 0xE0: return { type: 'bend', ch, value: (d2 << 7) | d1 };
    default: return null;
  }
}

/**
 * handler plays one controller's messages on the surface. `bindings()` is
 * its map ({id: [binding]}); `learning()`, while MIDI LEARN waits, is a
 * function that takes the next note or CC (and nothing else plays it).
 * `onCommand(id, detail)` runs a command. It returns {feed, letGo}: letGo
 * releases what this controller holds, for when it's unplugged.
 *
 * The amounts (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md): a
 * punch-in FX is pressed at its velocity; the mod wheel (an amount CC) and
 * aftertouch move what it holds (`onAmount(id, v)`); the pitch wheel is the
 * bend, -1 to 1 (`onBend(v)`); a mod's knob turns it (`onMod(id, v)`), and a
 * program change picks a formula (`onFormula(n)`).
 */
export function handler(surface, {
  bindings = () => defaultBindings(), onCommand = () => {}, has = () => true,
  now = () => performance.now(), learning = () => null,
  onAmount = () => {}, onBend = () => {}, onMod = () => {}, onFormula = () => {},
} = {}) {
  // What each key or pedal pressed -- a pad, or the latch -- by the message:
  // its own lift lets go of that, whatever the bindings say by then (a
  // rebind, a learn), as the keyboard keeps the code it pressed. And how
  // many keys hold each pad: two can be bound to one, and it sounds until
  // the last lets go.
  const pressed = new Map();
  const holders = new Map();
  let latched = false;
  let wheel = 0; // where the pitch wheel was last heard: off centre, it bends
  const setLatch = (on) => { if (on !== latched) { latched = on; surface.latch(on, now()); } };
  const letGoOf = (id) => {
    const n = (holders.get(id) || 0) - 1;
    if (n > 0) { holders.set(id, n); return; }
    holders.delete(id);
    surface.release(id, now());
  };
  const keyOf = (m) => (m.type === 'on' || m.type === 'off' ? `n${m.ch}:${m.note}` : m.type === 'cc' ? `c${m.ch}:${m.cc}` : '');
  const handle = (m) => {
    if (!m) return;
    // A key, a pedal (CC at or past 64 is down), or a channel-mode CC (120
    // and up, sent with 0) as a press.
    const down = m.type === 'on' || (m.type === 'cc' && (m.value >= 64 || m.cc >= 120)) || m.type === 'rt';
    const key = keyOf(m);
    if (!down && key) {
      const id = pressed.get(key);
      if (id) {
        pressed.delete(key);
        if (id === 'latch') setLatch(false); else letGoOf(id);
        return;
      }
      if (m.type === 'off') return; // a note that pressed nothing here: the one that taught MIDI LEARN
    }
    // Learn takes a press -- a key down, a knob or pedal at 64 or past --
    // never a lift: a pedal let up mid-learn must still lift its latch.
    const learn = learning();
    if (learn && (m.type === 'on' || (m.type === 'cc' && m.value >= 64))) { learn(learned(m), m); return; }
    const map = bindings();
    if (m.type === 'pressure' || m.type === 'polypressure') {
      // Aftertouch: the FX this controller's keys hold -- on one key, the
      // pad that key pressed, whatever the bindings say by now.
      const one = m.type === 'polypressure' ? pressed.get(`n${m.ch}:${m.note}`) : null;
      if (m.type === 'polypressure' && !one) return;
      for (const id of holders.keys()) if (FX.has(id) && (!one || id === one)) onAmount(id, m.value / 127);
      return;
    }
    const hit = actionFor(map, m);
    if (!hit && m.type === 'cc') {
      // A knob or the mod wheel bound as an amount.
      const amt = actionFor(map, m, { amounts: true });
      const ac = amt && control(amt.id);
      if (!ac || !live(ac, has)) return;
      if (ac.kind === LATCHED) onMod(ac.id, m.value / 127); else onAmount(ac.id, m.value / 127);
      return;
    }
    const c = hit && control(hit.id);
    if (!c || !live(c, has)) return;
    if (c.kind === AMOUNT && m.type === 'bend') {
      wheel = m.value > 8192 ? (m.value - 8192) / 8191 : (m.value - 8192) / 8192;
      onBend(wheel);
      return;
    }
    if (c.kind === LATCHED && m.type === 'program') { onFormula(m.value); return; }
    if (c.kind === MODIFIER) {
      if (down && key) { if (!pressed.has(key)) { pressed.set(key, 'latch'); setLatch(true); } } else setLatch(down);
    } else if (c.kind === HELD) {
      if (down && key && !pressed.has(key)) {
        pressed.set(key, c.id);
        pressed.set(key, c.id);
        holders.set(c.id, (holders.get(c.id) || 0) + 1);
        // A punch-in FX's velocity is its amount.
        surface.press(c.id, now(), FX.has(c.id) && m.type === 'on' ? m.vel / 127 : undefined);
      }
    } else if (c.kind === COMMAND && down) {
      onCommand(c.id, m.type === 'rt' ? { rt: m.rt } : {});
    }
  };
  const parser = new Parser((bytes) => handle(decode(bytes)));
  return {
    feed: (bytes) => parser.feed(bytes),
    letGo() {
      const t = now();
      for (const id of holders.keys()) surface.release(id, t);
      pressed.clear();
      holders.clear();
      if (latched) { latched = false; surface.latch(false, t); }
      // A wheel off centre when the port goes springs back, as a key does.
      if (wheel) { wheel = 0; onBend(0); }
    },
  };
}

/**
 * support says whether this browser can have a controller plugged in, and
 * if not, why, in words for the strip.
 */
export function support({ secure = globalThis.isSecureContext, nav = globalThis.navigator } = {}) {
  if (!nav || typeof nav.requestMIDIAccess !== 'function') {
    return { ok: false, why: 'This browser has no Web MIDI (Safari never has): plug the controller into the Pi' };
  }
  if (!secure) return { ok: false, why: 'Web MIDI needs a secure page: open the hub’s https:// address, or localhost' };
  return { ok: true, why: '' };
}

/** readBindings is this device's bindings by port name, from localStorage. */
export function readBindings(store = globalThis.localStorage) {
  try { return JSON.parse(store.getItem(BINDINGS_KEY) || '{}') || {}; } catch { return {}; }
}

export function writeBindings(all, store = globalThis.localStorage) {
  try { store.setItem(BINDINGS_KEY, JSON.stringify(all)); } catch { /* this session only */ }
}

/**
 * attach plays every input of a MIDIAccess on the surface, and follows
 * controllers coming and going. `onPorts(names)` hears the inputs there
 * now. Returns {ports, bindings(name), learn(name, fn), close}.
 */
export function attach(access, surface, {
  onCommand, has, now, onPorts = () => {}, store = globalThis.localStorage, onAmount, onBend, onMod, onFormula,
} = {}) {
  const ports = new Map(); // id → {name, input, h}
  let learner = null;      // {name, fn}
  const bindings = (name) => readBindings(store)[name] || defaultBindings();
  const open = (input) => {
    if (ports.has(input.id) || input.state === 'disconnected') return;
    const name = input.name || input.id;
    const h = handler(surface, {
      bindings: () => bindings(name), onCommand, has, now, onAmount, onBend, onMod, onFormula,
      learning: () => (learner && learner.name === name ? learner.fn : null),
    });
    input.onmidimessage = (e) => h.feed(e.data);
    ports.set(input.id, { name, input, h });
  };
  const shut = (id) => {
    const p = ports.get(id);
    if (!p) return;
    p.input.onmidimessage = null;
    p.h.letGo(); // unplugged with a pad down: it lets go, as a dropped socket does
    ports.delete(id);
  };
  const names = () => [...ports.values()].map((p) => p.name);
  for (const input of access.inputs.values()) open(input);
  access.onstatechange = (e) => {
    const port = e.port;
    if (!port || port.type !== 'input') return;
    if (port.state === 'disconnected') shut(port.id); else open(port);
    onPorts(names());
  };
  onPorts(names());
  return {
    ports: names,
    bindings,
    /** learn takes the next note or CC from `name` for `id`, saves it, and calls done(binding). */
    learn(name, id, done) {
      learner = {
        name,
        fn: (b) => {
          learner = null;
          if (!b) return;
          const all = readBindings(store);
          all[name] = bindAll(all[name] || defaultBindings(), id, b);
          writeBindings(all, store);
          done(b);
        },
      };
    },
    cancelLearn() { learner = null; },
    close() {
      for (const id of [...ports.keys()]) shut(id);
      access.onstatechange = null;
    },
  };
}
