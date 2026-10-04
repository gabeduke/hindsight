# The Hindsight guide

How Hindsight works, in plain words, for someone who has never touched an
OP-1. It is also the acceptance test: every section ends with **checks**. A
feature is done when its checks pass.

**How to read the checks.**

- Each starts with the action to take, then what you should see.
- **[demo]** checks pass with `go run ./cmd/hindsight --demo` and no hardware.
- **[rig]** checks need the Pi, the Sidekick and instruments.
- **When:** every section says when its features arrive:
  - *Today* means it's on `main` now.
  - *Step N* is the roadmap step in the
    [editing model](superpowers/specs/2026-10-03-editing-model-design.md#roadmap).

## 1. The idea in one minute

**Hindsight is always recording.** It keeps the last 15 minutes of everything
that comes into the Sidekick, in memory. Nothing is saved until you ask, and
when you ask, you're choosing something you *already played*. Saving the last
few minutes makes a **take**: a file you can listen to, trim, flag and share.

**A tape is a four-track recorder,** the way an OP-1 or an old cassette
four-track works.

- You record a part onto track 1, and it plays back while you play the next
  part.
- That second part goes on track 2, and so on.
- Because the tape plays back through the mixer, one synth can play chords,
  then bass, then a lead, each on its own track.
- A loop bracket repeats a few bars while you build them up.
- Cutting and pasting bits of tape — the OP-1 calls these **lift** and
  **drop** — turns loops into a song.

**What Hindsight adds to that picture** is that you don't press record before
you play. You play, and when something is good you **catch** it: "put the last
four bars on track 2", or "keep the third time round". It's already in the
15-minute memory.

**Everything is undoable.** Nothing on a tape is ever cut out of a file: edits
just move references around.

## 2. Words

| Word | Means |
|---|---|
| **Ring** | The last 15 minutes of every input, held in memory. The buffer ribbon at the top of the main page draws it |
| **Take** | A saved recording, from *Capture*, *Save as take*, a phone recording or a mixdown |
| **Flag** | A marked moment in a take or the ring, with an optional label |
| **Selection** | A span between **In** and **Out**. On a take it's what you save or share; on a tape it's what you edit |
| **Loop** | A toggle. On: playback repeats the selection. Off: playback runs straight through |
| **Tape** | Four tracks, six minutes each, holding clips |
| **Track** | One of the tape's four lanes |
| **Clip** | A piece of audio sitting on a track |
| **Catch** | Put a span of the ring onto a track, after you've played it |
| **Pass** | One time round the loop. Every pass you play is kept, and you choose which to catch |
| **Layer** | A second catch on top of a track's existing audio, summed with it |
| **Clipboard** | Holds what you last *copied* or *lifted*, until you *drop* it |
| **Lift** | Cut the selection out of the tape into the clipboard |
| **Drop** | Paste the clipboard at the playhead. The playhead jumps to the end of what you dropped |
| **Bus A, bus B** | The tape's two outputs into the Sidekick: bus A into channel 1, bus B into channel 2. Each has the Sidekick's EQ, FX and fader |
| **Mixdown** | Play the tape once and save what came out of the mixer as a take |
| **Lead, follow** | Whether the tape sets the tempo for the Bento (lead) or follows it (follow) |

## 3. The main page

*Today.*

**What's on it, top to bottom:**

- **The buffer ribbon.** It draws the last 15 minutes, with the recent end
  stretched so you can see it.
- **The meters.**
- **Capture.** Choose 30 s, 2 m, 7 m or Full, and tap *Capture* to save that
  much of the past as a take.
- **Flag now.** It marks this moment in the ring;
  the flag rides along into any take that includes it.
- **The takes list,** newest first. Starred takes always come first. Tap a
  name to rename it, ★ to star it, and the waveform to hear it. Tap the take
  to open its page.

**Checks — today:**

- [demo] Tap *Capture* with 30 s chosen → a new take appears at the top within
  a few seconds, about 30 s long, and plays.
- [demo] Tap *Flag now*, wait, then capture → the take has a flag at that
  moment.
- [demo] Star an older take → it moves to the top and stays there after
  newer captures.

**Checks — step 1** (data safety; looks the same):

- [demo] Add or edit a flag on an old take, then reload → the take is still
  where it was in the list, not at the top.
- [demo] Open the same take on two devices and add a different flag on each →
  after a reload, both flags are there.
- [demo] Set `MAX_SAVES=3`, edit a flag on the oldest take, then capture
  twice → the oldest take is pruned all the same. It goes to the trash once
  step 4 lands.
- [demo] Capture while watching the list → a take never appears half-written:
  no missing duration, no broken waveform.
- [demo] With the main page open on two devices for a minute → the Pi's CPU
  stays low. An unchanged list costs a directory listing, not a scan (watch
  `top`, or the request timings in the browser's network tab).

**Checks — step 3:**

- [demo] A take with a selection shows it in the list as a bracket on its
  waveform, and its length as "0:30 of 0:59".
- [demo] The list and the take page draw the same take at the same height.
- [rig] Switch the interface off → the dot turns amber and says *waiting for
  the interface*, with no error toast. Switch it on → it records again.
- [demo] The bottom of the page shows the running version and links to this
  guide.

## 4. The take page

*Step 3.* Open any take from the list. The first time you do, three hints
point at the gestures that matter; **Got it** puts them away for good.

**The layout, top to bottom:**

- **The header:** the take's name (tap to rename), ★, its tempo (tap to set),
  its length ("0:30 of 0:59" when part of it is selected) and, for a take
  saved from another, "from *that take*", which opens it. **◂ ▸** step to the
  previous and next take in the list; **↶** undoes your last change (§5);
  **?** is help mode; **⋯** resets the downbeat or opens this guide. On a
  phone with MIDI, **♪** opens the notes, and the name has a row of its own
  under the buttons.
- **The overview:** the whole take. Drag its window to move along; double-tap
  to see it all.
- **The ruler:** bar numbers (or seconds, without a BPM), and the flags as
  pins above them. **▾** is the playhead; drag it to scrub silently. With a
  BPM, bar **1** is the downbeat; drag it to line the grid up.
- **The waveform,** drawn on the same scale as the list and the meters.
- **The grips,** under the waveform at the selection's ends, with the move
  handle between them.
- **The toolbar:** ▶ · ⟲ Loop · In · Out · ⚑ · ◂⚑ ⚑▸; then, with a
  selection, its In and Out times with their nudges, its length and *Clear*;
  then *Save as take* · *Share* · *More*; then the position, *Snap* and
  *Practice speed*.
- **The MIDI lanes,** if the take has MIDI. Tap a lane's name for its menu:
  collapse, show as drums or notes, or hide.

**Getting around:**

- **One-finger drag moves along the take,** even inside the selection.
- **Pinch** (or the mouse wheel) zooms.
- **Tap** moves the playhead; **tap twice** drops a flag there.
- **Drag the playhead's handle** ▾ in the ruler to move it silently; the take
  carries on from where you let go. **Drag bar 1** — the yellow "1" just
  right of its line — to say where the music starts.
- **Back** returns to the list where you left it, even after ◂ ▸.

**Selecting:**

- **Hold, then drag** across the waveform to select a span. Or tap where it
  should start and press **In**, then tap where it should end and press
  **Out** (either order; the first one waits, dashed, for the other).
- **Adjust an end** by dragging its grip, or with its ◂ ▸ nudges.
- **Move the whole selection** with the handle between the grips. A plain
  drag never moves it, so it can't happen by accident.
- **Snap.** With a BPM set, the *Snap* chip makes taps, the selection, **In**
  and **Out** and the nudges land on bars, beats or 8ths. A nudge from an end
  that sits between lines goes to the next line.
- **Clear** forgets the selection; the take is untouched.

**Playing:**

- **▶** plays from the playhead.
- **⟲ Loop** makes ▶ repeat the selection instead. It's off each time you
  open a take.
- **Practice speed** (½× 1× 2×) slows or speeds the take without changing its
  pitch. It's off while Loop is on: the loop plays at 1×, exactly.
- The screen stays on while a take plays.

**Flags:**

- **⚑** drops a flag at the playhead.
- **Tap a pin** to name or delete it. **Drag a pin** to move it.
- **◂⚑ ⚑▸** jump between flags.

**Doing things with the selection:**

- **Save as take** makes a new take of just the selection.
- **Share** sends it from your phone as an MP3 (the whole take, with no
  selection).
- **Send to tape** puts it on the loaded tape (step 6).
- **More** has the DAW bundle (WAV + MIDI in a zip), the downloads, and
  delete.
- **Undo** in the header steps back through anything you changed (step 4).

**Checks — step 1:**

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

**Checks — step 3:**

- [demo] Make a selection that fills the screen, then drag with one finger →
  the view pans and the selection stays where it was.
- [demo] Put a flag inside the selection, then tap its pin → the flag opens.
  Drag the pin → the flag moves.
- [demo] Set a selection with Loop off and press ▶ before In → playback runs
  through the selection and on. Turn Loop on → it repeats In to Out.
- [demo] Tap **In**, move the playhead, tap **Out** → you get the same
  selection as by holding and dragging.
- [demo] On a take with a BPM, choose *Snap: beat* and drag a grip → it jumps
  beat by beat. A nudge moves one beat; with Snap off, a nudge moves 10 ms.
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

## 5. Undo and the trash

*Step 4.*

**Undo.** Every change you make to a take is remembered, the last 50 of them:
its flags (added, moved, renamed, deleted), the selection, the name, the
tempo, the downbeat, and drum or notes lanes. Starring isn't: tap the star
again. **↶** in the take's header (or Ctrl-Z / ⌘-Z) steps back one change at
a time through the changes made on this phone or computer, never another
device's; its tip says what the next step will undo. Changes made quickly to
one thing, like holding a nudge, are one step.

Removing something — deleting a flag, clearing the selection, deleting a
take — shows a toast with its own **Undo**, which undoes exactly that, even if
you've changed something else since. If another device changed the same
thing in the meantime, Undo leaves their change alone and says so.

**The trash.** Deleting a take doesn't ask any more: it moves the take, with
everything saved beside it, to the trash, and the toast offers Undo. So does
`MAX_SAVES` pruning. **Recently deleted**, under the list, shows what's there
and when it went; **Restore** brings a take back starred, so the next prune
doesn't take it straight back. **×** deletes one for good and **Empty**
empties the trash, and those two do ask. The trash empties itself after 7
days, and sooner, oldest first, whenever the disk falls under `MIN_FREE_GB`,
so it never stops a capture.

**Several takes at once.** Hold a take in the list for half a second, or tap
**Select** above it. Tap takes to pick them; a bar at the bottom then
**★** stars them (or unstars them, if they all are), **Export** downloads
one zip of their WAVs with their names, flags and MIDI, and **Delete** moves
them to the trash, with Undo. **Done** or Escape stops selecting.

**Checks — step 4:**

- [demo] Delete a flag → the toast offers Undo; tap it → the flag is back.
- [demo] Change a take's name, then its BPM, then tap ↶ twice → both are
  back as they were. ↶'s tip says "Undo the tempo change" before the first
  tap.
- [demo] Clear the selection → the toast offers Undo; tap it → the selection
  is back.
- [demo] Delete a take from its page → you're back at the list with "Deleted
  … · Undo"; tap Undo → it's back, starred, with its flags.
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

*Step 5.*

**Hold and drag across the buffer ribbon** to select any stretch of the last
15 minutes, not just the last N minutes, then tap *Save as take*. The ribbon
squeezes older time together, so select generously and trim on the take page.

**A flag's sheet** also offers *Save from here to now*.

**Checks — step 5:**

- [demo] Wait ten minutes, then select a span about eight minutes back on the
  ribbon and save → the take holds roughly that span, not the last N minutes.
- [demo] Tap a flag on the ribbon → its sheet opens. Today a tap deletes it.
  *Save from here to now* makes a take starting at the flag.

## 7. Recording from your phone

*Step 2.* Full design:
[phone recording](superpowers/specs/2026-10-03-phone-recording-design.md).

**Recording:**

1. Open Hindsight on its HTTPS address — the `tailscale serve` one. The mic
   only works over HTTPS; on the plain address, *Phone* tells you so.
2. Tap **Phone**, in the row under Capture.
3. Choose the mic, or an input plugged into the phone (the Orchid through a
   USB-C adapter, say). The meter moves before you record, so you can check
   the level first. A cable beats the mic for anything you mean to keep.
4. Tap **Record**, play, then tap **Stop**.

**What happens to it.** The take streams to the Pi as you play and appears in
the list, labelled *Phone*, when you stop. It's a take like any other: open
it, select, save part of it, share it.

**If the Wi-Fi drops.** The recorder says *Reconnecting…* and keeps the audio
on the phone until the Pi is back, then sends it. Nothing is lost as long as
the page stays open and the Pi hears from it again within ten minutes.

**Keep the page open.** Locking the phone or switching apps pauses the
recording, and the take skips that stretch; the page tells you how much is
missing when you come back. The screen is kept awake while you record, even
on battery; the sheet says if the phone won't allow it. You can hide the
sheet while recording: the Phone button turns into a red *REC* timer, and
tapping it brings the sheet back.

**If something goes wrong.** If the page closes before Stop, whatever reached
the Pi is kept as *Phone (partial)*, ten minutes later. If the Pi restarts
mid-recording, what it had is kept the same way, and the phone carries on
into a second partial take.

**Limits.** Recording stops by itself at three hours, or if the Pi's free
space falls under `MIN_FREE_GB`; what was recorded is kept.

**Checks — step 2:**

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

## 8. Tape

*Steps 6–9.* Full design: [tape](superpowers/specs/2026-10-03-tape-design.md).

### 8.1 Plug in

| Sidekick input | Plug in | Why |
|---|---|---|
| Channel 1 (jack 1) | MPC, when you're using it | Channel 1 is where tape bus A plays back, so the MPC shares its fader and FX |
| Channel 2 (jack 2) | Bento audio | Keeps the Sidekick's FX on the Bento while you jam |
| Aux | The instrument you're layering: Orchid, guitar (through a pedal or DI), GO:KEYS | Aux is recorded clean and dry, so the tape's FX can be changed later |

The Bento's USB goes to the Pi's hub too, for MIDI only.

### 8.2 The tape page

Four lanes, one per track. Each has a name, its bus (A or B), mute (M) and
solo (S).

- **Tap a track's header** to select it.
- **The ruler** across the top shows bars and the playhead. Hold and drag on
  it to select bars.
- **The buttons:** ▶, ⟲ Loop, In, Out, Rec, Catch.
- **Source chips** show which input is sounding and whether it's clean, meaning
  free of the tape's own playback.
- **The passes row** shows the last eight times round the loop.
- **The dot** by the tempo means playback and recording are lined up to the
  sample.

### 8.3 Your first loop

*Step 6.* **Free (the default).**

1. Play until a part sounds right.
2. Tap where the loop starts, then tap where it comes round again.
3. Hindsight snaps each tap to the nearest note you played, and the loop starts
   playing back right away, in time with you.
4. Its length sets the tempo. If it guessed 168 BPM and you meant 84, tap the
   tempo and choose the other — nothing is stretched, only relabelled.

**From a tempo.** Set a BPM and Hindsight plays a one-bar count-in and a click.
Play along, and after a few times round tap **Catch ▸ 4 bars**.

**Checks — step 6:**

- [demo] With the demo loop playing, catch the last 4 bars onto track 1 → the
  loop plays back from track 1 in time with the demo, and the dot shows
  *locked*.
- [rig] Play the Orchid into aux, tap start and end around a phrase → the loop
  plays out of channel 1 in phase with you; the tempo reads sensibly.
- [rig] Turn the Orchid off → the loop keeps playing.

### 8.4 Building it up

*Step 6.*

**Passes.** While the loop plays, everything you play is recorded anyway. The
passes row shows each time round; tap one and it lands on the selected track.

**Punch.** Tap **Rec** while playing and the next time round is recorded.
While stopped, Rec arms the track and ▶ counts you in.

**Layers.** Catching onto a track that already has audio adds a layer on top.
Choose *replace* instead to clear what's there.

**Mix.** Each track has level, pan, mute and solo. The Sidekick's channel 1
knobs — EQ, FX, fader — act on bus A, which is the whole tape by default.

**Checks — step 6:**

- [demo] Play over the loop for four passes, then tap pass −3 → that pass
  lands on track 2, in time.
- [demo] Arm Rec while stopped, press ▶ → you hear a one-bar count-in, then
  recording starts.
- [rig] Turn channel 1's FX knob → the tape's sound changes, and the live
  instrument on aux doesn't.
- [demo] Catch onto a track that has audio, with *replace* off → both are
  heard. Undo → only the first remains.
- [demo] Fill a track to six minutes, then catch more → it's refused with the
  room left shown.

### 8.5 Editing like an OP-1

*Step 7.* Select bars (hold and drag on the ruler, or In and Out), choose
*one track* or *all*, then:

| Do | Gets you |
|---|---|
| **Lift** | Cuts the selection into the clipboard, leaving silence |
| **Copy** | Copies it to the clipboard, leaving the tape alone |
| **Drop** | Pastes the clipboard at the playhead, replacing what's there, and moves the playhead to the end. **Drop, drop, drop** lays copies end to end — the quickest way to turn four bars into sixteen |
| **Merge drop** | Drops a four-track clipboard onto a single track, mixed |
| **Split** | Cuts a clip in two at the playhead |
| **Join** | Rejoins two neighbouring clips |
| **Slide** | Hold a clip, then drag it along its track |
| **Multiply** | Doubles the loop, copying what's in it |

**Clone** in the tape browser makes a safety copy of a whole tape before you
try something. It costs no disk space.

**Checks — step 7:**

- [demo] Select 4 bars on all tracks, Lift, then Drop three times → twelve
  bars of the same four, with no clicks where the copies meet.
- [demo] Split a clip, slide the second half one bar later, then Undo twice →
  the clip is whole again.
- [demo] Clone a tape, delete the original, then play the clone → it plays
  fully; no audio was lost.
- [demo] Copy a selection on a take page, then Drop it on a tape → it's
  there.

### 8.6 Mixdown and export

*Step 7.*

- **Mixdown.** Set In and Out around the song and tap *Mixdown*. The tape
  plays once, and what came out of the mixer — FX, live playing and all — is
  saved as a take. To share a song, mix it down and share the take.
- **Export** downloads each track as its own WAV, plus a MIDI file with the
  tempo, for a DAW.

**Checks — step 7:**

- [demo] Mix down 8 bars → a take of exactly those 8 bars plus 2 seconds of
  tail appears, named after the tape.
- [rig] Mix down with an FX on channel 1 → the take has the FX.
- [demo] Export → a zip with four WAVs that line up at bar 1 in a DAW.

### 8.7 The Bento follows the tape

*Step 8.*

- **Lead mode.** With the Bento's USB on the Pi, the tape sends it tempo and
  start/stop, so its sequences line up with the tape.
- **Follow mode** reverses that: the tape follows the Bento's tempo by speeding
  up or slowing down slightly.

**Checks — step 8:**

- [rig] Press ▶ on the tape → the Bento starts in time; ■ stops it.
- [rig] In follow mode, start the Bento → the tape plays in time with it for
  five minutes without drifting.

### 8.8 Tricks and tape speed

*Step 9.* Hold a trick pad and it acts until you let go, starting on the next
16th note:

- **Break** winds the tape down to a stop. When you let go, it comes back in
  time.
- **Reverse** plays backwards.
- **Chop** repeats a small slice in time.
- **Memo 1 and 2** remember a mix (levels, mutes, Sidekick settings). Hold
  one to recall it; hold both to blend them.

**Tape speed** slows or speeds the whole tape, pitch and all, like a real tape
machine.

**Checks — step 9:**

- [demo] Hold Break for a bar → the tape winds down; on release, it resumes
  where it would have been.
- [demo] Set tape speed to 50% → the tape plays an octave lower and at half
  tempo.

## 9. Tips in the app

*Step 3 for takes, step 6 for tapes.*

**How you get help:**

- **On a computer,** every button has a tooltip.
- **On a phone,** tap **?** in the header to enter help mode, then tap
  anything to read its tip instead of using it.
- **The first time you open** the take page or the tape page, three short
  hints point at the gestures that matter most. They're remembered per
  device.
- **Each page's ? sheet** links to its section of this guide, which the app
  serves at `/guide.html`.

**One source of truth.** The tip text lives in `web/static/lib/help/tips.js`
and in the table below, and a test fails if the two disagree, or if a control
has no tip.

| Control | Tip |
|---|---|
| Capture | Save the last 30 s, 2 m, 7 m or all of what you just played as a take |
| Flag now | Mark this moment. Any take that includes it gets a flag here |
| Ribbon | The last 15 minutes, recent end stretched. Hold and drag to select a span |
| Phone | Record from this phone's mic or a plugged-in input, straight into Hindsight |
| Open | Open the take to select, loop, save or share part of it |
| Select | Pick several takes to star, export or delete together. Holding a take does the same |
| ★ Star (selecting) | Star the picked takes, or unstar them if they all are |
| Export | One zip of the picked takes: each WAV, its name and flags, and its MIDI |
| Delete (selecting) | Move the picked takes to the trash |
| Done | Stop selecting |
| Restore | Put this take back in the list, starred |
| × (Recently deleted) | Delete this take for good |
| Empty | Delete everything in the trash for good |
| ★ | Starred takes stay at the top and are pruned last |
| Name | Tap to rename the take |
| BPM | Tap to set the tempo. It draws the bar grid and makes Snap possible |
| Download WAV | The whole take, as recorded |
| Download MIDI | The take's MIDI file |
| Delete take | Move this take to the trash. Recently deleted, under the list, keeps it a week |
| ‹ | Back to the list, where you left it |
| ◂ ▸ | The previous or next take in the list |
| from … | This take was saved from another one. Tap to open that one |
| ↶ | Undo your last change to this take: a flag, the selection, the name, tempo, downbeat or lanes |
| ? | Help mode: tap anything to read what it does, instead of doing it |
| ⋯ | Reset the downbeat, or open this guide |
| Reset the downbeat | Put bar 1 back at the start of the take |
| The guide | How Hindsight works, in plain words |
| Overview | The whole take. Drag the window to move along it; double-tap to see it all |
| Waveform | Drag to move along, pinch to zoom. Hold, then drag, to select. Tap to move the playhead; tap twice to flag |
| ▶ | Play from the playhead |
| ⟲ Loop | Repeat the selection instead of playing straight through |
| In | Start the selection at the playhead |
| Out | End the selection at the playhead |
| ⚑ | Drop a flag at the playhead |
| ◂⚑ ⚑▸ | Jump to the previous or next flag |
| Delete flag | Remove this flag |
| ◂ ▸ beside In and Out | Move that end of the selection to the next snap line, or by 10 ms |
| Clear | Forget the selection. The take itself is untouched |
| Snap | Make the selection, In, Out and the nudges land on bars, beats or 8ths |
| Practice speed | Slow down or speed up without changing pitch |
| Save as take | Make a new take of just the selection |
| Share | Send the selection from your phone as an MP3 |
| More | The DAW bundle, the WAV and MIDI downloads, and delete |
| DAW bundle | The selection's WAV and MIDI, lined up, in a zip for a DAW |
| Notes | Watch the take's MIDI rise out of a keyboard as it plays |
| Lane | Tap for this lane's menu: collapse, show as drums or notes, or hide |
| Send to tape | Put the selection on the loaded tape, at its playhead |
| Rec | Record the next time round the loop. Stopped: arm, then ▶ counts you in |
| Catch | Put what you just played onto the selected track: the last bars, or a pass |
| Passes | Every time round the loop, kept. Tap one to put it on the selected track |
| Lift | Cut the selection into the clipboard |
| Copy | Copy the selection into the clipboard |
| Drop | Paste the clipboard at the playhead; tap again to lay another copy after it |
| Merge drop | Paste a four-track clipboard onto one track, mixed |
| Split | Cut the clip in two at the playhead |
| Join | Rejoin two neighbouring clips |
| Multiply | Double the loop, copying what's in it |
| Clone | Copy this whole tape. Costs no disk space |
| Mixdown | Play In to Out once and save what came out of the mixer as a take |
| Bus A / B | Which Sidekick channel this track plays through, for its EQ and FX |
| Source chip | Which input you'd catch from. Filled = sounding; ring = clean of the tape |
| Lock dot | Playback and recording are lined up to the sample |

## 10. When something's off

| You see | It means | Do |
|---|---|---|
| The lock dot is hollow | Playback and recording haven't been lined up yet; it locks once the tape plays something with a clear attack | Play the tape for a few seconds. Catches still work, marked *estimated*, and can be nudged |
| A source chip says *not clean* | The tape is playing through that channel, so catching from it also records the tape | Catch from aux, or move the track to the other bus |
| "Too long for the ring" on Mixdown | The selection is longer than the last 15 minutes can hold | Mix down in parts, or raise `RING_SECONDS` |
| "Not enough room on the tape" | The track would run past six minutes | Lift something, or raise `TAPE_LENGTH_S` |
| *Phone* says the microphone needs a secure page | You're on the plain `http://` address | Use the HTTPS address from `tailscale serve` |
| The recorder says *Reconnecting…* | The phone lost the Pi for a moment; the audio is kept on the phone meanwhile | Nothing: it resends when the Pi is back. Keep the page open |
| "The recording paused while the page was hidden" | The phone locked or you switched apps, and the browser stopped the mic | The take skips that stretch. Keep Hindsight in front while recording |
| A take is labelled *Phone (partial)* | The recording never got its Stop: the page closed, or the Pi restarted mid-recording | It holds everything that reached the Pi |
| A capture or catch is refused for disk space | Free space is under `MIN_FREE_GB` | Empty the trash, or delete old takes |
