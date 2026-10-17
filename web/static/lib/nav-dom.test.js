// web/static/lib/nav-dom.test.js
// initNav on a page: what it does to the header's switch, and what it keeps
// of the Pi's answer about the tape -- against a stand-in for the few DOM
// calls it makes, and stand-ins for fetch, storage and location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initNav, tapeAnswer } from './nav.js';

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
class Text {
  constructor(t) { this.nodeType = 3; this.textContent = t; this.parent = null; }
  remove() { this.parent?.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = null; }
}
class El {
  constructor(tag, attrs = {}, kids = []) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.parent = null;
    this.attrs = new Map(Object.entries(attrs)); this.childNodes = []; this.hidden = false; this.title = '';
    this.dataset = new Proxy({}, {
      get: (_, k) => this.attrs.get(`data-${kebab(String(k))}`),
      set: (_, k, v) => { this.attrs.set(`data-${kebab(String(k))}`, String(v)); return true; },
    });
    const cls = () => (this.attrs.get('class') || '').split(/\s+/).filter(Boolean);
    this.classList = {
      contains: (c) => cls().includes(c),
      add: (c) => { if (!cls().includes(c)) this.attrs.set('class', [...cls(), c].join(' ')); },
    };
    this.append(...kids);
  }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Text(n); n.parent = this; this.childNodes.push(n); } }
  remove() { this.parent?.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = null; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  get textContent() { return this.childNodes.map((n) => n.textContent ?? '').join(''); }
  *walk() { for (const c of this.childNodes) if (c.nodeType === 1) { yield c; yield* c.walk(); } }
  matches(sel) {
    if (/^\w+$/.test(sel)) return this.tagName === sel.toUpperCase();
    let m = /^\.([\w-]+)$/.exec(sel);
    if (m) return this.classList.contains(m[1]);
    m = /^(\w+)\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) return this.tagName === m[1].toUpperCase() && this.attrs.has(m[2]) && (m[3] === undefined || this.attrs.get(m[2]) === m[3]);
    throw new Error(`the stand-in can't match ${sel}`);
  }
  querySelector(sel) { for (const e of this.walk()) if (e.matches(sel)) return e; return null; }
  querySelectorAll(sel) { return [...this.walk()].filter((e) => e.matches(sel)); }
  closest(sel) { for (let e = this; e; e = e.parent) if (e.matches(sel)) return e; return null; }
}

// The tape page's switch, as tape.html ships it.
function page() {
  const nav = new El('nav', { class: 'appnav' }, [
    new El('a', { href: '/tape.html', 'data-tab': 'studio', 'data-tip': 'nav-studio', 'aria-current': 'page' }, [new El('span', { class: 'appnav-lamp' }), 'Studio']),
    new El('a', { href: '/takes.html', 'data-tab': 'room', 'data-tip': 'nav-room' }, [new El('svg', { class: 'appnav-ico' }), 'Listening Room']),
  ]);
  const body = new El('body', {}, [new El('header', {}, [nav])]);
  return { nav, doc: { hidden: false, querySelector: (s) => body.querySelector(s) } };
}

function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// The Pi: /api/tapes answers `tapes` (a status, or 'down' for no answer);
// /api/status says the ring is recording.
function env({ path = '/tape.html', tapes = 200, cache = {} } = {}) {
  const went = [];
  return {
    went,
    localStorage: storage(cache),
    location: { pathname: path, replace: (u) => went.push(u) },
    setInterval: () => 0,
    fetch: async (url) => {
      if (url === '/api/tapes') {
        if (tapes === 'down') throw new TypeError('Failed to fetch');
        return { ok: tapes >= 200 && tapes < 300, status: tapes, json: async () => ({ loaded: 't1', tapes: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ capture_healthy: true }) };
    },
  };
}

// initNav answers with the tapes; the lamp's first poll lands a turn later.
const settle = () => new Promise((r) => setImmediate(r));

const shown = (nav) => nav.querySelectorAll('a[data-tab]').filter((a) => !a.hidden)
  .map((a) => `${a.dataset.tab}${a.getAttribute('aria-current') ? '*' : ''} ${a.getAttribute('href')}`);

test('the answer about the tape: 2xx on, 404 off, anything else unknown', () => {
  assert.equal(tapeAnswer({ ok: true, status: 200 }), true);
  assert.equal(tapeAnswer({ ok: false, status: 404 }), false);
  for (const status of [500, 502, 503, 401]) assert.equal(tapeAnswer({ ok: false, status }), null);
});

test('a 2xx: the tape is on, and kept so', async () => {
  const { nav, doc } = page();
  const e = env({ tapes: 200 });
  assert.deepEqual(await initNav(doc, e), { loaded: 't1', tapes: [] });
  await settle();
  assert.equal(e.localStorage.getItem('hindsight.tapeOn'), 'true');
  assert.deepEqual(shown(nav), ['studio* /tape.html', 'room /takes.html']);
  assert.deepEqual(e.went, []);
});

test('a 404: the tape is off, kept so, and the Studio is `/`', async () => {
  const { nav, doc } = page();
  const e = env({ path: '/takes.html', tapes: 404, cache: { 'hindsight.tapeOn': 'true' } });
  assert.equal(await initNav(doc, e), null);
  await settle();
  assert.equal(e.localStorage.getItem('hindsight.tapeOn'), 'false');
  assert.deepEqual(shown(nav), ['studio /', 'room* /takes.html']);
});

test('a 500, or no answer at all, changes nothing that was known', async () => {
  for (const tapes of [500, 503, 'down']) {
    for (const cached of ['true', 'false', null]) {
      const { nav, doc } = page();
      const e = env({ path: '/tape.html', tapes, cache: cached === null ? {} : { 'hindsight.tapeOn': cached } });
      await initNav(doc, e); await settle();
      assert.equal(e.localStorage.getItem('hindsight.tapeOn'), cached, `${tapes} with ${cached} cached`);
      assert.deepEqual(e.went, [], `${tapes} moves no page`);
      // Drawn from the cache, as it was before the answer.
      assert.deepEqual(shown(nav), [`studio* ${cached === 'false' ? '/' : '/tape.html'}`, 'room /takes.html'], `${tapes} with ${cached} cached`);
    }
  }
});

test('a clear answer puts a stale page right', async () => {
  let { doc } = page();
  let e = env({ path: '/tape.html', tapes: 404, cache: { 'hindsight.tapeOn': 'true' } });
  await initNav(doc, e); await settle();
  assert.deepEqual(e.went, ['/']);
  ({ doc } = page());
  e = env({ path: '/', tapes: 200, cache: { 'hindsight.tapeOn': 'false' } });
  await initNav(doc, e); await settle();
  assert.deepEqual(e.went, ['/tape.html']);
});

test('initNav draws the two tabs and the Studio follows the tape', async () => {
  let { nav, doc } = page();
  await initNav(doc, env({ path: '/tape.html', tapes: 200 })); await settle();
  assert.deepEqual(shown(nav), ['studio* /tape.html', 'room /takes.html']);
  assert.equal(nav.querySelector('.appnav-lamp').closest('a').getAttribute('aria-label'), 'Studio, recording');
  ({ nav, doc } = page());
  await initNav(doc, env({ path: '/wave.html', tapes: 404 })); await settle();
  assert.deepEqual(shown(nav), ['studio /', 'room* /takes.html']);
});
