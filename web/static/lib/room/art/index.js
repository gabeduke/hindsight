// web/static/lib/room/art/index.js
// Which function draws which object of the room (ROOM.objects' `art`). Each
// is self-contained -- draw(o, ctx) → SVG -- so any one of them can be
// redrawn, or swapped for a model in a 3D renderer, without the others
// knowing.

import { wall, floor } from './shell.js';
import { sash, curtain, poster } from './window.js';
import { credenza, speaker, deck, shelves } from './hifi.js';
import { lamp, table, glass } from './corner.js';
import { rug, amp } from './floor.js';
import { chair } from './chair.js';

export const ART = Object.freeze({
  wall, floor, window: sash, curtain, poster,
  console: credenza, speaker, deck, shelves,
  lamp, table, glass, rug, amp, chair,
});
