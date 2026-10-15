// web/static/lib/rig/patch.js
// What plugging a cable writes (docs/superpowers/specs/2026-10-15-rig-design.md,
// *Cables are settings*). Every cable is a setting, written through the
// route that already owns it; the next read of /api/rig draws it. Nothing
// here talks to the Pi: a patch is a request, and the page sends it.
//
// The same requests serve the touch and the keyboard: a drag from a socket
// to a socket, and choosing one socket and then where it goes, both ask
// writeFor. A pull on a plug, and Unplug in a socket's menu, both ask
// unplugFor.

import { socketById, deviceOf, armed, setting } from './graph.js';

const tapesURL = (g) => `/api/tapes?id=${encodeURIComponent(g.tape ? g.tape.id : '')}`;

/** role is what a socket does in a patch. */
export function role(s) {
  if (!s) return '';
  if (s.device === 'kit' || s.id.startsWith('kit.')) {
    if (s.kind === 'tap' || s.kind === 'track' || s.kind === 'bus' || s.kind === 'out' || s.kind === 'keep') return s.kind;
    return { 'kit.clock-out': 'clock-out', 'kit.clock-in': 'clock-in', 'kit.midi': 'kit-midi', 'kit.controls': 'controls', 'kit.usb': 'kit-usb' }[s.id] || '';
  }
  if (s.kind === 'network') return 'listener';
  if (s.kind === 'midi') return s.dir === 'in' ? 'dev-midi-in' : 'dev-midi-out';
  if (s.kind === 'usb') return 'dev-usb';
  if (s.kind === 'audio') return 'jack';
  return '';
}

// A device's name in a list setting: the part before a nudge ("bento:-4").
const namePart = (e) => {
  const i = e.lastIndexOf(':');
  return i > 0 && !Number.isNaN(Number(e.slice(i + 1).trim())) && e.slice(i + 1).trim() !== '' ? e.slice(0, i).trim() : e.trim();
};
const entries = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** matches says a list entry names a device: it's in one of its ports' names, as the Pi matches. */
export function matches(entry, dev) {
  const e = namePart(entry).toLowerCase();
  if (!e) return false;
  return [...(dev.midi || []), dev.name || ''].some((n) => n.toLowerCase().includes(e));
}

/** addName puts a device into a comma-separated list, unless it's there. */
export function addName(list, dev) {
  const es = entries(list);
  if (es.some((e) => matches(e, dev))) return es.join(',');
  return [...es, dev.match || dev.name].join(',');
}

/** removeName takes every entry that names a device out of a list. */
export function removeName(list, dev) {
  return entries(list).filter((e) => !matches(e, dev)).join(',');
}

const put = (body) => ({ method: 'PUT', url: '/api/settings', body, restart: true });

/**
 * writeFor is the request that plugs socket a into socket b, either way
 * round, or null when the two don't go together. restart says it takes
 * effect when Hindsight restarts.
 */
export function writeFor(g, aId, bId) {
  const a = socketById(g, aId), b = socketById(g, bId);
  if (!a || !b || a.id === b.id) return null;
  const pair = (r1, r2) => (role(a) === r1 && role(b) === r2 ? [a, b] : role(a) === r2 && role(b) === r1 ? [b, a] : null);
  let p;
  if ((p = pair('tap', 'track')) && g.tape) {
    const [tap, tr] = p;
    const set = [...new Set([...armed(g), tr.track])].sort((x, y) => x - y);
    return { method: 'PATCH', url: tapesURL(g), body: { input: { n: tr.track, source: tap.id.slice('kit.tap.'.length) }, rec_tracks: set } };
  }
  if ((p = pair('track', 'bus')) && g.tape) {
    const [tr, bus] = p;
    if (tr.bus === bus.bus) return null;
    return { method: 'PATCH', url: tapesURL(g), body: { track: { n: tr.track, bus: bus.bus } } };
  }
  if ((p = pair('out', 'listener'))) return { method: 'PUT', url: '/api/tapes/output', body: { mode: 'both' } };
  if ((p = pair('clock-out', 'dev-midi-in'))) {
    const dev = deviceOf(g, p[1].id);
    return put({ TAPE_CLOCK: 'lead', TAPE_CLOCK_OUT: addName(setting(g, 'TAPE_CLOCK_OUT'), dev) });
  }
  if ((p = pair('dev-midi-out', 'clock-in'))) {
    const dev = deviceOf(g, p[0].id);
    // Empty follows the interface: its own clock is the default.
    return put({ MIDI_CLOCK_DEVICE: dev.role === 'interface' ? null : dev.match || dev.name });
  }
  if ((p = pair('dev-midi-out', 'kit-midi'))) {
    const dev = deviceOf(g, p[0].id);
    const body = { MIDI_IGNORE: removeName(setting(g, 'MIDI_IGNORE'), dev) };
    const only = setting(g, 'MIDI_DEVICES');
    if (entries(only).length && !entries(only).some((e) => matches(e, dev))) body.MIDI_DEVICES = addName(only, dev);
    return put(body);
  }
  if ((p = pair('dev-midi-out', 'controls'))) {
    return put({ TAPE_CONTROLLER: addName(setting(g, 'TAPE_CONTROLLER'), deviceOf(g, p[0].id)) });
  }
  if ((p = pair('tap', 'keep'))) return put({ SAVE_CHANNELS: p[0].pair.join(','), SAVE_ALL_CHANNELS: 'false' });
  if ((p = pair('dev-usb', 'keep')) && deviceOf(g, p[0].id).role === 'interface') return put({ SAVE_ALL_CHANNELS: 'true' });
  return null;
}

/**
 * unplugFor is the request that takes a cable out, or null for one that
 * can't be: a fixed one, one that's only ever moved (a track's bus, what a
 * KEEP writes), or one already unplugged and waiting for the restart.
 */
export function unplugFor(g, c) {
  if (!c || c.fixed || c.pending === 'unplug') return null;
  const [what, rest] = [c.id.slice(0, c.id.indexOf(':')), c.id.slice(c.id.indexOf(':') + 1)];
  const dev = (g.devices || []).find((d) => d.id === rest);
  switch (what) {
    case 'input': {
      const n = Number(rest);
      return { method: 'PATCH', url: tapesURL(g), body: { input: { n, source: '' }, rec_tracks: armed(g).filter((x) => x !== n) } };
    }
    case 'out': return { method: 'PUT', url: '/api/tapes/output', body: { mode: 'jam' } };
    case 'clock-out': {
      if (!dev) return null;
      const left = removeName(setting(g, 'TAPE_CLOCK_OUT'), dev);
      return put(left ? { TAPE_CLOCK_OUT: left } : { TAPE_CLOCK: 'free', TAPE_CLOCK_OUT: null });
    }
    case 'clock-in':
      // The interface's own clock is what an empty setting means: there's
      // nothing to unplug it back to.
      if (!dev || (dev.role === 'interface' && !setting(g, 'MIDI_CLOCK_DEVICE'))) return null;
      return put({ MIDI_CLOCK_DEVICE: null });
    case 'midi': return dev ? put({ MIDI_IGNORE: addName(setting(g, 'MIDI_IGNORE'), dev) }) : null;
    case 'controls': return dev ? put({ TAPE_CONTROLLER: removeName(setting(g, 'TAPE_CONTROLLER'), dev) || null }) : null;
    case 'jack': return { method: 'PUT', url: '/api/rig/labels', body: { [rest]: '' } };
    default: return null;
  }
}

/** replugFor puts back a cable that was unplugged and still waits for its restart. */
export function replugFor(g, c) {
  if (!c || c.pending !== 'unplug') return null;
  return writeFor(g, c.from, c.to);
}

/** targetsFor is every socket a socket can be patched into, from here. */
export function targetsFor(g, id, all) {
  return all.filter((s) => s.id !== id && writeFor(g, id, s.id)).map((s) => s.id);
}

/** labelWrite names what's plugged into a jack ("" takes the label off). */
export function labelWrite(id, text) {
  return { method: 'PUT', url: '/api/rig/labels', body: { [id]: String(text || '').trim() } };
}

/** fixWrite is a warning's fix: its tracks to the other bus, one undo. */
export function fixWrite(g, w) {
  return w && w.fix ? { method: 'PATCH', url: tapesURL(g), body: { buses: w.fix.buses } } : null;
}

/** armWrite arms or disarms one track, leaving the others as they are. */
export function armWrite(g, n, on) {
  const set = new Set(armed(g));
  if (on) set.add(n);
  else set.delete(n);
  return { method: 'PATCH', url: tapesURL(g), body: { rec_tracks: [...set].sort((x, y) => x - y) } };
}

/** keepWrite is what a KEEP writes: one tap's pair, or 'all'. */
export function keepWrite(g, choice) {
  if (choice === 'all') return put({ SAVE_ALL_CHANNELS: 'true' });
  const s = socketById(g, `kit.tap.${choice}`);
  return s ? put({ SAVE_CHANNELS: s.pair.join(','), SAVE_ALL_CHANNELS: 'false' }) : null;
}

/** outputWrite sends the tape to the room, a phone, or both. */
export function outputWrite(mode) {
  return { method: 'PUT', url: '/api/tapes/output', body: { mode } };
}

/** offerWrite takes the interface's own taps (Use these taps). */
export function offerWrite(g) {
  return g.offer ? put({ ...g.offer.settings }) : null;
}
