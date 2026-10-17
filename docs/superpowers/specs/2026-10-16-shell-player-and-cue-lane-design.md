# One player, two rooms: the shell, the cue lane and the output switch

**Date:** 2026-10-16 · **Status:** proposed; decisions below agreed with Gabe on
2026-10-16 · **Repo:** `hindsight` · **Picture:**
[One player, two rooms](https://claude.ai/artifact/9oJSxmvQhTnrBvVr2Uiz5o) (private
design note: the diagrams this spec refers to) · Builds on
[the Studio's buffer](2026-10-15-studio-buffer-design.md) and
[the rooms](2026-10-15-rooms-design.md)

This is three changes, in the order they should be built. Each is its own
spec-to-merge; this note fixes the shape of all three so none of them has to
be redone for the next.

## Why

Gabe, on the rooms flag: *"the media player should be a 'buffer' of sorts that
works across both rooms. When we have an audio source to consume it should
continue playing in both pages — currently if I play a tape in the listening
room and then navigate to studio it stops playing."*

Each room is its own HTML page, and a page's audio dies when it unloads. The bar
writes the take and frame to sessionStorage and the next page picks up from
there (`lib/bar/carry.js`, `handoff.js`). That is a restart, and it exists
only for a take: not the tape, not the live feed. Browsers cannot keep audio
alive across a page load, so a better hand-off cannot close the gap. The
player has to live in something that is not replaced.

## Decisions

| | |
|---|---|
| Shell, not hand-off | One document holds the player; **Studio** and **Listening Room** are views mounted inside it. Agreed. |
| Name | **Cue lane**. "Buffer" stays for GRAB's sheet (the clipboard). |
| Launch | A clip starts on the **next bar line** and **loops until tapped again**. Shift starts it at once. |
| Cue button | A **Cue** button on the cue lane solos it in the output, so clips can be heard alone before they go to tape. |
| Clock | Cue lane and tape **share the transport's clock and loop**, summed to one output. |
| Contents | Takes from the Shelf, GRABs from the buffer, and clips lifted from a track. |
| Trim | Reuses the existing clip editor (trim, fades). |
| To tape | The user **drags clips down** from the cue lane onto a tape track when they are happy. Dropping copies; the cue lane keeps its clip until removed. |
| Notes | The Sketchbook goes. Notes become a **bookmark** that appears when a clip is loaded; pulling it down annotates what is playing and drops a flag, as an **overlay** on the room, never a page. |

## 1. The shell

- A shell document (`shell.html` or the existing `/` with the flag on) owns the
  header, the player, the audio engine, and a `<main>` the views mount into.
  The Studio and Listening Room views are today's `tape.html` / `index.html`
  contents, mounted and unmounted by a small router (`history.pushState`; Back
  and Forward work; a reload lands on the same view).
- The **engine** (the bar's `NowPlaying`, its sources, the `ticker`) is created
  once by the shell and handed to each view. Views never create audio.
- Behind **both flags** (`hindsight.rooms`, plus `hindsight.play` for what that
  covers). With the flags off nothing changes: the old multi-page behaviour is
  untouched.
- The other pages (Takes, Rig, Guide, Settings) stay ordinary pages in this
  step. Leaving the shell for one of them still uses the existing hand-off.
  Folding them in is a later decision, not part of this.
- `carry.js` and `handoff.js` stay as the fallback for those pages and for a
  reload, so it is a reduction, not a rewrite.
- **Risks to settle in the plan:** each view currently assumes it owns
  `document` (ids, `<head>` assets, `:root[data-rooms]` set before first paint,
  `body.tape-page` classes); mount and unmount must clean up listeners, tickers
  and polls so a view that is not on screen costs nothing. The architecture
  guardrails (Controller → Model → Renderer, one shared `ticker`) are what make
  this tractable: views already take controllers, not the DOM.

## 2. The cue lane

A lane above tracks 1–4 in the Studio, with a head like a track's so
everything lines up with the feed and lanes (see the 2026-10-16 alignment
change).

- **Lane head:** the name (CUE), the **Cue** solo button, and a level.
- **Clips:** any clip appended is **thrown**: it is placed on the lane at once
  and playable. Per clip: launch, loop on/off, trim (opens the clip editor),
  annotate (drops a flag, see Notes), remove.
- **Persistence:** the lane belongs to the loaded tape's session and survives a
  reload. It lives with the tape's state (`/api/tapes/state`), not the
  clipboard. It is not part of the mix export unless a clip is dragged to a
  track.
- **Drag to tape:** pointer-drag of a clip onto a track lane, reusing the
  buffer's drag ghost, overlay and landing glow (`lib/buffer/`).
- **Collapse, later:** with the cue lane open the four tracks collapse to one
  strip, and the reverse; this mirrors how the buffer folds the lanes now
  (`body.buffer-fold`). Not in the first cut: the cue lane first sits above
  the four tracks at their usual height.
- **Name collision:** the buffer (GRAB, the clipboard) stays. GRAB → buffer
  sheet → **drop on the cue lane** is the quick path; the buffer's drop target
  list gains the cue lane next to the tracks.

## 3. The output switch

The transport (the bar) gets one **OUTPUT** switch: **Live feed** or
**Playback**.

- **Live feed:** the dynamic stream, the incoming ring.
- **Playback:** the tape's tracks plus the cue lane, summed, on one clock.
- With **Cue** on, Playback is the cue lane alone (solo).
- It is the bar's existing Feed / Tape / Shelf source switch, reduced: Feed is
  Live feed; Tape and the cue lane are Playback; a Shelf take loaded into the
  bar is a one-off Playback source as now. The switch is in both rooms because
  the player is.
- The Pi never plays sound. "Output" means what this browser plays. The
  existing rule stands: the Pi does not monitor.

## Later, not now

Exported **songs** as a separate thing from takes: a record "cut" and played
in a media player, an external, finished object, which in the Listening Room
is sitting down to a record. It means a finished-work concept the app does not
have yet. Nothing here should make it harder: the player's sources are an
interface, and a record is a source with no tracks and no cue lane.

## Notes (replaces the Sketchbook)

Removing the Sketchbook is a Listening Room change of its own and is
deliberately kept small until that room is worked further.

- **Now:** the Sketchbook no longer navigates to the Studio when the bar holds
  the tape; it stays in the room (it was the same click handler as the deck).
- **Then:** a bookmark tab appears on the player when a clip is loaded. Pulling
  it opens a drawer over the room; in it you write a note and drop a flag at the
  playing frame. It is the notes dialog the ✎ key already opens
  (`openSketchbook` in `lib/room/doorway.js`), moved to a drawer and made the
  only way in. The Sketchbook object on the side table is removed from the
  room (`lib/room/space.js`, `art/corner.js`) in the same change, with its
  `--room-book-*` tokens, and the same drawer works in the Studio on a cue clip.

## Order

1. Sketchbook stays in the room (done: small, ships with its own merge).
2. The shell and player: spec → plan → build → looked at in a browser, at phone
   and desktop size, with the flags on and off.
3. The cue lane, first without the collapse.
4. The output switch.
5. The bookmark drawer, removing the Sketchbook object.
6. The tracks collapsing while the cue lane is open.

## Open questions

- What does the shell load when the flags are on and the URL is `tape.html`
  or `index.html` directly: redirect into the shell, or mount the same view?
  (Leaning: serve the same file, so existing links and bookmarks keep working.)
- Where is the cue lane's state stored so a second device sees it: with the
  tape (leaning) or per browser?
- A clip thrown from the live feed (GRAB) while Playback is soloed on Cue:
  does it play at once, or wait for the next bar line like a launch? (Leaning:
  waits, same rule as every other launch.)
