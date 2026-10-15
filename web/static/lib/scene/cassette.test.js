import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CassetteModel } from './cassette.js';

test('played is held to the tape, and playing turns the hubs', () => {
  const m = new CassetteModel();
  m.step({ played: 0.4, playing: true });
  assert.deepEqual(m.view, { played: 0.4, spinning: true });
  m.step({ played: 7 });
  assert.deepEqual(m.view, { played: 1, spinning: false });
  m.step({ played: -1 });
  assert.equal(m.view.played, 0);
  m.step({ played: 'nonsense' });
  assert.equal(m.view.played, 0);
});

test('nothing of its own moves: it never asks for a frame, and keeps its view while unchanged', () => {
  const m = new CassetteModel();
  assert.equal(m.step({ played: 0.5 }), false);
  const v = m.view;
  assert.equal(m.step({ played: 0.5 }), false);
  assert.equal(m.view, v);
});

test('the view is the same at any frame rate: it follows the page\'s clock, not dt', () => {
  const a = new CassetteModel(), b = new CassetteModel();
  for (let i = 0; i <= 20; i++) a.step({ played: i / 20 }, 50);
  for (let i = 0; i <= 120; i++) b.step({ played: i / 120 }, 1000 / 120);
  assert.deepEqual(a.view, b.view);
});
