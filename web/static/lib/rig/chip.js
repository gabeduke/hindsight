// web/static/lib/rig/chip.js
// The device chip in both rooms' headers (docs/superpowers/specs/2026-10-15-rig-design.md):
// the interface plugged in -- "Sidekick · 8 in · 4 out" -- with a lamp, and
// the way to the rig. The rig isn't a tab: it's visited when something
// changes, not while playing.
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
 * mountChip puts the chip in the page's header, and fills it from
 * /api/rig. It answers the chips, one per header row, or null on a page
 * without one.
 */
export function mountChip(doc = document, { pathname = location.pathname, fetchFn = fetch } = {}) {
  if (!chipOn(pathname)) return null;
  // In the page's own row, where the page's actions are, on the right; on
  // Capture, which has no such row, beside the ring's health. The shell has
  // a row per room and shows one at a time, so each row gets its own chip.
  const rows = doc.querySelectorAll('.appbar .appbar-page');
  const health = doc.querySelector('.appbar > .health');
  if ((!rows.length && !health) || doc.querySelector('.rig-chip')) return null;
  const chip = () => {
    const a = doc.createElement('a');
    a.className = 'rig-chip';
    a.href = '/rig.html';
    a.dataset.tip = 'rig-chip';
    a.dataset.state = 'none';
    a.setAttribute('aria-label', 'The rig');
    a.innerHTML = '<svg class="rig-chip-ico" width="22" height="14" viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="2" width="24" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="8" r="2" fill="currentColor"/><circle cx="13" cy="8" r="2" fill="currentColor"/><rect x="17" y="6" width="5" height="4" rx="1" fill="currentColor"/></svg><span class="rig-chip-name">Rig</span><span class="rig-chip-sub"></span><span class="rig-chip-lamp" aria-hidden="true"></span>';
    return a;
  };
  const chips = [];
  for (const row of rows) {
    const a = chip();
    const spacer = row.querySelector('.appbar-spacer');
    if (spacer) spacer.after(a);
    else row.append(a);
    chips.push(a);
  }
  if (!rows.length) {
    chips.push(chip());
    health.prepend(chips[0]);
  }
  fetchFn('/api/rig', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => {
      const m = chipModel(g);
      for (const a of chips) {
        a.querySelector('.rig-chip-name').textContent = m.name;
        a.querySelector('.rig-chip-sub').textContent = m.sub ? `· ${m.sub}` : '';
        a.dataset.state = m.state;
        a.setAttribute('aria-label', m.label);
      }
    })
    .catch(() => {});
  return chips;
}
