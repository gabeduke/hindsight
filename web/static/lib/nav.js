// web/static/lib/nav.js
// The switch in every page's header: Capture, Takes, Tape. Each page ships
// the three tabs in its HTML, so they paint before any script runs; this
// keeps them true -- the current one marked, Tape gone when the Pi runs
// without a tape, and Capture's lamp showing whether the ring is recording.

const TABS = [
  { id: 'capture', href: '/', label: 'Capture', paths: ['/', '/index.html'] },
  { id: 'takes', href: '/takes.html', label: 'Takes', paths: ['/takes.html', '/wave.html'] },
  { id: 'tape', href: '/tape.html', label: 'Tape', paths: ['/tape.html'] },
];

/**
 * navTabs is the switch for a page at pathname: each tab's id, href and
 * label, and whether it's the page's own. A take belongs to the takes; the
 * guide belongs to none. With the tape off there is no Tape tab.
 */
export function navTabs(pathname, tapeOn) {
  return TABS.filter((t) => tapeOn || t.id !== 'tape')
    .map(({ id, href, label, paths }) => ({ id, href, label, current: paths.includes(pathname) }));
}

/** initNav brings the page's switch in line with navTabs and lights the lamp. */
export function initNav(doc = document) {
  const nav = doc.querySelector('.appnav');
  if (!nav) return;
  const apply = (tapeOn) => {
    const tabs = navTabs(location.pathname, tapeOn);
    for (const a of nav.querySelectorAll('a[data-tab]')) {
      const t = tabs.find((x) => x.id === a.dataset.tab);
      a.hidden = !t;
      if (t && t.current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  apply(true);
  fetch('/api/tapes', { cache: 'no-store' }).then((r) => apply(r.ok)).catch(() => {});

  // Capture's lamp: the ring is recording, waiting for the interface, or not.
  const lamp = nav.querySelector('.appnav-lamp');
  if (!lamp) return;
  const poll = async () => {
    try {
      const s = await (await fetch('/api/status', { cache: 'no-store' })).json();
      lamp.dataset.state = s.capture_healthy ? 'ok' : s.capture_waiting ? 'wait' : 'bad';
    } catch {
      lamp.dataset.state = 'bad';
    }
  };
  poll();
  setInterval(() => { if (!doc.hidden) poll(); }, 10000);
}
