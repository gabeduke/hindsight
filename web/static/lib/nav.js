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

/**
 * initNav brings the page's switch in line with navTabs and lights the lamp.
 * It answers with the Pi's tapes ({loaded, tapes}), or null with the tape
 * off, so a page's now-playing bar can find the loaded tape without asking
 * again.
 */
export function initNav(doc = document) {
  const nav = doc.querySelector('.appnav');
  if (!nav) return Promise.resolve(null);
  const apply = (tapeOn) => {
    const tabs = navTabs(location.pathname, tapeOn);
    for (const a of nav.querySelectorAll('a[data-tab]')) {
      const t = tabs.find((x) => x.id === a.dataset.tab);
      a.hidden = !t;
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
    lamp.closest('a')?.setAttribute('aria-label', `Capture, ${words}`);
  };
  poll();
  setInterval(() => { if (!doc.hidden) poll(); }, 10000);
  return tapes;
}
