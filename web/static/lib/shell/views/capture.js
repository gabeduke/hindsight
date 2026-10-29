// web/static/lib/shell/views/capture.js
// Capture as a shell view (docs/architecture/shell.md,
// The shell): mounts Capture (web/static/app.js) inside the shell, driving its
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
  // prewarm), so the first turn to it is a reveal. Its hide() has run by
  // then, so every show, the first one included, opens its live socket and
  // starts its ribbon again.
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
        capture?.show?.({ first });
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
