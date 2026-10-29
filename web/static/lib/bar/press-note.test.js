import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressNote, lightFor } from './press-note.js';

// Enough of an element for the note: hidden, dataset, classList, text.
function el() {
  const classes = new Set();
  return {
    hidden: true, dataset: {}, textContent: '',
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

test('a press shows its words over the display, in its role, for what is left of its second', () => {
  const env = timers();
  const n = { el: el(), words: el(), keys: { play: el(), rec: el() } };
  const note = pressNote(n, env);
  note.show(press({ ms: 960 }));
  assert.equal(n.el.hidden, false);
  assert.equal(n.words.textContent, 'PLAY');
  assert.equal(n.el.dataset.kb, 'play');
  assert.ok(n.keys.play.classList.contains('kb-lit'), '▶ is lit');
  assert.equal(n.keys.play.dataset.kb, 'play');
  assert.ok(!n.keys.rec.classList.contains('kb-lit'));
  env.advance(959);
  assert.equal(n.el.hidden, false, 'still there just before its second is up');
  env.advance(1);
  assert.equal(n.el.hidden, true, 'gone when it is');
  assert.ok(!n.keys.play.classList.contains('kb-lit'), '▶ put out with it');
  assert.equal(n.el.dataset.kb, undefined);
});

test('a refusal is said in its role and lights nothing; a new press replaces the one showing', () => {
  const env = timers();
  const n = { el: el(), words: el(), keys: { play: el(), rec: el() } };
  const note = pressNote(n, env);
  note.show(press());
  env.advance(500);
  note.show(press({ words: 'NO TRACK ARMED', role: 'refused', lit: [] }));
  assert.equal(n.words.textContent, 'NO TRACK ARMED');
  assert.equal(n.el.dataset.kb, 'refused');
  env.advance(500);
  assert.equal(n.el.hidden, false, 'the first press\'s second does not end the second\'s');
  assert.ok(!n.keys.play.classList.contains('kb-lit'), 'the first press\'s light is out at its own second');
  env.advance(500);
  assert.equal(n.el.hidden, true);
});

test('KEEP lights ●; a Mixer press carries its track, for its colour', () => {
  const env = timers();
  const n = { el: el(), words: el(), keys: { play: el(), rec: el() } };
  const note = pressNote(n, env);
  note.show(press({ words: 'KEPT 30 S', role: 'rec', lit: ['rec'] }));
  assert.ok(n.keys.rec.classList.contains('kb-lit'));
  note.show(press({ words: 'MUTE T3', role: 'mixer', lit: ['track'], track: 3 }));
  assert.equal(n.el.dataset.kbTrack, '3');
});

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
