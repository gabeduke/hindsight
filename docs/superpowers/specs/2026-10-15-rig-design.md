# The rig: devices as profiles, cables as settings (P6)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** the *Rig & render* page of
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Reverses decision 4 of [the interaction model](2026-10-08-interaction-model-design.md)
(*one armed track at a time*) and answers the multi-arm request of 2026-10-08

## Why

Gabe, 2026-10-14: *"We are already taking the input signals in such a way
that it can be difficult to reason about what is happening and we will soon
be adding midi controllers… Rather than changing channels in the settings as
a menu item, we could 'drop in' a virtual… object of the 1010 bento or ko
sidekick that has the ports or channels mapped to different virtual cable
types."*

What is hard to reason about today is spread across four places:

- `TAPE_SOURCES` (which USB channels are which tap, and which tape bus
  leaks into each);
- the track input chips;
- the clock and MIDI settings;
- `docs/sidekick-routing.md`, which is where you learn that bus A plays back
  into CH1's strip, so a CH1 recording contains the tape.

The rig draws all of it as one picture, and the picture is the control.

## What

P6 is the rig drawn flat:

- devices are DOM cards laid out on a desk;
- cables are SVG paths, dragged from socket to socket.

Cable physics is brief R4, and 3D is R5 and R6, in the
[scene contract](2026-10-15-scene-contract-design.md). Neither is needed for
the rig to work.

### Devices are profiles

A profile is JSON, embedded in the binary (`internal/rig/profiles/*.json`).
It gives:

- **the device's ports:** id, label, kind and direction. Kinds are audio
  jack, USB audio, MIDI and sync pulse;
- **for a USB interface, its taps:** which capture channels are which
  source, where each comes from, and which tape buses each hears;
- **its returns:** where each playback pair lands.

The Sidekick's profile is written from the measurements in
`docs/sidekick-routing.md`, and its taps are today's default `TAPE_SOURCES`
exactly:

| Tap | USB | From | Hears | Notes |
|---|---|---|---|---|
| main | 1/2 | the mix | A, B | post-fader sum |
| ch1 | 3/4 | IN 1 | A | pre-fader; return 1 lands here |
| ch2 | 5/6 | IN 2 | B | pre-fader; return 2 lands here |
| aux | 7/8 | AUX | — | digital zero when idle; joins MAIN at unity |

- **Found by id.**
  - An audio card is matched by its USB id, from ALSA's `usbid` file for the
    card (the Sidekick is `2367:9420`).
  - A MIDI device is matched by name, with the substring rule `MIDI_DEVICES`
    uses.
- **Unknown devices get a generic profile** from their channel counts: taps
  named *USB 1/2, 3/4…*, nothing assumed about what they hear. The rig then
  offers *Use these taps*, which writes `TAPE_SOURCES`.
- **The Bento's profile is a placeholder** until its manual is read, as the
  canvas marks it: MIDI in and out by name, audio ports *[from its manual]*.
  Nothing on the rig guesses a port.

### Cables are settings

The page never stores a picture of the rig. `GET /api/rig` (new) builds the
graph from the settings, the tape and what's plugged in, each time it is
asked. Plugging a cable writes a setting, and the next read draws it.

| Cable | Writes | Today | Takes effect |
|---|---|---|---|
| tap → track | the track's input: `PATCH /api/tapes` `{input: {n, source}}` | exists; outside undo | at once |
| arming tracks | `{rec_tracks: [...]}` | new (see *Multi-arm*) | at once |
| track → bus A/B | `{track: {bus}}` | exists; undoable | at once |
| OUT → a listener | `PUT /api/tapes/output` | exists | at once |
| kit → a device's clock in | `TAPE_CLOCK=lead`, `TAPE_CLOCK_OUT=name[:nudge]` | in `/api/settings` | on restart |
| a device's clock → kit | `MIDI_CLOCK_DEVICE` | in `/api/settings` | on restart |
| controller → kit | `TAPE_CONTROLLER` (P3) | new setting | on restart |
| unplugging a MIDI device | `MIDI_IGNORE` | in `/api/settings` | on restart |
| what a KEEP writes | `SAVE_CHANNELS` (one tap), or `SAVE_ALL_CHANNELS` | in `/api/settings` | on restart |
| a jack you draw | a label: `PUT /api/rig/labels` | new | at once |

- **A restart cable is drawn dashed, in amber,** until the Pi has restarted.
  The rig's **RESTART** is the settings sheet's own, with its warning: a
  restart empties the ring. `restart_needed` from `/api/settings` drives it.
- **What a KEEP writes is one tap, or all.** `SAVE_CHANNELS` is a single
  pair, so the inspector offers a choice of one, plus *all*. It is not a set
  of checkboxes, whatever the canvas drew.
- **Drawn jacks are labels.** Hindsight sees signal, not cables. A guitar
  drawn into IN 1 is a label, kept beside `settings.json` in `rig.json`
  (`{"labels": {"ep-136.in1": "guitar"}}`). Labels:
  - show on the tap, the track's input chip and the buffer's source chips;
  - never route anything;
  - draw dashed until signal arrives on their tap.

### The inspector

Tap a socket or a cable:

- **what it carries,** from the profile, in a sentence;
- **its level now,** the same per-source peak the track input chip's menu
  shows;
- **what it's patched to,** and whether that track is armed;
- **warnings,** worked out, not written:
  - a tap that hears bus A, patched to an armed track, while a track with
    clips plays on bus A, records the tape;
  - the inspector says so and offers the fix: *Move tracks 1, 4 to bus B*,
    one undoable edit.

  The same warning shows as an amber dot on the track's header in the
  Studio. The facts it needs exist already: a source's leaks are what
  `Clip.Clean` is worked out from.

### Multi-arm

Recording CH1 and CH2 onto two tracks at once, the request of 2026-10-08.
On the rig it is two cables and two red lamps.

- **The model:**
  - `Tape.RecTracks []int` (`rec_tracks`) replaces `RecTrack`;
  - `rec_track` is still answered, as the first armed track, and a PATCH of
    it still arms just that one, so older pages work through the change.
- **Arming:**
  - **● on a track's header** adds that track to, or removes it from, what is
    armed;
  - **keys 1–4, ↑ and ↓** still arm only that track, so the quick way stays
    quick.
- **Everything that records, records every armed track,** each from its own
  input, over one span, as **one undo**:
  - CATCH: `CatchRequest` gains `pairs: [{track, source}]`;
  - the passes, Catch-the-last-N, ● Rec and a punch;
  - a free loop's taps.
- **CATCH says what it did:** *last 4 bars → 2, 3*.
- **Two tracks on one tap** is allowed, and the rig draws it plainly.

### The page

- **`rig.html`** (new), reached from the device chip in the header, from
  both rooms. It joins `SHELL`, `pages.test.js` and the pages that load
  `objects.css` before `styles.css` (`materials.test.js`).
- **Layout** (the canvas's *Rig · the patch*):
  - the desk, with the devices on it;
  - the kit's patch bay: the taps, the track inputs, the buses and OUT;
  - the inspector on the right (a sheet on a phone);
  - a legend of cable kinds, which differ in **width and dash, not colour
    alone**.
- **Patching by touch:** drag from a socket and drop on a socket. A pull on
  a plug unplugs it.
- **Patching by keyboard and screen reader:** every socket is a button.
  Choose one, then choose where it goes; *Unplug* is in its menu. The
  cables are drawn over these buttons; they are not the controls.

## Decisions (recommended picks)

1. **The server owns the graph.** `/api/rig` derives it from the settings
   and the tape every time; the page draws, and never stores.
2. **Profiles are embedded JSON, matched by USB id and MIDI name.** Nothing is
   guessed, so an unknown device is generic, and the Bento waits for its
   manual.
3. **Multi-arm through `rec_tracks`,** with `rec_track` kept for old pages.
   ● toggles a track; the number keys still arm just one.
4. **Restart cables look pending until the restart,** and the rig never
   restarts on its own.
5. **Drawn jacks are labels in `rig.json`,** beside the settings, so they
   stay with the kit and not with a tape.

## Not in this

- **Stems in takes** (several taps per KEEP). `SAVE_CHANNELS` is one pair;
  changing the take format is its own spec.
- **Taking the tape out of a strip,** the "subtract the known playback" idea
  in the routing notes. Research, not a feature.
- **Routing audio by drawing,** beyond what the settings already do. The rig
  is a picture of the settings, not a mixer.
- **The 3D rig and cable physics** (briefs R4–R6).

## Checks

- Go:
  - `/api/rig` from today's default settings and the Sidekick draws exactly
    the taps of `TAPE_SOURCES`;
  - an unknown card makes a generic profile;
  - each cable writes its setting, and a restart cable reports *pending*;
  - the bus warning appears and clears as tracks change bus or empty;
  - multi-arm: Catch, the passes, a punch and taps fill every armed track
    from its own source as one undo; `rec_track` still reads and writes.
- JS:
  - the graph renders from JSON alone;
  - every socket is reachable and patchable by keyboard.
- **In a browser:**
  - phone and desktop, both schemes, with the rooms flag on and off;
  - two cables arm two tracks, and one ● records both;
  - the amber loop appears on the rig and on the Studio's track header.
