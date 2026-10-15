// Offline shell for the Hindsight UI.
//
// Only ever registered in a secure context (see app.js). Caching is a
// convenience for the app shell — the recordings and the live stream come from
// the Pi itself, so there is nothing useful to serve when it is unreachable.

// Bump whenever SHELL changes, so installed phones fetch the new shell.
const CACHE = 'hindsight-shell-v78';
const SHELL = [
  '/',
  '/index.html',
  '/wave.html',
  '/takes.html',
  '/objects.css',
  '/styles.css',
  '/app.js',
  '/lib/flags.js',
  '/lib/update.js',
  '/lib/live.js',
  '/lib/link.js',
  '/lib/meter.js',
  '/lib/objects/ribbon.js',
  '/lib/objects/ribbonmath.js',
  '/lib/objects/ribbon-draw.js',
  '/lib/takes.js',
  '/lib/toast.js',
  '/lib/client.js',
  '/lib/trash.js',
  '/lib/playall.js',
  '/lib/wakelock.js',
  '/lib/theme.js',
  '/lib/nav.js',
  '/lib/shelf.js',
  '/lib/tags.js',
  '/lib/tags-dialog.js',
  '/lib/shelf-page.js',
  '/lib/shelf-detail.js',
  '/lib/objects/cassette.js',
  '/lib/objects/cassette-geom.js',
  '/lib/objects/motion.js',
  '/lib/objects/vu.js',
  '/lib/phone/recorder.js',
  '/lib/phone/uploader.js',
  '/lib/phone/worklet.js',
  '/lib/wave/geometry.js',
  '/lib/wave/tiles.js',
  '/lib/wave/view.js',
  '/lib/wave/overview.js',
  '/lib/wave/clock.js',
  '/lib/wave/page.js',
  '/lib/wave/share.js',
  '/lib/wave/lanes.js',
  '/lib/wave/rising.js',
  '/lib/wave/draw.js',
  '/lib/wave/tape-strip.js',
  '/lib/wave/rowwave.js',
  '/lib/objects/grease.js',
  '/lib/objects/pennant.js',
  '/lib/objects/icons.js',
  '/lib/wave/boundary.js',
  '/lib/wave/near.js',
  '/lib/wave/onset.js',
  '/lib/wave/cut-label.js',
  '/lib/wave/send.js',
  '/lib/edit/gestures.js',
  '/lib/edit/editor-bar.js',
  '/lib/help/help.js',
  '/lib/help/tips.js',
  '/lib/help/markdown.js',
  '/lib/device-prefs.js',
  '/lib/settings.js',
  '/lib/play/flag.js',
  '/lib/play/clock.js',
  '/lib/play/link.js',
  '/lib/play/surface.js',
  '/lib/play/keymap.js',
  '/lib/play/screen.js',
  '/lib/play/mount.js',
  '/lib/rooms/flag.js',
  '/lib/rooms/mount.js',
  '/lib/rooms/studio.js',
  '/lib/rooms/keep.js',
  '/lib/tape/page.js',
  '/lib/tape/poll-gate.js',
  '/lib/tape/geometry.js',
  '/lib/tape/levels.js',
  '/lib/tape/away.js',
  '/lib/tape/away-sheet.js',
  '/lib/tape/stream-buffer.js',
  '/lib/tape/stream-player.js',
  '/lib/tape/stream-worklet.js',
  '/lib/tape/listener.js',
  '/lib/objects/reels.js',
  '/lib/tape/blocks.js',
  '/lib/tape/clipgestures.js',
  '/lib/tape/sections.js',
  '/lib/tape/timeedit.js',
  '/lib/tape/selection.js',
  '/lib/tape/range.js',
  '/lib/tape/align.js',
  '/lib/tape/rec.js',
  '/lib/tape/output-ui.js',
  '/lib/tape/out-switch.js',
  '/lib/tape/pending.js',
  '/lib/tape/overview.js',
  '/lib/objects/lcd.js',
  '/lib/objects/reel-window.js',
  '/lib/bar/bar.js',
  '/lib/bar/tape-source.js',
  '/lib/bar/take-source.js',
  '/lib/bar/player.js',
  '/guide.html',
  '/tape.html',
  '/fonts/barlow-condensed-600.woff2',
  '/fonts/barlow-condensed-700.woff2',
  '/fonts/ibm-plex-sans-400.woff2',
  '/fonts/ibm-plex-sans-600.woff2',
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-mono-600.woff2',
  '/fonts/permanent-marker-400.woff2',
  '/manifest.json',
  '/icons/icon-192.png?v=2',
  '/icons/icon-small.svg?v=2',
  '/icons/favicon-32.png?v=2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network-first so a redeploy is picked up immediately, cache as fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
