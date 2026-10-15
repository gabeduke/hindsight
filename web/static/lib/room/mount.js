// web/static/lib/room/mount.js
// The Listening Room's way in (docs/superpowers/specs/2026-10-15-listening-room-design.md).
// With the rooms flag on (lib/rooms/flag.js), the takes page is the room
// seen from the doorway (doorway.js) and a take's page is the chair
// (chair.js). Each page hands start() a handle on what it already runs --
// the rack, the sheet and the bar; the take, its flags and its clock -- so
// the room adds a way of looking without a second copy of what it looks at.
//
// With the flag off it reads one localStorage key and stops: the room's
// modules aren't fetched, so nothing is drawn, listened for or asked of the
// Pi.

import { on } from '../rooms/flag.js';

const LOADERS = {
  doorway: () => import('./doorway.js'),
  chair: () => import('./chair.js'),
};

/**
 * start mounts the room on `page` ('doorway' or 'chair') with the page's
 * handle, or answers null with the flag off, touching nothing. `load`
 * fetches the room's module; tests pass their own.
 */
export function start(page, handle, { flagOn = on, load = LOADERS[page] } = {}) {
  if (!flagOn()) return null;
  if (!load) return Promise.reject(new Error(`no room for ${page}`));
  return load().then((m) => m.mount(handle));
}

/** roomOn says whether the room is on for this device. */
export const roomOn = () => on();
