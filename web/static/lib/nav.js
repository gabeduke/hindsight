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

// roomTabs rewrites the page's three tabs as the two rooms: Capture's becomes
// the Studio's and keeps its lamp (the Studio holds the feed), Takes' becomes
// the Listening Room's and keeps its icon, and Tape's goes.
function roomTabs(nav) {
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
}

/**
 * initNav brings the page's switch in line with navTabs and lights the lamp.
 * It answers with the Pi's tapes ({loaded, tapes}), or null with the tape
 * off, so a page's now-playing bar can find the loaded tape without asking
 * again.
 */
export function initNav(doc = document) {
  const nav = doc.querySelector('.appnav');
  if (!nav) return Promise.resolve(null);
  const rooms = roomsOn();
  if (rooms) {
    roomTabs(nav);
    // The device chip, the way to the rig (lib/rig/chip.js): only with the
    // rooms on, so with them off it isn't even fetched.
    import('./rig/chip.js').then((m) => m.mountChip(doc)).catch(() => {});
  }
  const apply = (tapeOn) => {
    const tabs = navTabs(location.pathname, tapeOn, rooms);
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
  try { known = localStorage.getItem('hindsight.tapeOn'); } catch { /* fine */ }
  apply(known !== 'false');
  const tapes = fetch('/api/tapes', { cache: 'no-store' }).then((r) => {
    apply(r.ok);
    try { localStorage.setItem('hindsight.tapeOn', String(r.ok)); } catch { /* fine */ }
    // Only a clear answer moves the page: the tape is there, or it isn't.
    const to = studioRedirect(location.pathname, r.ok ? true : r.status === 404 ? false : null, rooms);
    if (to) location.replace(to);
    return r.ok ? r.json() : null;
  }).catch(() => null);

  // Capture's lamp: the ring is recording, waiting for the interface, or not.
  const lamp = nav.querySelector('.appnav-lamp');
  if (!lamp) return tapes;
  const poll = async () => {
    try {
      const s = await (await fetch('/api/status', { cache: 'no-store' })).json();
      lamp.dataset.state = s.capture_healthy ? 'ok' : s.capture_waiting ? 'wait' : 'bad';
    } catch {
      lamp.dataset.state = 'bad';
    }
    // The lamp is colour; the tab says it in words too.
    const words = { ok: 'recording', wait: 'waiting for the interface', bad: 'not recording' }[lamp.dataset.state];
    lamp.closest('a')?.setAttribute('aria-label', `${rooms ? 'Studio' : 'Capture'}, ${words}`);
  };
  poll();
  setInterval(() => { if (!doc.hidden) poll(); }, 10000);
  return tapes;
}
