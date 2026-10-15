// web/static/lib/rig/warn.js
// The rig's warning on the Studio's track header: an amber dot on an armed
// track whose input hears a bus that a track with clips is playing on, so a
// recording onto it records the tape too
// (docs/superpowers/specs/2026-10-15-rig-design.md, *The inspector*).
//
// Worked out from what the tape page already has: a source's clean is false
// exactly when an unmuted track with clips plays on a bus it hears -- what
// a clip's Clean is worked out from on the Pi. Pure.

/** recordsTape says an armed track would record the tape, and why. */
export function recordsTape(n, armed, sources, inputOf) {
  if (!armed.includes(n)) return null;
  const name = inputOf(n);
  const src = (sources || []).find((s) => s.name === name);
  if (!src || src.clean !== false) return null;
  const buses = (src.leaks || []).join(' and ');
  return `${name.toUpperCase()} hears bus ${buses}, where the tape is playing: recording track ${n} from it records the tape too. The rig has the fix.`;
}
