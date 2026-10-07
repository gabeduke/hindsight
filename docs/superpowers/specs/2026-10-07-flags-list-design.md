# A flags list, and ↺ 5 s (C3)

**Date:** 2026-10-07 · **Status:** step C3 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

A take's flags are pins on its ruler. That works for a few, close together.
In a long take, the flag you want is off the screen, and its name only shows
when you tap its pin. The takes page's cassette pane already lists a take's
flags as chips with their names and times, but the take page itself, where
you'd want to jump to one, has no list.

Listening back also needs a "say that again". A recorder has a skip-back
key. Here you'd have to find the spot on the scrubber, which is fiddly on a
phone, mid-song.

## What

### The flags list

- **⚑ N**, beside ◂⚑ ⚑▸ in the take page's toolbar, says how many flags
  the take has. It opens a sheet listing them.
- **The sheet** lists the flags in time order, each with ⚑, its name and
  its time. It reuses `flagChips` from `lib/shelf.js` and the pane's
  chip look, one per line. A long list scrolls inside the sheet.
- **Tapping one** closes the sheet, moves the playhead there, follows it in
  the view, and plays. If a looping selection doesn't include the flag,
  Loop goes off; otherwise ▶ would start at In. The focus goes to ▶, so
  Space pauses.
- **Times are to the tenth** (`fmtTenths`), as the bar's window reads them,
  so two flags a moment apart differ.
- **The chip's name** says how many flags, for a screen reader; the ⚑ is
  decoration.
- **Under the open sheet** the take page's keys do nothing (J, F, ⌘Z…).
  That holds under any dialog.
- With no flags, the sheet says how to drop one: ⚑, or F.

### ↺ 5 s

- **↺ 5 s** goes back five seconds, whether or not the take is playing.
- **Where:**
  - in the take page's transport, between |◂ and ▶;
  - in the bar on Capture and Takes, for a take or the tape (it seeks the
    bar's source);
  - **J** does the same on all three pages.
- **The tape page** gets the key **J** only: its transport (|◂ ▶ ⟲ ● ♩) has
  no room left at 1024 px. J locates the tape five seconds back.
- **On a phone,** the mini player keeps just ▶, as before; ↺ 5 s is in the
  full player.
- J does nothing while typing, under a dialog, or on a held key's repeats.
  The take page and the bar read it by its character (`e.key`). The tape
  page reads all its keys by position (`e.code`), as it always has.
- **Back from what this device hears.** On a phone playing the tape here,
  that's behind the Pi's playhead by the stream's buffer. The bar uses the
  tape source's `heardHere`, and the tape page uses `live.heard`, so five
  seconds back is five seconds of what was heard.
- **Looping,** ↺ 5 s doesn't go back past In, since ▶ would start there
  anyway.

## Not in this step

- Editing flags from the list (rename, delete). A tap on a pin does that,
  where the flag is.
- A setting for the skip length. Five seconds is the recorder's.

## Tests

- **Node:**
  - `help.test.js` lets the sheet's Done go without a tip, as the flag
    sheet's does;
  - `fmtTenths` in `geometry.test.js`.
- **Smoke:**
  - `smoke-takes.mjs`:
    1. ⚑ N counts the flags;
    2. the list is in time order, named, with times;
    3. a tap plays from the flag and closes the sheet;
    4. J goes back five seconds and plays on;
    5. J under the open list moves nothing;
    6. a flag outside a looping selection plays from the flag, with Loop
       off;
    7. the takes page's ↺ 5 s goes back five seconds.
  - `smoke-tape.mjs`: J goes back five seconds of tape.
- **Guide:**
  - §3: the bar's keys;
  - §4: the toolbar, the bar, Playing and Flags, with two [demo] checks;
  - §8.2: J;
  - two `TIPS` and §9 rows;
  - `sw.js` goes to v49.
