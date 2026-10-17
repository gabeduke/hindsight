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
 * start mounts the room on `page` ('doorway' or 'open') with the page's
 * handle. `load` fetches the room's module; tests pass their own.
 */
export function start(page, handle, { load = LOADERS[page] } = {}) {
  if (!load) return Promise.reject(new Error(`no room for ${page}`));
  return load().then((m) => m.mount(handle));
}
