# Inputs: see what is coming in, and record it in one move

**Status: proposed 2026-11-09, not agreed.** Written after walking the guitar
overdub in the demo (`EXTRA_INPUTS=AMS-24`, 1280×800, mouse layout; the touch
layout was not walked).

## The journey this serves

Gabe has a loop on the tape, picks up the guitar, and wants it on a track.
Today that works, in six presses: the track's input chip, `ams1` in its menu,
the track's ●, the bar's ●, ▶, ▶. What is wrong is not the mechanics.

## What the walk found

1. **An input has a config name, not a person's name.** The menu offers
   `main`, `ch1`, `ch2`, `aux`, `ams1`, `ams2`: `TAPE_SOURCES`' keys
   (`internal/tape/sources.go`). Nothing says "guitar", and the recorded part
   is labelled `ams1` too.
2. **No one place shows what is coming in.** The feed's two VU meters are the
   main pair only. An input's level is a dot in a track's chip and a short bar
   inside a menu that is closed while you play. There is no way to see, before
   arming, that the guitar is live and how hot it is.
3. **The input is the track's, so the question is asked backwards.** A player
   thinks "record the guitar"; the app asks "which track, and what does that
   track record from". Every track starts on `aux`.
4. **Four capture verbs share one screen** (GRAB, KEEP, ●, Catch), and each
   answers "from which input" its own way: GRAB follows the armed track
   ("from ams1 · armed"), ● follows it too, Catch has its ▾, and KEEP saves
   `SAVE_CHANNELS` (1, 2 by default), so **a KEEP does not hold the guitar**
   unless a setting is changed.
5. **The first press of ● looks like nothing happened.** It readies and says
   so in a toast; a second press of ● cancels. The toast is the only sign.
6. **The armed head changes size.** Choosing `ams1` wraps track 2's level
   slider onto a second row, so the lane grows when its input changes.
7. **The input menu opens over the track it belongs to.**

## Decisions to agree

1. **An input has a name a person gives it**, kept on the Pi with the rig
   (`guitar` for `ams1`), shown everywhere a source is named. The config key
   stays the id.
2. **One inputs strip in the Studio**, where the feed's two meters are now: a
   meter per input that has signal or is in use, by name, always visible. It
   is a component (`lib/components/inputs/`) on a model of the sources
   (`lib/models/sources.js`): the first component built for a journey rather
   than moved as it stood.
3. **A tap on an input's meter arms it**: the armed track takes that input,
   or the first empty track does if none is armed. The track's own chip stays,
   as the way to change one track.
4. **Every capture verb reads the same answer**, the armed input, and says so
   in the same words. KEEP keeps the armed inputs as well as the main pair.
5. **● readied is drawn on the key and the lane**, not only in a toast.
6. **A track's head keeps its height** whatever its input is called.

Not in this spec: monitoring (the Pi never monitors), the rig's mixer tab,
the correlation lock for the extra input's offset.

## What comes out

- The per-input level bars inside the track input menu, once the strip shows
  them.
- The feed's L/R pair as its own thing: it becomes the strip's first meter.
- "from aux · armed" under GRAB, if decision 4 makes it redundant.

## Build order

1. The sources model and input names (Go: a name per source in the rig's
   settings; JS: `lib/models/sources.js`), with its tests.
2. The inputs strip as a component, in the harness, then in the Studio.
3. Tap to arm, and the verbs reading one answer; KEEP's channels.
4. ● readied on the key and lane; the head's fixed height.
5. A flow, J1.x: "the guitar onto a track", from a live meter to a part on
   the lane, on the tablet profile with the demo's extra input on.
