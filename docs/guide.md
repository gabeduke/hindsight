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
- **Copy** puts it on the clipboard, to drop onto a tape (step 6d).
- **Send to tape** copies it and drops it on the loaded tape (step 6).
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

**Hold, then drag, across the ribbon** to select any stretch of the last 15
minutes, not just the last N, then tap **Save as take** in the bar that
appears under it. The bar says how long the span is and how long ago
("1:32 · 8:12–6:40 ago"). The ribbon squeezes older time together, so
select generously and trim on the take page. Hold without dragging to select
from there to now. **×** forgets the selection.

The selection names the audio, not a place on the screen: it slides left as
time passes, like the audio it holds. If its start leaves the buffer before
you save, the bar says so and the take starts at the oldest audio there is.

The take is dated by when its last moment was played, so it sorts among the
others by when it happened, and its tempo is read over that span, not over
the last few seconds. Flags inside it come with it. If a span leaves the
buffer altogether before you save, the bar says so and Save is off. With
`MAX_SAVES` set, remember a take dated in the past is pruned like one: star
it to keep it.

**Tap a flag on the ribbon** for its sheet: **Save from here to now** makes
a take that starts at the flag; **Delete flag** removes it.

**Copy** *(step 6d, with the tape on)* puts the selected span of MAIN on the
clipboard, to drop onto a tape.

**Checks — step 5:**

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
- [demo] With the tape on, select a span and tap **Copy** → *Copied …: Drop
  it on a tape*; the tape page's clipboard shows it. *(Step 6d.)*

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
Step 6 comes in parts:

- **6a** is the tape itself: tapes, tracks, clips, the mix, the transport,
  catching passes and bars, sending a take to tape, and undo. It plays in the
  demo.
- **6b** plays the tape through the Sidekick on the Pi, and lines its
  playback up with the recording by listening to itself.
- **6c** adds punch-in, arming, the count-in and click, and free loops.
- **6d** adds the clipboard (*Copy* on takes and the ribbon), *replace*,
  pan, tiling, and selecting bars on a ruler.

Turn the tape on with `TAPE=true` ([configuration](configuration.md#the-tape)).
The main page then shows a **Tape** chip that opens the tape page.

### 8.1 Plug in

| Sidekick input | Plug in | Why |
|---|---|---|
| Channel 1 (jack 1) | MPC, when you're using it | Channel 1 is where tape bus A plays back, so the MPC shares its fader and FX |
| Channel 2 (jack 2) | Bento audio | Keeps the Sidekick's FX on the Bento while you jam |
| Aux | The instrument you're layering: Orchid, guitar (through a pedal or DI), GO:KEYS | Aux is recorded clean and dry, so the tape's FX can be changed later |

The Bento's USB goes to the Pi's hub too, for MIDI only.

*Step 6b.* The tape plays out of the Sidekick's USB playback: bus A on 1/2
into channel 1, bus B on 3/4 into channel 2. If the Sidekick isn't there,
▶ reads *no output* until it is.

### 8.2 The tape page

From the top:

- **The name.** Tap it for the tape menu: open another tape, start a new one,
  clone this one, delete one, or this guide. Under the name: the tempo and how
  many bars the loop is.
- **The dot** says how well the tape's playback and the recording are lined
  up:
  - **Green:** to the sample. On the Pi, Hindsight listens for the tape in
    channel 1's (or 2's) recording and locks on within a few seconds of it
    playing something with a clear attack, like drums.
  - **Amber:** estimated from the clocks, to a few milliseconds. Catches
    work, and say so in their sheet; nudge one if it's early or late.
  - **Red:** not at all yet. Catches are refused until it's amber.
- **↶ ↷** undo and redo every change to the tape except its name. 100 steps
  are kept, with the tape, so they survive a restart and every device shares
  them.
- **The overview** is the whole tape, six minutes: what's on each track, and
  the loop in amber.
- **Four lanes**, one per track:
  - Each header has the track's number (tap it to select the track), its bus
    (A or B; tap to swap), **M** (mute), **S** (solo) and its level.
  - In the lane: the bar lines, the clips and the playhead. A layer on top of
    another clip is drawn blue.
  - Tap a clip to open its sheet. Tap an empty part of a lane to move the
    playhead there.
- **▶ / ■** plays and stops. **⟲ Loop** turns the loop on and off; off, the
  tape plays on to the end of what's recorded. Beside them is where the tape
  is, as bar.beat and time.
- **Catch from** chooses the input a catch takes from: main, ch1, ch2 or aux.
  - **●** means clean: none of the tape's own playback is in it.
  - **○** means the tape is in it: ch1 hears bus A, ch2 hears bus B, and main
    hears both.
- **Catch the last pass** and **1 bar / 2 / 4** catch onto the selected track.
- **Passes** keeps the last six times round the loop; −1 is the newest.

### 8.3 Your first loop

*Steps 6a and 6c.* There are three ways to start a tape.

**Free (6c).** Play until a part sounds right. On the empty tape, choose the
source and tap **Tap where the loop starts** on the downbeat, then tap again
where it comes round.

1. Each tap is timed when it reaches the Pi, and snaps to the strongest
   attack in that source from a quarter of a second before it to a
   twentieth after. Tapping a little late, or Wi-Fi being slow, doesn't
   matter.
2. The span becomes the first loop on the selected track, and starts playing
   at once, in time with you, as if it had been playing all along.
3. Its length sets the tempo: the number of bars that puts it nearest your
   last tape's tempo (or 90 BPM). If it guessed 168 and you meant 84, tap
   the tempo under the name and choose the other. Nothing is stretched,
   only relabelled.

**From a take.** On a take page, select the loop, with In and Out on the
downbeats, and choose **More → Send to tape**. If no tape is loaded, a new one
is made.

- On an empty tape, the selection becomes the first loop, on track 1. Its
  length sets the tempo: Hindsight picks the number of bars that puts it
  nearest your last tape's tempo (or 90 BPM), and the loop turns on. A
  selection too short or too long to be 20–400 BPM is refused.
- On a tape that already has a tempo, it lands at the playhead on track 1,
  replacing what's there.

**From a tempo.** On an empty tape, type a BPM and a number of bars and tap
**Set**. The loop is that long and empty, ready to catch into, and the
**♩ click** plays on every beat until the first catch.

The tempo is fixed once the tape has audio, because nothing is ever stretched.

**Checks — steps 6a and 6c:**

- [demo] With no other tapes, on a take page select 2 seconds and choose
  **More → Send to tape** → a toast says it was sent. On the tape page,
  track 1 holds the clip, the tempo reads *120.0 BPM · 1 bar*, and ⟲ Loop
  is on.
- [demo] Press ▶ → the playhead goes round the loop, the position counts
  bars, and the passes row fills, one button a pass.
- [demo] Make a new tape, set 90 BPM and 4 bars → it reads *90.0 BPM · 4
  bars*, and the lanes show four empty bars. Press ▶ → a click on every
  beat, higher on the bar. After the first catch, the click goes off and the
  tempo can't be changed.
- [demo] Make a new tape, choose *aux*, tap on a kick, then tap about 2.5 s
  later on another → a 2.50 s loop, *1 bar at 96 BPM*, playing on track 1.
- [demo] Tap the tempo under the name, choose 2 bars → it reads *192 BPM ·
  2 bars*; the loop sounds the same.
- [rig] Play a phrase on the Orchid into aux, tap on its first note, and on
  the same note when it comes round → the loop plays out of channel 1 in
  time with you, and the tempo reads sensibly.
- [rig] Send a take to tape on the Pi and press ▶ → the loop plays out of
  channel 1, and within a few seconds the dot turns green.
- [rig] Turn the Sidekick off and on again while the tape plays → ▶ reads
  *no output*, then the tape plays again; the dot is amber until it locks
  again.

### 8.4 Building it up

*Step 6a.*

**Catching.** While the loop plays, everything you play is in the ring
anyway. Choose a source and select a track, then:

- **Catch the last pass**, or tap a pass in the row, to put that whole time
  round on the track, where it was played. Moving the loop, or loading
  another tape, starts the passes again.
- **1 bar / 2 / 4** catches the last bars, up to the last bar line the ring
  has heard. A catch that runs across the loop's end is split in two, so it
  still plays where it was played, and carries on across the seam without a
  bump.

A catch goes on top of what's already on the track, as a layer, the way an
OP-1 overdubs. Its toast has **Undo**.

**Clips.** Tap a clip for its sheet: its level, a ±5 ms nudge for timing, and
**Remove**.

**Mix.** Each track has a level, mute, solo and a bus. Every track starts on
bus A, 6 dB down.

- Bus A plays out of the Sidekick's channel 1, and bus B out of channel 2.
- So the Sidekick's channel knobs (EQ, FX, fader) act on a whole bus.

**Undo** steps back through every change, catches included. Quick changes to
the same thing, like dragging a level, are one step.

**Clone and delete.** *Clone this tape*, in the tape menu, makes a copy that
shares the original's audio, so it costs no disk space. *Delete a tape…* asks
for the tape's name. The loaded tape can't be deleted; open another one first.
Deleting frees whatever audio no other tape uses, including what's only in
other tapes' undo.

**Rec (6c).** Choose a source and select a track, then:

- **While playing,** tap **● Rec** and recording starts at the next bar line
  (or the one you just passed, if it was less than a quarter second ago).
  Tap ● again (or ■) to keep it. With the loop on, it keeps the last full
  pass it covered -- the others are still in the passes row. Otherwise, or
  if no pass was full, it keeps the bars up to the last complete one.
- **While stopped,** tap ● to arm the track (*● Armed*). Press ▶: a bar of
  click counts you in, then the tape plays from the playhead's bar and
  records. ■ keeps it.
- The toast has **Cancel** while it records, and **Undo** once kept.

**The clipboard (6d)** holds what you last copied -- from a take, the
ribbon, or a tape (step 7) -- and keeps it through a restart. Its row on the
tape page shows how long it is and where it came from:

- **Tap it** to hear it.
- **Drop** puts it on the selected track at the playhead, replacing what's
  there. Stopped, the playhead moves to the drop's end, so **Drop, Drop,
  Drop** lays copies end to end. On an empty tape, a drop is the first loop.
- **×** empties it.

**More (6d):**

- **Layer / Replace** chooses what a catch or a punch does to audio already
  on the track: sits on top of it, or clears it first.
- **The ruler** over the lanes shows the bars, with the loop shaded. Tap it
  to move the playhead to a bar line; hold, then drag across it to loop
  those bars. The lanes show the loop and a bar either side, so you can drag
  it a bar wider at a time.
- **A clip's sheet** has *Repeat to the loop's end*: copies of the clip end
  to end, wherever its layer is free -- one bar through four.
- **Tap a track's number again** for its sheet: its name, level and pan.

**Checks — steps 6a and 6c:**

- [demo] Send 2 s to an empty tape and press ▶. Choose *aux*, select track 2,
  wait four passes, then tap **−3** → a 2.0 s clip lands on track 2 at bar 1,
  and the toast says *Caught 2.0 s from aux onto track 2*.
- [demo] Catch from *ch1* → the toast warns that the tape was in that source
  too.
- [demo] On a 4-bar loop, play for a pass, then tap **1 bar** → a one-bar
  clip lands on the bar that just finished.
- [demo] Tap a clip, choose **Remove**, then **Undo** in the toast → the clip
  is back. ↶ and ↷ step through the same history.
- [demo] Open the tape page on two devices and mute a track on one → the
  other shows it within a second.
- [demo] Clone a tape and open the clone, delete the original, then play the
  clone → it plays fully.
- [demo] Restart Hindsight → the tape that was loaded is loaded again, with
  its undo.
- [demo] With a 1-bar loop playing, select track 2, tap ●, wait three passes,
  tap ● → *Kept 1 bar from aux on track 2*: the last full pass.
- [demo] Stop. Select track 3, tap ● (*● Armed 3*), press ▶ → the position
  reads *count-in 1 of 4…4 of 4* over a bar of click, then the tape plays;
  after two passes press ■ → *Kept 1 bar*: the last full pass, on track 3.
- [demo] Arm, press ▶, and press ■ during the count-in → nothing is kept,
  and nothing complains.
- [rig] Arm track 3 with the guitar in aux, press ▶, play over the count-in
  and two passes, press ■ → the guitar is on track 3, in time.
- [demo] On a take page choose **More → Copy**, then on an empty tape tap
  **Drop** three times → the first is the loop, and the next two lie end to
  end after it. Undo takes them back one at a time.
- [demo] Tap the clipboard → you hear it; tap again → it stops.
- [demo] Choose **Replace**, catch a pass onto a track that has audio →
  the old audio under it is gone, not layered.
- [demo] Hold on the ruler, drag across two bars → *Looping 2 bars*; the tape
  loops those.
- [demo] Tap a 1-bar clip in a 4-bar loop, *Repeat to the loop's end* → four
  copies.
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
| Ribbon | The last 15 minutes, recent end stretched. Hold and drag to select a span; tap a flag for its options |
| Save as take (ribbon) | Save exactly the span you selected on the ribbon as a take |
| × (ribbon) | Forget the span selected on the ribbon |
| Save from here to now | Save a take that starts at this flag and runs to now |
| Delete flag (ribbon) | Remove this flag. Takes saved later won't carry it |
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
| Send to tape | Put the selection on the loaded tape at its playhead, or make it the first loop of an empty tape |
| Tape (main page) | The tape: layer loops caught from what you just played |
| Tape name | Your tapes: load one, make a new one, clone this one |
| A tape in the list | Load this tape: the transport plays the loaded one |
| New tape | Start an empty tape. Its first loop sets the tempo |
| Delete a tape | Delete another tape. Audio it shares with others stays |
| BPM, Bars (empty tape) | Start from a tempo instead of a first loop |
| ↶ ↷ (tape) | Undo or redo the last change to the tape: up to 100 steps |
| Tape overview | The whole tape, six minutes a track; the loop in amber |
| A lane | Tap a clip for its level, nudge or removal; tap elsewhere to move the playhead there |
| A track header | Tap the number to pick the track catches go onto |
| M, S | Mute this track, or solo it: only soloed tracks play |
| Track level | The track's level into its bus, -30 to +6 dB. Tracks start at -6 |
| ▶ (tape) | Play or stop the tape |
| Ruler (tape) | Tap: the playhead to that bar. Hold, then drag: loop those bars |
| Layer / Replace | Onto audio already there: layer on top of it, or replace it |
| Clipboard | What you copied last, from a take, the ribbon or a tape. Tap to hear it |
| × (clipboard) | Empty the clipboard |
| Repeat to the loop’s end | Copies of this clip end to end, to the end of the loop: one bar through four |
| Track name | What’s on this track, for you: chords, bass… |
| Pan | Where this track sits between left and right |
| Copy (ribbon) | Put the span you selected on the clipboard, to drop onto a tape |
| ● Rec (tape) | Stopped: arm the selected track, then ▶ counts in a bar. Playing: record from the next bar. Tap again to keep it |
| ♩ Click | A click on every beat, on bus A. On by itself only while the tape is empty |
| Tap (empty tape) | Tap where the loop starts, then where it comes round: each tap snaps to the strongest attack near it |
| Tempo (tape) | Call the loop more bars or fewer: the same length, so nothing is stretched |
| ⟲ Loop (tape) | Loop the bracket, or play on to the end of what’s recorded |
| 1 bar, 2, 4 | Catch the last bars you played, ending on the last bar line, where they were played |
| Clip level | This clip's level within its track |
| Nudge | Move the clip a few milliseconds, for a part a little early or late |
| Remove (clip) | Take this clip off the tape. Undo brings it back |
| Catch | Put what you just played onto the selected track: the last bars, or a pass |
| Passes | Every time round the loop, kept. Tap one to put it on the selected track |
| Lift | Cut the selection into the clipboard |
| Copy | Put the selection on the clipboard, to drop onto a tape |
| Drop | The clipboard onto the selected track at the playhead, replacing what’s there. Drop again to lay another copy after it |
| Merge drop | Paste a four-track clipboard onto one track, mixed |
| Split | Cut the clip in two at the playhead |
| Join | Rejoin two neighbouring clips |
| Multiply | Double the loop, copying what's in it |
| Clone | Copy this whole tape. Costs no disk space |
| Mixdown | Play In to Out once and save what came out of the mixer as a take |
| Bus A / B | Which Sidekick channel this track plays through, for its EQ and FX |
| Source chip | Which input a catch takes from. ● clean: none of the tape is in it. ○ the tape is in it too |
| Lock dot | How playback and recording line up. Green: to the sample. Amber: by the clocks, nudge if off. Red: not yet |

## 10. When something's off

| You see | It means | Do |
|---|---|---|
| The dot by ↶ is amber | Playback and recording are lined up only by the clocks, to a few milliseconds; it locks once the tape plays something with a clear attack on bus A or B | Play the tape for a few seconds, with drums or another percussive part on it. Catches still work meanwhile; nudge one if it's off |
| The dot by ↶ is red | Nothing is lined up yet: the tape hasn't played since Hindsight started, or there's no output | Press ▶. If ▶ reads *no output*, check the Sidekick is on and plugged in |
| A source chip shows ○ | The tape is playing through that channel, so catching from it also records the tape | Catch from aux, or move the track to the other bus |
| "Too long for the ring" on Mixdown | The selection is longer than the last 15 minutes can hold | Mix down in parts, or raise `RING_SECONDS` |
| "Not enough room on the tape" | The track would run past six minutes | Lift something, or raise `TAPE_LENGTH_S` |
| *Phone* says the microphone needs a secure page | You're on the plain `http://` address | Use the HTTPS address from `tailscale serve` |
| The recorder says *Reconnecting…* | The phone lost the Pi for a moment; the audio is kept on the phone meanwhile | Nothing: it resends when the Pi is back. Keep the page open |
| "The recording paused while the page was hidden" | The phone locked or you switched apps, and the browser stopped the mic | The take skips that stretch. Keep Hindsight in front while recording |
| A take is labelled *Phone (partial)* | The recording never got its Stop: the page closed, or the Pi restarted mid-recording | It holds everything that reached the Pi |
| A capture or catch is refused for disk space | Free space is under `MIN_FREE_GB` | Empty the trash, or delete old takes |
