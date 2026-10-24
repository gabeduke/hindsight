// web/static/lib/shell/boot.js
// The shell's boot (docs/architecture.md, The shell, step 4):
// creates the audio engine, the header's nav and help, the link monitor, and
// mounts the shell's views through createView and createRouter.

import { initHelp } from '/lib/help/help.js';
import { showPresses } from '/lib/ui/keys.js';
import { initNav, navTabs } from '/lib/nav.js';
import { toast } from '/lib/toast.js';
import { watchLink } from '/lib/link.js';
import { createEngine } from '/lib/bar/engine.js';
import { createView } from '/lib/shell/view.js';
import { createRouter } from '/lib/shell/router.js';
import { roomView } from '/lib/shell/views/room.js';
import { studioView } from '/lib/shell/views/studio.js';
import { captureView } from '/lib/shell/views/capture.js';
import { ensureStudioSheets } from '/lib/rooms/sheets.js';

const $ = (id) => document.getElementById(id);

// Ensure global sheets (phone, settings, update) are stamped into the document at boot
ensureStudioSheets(document);

const help = initHelp({ page: 'takes' });
// Every key goes down the moment it is touched (after help, which has the
// first say over a tap in help mode).
showPresses(document);
const tapes = initNav();
let router = null;
const engine = createEngine({ tapes, onToast: toast, go: (url, opts) => router?.go(url, opts) });
const link = watchLink(() => {});

const tapeOn = () => {
  try {
    const v = localStorage.getItem('hindsight.tapeOn');
    return v === 'true' ? true : v === 'false' ? false : null;
  } catch {
    return null;
  }
};

const slots = {
  header: { parent: () => document.querySelector('.appbar'), before: () => document.querySelector('.appbar > .appbar-end') },
  dock: { parent: () => $('np-dock'), before: () => $('np') },
  bar: { parent: () => $('np') },
};

const shared = { engine, tapes, toast, link, go: (url, opts) => router.go(url, opts) };

const views = [];
const studioRoot = $('view-studio');
if (studioRoot) {
  views.push(createView(studioView, {
    root: studioRoot,
    slots,
    shared,
  }));
}
const roomRoot = $('view-room');
if (roomRoot) {
  views.push(createView(roomView, {
    root: roomRoot,
    slots,
    shared,
  }));
}
const captureRoot = $('view-capture');
if (captureRoot) {
  views.push(createView(captureView, {
    root: captureRoot,
    slots,
    shared,
  }));
}

router = createRouter({
  views,
  tapeOn,
  chrome: {
    setPath(path) {
      const nav = document.querySelector('.appnav');
      if (!nav) return;
      const tabs = navTabs(path, tapeOn() !== false);
      for (const a of nav.querySelectorAll('a[data-tab]')) {
        const t = tabs.find((x) => x.id === a.dataset.tab);
        if (t && t.current) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
    setHelp(page) {
      help.setPage?.(page);
    },
  },
});

router.start();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
