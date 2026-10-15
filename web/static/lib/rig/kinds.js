// web/static/lib/rig/kinds.js
// The kinds of cable on the rig (docs/superpowers/specs/2026-10-15-rig-design.md),
// and how each is drawn. They differ by width and dash, not by colour alone:
// a colour-blind eye, or a phone in the sun, reads the line itself. The
// colours are materials, the same in both schemes (objects.css, --cable-*).
//
// A restart cable that hasn't taken effect yet is drawn in the pending way
// whatever its kind: dashed, in amber.

export const KINDS = {
  usb: { width: 9, dash: '', ink: 'var(--cable-usb)', legend: 'USB: many channels' },
  patch: { width: 5, dash: '', ink: 'var(--cable-patch)', legend: 'patch: a setting, at once' },
  return: { width: 3, dash: '1 6', ink: 'var(--cable-return)', legend: 'return: what the tape plays into' },
  clock: { width: 3, dash: '10 5', ink: 'var(--cable-midi)', legend: 'clock: MIDI clock, Start and Stop' },
  midi: { width: 3, dash: '3 4', ink: 'var(--cable-midi)', legend: 'MIDI: notes and CC' },
  keep: { width: 2, dash: '14 4 2 4', ink: 'var(--cable-keep)', legend: 'KEEP: what a take is made of' },
  network: { width: 2, dash: '2 3', ink: 'var(--cable-net)', legend: 'network: a phone listening' },
  jack: { width: 4, dash: '7 5', ink: 'var(--cable-jack)', legend: 'a jack you drew: a label' },
};

/** PENDING is a restart cable before the restart, of any kind. */
export const PENDING = { dash: '6 6', ink: 'var(--cable-pending)', legend: 'waits for a restart' };

/**
 * styleOf is how a cable is drawn: its width, dash and ink, and whether it's
 * faded (unplugged and waiting for the restart, or carrying nothing now).
 */
export function styleOf(c) {
  const k = KINDS[c.kind] || KINDS.patch;
  const s = { width: k.width, dash: k.dash, ink: k.ink, faded: !!c.off };
  if (c.pending) {
    s.dash = PENDING.dash;
    s.ink = PENDING.ink;
    s.faded = c.pending === 'unplug';
  }
  if (c.kind === 'jack' && c.waiting) s.faded = true;
  return s;
}

/** legend is every kind, in the order the legend draws them. */
export function legend() {
  return [...Object.entries(KINDS).map(([kind, k]) => ({ kind, ...k })), { kind: 'pending', width: 3, ...PENDING }];
}
