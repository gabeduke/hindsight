// web/static/lib/nav.js
// The switch in every page's header: the two rooms. STUDIO is the tape page
// with the tape on and `/` with it off; LISTENING ROOM is the takes and a
// take's page. Each page ships the two tabs in its HTML, so they paint
// before any script runs; this keeps them true -- the current one marked,
// the Studio's href following the tape, and its lamp showing whether the
// feed is recording -- and gives every header its tools (Releases, Guide,
// Settings) and the device chip, the way to the rig.

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
 * mountHeaderTools places the top-right utility cluster (.appbar-end) with
 * Releases/Version, Guide, and Settings in the header on every page, and
 * wires Settings and Releases sheets across pages.
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
  mountHeaderTools(doc);
  // The device chip, the way to the rig (lib/rig/chip.js).
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
