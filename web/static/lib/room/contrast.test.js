import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text on the room passes contrast in its own right (the spec's "Look and
// materials"): cream on the dark wall, dark ink on paper, every label on its
// own plate or card. The room's colours are materials, the same in both
// schemes, so each pair is fixed and is checked here, from objects.css, at
// WCAG's 4.5:1 for text.

const objects = readFileSync(new URL('../../objects.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(objects);
  assert.ok(m, `${name} is a solid colour in objects.css`);
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
  ['the deck card’s second line', '--room-ink-dim', '--room-tag'],
  ['words on the wall (empty shelf, the dock)', '--room-ink-dim', '--room-wall'],
  ['words on the wall, where it’s lightest', '--room-ink-dim', '--room-wall-hi'],
  ['a shelf’s brass plate, light end', '--room-plate-ink', '--room-plate-hi'],
  ['a shelf’s brass plate, dark end', '--room-plate-ink', '--room-plate-lo'],
  ['PUT IT ON, SIT DOWN, CUT A RECORD', '--room-plate-ink', '--room-ink'],
  ['a tape’s masking tape', '--marker', '--room-mask'],
  ['a month box’s card, a sleeve’s name', '--marker', '--room-card'],
  ['a cassette’s name', '--paper-ink', '--paper-hi'],
  ['a cassette’s name, at its edge', '--paper-ink', '--paper-lo'],
  ['NEW, a note’s number, a grease mark', '--paper-ink', '--grease-mark'],
  ['NOTE HERE, at its foot', '--paper-ink', '--room-note-lo'],
  ['the deck’s keys', '--room-key-ink', '--room-key-hi'],
  ['the deck’s keys, at their foot', '--room-key-ink', '--room-key-lo'],
  ['the sketchbook’s words', '--room-paper-ink', '--room-paper'],
  ['the sketchbook’s words, on a rule', '--room-paper-ink', '--room-paper-rule'],
  ['the sketchbook’s second hand', '--room-paper-dim', '--room-paper'],
  ['the deck’s name on masking tape', '--marker', '--room-mask'],
  ['words inside the shelves (an empty shelf, room for the next)', '--room-ink-dim', '--room-walnut-deep'],
  ['a cassette’s date, on a phone', '--room-ink-dim', '--cas-mid'],
];

for (const [what, ink, ground] of PAIRS) {
  test(`contrast: ${what}`, () => {
    const r = ratio(token(ink), token(ground));
    assert.ok(r >= 4.5, `${ink} on ${ground} is ${r.toFixed(2)}:1`);
  });
}
