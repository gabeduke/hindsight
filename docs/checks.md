# Manual checks

What still has to be checked by hand, by place. Most of the app is checked
by the user flows (`docs/flows.md`, `node scripts/flows.mjs`); a check that
a flow covers is not listed here, and the flow is named where a place's
checks were cut for it.

- **[rig]** and **[phone]** lines need the hardware or a real phone, and
  stay manual.
- **[demo]** lines can be run against the demo. They are the backlog of
  stories to turn into flows in `scripts/flows/`; delete a line here once a
  flow covers it.

## The Studio's feed

Covered by flows: KEEP (J1.1), Flag now riding into the next take (J1.2),
a span on the ribbon (J1.3), the header's ☰ and its sheets (J5.1).

- [demo] Add or edit a note on an old take, then reload → the take is still
  where it was in the list, not at the top.
- [demo] Open the same take on two devices and add a different note on each
  → after a reload, both notes are there.
- [demo] Set `MAX_SAVES=3`, edit a note on the oldest take, then KEEP
  twice → the oldest take is pruned all the same, to Recently deleted.
- [demo] KEEP while watching the list → a take never appears half-written:
  no missing duration, no broken waveform.
- [demo] With the Studio open on two devices for a minute → the Pi's CPU
  stays low. An unchanged list costs a directory listing, not a scan (watch
  `top`, or the request timings in the browser's network tab).
- [demo] Star an older take → it is pruned last, and the Listening Room's
  ★ shelf shows it.
- [demo] KEEP, then tap the toast's *Undo* → the take leaves the shelf, and
  shows under *Recently deleted*; *Restore* → it's back, starred.
- [demo] A take with a selection shows it in the List as a bracket on its
  waveform, and its length as "0:30 of 0:59".
- [demo] The List and the take's page draw the same take at the same height.
- [demo] On a phone, Settings' first line reads *Hindsight dev · Releases ·
  the guide*; Releases closes it and opens the Releases sheet.
- [rig] Switch the interface off → the feed's lamp turns amber and says
  *waiting for the interface*, with no error toast. Switch it on → it
  records again.

## Updating and Settings

- [rig] With a newer release out, ☰'s Releases says *Update to v…*. Press
  it → the sheet lists what it brings in; install → downloading,
  installing, *Restarting…*, and the page comes back on the new version.
- [rig] Releases → pick the one before → *This takes out* lists the newer
  release's notes, and **Go back to v…** installs it.
- [rig] Start a phone recording, then install → *Not now: a phone is
  recording*, and nothing installs.
- [rig] `make deploy` → Releases shows the release it's built on plus its
  commits, not `dev`.
- [demo] Settings → Mix → Mono → Save → Restart → the page comes back, and
  Settings shows Mix *set here*, with no restart owed. Reset Mix →
  *default*; Restart.
- [demo] Channels 2, Inputs in TAKES 3,4 → Save is refused, naming
  SAVE_CHANNELS.
- [rig] Scarlett Solo on Automatic → *Recording from Scarlett Solo 4th Gen,
  2 channels*; Mono, restart, sing and play → the take is centred.

## The Listening Room

Covered by flows: a tap on a spine plays it and the take plays on between
rooms (J2.2), the bar's sources (J2.3), ✎ on the bar (J2.4), Open › and ★
(J2.5), hold a spine, delete, Undo (J2.6), the search (J2.7), Play all
(J2.8).

- [demo] Search, then turn on ★ with nothing starred → "No takes match",
  not "No takes yet".
- [demo] Record from a phone, then turn on *Phone* → only that take shows.
- [demo] Open a take from a filtered list, then the take's name → *Next
  take* → the next take is the next one the list showed.
- [demo] Delete the only take a filter shows, on its page → back here, with
  an Undo.
- [demo] Open the room on a second device → the same tags, and the same
  colours on the same takes.
- [demo] Delete a tag that has takes → they show as untagged, nothing else
  changes, and a filter that was on that tag turns itself off.
- [demo] On a phone, play a take → the mini player shows ▶, the name, ✎
  and the strip.
- [demo] With a take playing, tap the bar's strip half way → it jumps
  there; drag it → it scrubs.
- [demo] On a take's page, **Edit tags** → add "Ideas" with a colour, Save.
  Back here, hold a spine on a phone → it is ticked and the select bar
  rises; tap another → both are ticked and neither plays. **Tag** →
  *Ideas* → both spines wear its colour. **Done** → the ticks go.
- [demo] In the List, a tape that has been bounced twice is one row with
  *MIX ×2* and its earlier bounce under it; tap that line → it plays.

## A take's page (Open)

Covered by flows: opening a take from the bar (J2.5), its notes as it plays
(J2.9), GRAB from it onto the cue lane (J3.1). Its gestures are checked by
hand too: `docs/development.md`, *Checking a take's page by hand*.

- [demo] Open a take → the page asks the Pi for that one take
  (`GET /api/take?file=`), not the whole list.
- [demo] Open a 15-minute take, zoom out fully, then zoom in two steps → each
  zoom draws in well under a second, and the Pi doesn't read the whole file
  from disk.
- [demo] KEEP a selection of a take whose MIDI lanes you've switched to
  drums, and whose downbeat you've moved → the new take keeps both. Its name
  reads "*source name* · 0:42–1:10", not "… cut cut".
- [demo] With `SAVE_ALL_CHANNELS=true` and `SAVE_CHANNELS=3,4`, Repeat a
  selection, then share it → the loop and the MP3 are the same pair.
- [demo] Start two shares at once → the second waits for the first, and
  both finish.
- [demo] Make a selection that fills the screen, then drag with one finger →
  the view pans and the selection stays where it was.
- [demo] Drag a note's pin on the waveform → the note moves.
- [demo] Tap **In**, move the playhead, tap **Out** → the same selection as
  by holding and dragging.
- [demo] A note's **GRAB** → the Studio opens with that stretch of the take
  on the cue lane. With no note after it, the stretch is eight bars, or 16
  seconds.
- [demo] On a phone → the take's name gets its own row under the header's
  keys; in the List a long name keeps its row and the tempo and length move
  under it.
- [demo] Set a selection with Repeat off and press ▶ before In → playback
  runs through the selection and on. Turn Repeat on → it repeats In to Out.
- [demo] Select part of a take and turn on **Level** → it says *Level +N dB*,
  and ▶ plays it louder; **Download** (or Share) → its key says the gain, the
  MP3 peaks at about −1.5 dBFS, and the toast says *Levelled +N dB*. Move or
  clear the selection, or ↶ it → the number follows. Turn Level off → as
  recorded.
- [demo] Play a take for ten seconds and press **J** (or **↺ 5 s**) → it
  goes back five seconds and plays on. On the Listening Room's bar, the same.
- [demo] With the demo running, `kill -USR1 <its pid>` (the demo reports an
  overflow, as an interface does), wait a few seconds and KEEP 30 s → the
  take says *⚠ 1 dropout*, with a ⚠ in the ruler where the signal was
  sent; in the Listening Room its spine wears the sticker. KEEP a selection
  with the ⚠ in it → the new take has it too; one without → it doesn't.
- [rig] While the Pi records, `kill -STOP $(pgrep -x hindsight); sleep 1;
  kill -CONT $(pgrep -x hindsight)` (it runs as your user, so no `sudo`),
  then KEEP → *⚠ 1 dropout* where it stopped: the interface overran while
  the Pi wasn't reading it. Stopped for more than 2 s, the capture restarts
  the stream, and that's a dropout too.
- [demo] On a take with a BPM, choose *Snap: beat* and drag a grip → it jumps
  beat by beat. A nudge moves one beat; with Snap off, a nudge moves 10 ms.
- [demo] On a take with a BPM, tap **Set to playhead** in the downbeat row
  → the downbeat and the grid jump to the playhead. **◂ ▸** nudge it; ↶
  undoes the run in one step.
- [demo] Set the BPM from the line under the header (*+ bpm*) → the ruler
  shows bars at once, without going back to the list.
- [demo] Go back to the list → it's scrolled where you left it.
- [demo] Turn on help mode from ☰, then tap any button → a tip explains it,
  and the button doesn't act. In help mode, Space plays nothing; Escape
  leaves it.
- [demo] On a computer, hover any button → its tip shows.
- [demo] Tap a MIDI lane's name → a menu to collapse it, show it as drums or
  notes, or hide it.
- [demo] The take's name → *Previous take* or *Next take* → the take before
  or after it in the list's order. Then **‹ Takes** → the list, scrolled
  where you left it.
- [demo] Open a take with a BPM and drag bar 1 at the very start → the
  downbeat moves (the playhead, also at the start, stays put).
- [demo] Press ▶, then press and release the playhead's handle without
  moving → the take keeps playing.
- [demo] *Snap: beat*, play, and tap **In** then **Out** → both land on
  beats.
- [demo] **+ tag**, choose a tag → its name sits beside ★; open it and
  press the lit tag → the key reads *+ tag* again.
- [demo] Bounce a tape twice, then open the newer take → *Earlier bounces*
  lists the other; tap it → that take opens.
- [demo] Open `/wave.html?tape=…` → the Studio.

**The boundary editor:**

- [demo] Tap In's time → the view centres on In and the editor bar shows. Zoom
  out with ZOOM, POSITION the line near a kick, zoom in, then **Attack** → In
  sits on the kick's start, and the readout says *on* a beat, such as *on 2.1*
  (the demo is on its grid). **Zero** → In moves by under 5 ms. **Done** → the
  toolbar returns.
- [demo] With an 8-bar selection, **Seam** → the end and start meet at the
  centre and Repeat is on. Tap the Out half and step it → only Out moves.
- [demo] At 390 × 844, nothing in the editor bar is cut off, and the waveform
  keeps at least half the screen.
- [demo] Turn POSITION in one drag, then **↶** → the point is back where it
  started, in one step.
- [rig] On a stylophone take with a part played over it, set a loop's In on
  the first beat's hit and its Out on the last bar line, check the seam,
  GRAB it and DROP it on a track → no stutter.

## Undo and Recently deleted

Covered by flows: delete a take from the shelf and Undo (J2.6).

- [demo] Delete a note → the toast offers Undo; tap it → the note is back.
- [demo] Change a take's name, then its BPM, then tap ↶ twice → both are
  back as they were. ↶'s tip says "Undo the tempo change" before the first
  tap.
- [demo] Clear the selection → the toast offers Undo; tap it → the selection
  is back.
- [demo] Open a take from the list and choose *Delete this take* from its
  name → the next take in the list opens, saying "Deleted … · Undo";
  *Previous take* goes to the one before the deleted take, not to it. Tap
  Undo → the deleted take is open again, starred, with its notes.
- [demo] Delete the last take in the list from its page → the one before it
  opens. On the only take left → you're back at the list with "Deleted … ·
  Undo".
- [demo] Delete a take → it shows under *Recently deleted*. Restore it →
  it's back, starred.
- [demo] Fill the disk to just above `MIN_FREE_GB` with Recently deleted
  full, then KEEP → the take is saved and the oldest deleted take goes.
- [demo] Select three takes and export → one zip with their WAVs, sidecars
  and MIDI.
- [demo] Select two takes and Delete → both go; the toast's Undo brings both
  back.
- [demo] Rename a take on one device, rename it again on another, then tap
  ↶ on the first → "Not undone: the name has changed since", and the other
  device's name stays.

## The ribbon

Covered by flows: a span on the ribbon and its KEEP (J1.3).

- [demo] Wait ten minutes, then select a span about eight minutes back on the
  ribbon and KEEP → the take holds roughly that span, not the last N
  minutes, and sits in the list by when it was played.
- [demo] A quick tap, or a vertical swipe over the ribbon → nothing
  selected; the page scrolls.
- [demo] Hold on the ribbon without dragging → the bar reads "… ago to now".
- [demo] Tap a note on the ribbon → its sheet opens. *Save from here to now*
  makes a take starting at the note, carrying it at its first moment.
- [demo] Select a span near the old end and wait until its start passes the
  oldest audio → the bar turns amber and says so; KEEP still works, from
  the oldest audio.

## Recording from a phone

- [rig] Record 20 seconds on the phone → a take labelled *Phone* appears
  after Stop and plays back cleanly.
- [rig] Turn Wi-Fi off for five seconds mid-recording, then on → the take is
  complete, with no gap.
- [rig] Open the plain `http://` address → ● on the phone explains that it
  needs the HTTPS address.
- [demo] Watch the list while recording → nothing appears until Stop.
- [demo] Record from a desktop browser at `http://localhost:<port>` (a
  secure page) → the take is 48 kHz stereo, labelled *Phone*, with a
  waveform.
- [rig] Record, then close the tab without Stop → about ten minutes later a
  take labelled *Phone (partial)* appears.

## The tape: loops, catching and recording

Covered by flows: GRAB and DROP (J1.6), CATCH the last pass (J1.4), arming
(J1.5), setting the tempo (J1.20), ▶ from the bar (J1.12), another device
following the Pi (J1.14).

- [demo] Make a new tape, set 90 BPM and 4 bars → it reads *90.0 BPM · 4
  bars*, and the lanes show four empty bars. Press ▶ → a click on every
  beat, higher on the bar.
- [demo] Make a new tape, give track 1 the input *aux*, tap on a kick, then
  tap about 2.5 s later on another → a 2.50 s loop, *1 bar at 96 BPM*,
  playing on track 1.
- [demo] From the tempo's panel, choose 2 bars → it reads *192 BPM · 2
  bars*; the loop sounds the same.
- [rig] Play a phrase on the Orchid into aux, tap on its first note, and on
  the same note when it comes round → the loop plays out of channel 1 in
  time with you, and the tempo reads sensibly.
- [rig] DROP a grab on a track and press ▶ → the loop plays out of channel
  1, and within a few seconds SYNC turns green.
- [rig] Turn the Sidekick off and on again while the tape plays → ▶ reads
  *no output*, then the tape plays again; SYNC is amber until it locks
  again.
- [demo] Catch from *ch1* → the toast warns that the tape was in that source
  too.
- [demo] GRAB 2 s onto an empty tape and press ▶. Arm track 2 and give it
  the input *aux*; wait four passes, then **−3** under Passes → a 2.0 s part
  lands on track 2 at bar 1, and the toast says *Caught 2.0 s from aux onto
  track 2*.
- [demo] Give track 3 the input *ch2*, arm it, and point at Catch → its
  lane outlines the loop; catch → it's from ch2. On a second device the same
  tape shows track 3's ● lit.
- [demo] Tap a part, then **Remove** in the action bar (or Delete), then
  **Undo** in the toast → the part is back. ↶ and ↷ step through the same
  history.
- [demo] With a 1-bar loop playing, arm track 2, ●, wait three passes, ● →
  *Kept 1 bar from aux on track 2*: the last full pass.
- [demo] On a take's page select about 2 seconds and press **GRAB**; then,
  on an empty tape with the tape stopped, press **⌘V** three times → the
  first is the loop, and the next two lie end to end after it. Undo takes
  them back one at a time.
- [demo] A track's ›, its inspector, pan to the left → it sits left.
- [demo] With the tape playing, the meters on *main* and *ch1* move and
  *ch2*'s stays empty (bus B is silent). Choose *ch2* and catch 1 bar → the
  toast is amber: *it's silent: nothing came in*.
- [rig] Play the Bento into jack 2: the *ch2* meter moves, and *aux*'s stays
  empty until the instrument on aux plays.
- [demo] On a 4-bar loop, play for a pass, then catch 1 bar → a one-bar
  part lands on the bar that just finished.
- [demo] Open the Studio on two devices and mute a track on one → the
  other shows it within a second.
- [demo] From the tape's name choose **Rename…**, type a new name and Save →
  the name and the tape list show it, and a second device shows it within a
  second. An empty name can't be saved, and ↶ doesn't undo a rename.
- [demo] **Duplicate** a tape and load the copy, delete the original, then
  play the copy → it plays fully.
- [demo] Restart Hindsight → the tape that was loaded is loaded again, with
  its undo.
- [demo] Arm track 3, then ● with the tape stopped → the position reads
  *count-in 1 of 4…4 of 4* over a bar of click, then the tape plays; after
  two passes press ■ → *Kept 1 bar*: the last full pass, on track 3.
- [demo] ● with the tape stopped, and ■ during the count-in → nothing is
  kept, and nothing complains.
- [rig] Arm track 3 with the guitar in aux, ●, play over the count-in and
  two passes, press ■ → the guitar is on track 3, in time.
- [demo] Choose **Replace**, catch a pass onto a track that has audio →
  the old audio under it is gone, not layered.
- [rig] Turn channel 1's FX knob → the tape's sound changes, and the live
  instrument on aux doesn't.
- [rig] Play the Orchid into aux over the loop for two passes, catch −1
  onto track 2, and play → the part plays back in time with the loop, to
  the sample.
- [demo] Start the demo with `TAPE_DEMO_ALIGN=true`, DROP drums on a track
  and play → SYNC goes from amber to green within about five seconds.
- [rig] Play a loop that's only a sustained pad → SYNC stays amber; it
  never guesses at a lock it can't be sure of.

## The tape: editing

Covered by flows: laying out a song with sections, a range, Copy, Delete
(J1.9), a part's gestures (J1.11).

- [demo] Hold on the ruler and drag across 4 bars, **Cut**, tap bar 1 on the
  ruler, then press **⌘V** three times → twelve bars of the same four, with
  no clicks where the copies meet.
- [demo] Hold an empty spot of track 4 and drag up across track 3 and two
  bars → the range is shaded on both lanes, and the action bar says *Tracks
  3–4 · bars …*; the loop moved to it. Drag its right edge's tab a bar in →
  one bar; **Copy**, Esc, draw a range on track 1 and **Paste** → the pair
  of tracks again, from track 1.
- [demo] Hold on the ruler across two bars → the tape loops those. Lock the
  loop (⌗'s *Lock the loop*) and drag across bar 4 → the range moves, the
  loop stays.
- [demo] Tap a part that fills its lane, **Bars** → a range over its bars;
  drag the left tab two bars in, **Cut** → the part's end is gone, its start
  stays.
- [demo] Put the playhead inside a part, **Split**, hold the second half and
  slide it a bar later, then ↶ twice → the part is whole again.
- [demo] Press **S** with the playhead inside a selected part → it splits.
  ⌘A → every part is selected; Escape → none.
- [demo] Tap a section again → its sheet; make it red → the strip shows it
  red.
- [demo] Tap a 1-bar part at the start of a 4-bar loop, *Repeat to the
  loop's end* → three copies after it, four parts in all.
- [demo] Paste 4 bars from the middle of a take, tap the part, close its
  sheet → a grip shows inside each edge. Drag the right grip a bar left →
  the part ends a bar sooner, and the toast says where; ↶ → it's back.
- [demo] With ⌗ on *Beat*, drag the left grip two beats left → the audio
  from before it shows faintly as you drag, and the part starts two beats
  sooner, what it already played still where it was.
- [demo] Drag a grip far out → it stops 2 s past where the part began or
  ended, and the grip turns amber.
- [demo] Split a part, then drag the first half's right grip into the
  second → it stops where the second starts.
- [demo] Hold a part on track 1 and drag it down onto track 2 → track 2's
  lane is outlined; let go → the part is on track 2 at the bar it was
  dragged to, and track 2 is selected; ↶ → it's back on track 1.
- [demo] Slide a part sideways with your finger wandering a little up or
  down → it stays on its track.
- [demo] Mute track 3 and slide a part onto it → it lands there, silent.
- [demo] Pick a 1-bar part and drag its ⟳ corner three bars right → three
  ghost copies and ×4; let go → four bars of it end to end, with no clicks
  where they meet; ↶ once → just the one. Drag it right and all the way
  back → nothing changes.
- [demo] Pick a part and drag the square at its top right corner about a
  beat to the left → a shaded fade out follows, saying how long it is; let
  go → the toast says *Fade out:* and that length, and it fades as it plays.
  Drag it on to a bar line → it sticks there: *Fade out: 1 bar*. In its
  inspector choose *Exponential* → the curve drops early and tails off, and
  so does the sound. Drag the square back to the corner → no fade.
- [demo] Pick a part that fills the view, drag its ⟳ corner to the lane's
  right end and hold it there → the view scrolls on and the copies and ×N
  keep coming; let go → that many, end to end.
- [demo] Repeat a part that sits a layer above another (a catch over a
  loop) → its copies are on its layer, with no dips where they meet.
- [demo] Repeat a part, then change one copy's level → the others keep
  theirs.
- [demo] In a part's sheet, **Fade in** a beat → its first beat is shaded
  under a curve, and it swells in from silence; off → a hard start again.
- [demo] Fade a part out over a bar, then **Split** it in the middle → only
  the second half fades; ↶ → one part, fading over its last bar again.
- [demo] Fade a part in, then **Reverse** it → it fades out instead.
- [demo] On a tape with no tempo, the beat and bar fades are greyed out.
- [demo] Tap a part, then Shift-click a part on another track (on a phone,
  **Select more**, then tap it) → the action bar counts two. Hold one and
  drag both a bar later and a track down → they move together; ↶ → both
  back.
- [demo] Drag a picked pair up past track 1 → they stop with the higher one
  on track 1.
- [demo] With two picked, **Copy**, then select track 3 and **Paste** → the
  pair again from track 3, as far apart as they were.
- [demo] On a computer, click a part, Shift-click another, **⌘D** → a copy
  of both right after them; **Delete** → the two picked are gone; ↶ → back.
- [demo] At 84 BPM (a bar isn't a whole number of frames), make a section
  and drag both its edges → no error; it stays on the bar lines.
- [demo] Tab to the sections strip, **→** to a section, **Enter** → its bars
  are selected; **Enter** again → its sheet.
- [demo] Drag a section's edge into the next → it stops where the next
  begins.
- [demo] Export stems → the `.mid` has a marker named for each section.
- [demo] Copy 4 bars, put the playhead at bar 5 and point at **⇥ Insert** →
  the lanes show everything from bar 5 on moved 4 bars later, the gap shaded
  with the clipboard dashed in it, and the ruler says *+4 bars*. Click →
  that's what happens, on every track; ↶ → as it was.
- [demo] Hold the ruler across bars 9–12 and point at **⇤ Delete time** →
  bars 9–12 shaded and what followed drawn moved up, *−4 bars*. Click →
  *Deleted bars 9–12*; the sections after it moved up too.
- [demo] Point at **⤓ Paste** → an outline where it will land; nothing else
  moves.
- [demo] On a phone, tap **Insert** → the preview and *Tap again*; tap
  elsewhere → nothing happens. Tap Insert twice → it's done. Turn ⌗'s *Ask
  before Insert and Delete time* off → one tap does it.
- [demo] Make a section *Chorus* over bars 5–8, open its inspector,
  **Duplicate section** → bars 9–12 are the chorus again, named *Chorus*,
  and what was at bar 9 is at bar 13.
- [demo] With a part across bar 5, **Insert** at bar 5 → it's split there,
  its second half moved on with everything else; no click at the split.
- [demo] Zoom out until a part is narrow → no grips; its inspector's **Start
  here** and **End here** trim it to the playhead.
- [demo] Split a part, tap either half, **Join the split** → one part.
- [demo] Hold the ruler across a 2-bar loop, **×2** → a 4-bar loop whose
  second half is a copy of the first.
- [demo] In a part's sheet, **Download as WAV** → the browser downloads
  *<tape> track 1.wav*; **Share as WAV…**, where the browser can share
  files, → the share sheet offers it.
- [demo] Copy a selection on a take's page, then Paste it on a tape → it's
  there.

**Lining parts up:**

- [demo] Zoom the tape's lanes right in → every lane draws single samples,
  not blocks.
- [demo] Catch a pass onto track 2, tap the part, **Align** → the view
  centres on its first hit. **Hit → Grid** → the readout says *on* a beat.
- [demo] Nudge a part 7 ms late, **Align**, pick track 1, **Hit → Track** →
  the readout says *0.0 ms from track 1*. **↶** once → the part is
  back where it was.
- [demo] At sample zoom, with an overdub rushed 3 ms against a loop part
  on track 1 that starts on its kick: **Align**, pick track 1,
  **Hit → Track** → the readout says *0.0 ms from track 1*.
- [demo] Turn POSITION in one drag, then **↶** → the part is back, in one
  step.
- [rig] Overdub a part on the phone over a loop, then Align it to the loop's
  track by ear and by **Hit → Track** → no flam.

## Bounce and export

Covered by flows: Bounce from the tape's name (J3.2), Share the mix (J3.3),
Download the mix (J3.4).

- [demo] Start a bounce and press ■ → *The bounce didn't save*, and no take
  appears.
- [demo] Bounce the same tape three times → the Listening Room shows one
  spine for it, wearing **MIX ×3**, and its List row has the two earlier
  bounces under it.
- [rig] Bounce with an FX on channel 1 → the take has the FX.
- [demo] Export stems → a zip with a WAV for each track with audio, all the
  same length, plus a `.mid` at the tape's tempo. In a DAW they line up at
  bar 1.

## The MIDI clock

- [demo] Start the demo with `TAPE_CLOCK=lead`, set a tape to 96 BPM and
  press ▶ → under the transport, *clock → Demo follower ● · hears 96 BPM*.
  Press ■ → the ● goes.
- [rig] Press ▶ on the tape → the Bento starts in time; ■ stops it.
- [rig] Loop four bars for two minutes → the Bento stays in time with the
  tape, and lands on bar 1 each time the loop comes round.
- [rig] Locate to bar 3 and press ▶ → the Bento starts at bar 3.

## Overdubbing on a phone

- [demo] With a 1-bar loop, arm track 2 and open **🎧 Overdub on this
  device** → it says it plays *the loop (1 bar)*, onto track 2. **● Record**
  for five seconds, then **■ Stop and keep** → *Kept 1 bar from this device
  on track 2*, at bar 1, labelled *phone*.
- [demo] Choose **The whole tape** → it says *the whole tape, once*.
- [phone] Calibrate with the phone's speaker → a round trip somewhere around
  50–150 ms. Then overdub with wired headphones, clapping on the beat → the
  claps land on the beat (within a few milliseconds; nudge if not).

## The pads, from a controller

No page plays the pads; a controller does (`docs/architecture/tape.md`,
*When a pad lands*).

- [rig] Plug the SMK-37 into the Pi, set *Plays the tape*, restart; hit a pad
  → it lights on the keyboard, and the tape does what it says.
- [rig] Hold a pad on the SMK-37 and the same pad on a second controller,
  let go of one → the tape still does it until both let go.
- [rig] With the SMK-37: strike a pad softly and hard (FILTER), sweep the mod
  wheel, push the pitch wheel, turn CC 21–24, send program change 2 → each
  does what it says.
- [rig] Hold BREAK for a bar → the tape winds down; on release, it resumes
  where it would have been.
- [rig] Turn DRIVE on encoder 3 and leave it a second → ↶ undoes it in one
  step.

## The words

`lib/rooms/words.test.js` holds the retired words off the rooms' pages;
what it can't see:

- [demo] Open Settings in the Studio → the group is **Feed**, its field
  **Feed length**.
- [demo] The tape's name → **Bounce the loop**, **Bounce the whole tape**,
  **Play the last bounce**.
