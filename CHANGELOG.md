# Changelog

Releases are cut automatically on every merge to `master`. Versions are dated:
`vYYYY.MM.DD.N`, where `N` counts the releases made that day.

<!-- new releases are inserted directly below this line -->

## v2026.10.16.5 — 2026-10-16

- Two rooms: smooth 60fps tape and deck reels, zero-flash page switches, top-right Settings/Releases/Guide, a Feed/Tape/Shelf bar switcher, inline Sketchbook, and collapsible Studio tracks (56267dc)


## v2026.10.16.4 — 2026-10-16

- The guide says where updating is with the two rooms on, and the Releases sheet no longer says Capture there (f076148)


## v2026.10.16.3 — 2026-10-16

- Listening Room: from the doorway it looks like a room now, on laptops and tablets -- warm lamp light, a real reel-to-reel on the console, tapes on wooden shelves (0def1c9)
- Listening Room: the room is described as a place -- its furniture, its lamp and window, and where you stand -- and drawn from that (c9047cc)
- Scenes can hold furniture now: a prop is a thing that stands where it is put (4ed20d3)


## v2026.10.16.2 — 2026-10-16

- The guide: a contents list that follows you, each part a panel, checks on cards of their own, and tables that fit a phone (dba239d)
- Releases: each release's date on a line of its own, and what a pick changes as a card of + and − per release (d69e23c)


## v2026.10.16.1 — 2026-10-16

- With the preview flags off, the Tape page's Catch key is greyed until a pass has gone round, as it always was (parity) (9d36059)
- With the two rooms off, tips say what they always said, without mentioning the rooms (parity) (6c79b9e)
- Rec on the original Tape page sends the request it always did, with no track list unless several tracks are armed (parity) (805e952)
- Plan: the original interface behaves as before with the preview flags off (parity) (271030c)
- A mixdown or a second record refused while Rec runs keeps the Pi's own words; only a refused edit says Waiting for rec to finish (7c1bfc2)
- Settings: Plays the tape shows with Play mode on as well as the two rooms (e5c8a8b)
- Guide: the Plays the tape row shows once the two rooms are on (8b35d9a)
- A tape edit refused while Rec is armed or recording now says Waiting for rec to finish, and the control goes back to the Pi's value (e4a595a)
- Settings is a proper button now: a pill with a 40px target, a size up from the footer line, on Capture and in the Studio (aa79f87)
- A refused edit while Rec is armed now says why in the API (a reason of recording on the 409) (a1aa058)
- Settings: Plays the tape shows only when the two rooms are on (02adf3a)
- Plan: merge prep, the Settings row and the refused edit (62ebbff)
- Settings: a preview switch you flipped keeps its Reload across closing, reopening and saving; a browser that can't store it says so instead of showing On; the rig page points at Preview features (b023e24)
- Guide and tips: Settings has Preview features first, then the Pi's settings with one statement of what a restart does (fbd39f3)
- Settings: the preview switches (Play mode, Two rooms) are now an open section at the top, each a real On/Off switch with one Reload to apply that will not cut off a phone recording (e8cbdbc)
- The Android home-screen icon fits its circle: the whole cassette, screws and foot included, now sits inside the safe zone (58af1cf)
- The guide's Open, tag, bar and walkthrough steps now match the buttons on screen, and its check also reads Capture, Split here, Save as a take and headings (F9 review) (e58bce7)
- The guide's contents list the walkthroughs as a rooms section, and the plan says what was run (F9) (7529a5f)
- The guide says what the two rooms are: Words in the two rooms, Open, six walkthroughs, and no sentence about the rooms left false (F9) (fa4818f)
- The guide's text for the two rooms is checked for the old words: a take is KEEP, a flag is a note, a clip is a part (F9; red until the guide is rewritten) (8d22e71)
- Plan the guide's words for the two rooms (F9) (be6c3d2)
- A take, tag, section or tape name in a toast is never reworded, whatever it holds: names are marked where they are put in and the toast takes the marks off (F8) (01797de)
- A name you typed is never reworded in a toast, a take's toast keeps its label and its day, and Capture names a kept take as its spine does with the rooms on (F8) (306f0da)
- A take in a toast is named as its spine names it, the Note key wears the pencil, and the lane tip stops saying part twice (F8) (4a2585b)
- With the two rooms on, no old word is left on a page: flags are notes, clips are parts, the ring is the feed, mix down is bounce, and Send to is gone from Open (F8) (7139cff)
- Plan for the words pass (F8) (14b8ee2)
- Open's From this take lists only what was cut from the take, a cut says Made from its source, and an older bounce lists the newest; a refused sound leaves the take where the bar left it (F6) (777ae09)
- Open has a ✎ Note in its Notes heading too, so a phone can write a note without opening the player (F6) (01cb004)
- A take opens as one page with the rooms on: ✎ Note, GRAB beside KEEP, its notes, tag and what was made from it; the chair, TOOLS and ?tape= are gone (F6) (b39fdce)
- A take's page can now ask where the bar was and whether ✎ asked for a note (F6) (d646624)
- A stale frame from another take can no longer start a note, and ✎ on a take that has ended keeps its last frame (F6) (f92e508)
- Plan for opening a take as one page (F6) (6ceb381)
- The cassette's arc margin is the face's larger flying size, not the window's (F5b review) (89782c8)
- Repeat shows on a phone's mini player for a take while it is on; the guide stops promising a take's bar a player or an Open key; the take-in-the-bar CSS is pinned by tests (F5b review) (47f8e90)
- The cassette's arc up a narrow phone stays inside the page (F5b review) (d1f1bae)
- A take's cassette stops flying when its sound pauses or ends, whoever paused it (F5b review) (4422898)
- A tape or take you were listening to is no longer replaced or left sounding by a late "Ready" from a take that finished encoding; the bar lets a source go silent; one toast per take; the selected spine's halo is whole on a phone (F5a review) (71c68ba)
- In the Listening Room a tap plays at once and the take's cassette flies from its shelf to the deck beside the sound, or to the bar on a phone, and the deck settles when it lands (F5b) (4519ea2)
- In the Listening Room the bar shows a take's name, which opens it, and a ✎ that opens it and keeps the spot you were hearing; a phone's mini player holds the take's strip, and the bar's ⟲ is Repeat for a take (F5b) (5d584f4)
- Plan for F5b: the bar's strip, name, ✎ and Repeat, and the sound at the tap with its flight (F5b) (2e57d33)
- A take with no preview can now be opened from the Listening Room (its toast has Open and it loads paused once it is ready), a row's waveform no longer plays on a tap, Escape closes the Tag dialog without ending the selection, and the select bar fits at 320 px (F5a review) (cfa38a5)
- The syntax check now parses each script as the kind it is loaded as, and checks the inline scripts in the pages (e06763f)
- The import check now also covers imports written as /lib/..., which is how the main page app.js imports everything (ec4e783)
- The rig has profiles for the MPC Sample, SMK-37 Elite, Scarlett Solo and Zoom R20 (2f6efe9)
- Hardware notes: image references, capture steps and an R20 theme brief (3a280c7)
- The import check no longer trips on comments in an import list, misses `export const a = 1, b = 2`, or reads a template literal as code (e034888)
- F5a plan ticked off, with what was seen failing and looked at (F5a) (2f18f02)
- In the Listening Room a tap plays a take in the bar and holding selects it, with Tag; the spine's sheet, the phone's deck card and the tapes' shelf are gone, and the deck is a picture of the bar (F5a) (ac9a381)
- Plan for F5a: a tap plays, holding selects with Tag, the sheet goes, the deck is drawn from the bar, tapes leave the Listening Room's shelf (F5a) (60e3c21)
- A take that turns up late no longer overrides what you did on the bar meanwhile, and the take page keeps the Room's Repeat (F4) (9b9a9c3)
- The node suite now fails when a script under web/static doesn't parse or imports a name another file doesn't export (F7 review). Seen failing against a redeclared const and a renamed export. (c73594d)
- The phone's Catch key keeps its short second line within nine characters with any number of tracks armed, and the guide and tips say what a second DROP and the ● do in each mode (F7 review). (708b4e7)
- A hold on a track's ● is for a finger or a pen (a mouse adds with Shift-click, and a slow click is just a tap), and its label names the keyboard way too (F7 review). Tests seen failing first. (33ad6f1)
- In the Studio, DROP's "replaces" now follows what the Pi really clears for a buffer copied from several clips, and a part the tape can hold is moved back to fit rather than refused (F7 review). Tests seen failing first. (753e7d0)
- The bar's take now survives a trip through the Studio, a slow take list, a take that isn't on the page's shelf, and Repeat (F4) (a62e953)
- The Studio's Catch key says what it catches (last pass → 2) and why it waits (after one pass), on the phone's mini bar too; the ● tap and hold, the guide and the offline cache follow (F7). (bea9403)
- In the Studio, DROP lands on the armed track at the next bar line inside the loop over what is there, says "replaces" first, and is never refused for room (F7). Tests seen failing first. (83aa1d6)
- The Studio's track ● now arms just that track on a tap, and holding it (or Shift-click) arms it as well (F7). Tests seen failing first. (19e392d)
- A take page you opened and left alone no longer takes the bar's place: back in the Listening Room the take is still there, playing on (F4) (b9a514b)
- With the rooms on, the bar carries its take to the next page and picks up at the same spot, plus the time away if it was playing (F4) (c6efc27)
- Plan the bar's hand-off between pages: the take, its frame and whether it played, carried to the next page (F4) (f4e7b41)
- Plan for F7: ● arms one and a hold adds, DROP never refuses, CATCH says what and why. (74f2d3b)
- A waiting Catch with no track armed says "arm a track" again, and tells you why it waits once you have. (da0c818)
- Catch no longer shrinks while it waits, so the Crate button and the keys beside it stay put on a laptop screen. (a1d3c5c)
- Loading a tape reads its file once, not twice, so the tape list and loading a tape take about a third less time on a tape with a long undo history. (5d78081)
- A range's Cut and Copy and Undo-toss say what they replaced with an Undo and leave the crate alone; an Undo after a drop says so in plain words; an older Undo goes when a newer grab comes (F3 review) (27d81da)
- Settings opens at the top again instead of scrolled partway down the sheet. (037739d)
- The Pi's one replaced buffer is any unused buffer, a range's Cut and Copy and the toss's Undo can leave the crate alone, and the slot is let go when it can no longer be undone (F3 review) (256627f)
- GRAB's Undo toast is shorter so the Undo is seen, the empty tape's link is themed, and F3's plan is ticked off (F3) (25f3483)
- With the rooms on there is no crate on the screen, and GRAB over a buffer nobody used says so, with Undo (F3) (a7b47b2)
- The Pi keeps the one grab a new GRAB replaced, so GRAB can be undone (F3) (baec9c7)
- Plan for F3: the buffer is the only view of what GRAB holds, and GRAB has an Undo (fb8d5cc)
- Plan for F2: the review's fixes ticked off (0b7d91c)
- Bounce's ▶ plays inside the tap on an iPhone, Last bounce never offers another tape's take, and a disabled one says "none yet" (F2) (c82fc28)
- rooms/all: CACHE v100 for the tidier cables (f27de11)
- Rig cables: a long route is simplified instead of dropped, and the router runs once for a burst of layout changes (review of #120) (38241b7)
- Plan for F2 ticked off (c911e94)
- The Studio's menu bounces a tape into a take (with ▶, Open and Last bounce), and Cut a record, the Records shelf and the turntable are gone (F2) (ec7813a)
- The Rig page's cables now run through the gaps between sockets instead of across them (a tidier patch bay) (ec0b917)
- Plan for bouncing a tape from the Studio's menu, and dropping records (F2) (adcd263)
- The pad's, the buffer's and the sheet's KEEP and GRAB wiring is tested by what it does, not by a grep (F1) (c04ee53)
- KEEP's length reads right at the edges: "<1s", "10s" for 9.96 and 10, "1h" for an hour, and the feed key's name contains its label (F1) (4800fbd)
- A selection of the feed offers GRAB and KEEP, every KEEP says what it keeps, and a take's GRAB starts at the loop's length (F1) (6ab4456)
- Plan F1: a selection's GRAB and KEEP, every KEEP naming what it keeps (620632a)
- Handoff: the walkthrough's fixes are on the rig; the next CACHE is v99 (2ee80a7)
- Plan: tick off the walkthrough fixes (e86493d)
- Handoff: the rooms on the rig, the walkthrough, and the flow spec to build (1f6fbd5)
- Folded lanes are tidy strips: a head is one row, its name and ●, instead of four heads cut through on a 15 px pitch (P2 buffer) (b3b11a6)
- Pulling the buffer's sheet down on a phone settles it at its peek instead of closing the buffer (P2 buffer) (e6e54db)
- DROP is no dead end: a full armed track hands it to the next with room, and a drag over a clip says it will replace what is under it (P2 buffer) (a013eb6)
- The notes Catch and ● give no longer stand over the next tap: their words let taps through, their action doesn't (the tape's bar and track heads) (75c4e13)
- Spec: Gabe's answers to the flow's three questions (06069e6)
- A track's ● says what Catch and Rec will do, and arming a second track offers "Only track 2" (P6 rig, multi-arm) (01f8f85)
- Catch says why it is waiting when you press it, and the last 1, 2 or 4 bars are on its ▾ (the tape's bar; the ▾ is the Studio's, P1) (a82517a)
- Spec: two nouns and one way to listen (4586ecd)
- A tag made from a take's sheet or the chair is put on that take, instead of being saved and left for another tap (Listening Room; the Takes page) (5045698)
- Settings: a device switch that needs a reload now has a Reload this page button beside its note, apart from the Pi's Restart (Settings, with the rooms on or off) (2a93512)
- Pages stop logging a red 404 for GET /api/update where there is no updater: /api/status says whether to ask (Studio, Capture, the demo and a Mac) (086821c)
- The ⋯ menu stays on a phone's screen: it no longer runs off the left edge (tape page, rooms on or off) (bac2738)
- A phone gets the room, rig, FX and mods styles again, and the chosen tape formula reads (P3 strip, P4 FX: two merges lost a closing brace) (f1a757a)
- Plan: the walkthrough's fixes for rooms/all (4d36859)
- Walkthrough: ten user stories through the rooms, with what's confusing and what's broken (1f7fc8b)
- The instrument and the buffer take turns: the phone's EDIT | PLAY is never under the sheet, and a short laptop keeps the bench and a lane in view (8cb3e08)
- On the rig, while a plug is in the hand the sockets it can't go into are dimmed without hiding their names under the ropes (7c00757)
- On the rig, socket and device names read over the ropes: a rope runs behind a name instead of through it (db815f3)
- On the rig, dropping a plug selects no other cable, a mis-drop no longer unplugs, and re-patching an occupied socket carries on from the rope in your hand (78d5e91)
- Handoff: the rooms tree, what's on the rig, and what's left (2143241)
- The FX wait while a mixdown saves, too, as long as the Pi refuses them (04eab5b)
- A controller refused in a mixdown is logged once, not with every message (77a089b)
- A controller's mod wheel and aftertouch move only the FX that controller holds (6ac9c4b)
- The bend springs back with everything else: Esc, the window losing focus, a hidden tab, a controller unplugged (f5d9983)
- A knob, a pad or the bend let go mid-move sends where it was left, then the release (68f71f0)
- Plan: tick off the rig's ropes (R4) (5588e66)
- The FX, the bend and the tape mods are wired to the Pi in their own module, tested against a fake socket (cc8f189)
- On a phone, the rig's inspector waits for a drag to end instead of covering the cable in your hand (891cb90)
- On a laptop the FX and the tape mods sit beside the tracks, and the tricks keep their row (7a48d6e)
- Docs: the rig's ropes, and what the build changed in their spec (7218801)
- With the two rooms on, the rig's cables hang as ropes: a plug snaps into a socket near it, and a pull unplugs (b6afd64)
- Scene: a cable is a rope that hangs between two sockets, swings when moved, and stops (9b8e9ec)
- A pedal let up while MIDI LEARN waits lifts its latch, and a pad two keys hold sounds until the last lets go (9c58776)
- Spec and plan: the rig's cables as ropes (R4) (587b30b)
- A controller's KEEP, CATCH and Stop don't wait behind a GRAB's bar (c579424)
- With the instrument unfolded on a laptop the lanes stay in sight: the strip is compact and the feed folds to its keys (381f654)
- The instrument stops asking for frames while the tape is stopped (c42d0ae)
- The controllers in the Pi are heard only once the tape engine is set, so a note at startup can't race it (33cf401)
- A controller's CATCH asks what the page's Catch asks, refused off the jam room, and layers or replaces as the Pi's controls say (e80e28b)
- MIDI_IGNORE wins over TAPE_CONTROLLER: an ignored device is never opened, and the log says so (65d46c4)
- A controller's key lets go of the pad it pressed, even after a rebind or a learn: on the Pi and in the browser (4983480)
- A pad another hand played goes dark when its sound stops, even if this page held it too or reconnected meanwhile (2dcb21d)
- Settings: opening a group scrolls it into view, so This device's switches are not hidden under the fold (ab0ef32)
- A key held on the instrument lets go even if a fader or field has the focus when it comes up (176c067)
- Plan: the UI half of punch-in FX and tape mods, built (d19c3fe)
- The instrument strip plays the punch-in FX and turns the tape mods (daa0f18)
- Send a take's span to the Studio's buffer, as a grab (06e7579)
- Check that the offline shell names each file once (eb57067)
- To the studio from the Listening Room grabs the span, so the Studio's buffer opens on it (2d7481c)
- Deploys keep the Pi's hub certificate (f53590d)
- A controller in the Pi plays the punch-in FX and turns the tape mods (283a70a)
- A controller's knob and a page share one owner per tape-mod preview (41560d9)
- The play socket sends amounts and releases in the order they were heard (79ac602)
- A gliding FILTER, AGE or DRIVE moves smoothly, without a 16-frame zipper (83ba467)
- Docs: DRIVE's make-up gain, and its reference level (ffe89b8)
- Moving an FX or a mod costs the Pi little more than holding it still (4802a3f)
- Amounts moving are told apart from presses and releases, so none is crowded out (0ebeec2)
- With wow or flutter up, a loop played from In starts as the plain tape does (ce20855)
- A page that goes clears only the tape-mod previews still its own (384d17a)
- ECHO's delay line is made with the engine, not on the render path (f591df9)
- Tests: FILTER and CRUSH clicks are listened for on a tone, where they can be heard (2863453)
- A controller's knob commits only its newest turn, and its test can fail (285aea6)
- DRIVE holds its level with a fixed make-up gain: no ducked attacks (81a8ffb)
- The bend waits for the tape: held while it stands, counts in or mixes down, it hasn't run ahead (9a50732)
- Docs: the play socket's amounts and previews, and a tape's style (139040b)
- DRIVE keeps the tape's level: the room hears saturation, not a louder tape (107688e)
- A controller's mod knob previews as it turns and saves once still for a second (95da04a)
- Tape mods save over PATCH /api/tapes {style}, one undo step per gesture (303f188)
- Play mode's socket carries amounts: velocity at the press, set while held, and mod previews (9d3ada8)
- Punch-in FX and tape mods play: ROLL, FILTER, ECHO, CRUSH, a bend, and wow, flutter, drive and age (4cf1273)
- Tapes can keep tape mods: wow, flutter, drive, age and a formula, with undo (679291d)
- Plan: punch-in FX and tape mods, the engine half first (4a9dd8d)
- Plan: the review's fixes for R1 (94c21e9)
- Tests: a controller the watcher never opens fails its test instead of hanging it (3b89858)
- With several tracks armed, the buffer's DROP goes on the first of them, and says so (28de31c)
- On the object bench, the reels jump rather than turn with reduced motion, as before (d8651e6)
- The ribbon is redrawn inside a resize, so a turned phone never shows it stretched (6138302)
- Scene: adding an object is all or nothing, and a failing model is reported once (dec89bd)
- An animation that breaks is reported again, once, and the others keep moving (0bbf2eb)
- ↵ on the instrument drops, as on the page: a button reached with Tab keeps its own ↵, a clicked one doesn't (fd69e74)
- Check that the offline shell names each file once (749d6d5)
- The instrument shows a controller plugged into the Pi on its pads, unless this device picked another hand (254027c)
- Docs: the instrument strip, whose keys are whose, and a controller in the Pi (5410222)
- Buffer: ↵ drops after a track is armed with a click (06c17fb)
- Play mode's strip is fetched only on a device that turned Play mode on (8cad3c4)
- A DROP from a controller lays down the buffer's window, as the page's does (07277cc)
- Play mode is the instrument strip: a drawer above the bar, folded to one live row of pads, unfolded to the reel as the loop's ring; with the two rooms on, K keeps, C catches and the click moves to M (f1f18c3)
- Buffer review: no drop mid-grab, buttons keep their ↵, ✕ on a phone (dc35de1)
- Buffer review: clamp after the wait, never clip a keep, refuse a stale span (ae749e8)
- The Listening Room: browsing keeps the deck playing, a filter left on says so, notes never overwrite (4c34478)
- A record cut from a tape is marked by the Pi, so leaving the room mid-cut still lands it (398d10e)
- Play mode's keys, touch and Web MIDI come from one list of actions; ⇧ latches what's held (14b5695)
- A MIDI controller plugged into the Pi plays Play mode's pads and the Studio's verbs (TAPE_CONTROLLER), with its bindings in controls.json and MIDI LEARN over the play socket (10f9a63)
- Plan: the instrument strip and the control bus, step 3 of the rooms (fd1a0d4)
- The rig: a cable sets a track's input only, its lamp arms it; nothing moves under a running ● Rec (a4b986f)
- Plan: tick off the scene contract (R1) (e7f526b)
- Plan: the buffer's step done (e604746)
- The buffer on a phone and while carried: the dropped lane comes into view, the lanes keep their room (f833e2d)
- The buffer, looked at: AUDITION plays, ↵ drops past a focused ▶, the lanes fit (f79e7cc)
- Lanes folded to strips draw instead of throwing on a negative corner (844fa97)
- The rig page with the rooms off says Back, not Studio (8054c15)
- The rig's cables drop from socket to socket, names beside the holes; docs for /api/rig, rec_tracks and pairs (c04b7eb)
- The Listening Room: the chair's deck, notes and sticker; records cut from a take or a tape (d5131e7)
- With the two rooms on, the Studio arms several tracks at once: ● adds or takes off, CATCH says where it went (44681f1)
- The rig, with the two rooms on: the kit as gear on a desk, every cable a setting (583f432)
- The Listening Room, with the two rooms on: shelves, a deck, a turntable and a sketchbook (d91ee06)
- The Studio's buffer on the page: GRAB beside KEEP, the bench, DROP, KEEP AS TAKE, TOSS (a68e6c4)
- Describe the scene in the contributor notes (d04b9bd)
- Keep the settings sheet's module in the offline shell (f79f129)
- The bar, a take's clock, rising notes, a row's playhead and Play all run on the shared clock (8262ce9)
- The VU meters, reels, cassette and ribbon move by the scene, and look as they did (8c83907)
- Add the scene contract: objects the page sets, models that move them, a renderer that draws (6c42f89)
- Animations share one clock that steps once a frame, even when woken mid-frame (a79c4da)
- Docs: what the Studio carries, its early scripts, and its event (51a4981)
- Two rooms: the Studio gets Flag now, Phone and Capture's readouts, and Keep as clip lands in its crate (52cacc3)
- GET /api/rig draws the kit from its settings, its tape and what's plugged in; labels in rig.json (40623cf)
- The buffer on the Pi: grab, trim, keep as a take, toss with Undo (36b94d6)
- The rig's model: device profiles, the Sidekick's from its measurements, and the patch graph (b10a4d3)
- Multi-arm on the Pi: several armed tracks record at once, each from its own input, as one undo (46e6509)
- Plan: the Studio's buffer, step 2 of the rooms (76254de)
- A take can be marked as a record, for the Listening Room's Records shelf (b8b86c8)
- Plan: the Listening Room, step 5 (7c47456)
- Plan: the rig, step 6 (520fee5)
- Docs: the two rooms' module, and the plan for step 1 done (15a92d8)
- Two rooms, a preview under Settings › This device: a Studio and a Listening Room (7dffb97)
- Plan: the scene contract (R1) (6063463)
- Plan: the two rooms, step 1 (b349916)
- Handoff: build every spec overnight, as a branch tree off main (7d8f5c8)
- Specs: two rooms, the buffer, the instrument strip, FX, the room, the rig (821f184)
- Handoff: lead the design brief with the OP-1 workflow (a907299)
- Handoff: Play mode audible, and the brief for the design session (2dc3776)


## v2026.10.15.3 — 2026-10-15

- Play mode's pads make sound (9c6234b)
- Play mode's socket: press and release pads over /api/tapes/play (e32c089)


## v2026.10.15.2 — 2026-10-15

- Tricks: fix six things a review found, before anyone hears them (7074a64)
- Teach the tape engine Play mode's tricks (the pads aren't wired to it yet) (dcefc86)


## v2026.10.15.1 — 2026-10-15

- Describe the finished object library in the contributor notes (8e4b44d)
- Add a still button to the object bench (33deb93)
- Add a size slider to the object bench (c99f6a9)
- Put the masking tape on the object bench, with its marker in objects.css (b0c20a7)
- Move the output icons into the object library (4ecba12)
- Move the flag's pennant into the object library (d7fa4b5)
- Move the grease pencil into the object library (8f3c3b9)
- Move the LCD into the object library (287acb6)
- Release only for changes to what a kit runs (0231ae0)
- Spec: what ports from the OP-1, and what doesn't (53f0f8a)
- Spec: Play mode, audible -- a read head over a tape that keeps counting (3f94dcc)


## v2026.10.14.13 — 2026-10-14

- AGENTS.md: look at a UI change before it merges (d60edc3)
- Play mode: keep its keys to itself, follow the tape, readable by day (88047c0)
- Contributor notes checked on a real machine (no change to the app) (dd37401)


## v2026.10.14.12 — 2026-10-14

- Fix a take's Play button filling the whole screen on a phone (1f4fe10)
- Handoff note, so a fresh window has the state as well as the rules (5f84745)


## v2026.10.14.11 — 2026-10-14

- AGENTS.md: the rules that have already caught something out (5564ab5)


## v2026.10.14.10 — 2026-10-14

- Stop hiding the only way into Settings (d4a71ad)


## v2026.10.14.9 — 2026-10-14

- Move the ribbon into the object library, and draw it on the bench (71db8de)


## v2026.10.14.8 — 2026-10-14

- Draw the cassette on the bench, without needing playback (51d308f)


## v2026.10.14.7 — 2026-10-14

- Turn Play mode on from Settings, not from the console (94a1102)


## v2026.10.14.6 — 2026-10-14

- Move the cassette into the object library, and guard the paths (58140ae)


## v2026.10.14.5 — 2026-10-14

- Play mode: the surface, the keyboard, and the screen (3600120)


## v2026.10.14.4 — 2026-10-14

- Give the VU needles the real movement (be0b362)


## v2026.10.14.3 — 2026-10-14

- Split the materials into objects.css (f384f81)


## v2026.10.14.2 — 2026-10-14

- Object library: motion physics, the first three objects, and a bench (0470e65)
- Don't cut a release for specs, design boards or workflow edits (4048bb1)
- Spec: Play mode, and an object library for the physical things (472867a)


## v2026.10.14.1 — 2026-10-14

- Add scripts/get.sh: install the latest release with one curl | bash (9b926b2)


## v2026.10.10.5 — 2026-10-10

- Installer steps around nginx and tailscale serve; the Pi says when its HTTPS address doesn't answer (337f71a)


## v2026.10.10.4 — 2026-10-10

- Hub client: ask again after a minute while no certificate is held (de3632a)


## v2026.10.10.3 — 2026-10-10

- Give the Pi an HTTPS name from the hub (2099ad2)
- Hub: manifests, an image from the release workflow, and docs (c979911)
- Hub: turn a Hindsight's heartbeat into a DNS record and a certificate (f599f6d)
- Spec: deliver the hub with Argo CD and a GHCR image from the release workflow (db4bb3c)
- Spec: a real HTTPS name for every Hindsight, from a hub on the homelab (21fd26f)


## v2026.10.10.2 — 2026-10-10

- Installer: point at Settings, not at SAVE_CHANNELS for an EP-136 (d00a61c)


## v2026.10.10.1 — 2026-10-10

- DEVICE_MATCH=auto and CHANNELS=auto pick the interface and fit the ring to it (9532112)
- Configuration: not only environment variables now (a820b16)
- Document /api/settings, /api/restart and settings.json (6ff5345)
- Settings sheet at the foot of Capture, and the guide's section on it (54fed57)
- Make SAVE_MIX=mono average the save channels onto both sides (d12d748)
- Settings: tests for the registry, layering, the API and restart (c2fd8a2)
- Settings: registry, settings.json over the env file, /api/settings and /api/restart (4d9ccbd)


## v2026.10.09.5 — 2026-10-09

- Give the icons new addresses so phones fetch the new one (b67bc90)


## v2026.10.09.4 — 2026-10-09

- Pick any release to install, and see what it changes (7964817)


## v2026.10.09.3 — 2026-10-09

- Add an Update button that installs the latest release on the Pi (a237e8f)
- Record v2026.10.09.2 in the changelog [skip ci] (f968c7f)
- Record v2026.10.09.1 in the changelog [skip ci] (f2f8bfc)


## v2026.10.09.2 — 2026-10-09

- Slide the lit tab between pages; sheets rise as they open (75622b2)


## v2026.10.09.1 — 2026-10-09

- Draw the icon as a cassette from the shelf (dfc871e)
- Record v2026.10.08.6 in the changelog [skip ci] (20b2ab6)


## v2026.10.08.6 — 2026-10-08

- Ranges: fixes from review (1fa7358)
- Tape: ranges and one action bar (8d125aa)
- Record v2026.10.08.5 in the changelog [skip ci] (332b26c)


## v2026.10.08.5 — 2026-10-08

- Arm and the input menu: fixes from review (b1a5173)
- Tape: an input menu on each track, and ● disarms (3bf558b)
- Tape: the track's arm key is a record button (e602a7b)
- Record v2026.10.08.4 in the changelog [skip ci] (b1f7a17)


## v2026.10.08.4 — 2026-10-08

- Record on the track: fixes from review (b4fdd7e)
- Tape: record on the track (0361e1e)
- Record v2026.10.08.3 in the changelog [skip ci] (4c084ff)


## v2026.10.08.3 — 2026-10-08

- Fade handles: fixes from review (5bf69f0)
- Tape: fade handles, and four fade curves (46b021b)
- The inspector: fixes from review (862a245)
- Tape: the inspector, beside the lanes (1570e16)
- Output button and Send to: fixes from review (d297c4e)
- Output button in the header; Downbeat; Send to; bus A (b539b70)
- Docs: the interaction model, with Gabe's picks (25d09d4)
- Record v2026.10.08.2 in the changelog [skip ci] (57ce897)


## v2026.10.08.2 — 2026-10-08

- Record v2026.10.08.1 in the changelog [skip ci] (d6976f5)
- Tape: the lock dot is grey while the tape is stopped (10b6dee)
- Tape: the RECORDING sign shows only while recording (d11bf00)


## v2026.10.08.1 — 2026-10-08

- Tape: the clip bar waits for a double-click; review fixes (19b7908)
- Tape: a click selects a clip; the clip bar and keys act on it (ac12dfe)
- Record v2026.10.07.5 in the changelog [skip ci] (ef0d674)


## v2026.10.07.5 — 2026-10-07

- Record v2026.10.07.4 in the changelog [skip ci] (c5f3939)
- Normalize: fixes from review (77fcb5e)
- Take page: Normalize on share (C5) (b4b5700)
- Dropout flags: fixes from review (37ff5bf)
- Takes: dropout flags (C4) (aa33af9)
- Flags list: fixes from review (a6e1461)
- Play all: fixes from review (a86c6ce)
- Take page: a flags list, and ↺ 5 s (C3) (93d1c2d)
- Takes: Play all, and flags that step on to the next take (C2) (62ac85a)
- One-tap trash: fixes from review (ac76dbe)
- Takes: one-tap trash and Undo last save (C1) (fc00ace)
- Insert and delete time: the smoke leaves no section behind (fab2beb)
- Insert and delete time: fixes from review (1747814)
- Tape: insert and delete time (A7) (5ff33ad)
- Sections: fixes from review (e5ea530)
- Tape: sections (A6) (687f94f)
- Clip fades: fixes from review (38becb1)
- Tape: clip fades (A5) (da87ca2)
- Split here: fixes from review (f988f58)
- Take page: Split here, two clips on the crate (B2) (25175c2)
- The crate: fixes from review (0bb3943)
- The crate: keep clips, and drop them from it (B1) (bb9164c)
- Several clips: fixes from review (39fffc1)
- Tape: select several clips (A4) (dec1e32)
- Drag to repeat: fixes from review (0c42a21)
- Drag to repeat: a tap on another lane leaves the corner's drag alone (d428fdc)
- Tape: drag a clip's corner to repeat it (A3) (4ef9ed4)
- Slide onto another track: fixes from review (736f6ea)
- Tape: slide a clip onto another track (A2) (d730a27)
- Edge trim: fixes from review (cc61b0f)
- Tape: edge trim, with handles (A1) (404142c)


## v2026.10.07.4 — 2026-10-07

- Clip gestures: fixes from review (a3cadd3)
- Tape: clip gestures in a module of their own (A0) (12493c9)
- Record v2026.10.07.3 in the changelog [skip ci] (ed39ae9)
- Record v2026.10.07.2 in the changelog [skip ci] (0cb61a1)


## v2026.10.07.3 — 2026-10-07

- Phone shell: cache v36, the same bump as #43 and #42, so they merge in any order (3f5639d)
- Send to tape: name the downbeat's bar only when it was sent; keep the hint current (7f9d28f)
- Send a take with a tempo to the tape on the tape's bar lines (0ece077)


## v2026.10.07.2 — 2026-10-07

- Record v2026.10.07.1 in the changelog [skip ci] (0eaf6e4)
- Take page: retry the refetch while Reconnecting… is up (492ec3c)
- Recover the pages after the tablet sleeps (236e2b2)


## v2026.10.07.1 — 2026-10-07

- Take page: bar 1 flush hook sits above the visibility hook (15c65eb)
- Take page: flush a pending bar 1 nudge in its own visibility hook (f85fb46)
- Bar 1 row: nudge by the Snap step, keep an unsaved nudge over a refetch (24265ae)
- Take page: a Bar 1 row that stays once the take has a tempo (c2a0011)
- Record v2026.10.06.1 in the changelog [skip ci] (787ce72)


## v2026.10.06.1 — 2026-10-06

- Guide: a take played in the bar stops the tape on this phone (b9f857e)
- Stream across pages: fixes from review (978ed07)
- Phone: the tape's stream across pages, and the Pi waits 6 s (3024835)
- Phone player: cache v34, past main's v33 for Save as take (cd5bcf1)
- Phone player: fixes from review (2eec621)
- Save as take: fixes from review (af74124)
- Phone: the mini player and the player (7a8ed96)
- Save as take asks for a name first, offering the one it would get (a56f682)
- Takes and Capture's bar: fixes from review (3d723ae)
- Takes and Capture's bar: tips, the guide, smoke checks, cache v32 (9eba458)
- Takes and Capture: the now-playing bar (a86a0f2)
- Bar: a shared bar for Takes and Capture, with the tape and a take as its sources (49c2baf)
- Tape: the overview's painting is shared (paintTapeOverview), for the bar on other pages (e4370b7)
- A take's bar: fixes from review; cache v31 (50e7014)
- A take's bar: tips, the guide, smoke checks, cache v30 (2839812)
- A take: the now-playing bar (0bb83d4)
- Bar: a take's LCD words and its level at a point, pure and tested (ffae002)
- Families: fixes from review (c4f64ca)
- PR 1: cache v30 (63185d4)
- Smoke: families on the takes page; spine counts skip folded rows (8517ca4)
- Families: the look, the tips and the guide (a117f62)
- Main page: the shelf is the newest spines (2777f55)
- Takes page: the cassette lists a take's cuts and earlier mixes, with ‹ back to the spine (678e0ed)
- Takes list: folded takes ride hidden behind their spine, which wears the count (f97e263)
- Shelf: fold cuts into their original and a tape's mixdowns into its newest; shelve groups the spines (846e417)
- Mixdown: the sidecar names its tape (tape_id) (a3f44b6)
- Take families: the spec and the plan (cuts and mixdowns fold into their take) (bfef0a9)
- Drawers: fixes from review (d9a5e46)
- Drawers: a lane fills its cell without sizing it, so a drawer always pushes the lanes up (588fab8)
- Drawers: tips, the guide, smoke checks, cache v29 (0acefc7)
- Tape: the drawers -- Record and Edit open above the bar; the lanes take the width (7dd0018)
- Plan: PR 2 (the drawers) in detail (525a0b5)
- Bar: fixes from review (f924086)
- Service worker: the tag modules from #40 in the shell too (f9f81c9)
- PR 1: cache v28, the bar's modules in the shell, its tests in CI (02f7eab)
- Smoke: the tape's lanes end above the bar, and the bar runs (c582d0d)
- Guide and tips: the now-playing bar on the tape page (9f79ae2)
- Tape: the bar's look; the page a column with the bar at its foot; a phone docks the bar (caf7a56)
- Tape: the now-playing bar's markup, driven by the page; the deck goes (359e2ac)
- Bar: the reel window and its level bars (c07656f)
- Bar: the LCD's words for the tape, pure and tested (d5f05e8)
- Transport bar: the spec and the plan (direction A, five PRs) (d249c9b)
- Record v2026.10.05.13 in the changelog [skip ci] (640729c)
- Tags: name a color, give it to a take, filter and sort by it (#40) (06c040a)


## v2026.10.05.13 — 2026-10-05

- Shrink the Capture key on tablet and desktop layouts (#41) (9894645)
- Record v2026.10.05.12 in the changelog [skip ci] (700f206)


## v2026.10.05.12 — 2026-10-05

- Fix tape lanes growing taller on phones (6195973)
- Record v2026.10.05.11 in the changelog [skip ci] (df700e1)
- Record v2026.10.05.10 in the changelog [skip ci] (96edb02)


## v2026.10.05.11 — 2026-10-05

- Record v2026.10.05.9 in the changelog [skip ci] (8cdee37)
- make deploy: dry run, status and deploy targets; deploy.sh safe from any checkout (b08b79e)


## v2026.10.05.10 — 2026-10-05

- Tape overview: a scrubber — drag the window, tap to move the playhead, double-tap for the loop (46c7e06)


## v2026.10.05.9 — 2026-10-05

- Tape: a track's name gets its own strip on a narrow head, so it isn't cut short (a806781)
- Record v2026.10.05.8 in the changelog [skip ci] (4e8b744)


## v2026.10.05.8 — 2026-10-05

- Record v2026.10.05.7 in the changelog [skip ci] (5a82876)
- Service worker: v25, so the merged shell (stream player and clip editor) reaches every phone (a3e440a)
- Overdub on this device: stop the stream's tape only in This phone mode (0fcf062)
- Guide: a late reconnect, Tap to play here, and Overdub on this device stopping the stream (06323da)
- Overdub on this device: its Listen and Record stop the stream here (96ecabd)
- Tape on this phone: a late return lets the tape go, a locked phone resumes, blips reconnect (b3b9706)
- Stream worklet: the ring's step is pure and tested, and starts 0.8 s behind the newest (df66b2d)
- Stream: drop a phone that has said nothing for 2 s (4ed55ea)
- Tape page: punch and record read the engine's position, not the phone's heard one (b6f97a7)
- Tape output test: push the second at the pace the hub flushes (db4d3a9)
- Tape page: play here with the heard playhead, pending mutes, and the jam room's guards (46d566f)
- Output: revert to jam room if the phone audio fails, handle start rejection, prose styling, OUT label (8743917)
- Tape page: the OUT menu, the Output sheet, the strip and the banner (387583e)
- Tape stream: player start/stop lifecycle, one socket, locked recovers (c3e5c61)
- Tape stream: the page's player, an AudioWorklet holding 0.8 s (2e955c4)
- Tape stream: the page's stamp log and heard position (b04a34c)
- Tape stream: a WebSocket to the page, and PUT /api/tapes/output (3ddfcd3)
- Tape output: switch to a phone under the recording lock, re-check the mode in Record and StartMixdown (d03c6f5)
- Tape output: the engine's output mode, the jam room's guards, and live state (47171a7)
- Tape output: count the listener's absence only while playing; seed the device clock (4709f98)
- Tape output: route to the jam room, a phone or both; pace while the Sidekick is away (bfbec9a)
- Tape stream: a hub that stamps packets for one listener (6d95a6d)
- Fix: test MixStereo clipping by adding overflow frame (23d3486)
- Tape stream: mix the buses to stereo and stamp 20 ms packets (78b5423)
- Tape on this phone: spec and plan (#29) (cba4817)


## v2026.10.05.7 — 2026-10-05

- Clip editor: a move saved as the editor closes still goes (9eaa484)
- Guide: Hit → Track's reach, declining without a hit, the wheel and keys (fc2310a)
- Clip editor: Hit → Track finds a hit at a clip's start, at any zoom (43c1333)
- Guide: fix Hit → Track wording (064878c)
- Guide: lining clips up exactly (22c0b85)
- Clip editor: find a hit near a pool file's start, and keep every move (f1fe223)
- Align a clip on the tape: the editor bar, Hit → Grid, Hit → Track (640d808)
- The tape zooms to the sample, and clips draw their detail (49e9e03)
- Share the editor bar's gesture core (1fd73ef)
- Clip alignment maths: where a clip sounds, and the two moves (cd163c9)
- Tiles and the audio round a point can come from another endpoint (f426a03)
- The tape serves a pool file's range peaks and a slice of it (330dce9)
- Plan: align clips on the tape (3ba6b78)
- Spec: align clips on the tape to the sample (79c4301)
- Record v2026.10.05.6 in the changelog [skip ci] (421e0c8)


## v2026.10.05.6 — 2026-10-05

- Record v2026.10.05.5 in the changelog [skip ci] (17c2484)
- Record v2026.10.05.4 in the changelog [skip ci] (bd3367a)
- The midi out tests keep their own time: no flakes under a loaded machine (c46ab81)


## v2026.10.05.5 — 2026-10-05

- Tape page: draw the tape name and tempo as pills that look like menus (b4dce00)


## v2026.10.05.4 — 2026-10-05

- Tape page: rename a tape from the ⋯ menu (0e4bbec)
- Record v2026.10.05.3 in the changelog [skip ci] (2de3dde)


## v2026.10.05.3 — 2026-10-05

- Seam view: light neither half by a playhead it doesn't draw (0a70ca7)
- Boundary editor: Out at the end can search, a lost drag ends, bar 1 saves at pagehide (f9ac11d)
- Attack's words: the strongest hit within reach, not the nearest (616ff55)
- Attack: decline rather than guess, and keep to its reach (460b300)
- Let Out sit at the take's very end (afa4a5f)
- Guide: Attack's reach, and what the readout says on a beat (1d8235a)
- Guide: placing a boundary exactly (f5502a3)
- Fix the boundary editor: save moves in flight, a pause key, stale edits (741d93a)
- Edit a boundary to the sample: two encoders, Attack, Zero, Grid and the seam (27a2521)
- Add the boundary editor's tips to the help table and the guide (187c966)
- Draw the boundary being edited, and the seam (3c334b4)
- Reuse a kept span that the take's start or end cut short (b67a384)
- Keep findAttack a cycle's room clear of index 0 (3ece8e8)
- Name the beat a frame is on when a beat is not a whole number of frames (a43ac90)
- Fetch the audio round a point, for Attack and Zero (1e85928)
- The boundary editor's maths: encoders, steps, the readout, the seam (8d293bc)
- Find where a hit starts, and the nearest zero crossing (4cfe3f1)
- Plan: the seam view reuses the take-on-tape body drawing (0d0e1b4)
- Plan: the boundary editor (409ca36)
- Spec: the boundary editor follows the reel-to-reel rules (91f2c67)
- Spec: the editor bar's place and the readout, said once (0b82a1a)
- Spec: the boundary editor, two encoders and a seam view (99e5a18)
- Record v2026.10.05.2 in the changelog [skip ci] (7a9d1ec)


## v2026.10.05.2 — 2026-10-05

- Fix review findings: a lighter paint, every channel, a playhead you can see (77b2d52)
- PR 6: the take on tape everywhere, the guide, cache bump (906d817)
- The take's overview on tape (845441f)
- The take's zoomed view on tape (4ab53fb)
- Levels from tile columns (dc4ffb8)
- Plan PR 6 in detail: the take on tape (2672744)
- Fix review findings: heads fit, numbers show, the dock under the menus (e972828)
- PR 5: cache bump, the guide, a smoke test (b2ce807)
- On a phone, the transport and Catch are always in reach (a12b116)
- The tape deck in brushed metal, and the track heads as cards (56fd584)
- Tape lanes: blocks of rounded bars in the track's colour (fa38469)
- Plan PR 5 in detail: lane blocks, the deck, the heads, the phone dock (78c1f96)
- Fix review findings: warnings stand out, plates on the tape, a way to name it (f09d899)
- PR 4: cache bump, the guide, screenshots (c952b6d)
- Capture on a laptop and the bench: the ribbon over three columns (bb12cf5)
- On the shelf: the newest takes as spines, a press plays one (dac017b)
- A Capture key that says what it catches, and glows when it has (1643e3c)
- Backlit VU meters and amber readouts (6d47b95)
- The ribbon on tape: a glowing trace passing the record head (3ec3058)
- Plan PR 4 in detail: the ribbon on tape, the monitor, the key, the shelf (63147d1)
- Fix review findings: the cassette keeps up, select by keyboard, history in step (9665801)
- PR 3: cache bump, the guide, and the sheet held sideways (3201a4c)
- On a phone, a spine opens its cassette (916c4d3)
- Rename, tempo and flags live on the cassette (1566e36)
- The picked take as a cassette (e70385f)
- Takes as spines in a rack (13b0687)
- Cassette maths: a stripe per take, packs that trade tape (2fa1187)
- Cassette colours: paper, printed stripes and plastic (a257ac3)
- Plan PR 3 in detail: spines, the cassette, the sheet on a phone (3aa30ab)
- Fix review findings: glows in device pixels, two glows, strips with fewer points (45595d1)
- Trace on tape: a glowing line on brown oxide (688f989)
- Rounded bars, the cassette window's waveform (5d0bfd3)
- Levels for bars and traces: the take's own peak, lifted like the design (195e706)
- Plan PR 2 in detail: levels, rounded bars, trace on tape (4d22891)
- Fix review findings: the tape grid shows, fields show focus, Play sinks (ae39f90)
- PR 1: cache bump and fresh screenshots (b34ff50)
- The takes search is a field, and "no signal" reads on the black window (91e723e)
- Canvases draw on black windows with the window inks (032df04)
- Controls with depth: raised keys, recessed switches, the orange key lit from above (b0b80f1)
- Reel-to-reel palette: aluminium by day, black by night, and depth tokens (d45c3fb)
- A stylesheet test: tokens in both schemes, contrast, hover, focus (fe9ea56)
- Plan the Reel-to-reel restyle: PR 1 in detail, PRs 2-6 scoped (625a4a6)
- Record v2026.10.05.1 in the changelog [skip ci] (092d219)


## v2026.10.05.1 — 2026-10-05

- Fix review findings: the switch holds still, the pane retries, rows pick by keyboard (d410d43)
- A phone held sideways: one header row (6c71939)
- The tape on a laptop: nothing cut off, and a panel that shows it scrolls (82edbb4)
- A take on a laptop: the waveform takes the width (e0f3bb9)
- The takes page on a laptop: the list beside the picked take (eb76da9)
- Capture on screen on the bench tablet and small laptops (ac4c5fa)
- One header on every page, with a switch between Capture, Takes and Tape (56cd327)
- Scope the main page's layout to the main page (dc85c87)
- Plan PR 5: layout and navigation (e598e94)
- Fix review findings: IN and OUT never overlap, the speed keys stay put (3b0b92d)
- Grease pencil on the take page (ebdfc6d)
- Add lib/wave/grease.js: a grease-pencil stroke for edit marks (da2991b)
- Plan PR 3: grease pencil on the take page (71ab05a)
- Fix review findings: the transport fits, the meters' numbers show (3697c56)
- Fit the lanes under the machine on a 600px tablet; new screenshots (5abedc6)
- Masking tape on the tracks, and a RECORDING sign (a424c92)
- A tape machine over the lanes: reels that turn with the playhead (4dd03d2)
- Add levelAt: what each track has under the playhead, for the meters (33b845b)
- Add lib/tape/reels.js: how the tape machine's reels move (0d17960)
- Plan PR 4: the tape machine (8ae2d5a)
- Record v2026.10.04.11 in the changelog [skip ci] (8ccb64e)


## v2026.10.04.11 — 2026-10-04

- A stale clipboard yields to a newer take; the take page picks up a late measurement (6630671)
- Don't measure mixdowns; keep the clock when the audio agrees; no sidecar for a deleted take (ad6584d)
- Hear the beat under a held bass (bd6c413)
- Take page: the tempo says where it came from, snap starts on bars (dc6e124)
- Offer the tempo suggestion only when asked (cfe7af2)
- An empty tape suggests the tempo you were playing (0e1fdde)
- A take's tempo sets the first loop's bars (d0e936a)
- Keep tempo_from honest through undo, mixdown, cut and a racing edit (730a1f6)
- Measure every take's tempo after it's saved (eb33ab9)
- Measure a recording's tempo from its audio (d1f8693)
- Plan: tempo from the recording (7bd3efa)
- Spec: take a tape's tempo from the recording (51b38eb)
- Fix review findings: the way back to the takes page, quiet controls (3fdf809)
- VU meters on the main page (b62e2e4)
- The main page keeps only the latest take (64e2689)
- A takes page: every take, searched, filtered and grouped by day (21ea942)
- Add lib/shelf.js: search, filters, sort and day groups for the takes page (8cafd30)
- Takes say where they came from: phone or tape (1334d38)
- Plan PR 2: the main page and the takes shelf (d66e44a)
- Quieten the deck: keys only where you play (75e876f)
- Fix review findings: readable readouts, visible warnings, sharp canvases (54d8853)
- Dress the UI as a tape deck (ef72b91)
- Canvases read the palette and repaint when the scheme flips (67403fe)
- Solarized Light and Dark tokens, following the device (be199a2)
- Add lib/theme.js: token colours for canvas code (c821353)
- Serve vendored fonts, typed as font/woff2 (e093543)
- Plan the Solarized 4-track restyle (87fabc2)
- Record v2026.10.04.10 in the changelog [skip ci] (1e999ff)


## v2026.10.04.10 — 2026-10-04

- Tape page: pinch and pan the lanes, and show a punch as it records (1450c47)
- Record v2026.10.04.9 in the changelog [skip ci] (8edd08c)


## v2026.10.04.9 — 2026-10-04

- Wait for a save's background work before its test folder goes (477c775)
- Record v2026.10.04.8 in the changelog [skip ci] (dd7eb63)
- Record v2026.10.04.7 in the changelog [skip ci] (e8a36fe)


## v2026.10.04.8 — 2026-10-04

- Note the three additions in the editing model spec's status (d3087c6)
- Overdub: fixes from an independent review (dd3a9ef)
- Overdub on this device: play the tape on a phone and record a part over it (6735de6)
- Test the bridge after a dropped block by its last pair, not FrameAt(now) (c4b0deb)
- Wide layout: fixes from an independent review (868290e)
- Lay the tape page out for tablets and computers (49d7b81)


## v2026.10.04.7 — 2026-10-04

- Test the bridge after a dropped block by its last pair, not FrameAt(now) (e5d9495)
- CI: name a failing Go test in the run's annotations (4c6c0a2)
- Levels: fixes from an independent review (9504543)
- Show each source's level, and say when a catch comes back silent (a122eba)
- Record v2026.10.04.6 in the changelog [skip ci] (5b6de32)
- Record v2026.10.04.5 in the changelog [skip ci] (5111508)


## v2026.10.04.6 — 2026-10-04

- Fix the review's findings on reverse and sharing a clip (f44665e)
- Reverse a clip, and share one as a WAV (eae5ce3)
- Audition all of a clip that starts into its pool file (dd78f98)
- Fix the review's findings on the tape's clock (2ee7bb2)
- Let the tape lead the Bento's MIDI clock (4e7d4db)
- Fix the review's findings on mixdown and export (097d6be)
- Mix a tape down to a take, and export it as stems (38cda4a)
- Fix the review's findings on tape editing (ae20846)
- Edit a tape the OP-1 way: lift, copy, split, join, slide, ×2, merge drop (76dd106)
- The clipboard: fixes from an independent review (ca4683e)
- The clipboard, Copy, Drop, the ruler and track sheets (step 6d) (ab33a40)


## v2026.10.04.5 — 2026-10-04

- Record v2026.10.04.4 in the changelog [skip ci] (79802b0)
- Count in from output frame 0 in the armed-play test (884dc87)
- Punch and free loops: fixes from an independent review (5963882)
- Punch, arm, count-in, click and free loops (step 6c) (dc0cdbf)


## v2026.10.04.4 — 2026-10-04

- Record v2026.10.04.3 in the changelog [skip ci] (59f4be0)
- The tape on the Sidekick: fixes from an independent review (473a3bd)
- The tape on the Sidekick: PortAudio output and the aligner (step 6b) (4549693)


## v2026.10.04.3 — 2026-10-04

- Record v2026.10.04.2 in the changelog [skip ci] (3710262)
- Test a span's date from the bridge's moment, not after the save (df13bb1)
- Tape engine: fixes from a second review pass (4bc2421)
- Tape engine: fixes from an independent review (fd4d7e7)
- Tape engine: tapes, catching and Send to tape, in the demo (step 6a) (a4cce25)
- Tests wait for the previews and prunes requests leave running (307c15f)
- The ribbon: fixes from an independent review (6a7f9f6)
- The ribbon: select any span of the ring and save it (step 5) (e2a6adf)
- Undo and trash: fixes from an independent review (25ab72f)
- Undo and trash; several takes at once (step 4) (5096566)
- Take page: fixes from an independent review (7aafb5c)
- Docs: the take page as built, step 3 checks, the plan (202ef5f)
- One take page: gesture zones, In/Out, Loop, Snap, header, toolbar, help (091c7a7)
- Serve the guide from the binary; report a missing interface as waiting (0aabff4)
- Phone recording: fixes from an independent review (b637df6)
- Docs: phone recording in the API, architecture, guide and README (6b7044e)
- Phone button and recorder sheet on the main page (08222b1)
- Record from a phone: the /api/phone WebSocket and the streaming take (6269c89)


## v2026.10.04.2 — 2026-10-04

- Record v2026.10.04.1 in the changelog [skip ci] (0188813)
- Server fixes from review: deleted takes, pruning after cuts, names, ids (40d393e)
- Take page: label a new flag at once, keep edits in order, keep the playhead (2b8cc5c)
- Bring the docs and comments back in line with the code (08b66da)
- Reload a take's preview once it's encoded (794a973)
- Answer zoomed-out waveform ranges from a peaks pyramid (af604d4)
- Queue share renders, one ffmpeg at a time (4a2e834)
- Audition the configured pair, like previews and shares (f83fa39)
- Cuts keep lane kinds and the grid; bounds-check trim; prune after cuts (c1a17a2)
- Test that /api/jams answers 304 until the list changes (901b830)
- Cache the takes list between polls (28da47f)
- Move the list and the take page onto per-flag requests (963d5af)
- Add per-flag endpoints and GET /api/take (583d8c7)
- Store when a take was made, and write takes under a temporary name (ce3df3b)
- Lock each take's sidecar for read-modify-write (f1c38f8)
- Give flags stable ids, so an edit can name one flag (ba666c4)
- Plan solid ground, step 1 of the editing-model roadmap, in thirteen tasks (1a9f7c9)


## v2026.10.04.1 — 2026-10-04

- Guide: how Hindsight and the tape work, with the checks each feature must pass (e533c73)
- Specs: the OP-1 Field tape study, one editing model, and the tape revised to match (fb6bc10)
- Spec: record straight into Hindsight from the phone (1518a2e)
- Spec: settle the tape patch — Bento on jack 2, layering on aux, MPC on jack 1 (5bcf17b)
- Spec: tape — layered loops lifted from the ring, played back through the Sidekick (dcbd43b)
- Map the EP-136 USB routing: capture, playback returns, and the MAIN sum [skip ci] (62cb34d)
- Record v2026.09.16.2 in the changelog [skip ci] (9761b63)


## v2026.09.16.2 — 2026-09-16

- Smooth the preview clock between the element's coarse currentTime reports (0d07aba)
- Record v2026.09.16.1 in the changelog [skip ci] (42b4ed9)


## v2026.09.16.1 — 2026-09-16

- Keep main full-width inside the flex-column body (adbc344)
- Fold the final implementation back into the spec (f3d2866)
- Disable the speed chip during a region loop, plus the review minors (7ebd08c)
- Fix the share button label ellipsis at 372px (361534d)
- Replace the per-frame lowerBound scan with a per-track cursor (db114a2)
- Make popstate the single place the notes-open class comes off (1f5e335)
- Document the rising-notes pane (4c105a1)
- Size the bench and the phone pane by flex, not by --topbar-h (0f23eb7)
- Wire the rising-notes pane: bench column, phone fullscreen, shared clock and speed (c9d639b)
- Take page markup and CSS for the rising-notes pane, the bench grid and the phone fullscreen (d9b7fa2)
- RisingNotes: the canvas, the keyboard and pads, mute chips and speed (7f1848c)
- Rising notes: bars and glow for one frame, past only, fading as they rise (1938877)
- Rising notes geometry: keyboard window and layout, pads, tempo lookup (2d6fd3f)
- Clock.setRate: preview playback speed, pitch preserved (a11e311)
- Plan the rising-notes pane and the tablet bench in seven tasks (1369533)
- Spec: rising notes and the tablet bench (8063dc4)
- Record v2026.09.15.2 in the changelog [skip ci] (09cb55b)


## v2026.09.15.2 — 2026-09-15

- Fix final-review findings on midi-lanes (c9cf942)
- Document GET /api/midi, GET /api/bundle and lane_kinds Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com> Claude-Session: https://claude.ai/code/session_015NBvK3VetFgPNaB767toLG (197fa79)
- Share MP3 says how long it is; DAW bundle beside it, leading on a wide screen (39351ef)
- Overlay saved lane kinds onto /api/midi's tracks before drawing lanes (632d009)
- Draw the take's MIDI as lanes under the waveform (25e8e25)
- Lane geometry: rows, note rects and colours for the MIDI lanes (0eb894a)
- GET /api/bundle: a region as WAV plus re-based MIDI in one zip (2134bb9)
- Split the cut's MIDI and WAV writers so a bundle can stream them (ef4eafd)
- GET /api/midi: a take's notes in frames, for the lanes (7935481)
- Let a take's sidecar override which MIDI lanes are drums (7df40c0)
- Decode a take's MIDI into notes in frames, and guess which lanes are drums (1c04cf9)
- Plan the MIDI lanes and DAW bundle in nine tasks (e557567)
- Spec: MIDI lanes on the take page, and the DAW bundle (4684e75)
- Record v2026.09.15.1 in the changelog [skip ci] (a24c97b)


## v2026.09.15.1 — 2026-09-15

- Answer the bento question in the docs: device port, per-track OutCh, 20 ms (94002e6)
- Every track ends at the take's end; scripts/midi-dump.py (acb5493)
- Fuzz the MIDI parser and the SMF decoder; harden Decode (ad7af32)
- Manifest tempo_bpm is the tempo at the window's middle pulse (ec1acd3)
- Without a Start, bar 1 is the take's first frame (0f013de)
- Spec: cuts carry their MIDI now (f4c49a7)
- Carry a take's MIDI along when a region of it is cut (3b35724)
- Never overwrite a take saved in the same second (c3ca641)
- Harden the watcher, the bridge and bar snapping after review (0119168)
- Document MIDI capture; MIDI download and device list in the UI (08d52d1)
- Export a take's MIDI beside it: .mid, manifest, bar-snapped window, demo (6801060)
- Clock bridge, tempo map from pulses, and the saver's MIDI seam (dbea07c)
- SMF writer and per-(device, channel) export with a tempo map (61aa569)
- Watch every rawmidi port: hotplug, per-device readers, allow/deny policy (4198eec)
- MIDI parser and event ring: complete messages, timestamped, device-tagged (c2e8f2e)
- Spec MIDI capture: aligned multitrack MIDI beside every take (bd06cd8)
- Catch the docs up to the Fine tune grid as it actually is (838a421)
- Fix the lost-capture phantom pointer, and three smaller review findings (727dc57)
- Show the region's length in seconds and bars under Fine tune (7f488dd)
- Fit quiet takes to the waveform height, display-only (129d926)
- Grow a selection past the screen edge; haptic on hold; pointer id guards (0dfc8f7)
- Render 500s drop the filename; spec prose matches hold-to-select; docs for the polish (a152159)
- Cache the overview's waveform; ignore a second pointer on the strip Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com> Claude-Session: https://claude.ai/code/session_015NBvK3VetFgPNaB767toLG (40d6b7b)
- Plan a polish pass on the waveform page v2 (f8ddf24)
- Record v2026.09.11.2 in the changelog [skip ci] (7970ca5)


## v2026.09.11.2 — 2026-09-11

- Rename the default branch to main (c2e71a8)
- Plan: fix the self-review's helper note (313dc76)
- Plan: name the real 16-bit test helpers (405e0c8)
- Plan the waveform page v2 in seven tasks (87995ab)
- Spec the waveform page v2: drag-select, implicit loop, one-tap share (fe58a84)
- A pan breaks a double-tap; a slow still press is still a tap (8b27553)
- Hold to select a region; a plain drag pans again (b953987)
- Make region selection a deliberate pull, not a wobbly tap (f087006)
- Let a double-tap inside the region add a flag (b3b302c)
- Fix the final review's findings on the waveform page v2 (2914401)
- Share a region as an MP3 through the phone's share sheet (376d3f5)
- A region always loops, and only the region you settle on (6831b40)
- Document the waveform page's share flow and gestures (c2b30e0)
- Waveform page v2 layout: overview, drag-select, implicit loop, fine tune (f40f8cb)
- Never strand a provisional region when a drag is interrupted (96a79b9)
- One-finger drag on the waveform selects a region; wheel zooms (05632ec)
- Stream a region as an MP3 over GET /api/render for sharing (f12e769)
- Reject regions too short for two fades; clamp RenderArgs fade start at 0 (638c03e)
- Overview strip with a draggable viewport window (87eb0b2)
- Render a faded MP3 of a take's frame range through ffmpeg (8f2e74b)
- Plan: fix the self-review's helper note (f757595)
- Plan: name the real 16-bit test helpers (830e863)
- Plan the waveform page v2 in seven tasks (43b4727)
- Spec the waveform page v2: drag-select, implicit loop, one-tap share (0ebe4f6)
- Record v2026.09.11.1 in the changelog [skip ci] (5b2099f)


## v2026.09.11.1 — 2026-09-11

- Fix the final review's findings on the waveform page (de85956)
- Fix five Important findings from the waveform page review (94d31d0)
- Document the waveform page and its endpoints (b926e01)
- Waveform page: zoom, flags, one region, loop audition, export as a cut (170458a)
- Clamp fpp on resize and drag handles from the grab point (eeaba32)
- Let the downbeat be grabbed inside the region (59c6893)
- Fix clock.js: clean up failed region switch, avoid rewind on loop-on, guard double play (eb407ec)
- Canvas waveform view with pan, pinch, region handles and flag hit-testing (b259cd7)
- Make tiles.test.js backoff/retry waits condition-based, not fixed delays (0c4edaf)
- Playback clock for the waveform page: preview and slice engines behind one position() (0f9d2c3)
- Tile cache for the waveform page with coarse fallback and backoff (2d091e4)
- Use quoted glob form for node --test in CI (3270236)
- Pure geometry for the waveform page, tested under node --test (94bff41)
- Store a take's downbeat and expose cut lineage in the listing (0c11faa)
- Fix slice review findings: pre-check bit depth, dedupe WAV header (23c4a67)
- Stream a faded 16-bit slice of a take for auditioning (2985831)
- Export a region of a take as a new take over POST /api/cut (15fc01e)
- Cut a faded region of a take into a new take (6d6da42)
- Serve peaks for any frame range from GET /api/peaks (9a57e9f)
- Compute peaks over any frame range of a take (a61ee5e)
- Stream a frame range out of a take without reading the file (bedfc10)
- Plan the waveform page in thirteen tasks (fe01536)
- Spec the waveform page: find and cut (40b50b4)
- Name a flag on a saved take (1c8a7f5)
- Catch docs up to the flags branch: eleven routes, not nine (b1afae7)
- Fix three tests that could not fail (873555c)
- Fix five Important findings from the flags branch's final review (f25ba34)
- Flag a saved take by clicking its waveform (f93b2bf)
- Include a take's flags in the /api/jams listing (6d773f2)
- Mark a moment on the live ribbon (ef82d7d)
- Fix review findings on the flags HTTP surface (c65ac05)
- Expose flags over HTTP, live and per take (3c51e41)
- Stamp a take's flags into its sidecar and its cue chunk (458d7d2)
- Sharpen the oversized-chunk test's failure message (be648ba)
- Fix cue-read allocation bounds and pin the crash-safety write order (89b558f)
- Read and write RIFF cue points without rewriting the take (2beacbc)
- Translate live marks into take-relative frames at save time (2699053)
- Fix test to verify nil return, not just empty (1ba5391)
- Hold live marks as absolute ring frames (1ded2d8)
- Strengthen SnapshotAt tests: verify data/position agreement and test wraparound (16a8c06)
- Let the ring report where a snapshot ends (f84255e)
- Add flags to the take sidecar (4258e89)
- Fix two defects the pre-flight scan found in the flags plan (0e57d1c)
- Plan the flags implementation in nine tasks (14febee)
- Let Mark place a flag while capture is unhealthy (898973f)
- Spec flags: live ring marks that survive into a take as cue points (5947f95)
- Record v2026.09.09.1 in the changelog [skip ci] (1eabd63)


## v2026.09.09.1 — 2026-09-09

- Undo Go's HTML escaping before showing the capture error (27820db)
- Read the journal the way that actually works on a Pi (8b34e41)
- Fix the demo's ring size, a silent installer exit, and four narrower defects (f03f0c6)
- Push the tag before the changelog, so a moved master cannot cost a release (0fbab6e)
- Finish the rename the verification grep kept missing (c49e5ce)
- Fix the demo command and four overclaims in the docs (23a46a7)
- Document the project for someone who just found it (2193aa2)
- Fix a release-container build gap and a tag-collision bug from review (a89a0ab)
- Test on every push and cut a release on every merge to master (2133188)
- Fix a coreutils cp regression and a dead healthcheck signal (29890b0)
- Fix five install.sh correctness issues from review (95b6305)
- Ship the service unit and an installer (ebd8c73)
- Rename the UI, and retake the screenshots that showed the old name (a2f1a89)
- Capture the UI at three viewports against the demo source (ebdc7f8)
- Add --demo and --version, and report the version on /api/status (d037066)
- Make the demo source's Open safe against re-entry (cc163f9)
- Hoist the demo source's per-block allocations to construction (0ec27e5)
- Generate a synthetic jam so the app runs with no interface attached (26da8e6)
- Cover the supervisor with a fake source (4323ff1)
- Document the Reset precondition and retarget stale PortAudio prose (d9585df)
- Put the audio device behind an interface so a build needs no hardware (462869c)
- Default to the post-fader main, not the channel-one tap (07b1d21)
- Resolve the UI directory for a checkout as well as an install (cecc396)
- Move the Go tree to a conventional layout under the name Hindsight (cfb401c)
- Ignore the subagent-driven-development workspace (7adf615)
- Plan the rename, the demo source, the installer and the release pipeline (35d7bd9)
- Design the rename to Hindsight and the road to a public release (82b662d)
- Record that the EP has no sequencer and infers its tempo (f63b271)
- Drop the backlog ALSA hands over when the reader opens (1db817c)
- Use the EP's real card entry as the discovery fixture (d3ec6ea)
- Show and edit each take's tempo in the takes list (a9b182d)
- Add an opt-in ssh-agent bypass to deploy.sh (30eb0dd)
- Show the live tempo as a fourth stat tile (5d8b974)
- Let the owner edit a take's BPM (64e97b8)
- Wire the clock into the process and report it on /api/status (dc91ff5)
- Stamp each take with the tempo its window was played at (4cbb74c)
- Carry an optional BPM in the take sidecar (22cba01)
- Read the EP's clock in its own goroutine, and recover from unplugs (dba6fb1)
- Find the EP's rawmidi node by scanning /proc/asound/cards (311e26e)
- Add the MIDI clock ring and its tempo estimator (bbc83eb)
- Draw take waveforms on the same dB scale as everything else (3469c3f)
- Plan the MIDI clock and tempo metadata work (f35036b)
- Give the last 30s a quarter of the ribbon, not half (d19bec6)
- Report the edge age Buckets actually used (7fedbb2)
- Record three more plan defects found during execution (8fec1a6)
- Stop the ribbon asserting SILENT from a stale response (4437466)
- Stop SignalSeconds holding the audio callback's lock (978bb8b)
- Serve the buffer ribbon envelope over HTTP (f737ebd)
- Feed level bins into the retained envelope (d4da8e4)
- Count seconds of signal in a span (269b74f)
- Fix two verification instructions in the ribbon plan (a96ced6)
- Precache the ribbon module (1fa93b0)
- Lay out the buffer ribbon across both columns (7b82103)
- Swap the canvas visualiser for the buffer ribbon (9b30194)
- Add the buffer ribbon component (262df92)
- Share fmtDur from meter.js (a8ed171)
- Correct three task-splitting defects in the ribbon plan (790b84a)
- Add a retained level envelope for the buffer ribbon (bbb834b)
- Ignore harness-managed worktrees (ba20ec4)
- Plan the buffer ribbon (afc2d1c)
- Spec the buffer ribbon (c49d9b2)
- Add the buffer-ribbon design canvas and envelope tooling (f376a01)
- Raise the ring to 15 minutes and add a 7m capture tier (1a81368)
- Spec the MIDI clock listener and editable tempo metadata (bccc1ee)
- Plan: record the hot-plug execution and what it turned up (0334aff)
- Verify hot-plug recovery on hardware (998f8ab)
- Rescan PortAudio devices when reopening the stream fails (bcff42d)
- Add paLifecycle to own PortAudio init/terminate (e0421ea)
- Keep the screen awake while docked on a charger (983c2dd)
- Spec: screen wake lock for the docked tablet (4192f6b)
- Two-column layout for tablets and landscape (d5cc3eb)
- Add deploy.sh --static for HTML/CSS/JS-only changes (6517024)
- Stop /api/status reporting silence between level drains (5c5397d)
- Point SAVE_CHANNELS at MAIN (USB 1/2), not the CH1 pre-fader tap (5884aa8)
- Keep home network details out of the public repo (41623b5)
- STATE: phase 1 deployed and verified on the Pi (3af4b8a)
- STATE: phase 1 is code-complete, pending the hardware pass (9b37c06)
- Spec: the sidecar's human name is label, not name (5de2274)
- Style the star and inline rename (8d99246)
- Rename a take inline (23ed502)
- Add a star toggle to each take (dd7d6e2)
- Fix correctness defects in PATCH /api/take found by security review (3449c3a)
- Add PATCH /api/take for labels, stars and trim bounds (d0d506f)
- Plan: add the doc-comment step Task 3 was missing, and track progress (8a9fcba)
- Fix stale ListTakes doc comment (81a8298)
- Delete the sidecar along with its take (3836142)
- Sort starred takes first (1d46efa)
- Merge the sidecar into the take list (6096825)
- Correct the plan's sidecar versioning, and track phase 1 progress (7abe497)
- Add regression coverage for the sidecar's 0644 file mode (4c5a9c1)
- Fix meta sidecar version handling and file mode per review (6b4abaf)
- Add the per-take metadata sidecar (5394886)
- Stop long capture errors from overlapping the brand in the top bar (3c22363)
- STATE.md: record the phase 1 plan and its gotchas (75160ab)
- Plan: take identity (phase 1) (dcc4157)
- STATE.md: record the published repo and tablet support (7effdd5)
- Initial commit — audio dashcam (8aade9f)

