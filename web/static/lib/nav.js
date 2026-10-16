// web/static/lib/nav.js
// The switch in every page's header: Capture, Takes, Tape. Each page ships
// the three tabs in its HTML, so they paint before any script runs; this
// keeps them true -- the current one marked, Tape gone when the Pi runs
// without a tape, and Capture's lamp showing whether the ring is recording.
//
// With the two rooms on (lib/rooms/flag.js, this device only) the three
// become two: STUDIO, which is the tape page with the tape on and Capture
// with it off, and LISTENING ROOM, which is the takes and a take's page.
// Both rooms' headers then carry the device chip, the way to the rig.

import { on as roomsOn } from './rooms/flag.js';
import { tipFor } from './help/tips.js';

const TABS = [
  { id: 'capture', href: '/', label: 'Capture', paths: ['/', '/index.html'] },
  { id: 'takes', href: '/takes.html', label: 'Takes', paths: ['/takes.html', '/wave.html'] },
  { id: 'tape', href: '/tape.html', label: 'Tape', paths: ['/tape.html'] },
  // The two rooms. The Studio's href is the tape page's while the tape is on.
  { id: 'studio', href: '/', tapeHref: '/tape.html', label: 'Studio', paths: ['/', '/index.html', '/tape.html'], rooms: true },
  { id: 'room', href: '/takes.html', label: 'Listening Room', paths: ['/takes.html', '/wave.html'], rooms: true },
];

/**
 * navTabs is the switch for a page at pathname: each tab's id, href and
 * label, and whether it's the page's own. A take belongs to the takes; the
 * guide belongs to none. With the tape off there is no Tape tab. With the
 * rooms on there are two tabs instead of three.
 */
export function navTabs(pathname, tapeOn, rooms = false) {
  return TABS.filter((t) => !!t.rooms === !!rooms && (tapeOn || t.id !== 'tape'))
    .map(({ id, href, tapeHref, label, paths }) => ({
      id, href: (tapeOn && tapeHref) || href, label, current: paths.includes(pathname),
    }));
}

/**
 * studioRedirect says where a page should go instead, once the Pi has said
 * whether the tape is on (true, false, or null for no answer): with the
 * rooms on, the Studio is the tape page while the tape is on and Capture
 * while it's off. index.html does the first half before it draws, from the
 * answer cached last time; this catches a cache that was out of date.
 */
export function studioRedirect(pathname, tapeOn, rooms) {
  if (!rooms || tapeOn == null) return null;
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
 * roomTabs rewrites the page's three tabs as the two rooms: Capture's becomes
 * the Studio's and keeps its lamp (the Studio holds the feed), Takes' becomes
 * the Listening Room's and keeps its icon, and Tape's goes. The nav is then
 * marked: until it is, a page with the rooms on keeps it out of sight (the
 * early script in each page's head, and styles.css), so the three old tabs
 * never show.
 */
export function roomTabs(nav) {
  const relabel = (a, id, label) => {
    // Its text, not its lamp or icon.
    for (const n of [...a.childNodes]) if (n.nodeType === 3) n.remove();
    a.append(label);
    a.dataset.tab = id;
  };
  const studio = nav.querySelector('a[data-tab="capture"]');
  if (studio) {
    relabel(studio, 'studio', 'Studio');
    studio.dataset.tip = 'nav-studio';
    // lib/help may have titled it as Capture's tab already.
    studio.title = tipFor('nav-studio');
  }
  const room = nav.querySelector('a[data-tab="takes"]');
  if (room) {
    relabel(room, 'room', 'Listening Room');
    room.dataset.tip = 'nav-room';
    room.title = tipFor('nav-room');
  }
  nav.querySelector('a[data-tab="tape"]')?.remove();
  nav.classList.add('appnav-rooms');
}

/**
 * mountHeaderTools places the top-right utility cluster (.appbar-end) with
 * Releases/Version, Guide, and Settings in the header on every page when the
 * two rooms are on, and wires Settings and Releases sheets across pages.
 */
export function mountHeaderTools(doc = document) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const bar = doc.querySelector('.appbar');
  if (!bar || doc.querySelector('.appbar-end')) return null;
  const end = doc.createElement('div');
  end.className = 'appbar-end';
  for (const existing of [bar.querySelector(':scope > #out-btn'), bar.querySelector(':scope > .health')].filter(Boolean)) {
    end.append(existing);
  }
  const rel = doc.createElement('button');
  rel.type = 'button';
  rel.id = 'appbar-releases-btn';
  rel.className = 'icon-btn appbar-btn appbar-releases-btn';
  rel.dataset.tip = 'releases';
  rel.textContent = 'Releases';

  const guide = doc.createElement('a');
  guide.href = '/guide.html';
  guide.className = 'icon-btn appbar-btn appbar-guide-link';
  guide.dataset.tip = 'guide';
  guide.textContent = 'Guide';

  const set = doc.createElement('button');
  set.type = 'button';
  set.id = 'appbar-settings-btn';
  set.className = 'icon-btn appbar-btn appbar-settings-btn';
  set.dataset.tip = 'settings';
  set.textContent = 'Settings';

  end.append(rel, guide, set);
  const help = bar.querySelector('#help');
  if (help && help.parentElement === bar && typeof help.before === 'function') help.before(end);
  else bar.append(end);

  import('./settings.js').then((m) => m.initSettings()).catch(() => {});
  import('./update.js').then((m) => m.initUpdate()).catch(() => {});
  return end;
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
  const rooms = env.rooms ?? roomsOn();
  if (rooms) {
    roomTabs(nav);
    mountHeaderTools(doc);
    // The device chip, the way to the rig (lib/rig/chip.js): only with the
    // rooms on, so with them off it isn't even fetched.
    import('./rig/chip.js').then((m) => m.mountChip(doc, { pathname: loc.pathname, fetchFn: get })).catch(() => {});
  }
  const apply = (tapeOn) => {
    const tabs = navTabs(loc.pathname, tapeOn, rooms);
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
      const to = studioRedirect(loc.pathname, on, rooms);
      if (to) loc.replace(to);
    }
    return r.ok ? r.json() : null;
  }).catch(() => null);

  // Capture's lamp: the ring is recording, waiting for the interface, or not.
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
    lamp.closest('a')?.setAttribute('aria-label', `${rooms ? 'Studio' : 'Capture'}, ${words}`);
  };
  poll();
  every(() => { if (!doc.hidden) poll(); }, 10000);
  return tapes;
}
