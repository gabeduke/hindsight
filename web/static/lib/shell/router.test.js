// The shell's router (router.js): which room a URL is, which link clicks it
// takes over, and how it moves between rooms without loading the page --
// with stand-ins for the location, the history, the document and the window,
// and real views (view.js) on a stand-in document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { askedTake } from '../room/tap.js';
import { routeFor, linkTarget } from './router.js';

const ORIGIN = 'https://kit.example';
const at = (path) => `${ORIGIN}${path}`;
const route = (path, tapeOn = null) => routeFor(path, { base: at('/takes.html'), tapeOn });

test('/takes.html is the Listening Room, whatever the tape', () => {
  for (const tapeOn of [true, false, null]) {
    assert.deepEqual(route('/takes.html', tapeOn), { view: 'room', path: '/takes.html', href: '/takes.html' });
  }
});

test('/tape.html is the Studio, and Capture at / once the tape is known to be off', () => {
  assert.deepEqual(route('/tape.html', true), { view: 'studio', path: '/tape.html', href: '/tape.html' });
  assert.deepEqual(route('/tape.html', null), { view: 'studio', path: '/tape.html', href: '/tape.html' }, 'no answer yet: the page keeps its room');
  assert.deepEqual(route('/tape.html', false), { view: 'capture', path: '/', href: '/' });
});

test('/ and /index.html are the Studio at /tape.html with the tape on, and Capture at / without it', () => {
  for (const p of ['/', '/index.html']) {
    assert.deepEqual(route(p, true), { view: 'studio', path: '/tape.html', href: '/tape.html' }, `${p}, tape on`);
    assert.deepEqual(route(p, false), { view: 'capture', path: '/', href: '/' }, `${p}, tape off`);
    assert.deepEqual(route(p, null), { view: 'capture', path: '/', href: '/' }, `${p}, no answer yet`);
  }
});

test('a room’s query and hash go with it', () => {
  assert.deepEqual(route('/takes.html?sort=new#top'), { view: 'room', path: '/takes.html', href: '/takes.html?sort=new#top' });
  assert.equal(route('/?x=1', true).href, '/tape.html?x=1');
});

test('/takes.html?take=NAME is Open, loaded in full, as the room sends it today', () => {
  assert.deepEqual(route('/takes.html?take=jam_a.wav'), { load: '/wave.html?file=jam_a.wav' });
  assert.deepEqual(route('/takes.html?take=a%20b%26c.wav'), { load: askedTake({ search: '?take=a%20b%26c.wav' }) });
  assert.deepEqual(route('/takes.html?take='), { view: 'room', path: '/takes.html', href: '/takes.html?take=' }, 'no name: the room');
});

test('any other path, or another origin, is not the shell’s', () => {
  for (const p of ['/wave.html?file=jam_a.wav', '/rig.html', '/guide.html', '/api/takes', '/takes.html/', '/takes', '/objects.html']) {
    assert.equal(route(p), null, p);
  }
  assert.equal(routeFor('https://elsewhere.example/takes.html', { base: at('/') }), null);
  assert.equal(routeFor('mailto:someone@example.com', { base: at('/') }), null);
  assert.equal(routeFor('http://[', { base: at('/') }), null, 'an href that does not parse');
});

// A click on `a`, as the document's capture listener hears it.
function click(a, over = {}) {
  return { target: a, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
}
function link(href, attrs = {}) {
  const doc = fakeDoc();
  const a = doc.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const span = doc.createElement('span'); // the tab's label, which is what the finger lands on
  a.append(span);
  doc.body.append(a);
  return { a, span };
}

test('a plain click on a link to a same-origin page is the router’s to look at', () => {
  const { a, span } = link('/tape.html');
  assert.equal(linkTarget(click(a), at('/takes.html'))?.href, at('/tape.html'));
  assert.equal(linkTarget(click(span), at('/takes.html'))?.href, at('/tape.html'), 'a click on the label inside the link');
  assert.equal(linkTarget(click(link('/tape.html', { target: '_self' }).a), at('/takes.html'))?.href, at('/tape.html'));
});

test('a click that asks for a new tab, a window or a download is the browser’s', () => {
  const { a } = link('/tape.html');
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(linkTarget(click(a, { [key]: true }), at('/takes.html')), null, key);
  }
  assert.equal(linkTarget(click(a, { button: 1 }), at('/takes.html')), null, 'the middle button');
  assert.equal(linkTarget(click(link('/tape.html', { target: '_blank' }).a), at('/takes.html')), null, 'target=_blank');
  assert.equal(linkTarget(click(link('/takes.html', { download: '' }).a), at('/tape.html')), null, 'download');
});

test('a click something else already handled, another origin, or a jump within the page is the browser’s', () => {
  assert.equal(linkTarget(click(link('/tape.html').a, { defaultPrevented: true }), at('/takes.html')), null, 'help mode shows the tab’s tip');
  assert.equal(linkTarget(click(link('https://elsewhere.example/tape.html').a), at('/takes.html')), null);
  assert.equal(linkTarget(click(link('#settings').a), at('/takes.html')), null);
  assert.equal(linkTarget(click(link('/takes.html#settings').a), at('/takes.html')), null);
  const doc = fakeDoc();
  const p = doc.createElement('p');
  doc.body.append(p);
  assert.equal(linkTarget(click(p), at('/takes.html')), null, 'not a link at all');
});
