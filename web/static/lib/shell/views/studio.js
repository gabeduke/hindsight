// web/static/lib/shell/views/studio.js
// The Studio as a shell view (docs/architecture/shell.md,
// The shell): mounts the tape page (lib/tape/page.js) and the Studio ribbon
// and buffer (lib/rooms/mount.js) inside the shell, driving their polls,
// frame loops, and global listeners through ctx so they go quiet while
// another room is shown.

import { mountTapePage } from '../../tape/page.js';
import { start as startStudio } from '../../rooms/mount.js';

export const studioView = {
  id: 'studio',
  title: 'Hindsight — tape',
  name: 'Studio',
  bodyClass: 'tape-page',
  help: 'tape',
  mount(ctx) {
    // The header's zones (css/chrome.css): the tape's name at the start,
    // ↶ ↷ in the tools, before ☰.
    const headerEl = document.getElementById('header-studio');
    if (headerEl) {
      headerEl.hidden = false;
      ctx.headerSlot.add(headerEl);
    }
    const toolsEl = document.getElementById('header-studio-end');
    if (toolsEl) {
      toolsEl.hidden = false;
      const menu = document.querySelector('.appbar-end > .app-menu-anchor');
      ctx.headerSlot.add(toolsEl, menu ? { before: menu } : undefined);
    }
    for (const id of ['clip-editor', 'multi-bar']) {
      const el = document.getElementById(id);
      if (el) ctx.dockSlot.add(el);
    }
    const tape = mountTapePage(ctx);
    let studio = null;
    startStudio({ doc: document, ctx }).then((s) => {
      studio = s;
      if (!ctx.active()) studio?.hide?.();
    });
    return {
      // The tape fetched, loaded and polled once: the shell waits for it
      // before it mounts the other rooms out of sight (router.js prewarm).
      ready: tape?.ready,
      show({ first }) {
        // The bar is the tape's here unless what it holds still plays: a
        // take stopped in the Listening Room gives way, so ▶ plays the tape
        // (lib/bar/engine.js tapeUnlessPlaying). Every visit, the first
        // after a prewarm included.
        ctx.engine?.bar.tapeUnlessPlaying();
        if (!first) {
          tape?.show?.();
          studio?.show?.();
        }
      },
      hide() {
        studio?.hide?.();
        tape?.hide?.();
      },
    };
  },
};
