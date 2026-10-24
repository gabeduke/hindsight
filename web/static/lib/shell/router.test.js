// The shell's router (router.js): which room a URL is, which link clicks it
// takes over, and how it moves between rooms without loading the page --
// with stand-ins for the location, the history, the document and the window,
// and real views (view.js) on a stand-in document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { askedTake } from '../room/tap.js';
import { routeFor, linkTarget, createRouter, viewTransition, KEEP_CLASSES } from './router.js';
import { createView } from './view.js';

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
  return { type: 'click', target: a, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
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

// ---------- the router ----------

const tick = () => new Promise((r) => setImmediate(r));

// One tab's session history, its location and its window: entries with
// their state (cloned, as the platform clones it), Back and Forward as
// popstate, and the loads the router asks for written down, not done.
function aBrowser(path = '/takes.html') {
  const entries = [{ url: new URL(path, ORIGIN), state: null }];
  let i = 0;
  const loads = [];
  const heard = new Map();
  const win = {
    scrollY: 0,
    scrollTo(_x, y) { this.scrollY = y; },
    addEventListener(t, fn) { if (!heard.has(t)) heard.set(t, new Set()); heard.get(t).add(fn); },
    removeEventListener(t, fn) { heard.get(t)?.delete(fn); },
    fire(t, e = {}) { for (const fn of [...(heard.get(t) || [])]) fn({ type: t, ...e }); },
    count(t) { return heard.get(t)?.size || 0; },
  };
  const url = () => entries[i].url;
  const location = {
    get href() { return url().href; },
    get origin() { return url().origin; },
    get pathname() { return url().pathname; },
    get search() { return url().search; },
    get hash() { return url().hash; },
    assign(u) { loads.push(['assign', String(u)]); },
    replace(u) { loads.push(['replace', String(u)]); },
    reload() { loads.push(['reload']); },
  };
  const history = {
    scrollRestoration: 'auto',
    get state() { return entries[i].state; },
    get length() { return entries.length; },
    pushState(s, _t, u) {
      entries.splice(i + 1, Infinity, { url: u == null ? url() : new URL(u, url()), state: structuredClone(s) });
      i++;
    },
    replaceState(s, _t, u) { entries[i] = { url: u == null ? url() : new URL(u, url()), state: structuredClone(s) }; },
    back() { i--; win.fire('popstate', { state: history.state }); },
    forward() { i++; win.fire('popstate', { state: history.state }); },
    states: () => entries.map((e) => e.state),
  };
  return { location, history, win, loads };
}

const ROOMS = {
  studio: { id: 'studio', title: 'Hindsight — tape', name: 'Studio', bodyClass: 'tape-page', help: 'tape' },
  room: { id: 'room', title: 'Takes — Hindsight', name: 'Listening Room', bodyClass: 'shelf-page', help: 'takes' },
  capture: { id: 'capture', title: 'Hindsight', name: 'Studio', bodyClass: 'main-page', help: 'main' },
};

// A shell on a stand-in document: the header's two tabs, a <section> for
// each room it holds (with a button in it, to hold focus), real views on
// them, and the router over the stand-in browser.
function aShell({ path = '/takes.html', tapeOn = null, hold = ['studio', 'room', 'capture'], rooms = {}, browser = aBrowser(path), transition = (update) => update(), chrome } = {}) {
  const doc = fakeDoc();
  doc.title = '';
  const log = [];
  const errors = [];
  const told = [];
  const header = doc.createElement('header');
  const tab = {};
  for (const [id, href] of [['studio', tapeOn === false ? '/' : '/tape.html'], ['room', '/takes.html']]) {
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    header.append(a);
    tab[id] = a;
  }
  doc.body.append(header);
  const inert = { timers: { setInterval: () => 0, clearInterval() {} }, clock: { add: () => () => {} } };
  const views = {};
  for (const id of hold) {
    const root = doc.createElement('section');
    root.id = `view-${id}`;
    const button = doc.createElement('button');
    root.append(button);
    doc.body.append(root);
    const def = {
      ...ROOMS[id],
      mount: () => {
        log.push(`mount ${id}`);
        return { show: ({ from }) => { log.push(`show ${id} from ${from}`); }, hide: () => { log.push(`hide ${id}`); } };
      },
      ...rooms[id],
    };
    views[id] = createView(def, { root, doc, slots: { header: { parent: header } }, ...inert, onError: (e) => errors.push(e) });
    views[id].button = button;
  }
  const s = {
    ...browser, doc, views, tab, log, errors, told, tapeOn,
    click(el, over = {}) { const e = click(el, over); doc.dispatchEvent(e); return e; },
    classes: () => String(doc.body.className).split(/\s+/).filter(Boolean).sort(),
  };
  s.router = createRouter({
    views: Object.values(views), location: browser.location, history: browser.history, doc, win: browser.win,
    tapeOn: () => s.tapeOn,
    transition,
    chrome: chrome ?? { setPath: (p) => told.push(['path', p]), setHelp: (h) => told.push(['help', h]), say: (t) => told.push(['say', t]) },
    onError: (e) => errors.push(e),
  });
  return s;
}

test('start boots the room the address names, marks its entry and turns off the browser’s scroll restoring', async () => {
  const s = aShell({ path: '/takes.html' });
  assert.equal(await s.router.start(), 'shown');
  assert.equal(s.router.shown(), 'room');
  assert.equal(s.views.room.shown, true);
  assert.equal(s.views.studio.root.hidden, true);
  assert.equal(s.doc.title, 'Takes — Hindsight');
  assert.deepEqual(s.classes(), ['shelf-page']);
  assert.deepEqual(s.history.state, { shell: 1, view: 'room' });
  assert.equal(s.history.scrollRestoration, 'manual');
  assert.deepEqual(s.told, [['path', '/takes.html'], ['help', 'takes']], 'nothing is said aloud at boot');
  assert.deepEqual(s.loads, []);
  assert.deepEqual(s.log, ['mount room', 'show room from null']);
  assert.equal(await s.router.start(), 'shown', 'started once');
  assert.equal(s.told.length, 2);
});

test('with the tape on, / boots the Studio and says /tape.html, with no second load', async () => {
  const s = aShell({ path: '/', tapeOn: true });
  assert.equal(await s.router.start(), 'shown');
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.location.pathname, '/tape.html');
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.loads, []);
});

test('a room the shell does not hold is loaded in full at boot: /tape.html with the tape off is Capture, at /', async () => {
  const s = aShell({ path: '/tape.html', tapeOn: false, hold: ['studio', 'room'] });
  assert.equal(await s.router.start(), 'load');
  assert.deepEqual(s.loads, [['replace', '/']]);
  assert.deepEqual(s.log, []);
});

test('/takes.html?take=NAME at boot goes straight to Open, and the room is not drawn first', async () => {
  const s = aShell({ path: '/takes.html?take=jam_a.wav' });
  assert.equal(await s.router.start(), 'load');
  assert.deepEqual(s.loads, [['replace', '/wave.html?file=jam_a.wav']]);
  assert.deepEqual(s.log, []);
});

test('an address the shell has no room for boots nothing and loads nothing', async () => {
  const s = aShell({ path: '/rig.html' });
  assert.equal(await s.router.start(), 'none');
  const t = aShell({ path: '/takes.html', hold: ['studio'] });
  assert.equal(await t.router.start(), 'none');
  assert.deepEqual([...s.loads, ...t.loads], []);
  assert.equal(s.errors.length + t.errors.length, 2);
});

test('a tap on a tab switches rooms: one new entry, no load', async () => {
  const s = aShell();
  await s.router.start();
  const e = s.click(s.tab.studio);
  assert.equal(e.defaultPrevented, true);
  assert.equal(await s.router.idle(), 'switched');
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.location.pathname, '/tape.html');
  assert.equal(s.history.length, 2);
  assert.deepEqual(s.history.state, { shell: 1, view: 'studio', scroll: 0 });
  assert.deepEqual(s.loads, []);
  assert.deepEqual(s.log, ['mount room', 'show room from null', 'hide room', 'mount studio', 'show studio from room']);
  assert.equal(s.views.room.root.hidden, true);
  assert.equal(s.views.studio.root.hidden, false);
  assert.equal(s.doc.title, 'Hindsight — tape');
  assert.deepEqual(s.told.slice(2), [['path', '/tape.html'], ['help', 'tape'], ['say', 'Studio']]);
});

test('a click the router does not take over is the browser’s: a new tab, a page, a room this shell does not hold', async () => {
  const one = aShell({ hold: ['room'] });
  await one.router.start();
  assert.equal(one.click(one.tab.studio).defaultPrevented, false, 'the Studio is not in this shell: tape.html loads');
  const s = aShell();
  await s.router.start();
  assert.equal(s.click(s.tab.studio, { metaKey: true }).defaultPrevented, false, 'a new tab');
  const take = s.doc.createElement('a');
  take.setAttribute('href', '/wave.html?file=jam_a.wav');
  s.views.room.root.append(take);
  assert.equal(s.click(take).defaultPrevented, false, 'the take page');
  await s.router.idle();
  assert.equal(s.router.shown(), 'room');
  assert.equal(s.history.length, 1);
});

test('a ?take= link goes straight to Open: one load, not the room and then Open', async () => {
  const s = aShell({ path: '/tape.html' });
  await s.router.start();
  const a = s.doc.createElement('a');
  a.setAttribute('href', '/takes.html?take=jam_a.wav');
  s.views.studio.root.append(a);
  assert.equal(s.click(a).defaultPrevented, true);
  await s.router.idle();
  assert.deepEqual(s.loads, [['assign', '/wave.html?file=jam_a.wav']]);
  assert.equal(s.router.shown(), 'studio');
});

test('Back and Forward move between rooms, each mounted once', async () => {
  const s = aShell();
  await s.router.start();
  await s.router.go('/tape.html');
  s.history.back();
  assert.equal(await s.router.idle(), 'switched');
  assert.equal(s.router.shown(), 'room');
  assert.equal(s.views.room.root.hidden, false);
  s.history.forward();
  await s.router.idle();
  assert.equal(s.router.shown(), 'studio');
  assert.deepEqual(s.log.filter((l) => l.startsWith('mount')), ['mount room', 'mount studio']);
  assert.deepEqual(s.loads, []);
});

test('Back onto an entry of the same room is its owner’s: the player and the cassette sheet close first', async () => {
  const s = aShell();
  await s.router.start();
  await s.router.go('/tape.html');
  // The phone's player opens over the Studio (bar/player.js): its own entry.
  s.history.pushState({ ...s.history.state, player: 1 }, '');
  let seen = s.log.length;
  s.history.back();
  assert.equal(await s.router.idle(), 'same');
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.log.length, seen, 'nothing hidden or shown: the player closes itself');
  await s.router.go('/takes.html');
  // The cassette sheet pushes {cassette} alone, without the shell's state.
  s.history.pushState({ cassette: 'jam_a.wav' }, '');
  seen = s.log.length;
  s.history.back();
  assert.equal(await s.router.idle(), 'same');
  assert.equal(s.log.length, seen);
  s.history.back();
  await s.router.idle();
  assert.equal(s.router.shown(), 'studio', 'the next Back is the router’s');
});

test('a switch closes what is open over the room first: on a tap before its entry is pushed, on Back as it starts', async () => {
  const told = [];
  let s = null;
  s = aShell({ chrome: { beforeSwitch: () => { told.push(['before', s.history.length, s.router.shown()]); } } });
  await s.router.start();
  s.click(s.tab.studio);
  await s.router.idle();
  assert.deepEqual(told[0], ['before', 1, 'room'], 'the tap: before the new entry, in the room it leaves');
  told.length = 0;
  s.history.back();
  await s.router.idle();
  assert.equal(s.router.shown(), 'room');
  assert.deepEqual(told, [['before', 2, 'studio']], 'Back: as the switch starts, before the room is left');
  told.length = 0;
  await s.router.go('/takes.html');
  s.history.pushState({ ...s.history.state, player: 1 }, '');
  s.history.back();
  await s.router.idle();
  assert.deepEqual(told, [], 'not for the room that is shown: nothing is closed by a Back that stays');
});

test('a tap’s switch waits for the stack to take its own entry back before it pushes the room’s', async () => {
  let release;
  const s = aShell({ chrome: { beforeSwitch: () => new Promise((r) => { release = r; }) } });
  await s.router.start();
  s.click(s.tab.studio);
  await tick();
  assert.equal(s.history.length, 1, 'no entry yet');
  assert.equal(s.router.shown(), 'room');
  release();
  assert.equal(await s.router.idle(), 'switched');
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.history.length, 2);
  const t = aShell({ chrome: { beforeSwitch: () => Promise.reject(new Error('the menu would not close')) } });
  await t.router.start();
  t.click(t.tab.studio);
  assert.equal(await t.router.idle(), 'switched', 'a hook that fails costs a report, not the switch');
  assert.deepEqual(t.errors.map((e) => e.message), ['the menu would not close']);
});

test('a tap’s switch writes over the stack’s own entry when nothing holds it, so one Back is the room before', async () => {
  const s = aShell({ chrome: { beforeSwitch: () => 'replace' } });
  await s.router.start();
  s.history.pushState({ ...s.history.state, layer: 'p.1' }, ''); // a selection's, in Safari
  s.click(s.tab.studio);
  assert.equal(await s.router.idle(), 'switched');
  assert.equal(s.history.length, 2, 'over the stack’s entry, not on top of it');
  assert.deepEqual(s.history.state, { shell: 1, view: 'studio', scroll: 0 });
  s.history.back();
  await s.router.idle();
  assert.equal(s.router.shown(), 'room');
});

test('Back onto an entry the shell cannot show here loads it', async () => {
  const s = aShell({ hold: ['room'] });
  await s.router.start();
  s.history.pushState(null, '', '/rig.html'); // something else pushed it
  s.win.fire('popstate');
  await s.router.idle();
  s.history.replaceState(null, '', '/tape.html');
  s.win.fire('popstate');
  await s.router.idle();
  s.history.replaceState(null, '', '/takes.html?take=jam_a.wav');
  s.win.fire('popstate');
  await s.router.idle();
  assert.deepEqual(s.loads, [['reload'], ['replace', '/tape.html'], ['replace', '/wave.html?file=jam_a.wav']]);
});

test('an entry for / is the Studio once the tape is known to be on, and says /tape.html', async () => {
  const s = aShell({ path: '/', tapeOn: false });
  await s.router.start();
  assert.equal(s.router.shown(), 'capture');
  await s.router.go('/takes.html');
  s.tapeOn = true; // nav.js has heard from the Pi since
  s.history.back();
  await s.router.idle();
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.location.pathname, '/tape.html');
  assert.deepEqual(s.loads, []);
});

test('each room keeps its own body classes through a switch; the shell’s own stay on', async () => {
  const s = aShell();
  await s.router.start();
  s.doc.body.classList.add('room-on', 'selecting', 'help-mode', 'player-open');
  await s.router.go('/tape.html');
  assert.deepEqual(s.classes(), ['help-mode', 'player-open', 'tape-page']);
  s.doc.body.classList.add('tracks-fold');
  await s.router.go('/takes.html');
  assert.deepEqual(s.classes(), ['help-mode', 'player-open', 'room-on', 'selecting', 'shelf-page']);
  await s.router.go('/tape.html');
  assert.deepEqual(s.classes(), ['help-mode', 'player-open', 'tape-page', 'tracks-fold']);
  assert.deepEqual([...KEEP_CLASSES].sort(), ['help-mode', 'player-open']);
});

test('a class the room’s own hide takes off stays off when the room comes back', async () => {
  const s = aShell({ rooms: { room: { mount: () => ({ hide: () => { s.doc.body.classList.remove('cassette-open'); } }) } } });
  await s.router.start();
  s.doc.body.classList.add('cassette-open'); // the cassette sheet is up
  await s.router.go('/tape.html');
  await s.router.go('/takes.html');
  assert.deepEqual(s.classes(), ['shelf-page'], 'the sheet was closed on the way out: no sheet’s class without the sheet');
});

test('each room keeps its own scroll, and the room left writes its scroll into its entry', async () => {
  const s = aShell();
  await s.router.start();
  s.win.scrollY = 500;
  await s.router.go('/tape.html');
  assert.equal(s.win.scrollY, 0, 'the Studio’s first visit: the top');
  assert.equal(s.history.states()[0].scroll, 500);
  s.win.scrollY = 300;
  await s.router.go('/takes.html');
  assert.equal(s.win.scrollY, 500);
  await s.router.go('/tape.html');
  assert.equal(s.win.scrollY, 300);
  s.win.scrollY = 700;
  s.history.back();
  await s.router.idle();
  assert.equal(s.win.scrollY, 500);
  s.history.forward();
  await s.router.idle();
  assert.equal(s.win.scrollY, 700, 'the room’s own, not the 300 its entry was pushed with');
});

test('a reload lands where the room was: pagehide writes its scroll and start puts it back', async () => {
  const browser = aBrowser('/takes.html');
  const s = aShell({ browser });
  await s.router.start();
  browser.win.scrollY = 420;
  browser.win.fire('pagehide');
  assert.equal(browser.history.state.scroll, 420);
  s.router.stop();
  browser.win.scrollY = 0; // the reload: the same entry, a new document
  const again = aShell({ browser });
  await again.router.start();
  assert.equal(browser.win.scrollY, 420);
});

test('focus in the room left moves to the room arrived in; a tab that was tapped keeps it', async () => {
  const s = aShell();
  await s.router.start();
  const asked = [];
  const root = s.views.studio.root;
  root.focus = (o) => { asked.push(o); s.doc.activeElement = root; };
  s.views.room.button.focus();
  await s.router.go('/tape.html');
  assert.equal(s.doc.activeElement, root);
  assert.deepEqual(asked, [{ preventScroll: true }], 'no jump; and never a text field, so no keyboard pops up');
  s.tab.room.focus();
  s.click(s.tab.room);
  await s.router.idle();
  assert.equal(s.doc.activeElement, s.tab.room);
});

test('focus on a part of the room left that leaves the page with it moves too', async () => {
  let select;
  const s = aShell({ rooms: { room: { mount: (ctx) => { select = ctx.root.ownerDocument.createElement('button'); ctx.headerSlot.add(select); return {}; } } } });
  await s.router.start();
  select.focus(); // the room's Select, in its part of the header
  await s.router.go('/tape.html');
  assert.equal(select.isConnected, false);
  assert.equal(s.doc.activeElement, s.views.studio.root);
});

test('a room that fails to mount costs a load of its address, not a dead history entry', async () => {
  const s = aShell({ rooms: { studio: { mount: () => { throw new Error('no #lanes'); } } } });
  await s.router.start();
  assert.equal(s.click(s.tab.studio).defaultPrevented, true);
  assert.equal(await s.router.idle(), 'failed');
  assert.deepEqual(s.loads, [['replace', at('/tape.html')]]);
  assert.equal(s.history.length, 2, 'the load replaces the entry the switch pushed');
  assert.deepEqual(s.errors.map((e) => e.message), ['no #lanes']);
});

test('a room whose show throws on a later visit costs a load too', async () => {
  let visits = 0;
  const s = aShell({ rooms: { studio: { mount: () => ({ show: () => { if (++visits > 1) throw new Error('stale lanes'); } }) } } });
  await s.router.start();
  await s.router.go('/tape.html');
  await s.router.go('/takes.html');
  assert.equal(await s.router.go('/tape.html'), 'failed');
  assert.deepEqual(s.loads, [['replace', at('/tape.html')]]);
});

test('a room that fails as the page boots is reported, and never reloaded', async () => {
  const s = aShell({ rooms: { room: { mount: () => { throw new Error('no #takes'); } } } });
  assert.equal(await s.router.start(), 'failed');
  assert.deepEqual(s.loads, []);
  assert.deepEqual(s.errors.map((e) => e.message), ['no #takes']);
  assert.equal(s.click(s.tab.studio).defaultPrevented, false, 'the tabs load pages, as today');
});

test('go to a page, or before start, is a load; go to the room shown is nothing', async () => {
  const s = aShell();
  assert.equal(await s.router.go('/tape.html'), 'load', 'before start');
  assert.deepEqual(s.loads, [['assign', '/tape.html']]);
  await s.router.start();
  assert.equal(await s.router.go('/wave.html?file=jam_a.wav'), 'load');
  assert.equal(await s.router.go('/rig.html', { replace: true }), 'load');
  assert.deepEqual(s.loads.slice(1), [['assign', '/wave.html?file=jam_a.wav'], ['replace', '/rig.html']]);
  assert.equal(await s.router.go('/takes.html'), 'same');
  assert.equal(s.history.length, 1);
  assert.equal(await s.router.go('/', { replace: true }), 'switched', 'Capture, with the tape off');
  assert.equal(s.router.shown(), 'capture');
  assert.equal(s.history.length, 1, 'replaced, not pushed');
});

test('taps faster than a switch end in the room last tapped', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const s = aShell({ rooms: { studio: { mount: async () => { s.log.push('mount studio'); await slow; return {}; } } } });
  await s.router.start();
  s.click(s.tab.studio);
  await tick(); // the Studio is still mounting
  s.click(s.tab.room);
  release();
  await s.router.idle();
  assert.equal(s.router.shown(), 'room');
  assert.equal(s.location.pathname, '/takes.html');
  assert.equal(s.views.studio.root.hidden, true);
  assert.equal(s.views.room.root.hidden, false);
  assert.deepEqual(s.log.filter((l) => l.startsWith('mount')), ['mount room', 'mount studio']);
});

test('a switch is drawn as a view transition where there is one and motion is welcome', async () => {
  const doc = { used: 0, startViewTransition(update) { this.used++; return { updateCallbackDone: Promise.resolve().then(update) }; } };
  const calm = { matchMedia: () => ({ matches: false }) };
  const still = { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) };
  let ran = 0;
  await viewTransition(doc, calm)(async () => { ran++; });
  assert.equal(doc.used, 1);
  await viewTransition(doc, still)(async () => { ran++; });
  assert.equal(doc.used, 1, 'less motion: no transition');
  await viewTransition({}, calm)(async () => { ran++; });
  assert.equal(ran, 3, 'the swap runs either way');
  await assert.rejects(viewTransition(doc, calm)(async () => { throw new Error('mount'); }), /mount/, 'its error comes back, for the fallback');
});

test('the router draws a switch, and not the boot, with the transition it is given', async () => {
  const s = aShell({ transition: async (update) => { s.log.push('draw'); await update(); s.log.push('drawn'); } });
  await s.router.start();
  await s.router.go('/tape.html');
  assert.deepEqual(s.log, ['mount room', 'show room from null', 'draw', 'hide room', 'mount studio', 'show studio from room', 'drawn']);
});

test('a tab bar that throws costs a report, not the switch', async () => {
  const s = aShell({ chrome: { setPath: () => { throw new Error('nav'); } } });
  await s.router.start();
  assert.equal(await s.router.go('/tape.html'), 'switched');
  assert.deepEqual(s.loads, []);
  assert.deepEqual(s.errors.map((e) => e.message), ['nav', 'nav']);
});

test('stop hands links and Back to the browser again', async () => {
  const s = aShell();
  await s.router.start();
  s.router.stop();
  assert.equal(s.click(s.tab.studio).defaultPrevented, false);
  assert.equal(s.win.count('popstate'), 0);
  assert.equal(s.win.count('pagehide'), 0);
  assert.equal(await s.router.go('/tape.html'), 'load');
});
