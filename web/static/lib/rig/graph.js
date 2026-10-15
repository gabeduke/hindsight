// web/static/lib/rig/graph.js
// Reading the rig's graph, as GET /api/rig answers it
// (docs/superpowers/specs/2026-10-15-rig-design.md). The Pi builds it from
// the settings, the tape and what's plugged in, every time it's asked; the
// page only reads it. Everything here is pure: the graph in, facts out.

/** sockets is every socket on the desk: the devices', then the kit's. */
export function sockets(g) {
  const out = [];
  for (const d of g.devices || []) for (const s of d.sockets || []) out.push({ ...s, device: d.id });
  for (const s of (g.kit && g.kit.sockets) || []) out.push({ ...s, device: 'kit' });
  return out;
}

/** socketById finds a socket, with its device's id. */
export function socketById(g, id) {
  return sockets(g).find((s) => s.id === id) || null;
}

/** deviceOf is the device a socket is on. */
export function deviceOf(g, id) {
  const dev = String(id).split('.')[0];
  if (dev === 'kit') return g.kit;
  return (g.devices || []).find((d) => d.id === dev) || null;
}

/** cablesAt is every cable with an end at a socket. */
export function cablesAt(g, id) {
  return (g.cables || []).filter((c) => c.from === id || c.to === id);
}

/** otherEnd is the socket at a cable's other end from id. */
export function otherEnd(c, id) {
  return c.from === id ? c.to : c.from;
}

/** setting is a setting's saved value, as the picture is drawn from it. */
export function setting(g, key) {
  const l = (g.settings || []).find((x) => x.key === key);
  return l ? l.value || '' : '';
}

/** armed is the armed tracks. */
export function armed(g) {
  return (g.tape && g.tape.rec_tracks) || [];
}

/** warningsAt is every warning a socket is part of: its tap, or an armed track it names. */
export function warningsAt(g, id) {
  const s = socketById(g, id);
  return (g.warnings || []).filter((w) => w.socket === id || (s && s.kind === 'track' && w.armed.includes(s.track)));
}

/** levelWords is a peak in words: "−32 dBFS peak", or "silent". */
export function levelWords(peak) {
  if (typeof peak !== 'number') return 'no reading';
  if (peak <= -119) return 'silent';
  return `${peak < 0 ? '−' : ''}${Math.abs(peak).toFixed(0)} dBFS peak`;
}

/** title is what the inspector calls a socket. */
export function title(g, s) {
  if (!s) return '';
  const dev = deviceOf(g, s.id);
  switch (s.kind) {
    case 'tap': return `${s.label} tap · USB ${s.pair.join('/')}`;
    case 'track': return `Track ${s.track}${s.name ? ` · ${s.name}` : ''}`;
    case 'bus': return s.label === 'BUS A' ? 'Bus A' : s.label === 'BUS B' ? 'Bus B' : s.label;
    default: return dev && dev.id !== 'kit' ? `${dev.short} · ${s.label}` : s.label;
  }
}

/** spoken is a socket's name for a screen reader: what it is, and what's in it. */
export function spoken(g, s) {
  const parts = [title(g, s)];
  if (s.name) parts.push(s.name);
  if (s.kind === 'track' && s.armed) parts.push('armed');
  const n = cablesAt(g, s.id).filter((c) => c.kind !== 'jack').length;
  parts.push(n ? `${n} cable${n === 1 ? '' : 's'}` : 'nothing plugged in');
  if (s.warn || warningsAt(g, s.id).length) parts.push('records the tape');
  return parts.join(', ');
}

/** found is the header's line, "Sidekick on USB · Bento on MIDI". */
export function found(g) {
  return g.found || '';
}

/** pendingCables is every cable waiting for a restart. */
export function pendingCables(g) {
  return (g.cables || []).filter((c) => c.pending);
}
