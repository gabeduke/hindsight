// The shell's router (router.js): which room a URL is, which link clicks it
// takes over, and how it moves between rooms without loading the page --
// with stand-ins for the location, the history, the document and the window,
// and real views (view.js) on a stand-in document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { askedTake } from '../room/tap.js';
import { routeFor, linkTarget, createRouter, viewTransition, turnOf, KEEP_CLASSES } from './router.js';
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
function aShell({ path = '/takes.html', tapeOn = null, hold = ['studio', 'room', 'capture'], rooms = {}, browser = aBrowser(path), transition = (update) => update(), chrome, idle = (fn) => fn() } = {}) {
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
    idle,
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

test('Back onto an entry of the same room is its owner’s: what is open on the stack closes first', async () => {
  const s = aShell();
  await s.router.start();
  await s.router.go('/tape.html');
  // The phone's player opens over the Studio: without CloseWatcher, the
  // stack's entry (lib/ui/layers.js), the room's state and its own key.
  s.history.pushState({ ...s.history.state, layer: 'p.1' }, '');
  let seen = s.log.length;
  s.history.back();
  assert.equal(await s.router.idle(), 'same');
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.log.length, seen, 'nothing hidden or shown: the player closes itself');
  await s.router.go('/takes.html');
  // One pushed alone, without the shell's state (an older version's).
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
  s.history.pushState({ ...s.history.state, layer: 'p.1' }, ''); // the stack's own entry
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

// A document with View Transitions: each transition it starts is kept, its
// update run on the next turn of the loop (as the browser runs it after
// the old frame is captured), its ready and finished settled by the test.
function aVtDoc(doc = fakeDoc()) {
  doc.started = [];
  doc.startViewTransition = (update) => {
    let ready, finish;
    const t = {
      update,
      skipped: 0,
      ready: new Promise((r) => { ready = r; }),
      finished: new Promise((r) => { finish = r; }),
      skipTransition() { this.skipped++; ready(); finish(); },
      // What the html element said as the update ran.
      during: null,
    };
    t.go = () => { ready(); };
    t.end = () => { ready(); finish(); };
    t.updateCallbackDone = Promise.resolve().then(() => {
      t.during = { turn: doc.documentElement.getAttribute('data-turn'), arriving: doc.documentElement.getAttribute('data-arriving') };
      return update();
    });
    doc.started.push(t);
    return t;
  };
  return doc;
}
const calm = { matchMedia: () => ({ matches: false }) };
const still = { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) };
const attrs = (doc) => ({ turn: doc.documentElement.getAttribute('data-turn'), arriving: doc.documentElement.getAttribute('data-arriving') });

test('the rooms are two walls, the Studio’s on the left: a switch between them turns the camera, one along a wall fades', () => {
  assert.equal(turnOf('studio', 'room'), 'right');
  assert.equal(turnOf('capture', 'room'), 'right', 'Capture is the Studio’s tab with the tape off');
  assert.equal(turnOf('room', 'studio'), 'left');
  assert.equal(turnOf('room', 'capture'), 'left');
  assert.equal(turnOf('studio', 'capture'), 'fade');
  assert.equal(turnOf(null, 'room'), 'fade', 'no room before it: the boot');
  assert.equal(turnOf('studio', 'rig'), 'fade');
});

test('a switch is a view transition where there is one: the camera turns, and with less motion it fades', async () => {
  const doc = aVtDoc();
  let ran = 0;
  const t = viewTransition(doc, calm)(async () => { ran++; }, { from: 'studio', to: 'room' });
  assert.deepEqual(attrs(doc), { turn: 'right', arriving: 'room' }, 'said before the transition starts, so its first frame is drawn so');
  await t.updateCallbackDone;
  assert.equal(ran, 1);
  doc.started[0].end();
  await t.finished;
  await tick();
  assert.deepEqual(attrs(doc), { turn: null, arriving: null }, 'and gone when it has finished');

  const u = viewTransition(doc, still)(async () => { ran++; }, { from: 'room', to: 'studio' });
  assert.equal(doc.started.length, 2, 'less motion is still a transition: a crossfade');
  assert.deepEqual(attrs(doc), { turn: 'fade', arriving: null }, 'nothing travels, and no room makes an entrance');
  await u.updateCallbackDone;
  doc.started[1].end();
  await tick();
  assert.deepEqual(attrs(doc), { turn: null, arriving: null });

  const bare = fakeDoc();
  const v = viewTransition(bare, calm)(async () => { ran++; }, { from: 'studio', to: 'room' });
  await v.updateCallbackDone;
  await v.ready;
  await v.finished;
  assert.equal(ran, 3, 'without View Transitions the swap runs at once');
  assert.deepEqual(attrs(bare), { turn: null, arriving: null }, 'and says nothing');
  await assert.rejects(viewTransition(aVtDoc(), calm)(async () => { throw new Error('mount'); }).updateCallbackDone, /mount/, 'its error comes back, for the fallback');
});

test('a turn started while another is drawn keeps its own attributes when the first one finishes', async () => {
  const doc = aVtDoc();
  const draw = viewTransition(doc, calm);
  draw(async () => {}, { from: 'studio', to: 'room' });
  draw(async () => {}, { from: 'room', to: 'studio' });
  doc.started[0].end();
  await tick();
  assert.deepEqual(attrs(doc), { turn: 'left', arriving: 'studio' }, 'the second turn’s, still');
  doc.started[1].end();
  await tick();
  assert.deepEqual(attrs(doc), { turn: null, arriving: null });
});

test('the entrance contract: data-arriving names the room a turn arrives in, from its start until it has finished', async () => {
  const doc = aVtDoc();
  const s = aShell({ path: '/tape.html', transition: viewTransition(doc, calm) });
  // The shell's views live on another stand-in document; the html element
  // that says the turn is this one's.
  await s.router.start();
  const going = s.router.go('/takes.html');
  await tick();
  const t = doc.started[0];
  await t.updateCallbackDone;
  assert.deepEqual(t.during, { turn: 'right', arriving: 'room' }, 'set before the update, so the room can make its entrance in the turn');
  assert.deepEqual(attrs(doc), { turn: 'right', arriving: 'room' }, 'and kept while the turn plays');
  t.end();
  await going;
  await tick();
  assert.deepEqual(attrs(doc), { turn: null, arriving: null }, 'gone once it has finished');

  const back = s.router.go('/tape.html');
  await tick();
  await doc.started[1].updateCallbackDone;
  assert.deepEqual(doc.started[1].during, { turn: 'left', arriving: 'studio' }, 'the other way, the Studio');
  doc.started[1].end();
  await back;
});

test('a switch only flips the rooms in its update; the room arrived in redraws once the turn is over', async () => {
  const doc = aVtDoc();
  const s = aShell({ transition: viewTransition(doc, calm) });
  await s.router.start();
  s.log.length = 0;
  const going = s.router.go('/tape.html');
  await tick();
  const t = doc.started[0];
  await t.updateCallbackDone;
  await tick();
  assert.deepEqual(s.log, ['hide room', 'mount studio'], 'in the update: the room left hidden, the Studio mounted (a first visit not prewarmed); its show waits');
  assert.equal(s.views.studio.root.hidden, false, 'the Studio is in the page for the turn’s new picture');
  assert.equal(s.router.shown(), 'studio');
  t.go(); // the turn starts
  await tick();
  await tick();
  assert.deepEqual(s.log, ['hide room', 'mount studio'], 'nothing on the page while it turns');
  t.end(); // and is over
  await going;
  assert.deepEqual(s.log, ['hide room', 'mount studio', 'show studio from room'], 'then its own show, redraw and polls');
  assert.equal(s.doc.title, 'Hindsight — tape');
});

test('the router draws a switch, and not the boot, with the transition it is given', async () => {
  const s = aShell({ transition: async (update) => { s.log.push('draw'); await update(); s.log.push('drawn'); } });
  await s.router.start();
  await s.router.go('/tape.html');
  assert.deepEqual(s.log, ['mount room', 'show room from null', 'draw', 'hide room', 'mount studio', 'drawn', 'show studio from room']);
});

test('a tab tapped while a switch is drawn skips its turn, and the rooms end where the last tap asked', async () => {
  const doc = aVtDoc();
  const s = aShell({ path: '/tape.html', transition: viewTransition(doc, calm) });
  await s.router.start();
  s.click(s.tab.room);
  await tick();
  await doc.started[0].updateCallbackDone;
  assert.equal(doc.started[0].skipped, 0);
  s.click(s.tab.studio); // mid-turn
  assert.equal(doc.started[0].skipped, 1, 'the turn under way gives way at once');
  await tick();
  await tick();
  doc.started.at(-1).end();
  await s.router.idle();
  assert.equal(s.router.shown(), 'studio');
  assert.equal(s.location.pathname, '/tape.html');
  assert.equal(s.views.room.root.hidden, true);
  assert.equal(s.views.studio.root.hidden, false);
  assert.equal(s.history.length, 3, 'each tap its entry: Back goes to the room, as the taps did');
});

// A shell whose switch is drawn as a View Transition held where the test
// says: its update waits for swap(), as a browser's waits for the old
// picture to be captured. The desk -- a header (.appbar) with the tabs, a
// bar (#np) with ▶ and a key the swap takes away -- and the press and the
// click a finger or a mouse makes, through the window's capture.
async function aTurningShell() {
  const s = aShell({ path: '/tape.html' });
  aVtDoc(s.doc);
  const start = s.doc.startViewTransition;
  s.doc.startViewTransition = (update) => {
    let swap;
    const gate = new Promise((r) => { swap = r; });
    const t = start(async () => { await gate; return update(); });
    t.swap = swap;
    // On the screen until it is skipped or over.
    t.live = true;
    const skip = t.skipTransition.bind(t);
    const end = t.end;
    t.skipTransition = () => { t.live = false; skip(); };
    t.end = () => { t.live = false; end(); };
    return t;
  };
  s.router.stop();
  const r = createRouter({
    views: Object.values(s.views), location: s.location, history: s.history, doc: s.doc, win: s.win,
    transition: viewTransition(s.doc, calm), idle: (fn) => fn(), onError: (e) => s.errors.push(e),
  });
  s.win.MouseEvent = class { constructor(type, init) { Object.assign(this, init); this.type = type; } };
  await r.start();
  const header = s.tab.room.parentElement;
  header.className = 'appbar';
  const np = s.doc.createElement('div');
  np.id = 'np';
  const key = (id) => {
    const b = s.doc.createElement('button');
    b.id = id;
    b.clicks = [];
    b.addEventListener('click', (e) => b.clicks.push([e.clientX, e.clientY]));
    np.append(b);
    return b;
  };
  const play = key('np-play');
  const dock = key('room-dock-key'); // a key of the bar the swap takes away
  s.doc.body.append(np);
  // What each room's button heard: a click handed on to the room is a bug.
  for (const v of Object.values(s.views)) {
    v.button.clicks = [];
    v.button.addEventListener('click', (e) => v.button.clicks.push([e.clientX, e.clientY]));
  }
  // What is laid out under the point, as the page is now; while a
  // transition is on the screen, Chromium answers <html> for every point.
  s.under = null;
  s.doc.elementFromPoint = () => (s.doc.started.some((t) => t.live) ? s.doc.documentElement : s.under);
  const html = s.doc.documentElement;
  // A press and its click, at (40, 700) unless said otherwise: each answers
  // what the router did with it.
  const fire = (type, target, over = {}) => {
    const e = { target, clientX: 40, clientY: 700, detail: 1, stopped: false, defaultPrevented: false, ...over };
    e.stopImmediatePropagation = () => { e.stopped = true; };
    e.preventDefault = () => { e.defaultPrevented = true; };
    s.win.fire(type, e);
    return e;
  };
  const turn = async (to) => {
    const going = r.go(to);
    await tick();
    return { t: s.doc.started.at(-1), going };
  };
  return { s, r, html, play, dock, fire, turn };
}

test('a press while a switch is drawn ends the turn at once, and its click on <html> goes to the desk’s key under the finger', async () => {
  const { s, r, html, play, fire, turn } = await aTurningShell();
  const { t } = await turn('/takes.html');
  t.swap();
  await t.updateCallbackDone;
  s.under = play;
  fire('pointerdown', html);
  assert.equal(t.skipped, 1, 'the turn ends');
  const click = fire('click', html);
  assert.ok(click.stopped && click.defaultPrevented, 'the click on <html> goes no further');
  await tick();
  assert.deepEqual(play.clicks, [[40, 700]], 'and ▶ has it, where it was pressed');
  fire('click', html);
  await tick();
  assert.equal(play.clicks.length, 1, 'once');
  await r.idle();
  fire('pointerdown', html);
  const later = fire('click', html);
  await tick();
  assert.ok(!later.stopped && !later.defaultPrevented && play.clicks.length === 1, 'with no switch drawn, a press on the page is the page’s');
  r.stop();
});

test('a finger’s click that the browser puts through the turn lands as it is on the desk, and goes nowhere in the room', async () => {
  const { s, r, html, play, fire, turn } = await aTurningShell();
  const { t } = await turn('/takes.html');
  t.swap();
  await t.updateCallbackDone;
  // Through the overlay (pointer-events: none), on ▶ itself.
  s.under = play;
  fire('pointerdown', html);
  const onPlay = fire('click', play);
  assert.ok(!onPlay.stopped && !onPlay.defaultPrevented, 'a tap on ▶ is ▶’s, untouched');
  // On the room arrived in, laid out at rest under a picture still turning.
  const spine = s.views.room.button;
  s.under = spine;
  const before = s.doc.started.length;
  await turn('/tape.html');
  const t2 = s.doc.started.at(-1);
  assert.equal(s.doc.started.length, before + 1);
  t2.swap();
  await t2.updateCallbackDone;
  fire('pointerdown', html, { clientX: 780, clientY: 380 });
  assert.equal(t2.skipped, 1, 'a press anywhere ends the turn');
  const onRoom = fire('click', spine, { clientX: 780, clientY: 380 });
  assert.ok(onRoom.stopped && onRoom.defaultPrevented, 'a tap on the room under the turn does nothing: nothing there was where it looked');
  await r.idle();
  // With a mouse, its click goes to <html>: it is not handed on to the room either.
  const tm = (await turn('/takes.html')).t;
  tm.swap();
  await tm.updateCallbackDone;
  fire('pointerdown', html, { clientX: 780, clientY: 380 });
  const mouse = fire('click', html, { clientX: 780, clientY: 380 });
  await tick();
  assert.ok(mouse.stopped && spine.clicks.length === 0, 'a click on the room under the turn reaches nothing in it');
  await r.idle();
  // A browser that hit-tests the press itself (Safari): the same.
  const n = s.doc.started.length;
  const t3 = (await turn('/tape.html')).t;
  assert.equal(s.doc.started.length, n + 1, 'a switch of its own');
  t3.swap();
  await t3.updateCallbackDone;
  fire('pointerdown', spine, { clientX: 780, clientY: 380 });
  assert.equal(t3.skipped, 1);
  const safari = fire('click', spine, { clientX: 780, clientY: 380 });
  assert.ok(safari.stopped && safari.defaultPrevented);
  await r.idle();
  r.stop();
});

test('a press before the swap is not handed on until the swap is done, and only to a key that was under it before and is after', async () => {
  const { s, r, html, play, dock, fire, turn } = await aTurningShell();
  // The room left is what is laid out until the update has run: a press on
  // its picture (where the Studio's ▶ will be) is on the room, not the desk.
  const { t } = await turn('/takes.html');
  s.under = s.views.studio.button;
  fire('pointerdown', html);
  const off = fire('click', html);
  assert.ok(off.stopped && off.defaultPrevented);
  s.under = play;
  t.swap();
  await t.updateCallbackDone;
  await tick();
  assert.equal(play.clicks.length, 0, 'pressed on the room: nothing, though ▶ is there after the swap');
  assert.equal(s.views.studio.button.clicks.length, 0, 'and nothing in the room left');
  await r.idle();

  // On ▶, which is on the desk before the swap and after it.
  const u = (await turn('/tape.html')).t;
  s.under = play;
  fire('pointerdown', html);
  fire('click', html);
  await tick();
  assert.equal(play.clicks.length, 0, 'not before the swap');
  u.swap();
  await u.updateCallbackDone;
  await tick();
  assert.equal(play.clicks.length, 1, 'then ▶ has it');
  await r.idle();

  // On a key of the bar the swap takes away (the room's dock at 1000 px):
  // what is under the finger after it is another key.
  const v = (await turn('/takes.html')).t;
  s.under = dock;
  fire('pointerdown', html);
  fire('click', html);
  s.under = play;
  v.swap();
  await v.updateCallbackDone;
  await tick();
  assert.deepEqual([dock.clicks.length, play.clicks.length], [0, 1], 'neither: the key pressed is gone, and ▶ was not pressed');
  await r.idle();
  r.stop();
});

test('a click far from its press, long after it, or from a keyboard is not the press’s', async () => {
  const { s, r, html, play, fire, turn } = await aTurningShell();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const { t } = await turn('/takes.html');
    t.swap();
    await t.updateCallbackDone;
    s.under = play;
    fire('pointerdown', html);
    const dragged = fire('click', html, { clientX: 40 + 17 });
    await tick();
    assert.ok(dragged.stopped && play.clicks.length === 0, 'a drag, not a tap: nothing is handed on');
    await r.idle();

    const u = (await turn('/tape.html')).t;
    u.swap();
    await u.updateCallbackDone;
    fire('pointerdown', html);
    now += 1501;
    const late = fire('click', html);
    await tick();
    assert.ok(!late.stopped && !late.defaultPrevented && play.clicks.length === 0, 'long after: the page’s, untouched');
    await r.idle();

    const v = (await turn('/takes.html')).t;
    v.swap();
    await v.updateCallbackDone;
    fire('pointerdown', html);
    const keyboard = fire('click', play, { detail: 0, clientX: 0, clientY: 0 });
    assert.ok(!keyboard.stopped && !keyboard.defaultPrevented, 'Enter on a key is the key’s');
    await r.idle();

    // A press the turn took with no click after it (a hold), then a press
    // and a click on the page with no switch drawn: the page's.
    const w = (await turn('/tape.html')).t;
    w.swap();
    await w.updateCallbackDone;
    fire('pointerdown', html);
    await r.idle();
    fire('pointerdown', s.views.studio.button, { clientX: 300, clientY: 300 });
    const plain = fire('click', s.views.studio.button, { clientX: 300, clientY: 300 });
    assert.ok(!plain.stopped && !plain.defaultPrevented, 'a new press forgets the one the turn took');
  } finally {
    Date.now = realNow;
  }
  r.stop();
});

test('prewarm mounts the room a tab leads to out of sight, once the room shown is up, and its first visit is only a reveal', async () => {
  let up;
  const ready = new Promise((r) => { up = r; });
  const s = aShell({
    path: '/tape.html',
    rooms: {
      studio: { mount: () => { s.log.push('mount studio'); return { ready, show: () => s.log.push('show studio'), hide: () => s.log.push('hide studio') }; } },
      room: { prewarm: true },
    },
  });
  await s.router.start();
  const warm = s.router.prewarm();
  await tick();
  assert.deepEqual(s.log, ['mount studio', 'show studio'], 'not before the Studio’s first poll');
  up();
  assert.deepEqual(await warm, ['room']);
  assert.deepEqual(s.log, ['mount studio', 'show studio', 'mount room', 'hide room'], 'mounted, then put away as if it had been left');
  assert.equal(s.views.room.root.hidden, true, 'out of sight throughout');
  assert.equal(s.views.room.shown, false);
  assert.equal(s.router.shown(), 'studio');
  assert.deepEqual(s.classes(), ['tape-page'], 'the Studio’s classes, untouched');
  s.log.length = 0;
  await s.router.go('/takes.html');
  assert.deepEqual(s.log, ['hide studio', 'show room from studio'], 'no second mount');
  assert.deepEqual(await s.router.prewarm(), [], 'nothing left to warm: the Studio says nothing of prewarm');
});

test('prewarm leaves alone a room with no prewarm, the room shown, and one already up', async () => {
  const s = aShell({ path: '/tape.html', tapeOn: true, rooms: { capture: { prewarm: true } } });
  await s.router.start();
  assert.deepEqual(await s.router.prewarm(), [], 'the room says nothing of it; Capture is no tab’s with the tape on');
  assert.deepEqual(s.log.filter((l) => l.startsWith('mount')), ['mount studio']);
  const off = aShell({ path: '/takes.html', tapeOn: false, rooms: { capture: { prewarm: true }, studio: { prewarm: true } } });
  await off.router.start();
  assert.deepEqual(await off.router.prewarm(), ['capture'], 'with the tape off the Studio’s tab is Capture');
  assert.equal(off.views.studio.state, 'new');
});

test('a class a room’s mount puts on <body> out of sight comes off, is reported, and is the room’s on its first visit', async () => {
  const s = aShell({
    path: '/tape.html',
    rooms: { room: { prewarm: true, mount: () => { s.doc.body.classList.add('room-on'); return {}; } } },
  });
  await s.router.start();
  await s.router.prewarm();
  assert.deepEqual(s.classes(), ['tape-page'], 'never on the Studio');
  assert.match(String(s.errors[0]?.message), /room-on/);
  await s.router.go('/takes.html');
  assert.deepEqual(s.classes(), ['room-on', 'shelf-page']);
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
