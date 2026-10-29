// web/static/lib/play/controls.js
// The one list of what can be played or done, whatever does the playing
// (docs/superpowers/specs/2026-10-15-instrument-strip-design.md, "One bus"):
//
//   touch    ─┐
//   keys     ─┤                         held     → Surface → press / release
//   Web MIDI ─┼→ controls.js, by kind   amount   → set (P4)
//   Pi MIDI  ─┘                         latched  → the tape's mods (P4)
//                                       command  → catch · grab · drop · keep · transport
//
// Each action has an `id` (a pad's id is the name the Pi knows it by,
// internal/tape/trick.go), a `kind`, the keys that play it -- `play` while
// the strip has the keyboard, `edit` while the page has it -- and its default
// `midi`, the starting profile a controller gets before MIDI LEARN. The
// keyboard's tables (keymap.js), the buffer's keys (lib/buffer/keys.js),
// the Web MIDI adapter (midi.js) and the Pi's own copy of the defaults
// (internal/api/controls.go, held to this file by a test) all come from
// here, so the key table in the spec is written once.
//
// Keys are physical codes (`KeyQ`, not `q`), so an instrument's layout stays
// under the same fingers on any keyboard. `Shift+` in front means with ⇧.
//
// `needs: 'rooms'` is an action that belongs to the two rooms (their verbs
// and the click's new key). The rooms are the only layout, so the strip
// always has them (strip.js); `has` still answers for each need, so a table
// can be read without them (the tests do).
// `soon` is an action whose sound or data isn't built yet (the crate's
// pads): listed so the table is whole and the keys are taken, but nothing
// plays it until it lands.
//
// MIDI defaults put middle C (60) at C4. Note 36 counting up is also what an
// unknown controller starts with on the Pi.

export const HELD = 'held';
export const AMOUNT = 'amount';
export const LATCHED = 'latched';
export const COMMAND = 'command';
export const MODIFIER = 'modifier';

const note = (n) => ({ note: n });
const cc = (n, as) => (as ? { cc: n, as } : { cc: n });

/* eslint-disable object-curly-newline */
export const CONTROLS = [
  // The track keys: held, that track drops out.
  { id: 'track1', kind: HELD, group: 'tracks', face: '1', play: ['Digit1'], midi: [note(36)], what: 'Track 1 drops out while held' },
  { id: 'track2', kind: HELD, group: 'tracks', face: '2', play: ['Digit2'], midi: [note(37)], what: 'Track 2 drops out while held' },
  { id: 'track3', kind: HELD, group: 'tracks', face: '3', play: ['Digit3'], midi: [note(38)], what: 'Track 3 drops out while held' },
  { id: 'track4', kind: HELD, group: 'tracks', face: '4', play: ['Digit4'], midi: [note(39)], what: 'Track 4 drops out while held' },
  // The tricks: held, on the grid; the last one pressed moves the head.
  { id: 'break', kind: HELD, group: 'tricks', face: 'BREAK', play: ['KeyQ'], midi: [note(40)], what: 'The sound cuts; the tape runs on' },
  { id: 'reverse', kind: HELD, group: 'tricks', face: 'REV', play: ['KeyW'], midi: [note(41)], what: 'Plays backwards' },
  { id: 'chop', kind: HELD, group: 'tricks', face: 'CHOP', play: ['KeyE'], midi: [note(42)], what: 'Repeats the last slice of the grid' },
  { id: 'stop', kind: HELD, group: 'tricks', face: 'STOP', play: ['KeyR'], midi: [note(43)], what: 'Winds down over a beat' },
  { id: 'half', kind: HELD, group: 'tricks', face: '½×', play: ['KeyZ'], midi: [note(44)], what: 'Half speed' },
  { id: 'double', kind: HELD, group: 'tricks', face: '2×', play: ['KeyX'], midi: [note(45)], what: 'Double speed' },
  // The punch-in FX: held, an amount read at the press (a velocity) and
  // moved while held (the mod wheel, aftertouch, a finger sliding on it).
  { id: 'roll', kind: HELD, group: 'fx', face: 'ROLL', play: ['KeyT'], midi: [note(46)], what: 'Beat repeat' },
  { id: 'filter', kind: HELD, group: 'fx', face: 'FILTER', play: ['KeyY'], midi: [note(47), cc(1, 'amount')], what: 'Low-pass; the mod wheel sweeps it' },
  { id: 'echo', kind: HELD, group: 'fx', face: 'ECHO', play: ['KeyU'], midi: [note(48)], what: 'A delay throw that rings out' },
  { id: 'crush', kind: HELD, group: 'fx', face: 'CRUSH', play: ['KeyI'], midi: [note(49)], what: 'Fewer bits' },
  { id: 'bend', kind: AMOUNT, group: 'fx', face: 'BEND', play: [], midi: [{ bend: true }], what: 'A varispeed nudge that springs back' },
  // The tape mods: latched, saved with the tape, through undo.
  { id: 'mod.wow', kind: LATCHED, group: 'mods', face: 'WOW', play: [], midi: [cc(21, 'amount')], what: 'Slow pitch drift' },
  { id: 'mod.flutter', kind: LATCHED, group: 'mods', face: 'FLUTTER', play: [], midi: [cc(22, 'amount')], what: 'Fast pitch wobble' },
  { id: 'mod.drive', kind: LATCHED, group: 'mods', face: 'DRIVE', play: [], midi: [cc(23, 'amount')], what: 'Tape saturation' },
  { id: 'mod.age', kind: LATCHED, group: 'mods', face: 'AGE', play: [], midi: [cc(24, 'amount')], what: 'Worn highs' },
  { id: 'mod.formula', kind: LATCHED, group: 'mods', face: 'FORMULA', play: [], midi: [{ program: true }], what: 'Which tape it is' },
  // The bus's own.
  { id: 'latch', kind: MODIFIER, group: 'bus', face: 'LATCH', play: ['ShiftLeft', 'ShiftRight'], midi: [cc(64)], what: 'What is held stays held until it lifts' },
  { id: 'transport', kind: COMMAND, group: 'bus', face: '▶', play: ['Space'], midi: [{ rt: 'start' }, { rt: 'stop' }], what: 'Play or stop the tape' },
  { id: 'panic', kind: COMMAND, group: 'bus', face: 'Esc', play: ['Escape'], midi: [cc(123)], what: 'Let go of everything' },
  // The Studio's verbs: the rooms'. Commands, on the press.
  { id: 'catch', kind: COMMAND, group: 'verbs', face: 'CATCH', play: ['KeyC'], edit: ['KeyC'], midi: [note(50)], needs: 'rooms', what: 'The last pass onto the armed track' },
  { id: 'grab', kind: COMMAND, group: 'verbs', face: 'GRAB', play: ['KeyG'], edit: ['KeyG'], midi: [note(51)], needs: 'rooms',
    buffer: { when: 'studio', what: 'Grab the last bars onto the cue lane' }, what: 'The last bars onto the cue lane' },
  { id: 'drop', kind: COMMAND, group: 'verbs', face: 'DROP', play: ['Enter', 'NumpadEnter'], edit: ['Enter', 'NumpadEnter'], midi: [note(52)], needs: 'rooms',
    buffer: { when: 'held', what: 'Drop it on the armed track, at the next free span' }, what: 'The open cue part onto the armed track' },
  { id: 'keep', kind: COMMAND, group: 'verbs', face: 'KEEP', play: ['KeyK'], edit: ['KeyK'], midi: [note(53)], needs: 'rooms',
    buffer: { when: 'open', what: 'Keep it as a take' }, what: 'The feed, or the open buffer, as a take' },
  // The click's key with the rooms on: K is KEEP there.
  { id: 'click', kind: COMMAND, group: 'studio', face: '♩', play: [], edit: ['KeyM'], midi: [], needs: 'rooms', what: 'The click on or off' },
  // The buffer's edit keys (lib/buffer/keys.js), only while it's open.
  { id: 'buffer.in-back', kind: COMMAND, group: 'buffer', face: '[', play: [], edit: ['BracketLeft'], midi: [], needs: 'rooms', buffer: { when: 'open', repeat: true, what: 'IN back a step' } },
  { id: 'buffer.in-on', kind: COMMAND, group: 'buffer', face: ']', play: [], edit: ['BracketRight'], midi: [], needs: 'rooms', buffer: { when: 'open', repeat: true, what: 'IN on a step' } },
  { id: 'buffer.out-back', kind: COMMAND, group: 'buffer', face: '⇧[', play: [], edit: ['Shift+BracketLeft'], midi: [], needs: 'rooms', buffer: { when: 'open', repeat: true, what: 'OUT back a step' } },
  { id: 'buffer.out-on', kind: COMMAND, group: 'buffer', face: '⇧]', play: [], edit: ['Shift+BracketRight'], midi: [], needs: 'rooms', buffer: { when: 'open', repeat: true, what: 'OUT on a step' } },
  { id: 'buffer.toss', kind: COMMAND, group: 'buffer', face: '⌫', play: [], edit: ['Backspace', 'Delete'], midi: [], needs: 'rooms', buffer: { when: 'open', what: 'Toss it' } },
  // The crate's launch pads (Play mode's phase 2): their keys moved from A–L.
  { id: 'crate.1', kind: HELD, group: 'crate', face: '5', play: ['Digit5'], midi: [note(60)], soon: 'phase 2', what: 'The crate’s first clip' },
  { id: 'crate.2', kind: HELD, group: 'crate', face: '6', play: ['Digit6'], midi: [note(61)], soon: 'phase 2', what: 'The crate’s second clip' },
  { id: 'crate.3', kind: HELD, group: 'crate', face: '7', play: ['Digit7'], midi: [note(62)], soon: 'phase 2', what: 'The crate’s third clip' },
  { id: 'crate.4', kind: HELD, group: 'crate', face: '8', play: ['Digit8'], midi: [note(63)], soon: 'phase 2', what: 'The crate’s fourth clip' },
  { id: 'crate.5', kind: HELD, group: 'crate', face: '9', play: ['Digit9'], midi: [note(64)], soon: 'phase 2', what: 'The crate’s fifth clip' },
  { id: 'crate.6', kind: HELD, group: 'crate', face: '0', play: ['Digit0'], midi: [note(65)], soon: 'phase 2', what: 'The crate’s sixth clip' },
];
/* eslint-enable object-curly-newline */

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

/** control is the action with this id, or undefined. */
export const control = (id) => BY_ID.get(id);

/** The ids of the pads the strip draws, in order. */
export const TRACK_PADS = CONTROLS.filter((c) => c.group === 'tracks').map((c) => c.id);
export const TRICK_PADS = CONTROLS.filter((c) => c.group === 'tricks').map((c) => c.id);
export const FX_PADS = CONTROLS.filter((c) => c.group === 'fx' && c.kind === HELD).map((c) => c.id);
export const VERBS = CONTROLS.filter((c) => c.group === 'verbs').map((c) => c.id);
/** MODS are the tape mods' knobs, as the Pi previews them (mod.wow …). */
export const MODS = CONTROLS.filter((c) => c.group === 'mods' && c.id !== 'mod.formula').map((c) => c.id);

/**
 * FORMULAS are the tape's starting points, by name and in program-change
 * order (0–3): choosing one sets the four mods (internal/tape/style.go).
 */
export const FORMULAS = ['clean', 'chrome', 'ferric', 'worn'];

/** styleField is a mod's field in the tape's style: mod.wow is wow. */
export const styleField = (mod) => mod.replace(/^mod\./, '');

/**
 * amountText is how an amount reads on its pad or knob: ROLL's slice,
 * FILTER's cutoff, ECHO's send, CRUSH's bits, the bend's speed, a mod's
 * percent. The mappings are the Pi's (internal/tape/fx.go, trick.go).
 */
export function amountText(id, v) {
  if (!Number.isFinite(v)) return '';
  switch (id) {
    case 'roll': return v < 0.25 ? '1/4' : v < 0.5 ? '1/8' : v < 0.75 ? '1/16' : '1/32';
    case 'filter': {
      const hz = 20000 * 0.01 ** v;
      return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 9950 ? 0 : 1)} kHz` : `${Math.round(hz / 10) * 10} Hz`;
    }
    case 'echo': return `send ${Math.round(v * 100)}%`;
    case 'crush': return `${Math.round(12 - 8 * v)} bits`;
    case 'bend': return v === 0 ? '±0%' : `${v > 0 ? '+' : '−'}${(Math.abs(v) * 8).toFixed(1)}%`;
    default: return `${Math.round(v * 100)}`;
  }
}

/**
 * live says an action can be played on this device now: built (not `soon`),
 * and its flag on if it needs one. `has(need)` answers for the flags.
 */
export function live(c, has = () => false) {
  if (!c || c.soon) return false;
  return !c.needs || !!has(c.needs);
}

/**
 * keyTables builds the play keys' two tables from the list: `pads`, a code
 * to a held pad's id, and `commands`, a code to a command's (or the latch's)
 * id. Only what's live, and only plain keys (no `Shift+`).
 */
export function keyTables(has = () => false) {
  const pads = {};
  const commands = {};
  for (const c of CONTROLS) {
    if (!live(c, has)) continue;
    for (const code of c.play || []) {
      if (code.startsWith('Shift+')) continue;
      if (c.kind === HELD) pads[code] = c.id;
      else commands[code] = c.id;
    }
  }
  return { pads, commands };
}

/** KEY_LABELS: what a key is called on a pad, or in a tip. */
const KEY_LABELS = {
  Space: 'Space', Escape: 'Esc', Enter: '↵', NumpadEnter: '↵', Backspace: '⌫', Delete: '⌦',
  BracketLeft: '[', BracketRight: ']', ShiftLeft: '⇧', ShiftRight: '⇧',
};

/** keyLabel is how a code reads: `KeyQ` is Q, `Digit1` is 1, `Shift+BracketLeft` is ⇧[. */
export function keyLabel(code) {
  if (!code) return '';
  if (code.startsWith('Shift+')) return `⇧${keyLabel(code.slice(6))}`;
  return KEY_LABELS[code] ?? code.replace(/^(Key|Digit)/, '');
}

/**
 * BUFFER_KEYS are the buffer's edit keys, as lib/buffer/keys.js reads them:
 * {code, shift, action, when, label, what, repeat}. `action` is the
 * buffer's name for it (grab, drop, keep, in-back, ..., toss).
 */
export const BUFFER_KEYS = CONTROLS.filter((c) => c.buffer).flatMap((c) => (c.edit || []).map((k) => {
  const shift = k.startsWith('Shift+');
  const code = shift ? k.slice(6) : k;
  return {
    code, shift, action: c.id.replace(/^buffer\./, ''), when: c.buffer.when,
    label: keyLabel(k), what: c.buffer.what || c.what, repeat: !!c.buffer.repeat,
  };
}));

/**
 * STUDIO_KEYS are the rooms' edit keys outside the buffer: C catches, K
 * keeps the feed (the buffer's K, while it's open, comes first), M is the
 * click. {code, action}.
 */
export const STUDIO_KEYS = ['catch', 'keep', 'click'].flatMap((id) => (control(id).edit || []).map((code) => ({ code, action: id })));

// --- MIDI ---------------------------------------------------------------------

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** noteName names a MIDI note with middle C (60) as C4: 36 is C2. */
export function noteName(n) {
  if (!Number.isInteger(n) || n < 0 || n > 127) return '';
  return `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

/** bindingLabel is how a binding reads on a pad: C2, CC 64, PB, PC, Start. */
export function bindingLabel(b) {
  if (!b) return '–';
  if (b.note != null) return noteName(b.note);
  if (b.cc != null) return `CC ${b.cc}`;
  if (b.bend) return 'PB';
  if (b.program) return 'PC';
  if (b.rt) return b.rt === 'start' ? 'Start' : b.rt === 'stop' ? 'Stop' : b.rt;
  return '–';
}

/**
 * defaultBindings is the starting profile: every action's default midi, by
 * id. A known controller on the Pi may ship its own (internal/api).
 */
export function defaultBindings() {
  const out = {};
  for (const c of CONTROLS) if (c.midi && c.midi.length) out[c.id] = c.midi.map((b) => ({ ...b }));
  return out;
}

/**
 * matches says a binding answers a decoded message (midi.js's decode):
 * {type: 'on'|'off'|'cc'|'bend'|'program'|'rt', ch, note, cc, rt}. A
 * binding with a channel (1–16) answers only on it.
 */
export function matches(b, m) {
  if (!b || !m) return false;
  if (b.ch && m.ch && b.ch !== m.ch) return false;
  switch (m.type) {
    case 'on': case 'off': return b.note != null && b.note === m.note;
    case 'cc': return b.cc != null && b.cc === m.cc;
    case 'bend': return !!b.bend;
    case 'program': return !!b.program;
    case 'rt': return !!b.rt && b.rt === m.rt;
    default: return false;
  }
}

/**
 * actionFor finds what a message plays under `bindings` ({id: [binding]}):
 * {id, binding}, or null. Amount bindings (`as: 'amount'`) are P4's and
 * answer only when asked for.
 */
export function actionFor(bindings, m, { amounts = false } = {}) {
  for (const [id, list] of Object.entries(bindings || {})) {
    for (const b of list || []) {
      if (b.as === 'amount' && !amounts) continue;
      if (matches(b, m)) return { id, binding: b };
    }
  }
  return null;
}

/** learned is a message as a binding: what MIDI LEARN writes on a pad. */
export function learned(m) {
  if (!m) return null;
  const ch = m.ch ? { ch: m.ch } : {};
  if (m.type === 'on') return { note: m.note, ...ch };
  if (m.type === 'cc') return { cc: m.cc, ...ch };
  return null;
}

/**
 * bind writes one learned binding for an action: it replaces that action's
 * bindings (but its amount), and takes the same message off any other
 * action, so one key never plays two pads.
 */
export function bind(bindings, id, b) {
  const sameCh = (x) => !x.ch || !b.ch || x.ch === b.ch;
  const same = (x) => sameCh(x) && ((b.note != null && x.note === b.note) || (b.cc != null && x.cc === b.cc));
  const out = {};
  for (const [k, list] of Object.entries(bindings || {})) out[k] = (list || []).filter((x) => !same(x));
  out[id] = [b, ...(out[id] || []).filter((x) => x.as === 'amount')];
  return out;
}

/**
 * legendFor is what a pad shows under its face for where it's played from:
 * the key on a computer, the binding on a controller (a dash when none),
 * nothing for touch.
 */
export function legendFor(id, from, { bindings = null, has = () => false } = {}) {
  const c = control(id);
  if (!c) return '';
  if (from === 'touch') return '';
  if (from === 'keys') return live(c, has) && c.play && c.play.length ? keyLabel(c.play[0]) : '';
  const list = (bindings && bindings[id]) || [];
  const b = list.find((x) => x.as !== 'amount');
  return bindingLabel(b);
}
