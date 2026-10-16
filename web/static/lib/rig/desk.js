// web/static/lib/rig/desk.js
// What the rig page draws, from the graph alone: the devices on the desk,
// each with its sockets, and the kit's patch bay in rows -- the taps, the
// track inputs, back out, and the kit's MIDI and KEEP (the canvas's *Rig ·
// the patch*). Pure: page.js turns it into buttons, and the cables are
// drawn over them from where those buttons land.

import { spoken } from './graph.js';

const sock = (g, s, device) => ({ ...s, device, spoken: spoken(g, { ...s, device }) });

/**
 * desk is the drawing: devices (the interface first, then MIDI devices,
 * then listeners), and the bay's rows. Every socket in the graph is in it
 * exactly once, as a button.
 */
export function desk(g) {
  const order = { interface: 0, midi: 1, listener: 2 };
  const devices = [...(g.devices || [])]
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3))
    .map((d) => ({
      id: d.id,
      role: d.role,
      name: d.name,
      short: d.short,
      sub: sub(d),
      note: d.note || '',
      generic: !!d.generic,
      placeholder: !!d.placeholder,
      sockets: (d.sockets || []).map((s) => sock(g, s, d.id)),
    }));
  const kit = (g.kit && g.kit.sockets) || [];
  const of = (pred) => kit.filter(pred).map((s) => sock(g, s, 'kit'));
  const iface = devices.find((d) => d.role === 'interface');
  const rows = [
    { id: 'taps', title: iface ? `From the ${iface.short} · USB taps` : 'USB taps', sockets: of((s) => s.id === 'kit.usb' || s.kind === 'tap') },
    { id: 'tracks', title: 'Into the tape · track inputs', sockets: of((s) => s.kind === 'track') },
    { id: 'back', title: 'Back out', sockets: of((s) => s.kind === 'bus' || s.kind === 'out') },
    { id: 'midi', title: 'MIDI and KEEP', sockets: of((s) => s.kind === 'midi' || s.kind === 'keep') },
  ].filter((r) => r.sockets.length);
  return { devices, rows, version: (g.kit && g.kit.note) || '' };
}

function sub(d) {
  if (d.role === 'interface') {
    const ch = d.in ? `USB · ${d.in} in${d.out ? ` · ${d.out} out` : ''}` : 'USB';
    return d.generic ? `${ch} · no profile` : ch;
  }
  if (d.role === 'midi') return d.placeholder ? 'MIDI · ports from its manual' : d.generic ? 'MIDI · no profile' : 'MIDI';
  if (d.role === 'listener') return 'on the Wi-Fi';
  return '';
}

/** allSockets is every socket the desk draws, in drawing order. */
export function allSockets(d) {
  return [...d.devices.flatMap((x) => x.sockets), ...d.rows.flatMap((r) => r.sockets)];
}
