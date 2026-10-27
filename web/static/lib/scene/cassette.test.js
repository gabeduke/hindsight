import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CassetteModel, HUB_TURN } from './cassette.js';

test('played is held to the tape, and playing turns the hubs', () => {
  const m = new CassetteModel();
  m.step({ played: 0.4, playing: true });
  assert.deepEqual(m.view, { played: 0.4, spinning: true, hubL: 0, hubR: 0 });
  m.step({ played: 7 });
  assert.deepEqual(m.view, { played: 1, spinning: false, hubL: 0, hubR: 0 });
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

test('the hubs turn by the model, clockwise, the emptier spool the faster', () => {
  // At the start all the tape is on the left: the right hub is bare and
  // turns at HUB_TURN, the left under a pack twice the radius at half that.
  const m = new CassetteModel();
  assert.equal(m.step({ played: 0, playing: true }, 1000), true, 'it wants frames while they turn');
  assert.ok(Math.abs(m.view.hubR - HUB_TURN) < 1e-9);
  assert.ok(Math.abs(m.view.hubL - HUB_TURN / 2) < 1e-9);
  // At the end, the other way round.
  const e = new CassetteModel();
  e.step({ played: 1, playing: true }, 1000);
  assert.ok(Math.abs(e.view.hubL - HUB_TURN) < 1e-9);
  assert.ok(Math.abs(e.view.hubR - HUB_TURN / 2) < 1e-9);
  // Halfway, the same.
  const h = new CassetteModel();
  h.step({ played: 0.5, playing: true }, 250);
  assert.ok(Math.abs(h.view.hubL - h.view.hubR) < 1e-9);
});

test('stopped, the hubs stay where they got to, and the ticker parks', () => {
  const m = new CassetteModel();
  m.step({ played: 0.3, playing: true }, 500);
  const { hubL, hubR } = m.view;
  assert.ok(hubL > 0 && hubR > 0);
  assert.equal(m.step({ played: 0.3, playing: false }, 500), false);
  assert.deepEqual([m.view.hubL, m.view.hubR], [hubL, hubR]);
});

test('with reduced motion the hubs never turn, and nothing asks for a frame', () => {
  const m = new CassetteModel();
  assert.equal(m.step({ played: 0.3, playing: true }, Infinity), false);
  assert.deepEqual(m.view, { played: 0.3, spinning: true, hubL: 0, hubR: 0 });
});
