# 0003. Rooms are the only UI: a shell, not a hand-off

**Date:** Recorded 2026-10-16 and 2026-10-17 (the shell spec, c162da80; the
shell handoff, e7c07b80).

## Decision

The Studio and the Listening Room (and Capture) are views of one document,
`shell.html`. Rooms stay mounted after their first visit and are hidden, not
rebuilt, when you leave. There is no other layout and no flag that brings
the old pages back.

## Gabe's words

On the rooms flag: *"the media player should be a 'buffer' of sorts that
works across both rooms … currently if I play a tape in the listening room
and then navigate to studio it stops playing."*

## Why

Each room was its own HTML page, and a page's audio dies when it unloads.
The bar wrote the take and frame to sessionStorage for the next page to pick
up (`lib/bar/carry.js`, `handoff.js`): a restart, and only for a take, not
the tape or the live feed. Browsers cannot keep audio alive across a page
load, so a better hand-off could not close the gap; the player has to live
in something that is not replaced. A view rebuilt on each visit registers
its listeners again, and a listener registered twice makes Space press ▶
twice.

## What it rules out

Rebuilding a view on each visit; a `:root[data-rooms]` gate or any second
layout (`architecture.test.js` fails if one comes back); a room that
navigates by assigning `location`.

## See

`docs/architecture/shell.md`, *The shell*
