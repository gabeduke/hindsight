// web/static/lib/shell/views/capture.js
// Capture as a shell view (docs/architecture.md, The shell,
// step 7): mounts Capture (web/static/app.js) inside the shell, driving its
// polls, live meters, and global listeners through ctx so they go quiet while
// another room is shown.

import { mountCapture } from '../../../app.js';

export const captureView = {
  id: 'capture',
  title: 'Hindsight',
  name: 'Studio',
  bodyClass: 'main-page',
  help: 'main',
  // Mounted out of sight from the Listening Room with the tape off (router.js
  // prewarm), so the first turn to it is a reveal: its live socket opens on
  // its show, as it does on every visit.
  prewarm: true,
  mount(ctx) {
    const headerEl = document.getElementById('header-capture');
    if (headerEl) {
      headerEl.hidden = false;
      ctx.headerSlot.add(headerEl);
    }
    const capture = mountCapture(ctx);
    return {
      show({ first }) {
        if (!first) capture?.show?.();
      },
      hide() {
        capture?.hide?.();
      },
      destroy() {
        capture?.destroy?.();
      },
    };
  },
};
