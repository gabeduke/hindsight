// web/static/lib/shell/boot.js
// The shell's boot (docs/architecture/shell.md, The shell):
// creates the audio engine and the bar that draws it, the header's nav and help, the link monitor, and
// mounts the shell's views through createView and createRouter.

import { initHelp } from '/lib/help/help.js';
import { showPresses } from '/lib/ui/keys.js';
import { initNav, navTabs } from '/lib/nav.js';
import { toast } from '/lib/toast.js';
import { watchLink } from '/lib/link.js';
import { createEngine } from '/lib/models/engine.js';
import { NowPlaying } from '/lib/bar/bar.js';
import { barLayout } from '/lib/bar/layout.js';
import { playerSheet, PHONE } from '/lib/bar/player.js';
import { measureBar } from '/lib/bar/slots.js';
import { phoneRecorder } from '/lib/phone/recorder.js';
import { outputSheet } from '/lib/tape/out-switch.js';
import { createView, shellScope } from '/lib/shell/view.js';
import { barTop } from '/lib/ui/menu.js';
import { createRouter } from '/lib/shell/router.js';
import { roomView } from '/lib/shell/views/room.js';
import { studioView } from '/lib/shell/views/studio.js';
import { captureView } from '/lib/shell/views/capture.js';
import { ensureStudioSheets } from '/lib/rooms/sheets.js';
import { layersOf } from '/lib/ui/layers.js';
import { createNotesDrawer } from '/lib/room/drawer.js';
import { barNotes } from '/lib/room/notes.js';
import { createTakes } from '/lib/models/takes.js';
import { createTape } from '/lib/models/tape.js';
import { createProtocol } from '/lib/models/protocol.js';

const $ = (id) => document.getElementById(id);

// Ensure global sheets (phone, settings, update) are stamped into the document at boot
ensureStudioSheets(document);

// The one stack of open things (lib/ui/layers.js): ☰, the phone's player
// and each room's menus, sheets and selection, so Back and Escape close the
// top one before they leave a room.
const layers = layersOf(document);
const help = initHelp({ page: 'takes' });
// Every key goes down the moment it is touched (after help, which has the
// first say over a tap in help mode).
showPresses(document);
const tapes = initNav(document, { layers });
// The page's protocol client (lib/models/protocol.js): the one module that
// names a route the models ask, shared by the takes, the tape and the
// transport.
const protocol = createProtocol();
const link = watchLink(() => {});
// The page's takes (lib/models/takes.js): the one list every room and the
// bar read, asked for when the tape's changes socket says it moved (the
// engine feeds it), and by the shown room's tick when it can't vouch for it.
const takes = createTakes({ protocol });
// The page's tape (lib/models/tape.js): the loaded tape as the Pi has it,
// the page's one poller of it, read by the bar's transport and the Studio.
const tape = createTape({ protocol, link });
let router = null;
const engine = createEngine({ tapes, takes, tape, protocol, onToast: toast, go: (url, opts) => router?.go(url, opts) });
// What is the page's around the bar, the surface's (step 5c): the bar's
// root is #np, in the dock (#np-dock) with what a room docks above it.
const npRoot = $('np');
// The bar's layout (lib/bar/layout.js): folded, the phone's player up,
// something docked above it; the page lays out around it, the Studio hears
// it change (ctx.barLayout), and the bar's root says it on itself. The
// fold is kept for the visit.
const pageStorage = (() => { try { return sessionStorage; } catch { return null; } })();
const layout = barLayout(document, { root: npRoot, storage: pageStorage });
// Its height, for the pages that keep clear of it (--np-h on <html>).
measureBar(npRoot);
// The phone's player (lib/bar/player.js): the dock, the bar and its
// drawers, pulled up over the page as a sheet; the bar's keys open it.
const player = npRoot ? playerSheet($('np-dock') || npRoot, { root: npRoot, layers, layout, phone: matchMedia(PHONE) }) : null;
// The page's one phone recorder (lib/phone/recorder.js), on the phone
// sheet stamped above: the bar's ● keys and the rooms' ● Phone show it.
const recorder = phoneRecorder(document, { toast });
// The Output sheet, where the tape plays (lib/tape/out-switch.js): wired
// the first time it is opened, from OUT on the bar's display or the
// Studio, once the engine has a tape to send; it asks the Pi as it opens,
// so it's never a few seconds behind.
const openOutput = outputSheet(engine);
// The bar (lib/bar/bar.js) draws the engine on #np, the same in every room;
// the room shown is the router's, and the bar is kicked as it switches. It
// belongs to no room: it reaches past its root through the shell's scope
// (shellScope, lib/shell/view.js), handed in as a component's cx is
// (lib/components/mount.js), with what is the page's in its props.
const shell = shellScope({ shared: { layers } });
const np = new NowPlaying(npRoot, { engine, tape, recorder }, {
  on: shell.ctx.on,
  media: shell.ctx.media,
  layers: shell.ctx.layers,
  visible: shell.ctx.active,
  floor: barTop(document),
  toast,
  props: { layout, player, output: openOutput, room: () => router?.shown() ?? null },
});

// The notes drawer (lib/room/drawer.js), the shell's one, the same in every
// room: ✎ on the bar opens it on the take in the bar at the frame being
// heard; the take plays on and the URL stays. A room that lists takes hears
// what changed through notes.onChange.
const drawer = createNotesDrawer({ doc: document, layers, toast });
const noteHooks = new Set();
const notes = {
  /** onChange calls fn(take) when the drawer changes a take; answers a way off. */
  onChange(fn) { noteHooks.add(fn); return () => noteHooks.delete(fn); },
};
// A second ✎ before the first one's take has come back wins: only the
// newest press opens.
let presses = 0;
engine.setOnNote(async (f) => {
  const press = ++presses;
  const open = drawer.source;
  try {
    let src = open;
    if (open && open.name === f.take) await open.reload();
    else {
      src = await barNotes(f.take, {
        bar: engine.bar,
        go: (url) => router.go(url),
        onChanged: (t) => { for (const fn of noteHooks) fn(t); },
      });
    }
    if (press !== presses) return;
    drawer.open(src, { at: f.frame });
  } catch (e) {
    toast(`Couldn’t open the notes: ${e.message}`, 'bad');
  }
});

const tapeOn = () => {
  try {
    const v = localStorage.getItem('hindsight.tapeOn');
    return v === 'true' ? true : v === 'false' ? false : null;
  } catch {
    return null;
  }
};

const docked = new Map(); // each view's dock slot: whether what it holds shows
const slots = {
  // A room's context goes at the start of the header (css/chrome.css), after
  // the brand; a part of it for the tools zone says so where it adds it.
  header: { parent: () => document.querySelector('.appbar-start') },
  // What a room shows there is docked above the bar: the bar's root says
  // so (data-docked), whichever room's it is.
  dock: { parent: () => $('np-dock'), before: () => $('np'), onShown: (who, on) => { docked.set(who, on); layout.set({ docked: [...docked.values()].some(Boolean) }); } },
  // The bar: its strip ([data-slot="strip"]) is a place a room fills, the
  // Studio with its overview, at the strip's start.
  bar: { parent: () => $('np'), places: { strip: () => $('np')?.querySelector('[data-slot="strip"]') } },
};

const shared = { engine, barLayout: layout, tapeKeys: np.tapeKeys, openOutput, tapes, takes, tape, toast, link, layers, notes, go: (url, opts) => router.go(url, opts) };

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
      // The room shown changed: the bar says whether the tempo opens a menu.
      np.kick();
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
    // The room arriving has its body classes: the bar's root says its fold
    // now, in the same frame (lib/bar/layout.js), not in setPath, which
    // runs once the room has been revealed.
    classesGiven: () => layout.sync(),
    // Switching rooms closes the menus (☰ belongs to no room), and the
    // room's own sheets and selection, which its hide would close anyway,
    // before the history is written; the phone's player stays up.
    beforeSwitch: () => layers.leave({ keep: ['player'] }),
  },
});

// Once the first room is up, the rooms its tabs lead to are mounted out of
// sight in idle time, so the first turn to one is never a mount.
router.start().then((r) => { if (r === 'shown') return router.prewarm(); return null; }).catch((e) => console.error(e));

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
