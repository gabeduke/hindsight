// web/static/lib/nav.js
// The switch in every page's header: the two rooms. STUDIO is the tape page
// with the tape on and `/` with it off; LISTENING ROOM is the takes and a
// take's page. Each page ships the two tabs in its HTML, so they paint
// before any script runs; this keeps them true -- the current one marked,
// the Studio's href following the tape, and its lamp showing whether the
// feed is recording -- and gives every header its one menu: Settings, the
// rig, help mode, the guide and Releases.

// The rooms' words (lib/rooms/words.js) say the page's own markup once, as
// that module loads: before any page code has put text into the page. Every
// page loads this, so every page is said; a later import would rename what
// a page had filled in by then (the guide, a take's name).
import './rooms/words.js';
import { icon } from './ui/icons.js';
import { layersOf } from './ui/layers.js';
import { menu, menuItem } from './ui/menu.js';
import { latencyOn } from './play/flag.js';

const TABS = [
  // The Studio's href is the tape page's while the tape is on.
  { id: 'studio', href: '/', tapeHref: '/tape.html', label: 'Studio', paths: ['/', '/index.html', '/tape.html'] },
  { id: 'room', href: '/takes.html', label: 'Listening Room', paths: ['/takes.html', '/wave.html'] },
];

/**
 * navTabs is the switch for a page at pathname: each tab's id, href and
 * label, and whether it's the page's own. A take is in the Listening Room;
 * the guide and the rig belong to neither.
 */
export function navTabs(pathname, tapeOn) {
  return TABS.map(({ id, href, tapeHref, label, paths }) => ({
    id, href: (tapeOn && tapeHref) || href, label, current: paths.includes(pathname),
  }));
}

/**
 * studioRedirect says where a page should go instead, once the Pi has said
 * whether the tape is on (true, false, or null for no answer): the Studio
 * is the tape page while the tape is on and `/` while it's off. index.html
 * does the first half before it draws, from the answer cached last time;
 * this catches a cache that was out of date.
 */
export function studioRedirect(pathname, tapeOn) {
  if (tapeOn == null) return null;
  if (tapeOn && (pathname === '/' || pathname === '/index.html')) return '/tape.html';
  if (!tapeOn && pathname === '/tape.html') return '/';
  return null;
}

/**
 * tapeAnswer reads the Pi's answer to /api/tapes: the tape is on (a 2xx),
 * off (a 404), or nothing can be said (a 500, a proxy's error page), which
 * leaves whatever was known before.
 */
export function tapeAnswer(res) {
  if (res.ok) return true;
  if (res.status === 404) return false;
  return null;
}

/**
 * mountHeaderTools puts the header's one menu (☰) at the end of its tools
 * zone, top right on every page (css/chrome.css): after the page's own ↶ ↷,
 * where it has them. The menu holds Settings, the rig, help mode, the guide
 * and Releases (docs/plan/the-studio-on-one-screen.md); settings.js,
 * update.js, help.js and rig/chip.js find their items by the ids and classes
 * they had in the header. The page's ? (#help) moves into the menu as its
 * Help mode item; a page without one has none. The menu's button carries a
 * dot when a release is waiting or the rig needs a look, and lights while
 * help mode is on, so nothing behind it goes unseen. It is the header's only
 * menu glyph: ☰ means this menu and nothing else. The menu opens on the
 * page's stack of open things (`layers`, lib/ui/layers.js). A page whose
 * markup has no tools zone (.appbar-end) gets one.
 */
export function mountHeaderTools(doc = document, { layers } = {}) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const bar = doc.querySelector('.appbar');
  if (!bar || doc.getElementById('app-menu-btn')) return null;
  const make = (tag, cls, attrs = {}, text = '') => {
    const el = doc.createElement(tag);
    el.className = cls;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    return el;
  };
  let end = bar.querySelector('.appbar-end');
  if (!end) {
    end = make('div', 'appbar-end');
    bar.append(end);
  }

  const anchor = make('span', 'menu-anchor app-menu-anchor');
  const btn = make('button', 'icon-btn app-menu-btn', {
    id: 'app-menu-btn', type: 'button', 'aria-label': 'Menu', 'data-tip': 'app-menu',
    // Help mode shows its tip and still opens it: Help mode's own way out is inside.
    'data-tip-pass': '',
  });
  btn.innerHTML = icon('menu', { size: 22 });
  const panel = make('div', 'menu app-menu', { id: 'app-menu', 'aria-label': 'Menu' });

  // Its rows (lib/ui/menu.js menuItem): each module finds its own by the id
  // or class it had in the header.
  const set = menuItem(doc, { word: 'Settings', className: 'appbar-settings-btn', attrs: { id: 'appbar-settings-btn', 'data-tip': 'settings' } });
  // Filled, and shown, by rig/chip.js on the pages that have the rig.
  const rig = menuItem(doc, {
    word: 'The rig', href: '/rig.html', sub: '', subClass: 'rig-chip-sub', className: 'app-menu-rig',
    end: make('span', 'rig-chip-lamp', { 'aria-hidden': 'true' }), attrs: { 'data-tip': 'rig-chip' },
  });
  rig.hidden = true;
  const items = [set, rig];
  const help = bar.querySelector('#help');
  if (help) {
    const on = help.getAttribute('aria-pressed') === 'true';
    help.removeAttribute('aria-pressed');
    help.removeAttribute('aria-label');
    items.push(menuItem(doc, {
      el: help, word: 'Help mode', sub: 'tap a control to read what it does', role: 'menuitemcheckbox', checked: on, className: 'app-menu-help',
    }));
  }
  const guide = menuItem(doc, { word: 'The guide', href: '/guide.html', className: 'appbar-guide-link', attrs: { 'data-tip': 'guide' } });
  // update.js puts the version, or the release waiting, in its second line.
  const rel = menuItem(doc, {
    word: 'Releases', sub: '', subClass: 'releases-version', className: 'appbar-releases-btn', attrs: { id: 'appbar-releases-btn', 'data-tip': 'releases' },
  });
  items.push(guide, rel);
  panel.append(...items);
  anchor.append(btn, panel);
  end.append(anchor);
  // It opens on the page's stack (lib/ui/layers.js), under ☰, its right
  // edge on ☰'s: Escape, Back, a press elsewhere, a pick and a switch of
  // rooms close it.
  menu(btn, panel, { layers: layers || layersOf(doc), doc, align: 'end', side: 'below' });

  import('./settings.js').then((m) => m.initSettings()).catch(() => {});
  import('./update.js').then((m) => m.initUpdate()).catch(() => {});
  return end;
}

/**
 * initNav brings the page's switch in line with navTabs and lights the lamp.
 * It answers with the Pi's tapes ({loaded, tapes}), or null with the tape
 * off, so a page's now-playing bar can find the loaded tape without asking
 * again. `env` stands in for the browser's globals in tests, and carries
 * the page's stack of open things (`layers`) for the menu.
 */
export function initNav(doc = document, env = {}) {
  const { layers } = env;
  const loc = env.location ?? globalThis.location;
  const get = env.fetch ?? ((...a) => globalThis.fetch(...a));
  const store = () => env.localStorage ?? globalThis.localStorage;
  const every = env.setInterval ?? globalThis.setInterval;
  const nav = doc.querySelector('.appnav');
  if (!nav) return Promise.resolve(null);
  mountHeaderTools(doc, { layers });
  // The rig, in the menu: its interface and lamp (lib/rig/chip.js).
  import('./rig/chip.js').then((m) => m.mountChip(doc, { pathname: loc.pathname, fetchFn: get })).catch(() => {});
  // The latency overlay, on a device that asked for it (lib/device-prefs.js).
  if (latencyOn()) import('./play/latency.js').then((m) => m.mountOverlay(doc, { fetchFn: get })).catch(() => {});
  const apply = (tapeOn) => {
    const tabs = navTabs(loc.pathname, tapeOn);
    for (const a of nav.querySelectorAll('a[data-tab]')) {
      const t = tabs.find((x) => x.id === a.dataset.tab);
      a.hidden = !t;
      // The Studio's follows the tape; the others' are the markup's own.
      if (t && a.getAttribute('href') !== t.href) a.setAttribute('href', t.href);
      if (t && t.current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  // Last time's answer first, so a Pi without the tape doesn't flash a Tape
  // tab while it's asked again.
  let known = null;
  try { known = store().getItem('hindsight.tapeOn'); } catch { /* fine */ }
  apply(known !== 'false');
  const tapes = get('/api/tapes', { cache: 'no-store' }).then((r) => {
    // Only a clear answer is drawn, kept for next time, or moves the page: a
    // 500 says nothing about whether the tape is on.
    const on = tapeAnswer(r);
    if (on !== null) {
      apply(on);
      try { store().setItem('hindsight.tapeOn', String(on)); } catch { /* fine */ }
      const to = studioRedirect(loc.pathname, on);
      if (to) loc.replace(to);
    }
    return r.ok ? r.json() : null;
  }).catch(() => null);

  // The Studio's lamp: the feed is recording, waiting for the interface, or not.
  const lamp = nav.querySelector('.appnav-lamp');
  if (!lamp) return tapes;
  const poll = async () => {
    try {
      const s = await (await get('/api/status', { cache: 'no-store' })).json();
      lamp.dataset.state = s.capture_healthy ? 'ok' : s.capture_waiting ? 'wait' : 'bad';
    } catch {
      lamp.dataset.state = 'bad';
    }
    // The lamp is colour; the tab says it in words too.
    const words = { ok: 'recording', wait: 'waiting for the interface', bad: 'not recording' }[lamp.dataset.state];
    lamp.closest('a')?.setAttribute('aria-label', `Studio, ${words}`);
  };
  poll();
  every(() => { if (!doc.hidden) poll(); }, 10000);
  return tapes;
}
