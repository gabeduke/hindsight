# One player, two rooms: the roadmap

Agreed with Gabe on 2026-10-16. Picture: the *One player, two rooms* canvas
(`9oJSxmvQhTnrBvVr2Uiz5o`). How the shell works now is in
`docs/architecture.md`, *The UI*.

Gabe: *"the media player should be a 'buffer' of sorts that works across both
rooms. When we have an audio source to consume it should continue playing in
both pages."*

## Decisions

| | |
|---|---|
| Shell, not hand-off | One document holds the player; the Studio and the Listening Room are views in it. |
| Name | **Cue lane.** "Buffer" stays for GRAB's sheet. |
| Launch | A clip starts on the **next bar line** and **loops until tapped again.** Shift starts it at once. |
| Cue button | Solos the cue lane in the output, so clips can be heard alone before they go to tape. |
| Clock | The cue lane and the tape **share the transport's clock and loop,** summed to one output. |
| Contents | Takes from the shelf, GRABs from the buffer, parts lifted from a track. |
| Trim | Reuses the clip editor (trim, fades). |
| To tape | **Drag a clip down** onto a track. Dropping copies; the lane keeps its clip until removed. |
| Storage | With the tape (`/api/tapes/state`), so a second device sees it. Survives a reload; not in the mix export unless dragged to a track. |
| Notes | The Sketchbook goes. A **bookmark** appears on the bar when something is loaded; pulling it opens a drawer over the room that annotates what's playing and drops a note at the frame. An overlay, never a page. |
| A GRAB thrown while Cue is soloed | Waits for the next bar line, like every launch. |

## Order

1. ~~The Sketchbook stays in the room.~~ Done.
2. ~~The shell and the one player.~~ Done (Phase 1, 2026-10-17/18).
3. **The cue lane.** ~~The lane, its store, solo, loop, remove, drag to a
   track~~ done (640c670). ~~Adding from the buffer, launch on the next bar,
   the Cue solo in the output~~ done (2026-10-19, flow C1). **Still to do:**
   adding from the shelf (the API takes a take's span already) and lifting a
   part from a track.
4. **The output switch.** The bar's Feed / Tape / Shelf switch becomes
   **Live feed** (a real stream of the ring) or **Playback** (the tape's
   tracks plus the cue lane, summed; with Cue on, the cue lane alone). A
   shelf take is a one-off Playback source. In both rooms. The Pi never plays
   sound: "output" is what this browser plays.
5. **The bookmark drawer,** removing the Sketchbook object from the room
   (`lib/room/space.js`, `art/corner.js`, the `--room-book-*` tokens). It is
   the notes dialog ✎ already opens (`openSketchbook`, `lib/room/doorway.js`),
   moved to a drawer and made the only way in; the same drawer works on a
   cue clip in the Studio. Pulled forward as the notes drawer in
   `listening-back.md` (2026-10-23).
6. **The tracks collapse to one strip while the cue lane is open,** and the
   reverse, as the buffer folds the lanes (`body.buffer-fold`).

## Later

Exported **songs**, a finished object separate from takes. The player's
sources are an interface; a song is a source with no tracks and no cue lane.
