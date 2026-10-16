import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text on the room passes contrast in its own right (the spec's "Look and
// materials"): cream on the dark wall, dark ink on paper, every label on its
// own plate or card. The room's colours are materials, the same in both
// schemes, so each pair is fixed and is checked here, from objects.css, at
// WCAG's 4.5:1 for text. The page's accent (styles.css, the same in both
// schemes) is read from there, for the selection's tick and ring.

const objects = readFileSync(new URL('../../objects.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(objects) || new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(styles);
  assert.ok(m, `${name} is a solid colour in objects.css or styles.css`);
  return m[1];
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [what, ink, ground]: every label the room draws, and what it sits on.
const PAIRS = [
  ['a place’s words on its plate', '--room-ink', '--room-tag'],
  ['words on the wall (empty shelf, the dock)', '--room-ink-dim', '--room-wall'],
  ['words on the wall, where it’s lightest', '--room-ink-dim', '--room-wall-hi'],
  ['a shelf’s brass plate, light end', '--room-plate-ink', '--room-plate-hi'],
  ['a shelf’s brass plate, dark end', '--room-plate-ink', '--room-plate-lo'],
  ['Open, in the dock', '--room-plate-ink', '--room-ink'],
  ['a month box’s card', '--marker', '--room-card'],
  ['a cassette’s name', '--paper-ink', '--paper-hi'],
  ['a cassette’s name, at its edge', '--paper-ink', '--paper-lo'],
  ['NEW, a note’s number, a grease mark', '--paper-ink', '--grease-mark'],
  ['NOTE HERE, at its foot', '--paper-ink', '--room-note-lo'],
  ['the sketchbook’s words', '--room-paper-ink', '--room-paper'],
  ['the sketchbook’s words, on a rule', '--room-paper-ink', '--room-paper-rule'],
  ['the sketchbook’s second hand', '--room-paper-dim', '--room-paper'],
  ['the chair’s name on masking tape', '--marker', '--room-mask'],
  ['words inside the shelves (an empty shelf)', '--room-ink-dim', '--room-walnut-deep'],
  ['a cassette’s date, on a phone', '--room-ink-dim', '--cas-mid'],
  // The selection's tick: its words on the accent disc.
  ['the selected tick', '--on-accent', '--accent'],
];

for (const [what, ink, ground] of PAIRS) {
  test(`contrast: ${what}`, () => {
    const r = ratio(token(ink), token(ground));
    assert.ok(r >= 4.5, `${ink} on ${ground} is ${r.toFixed(2)}:1`);
  });
}

// What marks a selected spine is not text, so WCAG's 3:1 for a component's
// edge (1.4.11) against what it touches. The accent ring sits on the paper's
// edge (inside the case), and the accent alone reaches the wall at only 2.95:1,
// so a cream halo (the paper's own colour) stands outside it, and the tick
// disc wears the same one: the ring against its paper, the halo against the
// wall or the shelf behind, the disc's accent against the halo.
const EDGES = [
  ['the selected ring on the paper, light end', '--accent', '--paper-hi'],
  ['the selected ring on the paper, dark end', '--accent', '--paper-lo'],
  ['the ring’s halo on the wall', '--paper-hi', '--room-wall'],
  ['the ring’s halo on the wall, where it is darkest', '--paper-hi', '--room-wall-hi'],
  ['the ring’s halo inside the shelves', '--paper-hi', '--room-walnut-deep'],
  ['the tick disc on its halo', '--accent', '--paper-hi'],
];

for (const [what, a, b] of EDGES) {
  test(`contrast (3:1, not text): ${what}`, () => {
    const r = ratio(token(a), token(b));
    assert.ok(r >= 3, `${a} against ${b} is ${r.toFixed(2)}:1`);
  });
}

test('the selected ring’s halo is in the stylesheet, on the ring and on the tick', () => {
  const ring = /\.room-cassette\.selected\s*\{[^}]*box-shadow:\s*0 0 0 2px var\(--paper-hi\)/.exec(styles);
  const tick = /\.room-cassette\.selected::before\s*\{[^}]*box-shadow:\s*0 0 0 2px var\(--paper-hi\)/.exec(styles);
  assert.ok(ring && tick, 'the contrast above is of what the CSS draws');
});
