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
| **Tape** | Four tracks, 20 minutes each by default, holding clips |
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

- **The buffer ribbon.** The last 15 minutes on tape, passing the red record
  head at *REC*, with the recent end stretched so you can see it. The length
  Capture would catch is lit orange; the pills along the top mark each
  length, and the strip underneath says how long ago.
- **The meters,** backlit VU needles for the channels being saved, with the
  level in dBFS under each, and the buffer, disk, dropped and tempo
  readouts in amber. On a phone held sideways the needles fold to two bars.
- **Capture.** Choose 30 s, 2 m, 7 m or Full -- the key says how much it
  will catch -- and tap *Capture* to save that much of the past as a take.
  It glows a moment when it has.
- **Flag now.** It marks this moment in the ring;
  the flag rides along into any take that includes it.
- **On the shelf.** The newest takes as cassettes, a new one sliding in with
  a *NEW* sticker. Tap one to hear it, tap again to stop. **All takes** goes
  to the takes page (§3.1), where the rest live and where a take is renamed,
  starred and opened.
- **The bar,** along the foot of the page on a tablet or a computer, is the
  same now-playing bar as on the tape page (§8.2), holding the tape: its
  reels and amber window, **|◂ ▶ ⟲**, and the whole tape as a strip to tap
  or drag. **Open (the tape) ›** goes to it. A cassette tapped on the shelf
  plays in the bar instead; when it ends, or with **⏏**, the bar has the tape
  again. Without the tape it shows only while a take plays. On a phone it's
  the mini player above the tabs: tap its window for the whole bar (§8.2).

**Checks — today:**

- [demo] Tap *Capture* with 30 s chosen → a cassette slides onto the shelf
  with *NEW* within a few seconds, about 30 s long, and plays when tapped.
- [demo] Tap *Flag now*, wait, then capture → the take has a flag at that
  moment.
- [demo] Star an older take → it is pruned last, and the takes page's
  *Starred* filter shows it.

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

### 3.1 The takes page

*Today.*

Every take, from **All takes** on the main page.

- **Search** finds a take by its name, the time in its name, or its tempo.
- **Filters** show only what is on: *Starred*, takes with *MIDI*, takes
  recorded from a *Phone*, and *Tape* mixdowns. They are remembered on the
  device; the search is not.
- **Newest** groups the takes by the day they were made — *Today*,
  *Yesterday*, then the date. **Longest** puts the longest first. **By tag**
  gives each tag its own group, the untagged last.
- **Tags.** A tag is a name and a color. Make them with **Edit tags** (up to
  24, eight colors); the list is kept on the Pi, so every device sees the
  same one. Pick a take and press a tag under its name to give it that tag:
  its cassette and spine wear the tag's color. A take has one tag; a take
  with none keeps the color its name gave it. The tag chips above the list
  show only one tag's takes, or only the *Untagged*, with a count on each;
  search also matches a tag's name. Deleting a tag leaves its takes untagged.
- **The rack.** Every take is a cassette, seen by its spine: its stripe,
  its name, a star when it's starred, its length, its bars printed on the
  card, and a light that's on for the picked take and pulses while it plays.
  Tap a spine to pick it. On a wide screen the picked take sits beside the
  rack as a cassette; on a phone it opens as a sheet, and Back or **‹ Takes**
  puts it away.
- **The bar,** along the foot of the page on a tablet or a computer, holds
  the picked take: **▶** plays it (its cassette's reels turn), **⟲ Loop**
  repeats its selection or the whole take, **|◂** goes back to its In, and the
  strip under them is the whole take to tap or drag. **Open the take ›** opens
  it. If the tape was playing when you came to the page, the bar keeps the
  tape until you pick a take; **⏏** puts the tape back in it. On a phone
  it's the mini player above the tabs, and the cassette's sheet covers it
  while it's open (§8.2).
- **The cassette.** **Play** (in the bar on a wide screen) turns its reels and winds the tape from one
  pack to the other; the bars light up as they play, and a tap or a drag in
  its window seeks. A selection shows as grease-pencil IN and OUT. Tap the
  name to rename the take, the tempo to set it, a flag to play from it.
  **Open the take**, the downloads and **Delete** are under it.
- **Families.** A take you made with *Save as take* folds into the take you
  cut it from, and a tape's mixdowns fold into the newest of them. So the
  rack keeps one spine for a jam and its riffs, and one for a tape however
  often you mix it down. That spine wears a count, **✂3** for its cuts and
  **MIX ×4** for the tape's mixdowns, and its cassette lists them under
  **Cuts** and **Earlier mixes**. Tap one to see it there, with **‹** back to
  the spine; a cut says what it was cut from.
  - A family sits on its spine's day: a riff cut today from last Tuesday's
    jam stays with last Tuesday.
  - Search and the filters look at every take before anything folds. A
    starred riff shows under *Starred* even when its jam isn't starred; a
    search finds it by its own name.
  - Delete a jam and its cuts stay. They come back onto the rack as spines of
    their own, still named after it; Undo folds them in again.
- **Select** and **Recently deleted** are as they were: hold a spine to start
  selecting. The take page's ◂ ▸ step through the takes in the order this
  page shows them, a spine's folded takes right after it, and its ‹ comes
  back here.

**Checks — today:**

- [demo] Capture from the main page, then open All takes → the take is first
  under *Today*.
- [demo] Turn on *Starred* with nothing starred → "No takes match", not
  "No takes yet".
- [demo] Record from a phone, then turn on *Phone* → only that take shows.
- [demo] On a phone, tap a spine → its cassette opens as a sheet; Back
  closes it and the rack is where you left it.
- [demo] Play the picked take → the reels turn and the tape moves from the
  left pack to the right.
- [demo] Open a take from a filtered list and press ▸ → the next take is the
  next one the list showed.
- [demo] Delete a take on its page → back here, with an Undo.
- [demo] **Edit tags** → add "Ideas" with a color, Save. Pick a take and press
  *Ideas* → its spine and cassette turn that color; press it again → the
  take goes back to the color its name gave it.
- [demo] Press the *Ideas* chip above the list → only tagged takes show;
  press *Untagged* → only the rest; press the lit chip → everything.
- [demo] Choose **By tag** → one group per tag, in the order of the tag list.
- [demo] Open the page on a second device → the same tags, and the same
  colors on the same takes.
- [demo] Delete a tag that has takes → they show as untagged, nothing else
  changes, and a filter that was on that tag turns itself off.
- [demo] Open a take, select two parts and *Save as take* each → back here,
  the take has one spine wearing **✂2**, and its cassette lists both cuts.
  Tap one → it's in the cassette, with *Cut from …* and a **‹** back.
- [demo] Delete that take → the toast says its 2 cuts are back on the shelf,
  and they're spines of their own; Undo → they fold in again.
- [demo] Star one of the cuts and turn on *Starred* → the cut shows alone.

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
- **The tempo** is measured from the audio after every capture, ribbon save
  and phone recording (a mixdown keeps the tape's tempo), with the MIDI clock
  as a hint: it reads *125.17 bpm · measured*. If the clock agrees to within
  0.05, the clock's is kept (*· clock*), and so it is for a take with no steady
  pulse. Takes from before this update keep their clock tempo until you edit
  them. Tap it to type your own.
- **The ruler:** bar numbers (or seconds, without a BPM), and the flags as
  pins above them. **▾** is the playhead; drag it to scrub silently. With a
  BPM, bar **1** is the downbeat; drag it to line the grid up.
- **The take, on tape:** its sound as a glowing trace on brown oxide (a
  stereo take left above right; anything else as one lane), lit where it has
  played, on the same scale as its cassette on the takes page. It's the
  sound's envelope: at the closest zoom it doesn't show each wave crossing.
- **The grips,** under the waveform at the selection's ends, with the move
  handle between them.
- **The toolbar:** with a selection, its In and Out times with their
  nudges, its length and *Clear*; with a BPM, the *Bar 1* row (below); then *Save as take* · *Send to tape* (when
  the Pi runs the tape) · *Share* · *More*; then ◂⚑ ⚑▸, *Snap* and
  *Practice speed*.
- **The bar,** along the foot of the page, as on the tape page: the take's
  reels either side of an amber window, which says where it is (bar.beat
  with a BPM, with the time beside it; otherwise the time, and the take's
  length) with ▶ or ❚❚ and a level bar for each side; then **|◂** (back to
  In, or to the start), **▶ / ❚❚** and **⟲ Loop**; then **IN**, **OUT** and
  **⚑**. Under them, **the overview:** the whole take, its scrubber. Tap it to
  move the playhead there, drag its window to move along, double-tap to see
  it all; with it focused, ← → move a second. **OUT · This device**: a take
  plays here. On a phone it's the mini player above the tabs, with ▶; tap
  its window for the whole bar (§8.2).
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
  and **Out** and the nudges land on bars, beats or 8ths. It starts on **bar**
  for a take with a tempo, until you choose another. A nudge from an end
  that sits between lines goes to the next line.
- **Clear** forgets the selection; the take is untouched.

**Bar 1:**

Once the take has a BPM, a *Bar 1* row stays in the toolbar. **Set to
playhead** puts bar 1 where the playhead is; **◂ ▸** move it 10 ms, or by one
*Snap* step (a bar, beat or ⅛) with *Snap* on, as In and Out do; the time between them opens the editor on it. The ruler's "1"
still drags, and **B** on a keyboard is Set to playhead. The grid follows as
it moves, and ↶ takes a run of nudges back as one step.

**Placing a boundary exactly:**

Dragging gets you near. To put In, Out or bar 1 on the very sample, open it in
the editor. Tap **In**'s or **Out**'s time in the selection row (they look like
small keys), or tap bar 1's "1" on the ruler. The view centres on the point,
and the editor bar takes the place of the toolbar.

- **ZOOM and POSITION** are two knobs you turn by dragging sideways. Zoom out,
  get near, zoom in, get nearer. POSITION moves half of what's on screen for a
  drag across the pad, so it's coarse zoomed out and moves single samples
  zoomed in.
- **Attack** puts the point on the start of the strongest hit, within 60 ms or
  half of what's on screen, if that's less. It works over a held bass. If it
  finds nothing, zoom out a little and try again.
- **Zero** puts it on the nearest zero crossing, within 5 ms, so a cut doesn't
  click.
- **Grid** puts it on the nearest line of the *Snap* setting, or the nearest
  beat with Snap off. It's hidden for bar 1.
- **◂ ▸** step 1 ms, or one sample when you're zoomed right in.
- **▶** plays from the point (from a second before Out), and pauses.
- **Seam** (with a selection) turns the loop on and shows the end of the loop
  on the left running into its start on the right. A jump at the middle line
  is the click or stutter. Tap a half to choose which edge moves.
- **The readout** gives the time to the sample (*0:02.502 +23*) and, with a
  tempo, how far the point is from the nearest beat (*+2.5 ms from 2.1*).
- **Undo** takes back a whole drag of a pad in one step.
- **Done**, or Escape, closes the editor.
- **On a computer,** the wheel moves the point; ⌘ or Ctrl with the wheel
  zooms; ← → step; Shift steps ten.

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

- **Save as take** makes a new take of just the selection. It asks for a
  name first, offering the one it would get anyway ("Tuesday jam ·
  0:42–1:10") already selected, so typing replaces it; Enter or **Save**
  saves it, Escape or **Cancel** doesn't. On the takes page it folds in
  with this take (§3.1).
- **Share** sends it from your phone as an MP3 (the whole take, with no
  selection).
- **Copy** puts it on the clipboard, to drop onto a tape (step 6d).
- **Send to tape** puts it on the loaded tape, by its tempo and downbeat if it
  has them (step 6). The line under the buttons says what it will do.
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
- [demo] On a take with a BPM, tap **Set to playhead** in the *Bar 1* row
  → bar 1 and the grid jump to the playhead. **◂ ▸** nudge it; ↶ undoes the
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

Step 7 comes in two: **7a** is editing (lift, copy, split, join, slide,
multiply and merge drop), and **7b** is mixdown and export.

Turn the tape on with `TAPE=true` ([configuration](configuration.md#the-tape)).
Every page's header then has a **Tape** tab beside Capture and Takes.

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

- **The name and the tempo** are two menus, each drawn as a pill with a ▾.
  The name (with the cassette) opens another tape or starts a new one. The
  tempo (with the ♩) shows the BPM and how many bars the loop is, and sets
  the bars. On a phone they stack as one capsule, the tempo reading "84 · 4"
  (BPM · bars); the full words are in its label for a screen reader, and show on hover on a computer.
- **⋯** holds what you do with this tape: clone it, mix it down, export its
  stems, delete a tape, or open this guide.
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
- **The bar,** along the foot of the page, is the tape's player. From the
  left:
  - **The reels** either side of an amber window. They turn with the
    playhead, and wind or rewind to a jump such as the loop's wrap. The
    window says where the tape is, large, as bar.beat, with the time beside
    it. Its lamp is ▶ playing, ■ stopped, or a red ● for a punch: steady
    while armed, blinking while recording. A level bar per track, in the
    track's colour, moves while it plays. Under them a line scrolls past
    naming the tape, its tempo, the loop, where it's playing and what's
    armed. In its place, the window says when it's counting in, mixing down
    or has no output.
  - **The keys:** **|◂** goes back to the loop's start (or, with Loop off,
    to the top of the tape), then **▶ / ■**, **⟲ Loop**, **● Rec** and the
    click **♩**.
  - **Catch**, orange, at the right end.
  - **Under them, the overview:** the whole tape, 20 minutes by default, with what's
    on each track and the loop in amber. It's a scrubber too. The box is what
    the lanes show: drag it to move along the tape. Tap anywhere to move the
    playhead there (to the nearest bar), and double-tap to go back to the
    loop. With it focused, ← and → move a bar.
  - **OUT**, at the end of the overview, chooses where the tape plays (8.10).
- **Four lanes**, one per track:
  - Each header has the track's number (in a ring of its colour where there's
    room, otherwise printed on the tape), its name on masking tape (tap it
    to select the track), its bus (A or B; tap to
    swap), **M** (mute, yellow when on), **S** (solo, blue when on) and its
    level. The track being recorded to is edged red.
  - In the lane: the bar lines, the clips and the playhead. Each clip is a
    block in the track's colour with its sound drawn as bars, lit where it
    has played, and labelled with where it came from (*aux*, *main*, a
    *take*), *repeat* when it plays the same audio as one before it, or
    *reversed*. A layer on top of another clip is fainter.
  - Tap a clip to open its sheet. Hold a clip, then drag, to slide it
    (7a). Tap an empty part of a lane to move the playhead there.
- **▶ / ■** plays and stops. **⟲ Loop** turns the loop on and off; off, the
  tape plays on to the end of what's recorded.
- **The drawers.** The bar's **Record ▴** and **Edit ▴** open a drawer
  above it, one at a time; the key's light is on while its drawer is open.
  The drawer pushes the lanes up rather than covering one, and its key, its
  **✕** or **Esc** closes it. Each device remembers which was open.
  - **Record · Catch** holds Record from, Catch the last 1, 2 or 4 bars,
    Layer or Replace, the passes, and Overdub on this device.
  - **Clipboard · Edit** holds the clipboard, Lift, Copy, Split and ×2 on
    the loop's bars, and what a slid clip snaps to.
  - While a clip is being aligned, its editor opens there instead.
- **Record from** chooses the input ● Rec, a catch and a free loop take
  from: main, ch1, ch2 or aux. ● Rec names it too, under its label, so you
  can see what it will record without looking down. While a track is armed
  or recording, the lit chip is the source it's recording, and changing it
  waits until that punch ends.
  - Each chip has a **meter**: the loudest moment of the last third of a
    second. The source with your instrument in it is the one that moves.
    Aux with nothing plugged in is exact silence, and reads empty.
  - **●** means clean: none of the tape's own playback is in it.
  - **○** means the tape is in it: ch1 hears bus A, ch2 hears bus B, and main
    hears both.
- **A catch that comes back silent or very quiet says so**: the toast turns
  amber and reads *it's silent: nothing came in* (digital silence) or *it's
  very quiet (peak −62 dB)*, with Undo. The clip's sheet says it too, and so
  does dropping or copying a silent stretch from the ribbon.
- **Catch** (in the bar) catches the last pass, and **Catch the last: 1 bar /
  2 / 4** catch the last bars, onto the selected track.
- **Passes** keeps the last six times round the loop; −1 is the newest.
- **On a phone,** upright or on its side, the bar is a **mini player**
  above the tabs: the reel window with where the tape is, **▶** and
  **Catch**, and a line along its top as far as the tape has got. A catch
  never waits for a scroll. Playing on this phone, its strip (and *Tap to
  play here*) sits on top. OUT is in the top bar.
- **Tap the mini player's window** to pull up **the player** over the page:
  the whole bar, large (**|◂ ▶ ⟲ Loop ● Rec**, the click, **Catch** and the
  overview), and under it **Record ▴** and **Edit ▴**, which show their
  drawer below them. **Down**, Back or **Esc** puts it away. Takes, Capture
  and a take's page have the same mini player and player.
- **On a phone,** with the player down, Record from, Catch the last, the
  passes, the clipboard and the edits are rows under the tracks, as they
  always were.
- **On a tablet or a computer** the tracks take the whole width and share
  the height of the window between the header and the bar; a drawer opening
  makes them shorter, and they scroll once they're as short as their heads.
  Narrower than 1000 px, **Record ▴** and **Edit ▴** sit beside OUT. On the
  1024 × 600 bench the header is one row, the page switch at its left.
- **With a keyboard:** **Space** plays and stops, **R** is ● Rec, **L** is
  ⟲ Loop, **K** the click, **1–4** or **↑ ↓** choose the track, and
  **⌘Z / Ctrl-Z** undoes (with **⇧** to redo). Holding a key doesn't repeat
  it, and none of them fire while you're typing or a sheet is open.
- **After a sleep.** Lock a tablet and wake it, and the page asks the Pi
  again at once: no refresh. If the Pi doesn't answer, a small
  **Reconnecting…** note shows at the top (not for a blink) and goes when it
  does. The tape page, the main page, Takes and the take page all do this.

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
   the tempo pill and choose the other. Nothing is stretched,
   only relabelled.

**From a take.** On a take page, choose **Send to tape**; with a selection
it sends that, without one the whole take. If no tape is loaded, a new one is
made. The line under the buttons says what will happen. It depends on whether
the take has a tempo (the *bpm* by its name, from the MIDI clock or typed in):

- **A take with a tempo** goes on whole, as one clip on track 1 with the loop
  off, and its bar 1 (the take's downbeat) on a bar line of the tape. Whatever
  comes before the downbeat, a count-in say, goes in the bar before it, so
  nothing is cut off. A selection goes on the same bar grid: it sits as far
  past a bar line as it does in the take.
  - On an empty tape, the tape takes the take's tempo. There's no loop; set
    one on the ruler when you want it.
  - On a tape with the same tempo (within 0.1%), the take's bar 1 goes on the
    first bar line at or after the playhead, replacing what's under it on
    track 1.
  - On a tape with another tempo, it goes at the playhead as it is. Nothing
    is stretched, so it won't keep to the bar lines; the toast says so.
  The playhead moves to the start of what was sent, unless the tape is
  playing.
- **A take with no tempo** (a phone recording, a free jam): on an empty tape,
  a selection of up to a minute becomes the first loop, on track 1. Its length
  sets the tempo, the number of bars that puts it nearest your last tape's
  tempo (or 90 BPM). The loop turns on. A selection too short to be 20–400
  BPM is refused. Anything longer than a minute is laid down as one clip with
  the loop off, and the tape gets no tempo. On a tape that already has audio,
  it lands at the playhead on track 1, replacing what's there.

A track holds `TAPE_LENGTH_S` seconds, 20 minutes by default. A send that
doesn't fit is refused, saying the limit and the setting.

**From a tempo.** On an empty tape, type a BPM and a number of bars and tap
**Set**. The loop is that long and empty, ready to catch into, and the
**♩ click** plays on every beat until the first catch. The BPM starts at the
tempo you were last playing: the clipboard's or your newest take's, whichever
is newer.

The tempo is fixed once the tape has audio, because nothing is ever stretched.

**Checks — steps 6a and 6c:**

- [demo] With no other tapes, on a take page select 2 seconds and choose
  **Send to tape** → a toast says it was sent. On the tape page,
  track 1 holds the clip, the tempo reads *120.0 BPM · 1 bar*, and ⟲ Loop
  is on.
- [demo] Press ▶ → the playhead goes round the loop, the position counts
  bars, and the passes row fills, one button a pass.
- [demo] Give a take a BPM, and the line under its buttons reads *Sends the
  whole take at … BPM, bar 1 on a tape bar line*. Send it to an empty tape →
  the tape's tempo is the take's, Loop is off, and one clip runs the take's
  length. Send it again to track 2 → it lands on a bar line, and a take at
  another tempo goes at the playhead with a warning.
- [rig] Send last night's long take to a new tape and press ▶ → the whole
  take plays through, and its bars sit on the tape's bar lines.
- [demo] Make a new tape, set 90 BPM and 4 bars → it reads *90.0 BPM · 4
  bars*, and the lanes show four empty bars. Press ▶ → a click on every
  beat, higher on the bar. After the first catch, the click goes off and the
  tempo can't be changed.
- [demo] Make a new tape, choose *aux*, tap on a kick, then tap about 2.5 s
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

**Rename.** *Rename this tape…*, under ⋯, gives the loaded tape a new name.
It shows at once on every device, and isn't a step in undo.

**Clone and delete.** *Clone this tape*, under ⋯, makes a copy that
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
- **While it records,** the track's lane shows it in red from the bar it
  started at, with the source's level along it, so you can see something is
  coming in. Before the tape reaches that bar, a dashed red line marks it.
  With the loop on, the red starts again at In each time round (*pass 2*,
  *pass 3*). It's a sketch from the meter; the real waveform arrives with
  the clip.
- The toast has **Cancel** while it records, and **Undo** once kept.

**The clipboard (6d)** holds what you last copied or lifted -- from a take,
the ribbon or a tape (7a, [below](#85-editing-like-an-op-1)) -- and keeps it
through a restart. A copy can be as long as a track. Its row on the tape
page shows how long it is and where it came from:

- **Tap it** to hear it (its first minute).
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
- **Zoom and pan** the lanes and the ruler: pinch with two fingers, drag
  sideways with one (a vertical drag still scrolls the page), or on a
  computer scroll sideways and hold ⌘ or Ctrl to zoom. A playhead that runs
  out of view -- jamming on past Out with the loop off -- pages the view
  along. **Fit**, by the ruler, puts it back to the loop.
- **A clip's sheet** has *Repeat to the loop's end*: copies of the clip end
  to end, wherever its layer is free -- one bar through four.
- **Tap a track's number again** for its sheet: its name, level and pan.

**Checks — steps 6a and 6c:**

- [demo] Send 2 s to an empty tape and press ▶. Choose *aux*, select track 2,
  wait four passes, then tap **−3** → a 2.0 s clip lands on track 2 at bar 1,
  and the toast says *Caught 2.0 s from aux onto track 2*.
- [demo] Catch from *ch1* → the toast warns that the tape was in that source
  too.
- [demo] With the tape playing, the meters on *main* and *ch1* move and
  *ch2*'s stays empty (bus B is silent). Choose *ch2* and tap **1 bar** → the
  toast is amber: *it's silent: nothing came in*. ● Rec has *ch2* under it.
- [rig] Play the Bento into jack 2: the *ch2* meter moves, and *aux*'s stays
  empty until the instrument on aux plays.
- [demo] On a 4-bar loop, play for a pass, then tap **1 bar** → a one-bar
  clip lands on the bar that just finished.
- [demo] Tap a clip, choose **Remove**, then **Undo** in the toast → the clip
  is back. ↶ and ↷ step through the same history.
- [demo] Open the tape page on two devices and mute a track on one → the
  other shows it within a second.
- [demo] Under ⋯ choose **Rename this tape…**, type a new name and tap Save →
  the title and the tape list show it, and a second device shows it within a
  second. An empty name can't be saved, and ↶ doesn't undo a rename.
- [demo] Clone a tape and open the clone, delete the original, then play the
  clone → it plays fully.
- [demo] Restart Hindsight → the tape that was loaded is loaded again, with
  its undo.
- [demo] With a 1-bar loop playing, select track 2, tap ●, wait three passes,
  tap ● → *Kept 1 bar from aux on track 2*: the last full pass.
- [demo] Stop. Select track 3, tap ● (*● Armed 3*, with *aux* under it), press ▶ → the position
  reads *count-in 1 of 4…4 of 4* over a bar of click, then the tape plays;
  after two passes press ■ → *Kept 1 bar*: the last full pass, on track 3.
- [demo] Arm, press ▶, and press ■ during the count-in → nothing is kept,
  and nothing complains.
- [rig] Arm track 3 with the guitar in aux, press ▶, play over the count-in
  and two passes, press ■ → the guitar is on track 3, in time.
- [demo] On a take page select about 2 seconds and choose **More → Copy**,
  then on an empty tape tap **Drop** three times → the first is the loop,
  and the next two lie end to end after it. Undo takes them back one at a
  time.
- [demo] Tap the clipboard → you hear it; tap again → it stops.
- [demo] Choose **Replace**, catch a pass onto a track that has audio →
  the old audio under it is gone, not layered.
- [demo] Hold on the ruler, drag across two bars → *Looping 2 bars*; the tape
  loops those.
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

### 8.5 Editing like an OP-1

*Step 7a.* The selection is the loop: hold and drag on the ruler to set it.
Under the clipboard, **Track N / All** says what Lift and Copy take: the
loop's bars on the selected track, or on all four, kept apart.

| Do | Gets you |
|---|---|
| **Lift** | Cuts the selection into the clipboard, leaving silence. Undo puts it back |
| **Copy** | Copies it to the clipboard, leaving the tape alone |
| **Drop** | Pastes the clipboard at the playhead, from the selected track down, replacing what's there, and moves the playhead to its end. A four-track clipboard lands on all four, silence and all. **Drop, drop, drop** lays copies end to end — the quickest way to turn four bars into sixteen |
| **Merge** | Beside Drop when the clipboard has more than one track: drops them all onto the selected track, layered, each clip at its own level. The tracks' level, pan and mutes are the mixer's, so they don't come with it |
| **Split** | Cuts the clips on the selected track in two at the playhead, where they're heard (a nudged clip is cut where it sounds) |
| **Join** | In a clip's sheet: joins it and the half split from it back into one |
| **Slide** | Hold a clip, then drag it along its track, or up or down onto another: once your finger is half a lane over, that lane is outlined and the clip goes there, and that track is selected. A clip on the grid lands on the nearest bar, beat or eighth (**Slide snaps to**); one off it moves by whole steps, keeping its offset. It goes on top of anything already there |
| **Trim** | Tap a clip, then close its sheet: it stays picked, with a grip inside each edge. Drag a grip to move that edge, on the **Slide snaps to** grid (hold ⌥ to move it freely). Trimming the start keeps the audio where it was played. While you drag, the audio the edge can reach shows faintly past it; the grip turns amber where it can go no further. A clip too short for grips has **Start here** and **End here** in its sheet, which trim it to the playhead. Escape, or a tap on an empty part of a lane, lets go of it |
| **×2** | Doubles the loop, copying what's in it over what follows |
| **Reverse** | In a clip's sheet: plays it backwards. Tap again (*Play forwards*) to turn it back |
| **Share as WAV** | In a clip's sheet: sends just that clip, at its level, to another app; a clip over a minute downloads instead |

Nothing is cut out of the audio. A clip is a window onto a recording, so an
edit only moves windows, and each one is a single undo. A clip dropped or
copied from a take keeps 2 seconds of it either side (`TAPE_HANDLE_S`), so
a trimmed edge can be dragged back out that far. A catch or a punch keeps
2 seconds before it, but after it only what had reached the buffer when it
was caught, often a few milliseconds, so its end mostly trims inward. So
does a clip made before there were handles, or an edge where its recording
starts or ends. Where an edit leaves
two clips meeting, they're crossfaded over a few milliseconds, so there's no
click.

**Clone** in the tape browser makes a safety copy of a whole tape before you
try something. It costs no disk space.

**Checks — step 7a:**

- [demo] Loop 4 bars, choose **All**, **Lift**, tap bar 1 on the ruler, then
  **Drop** three times → twelve bars of the same four, with no clicks where
  the copies meet.
- [demo] Put the playhead inside a clip, **Split**, hold the second half and
  slide it a bar later, then ↶ twice → the clip is whole again.
- [demo] Tap a clip → its sheet opens. Drag quickly across a clip → the
  lanes pan and the clip stays where it was.
- [demo] Hold a clip until a dashed outline shows where it would land, drag
  it a bar later and let go → it's a bar later; ↶ → it's back. Hold one and
  let go without moving → nothing moves.
- [demo] Drop 4 bars from the middle of a take, tap the clip, close its
  sheet → a grip shows inside each edge. Drag the right grip a bar left →
  the clip ends a bar sooner, and the toast says where; ↶ → it's back.
- [demo] With **Slide snaps to** on *Beat*, drag the left grip two beats
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
- [demo] Zoom out until a clip is narrow → no grips; its sheet's **Start
  here** and **End here** trim it to the playhead.
- [demo] Split a clip, tap either half, **Join the split** → one clip.
- [demo] **×2** on a 2-bar loop → a 4-bar loop whose second half is a copy of
  the first.
- [demo] Tap a clip, **Reverse** → its waveform turns round and it plays
  backwards; **Play forwards** turns it back.
- [demo] Tap a clip, **Share as WAV** → the share sheet (or a download)
  offers *<tape> track 1.wav*.
- [demo] Copy **All** with audio on two tracks, select track 3, **Merge** →
  both parts on track 3, one above the other.
- [demo] Clone a tape, delete the original, then play the clone → it plays
  fully; no audio was lost.
- [demo] Copy a selection on a take page, then Drop it on a tape → it's
  there.

**Lining clips up exactly:**

Sliding gets a clip near. To put it right to the sample, zoom the tape in
(pinch, or ⌘ or Ctrl with the wheel) until each lane draws single samples.
Every lane shows its detail at once, so you can compare a hit on one track
with a hit on another by eye. Then tap a clip and choose **Align**. The sheet
closes and the editor bar opens on that clip, with the view centred on the
clip's first hit. It finds that hit from the clip's start, within 60 ms. If
there's none, it uses the start, and the readout says *start*; Hit → Grid and
Hit → Track then say there's no hit and leave the clip where it is. ZOOM,
POSITION and the steps still move it.

- **ZOOM and POSITION** work as they do on the take page, but POSITION moves
  the whole clip. Zoomed out it travels bars; zoomed in it moves single
  samples. A whole drag is one undo.
- **◂ ▸** move the clip 1 ms, or one sample when you're zoomed right in. Each
  step is one undo.
- **▶** plays from a second before the hit, and pauses.
- **Hit → Grid** moves the clip so its first hit lands on the nearest line of
  the *Snap* setting, or the nearest beat with Snap off. It's hidden when the
  tape has no tempo. Use it for a catch that was played at the tape's tempo.
- **The track picker and Hit → Track** are for an overdub. Pick the track the
  part was played over, then press **Hit → Track**: the clip moves so its hit
  lands on the nearest hit of that track, within 60 ms, at any zoom. A hit
  right at the start of a clip on that track counts, so a rushed part finds
  the loop's first kick. If that track has nothing within 60 ms, or no hit
  there, or the clip has no hit of its own, it says so and leaves the clip
  where it is. Tap the picked track's key again to unpick it.
- **The readout** gives the hit's time to the sample and how far it is from
  the nearest beat (*+2.5 ms from 5.1*). Once Hit → Track has found a hit on
  a track, it also says how far the clip's hit is from that one (*−1.3 ms
  from track 1*).
- **Done**, or Escape, closes the editor.
- **On a computer,** the wheel over the lanes moves the clip; ⌘ or Ctrl with
  the wheel zooms; ← → step; Shift steps ten.

A clip's nudge is kept and counted. A clip sounds at its place plus its
nudge, so that's where Align measures from and moves. Hit → Grid and
Hit → Track change the place, and leave the nudge as it was. A move that
would go past the start or end of the tape stops there. If that stops
Hit → Grid or Hit → Track short, it says so (*The tape starts here*).

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

### 8.6 Mixdown and export

*Step 7b.* Both are under the tape's ⋯.

- **Mix down the loop** plays the loop's bars once, or **Mix down the whole
  tape** plays from bar 1 to the end of the last clip. Then the tape stops,
  back where it started, and the recording keeps going for two seconds so
  reverb and delay ring out
  ([`TAPE_MIXDOWN_TAIL_S`](configuration.md#the-tape)).
  - What came out of the mixer is saved as a take. The Sidekick's FX and
    anything you played live over the tape are in it.
  - The take is labelled with the tape's name and has its tempo, with bar 1
    at its start.
  - On the takes page, a tape's mixdowns fold into the newest one, which
    wears **MIX ×** and how many there are; the earlier ones are listed in
    its cassette (§3.1).
  - The loop is ignored and the click is silent while it plays. The readout
    shows how far it's got, then *letting it ring out*. **■** cancels it
    until then, and nothing is saved.
  - If the Pi falls behind while it plays, nothing is saved rather than a
    take with a gap in it; mix down again.
  - It needs the tape playing through the Sidekick and lined up (the dot
    amber or green). It also has to fit in the recording buffer:
    `RING_SECONDS` less the tail and five seconds.
  - To share a song, mix it down and share the take.
- **Export stems** downloads a zip:
  - a 32-bit float WAV for each track with audio, each from bar 1 to the end of
    the last clip on any track. They're all the same length, so they line
    up when dropped at the start of a DAW project. Each has its track's
    level and pan, but not its mute or solo, and no FX: the FX happen in the
    Sidekick.
  - a `.mid` with the tempo, 4/4, and the loop's In and Out as markers.

**Checks — step 7b:**

- [demo] Mix down a 1-bar loop → the readout counts *mixing down … of …*.
  A few seconds later the toast reads *Mixed down as a take*, and **Open
  it** shows a take of that bar plus 2 seconds, labelled with the tape's
  name, at its tempo.
- [demo] Start a mixdown and press ■ → *The mixdown didn't save*, and no
  take appears.
- [demo] Mix the same tape down three times → the takes page shows one spine
  for it, wearing **MIX ×3**, and its cassette lists the two earlier mixes.
- [rig] Mix down with an FX on channel 1 → the take has the FX.
- [demo] Export stems → a zip with a WAV for each track with audio, all the
  same length, plus a `.mid` at the tape's tempo. In a DAW they line up at
  bar 1.

### 8.7 The Bento follows the tape

*Step 8a: the tape leads.* Plug the Bento's USB into the Pi's hub, set
`TAPE_CLOCK=lead`, and name the Bento in `TAPE_CLOCK_OUT`
([configuration](configuration.md#the-tapes-clock)). The tape then sends it
MIDI clock at the tape's tempo, so its sequences line up with the tape:

- **While the tape stands,** the clock runs on at its tempo, so the Bento
  knows the tempo before it starts, through a count-in too.
- **▶ from bar 1** sends Start, so the Bento starts with the tape. **▶ from
  anywhere else** says where (Song Position) and sends Continue, on the next
  sixteenth.
- **The loop coming round** says where again (bar 1 of the loop), without
  stopping, so a follower that understands it lands on the right bar.
- **A locate while playing, or a new tempo,** stops the Bento and starts it
  again where the tape is now.
- **■** sends Stop, and so does Hindsight stopping.
- **A Bento plugged in while the tape plays** is told where the tape is, and
  joins in at the next sixteenth.
- The pulses are timed to arrive with the audio they belong to. If the Bento
  is always a little early or late, nudge it: `TAPE_CLOCK_OUT=bento:-4`
  sends it everything 4 ms earlier.
- A free loop's odd tempo, 83.73 BPM say, is fine: a follower takes what
  arrives.

Under the transport, *clock → Bento* says who's following, with **●** while
they're running. In the demo, `TAPE_CLOCK=lead` leads a stand-in follower
that says what tempo it hears.

**Follow mode,** where the tape follows the Bento's clock by changing its
speed, comes later.

**Checks — step 8:**

- [demo] Start the demo with `TAPE_CLOCK=lead`, set a tape to 96 BPM and
  press ▶ → under the transport, *clock → Demo follower ● · hears 96 BPM*.
  Press ■ → the ● goes.
- [rig] Press ▶ on the tape → the Bento starts in time; ■ stops it.
- [rig] Loop four bars for two minutes → the Bento stays in time with the
  tape, and lands on bar 1 each time the loop comes round.
- [rig] Locate to bar 3 and press ▶ → the Bento starts at bar 3.
- [rig] In follow mode, start the Bento → the tape plays in time with it for
  five minutes without drifting. *(Later.)*

### 8.8 Overdubbing away from the rig

**🎧 Overdub on this device** plays the tape on your phone, tablet or laptop
instead of in the jam room, and records a part over it that goes back onto
the tape where you played it. Upstairs with headphones while the house
settles, say, with the jam room silent.

1. Select the track the part goes on (and **Layer** or **Replace**), then tap
   **🎧 Overdub on this device**. The Pi sends the loop as it sounds now,
   every track at its level, mutes and solos as they are, without the
   Sidekick's EQ or FX. **The whole tape** plays it once from the start
   instead; **♩ Click** adds a click.
2. **▶ Listen** plays it round. **● Record** starts it if it isn't playing,
   and records you over it with the phone's mic or whatever input you choose,
   streaming to the Pi as you play, as the Phone button does.
3. **■ Stop and keep** keeps what a punch would: the last full pass of the
   loop; or, if you didn't play a whole pass, the bars from the first bar
   line to the last, up to a loop's length. Over the whole tape it keeps the
   bars you played. It goes on the track at the bars you played them over,
   with **Undo** right there in the sheet. The whole recording is in the
   takes list too. Closing the sheet mid-recording keeps it as if you'd
   stopped; if the loop was moved meanwhile, the part stays a take.

**Timing.** What you play reaches the recording later than you heard the
tape: the phone's output delay plus its input delay, the *round trip*. The
sheet shows the figure it's using. The browser's own guess is often too low;
**Calibrate** measures it by playing six clicks through the speaker and
hearing them through the mic (headphones off, somewhere quiet). Wired
headphones add almost nothing to it, so calibrate once and use them.
Bluetooth headphones add a delay the calibration can't hear, since the mic
can't hear inside them: set it with **−5** and **+5** by ear (often 150–250 ms
more). A part that still lands early or late can be nudged in its clip sheet.
Headphones matter: over a speaker the mic records the tape too. Recording
needs the HTTPS address, as the Phone button does; listening works anywhere.

**Checks — overdubbing:**

- [demo] With a 1-bar loop, select track 2 and open **🎧 Overdub on this
  device** → it says it plays *the loop (1 bar)*, onto track 2. **● Record**
  for five seconds, then **■ Stop and keep** → *Kept 1 bar from this device on
  track 2*, at bar 1, labelled *phone*.
- [demo] Choose **The whole tape** → it says *the whole tape, once*.
- [phone] Calibrate with the phone's speaker → a round trip somewhere around
  50–150 ms. Then overdub with wired headphones, clapping on the beat → the
  claps land on the beat (within a few milliseconds; nudge if not).

### 8.9 Tricks and tape speed

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

### 8.10 Taking the tape upstairs

The tape can play on your phone as a backing track, anywhere in the house.
Tap **OUT** in the tape's header and choose **This phone**: the jam room goes
silent, and the tape plays here about 0.8 s behind. Everything on the tape
works as usual — play, locate, the loop, mute, solo, levels — and the
playhead and meters are moved back to match what you hear, so a mute shows
`in 0.8 s` until you hear it.

Rec and Catch wait for the jam room: you hear the tape late up here, so a pass
would land off the beat. For an idea, use **Overdub on this device** (8.8);
in This phone mode its Listen and Record stop the tape here, so you don't
hear it twice (in Both they leave the jam room playing).
When you're back downstairs, tap **Play in the jam room** on the laptop or the
bench, or choose **Jam room** under OUT: the tape plays on from the same spot.

**Both** plays the jam room as usual and sends the phone a copy, for when
someone is listening elsewhere while you record.

One phone at a time. If the Wi-Fi drops for 6 s, the tape stops where it was;
the page reconnects and plays on, if it's back within 30 s and the tape is
still stopped. If the tape has gone back to the jam room meanwhile, the phone
lets it go. If the sound stops when the screen locks, tap **Tap to play here**
on the strip across the top of the bar.

**Moving between pages** keeps the tape on the phone. Tape, Takes and
Capture each join the stream again as they open, and the tape plays on in
the meantime. Most phones hold the sound back until you tap, so the bar
says *tap ▶ to play here* (on the tape page, the strip says *Still on this
phone*): tap **▶** or **Tap to play here** and it's heard again. That tap
never stops the tape. A take's page doesn't play the tape: opening a take
stops it after 6 s, where it was, and coming back finds it there. Playing a
take in the bar on Takes or Capture stops it too, in This phone mode, so
the phone never plays both.

## 9. Tips in the app

*Step 3 for takes, step 6 for tapes.*

**How you get help:**

- **On a computer,** every button has a tooltip.
- **On a phone,** tap **?** in the header to enter help mode, then tap
  anything to read its tip instead of using it. The mini player's window
  is the one exception: it shows its tip and still pulls the player up, so
  its keys can be read too; **Down** brings **?** back.
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
| Hindsight | Back to Capture, from anywhere |
| Capture (tab) | The ribbon, the meters and Capture. The lamp is the ring: green while it records |
| Takes (tab) | Every take, to search, filter, sort and open |
| Tape (tab) | The tape: layer loops caught from what you just played |
| Capture | Save the last 30 s, 2 m, 7 m or all of what you just played as a take |
| Flag now | Mark this moment. Any take that includes it gets a flag here |
| Ribbon | The last 15 minutes, recent end stretched. Hold and drag to select a span; tap a flag for its options |
| Save as take (ribbon) | Save exactly the span you selected on the ribbon as a take |
| × (ribbon) | Forget the span selected on the ribbon |
| Save from here to now | Save a take that starts at this flag and runs to now |
| Delete flag (ribbon) | Remove this flag. Takes saved later won't carry it |
| Phone | Record from this phone's mic or a plugged-in input, straight into Hindsight |
| All takes | Every take, on a page of its own, to search, filter and sort |
| Search | Find a take by its name, its time or its tempo |
| Filters | Show only starred takes, takes with MIDI, takes from a phone, or tape mixdowns |
| Tags | Show only the takes with this tag, or only the untagged. Press the lit one again to see everything |
| Edit tags | Make, rename, recolor or delete tags. They are the same on every device |
| Newest / Longest / By tag | Newest groups the takes by the day they were made; Longest puts the longest first; By tag gives each tag its own group |
| Tag (take) | Give this take a tag and its cassette wears the tag's color. Press the lit tag again to take it off |
| Cuts | The takes saved from parts of this one. They fold in here to keep the shelf short; tap one to see it |
| Earlier mixes | This tape's earlier mixdowns. The newest stands on the shelf for them all; tap one to see it |
| ‹ (folded take) | Back to the take this one is folded into on the shelf |
| Open | Open the take to select, loop, save or share part of it |
| Select | Pick several takes to star, export or delete together. Holding a take does the same |
| ★ Star (selecting) | Star the picked takes, or unstar them if they all are |
| Export | One zip of the picked takes: each WAV, its name and flags, and its MIDI |
| Delete (selecting) | Move the picked takes to the trash |
| Done | Stop selecting |
| Restore | Put this take back in the list, starred |
| × (Recently deleted) | Delete this take for good |
| Empty | Delete everything in the trash for good |
| ★ | Star the takes worth keeping: they are pruned last, and the Starred filter shows them alone |
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
| Overview | The whole take, in the bar. Tap to move the playhead there; drag the window to move along it; double-tap to see it all. With it focused, ← → move a second |
| Waveform | Drag to move along, pinch to zoom. Hold, then drag, to select. Tap to move the playhead; tap twice to flag |
| ▶ | Play from the playhead |
| To In (take) | Back to In; with nothing selected, to the start of the take |
| ⟲ Loop (bar) | Loop what’s in the bar: the tape’s loop, or a take’s selection (the whole take without one) |
| ⏏ (bar) | Stop the take in the bar and put the tape back in it |
| Open › (bar) | Open what’s in the bar on its own page: the tape, or the take |
| The bar’s strip | The whole tape or take: tap or drag to move the playhead. With it focused, ← → step and Space plays |
| The mini player (phone) | On a phone: the player, pulled up over the page — the whole bar, and on the tape its drawers. Down, Back or Esc puts it away |
| ⟲ Loop | Repeat the selection instead of playing straight through |
| In | Start the selection at the playhead |
| Out | End the selection at the playhead |
| ⚑ | Drop a flag at the playhead |
| ◂⚑ ⚑▸ | Jump to the previous or next flag |
| Delete flag | Remove this flag |
| ◂ ▸ beside In and Out | Move that end of the selection to the next snap line, or by 10 ms |
| Bar 1 ◂ ▸ | Move bar 1 by 10 ms, or by the Snap step with Snap on. It stays here once the take has a tempo |
| Bar 1 time | Tap to place bar 1 exactly, in the editor |
| Set to playhead | Put bar 1 where the playhead is |
| Clear | Forget the selection. The take itself is untouched |
| In / Out time | Tap to place it exactly: the view centres on it and the editor opens. Tap bar 1 on the ruler to place the downbeat |
| Done | Close the editor. Esc does too |
| ZOOM | Drag sideways to zoom about the point: right is closer |
| POSITION | Drag sideways to move the point: zoomed out it travels bars, zoomed in it moves samples |
| Attack | Move the point to the start of the strongest hit within reach; zoom out a little if it finds none |
| Zero | Move the point to the nearest zero crossing, so the cut doesn't click |
| Grid | Move the point to the nearest line of the Snap setting, or the nearest beat with Snap off |
| ◂ ▸ in the editor | One step: a millisecond, or a sample when zoomed right in. Keys: ← →, with ⇧ for ten |
| ▶ in the editor | Play from the point (from a second before Out), or pause |
| Seam | Show the loop's end running into its start, to see a click or a stutter. Tap a half to move that side |
| Snap | Make the selection, In, Out and the nudges land on bars, beats or 8ths |
| Practice speed | Slow down or speed up without changing pitch |
| Save as take | Make a new take of just the selection |
| Name (Save as take) | Name the new take, then Save. On the takes page it folds in with this take. Cancel saves nothing |
| Share | Send the selection from your phone as an MP3 |
| More | The DAW bundle, the WAV and MIDI downloads, and delete |
| DAW bundle | The selection's WAV and MIDI, lined up, in a zip for a DAW |
| Notes | Watch the take's MIDI rise out of a keyboard as it plays |
| Lane | Tap for this lane's menu: collapse, show as drums or notes, or hide |
| Send to tape | Put the take, or the selection, on the loaded tape: by its tempo and downbeat if it has them, else at the playhead or as an empty tape's first loop |
| Tape name | Your tapes: load one, or make a new one |
| ⋯ (tape) | This tape: rename it, clone it, mix it down, export its stems, or delete a tape |
| A tape in the list | Load this tape: the transport plays the loaded one |
| New tape | Start an empty tape. Its first loop sets the tempo |
| Rename tape | Give this tape a new name |
| Delete a tape | Delete another tape. Audio it shares with others stays |
| BPM, Bars (empty tape) | Start from a tempo instead of a first loop |
| ↶ ↷ (tape) | Undo or redo the last change to the tape: up to 100 steps. Keys: ⌘Z or Ctrl-Z, with ⇧ to redo |
| Tape overview | The whole tape, in the bar: what’s on each track, the loop in amber. Drag the box to move what the lanes show; tap to move the playhead there; double-tap to go back to the loop. With it focused, ← → move a bar |
| A lane | Tap a clip for its sheet; it stays picked, and dragging a picked clip's edges trims it. Hold a clip, then drag, to slide it along its track or onto another. Tap elsewhere to move the playhead there. Drag sideways to pan, pinch to zoom (⌘ or Ctrl with a scroll on a computer). A punch shows in red as it records |
| A track header | Tap the number to pick the track catches go onto. Keys: 1–4, or ↑ ↓ |
| M, S | Mute this track, or solo it: only soloed tracks play |
| Track level | The track's level into its bus, -30 to +6 dB. Tracks start at -6 |
| ▶ (tape) | Play or stop the tape. Key: Space |
| To the loop’s start (tape) | Back to the loop’s start; with Loop off, to the top of the tape |
| Record ▴ (tape) | Record from, Catch the last 1, 2 or 4 bars, Layer or Replace, the passes, and Overdub on this device. Esc closes it |
| Edit ▴ (tape) | The clipboard and Drop, Lift, Copy, Split and ×2 on the loop’s bars, and what a slid clip snaps to. Esc closes it |
| Ruler (tape) | Tap: the playhead to that bar. Hold, then drag: loop those bars. Drag sideways to pan, pinch to zoom |
| Fit | Back to the loop and a bar either side, after a pinch, a pan, or the playhead paging the view along |
| Layer / Replace | Onto audio already there: layer on top of it, or replace it |
| Clipboard | What you copied last, from a take or the ribbon. Tap to hear it |
| × (clipboard) | Empty the clipboard |
| Repeat to the loop’s end | Copies of this clip end to end, to the end of the loop: one bar through four |
| Track name | What’s on this track, for you: chords, bass… |
| Pan | Where this track sits between left and right |
| Copy (ribbon) | Put the span you selected on the clipboard, to drop onto a tape |
| ● Rec (tape) | Records from the source it names (chosen under Record from). Stopped: arm the selected track, then ▶ counts in a bar. Playing: record from the next bar. Tap again to keep it. Key: R |
| RECORDING | Lit while a punch is recording onto the tape |
| ♩ Click | A click on every beat, on bus A. On by itself only while the tape is empty. Key: K |
| Tap (empty tape) | Tap where the loop starts, then where it comes round: each tap snaps to the strongest attack near it |
| Tempo (tape) | Call the loop more bars or fewer: the same length, so nothing is stretched |
| ⟲ Loop (tape) | Loop the bracket, or play on to the end of what’s recorded. Key: L |
| 1 bar, 2, 4 | Catch the last bars you played, ending on the last bar line, where they were played |
| Clip level | This clip's level within its track |
| Nudge | Move the clip a few milliseconds, for a part a little early or late |
| Reverse (clip) | Play this clip backwards, or forwards again. Undo puts it back |
| Share as WAV (clip) | Send just this clip, at its level, to another app; a long one downloads |
| Remove (clip) | Take this clip off the tape. Undo brings it back |
| Start here, End here (clip) | Trim the clip's start or end to the playhead, for a clip too short to drag. What's trimmed is kept: drag or trim back out |
| Align | Line the clip up to the sample: the editor bar opens on its first hit |
| Done | Close the editor. Esc does too |
| ZOOM on the tape | Drag sideways to zoom about the clip’s first hit: right is closer |
| POSITION on the tape | Drag sideways to move the whole clip: zoomed out it travels bars, zoomed in it moves samples |
| ◂ ▸ on the tape | Move the clip a millisecond, or a sample when zoomed right in |
| ▶ on the tape | Play from a second before the hit, or pause |
| Hit → Grid | Move the clip so its first hit lands on the nearest line of the Snap setting, or the nearest beat with Snap off |
| Track picker | Choose the track to line this clip up against |
| Hit → Track | Move the clip so its hit lands on the nearest hit of the chosen track |
| Catch | Catch the last time round the loop onto the selected track. The last 1, 2 or 4 bars are under Record |
| Passes | Every time round the loop, kept. Tap one to put it on the selected track |
| Track / All (edit) | What Lift and Copy take: the loop’s bars on the selected track, or on all four, kept apart |
| Lift | Cut the loop’s bars into the clipboard, leaving silence |
| Copy | Put the selection on the clipboard, to drop onto a tape |
| Drop | The clipboard onto the selected track at the playhead, replacing what’s there. Drop again to lay another copy after it |
| Merge drop | Drop every track on the clipboard onto the selected one, layered, each clip at its own level |
| Split | Cut the clips on the selected track in two at the playhead |
| Join | Join this clip and the half that was split from it back into one |
| Multiply | Double the loop, copying what's in it over what follows |
| Slide snaps to | Where a clip you slide can land: on a bar, a beat, an eighth, or anywhere |
| Clone | Copy this whole tape. Costs no disk space |
| Mix down | Play the loop, or the whole tape, once and save what came out of the mixer as a take: FX and live playing included |
| Export stems | Download a zip with a WAV per track from bar 1, and a .mid with the tempo, for a DAW |
| Bus A / B | Which Sidekick channel this track plays through, for its EQ and FX |
| Source chip | Which input ● Rec and a catch take from; its meter shows what is coming in. ● clean: none of the tape is in it. ○ the tape is in it too |
| 🎧 Overdub on this device | Play the tape here, not in the jam room, and record a part over it that goes onto the selected track where you played it |
| The loop / The whole tape (overdub) | Play the loop round and round, or the whole tape once |
| ♩ Click (overdub) | A click on every beat, in what plays here |
| Round trip (overdub) | How late what you play reaches the recording, from hearing the tape: a part lands that much earlier. −5 and +5 move it by hand, e.g. for Bluetooth headphones |
| Calibrate (overdub) | Measure the round trip: six clicks through the speaker, heard through the mic. Headphones off, somewhere quiet |
| ▶ Listen (overdub) | Play it here, without recording |
| ● Record (overdub) | Record over it; Stop keeps the last full pass, as a punch does, and puts it on the track. The recording is saved as a take too |
| Clock → (tape) | Who follows the tape's MIDI clock (TAPE_CLOCK=lead); ● while they're running |
| Lock dot | How playback and recording line up. Green: to the sample. Amber: by the clocks, nudge if off. Red: not yet |
| OUT (tape) | Where the tape plays: the jam room, this phone, or both. Switching keeps it rolling from the same spot |
| Jam room / This phone / Both | The jam room plays through the Sidekick and records; this phone plays a backing track here, about 0.8 s behind; both does both |
| Play in the jam room | Take the tape back from the phone: the jam room plays it from the same spot, and Rec and Catch come back |

## 10. When something's off

| You see | It means | Do |
|---|---|---|
| The dot by ↶ is amber | Playback and recording are lined up only by the clocks, to a few milliseconds; it locks once the tape plays something with a clear attack on bus A or B | Play the tape for a few seconds, with drums or another percussive part on it. Catches still work meanwhile; nudge one if it's off |
| The dot by ↶ is red | Nothing is lined up yet: the tape hasn't played since Hindsight started, or there's no output | Press ▶. If ▶ reads *no output*, check the Sidekick is on and plugged in |
| A source chip shows ○ | The tape is playing through that channel, so catching from it also records the tape | Catch from aux, or move the track to the other bus |
| A new clip is a flat line, and the toast said *it's silent: nothing came in* | It was recorded from a source with nothing in it, usually aux with nothing plugged in. ● Rec records from the lit chip under **Record from** | Undo, tap the chip whose meter moves when you play, and record again |
| "Too long for the ring" on Mixdown | The selection is longer than the last 15 minutes can hold | Mix down in parts, or raise `RING_SECONDS` |
| "…a tape track holds 20 minutes" | What you sent is longer than a track, or would run past its end from where it lands | Send a shorter part, lift something, or raise `TAPE_LENGTH_S` |
| *Phone* says the microphone needs a secure page | You're on the plain `http://` address | Use the HTTPS address from `tailscale serve` |
| *Reconnecting…* at the top of a page | The page can't reach the Pi: it's off or restarting, or the tablet's Wi-Fi is still waking up | Nothing: it tries again every few seconds and catches up on its own; no refresh needed |
| The recorder says *Reconnecting…* | The phone lost the Pi for a moment; the audio is kept on the phone meanwhile | Nothing: it resends when the Pi is back. Keep the page open |
| "The recording paused while the page was hidden" | The phone locked or you switched apps, and the browser stopped the mic | The take skips that stretch. Keep Hindsight in front while recording |
| A take is labelled *Phone (partial)* | The recording never got its Stop: the page closed, or the Pi restarted mid-recording | It holds everything that reached the Pi |
| A capture or catch is refused for disk space | Free space is under `MIN_FREE_GB` | Empty the trash, or delete old takes |
