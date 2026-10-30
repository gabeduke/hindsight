# Manual checks

Checks that used to sit inside the user guide (`docs/guide.md`), grouped by
the guide section they belong to. They are QA lists, not user guidance, so
they no longer ship in the binary.

- **[demo]** lines can be run against the demo. They are the backlog of
  stories to turn into flows in `scripts/flows/` (see `docs/flows.md`);
  delete a line here once a flow covers it.
- **[rig]** and **[phone]** lines need the hardware or a real phone and stay
  manual.

## 3. The main page

**Checks — today:**

- [demo] Tap **KEEP** with 30s chosen → within a few seconds the take is
  first on the Listening Room's shelf with *NEW*, about 30 s long, and plays
  when tapped.
- [demo] KEEP, then tap the toast's *Undo* → the take leaves the shelf, and
  shows under the Listening Room's *Recently deleted*. KEEP again and tap
  *Undo*, then *Restore* → it's back, starred.
- [demo] Tap **Note**, wait, then KEEP → the take has a note at that
  moment.
- [demo] Star an older take → it is pruned last, and the Listening Room's
  *Starred* filter shows it.

**Checks — data safety** (looks the same):

- [demo] Add or edit a flag on an old take, then reload → the take is still
  where it was in the list, not at the top.
- [demo] Open the same take on two devices and add a different flag on each →
  after a reload, both flags are there.
- [demo] Set `MAX_SAVES=3`, edit a flag on the oldest take, then KEEP
  twice → the oldest take is pruned all the same, to the trash.
- [demo] KEEP while watching the list → a take never appears half-written:
  no missing duration, no broken waveform.
- [demo] With the Studio open on two devices for a minute → the Pi's CPU
  stays low. An unchanged list costs a directory listing, not a scan (watch
  `top`, or the request timings in the browser's network tab).

**Checks:**

- [demo] A take with a selection shows it in the list as a bracket on its
  waveform, and its length as "0:30 of 0:59".
- [demo] The list and the take page draw the same take at the same height.
- [rig] Switch the interface off → the dot turns amber and says *waiting for
  the interface*, with no error toast. Switch it on → it records again.
- [demo] The header's menu (**☰**) holds Settings, the rig, Help mode, the
  guide and Releases, whose line shows the running version; a release
  waiting puts a green dot on **☰**. The Settings sheet's first line has the
  version, Releases, the guide and the rig too.

## 3.1 The takes page

**Checks — today:**

- [demo] KEEP in the Studio, then open the Listening Room → the take
  is first on the *Takes* shelf.
- [demo] Search, then turn on *Starred* with nothing starred → "No takes
  match", not "No takes yet".
- [demo] Record from a phone, then turn on *Phone* → only that take shows.
- [demo] Open a take from a filtered list and press ▸ → the next take is the
  next one the list showed.
- [demo] Delete the only take a filter shows, on its page → back here, with
  an Undo.
- [demo] Choose **By tag** → one group per tag, in the order of the tag list.
- [demo] Open the page on a second device → the same tags, and the same
  colors on the same takes.
- [demo] Delete a tag that has takes → they show as untagged, nothing else
  changes, and a filter that was on that tag turns itself off.
- [demo] Tap a spine → it plays in the bar and nothing opens; tap it again →
  it pauses.
- [demo] Tap another spine → the bar holds that take, and the deck says *In
  the bar: …*.
- [demo] With a take playing, the bar shows its strip, its name and **✎**,
  and **⟲** says **Repeat**. Tap the strip half way → it jumps there; drag it
  → it scrubs. Tap the name → the take opens on its page.
  Go back, play part way and press **✎** → the notes drawer comes up at
  that spot, the address doesn't change, and the take keeps playing (J2.4).
- [demo] On a phone, play a take → the mini player shows ▶, the name, **✎**
  and the strip, and there is no window to pull up.
- [demo] On a take's page, **Edit tags** → add "Ideas" with a color, Save.
  Back here, hold a spine on a phone → it is ticked and the select bar rises;
  tap another → both are ticked and neither plays. **Tag** → *Ideas* → both
  spines wear its color. **Done** → the ticks go.
- [demo] Open **☰ List** → a tape that has been bounced twice is one row
  with *MIX ×2* and its earlier bounce under it; tap that line → it plays.

## 3.2 Updating Hindsight

**Checks — updating:**

- [rig] With a newer release out, the header's Releases says *Update to v…*.
  Press it →
  the sheet lists what it brings in; install → downloading, installing,
  *Restarting…*, and the page comes back on the new version.
- [rig] Releases → pick the one before → *This takes out* lists the newer
  release's notes, and **Go back to v…** installs it.
- [rig] Start a phone recording, then install → *Not now: a phone is
  recording*, and nothing installs.
- [rig] `make deploy` → the header's Releases shows the release it's built on
  plus its commits, not `dev`.
- [demo] On a phone, open Settings → its first line reads *Hindsight dev ·
  Releases · the guide*; Releases closes it and opens the Releases sheet.

## 3.3 Settings

**Checks — settings:**

- [demo] Settings → Mix → Mono → Save → Restart → the page comes back, and
  Settings shows Mix *set here*, with no restart owed.
- [demo] Reset Mix → *default*; Restart.
- [demo] Channels 2, Inputs in TAKES 3,4 → Save is refused, naming
  SAVE_CHANNELS.
- [rig] Scarlett Solo on Automatic → *Recording from Scarlett Solo 4th Gen,
  2 channels*; Mono, restart, sing and play → the take is centred.

## 4. The take page

**Checks:**

- [demo] Open a take → the page asks the Pi for that one take
  (`GET /api/take?file=`), not the whole list.
- [demo] Open a 15-minute take, zoom out fully, then zoom in two steps → each
  zoom draws in well under a second, and the Pi doesn't read the whole file
  from disk.
- [demo] Save a selection of a take whose MIDI lanes you've switched to drums,
  and whose downbeat you've moved → the new take keeps both. Its name reads
  "*source name* · 0:42–1:10", not "… cut cut".
- [demo] With `SAVE_ALL_CHANNELS=true` and `SAVE_CHANNELS=3,4`, loop a
  selection, then share it → the loop and the MP3 are the same pair.
- [demo] Start two shares at once → the second waits for the first, and
  both finish.

**Checks:**

- [demo] Make a selection that fills the screen, then drag with one finger →
  the view pans and the selection stays where it was.
- [demo] Put a flag inside the selection, then tap its pin → the flag opens.
  Drag the pin → the flag moves.
- [demo] Set a selection with Loop off and press ▶ before In → playback runs
  through the selection and on. Turn Loop on → it repeats In to Out.
- [demo] Tap **In**, move the playhead, tap **Out** → you get the same
  selection as by holding and dragging.
- [demo] Select part of a take and turn on **Level** → it says *Level +N dB*,
  and ▶ plays it louder; **Share** (or Download) → its key says the gain, the
  MP3 peaks at about −1.5 dBFS, and the toast says *Levelled +N dB*. Move or
  clear the selection, or ↶ it → the number follows. Turn Level off → as
  recorded.
- [demo] Drop two flags and name one, then tap **⚑ 2** → both, in time
  order, with the name and the times; tap the second → the sheet closes
  and the take plays from it.
- [demo] Play a take for ten seconds and press **J** (or **↺ 5 s**) → it
  goes back five seconds and plays on. On the Listening Room's bar, the same.
- [demo] With the demo running, `kill -USR1 <its pid>` (the demo reports an
  overflow, as an interface does), wait a few seconds and capture 30 s → the
  take says *⚠ 1 dropout*, with a ⚠ in the ruler where the signal was
  sent; in the Listening Room its cassette wears the sticker. Cut a part with
  the ⚠ in it → the cut has it too; cut a part without → it doesn't.
- [rig] While the Pi records, `kill -STOP $(pgrep -x hindsight); sleep 1;
  kill -CONT $(pgrep -x hindsight)` (it runs as your user, so no `sudo`),
  then capture → *⚠ 1 dropout* where it stopped: the interface overran while
  the Pi wasn't reading it. Stopped for more than 2 s, the capture restarts
  the stream, and that's a dropout too.
- [demo] On a take with a BPM, choose *Snap: beat* and drag a grip → it jumps
  beat by beat. A nudge moves one beat; with Snap off, a nudge moves 10 ms.
- [demo] On a take with a BPM, tap **Set to playhead** in the *Downbeat* row
  → the downbeat and the grid jump to the playhead. **◂ ▸** nudge it; ↶ undoes the
  run in one step.
- [demo] Set the BPM from the take page's header → the ruler shows bars
  immediately, without going back to the list.
- [demo] Go back to the list → it's scrolled where you left it.
- [demo] Tap **?**, then tap any button → a tip explains it, and the button
  doesn't act. Tap **?** again to leave help mode.
- [demo] On a computer, hover any button → its tip shows.
- [demo] Open a take for the first time on a device → three hints; *Got it*
  → they don't come back.
- [demo] Tap a lane's name → a menu to collapse it, show it as drums or
  notes, or hide it.
- [demo] ◂ ▸ in the header → the previous or next take in the list's order.
  Then **‹** → the list, scrolled where you left it.
- [demo] Open a take with a BPM and drag the yellow "1" at the very start →
  the downbeat moves (the playhead, also at the start, stays put).
- [demo] Press ▶, then press and release the playhead's handle without
  moving → the take keeps playing.
- [demo] *Snap: beat*, play, and tap **In** then **Out** → both land on
  beats.
- [demo] In help mode, press Space → nothing plays; Escape leaves help mode.
- [demo] On a phone → the take's name gets its own row under the header
  buttons; in the list a long name keeps its row and the tempo and length
  move under it.

**Checks — the boundary editor:**

- [demo] Tap In's time → the view centres on In and the editor bar shows. Zoom
  out with ZOOM, POSITION the line near a kick, zoom in, then **Attack** → In
  sits on the kick's start, and the readout says *on* a beat, such as *on 2.1*
  (the demo is on its grid). **Zero** → In moves by under 5 ms. **Done** → the
  toolbar returns.
- [demo] With an 8-bar selection, **Seam** → the end and start meet at the
  centre and the loop is on. Tap the Out half and step it → only Out moves.
- [demo] At 390 × 844, nothing in the editor bar is cut off, and the waveform
  keeps at least half the screen.
- [demo] Turn POSITION in one drag, then **↶** → the point is back where it
  started, in one step.
- [rig] On a stylophone take with a part played over it, set a loop's In on
  the first beat's hit and its Out on the last bar line, check the seam, send
  it to tape → no stutter.

## 4.1 Open

**Checks — Open:**

- [demo] In the Listening Room tap a take, then its name in the bar → Open
  starts near where it was, and it is still playing.
- [demo] With a take playing press **✎** in the bar → Open has a new note at
  that spot with the cursor in its words; type *hook*, Enter → the line reads
  *hook*, and after a reload it still does.
- [demo] Press **GRAB** → the Studio opens with the buffer holding the span
  the key named.
- [demo] Press a note's **GRAB** → the Studio opens with that stretch of the
  take in the buffer. With no note after it the buffer is eight bars, or 16
  seconds.
- [demo] Press **+ tag**, choose a tag → its name sits beside ★; open it and
  press the lit tag → the key reads *+ tag* again.
- [demo] Bounce a tape twice, then Open the newer take → *Earlier bounces*
  lists the other; tap it → that take opens.
- [demo] Open `/wave.html?tape=…` → the Studio.

## 5. Undo and the trash

**Checks:**

- [demo] Delete a flag → the toast offers Undo; tap it → the flag is back.
- [demo] Change a take's name, then its BPM, then tap ↶ twice → both are
  back as they were. ↶'s tip says "Undo the tempo change" before the first
  tap.
- [demo] Clear the selection → the toast offers Undo; tap it → the selection
  is back.
- [demo] Open a take from the list and tap 🗑 → the next take in the list
  opens, saying "Deleted … · Undo"; ◂ goes to the one before the deleted
  take, not to it. Tap Undo → the deleted take is open again, starred, with
  its flags, and ◂ ▸ step through the list as before.
- [demo] Tap 🗑 on the last take in the list → the one before it opens. On
  the only take left → you're back at the list with "Deleted … · Undo".
- [demo] Delete a take from the list → it shows under *Recently deleted*.
  Restore it → it's back, starred.
- [demo] Fill the disk to just above `MIN_FREE_GB` with the trash full, then
  capture → the capture succeeds and the oldest trash goes.
- [demo] Select three takes and export → one zip with their WAVs, sidecars and
  MIDI.
- [demo] Select two takes and Delete → both go; the toast's Undo brings both
  back.
- [demo] Rename a take on one device, rename it again on another, then tap
  ↶ on the first → "Not undone: the name has changed since", and the other
  device's name stays.

## 6. The ribbon

**Checks:**

- [demo] Wait ten minutes, then select a span about eight minutes back on the
  ribbon and save → the take holds roughly that span, not the last N minutes,
  and sits in the list by when it was played.
- [demo] Hold on the ribbon without dragging → the bar reads "… ago to now".
- [demo] A quick tap, or a vertical swipe over the ribbon → nothing selected;
  the page scrolls.
- [demo] Tap a flag on the ribbon → its sheet opens. *Save from here to now*
  makes a take starting at the flag, carrying the flag at its first moment.
- [demo] Select a span near the old end and wait until its start passes the
  oldest audio → the bar turns amber and says so; saving still works, from
  the oldest audio.
- [demo] With the tape on, select a span and tap **Copy** → *Copied …: Paste
  it on a tape*; the Studio's buffer shows it.

## 7. Recording from your phone

**Checks:**

- [rig] Record 20 seconds on the phone → a take labelled *Phone* appears
  after Stop and plays back cleanly.
- [rig] Turn Wi-Fi off for five seconds mid-recording, then on → the take is
  complete, with no gap.
- [rig] Open the plain `http://` address → the Phone button explains that it
  needs the HTTPS address.
- [demo] Watch the list while recording → nothing appears until Stop.
- [demo] Record from a desktop browser at `http://localhost:5000` (a secure
  page) → the take is 48 kHz stereo, labelled *Phone*, with a waveform.
- [rig] Record, then close the tab without Stop → about ten minutes later a
  take labelled *Phone (partial)* appears.

## 8.3 Your first loop

**Checks — steps 6a and 6c:**

- [demo] On a take's page select 2 seconds and press **GRAB** → the Studio
  opens with them in the buffer. Arm track 1 and press **DROP ON TRACK 1** →
  track 1 holds them, and the toast says *Dropped on track 1* with **Undo**.
- [demo] Make a new tape, set 90 BPM and 4 bars → it reads *90.0 BPM · 4
  bars*, and the lanes show four empty bars. Press ▶ → a click on every
  beat, higher on the bar. After the first catch, the click goes off and the
  tempo can't be changed.
- [demo] Make a new tape, give track 1 the input *aux*, tap on a kick, then tap about 2.5 s
  later on another → a 2.50 s loop, *1 bar at 96 BPM*, playing on track 1.
- [demo] Tap the tempo pill, choose 2 bars → it reads *192 BPM ·
  2 bars*; the loop sounds the same.
- [demo] On a phone, the name and tempo stack as one bordered capsule with a
  ▾ on each half, and the header stays one row tall with undo, redo and ⋯
  beside it. At 600 px or wider they are two separate pills. A tape with no
  tempo yet shows its tempo pill dimmed, with no ▾.
- [rig] Play a phrase on the Orchid into aux, tap on its first note, and on
  the same note when it comes round → the loop plays out of channel 1 in
  time with you, and the tempo reads sensibly.
- [rig] Drop a grab on a track and press ▶ → the loop plays out of channel
  1, and within a few seconds the dot turns green.
- [rig] Turn the Sidekick off and on again while the tape plays → ▶ reads
  *no output*, then the tape plays again; the dot is amber until it locks
  again.

## 8.4 Building it up

**Checks — steps 6a and 6c:**

- [demo] Send 2 s to an empty tape and press ▶. Tap track 2's **●**, then
  its input and choose *aux*; wait four passes, then tap **−3** under
  Passes → a 2.0 s clip lands on track 2 at bar 1, and the toast says
  *Caught 2.0 s from aux onto track 2*.
- [demo] Give track 3 the input *ch2*, tap its **●**, and point at Catch →
  Catch says *last pass → track 3*, and track 3's lane outlines the loop;
  catch → it's from ch2. On a second device the same tape shows track 3's
  ● lit.
- [demo] Catch from *ch1* → the toast warns that the tape was in that source
  too.
- [demo] With the tape playing, the meters on *main* and *ch1* move and
  *ch2*'s stays empty (bus B is silent). Choose *ch2* and tap **1 bar** → the
  toast is amber: *it's silent: nothing came in*. ● Rec has *ch2* under it.
- [rig] Play the Bento into jack 2: the *ch2* meter moves, and *aux*'s stays
  empty until the instrument on aux plays.
- [demo] On a 4-bar loop, play for a pass, then tap **1 bar** → a one-bar
  clip lands on the bar that just finished.
- [demo] Tap a clip, then **Remove** in the action bar (or Delete), then
  **Undo** in the toast → the clip is back. ↶ and ↷ step through the same history.
- [demo] Open the Studio on two devices and mute a track on one → the
  other shows it within a second.
- [demo] Under ⋯ choose **Rename this tape…**, type a new name and tap Save →
  the title and the tape list show it, and a second device shows it within a
  second. An empty name can't be saved, and ↶ doesn't undo a rename.
- [demo] Clone a tape and open the clone, delete the original, then play the
  clone → it plays fully.
- [demo] Restart Hindsight → the tape that was loaded is loaded again, with
  its undo.
- [demo] With a 1-bar loop playing, tap track 2's ●, tap ● Rec, wait three passes,
  tap ● → *Kept 1 bar from aux on track 2*: the last full pass.
- [demo] Stop. Tap track 3's ●, then ● Rec (*● Ready 3*, with *aux* under it), press ▶ → the position
  reads *count-in 1 of 4…4 of 4* over a bar of click, then the tape plays;
  after two passes press ■ → *Kept 1 bar*: the last full pass, on track 3.
- [demo] Tap ● Rec, press ▶, and press ■ during the count-in → nothing is kept,
  and nothing complains.
- [rig] Arm track 3 with the guitar in aux, tap ● Rec, press ▶, play over the count-in
  and two passes, press ■ → the guitar is on track 3, in time.
- [demo] On a take's page select about 2 seconds and press **GRAB**; then, on
  an empty tape with the tape stopped, press **⌘V** three times → the first is
  the loop, and the next two lie end to end after it. Undo takes them back
  one at a time.
- [demo] Choose **Replace**, catch a pass onto a track that has audio →
  the old audio under it is gone, not layered.
- [demo] Hold on the ruler, drag across two bars → the action bar says
  *All tracks · bars 1–2*, and the tape loops those. Lock the padlock and
  drag across bar 4 → the range moves, the loop stays.
- [demo] Tap a 1-bar clip at the start of a 4-bar loop, *Repeat to the
  loop's end* → three copies after it, four clips in all.
- [demo] Tap the selected track's number, set its pan to the left → it sits
  left.
- [rig] Turn channel 1's FX knob → the tape's sound changes, and the live
  instrument on aux doesn't.
- [rig] Play the Orchid into aux over the loop for two passes, catch −1
  onto track 2, and play → the part plays back in time with the loop, to
  the sample.
- [demo] Start the demo with `TAPE_DEMO_ALIGN=true`, send drums to tape and
  play → the dot goes from amber to green within about five seconds.
- [rig] Play a loop that's only a sustained pad → the dot stays amber; it
  never guesses at a lock it can't be sure of.

## 8.5 Editing like an OP-1

**Checks:**

- [demo] Hold on the ruler and drag across 4 bars, **Cut**, tap bar 1 on the
  ruler, then press **⌘V** three times → twelve bars of the same four, with
  no clicks where the copies meet.
- [demo] Hold an empty part of track 4 and drag up across track 3 and two
  bars → the range is shaded on both lanes, and the action bar says *Tracks
  3–4 · bars …*; the loop moved to it. Drag its right edge's tab a bar in →
  one bar; **Copy**, Esc, draw a range on track 1 and **Paste** → the pair
  of tracks again, from track 1.
- [demo] Tap a clip that fills its lane, **Bars** → a range over its bars;
  drag the left tab two bars in, **Cut** → the clip's end is gone, its start
  stays.
- [demo] Put the playhead inside a clip, **Split**, hold the second half and
  slide it a bar later, then ↶ twice → the clip is whole again.
- [demo] Tap a clip → it's selected, with its grips, and the action bar names
  it; nothing pops up. Double-click it (or press Enter) → its sheet opens.
  Drag quickly across a clip → the lanes pan and the clip stays where it
  was.
- [demo] Select a clip and press → → it moves a bar later (with **⌗** on
  Bar); ↶ → back. Press **S** with the playhead inside it → it splits.
  ⌘A → every clip is selected; Escape → none.
- [demo] Hold a clip until a dashed outline shows where it would land, drag
  it a bar later and let go → it's a bar later; ↶ → it's back. Hold one and
  let go without moving → nothing moves.
- [demo] Paste 4 bars from the middle of a take, tap the clip, close its
  sheet → a grip shows inside each edge. Drag the right grip a bar left →
  the clip ends a bar sooner, and the toast says where; ↶ → it's back.
- [demo] With **⌗** on *Beat*, drag the left grip two beats
  left → the audio from before it shows faintly as you drag, and the clip
  starts two beats sooner, what it already played still where it was.
- [demo] Drag a grip far out → it stops 2 s past where the clip began or
  ended, and the grip turns amber.
- [demo] Split a clip, then drag the first half's right grip into the
  second → it stops where the second starts.
- [demo] Hold a clip on track 1 and drag it down onto track 2 → track 2's
  lane is outlined; let go → the clip is on track 2 at the bar it was dragged
  to, and track 2 is selected; ↶ → it's back on track 1.
- [demo] Slide a clip sideways with your finger wandering a little up or
  down → it stays on its track.
- [demo] Mute track 3 and slide a clip onto it → it lands there, silent.
- [demo] Pick a 1-bar clip and drag its ⟳ corner three bars right → three
  ghost copies and ×4; let go → four bars of it end to end, with no clicks
  where they meet; ↶ once → just the one.
- [demo] Drag the ⟳ corner right, then all the way back, and let go →
  nothing changes.
- [demo] Pick a clip and drag the square at its top right corner about a
  beat to the left → a shaded fade out follows, saying how long it is; let
  go → the toast says *Fade out:* and that length, and it fades as it plays.
  Drag it on to a bar line → it sticks there: *Fade out: 1 bar*. In its inspector
  choose *Exponential* → the curve drops early and tails off, and so does
  the sound. Drag the square back to the corner → no fade.
- [demo] Pick a clip that fills the view, drag its ⟳ corner to the lane's
  right end and hold it there → the view scrolls on and the copies and ×N
  keep coming; let go → that many, end to end.
- [demo] Repeat a clip that sits a layer above another (a catch over a
  loop) → its copies are on its layer, with no dips where they meet.
- [demo] Repeat a clip, then change one copy's level → the others keep
  theirs.
- [demo] Double-click a clip, **Fade in → 1 beat** → its first beat is shaded under
  a curve, and it swells in from silence; **off** → back to a hard start.
- [demo] Fade a clip out over a bar, then **Split** it in the middle → only
  the second half fades; ↶ → one clip, fading over its last bar again.
- [demo] Fade a clip in, then **Reverse** it → it fades out instead.
- [demo] On a tape with no tempo, the beat and bar fades are greyed out.
- [demo] Tap a clip, then Shift-click a clip on another track (on a phone,
  **Select more**, then tap it) → the action bar says *2 clips*. Hold one and drag both a bar later and a track down →
  they move together; ↶ → both back.
- [demo] Drag a picked pair up past track 1 → they stop with the higher one
  on track 1.
- [demo] With two picked, **Copy**, then select track 3 and **Paste** → the
  pair again from track 3, as far apart as they were.
- [demo] On a computer, click a clip, Shift-click another, **⌘D** → a copy
  of both right after them; **Delete** → the two picked are gone; ↶ → back.
- [demo] Put the playhead in a clip and press **S** → it's split there.
- [demo] Hold on the sections strip and drag across bars 1–4 → a section,
  *Intro*, over them, and its sheet; call it **Verse**.
- [demo] Tap the Verse → bars 1–4 on every track are the range, and the
  loop; **Copy**, draw a range at bar 9, **Paste** → the verse again at bar 9.
- [demo] Tap the Verse again → its sheet; make it red → the strip shows it
  red. Drag its right edge a bar to the right → it's bars 1–5; ↶ → back to
  1–4.
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
- [demo] Hold the ruler across bars 9–12 and point at **⇤ Delete time** → bars 9–12 shaded
  and what followed drawn moved up, *−4 bars*. Click → *Deleted bars 9–12*;
  the sections after it moved up too.
- [demo] Point at **⤓ Paste** → an outline where it will land; nothing else
  moves.
- [demo] On a phone, tap **Insert** → the preview and *Tap again*; tap
  elsewhere → nothing happens. Tap Insert twice → it's done. Turn **Ask
  before Insert and Delete time** off → one tap does it.
- [demo] Make a section *Chorus* over bars 5–8, open its inspector, **Duplicate
  section** → bars 9–12 are the chorus again, named *Chorus*, and what was
  at bar 9 is at bar 13.
- [demo] With a clip across bar 5, **Insert** at bar 5 → it's split there,
  its second half moved on with everything else; no click at the split.
- [demo] Zoom out until a clip is narrow → no grips; its inspector's **Start
  here** and **End here** trim it to the playhead.
- [demo] Split a clip, tap either half, **Join the split** → one clip.
- [demo] Hold the ruler across a 2-bar loop, **×2** → a 4-bar loop whose
  second half is a copy of the first.
- [demo] Tap a clip, **Reverse** in the action bar → its waveform turns round
  and it plays backwards; ↶ turns it back.
- [demo] Double-click a clip, **Share as WAV** → the share sheet (or a download)
  offers *<tape> track 1.wav*.
- [demo] Clone a tape, delete the original, then play the clone → it plays
  fully; no audio was lost.
- [demo] Copy a selection on a take page, then Paste it on a tape → it's
  there.

**Checks — lining clips up:**

- [demo] Zoom the tape's lanes right in → every lane draws single samples,
  not blocks.
- [demo] Catch a pass onto track 2, tap the clip, **Align** → the view
  centres on its first hit. **Hit → Grid** → the readout says *on* a beat.
- [demo] Nudge a clip 7 ms late, **Align**, pick track 1, **Hit → Track** →
  the readout says *0.0 ms from track 1*. **↶** once → the clip is
  back where it was.
- [demo] At sample zoom, with an overdub rushed 3 ms against a loop clip
  on track 1 that starts on its kick: **Align**, pick track 1,
  **Hit → Track** → the readout says *0.0 ms from track 1*.
- [demo] Turn POSITION in one drag, then **↶** → the clip is back, in one
  step.
- [demo] On the take page, the editor bar behaves as before.
- [rig] Overdub a part on the phone over a loop, then Align it to the loop's
  track by ear and by **Hit → Track** → no flam.

## 8.6 Mixdown and export

**Checks:**

- [demo] ⋯ · **Bounce the loop** on a 1-bar tape → the readout counts
  *bouncing … of …*. A few seconds later the toast reads *Bounced as a take*
  with **▶** and **Open**; ▶ plays it, and **Open** shows a take of that bar
  plus 2 seconds, labelled with the tape's name, at its tempo. Open the menu
  again → **Last bounce** shows the same toast.
- [demo] Start a bounce and press ■ → *The bounce didn't save*, and no take
  appears.
- [demo] Bounce the same tape three times → the Listening Room shows one
  spine for it, wearing **MIX ×3**, and its List row has the two earlier
  bounces under it.
- [rig] Bounce with an FX on channel 1 → the take has the FX.
- [demo] Export stems → a zip with a WAV for each track with audio, all the
  same length, plus a `.mid` at the tape's tempo. In a DAW they line up at
  bar 1.

## 8.7 The Bento follows the tape

**Checks:**

- [demo] Start the demo with `TAPE_CLOCK=lead`, set a tape to 96 BPM and
  press ▶ → under the transport, *clock → Demo follower ● · hears 96 BPM*.
  Press ■ → the ● goes.
- [rig] Press ▶ on the tape → the Bento starts in time; ■ stops it.
- [rig] Loop four bars for two minutes → the Bento stays in time with the
  tape, and lands on bar 1 each time the loop comes round.
- [rig] Locate to bar 3 and press ▶ → the Bento starts at bar 3.
- [rig] In follow mode, start the Bento → the tape plays in time with it for
  five minutes without drifting. *(Later.)*

## 8.8 Overdubbing away from the rig

**Checks — overdubbing:**

- [demo] With a 1-bar loop, tap track 2's ● and open **🎧 Overdub on this
  device** → it says it plays *the loop (1 bar)*, onto track 2. **● Record**
  for five seconds, then **■ Stop and keep** → *Kept 1 bar from this device on
  track 2*, at bar 1, labelled *phone*.
- [demo] Choose **The whole tape** → it says *the whole tape, once*.
- [phone] Calibrate with the phone's speaker → a round trip somewhere around
  50–150 ms. Then overdub with wired headphones, clapping on the beat → the
  claps land on the beat (within a few milliseconds; nudge if not).

## 8.9 Tricks and tape speed

**Checks:**

- [demo] Hold Break for a bar → the tape winds down; on release, it resumes
  where it would have been.
- [demo] Set tape speed to 50% → the tape plays an octave lower and at half
  tempo.

## 8.13 Playing the tape from a controller

**Checks — the pads on a controller:**

- [rig] Plug the SMK-37 into the Pi, set *Plays the tape*, restart; hit a pad
  → it lights on the keyboard, and the tape does what it says.
- [rig] Hold a pad on the SMK-37 and the same pad on a second controller,
  let go of one → the tape still does it until both let go.
- [rig] With the SMK-37: strike a pad softly and hard (FILTER), sweep the mod
  wheel, push the pitch wheel, turn CC 21–24, send program change 2 → each
  does what it says.
- [rig] Turn DRIVE on encoder 3 and leave it a second → ↶ undoes it in one
  step.

## 8.14 Words in the two rooms

**Checks — the words:**

- [demo] On any device, however it was set before → the tabs are **Studio**
  and **Listening Room**, and the Studio's feed has **KEEP**, **GRAB** and
  **Note**. Settings has no *Two rooms* switch.
- [demo] Open Settings in the Studio → the group is **Feed**, its field
  **Feed length**.
- [demo] ⋯ on the tape → **Bounce the loop**, **Bounce the whole tape**, **Last
  bounce**.

## 8.15 Walkthroughs

**Checks — the walkthroughs:** each of the six runs from its first step to its
last in the demo, in the buttons named above, on a phone and on a laptop.
