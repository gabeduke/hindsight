# Cables as ropes (R4)

**Date:** 2026-10-15 · **Status:** proposed; the brief is *R4 · Cables* in
[the scene contract](2026-10-15-scene-contract-design.md), and the rig is
[P6](2026-10-15-rig-design.md) · **Repo:** `hindsight` · **Canvas:** *Rig ·
the patch*, *Scene contract and render briefs* in
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)

## Why

P6 draws each cable as a fixed curve from socket to socket. It reads, but it
doesn't behave like a cable: a drag pulls a dotted line, a plug lands only if
the finger is over the button, and the smallest tug on a plugged socket
unplugs it (8 px). R4 makes the cables ropes, so the rig feels like a patch
bay, without changing what any cable *is*. Each cable is still a setting,
and the page still never stores the picture.

## What

### The `cable` kind (`lib/scene/cable.js`)

A model on the scene contract (R1), pure and tested with a fake `dt`.

- **State the page sets:**
  - `from`, `to`, `kind`, `pending` and `declared`: the contract's fields,
    copied from `/api/rig`'s cable;
  - `a` and `b`: where its two ends are, in desk pixels. The page measures
    the sockets' holes; a plug in the hand is at the finger;
  - `loose`: which end is in the hand rather than in a socket, if any;
  - `seed`: the points to start from, for the cable a drop just made, so it
    carries on from the rope that was in the hand;
  - `off`, `waiting` and `selected`, which only change how it's drawn.
- **The view:** `points`, 16 `{x, y}` from `a` to `b`, and `moving`.
- **The rope:**
  - verlet integration of 16 points, both ends pinned to `a` and `b`;
  - gravity, and a damping that settles a swing in about a second;
  - four constraint passes a step, alternating direction.
- **Frame-rate independence:** the rope steps at a fixed 120 Hz and the view
  is interpolated between the last two steps, so the view at a given time is
  the same at any frame rate. The stated tolerance: 0.01 px, with the ends
  exactly where the page put them.
- **How long a cable is:** as long as P6's drawn one hangs,
  `√(d² + 16⁄3·s²)` for anchors `d` apart and P6's sag `s`. A taut chord
  and a deep loop both come out of the same rule. A `declared` cable (a jack
  you drew) is a label, not a rope: it's taut, a straight line from its tag.
- **At rest at once:**
  - **A cable that appears is already hanging still,** so opening the rig
    moves nothing;
  - **`dt = Infinity`** (reduced motion, from the ticker) lands it on the
    same rest shape the motion settles to, within 1 px;
  - **only a change moves a rope:** a drag, a drop, a pull, a socket that
    moved.
- **Parking:** once every point has moved less than 0.02 px a step for six
  steps, the rope stops and its `step` returns `false`. When every rope has
  stopped the scene asks for no frames and the ticker parks.

### The plug (`lib/scene/plug.js`)

Pure rules, with their numbers in one place:

- **Snap:** a plug in the hand snaps into the nearest socket it can go into
  within **24 px** of its hole's centre, or anywhere over its button (where
  P6 dropped, so nothing that worked stops working).
- **A pull to unplug:** a plug comes out of its socket once it has been
  pulled **48 px** from the hole. Until then it stays in, leaning toward the
  finger. Once out, it stays out until it's brought back within 24 px.

### On the rig (`lib/rig/ropes.js`, `lib/rig/page.js`)

- **What's in the hand, in a drag from socket S:**
  - If S holds exactly one cable that can be unplugged, the hand holds
    **that cable's plug.** Let go while it's out, and it's unplugged. Let go
    before the pull, and nothing happens.
  - Otherwise, or once the plug comes near a socket S can go into, the hand
    holds **a new cable out of S.** It snaps in, and letting go there plugs
    it, as P6 did.
  - So the rope in the hand always shows what letting go will do.
- **A drop's cable carries on from the rope that made it,** once the next
  read draws it. A pulled cable keeps its loose end where it was let go until
  the read takes it away.
- **The renderer** is SVG, on the contract.
  - It draws each kind with P6's width, dash and ink (`kinds.js`), and P6's
    hollow, dashed pending style with open square plugs. Kinds are still
    told apart without colour.
  - It redraws only the ropes that moved, and takes no input.
  - `hit(x, y)` is the rope within 8 px of a point. A tap on a cable's run
    shows it in the inspector through `hit`, over the gear as well as the
    felt.
  - `twin(id)` is the socket button at the cable's `from` end.
- **Keyboard and screen reader:** P6's buttons are untouched. The ropes are
  drawn over them, with no pointer events, and are never the controls.
- **Positions are measured** when the desk is drawn, on a resize and when
  the fonts arrive. One is set only when an end moved by half a pixel, so a
  poll of `/api/rig` doesn't wake the ticker.

## Decisions (recommended picks)

1. **Fixed 120 Hz substeps, interpolated.** Verlet isn't frame-rate
   independent on its own; a fixed step is, and interpolation keeps it
   smooth at 20 Hz or on ragged frames. A frame longer than 100 ms only
   steps 100 ms, the way `spin` treats a tab in the background.
2. **Length from P6's sag,** so the ropes hang where P6's curves did, and
   a cable never goes taut in the hand.
3. **New cables appear at rest.** A page load or a poll that finds a
   cable shows it still; only a gesture or a layout change swings one.
4. **A pull has a threshold, 48 px,** twice the snap radius. P6 unplugged
   on any 8 px drag that ended away from a socket, which a nudge could do.
5. **P6's meaning of a drag stays.** A drop on a socket plugs a new cable
   from S; a pull unplugs S's one cable. The rope shows which, and no
   gesture becomes a move of a cable's end, because that would be two
   writes.

## Not in this

- Ropes in 3D, or tubes (R6), and device models (R5).
- Cables colliding with each other or with the gear.
- Sound, or a vibration on a plug's seat.

## Checks

- **Node, with a fake `dt`:**
  - the same view at 20, 30, 60 and 120 Hz, and on ragged frames, within
    0.01 px;
  - a rope settles, and twelve settle and park the ticker;
  - `dt = Infinity` lands on the settled shape within 1 px;
  - a declared cable is straight;
  - the snap radius (24 px in, 24.01 px out, the nearest wins, over a
    button counts);
  - the pull threshold (in at 48 px, out past it, back in only within
    24 px);
  - the renderer takes no input, draws each kind's width and dash, and
    redraws only what moved.
- **In a browser,** headless Chromium against the demo:
  - twelve cables swinging at once, with the CPU throttled 4×
    (`Emulation.setCPUThrottlingRate`) as a stand-in for a phone: the frame
    times;
  - the ticker parks once they settle: no frames asked for afterwards;
  - patching by keyboard still works with the ropes drawn;
  - 390×844 and 1440×900, both schemes, with the rooms flag on and off.
