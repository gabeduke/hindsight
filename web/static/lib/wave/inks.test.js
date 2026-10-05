// web/static/lib/wave/inks.test.js
// Waveform windows are black in both themes, so canvas drawing on them uses
// the window inks. The page inks are dark in the light theme and would vanish,
// and so would the legend's grease colour (on black it is --grease-mark) and
// the well's own edge, which is darker than the well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['./view.js', './lanes.js', './overview.js', './rising.js', './rowwave.js', './page.js', '../tape/page.js'];
test('canvas code draws with window inks, not page inks', () => {
  for (const f of FILES) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const bad = src.split('\n').filter((l) => /(col|token)\('--(ink|ink-dim|ink-faint|rule|grease|line|well-line|shadow)'/.test(l));
    assert.deepEqual(bad, [], `${f} still draws with page inks`);
  }
});

// The window inks only read on the window: a strip painted with a page
// surface (aluminium in the light theme) would swallow them.
test('canvas code paints window surfaces, not page surfaces', () => {
  for (const f of FILES) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const bad = src.split('\n').filter((l) => /(col|token)\('--(bg|panel|panel-2|panel-hi|line|card-hi|card-lo)'/.test(l));
    assert.deepEqual(bad, [], `${f} paints a page surface`);
  }
});
