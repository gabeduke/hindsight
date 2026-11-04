// What a press on the keyboard lights (press-light.js): a key, or a track's head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightFor, lightTrackHead } from './press-light.js';

// Enough of an element for the note: hidden, dataset, classList, text.
function el() {
  const classes = new Set();
  return {
    hidden: false, dataset: {}, textContent: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
  };
}
function timers() {
  let t = 0, id = 0;
  const due = new Map();
  return {
    setTimeout: (fn, ms) => { due.set(++id, { fn, at: t + ms }); return id; },
    clearTimeout: (i) => { due.delete(i); },
    advance(ms) {
      t += ms;
      for (const [i, d] of [...due]) if (d.at <= t) { due.delete(i); d.fn(); }
    },
  };
}
const press = (over = {}) => ({ words: 'PLAY', role: 'play', lit: ['play'], track: 0, ms: 1000, ...over });

test('lightFor lights a track\'s head for the second, a second press starting it again', () => {
  const env = timers();
  const head = el();
  lightFor([head, null], press({ role: 'verb', lit: ['track'], track: 2 }), env);
  assert.ok(head.classList.contains('kb-lit'));
  assert.equal(head.dataset.kbTrack, '2');
  env.advance(600);
  lightFor([head], press({ role: 'verb', lit: ['track'], track: 2 }), env);
  env.advance(600);
  assert.ok(head.classList.contains('kb-lit'), 'the first light\'s timer was put by');
  env.advance(400);
  assert.ok(!head.classList.contains('kb-lit'));
  assert.equal(head.dataset.kbTrack, undefined);
});

test('the Studio lights the head of the track a CATCH or DROP put a clip on, and no other', () => {
  const env = timers();
  const rows = [1, 2, 3, 4].map((n) => {
    const head = el();
    return { n, head, row: { querySelector: (q) => (q === '.tt-head' ? head : null) } };
  });
  const lit = () => rows.filter((r) => r.head.classList.contains('kb-lit')).map((r) => r.n);
  assert.equal(lightTrackHead(rows, press({ words: 'DROPPED ON T2', role: 'verb', lit: ['track'], track: 2 }), env), rows[1].head);
  assert.deepEqual(lit(), [2]);
  env.advance(1000);
  assert.deepEqual(lit(), []);
  assert.equal(lightTrackHead(rows, press({ words: 'PLAY' }), env), null, 'PLAY lights no head');
  assert.equal(lightTrackHead(rows, press({ words: 'X', role: 'verb', lit: ['track'], track: 7 }), env), null, 'a track the tape has not got');
  assert.deepEqual(lit(), []);
});
