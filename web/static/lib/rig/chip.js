// web/static/lib/rig/chip.js
// The rig in the header's menu (lib/nav.js mountHeaderTools,
// docs/plan/the-studio-on-one-screen.md): the interface plugged in --
// "Sidekick · 8 in · 4 out" -- with a lamp, and the way to the rig. The rig
// isn't a tab: it's visited when something changes, not while playing. An
// amber lamp puts a dot on the menu's button (styles.css), so it is seen
// with the menu shut.
//
// lib/nav.js loads this on every page; off the rooms' pages (chipOn) it
// draws nothing, asks nothing and listens for nothing.

/**
 * chipModel is what the chip says, from the rig's graph: the interface's
 * short name, its channels, and its lamp -- ok, warn (a cable waits for a
 * restart, or the tape is in a tap) or none (no interface).
 */
export function chipModel(g) {
  const iface = g && (g.devices || []).find((d) => d.role === 'interface');
  if (!iface) {
    return { name: 'Rig', sub: 'no interface', state: 'none', label: 'The rig: no audio interface found' };
  }
  const sub = iface.in ? `${iface.in} in${iface.out ? ` · ${iface.out} out` : ''}` : '';
  const warn = (g.warnings || []).length > 0;
  const pending = !!g.restart_needed;
  const state = warn || pending ? 'warn' : 'ok';
  const why = warn ? ', the tape is in a tap' : pending ? ', a cable waits for a restart' : '';
  return { name: iface.short, sub, state, label: `The rig: ${iface.short}${sub ? `, ${sub}` : ''}${why}` };
}

/** chipOn says whether a page shows the chip: the rooms' pages, not the rig or the guide. */
export function chipOn(pathname) {
  return ['/', '/index.html', '/tape.html', '/takes.html', '/wave.html'].includes(pathname);
}

/**
 * mountChip shows the menu's rig item and fills it from /api/rig. It
 * answers the item, or null on a page without one.
 */
export function mountChip(doc = document, { pathname = location.pathname, fetchFn = fetch } = {}) {
  if (!chipOn(pathname)) return null;
  const a = doc.querySelector('.app-menu-rig');
  if (!a || !a.hidden) return null;
  a.hidden = false;
  a.dataset.state = 'none';
  fetchFn('/api/rig', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => {
      const m = chipModel(g);
      a.querySelector('.rig-chip-sub').textContent = m.sub ? `${m.name} · ${m.sub}` : m.name;
      a.dataset.state = m.state;
      a.setAttribute('aria-label', m.label);
    })
    .catch(() => {});
  return a;
}
