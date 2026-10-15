// web/static/lib/play/strip.js
// Play mode on the tape page: the instrument strip, one more drawer above
// the bar (docs/superpowers/specs/2026-10-15-instrument-strip-design.md).
// It replaces the old full-screen overlay outright: one surface, not two.
//
// mount.js loads this only with the per-device flag on, so a kit without it
// fetches none of it.
//
// It learns what the tape is doing from the `hindsight:tape-state` event the
// page dispatches after each poll, asks the page to play or stop with
// `hindsight:play-transport`, and hands the Studio's verbs to the rooms as
// `hindsight:verb`. That is the whole coupling.
//
// Whose keys are they? The strip's while it's unfolded -- the KEYS lamp says
// so -- and the page's otherwise: folding it, or a tap on the lanes, gives
// them back to editing. MIDI and touch always play.

import { Surface, DIVISIONS } from './surface.js';
import { bindKeyboard } from './keymap.js';
import { mountStrip, mountToggle } from './screen.js';
import { ticker } from '../objects/motion.js';
import { on } from './flag.js';
import { on as roomsOn } from '../rooms/flag.js';
import { gridFrom, ringAt, beatAt } from './clock.js';
import { connect } from './link.js';
import { modeOf } from './reel.js';
import { control } from './controls.js';
import { support, attach } from './midi.js';
import { FarPads } from './far.js';

/** The strip's per-device conveniences (not DEVICE_PREFS: they're where you left it). */
export const FOLD_KEY = 'hindsight.play.strip';
export const FROM_KEY = 'hindsight.play.from';
export const WEBMIDI_KEY = 'hindsight.play.webmidi';

const read = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* this session only */ } };

/** The phone's layout: the bar is the mini player there (styles.css, "the phone's player"). */
const PHONE = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';

/**
 * keysOwner is the KEYS rule as a function: the strip has the keyboard only
 * while it's unfolded and nothing has given the keys back.
 */
export function keysOwner({ open, given }) { return !!open && !given; }

/**
 * fromOptions lists where the pads can be played from, for the strip's
 * Playing from: touch, the computer's keys, each controller in the Pi, each
 * one plugged into this browser, and the offer to plug one in here.
 */
export function fromOptions({ pi = [], web = [], canWeb = false, webOn = false }) {
  const out = [{ id: 'touch', label: 'Touch' }, { id: 'keys', label: 'Computer keys' }];
  for (const c of pi) out.push({ id: `pi:${c.name}`, label: `${c.name} (into the Pi)`, live: !!c.connected });
  for (const n of web) out.push({ id: `web:${n}`, label: `${n} (here)`, live: true });
  if (canWeb && !webOn) out.push({ id: 'web+', label: '＋ MIDI here' });
  return out;
}

/**
 * startStrip builds the strip into the dock and returns a handle, or null
 * when the flag is off or the page has no dock.
 */
export function startStrip({
  doc = globalThis.document,
  dock = doc?.getElementById('np-dock'),
  np = doc?.getElementById('np'),
  rooms = roomsOn,
  fetchImpl = (...a) => globalThis.fetch(...a),
  nav = globalThis.navigator,
} = {}) {
  if (!on() || !dock || !np) return null;
  const has = (need) => need === 'rooms' && !!rooms();
  const now = () => performance.now();

  const surface = new Surface({ bpm: 120, originMs: 0, division: '16th' });
  let tape = null;      // the last tape state the page sent
  let grid = null;      // the grid taken from it (clock.js)
  let open = false;     // unfolded (PLAY on a phone)
  let given = false;    // the keys given back to editing by a tap on the page
  let linkNote = '';
  let pi = [];          // the Pi's controllers, from /api/tapes/controls
  let piBindings = {};  // name → their bindings
  let midiIn = null;    // this browser's controllers (midi.js attach)
  let webPorts = [];
  let chosen = read(FROM_KEY, ''); // picked by hand on this device, or '' to follow what's there
  let from = chosen || 'keys';
  let learning = false;
  const sounding = [];  // pads sounding, in the order they fired: the reel follows the newest trick
  const far = new FarPads(); // another hand's pads (far.js)
  const phone = typeof matchMedia === 'function' ? matchMedia(PHONE) : { matches: false, addEventListener() {} };

  const root = doc.createElement('section');
  root.id = 'play-strip';
  np.before(root);
  const ui = mountStrip(root, surface, {
    has, doc,
    onCommand: command,
    onFold: (o) => setOpen(o),
    onKeys: (own) => { if (!open) setOpen(true); else { given = !own; paintKeys(); } },
    onFrom: pickFrom,
    onLearn: setLearning,
    onPick: pick,
  });
  const toggle = mountToggle(np, { doc, onPlay: (p) => setOpen(p) });

  const sound = (pad, isOn) => {
    const i = sounding.indexOf(pad);
    if (i >= 0) sounding.splice(i, 1);
    if (isOn) sounding.push(pad);
    toggle.lit(sounding.length > 0);
    wake();
  };
  surface.on('fire', ({ pad }) => sound(pad, true));
  surface.on('end', ({ pad }) => sound(pad, far.has(pad)));
  // A press here makes the pad this hand's: no other hand's mark on it.
  surface.on('arm', ({ pad }) => { for (const p of far.pressed(pad)) ui.remote(p, false); });
  const farChanged = (pad, isOn) => {
    ui.remote(pad, isOn);
    if (surface.state(pad) === 'idle') sound(pad, isOn);
  };

  const link = connect(surface, {
    onNote: (t) => { linkNote = t; showNote(); },
    onRemote: (pad, isOn, at) => { far.at(pad, isOn, at); wake(); },
    onHeld: (held) => {
      const others = held.filter((p) => surface.state(p) === 'idle');
      for (const p of far.hello(others)) farChanged(p, far.has(p));
      wake();
    },
    onOpen: () => fetchControls(),
  });

  const unbindKeys = bindKeyboard(surface, {
    onCommand: command,
    owns: () => keysOwner({ open, given }),
    has,
  });

  // --- the reel and the pads, on the shared ticker -----------------------------
  const step = (dt) => {
    const t = now();
    surface.tick(t);
    for (const c of far.tick(t)) farChanged(c.pad, c.on);
    let moving = false;
    if (open) {
      const r = ringAt(tape, t);
      ui.setLoop({ ...r, beat: beatAt(tape, t) });
      const beatMs = tape?.bpm > 0 ? 60000 / tape.bpm : 500;
      const slice = (DIVISIONS[surface.division] || 0.25) * beatMs;
      moving = ui.stepReel(Number.isFinite(dt) ? dt : 1000, t, { playing: !!tape?.playing, mode: modeOf(sounding), beatMs, sliceMs: slice });
    }
    return open || moving || far.pending.length > 0 || surface.pads.size > 0;
  };
  const unstep = ticker.add(step);
  function wake() { ticker.start(); }
  surface.on('arm', wake);
  surface.on('let', wake);

  // --- folding, and the keys --------------------------------------------------
  function setOpen(o) {
    open = !!o;
    given = false;
    write(FOLD_KEY, open ? 'open' : null);
    ui.setFold(open);
    toggle.set(open);
    if (open) {
      // One drawer at a time: the crate folds away for the instrument.
      const crateKey = doc.getElementById('np-drawer-crate');
      if (crateKey?.getAttribute('aria-expanded') === 'true') crateKey.click();
      fetchControls();
    } else if (learning) setLearning(false);
    paintKeys();
    wake();
  }
  function paintKeys() {
    ui.setKeys(keysOwner({ open, given }), open ? '' : 'Unfold the instrument to play it with the keys');
  }
  // A tap on the page -- the lanes, the ruler, the feed -- gives the keys
  // back to editing; a tap on the strip takes them again.
  const onDown = (e) => {
    if (!open) return;
    if (root.contains(e.target)) { if (given) { given = false; paintKeys(); } return; }
    if (np.contains(e.target)) return; // the bar's own keys: ▶ doesn't change whose keys they are
    if (e.target.closest?.('main, .tape-main') && !given) { given = true; paintKeys(); }
  };
  doc.addEventListener('pointerdown', onDown, true);
  // The crate opening folds the instrument: one drawer at a time.
  const crate = doc.getElementById('drawer-crate');
  const crateWatch = crate && typeof MutationObserver === 'function'
    ? new MutationObserver(() => { if (open && crate.classList.contains('open')) setOpen(false); }) : null;
  crateWatch?.observe(crate, { attributes: true, attributeFilter: ['class'] });

  // --- commands ---------------------------------------------------------------
  function command(name, detail = {}) {
    if (name === 'panic') {
      if (learning) { setLearning(false); return; }
      surface.releaseAll(now());
      return;
    }
    if (name === 'transport') {
      // Start and Stop from a controller mean exactly that; Space and a
      // note toggle, as ▶ does.
      const playing = !!tape?.playing;
      if (detail.rt === 'start' && playing) return;
      if (detail.rt === 'stop' && !playing) return;
      doc.dispatchEvent(new CustomEvent('hindsight:play-transport'));
      return;
    }
    if (control(name)?.needs === 'rooms') {
      if (!has('rooms')) return;
      doc.dispatchEvent(new CustomEvent('hindsight:verb', { detail: { verb: name }, cancelable: true }));
    }
  }

  // --- where it's played from --------------------------------------------------
  const web = support({ nav });
  function defaultFrom() {
    const live = pi.find((c) => c.connected);
    if (live) return `pi:${live.name}`;
    if (webPorts.length) return `web:${webPorts[0]}`;
    return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches ? 'keys' : 'touch';
  }
  function paintFrom() {
    const options = fromOptions({ pi, web: webPorts, canWeb: web.ok, webOn: !!midiIn });
    // A controller plugged in shows its keys on the pads, unless this device
    // picked otherwise.
    from = chosen && options.some((o) => o.id === chosen && o.id !== 'web+') ? chosen : defaultFrom();
    let line = '';
    if (from.startsWith('pi:')) line = 'All of them play at once; this picks which legends the pads show. The controller in the Pi needs no page open, and no Wi-Fi.';
    else if (from.startsWith('web:')) line = 'Plugged into this computer: its bindings are this browser’s. Into the Pi, it plays with no page open, and steadier.';
    else if (!web.ok && !pi.length) line = `A MIDI controller: set TAPE_CONTROLLER in Settings › MIDI and plug it into the Pi. ${web.why}.`;
    else if (!pi.length) line = 'A MIDI controller: plug it into the Pi (Settings › MIDI › Plays the tape), or into this computer (＋ MIDI here).';
    ui.setFrom(options, from, line);
    if (from.startsWith('pi:')) ui.setBindings(piBindings[from.slice(3)] || null);
    else if (from.startsWith('web:') && midiIn) ui.setBindings(midiIn.bindings(from.slice(4)));
    else ui.setBindings(null);
    const midi = from.startsWith('pi:') || from.startsWith('web:');
    ui.canLearn(midi, 'Pick a controller under Playing from, then MIDI LEARN');
    if (!midi && learning) setLearning(false);
  }
  function pickFrom(id) {
    if (id === 'web+') { plugHere(true); return; }
    chosen = id;
    write(FROM_KEY, id);
    paintFrom();
  }
  async function fetchControls() {
    try {
      const res = await fetchImpl('/api/tapes/controls', { cache: 'no-store' });
      if (!res.ok) return;
      const b = await res.json();
      pi = (b.controllers || []).filter((c) => c.connected || (b.setting || []).length);
      piBindings = Object.fromEntries((b.controllers || []).map((c) => [c.name, c.bindings]));
    } catch { /* the Pi out of reach: the link says so */ }
    paintFrom();
  }
  // A controller plugged into this computer: asked for once, on a press,
  // then opened on each visit. Its limits are said in the line above.
  async function plugHere(ask) {
    if (!web.ok || midiIn) return;
    try {
      const access = await nav.requestMIDIAccess();
      midiIn = attach(access, surface, {
        onCommand: command, has, now,
        onPorts: (names) => { webPorts = names; paintFrom(); },
      });
      write(WEBMIDI_KEY, '1');
      if (ask && webPorts.length) pickFrom(`web:${webPorts[0]}`);
    } catch (e) {
      if (ask) { linkNote = `MIDI here: ${e.message || 'not allowed'}`; showNote(); }
    }
  }
  if (read(WEBMIDI_KEY) === '1') plugHere(false);
  const poll = setInterval(() => { if (open && !doc.hidden) fetchControls(); }, 5000);

  // --- MIDI LEARN ------------------------------------------------------------
  function setLearning(onNow) {
    if (onNow && !(from.startsWith('pi:') || from.startsWith('web:'))) return;
    learning = !!onNow;
    if (!learning) { link.cancelLearn(); midiIn?.cancelLearn(); }
    ui.setLearning(learning);
    ui.note(learning ? 'MIDI LEARN: tap a pad, then play a key or turn a knob on the controller. Esc cancels' : '');
    if (!learning) showNote();
  }
  function pick(id) {
    if (!learning) return;
    ui.setPick(id);
    const face = control(id)?.face || id;
    if (from.startsWith('pi:')) {
      link.learn(id, from.slice(3))
        .then(() => { ui.note(`${face} learned`); ui.setPick(null); fetchControls(); })
        .catch((e) => { if (e.message !== 'cancelled' && e.message !== 'another pad was picked') ui.note(`${face}: ${e.message}`); if (ui.picked === id) ui.setPick(null); });
    } else if (from.startsWith('web:') && midiIn) {
      midiIn.learn(from.slice(4), id, () => { ui.note(`${face} learned`); ui.setPick(null); paintFrom(); });
    }
  }
  // Esc cancels learn wherever the keys are.
  const onEsc = (e) => {
    if (learning && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLearning(false); }
  };
  doc.addEventListener('keydown', onEsc, true);

  // --- what the tape is doing --------------------------------------------------
  // The frame being heard and when the page heard about it: clock.js turns
  // that into the grid the pads land on -- the tape's own bars -- and the ring.
  const onState = (e) => {
    tape = e.detail || null;
    const g = gridFrom(tape, grid);
    if (g) { grid = g; surface.setGrid(g); }
    showNote();
    wake();
  };
  // One line for what the player should know. The link's news comes first;
  // otherwise, a tape playing on a phone: the stream buffers about a second,
  // so the pads land on the grid but that long after the hand.
  function showNote() {
    if (learning) return;
    ui.note(linkNote || (tape?.output === 'phone' ? 'Playing on a phone — the pads land about a second late' : ''));
  }
  doc.addEventListener('hindsight:tape-state', onState);
  const onLead = () => ui.setLead(surface.lead);
  const leadTimer = setInterval(onLead, 1000);

  phone.addEventListener?.('change', () => paintKeys());
  setOpen(read(FOLD_KEY) === 'open');
  paintFrom();
  fetchControls();

  return {
    surface,
    ui,
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() { return open; },
    get ownsKeys() { return keysOwner({ open, given }); },
    destroy() {
      setOpen(false);
      surface.releaseAll(now());
      link.close();
      unbindKeys();
      unstep();
      midiIn?.close();
      clearInterval(poll);
      clearInterval(leadTimer);
      crateWatch?.disconnect();
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onEsc, true);
      doc.removeEventListener('hindsight:tape-state', onState);
      ui.destroy();
      root.remove();
      toggle.destroy();
    },
  };
}
