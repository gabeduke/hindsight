// web/static/lib/rig/gesture.js
// What the rig's gestures decide, apart from the page they happen on: the
// calls page.js makes while a plug is dragged, let go, and the rope it
// leaves behind carries on. Pure, so each can be tested without a browser;
// page.js measures and asks the DOM, and passes the answers in.

/**
 * deskClick says what a click that reached the desk is.
 *
 *   'spent'   -- the click a drag leaves behind (`drag` is the {suppress}
 *                that endDrag sets). Let go on a different socket from the
 *                one pressed, Chrome sends it to their common ancestor: the
 *                desk, not a button. It is no tap on whatever rope is under
 *                the drop point.
 *   'control' -- on a button or other control, which handles its own.
 *   'rope'    -- a tap on the desk: look for a rope under it.
 */
export function deskClick(drag, onControl) {
  if (drag && drag.suppress) return 'spent';
  return onControl ? 'control' : 'rope';
}

/**
 * release says what letting go of the plug in the hand does:
 *
 *   'patch'   -- it is snapped into a socket (`over`) it can go into;
 *   'unplug'  -- it was holding a cable's plug, pulled out (`out`), and is
 *                let go in the open;
 *   'nothing' -- the rope falls back as it was.
 *
 * `onSocket` is whether any socket's button is under the finger, valid
 * target or not. Over one, the plug isn't out: a mis-drop onto a socket it
 * can't go into changes nothing, as in P6 -- snap() knows only the sockets
 * it can go into, so without this a finger over any other socket's button
 * counted as pulled clear.
 */
export function release({ over, from, canPatch, holding, out, onSocket }) {
  if (over && over !== from && canPatch) return 'patch';
  if (holding && out && !onSocket) return 'unplug';
  return 'nothing';
}

/**
 * dropSeed is where a cable `c` ({from, to}) the graph now has starts, if it
 * is the one a drop just made (`dropped`, {from, to, points}): the points
 * of the rope that was in the hand, end for end if it runs the other way.
 * So the cable carries on from that rope rather than popping into place.
 */
export function dropSeed(dropped, c) {
  if (!dropped || !dropped.points) return undefined;
  if (c.from === dropped.from && c.to === dropped.to) return dropped.points;
  if (c.from === dropped.to && c.to === dropped.from) return [...dropped.points].reverse();
  return undefined;
}

/**
 * remade says an existing rope, whose state is `old` ({from, to}), must be
 * taken off and made again from the drop's seed: it is the dropped cable,
 * under the id a cable already had (a drop onto an occupied socket
 * re-patches it), and its ends are not what the rope was. A seed only
 * applies when a rope is created; setting new ends on the old one would
 * leave it where it was, and drop the rope in the hand to fall back.
 */
export function remade(old, c, dropped) {
  return !!old && dropSeed(dropped, c) !== undefined && (old.from !== c.from || old.to !== c.to);
}
