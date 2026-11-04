// The Transport's surface in the components' harness (scripts/components.mjs,
// page.js): the props the shell's boot hands it (lib/shell/boot.js), made
// here in the bare page. The bar's layout on the harness page's body and
// its root (lib/bar/layout.js); the phone's player over the root itself,
// as Open has it (lib/bar/player.js playerSheet); the room shown, as the
// case tells it; and the relay the Studio would press its keys through
// (lib/components/relay.js). OUT is the case's to record (props: ['output']).
// Served at /__components/transport.surface.js; never shipped.

import { barLayout } from '/lib/bar/layout.js';
import { playerSheet, PHONE } from '/lib/bar/player.js';
import { relay } from '/lib/components/relay.js';
import { TAPE_KEYS } from '/lib/components/transport/index.js';

export default function surface({ root, layers, told }) {
  const layout = barLayout(document, { root });
  const player = playerSheet(root, { root, layers, layout, phone: matchMedia(PHONE) });
  return {
    layout,
    player,
    room: () => told.room ?? null,
    onRoom: () => () => {},
    tapeKeys: relay(TAPE_KEYS),
  };
}
