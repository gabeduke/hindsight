// web/static/lib/rooms/flag.js
// The two rooms (docs/superpowers/specs/2026-10-15-rooms-design.md): the
// Studio and the Listening Room in place of Capture, Takes and Tape. They
// were a per-device preview; they are now the only layout, so this answers
// yes everywhere. It goes once its callers lose their old-layout branches.

export const ROOMS_FLAG = 'hindsight.rooms';

/** on says the two rooms are on: they always are. */
export function on() {
  return true;
}
