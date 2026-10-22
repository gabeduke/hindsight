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
 * mountHeaderTools puts the header's tools at its top right on every page:
 * the output button and the ring's health where the page has them, then one
 * menu (docs/plan/the-studio-on-one-screen.md) holding Settings, the rig,
 * help mode, the guide and Releases. settings.js, update.js, help.js and
 * rig/chip.js find their items by the ids and classes they had in the header.
 * The page's ? (#help) moves into the menu as its Help mode item; a page
 * without one has none. The menu's button carries a dot when a release is
 * waiting or the rig needs a look, and lights while help mode is on
 * (styles.css), so nothing behind it goes unseen.
 */
export function mountHeaderTools(doc = document) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const bar = doc.querySelector('.appbar');
  if (!bar || doc.querySelector('.appbar-end')) return null;
  const make = (tag, cls, attrs = {}, text = '') => {
    const el = doc.createElement(tag);
    el.className = cls;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    return el;
  };
  const end = make('div', 'appbar-end');
  for (const existing of [...bar.children].filter((c) => c.id === 'out-btn' || c.classList?.contains('health'))) {
    end.append(existing);
  }

  const anchor = make('span', 'menu-anchor app-menu-anchor');
  const btn = make('button', 'icon-btn app-menu-btn', {
    id: 'app-menu-btn', type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu',
    'aria-expanded': 'false', 'aria-controls': 'app-menu', 'data-tip': 'app-menu',
    // Help mode shows its tip and still opens it: Help mode's own way out is inside.
    'data-tip-pass': '',
  });
  btn.innerHTML = '<svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><path d="M2 2h16M2 8h16M2 14h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const menu = make('div', 'menu app-menu', { id: 'app-menu', role: 'menu', 'aria-label': 'Menu' });
  menu.hidden = true;

  const set = make('button', 'app-menu-item appbar-settings-btn', { id: 'appbar-settings-btn', type: 'button', role: 'menuitem', 'data-tip': 'settings' });
  set.append(make('span', 'app-menu-word', {}, 'Settings'));
  // Filled, and shown, by rig/chip.js on the pages that have the rig.
  const rig = make('a', 'app-menu-item app-menu-rig', { href: '/rig.html', role: 'menuitem', 'data-tip': 'rig-chip' });
  rig.append(make('span', 'app-menu-word', {}, 'The rig'), make('span', 'app-menu-sub rig-chip-sub'), make('span', 'rig-chip-lamp', { 'aria-hidden': 'true' }));
  rig.hidden = true;
  const items = [set, rig];
  const help = bar.querySelector('#help');
  if (help) {
    help.className = 'app-menu-item app-menu-help';
    help.setAttribute('role', 'menuitemcheckbox');
    help.setAttribute('aria-checked', help.getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
    help.removeAttribute('aria-pressed');
    help.removeAttribute('aria-label');
    help.textContent = '';
    help.append(make('span', 'menu-check', { 'aria-hidden': 'true' }, '✓'), make('span', 'app-menu-word', {}, 'Help mode'),
      make('span', 'app-menu-sub', {}, 'tap a control to read what it does'));
    items.push(help);
  }
  const guide = make('a', 'app-menu-item appbar-guide-link', { href: '/guide.html', role: 'menuitem', 'data-tip': 'guide' });
  guide.append(make('span', 'app-menu-word', {}, 'The guide'));
  // update.js puts the version, or the release waiting, in its second line.
  const rel = make('button', 'app-menu-item appbar-releases-btn', { id: 'appbar-releases-btn', type: 'button', role: 'menuitem', 'data-tip': 'releases' });
  rel.append(make('span', 'app-menu-word', {}, 'Releases'), make('span', 'app-menu-sub releases-version'));
  items.push(guide, rel);
  menu.append(...items);
  anchor.append(btn, menu);
  end.append(anchor);
  bar.append(end);
  wireAppMenu(btn, menu, doc);

  import('./settings.js').then((m) => m.initSettings()).catch(() => {});
  import('./update.js').then((m) => m.initUpdate()).catch(() => {});
  return end;
}

/**
 * wireAppMenu opens the header's menu from its button and shuts it on a
 * second press, a pick, Escape, or a press anywhere else -- the page's other
 * menus stop their buttons' clicks, so it listens for the press, first, on
 * the window. ↑ ↓ move along its items. Answers {setOpen, isOpen}.
 */
export function wireAppMenu(btn, menu, doc = document) {
  const win = doc.defaultView || doc;
  const items = () => [...menu.children].filter((c) => !c.hidden);
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => setOpen(menu.hidden));
  // Capture: a pick shuts the menu before the item's own handler, which may
  // stop the click (help mode's does).
  menu.addEventListener('click', (e) => {
    if ([...menu.children].some((c) => c.contains(e.target))) setOpen(false);
  }, true);
  win.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) setOpen(false);
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { setOpen(false); btn.focus?.(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(doc.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
    list[next].focus?.();
    e.preventDefault?.();
  });
  return { setOpen, isOpen: () => !menu.hidden };
}

/**
 * initNav brings the page's switch in line with navTabs and lights the lamp.
 * It answers with the Pi's tapes ({loaded, tapes}), or null with the tape
 * off, so a page's now-playing bar can find the loaded tape without asking
 * again. `env` stands in for the browser's globals in tests.
 */
export function initNav(doc = document, env = {}) {
  const loc = env.location ?? globalThis.location;
  const get = env.fetch ?? ((...a) => globalThis.fetch(...a));
  const store = () => env.localStorage ?? globalThis.localStorage;
  const every = env.setInterval ?? globalThis.setInterval;
  const nav = doc.querySelector('.appnav');
  if (!nav) return Promise.resolve(null);
  mountHeaderTools(doc);
  // The rig, in the menu: its interface and lamp (lib/rig/chip.js).
  import('./rig/chip.js').then((m) => m.mountChip(doc, { pathname: loc.pathname, fetchFn: get })).catch(() => {});
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
