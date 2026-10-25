// web/static/lib/room/mount.js
// The Listening Room's way in (docs/superpowers/specs/2026-10-15-listening-room-design.md).
// The takes page is the room seen from the doorway (doorway.js) and a take's
// page is Open (open.js). Each page hands start() a handle on what it
// already runs -- the rack, the sheet and the bar; the take, its flags and
// its clock -- so the room adds a way of looking without a second copy of
// what it looks at. The room's modules are fetched only when a page starts
// it.

const LOADERS = {
  doorway: () => import('./doorway.js'),
  open: () => import('./open.js'),
};

/**
 * BODY is the class each room has on <body> while it is shown. The page
 * puts it on (the Listening Room's view, in its bodyClass), not the room's
 * mount: a room may be mounted out of sight while another is shown
 * (lib/shell/router.js prewarm), and its class would mark that one.
 */
export const BODY = Object.freeze({ doorway: 'room-on' });

/**
 * start mounts the room on `page` ('doorway' or 'open') with the page's
 * handle. `load` fetches the room's module; tests pass their own.
 */
export function start(page, handle, { load = LOADERS[page] } = {}) {
  if (!load) return Promise.reject(new Error(`no room for ${page}`));
  return load().then((m) => m.mount(handle));
}
