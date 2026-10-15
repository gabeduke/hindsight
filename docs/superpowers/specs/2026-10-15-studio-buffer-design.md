# The Studio's buffer (P2)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** the *Studio* page of
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Builds on [the crate](2026-10-07-crate-design.md) and
[edge trim](2026-10-07-edge-trim-design.md)

## Why

Getting a good moment from the feed onto a lane, trimmed, takes about ten
touches across three pages today:

> Capture → CAPTURE → Takes → open the take → IN → OUT → Send to tape → Tape
> → crate → Paste

Gabe wants it to be one gesture on the Studio, with the lanes making room
while you work: *"take an audio sample from the live feed into a buffer or
workspace and then commit it to tape… collapse the tape swim lanes while
we're working with the buffer… then drop it onto the tape in a swim lane."*

## The buffer is the clipboard, made visible

Nothing new needs to hold the audio. The clipboard already does everything
the buffer needs:

- it lives on the Pi, in `TAPE_DIR/clipboard.json`, so it survives a reload.
  It is also the same on every device: grab on a phone, drop from a laptop;
- `POST /api/clipboard` with `{ring_from, ring_to, source}` already copies a
  span of the ring into it (`CopyRing` → `ringClip`), into a new pool file
  with handles (`TAPE_HANDLE_S` either side);
- it already holds several tracks, and a drop lays them on consecutive
  tracks (`DropClipboardAt`, through `dropBoard`), as one undo;
- it is already the crate's first row (interaction model, step 5).

So **the buffer is a view of the clipboard**: a panel on the Studio that
opens whenever the clipboard holds something the Studio grabbed, and lets you
trim it before it lands. What is new is the panel, GRAB by bars, several
sources at once, the trim, and KEEP from it.

## What

### GRAB

| How | Request | Notes |
|---|---|---|
| **GRAB · G**, last N bars | `POST /api/clipboard` `{bars: N, sources: [...]}` · new | N is the feed's 1 / 2 / 4 / 8 picker, the same number CATCH uses. Needs a grid |
| **Drag across the feed** | `POST /api/clipboard` `{ring_from, ring_to, sources: [...]}` | `source` (one) keeps working; `sources` is new |
| **A note in the Listening Room** | `POST /api/clipboard` `{take, from, to}` · exists | P5's *to the studio* |

- **Last N bars** reuses Catch's arithmetic: `lastBars` and `catchSpan`'s
  mapping from tape position to ring frames, including the output delta and
  `TAPE_LATENCY_MS`. The destination is the clipboard instead of a track.
  - With no grid (no tempo yet), the key reads **GRAB 8 s** and takes
    seconds.
  - If the tape hasn't played continuously, it takes the last N bars of
    wall-clock time at the tape's tempo, and says so.
- **Room to trim.** A grab's handles are one bar at the tape's tempo, or
  `TAPE_HANDLE_S`, whichever is longer, capped at the setting's 10 s. So IN
  and OUT can always widen by a bar.
- **Sources** are the tape's `Sources()` (`TAPE_SOURCES`: main, ch1, ch2,
  aux). The chips start on the armed track's input. Each chosen source becomes
  one clipboard track, all over the same span.
- **The ring moves on.** A span whose start has left the ring is clamped, as
  `CopyRing` does today (`oldest + 1 s`), and the panel says *clamped to what
  the ring still had*.
- **A grab replaces the clipboard**, as Copy does. If the buffer it replaces
  was never dropped or kept, it goes to the crate first, so nothing grabbed is
  lost without a TOSS. `KeepClipboard` keeps a reference to a one-clip
  clipboard; it gains the multi-track case, one crate clip per lane.

### Trim

- **IN and OUT** are grease marks on the buffer's oxide window. They move
  by drag, by `[ ]` for IN and `⇧[ ⇧]` for OUT, and by the ◂ ▸ keys. Each
  step is the snap (⌗), the same picker the ruler uses; free with snap off.
- **The window moves, the file doesn't.** A trim changes every lane's clip
  window inside its handles, as edge trim does on a tape clip:
  `PATCH /api/clipboard` `{in, out}`, in frames from the grab's start (new).
- **Fades** are the clip fade handles from interaction-model step 3, on the
  buffer's top corners. **Gain, Normalize and Reverse** act on the buffer's
  clips (`reverseClip` exists).
- **AUDITION** loops the window on this device, from `GET /api/clipboard/audio`.
  It never plays through the Pi, so the jam carries on.

### DROP

- **Drag** the buffer by its grip onto a lane. The lane under the drag opens
  to full height, and a ghost shows where it lands, snapped to the grid.
  Several lanes' ghosts sit on consecutive tracks, as the drop will put them.
- **↵ or the DROP key** drops on the armed track. It lands at the next free
  span long enough for it, from the next bar line after the playhead. The key
  names both: *DROP ON TRACK 2 · bars 9–12*.
  - The page works `at` out from the tape state it already polls, and sends
    `POST /api/tapes/drop` `{track, at}`. That route exists.
- **One undo,** as any clipboard drop. Undo puts the clips back in the buffer
  view, because the clipboard still holds them.
- **After a drop** the buffer closes, the lanes unfold, and the new block
  glows once. The clipboard keeps its contents, so ↵ drops it again further
  on.

### KEEP and TOSS

- **KEEP AS TAKE · K** saves the buffer's window as a take on the Listening
  Room's shelf, from the clipboard's own audio, so it works after the ring
  has moved on: `POST /api/clipboard/keep` (new).
  - Several lanes are summed to stereo, as MAIN sums the strips.
  - The take's label names its sources, its `source` says where it came from,
    and its tempo and downbeat are the tape's.
- **The feed's own KEEP** (`POST /api/trigger`, `?seconds=` or
  `?from=&to=`) is CAPTURE renamed, unchanged: it keeps the room, not the
  buffer.
- **TOSS · ⌫** is `DELETE /api/clipboard`, with an Undo toast.

### The page

- **Laptop and tablet** (the canvas's *Studio · laptop · buffer open*):
  - the feed above;
  - the buffer as a raised bench between the feed and the tape, with a notch
    pointing at its span on the feed;
  - the lanes folded to strips while it is open, a class on the Studio's
    body that only changes height, so nothing reflows the lane canvas's
    bitmap (the drawers' lesson);
  - **UNFOLD** gives the lanes their height back without closing the buffer.
- **Phone:** the buffer is a sheet over the folded lanes, with the
  inspector's detents (peek, half, full). Its main action is DROP ON TRACK N;
  dragging the grip up onto a lane strip also drops. The mini player tucks
  under the sheet.
- **CATCH stays** on the deck, one touch, for when the last N bars are already
  right.

## Decisions (recommended picks)

1. **The buffer is the clipboard.** No second store. It is shared across
   devices and survives a reload, both of which a client-side buffer would
   lose.
2. **GRAB copies at once**, rather than pointing into the ring until it's
   dropped: the ring overwrites after `RING_SECONDS`, and trimming can take
   longer than that.
3. **Handles of a bar** for a grab, at least, so trims can always widen.
4. **An unused buffer goes to the crate when replaced,** so nothing is lost
   without a TOSS.
5. **Audition plays on this device,** never on the Pi.

## Not in this

- **Editing inside the buffer** beyond the window, fades, gain and reverse:
  no splits or slices. Those happen on the tape.
- **A second buffer.** The crate is where earlier ones live.
- **Stems in takes.** KEEP sums its lanes; per-source takes are the rig's
  `SAVE_CHANNELS` question.

## Checks

- Go:
  - GRAB by bars lands the same span Catch would have, for the same press
    (a twin test against `lastBars` and `catchSpan`);
  - a multi-source grab makes one track per source over one span;
  - handles are at least a bar;
  - a trim never leaves the handles;
  - KEEP from the clipboard writes the window, summed;
  - a replaced, unused buffer is in the crate.
- JS:
  - the next free span finds the first gap long enough after the next bar
    line, wrapping in the loop;
  - lane folding is a class, never a reflow of the lane canvas.
- **The four frames of the canvas's *From the feed to the tape***, by touch
  and by keys, on a phone and a laptop, in both schemes, with the rooms flag
  on and off.
