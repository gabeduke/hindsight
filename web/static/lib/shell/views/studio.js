// web/static/lib/shell/views/studio.js
// The Studio as a shell view (docs/architecture.md, The shell,
// step 6): mounts the tape page (lib/tape/page.js), the Studio ribbon and buffer
// (lib/rooms/mount.js), and Play mode (lib/play/mount.js) inside the shell,
// driving their polls, frame loops, and global listeners through ctx so they
// go quiet while another room is shown.

import { mountTapePage } from '../../tape/page.js';
import { start as startStudio } from '../../rooms/mount.js';
import { start as startPlay, on as playFlagOn } from '../../play/mount.js';

export const studioView = {
  id: 'studio',
  title: 'Hindsight — tape',
  name: 'Studio',
  bodyClass: 'tape-page',
  help: 'tape',
  mount(ctx) {
    const headerEl = document.getElementById('header-studio');
    if (headerEl) {
      headerEl.hidden = false;
      ctx.headerSlot.add(headerEl);
    }
    for (const id of ['clip-editor', 'multi-bar']) {
      const el = document.getElementById(id);
      if (el) ctx.dockSlot.add(el);
    }
    const tape = mountTapePage(ctx);
    let studio = null;
    let play = null;
    startStudio({ doc: document, ctx }).then((s) => {
      studio = s;
      if (!ctx.active()) studio?.hide?.();
    });
    const syncPlay = () => {
      if (playFlagOn() && !play) {
        startPlay({ doc: document })?.then((p) => {
          play = p;
          if (!ctx.active()) play?.hide?.();
        });
      } else if (!playFlagOn() && play) {
        play.destroy?.();
        play = null;
      } else if (play) {
        play.show?.();
      }
    };
    syncPlay();
    return {
      show({ first }) {
        if (!first) {
          tape?.show?.();
          studio?.show?.();
          syncPlay();
        }
      },
      hide() {
        play?.hide?.();
        studio?.hide?.();
        tape?.hide?.();
      },
      destroy() {
        play?.destroy?.();
        play = null;
      },
    };
  },
};
