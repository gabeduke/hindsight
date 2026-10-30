// web/static/lib/ui/dolly.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dollyType, wireDolly } from './dolly.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('into Open dollies in, out of it dollies out, and anything else is neither', () => {
  assert.equal(dollyType('/takes.html', '/wave.html'), 'dolly-in');
  assert.equal(dollyType('/', '/wave.html'), 'dolly-in');
  assert.equal(dollyType('/wave.html', '/takes.html'), 'dolly-out');
  assert.equal(dollyType('/wave.html', '/wave.html'), null, 'a take to the next crossfades');
  assert.equal(dollyType('/tape.html', '/wave.html'), 'dolly-in', 'from the Studio too');
  assert.equal(dollyType('/takes.html', '/rig.html'), null);
  assert.equal(dollyType('/wave.html', '/rig.html'), null, 'the rig says no type: Open mustn’t name its half alone');
  assert.equal(dollyType('/guide.html', '/wave.html'), null);
  assert.equal(dollyType(null, '/wave.html'), null, 'a first load has nothing to move from');
});

test('each side of a move says its type: the page going on pageswap, the page arriving on pagereveal', () => {
  const on = {};
  const win = { location: { pathname: '/wave.html', href: 'http://pi/wave.html?file=x' }, navigation: { activation: { from: { url: 'http://pi/takes.html' } } }, addEventListener: (t, fn) => { on[t] = fn; } };
  wireDolly(win);
  const types = new Set();
  on.pagereveal({ viewTransition: { types } });
  assert.deepEqual([...types], ['dolly-in']);
  const out = new Set();
  on.pageswap({ activation: { entry: { url: 'http://pi/takes.html' } }, viewTransition: { types: out } });
  assert.deepEqual([...out], ['dolly-out']);
  on.pagereveal({ viewTransition: null }); // reduced motion, or no transition: nothing to say
});

test('Open and the shell load it in their <head>, render-blocking, and the shell caches it', () => {
  for (const page of ['../../wave.html', '../../shell.html']) {
    const head = read(page).split('</head>')[0];
    assert.match(head, /<script type="module" blocking="render" src="\/lib\/ui\/dolly\.js"><\/script>/, `${page} says its dolly before it paints`);
  }
  assert.match(read('../../sw.js'), /'\/lib\/ui\/dolly\.js'/);
  const css = read('../../css/rooms-motion.css');
  for (const t of ['dolly-in', 'dolly-out']) assert.match(css, new RegExp(`:active-view-transition-type\\(${t}\\)`), `rooms-motion.css draws ${t}`);
});
