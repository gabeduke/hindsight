import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanLabel, cutLabelBase, cutLabel } from './cut-label.js';

const SR = 48000;

// internal/audio/cut_test.go TestSpanLabel
test('a span reads as the server writes it, with tenths under ten seconds', () => {
  assert.equal(spanLabel(42 * SR, 70 * SR, SR), '0:42–1:10');
  assert.equal(spanLabel(SR / 2, 3 * SR, SR), '0:00.5–0:03.0');
  assert.equal(spanLabel(61 * SR, 125 * SR, SR), '1:01–2:05');
  assert.equal(spanLabel(0, SR, 0), '');
});

// internal/audio/cut_test.go TestCutLabelBaseDropsAPreviousSpan and
// review_fixes_test.go TestCutLabelBaseOnlyStripsWhatACutWrote
test('only a span a cut wrote is dropped from the base', () => {
  const cases = {
    'riff · 0:42–1:10': 'riff',
    'riff · verse': 'riff · verse',
    'riff · 0:01.0–0:05.0': 'riff',
    'riff · 1:02–3:04': 'riff',
    'verse · 1–2': 'verse · 1–2',
    'take · 12:00–': 'take · 12:00–',
    'a · b · 10:00–12:30.5': 'a · b',
    '  spaced  ': 'spaced',
    '': '',
  };
  for (const [label, want] of Object.entries(cases)) assert.equal(cutLabelBase(label), want, label);
});

test('a cut is named from its take, or from the file when the take has no name', () => {
  assert.equal(cutLabel({ name: 'jam_a.wav', label: 'Tuesday jam' }, 2 * SR, 5 * SR, SR), 'Tuesday jam · 0:02.0–0:05.0');
  assert.equal(cutLabel({ name: 'jam_a.wav', label: 'riff · 0:42–1:10' }, 0, 12 * SR, SR), 'riff · 0:00–0:12');
  assert.equal(cutLabel({ name: 'jam_2026-10-05_163610.wav', label: '' }, 0, 12 * SR, SR), 'jam_2026-10-05_163610 · 0:00–0:12');
});
