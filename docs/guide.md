# The Hindsight guide

How Hindsight works, in plain words, for someone who has never touched an
OP-1.

**How to read it.**

- **When:** a section opens by saying whether its features are there:
  - *Today* means they're in every release now.
  - *With Play mode on* means they're there only when that preview is
    switched on for this device (Settings › Preview features).
- **Two rooms.** Hindsight is a **Studio**, where you keep, grab and build on
  the tape, and a **Listening Room**, where every take is, a tap plays it and
  **Open** is its page. The screens say their words: feed, part, note,
  buffer, BOUNCE. Parts of this guide were written before them and still say
  ring, clip, flag, clipboard or mix down;
  [section 8.14](#814-words-in-the-two-rooms) says what each is called now.

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
| **Feed** | The last 15 minutes of every input, held in memory and always recording. The ribbon at the top of the Studio draws it. Older parts of this guide call it the *ring* |
| **Take** | A saved recording: a KEEP, a phone recording, a bounce, or a selection of another take |
| **Note** | A marked moment in a take or the feed, with an optional label (older parts of this guide: *flag*) |
| **Selection** | A span between **In** and **Out**. On a take it's what you keep or share; on a tape it's what you edit |
| **Repeat, Loop** | The bar's ⟲. On: playback repeats the selection (the tape's loop bracket). Off: playback runs straight through |
| **Tape** | Four tracks, 20 minutes each by default, holding parts. Tapes live in the Studio |
| **Track** | One of the tape's four lanes |
| **Part** | A piece of audio sitting on a track (older parts of this guide: *clip*) |
| **Catch** | Put a span of the feed onto a track, after you've played it |
| **Pass** | One time round the loop. Every pass you play is kept, and you choose which to catch |
| **Layer** | A second catch on top of a track's existing audio, summed with it |
| **Range** | Bars across one or more tracks, drawn on the lanes: what Cut, Copy, Paste, Insert and Delete time act on |
| **Buffer** | The one slot that GRAB, and a range's Cut and Copy, fill, and DROP empties (§8.12). Older parts of this guide call it the *clipboard* |
| **Cut** | Take a range out of the tape into the buffer, leaving silence (the OP-1's *lift*) |
| **Paste, DROP** | Put the buffer on a range's start or at the playhead (the OP-1's *drop*); DROP puts it on the armed track at the next bar line |
| **Bus A, bus B** | The tape's two outputs into the Sidekick: bus A into channel 1, bus B into channel 2. Each has the Sidekick's EQ, FX and fader |
| **BOUNCE** | Play the tape once and keep what came out of the mixer as a take (older parts of this guide: *mixdown*) |
| **Lead, follow** | Whether the tape sets the tempo for the Bento (lead) or follows it (follow) |

Every word the two rooms use, and what each was called before, is in
[§8.14](#814-words-in-the-two-rooms).

## 3. The main page

*Today.* `/` is the **Studio**: the tape (§8.2) with the **feed** above its
lanes. The header's other room is the **Listening Room** (§3.1), where the
takes are. The feed is one strip, so the tape keeps the screen: on a tablet
it's one row, on a phone three.

- **The lamp,** *FEED*, is green while the feed records, amber or red when
  something wants a look. Tap it for the feed's sheet: what's wrong, if
  anything; disk free, dropped buffers and the MIDI clock's tempo; the
  **Input channels**, each with its meter; and **The rig ›**.
- **The meters,** backlit VU needles for the channels being saved, under
  the lamp, with the level in dBFS under each. On a phone, two bars beside
  the lamp.
- **The feed ribbon.** The last 15 minutes, passing the red record head at
  *REC*, with the recent end stretched so you can see it. The length KEEP
  would save is lit orange, and the strip underneath says how long ago.
  Hold and drag across it to keep or grab just that stretch (§6).
- **GRAB** lifts the last bars into the Studio's buffer, to drop on a track
  (§8.12). The key says how many, and from which input: *GRAB 4 BARS, from
  aux · armed*. Its **▾** picks 1, 2, 4 or 8 bars, and the input -- the armed
  track's, unless you pick one.
- **KEEP** saves the past as a take, and says how much: *KEEP 30s*. Its
  **▾** picks 30s, 2m, 7m or all of it, as many as the memory holds, and a
  tap keeps that from then on, after a reload too. Its toast has **Name it**
  and **Undo**: Undo takes the save straight back to the trash (§5), and the
  toast that says so has **Restore**.
- **Note** marks this moment; the note rides along into any take that
  includes it.
- **Recording from this phone** (§7) is in the tape's menu, on its name.
  While it records, the
  feed shows **● REC** and the time, to open it again.
- **The bar,** along the foot of the page, is the one now-playing bar in
  both rooms, the same shape whatever it holds, with **▶** always in the
  same place: its reels and amber window, **|◂ ▶ ●** (or **↺ 5 s** in ●'s
  place), **Catch**, **⟲** and the metronome, and what it holds as a strip
  to tap or drag. The window says what plays (**TAPE**, **FEED** or the
  take's name), its tempo and where it plays: tap the source to choose the
  tape, the live feed, one of the last few takes or the shelf. A take
  tapped in the Listening Room plays in it and keeps playing when you
  change rooms. On a phone it's the mini player above the tabs: tap its
  window for the whole bar (§8.2).

### 3.1 The takes page

*Today.* Every take, in the **Listening Room** (its tab in the header): a
library, searched from the field at the header's left. On a tablet or a computer it is a **wall of shelves**, from the
header down to the bar: one shelf for each month, newest first, then
**★ Starred**, then one shelf for each tag. A take stands on its month's
shelf, and on ★ and its tag's too. A shelf that holds more than it shows
ends on half a spine: swipe it sideways. Each shelf's plate says what it is
and how many it holds, and its **All ›** opens it as the **List**, with
**Select** and **▶ Play all**; **‹ The room** (or Back) goes back to the
wall. The room you're in stays behind the shelves, dim, and shows in full
as you walk in.

- **Shelf | List**, at the top, shows the takes on the shelves or in the
  List: every take, by month and then by day, newest first. This device
  remembers which (Settings has it too). A phone starts with the List.
- **Sort ▾**: newest first, oldest first, the longest first, or by name. The
  shelves and the List follow it.

- **A take is played, not picked:**
  - **A tap plays it** in the bar, where you are: a spine on the shelf, a row
    of the List, a search result, or a line under a spine. Tap
    it again to pause it. Nothing opens, and there is no sheet: the take's
    other controls are in the bar, in a selection, or on **Open**, its page
    (its name, ★, tag, tempo, downloads, notes and GRAB).
  - **A double tap on a spine opens the take** on its page, as **Open ›**
    on the bar does: its first tap has already started it, so it plays on
    into its page.
  - **Holding a take selects it,** as **Select** does: a finger or a pen for
    half a second, ⇧-click with a mouse, ⇧-Enter on the keyboard. A tap on
    another take then adds it to the selection or takes it out, and nothing
    plays. **★**, **Tag**, **Export** and **Delete** act on what is picked.
    **Tag** gives all of them one tag, or takes off the tag they all wear.
  - **A row of the List** is a take's case: its tag's colour, its name, its
    length, its bars, ★ and NEW, and a light while it plays. Its **›**, at
    the end, opens the take on its page; a tap anywhere else plays it.
  - **The bar, with a take in it,** keeps its shape: **▶** where it was,
    **↺ 5 s** in ●'s place, the take as a strip (tap it to jump there, drag
    it to scrub), its name on the window, and at its right end **⏏** (back
    to the tape), **Open ›** and **✎**. **Open ›** opens the take on its
    page. **✎** opens the take's **Sketchbook** right here, at the spot you
    were hearing, and the take plays on: write a note, *Add note*. Star, tag
    and name it there too; **Open waveform ›** goes to its page (§4.1).
    **⟲** is **Repeat** for a take: its selection, or the whole take without
    one; for the tape in the bar it stays **Loop**. On a phone the mini
    player keeps its window and **▶** where the tape's are, with **Open ›**
    and **✎** beside them; tap the window for the whole bar. **Open** has
    its own bar for the take, in the same shape.
  - **A tap plays at once,** and the sound never waits for the picture: a
    cassette lifts off its shelf and flies to the bar while the take is
    already playing, and its spine stands proud of the shelf, lit, while it
    plays. Tap another take mid-flight and the new one flies instead; with
    *reduce motion* on, nothing flies.
  - **A spine's folded takes** (its cuts, a tape's earlier bounces) are
    lines under it in the **List**, each played by a tap.
  - **Tapes are not on the shelf.** They live in the Studio: its title menu
    lists them and opens one. A tape's bounces stand on the shelf as takes.
- **Search the shelves** finds a take by what's printed on its spine (its
  name, or the time it was caught), the day (*today*, *yesterday*,
  *saturday*, *october*, *24 oct*), its tag, its tempo (*96*) and the words
  of its notes; every word you type must match, in any order. Tap the
  field and the List opens, the field pinned at the top and the takes found
  right under it, above the keyboard. **Cancel** (or Back) empties it.
- **Filters**, the chips over the List, show only what is on: **★**, a tag,
  *This week* (from Monday), and takes with *MIDI*. A search for *phone* or
  *mixdown* finds a phone's takes or a tape's bounces. The filters are
  remembered on the device; the search is not. Left on, a filter says so on
  the wall, with **Show everything**.
- **Tags.** A tag is a name and a color. Make them with **Edit tags** on a
  take's page (up to 24, eight colors); the list is kept on the Pi, so every
  device sees the same one. A take has one tag, and its cassette and spine
  wear its color; a take with none keeps the color its name gave it. The tag
  chips with the search show only one tag's takes, or only the *Untagged*,
  with a count on each; search also matches a tag's name. Deleting a tag
  leaves its takes untagged.
- **The spines.** Every take is a cassette, seen by its spine: its J-card,
  the colour of its tag across the top, its name in marker, a star when it's
  starred, and a NEW sticker for its first day.
- **Families.** A take you made by keeping part of another folds into the
  take you cut it from, and a tape's bounces fold into the newest of them.
  So the shelf keeps one spine for a jam and its riffs, and one for a tape
  however often you bounce it. That spine wears a count, **✂3** for its cuts
  and **MIX ×4** for the tape's bounces, and the List shows them as lines
  under it.
  - A family sits on its spine's day: a riff cut today from last Tuesday's
    jam stays with last Tuesday.
  - Search and the filters look at every take before anything folds. A
    starred riff shows under *Starred* even when its jam isn't starred; a
    search finds it by its own name.
  - Delete a jam and its cuts stay. They come back onto the shelf as spines of
    their own, still named after it; Undo folds them in again.
- **▶ Play all**, in the List, plays the takes shown, in the order shown, one
  after another through the bar: each from its selection's In to its Out, or
  the whole take without one. It starts at the take you last tapped (the
  first, with none), and its spine's ring turns green as each plays.
  **■ Stop**, Pause, ⏏ or Loop (which stays on that take) stops it moving on.
  A filter or a search first makes it play just those: *Starred*, a tag, a
  day.
- **Recently deleted (n) ›** is the List's last row. The take page's *Previous
  take* and *Next take* (in its name's menu) step through the takes in the
  order this page shows them, a spine's folded takes right after it, and its
  ‹ comes back here.

### 3.2 Updating Hindsight

Every change merged on GitHub becomes a release, and **Releases**, in the
menu (**☰**, top right on every page), is where you move between them: the
line under it shows the version running, *v2026.10.09.4*. When there's a
newer release than the Pi is running, it says so instead, **Update to
v2026.10.09.5**, and **☰** carries a green dot. The page asks when it loads,
every hour while it stays open, and when you come back to it. The Settings
sheet opens with *Hindsight v2026.10.09.4 · Releases · the guide · the rig*
too, and its **Releases** opens the same sheet.

- **Releases** lists every release the button can install, newest first,
  marked *running* and *latest*. Pick one and the sheet says what moving to it
  changes:
  - **newer:** *This brings in*, each release's notes between what's running
    and the pick;
  - **older:** *This takes out*, the notes you'd be leaving behind. The key
    says **Go back to v…**.
- **Update to v…** opens the same sheet with the latest picked.
- **The key installs it.** Hindsight restarts, so the feed starts empty:
  keep anything you want from it first. The sheet follows along
  (downloading, installing, *Restarting…*), and the page reloads on the new
  version. You can close the sheet; the install carries on.
- **It won't start** while a take is saving, a phone is recording, or the
  tape is playing or recording. It says which.
- **If the new release fails** to install or doesn't come up, the Pi puts
  back what it was running and says *still on v…*. Nothing else changes.
- **The list stops at v2026.10.09.3,** the first release with this button.
  Anything older would take the button away with it.
- **A build deployed from source** with `deploy.sh` shows where it came from,
  for example *v2026.10.09.4-2-gabc1234*: two commits past that release.
  Only a later release counts as an update.
- **From a shell** on the Pi, `~/hindsight/bin/hindsight-update` installs
  the latest, and `hindsight-update v2026.10.09.4` installs that one.

The button only appears where the updater is installed: `install.sh` and
`deploy.sh` both install it. The Pi needs to reach GitHub; without it, the
sheet says so.

### 3.3 Settings

**Settings**, first in the menu (**☰**, top right on every page), changes how
Hindsight records without touching the Pi's files. It opens on the version
with Releases, the guide and the rig (§3.2), then what's recording now (*Recording from Scarlett Solo 4th Gen, 2
channels*), then two parts.

- **Preview features** come first, always open: **Play mode**, a switch that
  reads *On* or *Off*. It is for this device
  only: the Pi and the other kits are unaffected, it saves the moment you
  flip it, and it needs no restart. A switch that has to be read when the
  page loads says *Will be on after a reload* and brings up one **Reload to
  apply** button. It reloads this page alone, and Hindsight keeps running.
  It won't reload while this page holds a phone recording; finish that
  first. Flip a switch back and the Reload goes away.
- **On the Pi** says once what the rest does: these settings are shared by
  every phone and laptop that opens the Pi, **Save** keeps them, and they
  apply when Hindsight restarts, which empties the feed. Under it come the
  groups, most used first: Input, Feed and Saving open, MIDI and Tape
  folded.

- **Interface** is *Automatic*, or one of the interfaces plugged in now.
  Automatic records from the one with the most inputs. **Channels** at
  *auto* opens all of its inputs.
- **Inputs in TAKES** and **Mix** say what a take is made from. On a
  two-input interface like the Scarlett Solo, input 1 is the mic and input 2
  the instrument: **stereo** keeps them left and right, **mono** puts both in
  the middle (each 6 dB down, so together they can't clip).
- **Feed length** says what it costs in memory, and warns when keeping the
  whole feed would need more than the Pi can spare. **Every input in TAKES**
  keeps them all; the disk guard, under Saving, is **Leave free**.
- **Each field says where its value comes from:** *set here*, *from the env
  file* or *default*. **Reset** hands one set here back.
- **Save** keeps the changes; they apply when Hindsight restarts. The sheet
  then offers **Restart**, which empties the feed, so keep anything you want
  from it first. It won't restart while a take is saving, a phone is
  recording, or the tape is playing or recording.

Settings live on the Pi in `~/hindsight/settings.json`, which wins over
`hindsight.env`. If that file is ever unusable, Hindsight starts without it
and the sheet says why.

## 4. The take page

*Today.* Open any take from the list. The first time you do, three hints
point at the gestures that matter; **Got it** puts them away for good.
This page is **Open**, with a few things added and a few taken away: §4.1
says which.

**The layout, top to bottom:**

- **The header** is the one every page has: at its left **‹ Takes**, the
  take's name and its ★ (and its tag, on a wide screen); **Studio |
  Listening Room** in the middle, where it is in the rooms; at its right
  **↶**, which undoes your last change (§5), and the menu (**☰**), with help
  mode and this guide. **The take's name is its menu** (▾): *Rename…* (the
  name becomes a field: type, then Enter), *Previous take* and *Next take*,
  each saying which take it opens, the WAV and MIDI downloads, *Reset the
  downbeat*, and *Delete this take* last. Under 1000 px its tag is in the
  menu too (*Tag…*), and under 860 px, with MIDI, the notes (*MIDI*).
- **Under the header,** its tempo (tap to set), its length ("0:30 of 0:59"
  when part of it is selected) and, for a take saved from another, "from
  *that take*", which opens it.
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
  played, on the same scale as its cassette in the Listening Room. It's the
  sound's envelope: at the closest zoom it doesn't show each wave crossing.
- **The grips,** under the waveform at the selection's ends, with the move
  handle between them.
- **The toolbar:** with a selection, its In and Out times with their
  nudges, its length and *Clear*; with a BPM, the *Downbeat* row (below); then *Save as take* · *GRAB* (when
  the Pi runs the tape) · *Share* · *More*; then ◂⚑ ⚑▸, **⚑ N** (the
  flags as a list), *Snap* and *Practice speed*.
- **The bar,** along the foot of the page, as in the Studio: the take's
  reels either side of an amber window, which says where it is (bar.beat
  with a BPM, with the time beside it; otherwise the time, and the take's
  length) with ▶ or ❚❚ and a level bar for each side; then **|◂** (back to
  In, or to the start), **↺ 5 s**, **▶ / ❚❚** and **⟲ Loop**; then **IN**, **OUT** and
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
  carries on from where you let go. **Drag the downbeat** — the yellow "1"
  just right of its line — to say where bar 1 starts.
- **Back** returns to the list where you left it, even after *Previous
  take* or *Next take*.

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

**The downbeat:**

Once the take has a BPM, a *Downbeat* row stays in the toolbar. The downbeat
is where bar 1 starts. **Set to playhead** puts it where the playhead is; **◂ ▸** move it 10 ms, or by one
*Snap* step (a bar, beat or ⅛) with *Snap* on, as In and Out do; the time between them opens the editor on it. The ruler's "1"
still drags, and **B** on a keyboard is Set to playhead. The grid follows as
it moves, and ↶ takes a run of nudges back as one step.

**Placing a boundary exactly:**

Dragging gets you near. To put In, Out or the downbeat on the very sample, open
it in the editor. Tap **In**'s or **Out**'s time in the selection row (they look
like small keys), or tap the downbeat's "1" on the ruler. The view centres on the point,
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
  beat with Snap off. It's hidden for the downbeat.
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
- **↺ 5 s**, or **J**, goes back five seconds, playing or not: to hear a
  bit again without finding it. The bar in both rooms has it too,
  and J in the Studio goes back five seconds of tape.
- **⟲ Loop** makes ▶ repeat the selection instead. It's off each time you
  open a take.
- **Practice speed** (½× 1× 2×) slows or speeds the take without changing its
  pitch. It's off while Loop is on: the loop plays at 1×, exactly.
- **Level** normalizes: it brings the selection (or the whole take) up, or
  down, so its loudest moment is 1.5 dB under full scale, and says by how
  much (*Level +6.2 dB*). On, the take plays here at that level and
  **Share** sends it so (its key says *Share · 0:12 · +6.2 dB*): what you
  hear is what you share. It follows the selection as it changes. A quiet
  take is brought up no more than 24 dB, so its hiss isn't shared at full
  volume, and played past the selection, anything louder is held under full
  scale rather than clipping. The level is read off the take's peaks, so
  it's instant. Off, everything is as recorded. It's remembered on the
  device, and the DAW bundle is always as recorded.
- The screen stays on while a take plays.

**Flags:**

- **⚑** drops a flag at the playhead.
- **Tap a pin** to name or delete it. **Drag a pin** to move it.
- **◂⚑ ⚑▸** jump between flags. Past the first or last, they go on to the
  take before or after in the list, at its nearest flag (its last going
  back, its first going on, its start without any), so they walk every flag
  of a run of takes. The take opens stopped; ▶ plays on.
- **⚑ N**, beside them, says how many flags the take has and opens them as
  a list, in time order, with their names and times, as the Listening Room's
  pane shows them. Tap one to play from it.
- **⚠ Dropouts.** Where the capture lost audio while the take was recorded
  (the interface overran because the Pi fell behind, the ring's writer
  did, or the stream stalled and was restarted), the take has a ⚠ in the ruler and a dashed line through the
  waveform. The header says *⚠ 2 dropouts*. They aren't flags: they can't
  be moved, named or deleted, and they don't count against the 512 a take
  can carry. ⚑ N's list has them, in time, and a tap plays from a second
  before one, to hear what was lost. A cut of the take keeps the ones
  inside it. In the Listening Room the cassette wears a *⚠ 2 dropouts*
  sticker, and the pane's line says so too.

**Doing things with the selection:**

- **Save as take** makes a new take of just the selection. It asks for a
  name first, offering the one it would get anyway ("Tuesday jam ·
  0:42–1:10") already selected, so typing replaces it; Enter or **Save**
  saves it, Escape or **Cancel** doesn't. In the Listening Room it folds in
  with this take (§3.1).
- **Share** sends it from your phone as an MP3 (the whole take, with no
  selection), levelled when **Level** is on.
- **GRAB** (when the Pi runs the tape) puts it in the Studio's buffer, to
  drop on a track (§4.1, §8.12).
- **More** has the DAW bundle (WAV + MIDI in a zip), the downloads, and
  delete.
- **Undo** in the header steps back through anything you changed (§5).

### 4.1 Open

A tap in the Listening Room plays a take; **Open** is where you dig into it. It is the
take page above: the waveform, the selection, the tempo, the MIDI lanes, ↶
and the take's menu on its name. Along the foot is the take's own bar (▶, ⟲ **Loop** for the
selection, **IN** and **OUT**), not the Listening Room's. What is different:

- **It opens where the bar was.** From **Open ›** on the bar (or the
  deck) it starts at the spot you were hearing, and plays on if it was
  playing. A browser that won't start sound without a tap on the page (an
  iPhone always) leaves it paused at that spot. From the bar's **✎** it also
  starts a note there (below).
- **✎ Note** puts a note at the playhead, or opens the one already there, with
  the cursor in its words: type, Enter. The **✎ Note** key at the head of the
  *Notes* list is always there; the bar's own **✎** is folded away on a phone
  until the player opens. **◂✎** and **✎▸** step from note to
  note, and **✎ 3** is the list.
- **Notes,** one line each: its number, its time, its words (the only field;
  they save when you leave it), **▶** to play from it, **GRAB** and **✕**. A
  note's **GRAB** puts this note, up to the next note or eight bars (16
  seconds with no tempo), into the Studio's buffer, and opens the Studio.
- **A tag** sits beside ★: *+ tag*, or the tag's name. It opens *One tag*:
  choose one to give it, or press the lit one to take it off (the key then
  reads *+ tag* again). *No tag* is a separate button, shown only while the
  take has a tag. *Edit tags* changes the list, or *Make a tag* when there is
  none; *Done* closes the sheet. A take has one tag.
- **KEEP and GRAB** sit side by side. **KEEP** makes a take of the selection
  and says how long it is (*KEEP 41s*). **GRAB** puts the selection, or with
  none the last N bars before the playhead (twice N seconds without a tempo),
  into the Studio's buffer and opens the Studio; N starts at the tape's loop,
  and the key says what it will do (*GRAB 4 BARS*, *GRAB SELECTION*).
- **No menu of places to send it.** KEEP and GRAB are the two verbs, and the
  page has nothing for a drawer of kept pieces: **More** has the DAW bundle,
  the downloads and delete. **Download** (**Share** on a phone) sends the
  whole take, or the selection, as an MP3.
- **What it came from, and what came from it,** are lines under the notes,
  each one opening that take: **Made from** (the take this one was kept
  from), **From this take** (what was kept from it) and **Earlier bounces**
  (for a bounce: the tape's other bounces).
- **A tape does not open here.** A link to a tape's page goes to the Studio,
  where tapes live.

## 5. Undo and the trash

*Today.*

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
`MAX_SAVES` pruning. On the take page it's one tap: *Delete this take* in
the take's menu, on its name (or *Delete take* under **More**), deletes the take and opens the next one
in the list, the one before from the last, so a run of takes can be culled
one after another, as on a recorder. The next take's toast says *Deleted …*,
and its **Undo** brings the deleted one back and opens it again. With no
take left to go on to, it's back to the list, which says it there. **Recently deleted**, under the list, shows what's there
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

## 6. The ribbon

*Today.*

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

**Copy** puts the selected span of MAIN on the
clipboard, to drop onto a tape.

## 7. Recording from your phone

*Today.*

**Recording:**

1. Open Hindsight on its HTTPS address — the `tailscale serve` one. The mic
   only works over HTTPS; on the plain address, *Phone* tells you so.
2. Tap the big red **●** on the mini player at the foot of the screen: it
   records at once, from the input you used last. Tap it again to stop. In
   the Studio, with the tape, **●** is the tape's own: it records the jam
   room as on the tablet, and a **hold** on it offers this phone instead
   (with the tape playing on this phone, a tap records here).
3. The **▾** beside **●** picks the input: the mic, or one plugged into the
   phone (the Orchid through a USB-C adapter, say). A cable beats the mic for
   anything you mean to keep. **The level and input…** there, or the tape's
   name → **Record from this phone…**, opens the recorder with its meter, so
   you can check the level first; tap **Record**, play, then **Stop**.

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

## 8. Tape

*Today.* The tape is always on ([configuration](configuration.md#the-tape)),
and it lives in the **Studio**, the first of the header's two rooms. It plays
in the demo; on the Pi it plays through the Sidekick, lined up with the
recording by listening to itself.

### 8.1 Plug in

| Sidekick input | Plug in | Why |
|---|---|---|
| Channel 1 (jack 1) | MPC, when you're using it | Channel 1 is where tape bus A plays back, so the MPC shares its fader and FX |
| Channel 2 (jack 2) | Bento audio | Keeps the Sidekick's FX on the Bento while you jam |
| Aux | The instrument you're layering: Orchid, guitar (through a pedal or DI), GO:KEYS | Aux is recorded clean and dry, so the tape's FX can be changed later |

The Bento's USB goes to the Pi's hub too, for MIDI only.

The tape plays out of the Sidekick's USB playback: bus A on 1/2
into channel 1, bus B on 3/4 into channel 2. If the Sidekick isn't there,
▶ reads *no output* until it is.

### 8.2 The tape in the Studio

From the top:

- **The header** is the one every page has: the tape's name at its left,
  **Studio | Listening Room** in the middle, **↶ ↷** and the menu (**☰**,
  with this guide) at its right.
- **The tape's name is its menu,** a pill with a ▾ (and the cassette). It
  holds everything you do with the tape, in groups: *The tapes* (each with
  its tempo and its parts, this one ticked: tap another to open it) and
  **New tape**; **Rename…** and **Duplicate**; **Share the mix**, **Bounce
  the loop**, **Bounce the whole tape**, **Export stems** and **Play the
  last bounce** (§8.6); **Record from this phone…** (§7); and last, in red,
  **Delete this tape…**.
- **↶ ↷** undo and redo every change to the tape except its name. 100 steps
  are kept, with the tape, so they survive a restart and every device shares
  them. On a phone, ↷ shows once there is something to redo.
- **The tempo and where the tape plays** are on the bar's window, below, not
  in the header.
- **The bar,** along the foot of the page, is the tape's player. From the
  left:
  - **The reels** either side of an amber window. They turn with the
    playhead, and wind or rewind to a jump such as the loop's wrap. The
    window says where the tape is, large, as bar.beat, with the time under
    it. Its lamp is ▶ playing, ■ stopped, or a red ● for a punch: steady
    while armed, blinking while recording. In the time's place, it says
    when it's mixing down or waiting for a tap to play here. Then three
    keys on the window: the **tempo** (tap it for the bars the loop could
    be), the **source** (*TAPE*: tap it for the live feed, a take or the
    shelf) and where it plays, **OUT** (*JAM ROOM*, *PHONE* or *BOTH*: tap
    it to choose, §8.10). On a wide screen they say it in full: *96 BPM · 4
    BARS*, *TAPE · Song sketch*.
  - **SYNC,** under where the tape is while it plays in the jam room, says
    how well its playback and the recording are lined up:
    - **Green:** to the sample. On the Pi, Hindsight listens for the tape in
      channel 1's (or 2's) recording and locks on within a few seconds of it
      playing something with a clear attack, like drums.
    - **Amber:** estimated from the clocks, to a few milliseconds. Catches
      work, and say so in their sheet; nudge one if it's early or late.
    - **Red:** not at all yet. Catches are refused until it's amber.
    It goes out while the tape is stopped, or plays on a phone.
  - **The transport:** **|◂** goes back to the loop's start (or, with Loop
    off, to the top of the tape), **▶ / ■**, and **●**, Record, beside it as
    in any DAW: always red, and its key glows while it's ready or
    recording.
  - **Catch**, orange, beside them, Record's after-the-fact twin, with its
    **▾** of what to catch.
  - **⟲ Loop** and the **metronome**.
  - **The grabber** on the bar's top edge folds it to one row of keys,
    for the lanes' room: tap it, or drag it down; drag it up, or tap it
    again, to unfold.
  - **Under them, the overview:** the whole tape, 20 minutes by default, with what's
    on each track and the loop in amber. It's a scrubber too. The box is what
    the lanes show: drag it to move along the tape. Tap anywhere to move the
    playhead there (to the nearest bar), and double-tap to go back to the
    loop. With it focused, ← and → move a bar.
- **Four lanes**, one per track:
  - Each header has the track's number (in a ring of its colour where there's
    room, otherwise printed on the tape), its name on masking tape, **●**,
    its **input**, **M** (mute, yellow when on), **S** (solo, blue when on)
    and its level.
  - **On a touch screen** (the tablet, a phone) the header keeps what a jam
    needs: the name, a **●** a finger wide, the input, and **›** at its end.
    **›** opens the track's inspector in one tap, with **Mute**, **Solo**
    and the **level** at its top, armed or not, and arms nothing. While a
    track is muted its › is lit yellow, soloed blue. With a mouse M, S and
    the level stay in the header, and there's no ›.
  - **●** arms it, making it the **record track**: where Catch, ● Rec, a
    free loop's tap and Overdub on this device go. Its ● is lit red, and its
    header is edged red. With none armed, Catch and ● Rec say *arm a track*,
    and offer to arm the selected one. **1–4** or **↑ ↓** on a keyboard arm a
    track too, and while one is armed, tapping another track's name moves it
    there. It's kept on the Pi, so every device records onto the same
    track: arm track 3 on the tablet and Catch on your phone goes there.
    Selecting a clip or tapping a lane doesn't change it: those pick the
    **selected track**, this device's own, which Paste and Split act on
    without a range, edged faintly when it isn't the record track.
    ● works as the keys do: **a tap moves the arm to that track** (track 4
    lets go), and never takes it off, so tapping the only armed track leaves
    it armed. **Hold ●** (a finger or pen held about
    a third of a second), or **Shift-click** it with a mouse (Shift+Enter from
    the keyboard), to arm that track **as well**; holding an armed track takes just it off, and holding the
    only one leaves none. Several armed is still how you record two inputs at
    once: Catch and ● Rec go onto all of them and DROP onto the first, and a
    toast says so once. A tap on any ● then goes back to one.
  - **The input** (*aux*, *ch1*…) is what the track records from: each track
    has its own, so the guitar on aux can go to track 2 and the Bento on ch2
    to track 3 without changing anything between catches. Its lamp is green
    while there's signal on it. Tap it for a menu of the inputs, each with
    its meter, and choose one: it doesn't arm the track or open anything
    else.
  - In the lane: the bar lines, the clips and the playhead. Each clip is a
    block in the track's colour with its sound drawn as bars, lit where it
    has played, and labelled with where it came from (*aux*, *main*, a
    *take*), *repeat* when it plays the same audio as one before it, or
    *reversed*. A layer on top of another clip is fainter.
  - Tap a clip to select it, as in a DAW: the action bar under the lanes
    acts on it, and **Details…** (or a double-click, or Enter) opens its
    inspector. Hold a clip, then drag, to slide it (7a). Hold an empty part
    of a lane, then drag across bars and lanes, for a **range** (8.5). Tap an
    empty part of a lane to move the playhead there, letting go of the
    selection.
- **▶ / ■** plays and stops. **⟲ Loop** turns the loop on and off; off, the
  tape plays on to the end of what's recorded.
- **The clip editor.** While a clip is being aligned, its editor opens above
  the bar, and pushes the lanes up rather than covering one.
- **Beside the ruler,** **⌗** is the View menu. It says what a drag snaps
  to -- a slid clip, a trim, a fade, or a range drawn on the lanes -- and
  shows a padlock while the loop is locked. Its menu sets the snap (*Bar*,
  *Beat*, *⅛* or *Off*); **Lock the loop** keeps the loop where it is, so a
  range you draw doesn't move it; **Fit** puts the view back on the loop;
  **Fold the tracks** folds the lanes away for room (the ruler, the buffer
  and the bar stay); and on a touch screen **Ask before Insert and Delete
  time**.
- **Recording onto a track** is in the track's inspector: tap its name
  twice, or its ›. Under Mute, Solo and the level, it's the record track's
  (the inspector moves to the record track when the arm moves), in red: **Input**, **Layer / Replace**, **Catch the
  last 1, 2 or 4 bars**, the **passes**, and **Overdub on this device**.
  On a track that isn't armed it shows the track's input and **Arm it**.
  Its name, pan and the bus it plays through (*bus A*, the Sidekick's channel
  1, or *bus B*, channel 2) are under it.
- **Input** chooses what the track the inspector shows records from (the
  record track's, while one is armed): main, ch1, ch2 or aux, as the input
  menu on its header does. ● Rec names the record track's too, under its
  label, so you can see what it will record without looking down. Choosing
  one for a track changes only that track; a new tape's tracks start on the
  input chosen last on this device. While ● Rec is ready or recording on a
  track, the lit chip is the source it's recording, and changing it waits
  until that punch ends.
  - Each chip has a **meter**: the loudest moment of the last third of a
    second. The source with your instrument in it is the one that moves.
    Aux with nothing plugged in is exact silence, and reads empty.
  - **●** means clean: none of the tape's own playback is in it.
  - **○** means the tape is in it: ch1 hears bus A, ch2 hears bus B, and main
    hears both.
- **A catch that comes back silent or very quiet says so**: the toast turns
  amber and reads *it's silent: nothing came in* (digital silence) or *it's
  very quiet (peak −62 dB)*, with Undo. The clip's inspector says it too, and so
  does dropping or copying a silent stretch from the ribbon.
- **Catch** (in the bar) catches the last pass, and **Catch the last: 1 bar /
  2 / 4** catch the last bars, onto the record track, from its input.
  Pointing at it outlines, on that track's lane, the pass it would take. It
  catches after one whole pass of the loop; until then its second line says
  why (*after one pass*), and pressing it says why in full (and offers the
  last 4 bars, which don't wait). The **▾** beside it, a key of its own,
  opens the same choice: the last pass, or the last 1, 2 or 4 bars. The key says what it
  catches (*last pass → 2*, or *→ 2, 3* with two armed). The phone's mini player says it
  shorter (*→ 2*, *→ 1–4* with all four armed, *in 1 pass*, *arm track*). While the tape plays, a small
  red ▾ on the record track's lane marks the next bar line: where ● Rec
  would start.
- **Passes** keeps the last six times round the loop; −1 is the newest.
- **On a phone,** upright or on its side, the bar is a **mini player**
  above the tabs: the reel window with where the tape is, **|◂**, **▶**, a
  big red **●** with the phone's **▾** (§7), and **Catch** with its **▾**, and a line along its top as far as the tape has
  got. A catch never waits for a scroll. Playing on this phone, its strip
  (and *Tap to play here*) sits on top. Where it plays is on the player's
  window: pull the player up.
- **Tap the mini player's window, or drag it up,** to pull up **the
  player**, a sheet over the page that follows your finger: the reels and
  the display large at the top, the overview under them, then **|◂ ▶ ●**,
  **Catch**, **⟲ Loop** and the metronome low down, under your thumb, and
  where it plays at the foot. **Swipe it down** by its grabber or its reels,
  tap the grabber, or Back or **Esc**, to put it away. A take or the
  feed in the bar has the same mini player and player, **▶** in the same
  place: see *The bar, with a take in it* (§3.1).
- **On a phone,** with the player down, the action bar floats above the
  player, and the buffer is a sheet (§8.12). The recording is in the track's
  inspector: tap its name twice.
- **On a tablet or a computer** the tracks take the whole width and share
  the height of the window between the header and the bar; the action bar,
  the clip editor or the buffer opening makes them shorter, and they scroll
  once they're as short as their heads. The header is one row on every
  screen, the page switch in its middle.
- **With a keyboard:** **Space** plays and stops, **R** is ● Rec, **L** is
  ⟲ Loop, **M** the click, **J** goes back five seconds, **1–4** or **↑ ↓** choose the record track, **S**
  splits at the playhead, and **⌘Z / Ctrl-Z** undoes (with **⇧** to redo).
  With a clip picked, or several: **Delete** removes them, **⌘C / Ctrl-C**
  copies them as they lie, **⌘X / Ctrl-X** cuts them, and **⌘D / Ctrl-D**
  lays a copy right after them and picks the copy, so pressing it again
  carries the run on. With a range: **⌘C** copies it and **⌘X** cuts it.
  **⌘V / Ctrl-V** pastes, on the range or at the playhead. **Esc** lets go.
  **Shift** with a click picks several. Holding a key doesn't repeat it, and
  none of them fire while you're typing or a sheet is open.
- **The Studio's verbs** (§8.12): **K** keeps the feed as a take (the buffer,
  while it's open), **C** catches, **G** grabs, and **↵** drops the buffer.
- **With the instrument unfolded** (§8.13) the keys are the instrument's:
  **R** is STOP and **1–4** drop a track out. Fold it, or tap the lanes, to
  give them back; its **KEYS** lamp says whose they are.
- **After a sleep.** Lock a tablet and wake it, and the page asks the Pi
  again at once: no refresh. If the Pi doesn't answer, a small
  **Reconnecting…** note shows at the top (not for a blink) and goes when it
  does. Both rooms and Open do this.

### 8.3 Your first loop

*Steps 6a and 6c.* There are three ways to start a tape.

**Free (6c).** Play until a part sounds right. On the empty tape, choose the
source and tap **Tap where the loop starts** on the downbeat, then tap again
where it comes round.

1. Each tap is timed when it reaches the Pi, and snaps to the strongest
   attack in that source from a quarter of a second before it to a
   twentieth after. Tapping a little late, or Wi-Fi being slow, doesn't
   matter.
2. The span becomes the first loop on the record track, and starts playing
   at once, in time with you, as if it had been playing all along.
3. Its length sets the tempo: the number of bars that puts it nearest your
   last tape's tempo (or 90 BPM). If it guessed 168 and you meant 84, tap
   the tempo on the bar's window and choose the other. Nothing is stretched,
   only relabelled.

**From a take.** Open a take (§4.1), select the part and press **GRAB**: the
Studio opens with it in the buffer (§8.12). Arm a track and press **DROP ON
TRACK N**. An empty tape says so too: *Or GRAB a bit of a take*.

A track holds `TAPE_LENGTH_S` seconds, 20 minutes by default.

**From a tempo.** On an empty tape, type a BPM and a number of bars and tap
**Set**. The loop is that long and empty, ready to catch into, and the
**♩ click** plays on every beat until the first catch. The BPM starts at the
tempo you were last playing: the clipboard's or your newest take's, whichever
is newer.

The tempo is fixed once the tape has audio, because nothing is ever stretched.

### 8.4 Building it up

*Today.*

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

**Clips.** Tap a clip to select it; **Details…** in the action bar (or a
double-click) opens its sheet: its level, a ±5 ms nudge for timing, and
**Remove**.

**Mix.** Each track has a level, mute, solo and a bus (in its inspector).
Every track starts on bus A, 6 dB down.

- Bus A plays out of the Sidekick's channel 1, and bus B out of channel 2.
- So the Sidekick's channel knobs (EQ, FX, fader) act on a whole bus.

**Undo** steps back through every change, catches included. Quick changes to
the same thing, like dragging a level, are one step.

**Rename.** *Rename…*, in the tape's menu (on its name), gives the loaded
tape a new name. It shows at once on every device, and isn't a step in
undo.

**Duplicate and delete.** *Duplicate*, in the tape's menu, makes a copy
that shares the original's audio, so it costs no disk space. *Delete this
tape…*, last in the menu, deletes the tape you have open: a sheet asks
first, naming it and what's on it (*Delete "Song sketch"? 3 parts, 8 bars.
This can't be undone.*), and the tape you changed last opens in its place
(a new empty one, if it was the last). Deleting frees whatever audio no
other tape uses, including what's only in other tapes' undo.

**Rec (6c).** Tap a track's **●** to make it the record track, and give it
its input (tap the input on its header and choose one), then:

- **While playing,** tap **● Rec** and recording starts at the next bar line
  (or the one you just passed, if it was less than a quarter second ago).
  Tap ● again (or ■) to keep it. With the loop on, it keeps the last full
  pass it covered -- the others are still in the passes row. Otherwise, or
  if no pass was full, it keeps the bars up to the last complete one.
- **While stopped,** tap ● Rec and it's ready (*● Ready*). Press ▶: a bar of
  click counts you in, then the tape plays from the playhead's bar and
  records. ■ keeps it.
- **While it records,** the track's lane shows it in red from the bar it
  started at, with the source's level along it, so you can see something is
  coming in. Before the tape reaches that bar, a dashed red line marks it.
  With the loop on, the red starts again at In each time round (*pass 2*,
  *pass 3*). It's a sketch from the meter; the real waveform arrives with
  the clip.
- The toast has **Cancel** while it records, and **Undo** once kept.

**The buffer (6d)** holds what you last grabbed, copied or cut -- from a
take, the feed or a tape (7a, [below](#85-editing-like-an-op-1)) -- and
keeps it through a restart. A copy can be as long as a track. The Studio
shows it between the feed and the tracks (§8.12).

- **Paste**, on a range's action bar, puts it at the range's start,
  replacing what's there; with the tape stopped the playhead moves to the
  paste's end, so **Paste, Paste, Paste** lays copies end to end. **⌘V /
  Ctrl-V** pastes at the playhead without a range. On an empty tape, a paste
  is the first loop.
- **TOSS** in the buffer empties it.

**More (6d):**

- **Layer / Replace** chooses what a catch or a punch does to audio already
  on the track: sits on top of it, or clears it first.
- **The ruler** over the lanes shows the bars, with the loop shaded. Tap it
  to move the playhead to a bar line; hold, then drag across it to select
  those bars on every track: a range, which the loop follows (unless the
  loop is locked, in ⌗'s menu). The lanes show the loop and a bar
  either side, so you can drag it a bar wider at a time.
- **Zoom and pan** the lanes and the ruler: pinch with two fingers, drag
  sideways with one (a vertical drag still scrolls the page), or on a
  computer scroll sideways and hold ⌘ or Ctrl to zoom. A playhead that runs
  out of view -- jamming on past Out with the loop off -- pages the view
  along. **Fit**, by the ruler (in ⌗'s menu on a phone), puts it back to
  the loop.
- **A clip's inspector** has *Repeat to the loop's end*: copies of the clip end
  to end, wherever its layer is free -- one bar through four.
- **Tap a track's number again** (or its ›) for its inspector: its mute, solo,
  level, name and pan.

### 8.5 Editing like an OP-1

*Today.* What you edit is drawn on
the lanes: clips you've selected, or a **range** -- bars across one or more
tracks. **Hold an empty part of a lane, then drag** across bars and lanes;
**hold on the ruler and drag** for every track; **tap a section** for its
bars; or select clips and tap **Bars** for the bars they cover. A range is
shaded in teal on its lanes. One drawn on the lanes, or from **Bars**, snaps
as **⌗** says (the ruler's are whole bars). Its edges have tabs: drag one
sideways to resize it. The loop follows the range to its bars, as on the OP-1,
unless the loop is locked (*Lock the loop*, in **⌗**'s menu; ⌗ shows a
padlock while it is): then you can edit elsewhere
while the loop plays on. The **action bar** names it (*Tracks 2–3 · bars
5–8*) and acts on it; **Done**, **Esc** or a tap on an empty part of a lane
lets it go, and selecting a clip does too.

| Do | Gets you |
|---|---|
| **Cut** (✂, ⌘X) | Takes the range's bars on its tracks into the clipboard, a clipboard track for each, leaving silence: the OP-1's *lift*. Undo puts it back |
| **Copy** (⌘C) | Copies them to the clipboard, leaving the tape alone |
| **Paste** (⌘V) | Puts the clipboard at the range's start, from its first track down, replacing what's there: the OP-1's *drop*. Without a range, **⌘V** puts it at the playhead on the selected track and moves the playhead to its end, so **Paste, Paste, Paste** lays copies end to end — the quickest way to turn four bars into sixteen. A four-track clipboard lands on all four, silence and all |
| **Split** | S, with no clip selected: cuts the clips on the selected track in two at the playhead, where they're heard (a nudged clip is cut where it sounds) |
| **Join** | In a clip's inspector: joins it and the half split from it back into one |
| **Slide** | Hold a clip, then drag it along its track, or up or down onto another: once your finger is half a lane over, that lane is outlined and the clip goes there, and that track is selected. A clip on the grid lands on the nearest bar, beat or eighth (**⌗**, by the ruler); one off it moves by whole steps, keeping its offset. It goes on top of anything already there |
| **Trim** | Tap a clip: it's selected, with a grip inside each edge. Drag a grip to move that edge, on the **⌗** grid (hold ⌥ to move it freely). Trimming the start keeps the audio where it was played. While you drag, the audio the edge can reach shows faintly past it; the grip turns amber where it can go no further. A clip too short for grips has **Start here** and **End here** in its inspector, which trim it to the playhead. Escape, or a tap on an empty part of a lane, lets go of it |
| **Repeat** | Drag a picked clip's ⟳ corner (bottom right) to the right: a ghost of each copy follows, and the count shows (×4 is the clip and three copies). Let go to lay them end to end, on top of anything already there; drag back to have fewer. Held near the lane's end, the view scrolls on, so you can lay more than fit on screen; trim grips do the same. The copies aren't linked: change one and the others stay as they were. One undo takes them all back. **Repeat to the loop's end**, in the inspector, still fills the loop |
| **Fade in, Fade out** | Pick a clip and drag the small square at either end of its top edge inwards: the fade follows, any length, sticking to a **⌗** line as it passes close by (hold ⌥ to keep it off them), and says how long it is as you drag. It stops where the other fade begins; drag it back to the corner for none. Or, in its inspector, choose 10 ms, an eighth or a quarter of a beat, a beat or a bar (the beat ones need a tempo). Under the lengths, its **curve**: *Equal power* (the default, even over a beat), *Linear*, *S-curve* (slow off both ends) or *Exponential* (drops early and tails off, the way a note dies away). Drawn on the block as a shaded corner under that curve, and played on it, in a mixdown and a shared WAV too. The 3 ms declick, or a crossfade where it meets audio, still works under it. A split keeps each fade on its half; reversing swaps them, curves and all; a lift or copy drops a fade it cuts through |
| **×2** | On the action bar while the range is the loop: doubles the loop, copying what's in it over what follows |
| **Reverse** | In the action bar, or a clip's inspector: plays it backwards. In the inspector, *Play forwards* turns it back |
| **Share as WAV** | In a clip's inspector: sends just that clip, at its level, to another app; a clip over a minute downloads instead |

**Replace, insert or close the gap.** Three edits change what's already on
the tape in three different ways, and the keys pair up to say so: **⤓ Paste**
beside **⇥ Insert**, **✂ Cut** beside **⇤ Delete time**.

```
               before            after
⤓ Paste        A A │ B B │ C C   A A │ x x │ C C         over what's there: the same length
⇥ Insert       A A │ B B │ C C   A A │ x x │ B B │ C C   everything after moves later
✂ Cut          A A │ B B │ C C   A A │ · · │ C C         a gap is left
⇤ Delete time  A A │ B B │ C C   A A │ C C               the gap closes up
```

- **Insert** and **Delete time** act on **all four tracks and the
  sections** (the keys say *all tracks*): moving one track alone would knock
  the parts out of time with each other. Cut and Copy take the range's
  tracks; Paste fills from its first track down, as many as the clipboard
  has.
- **Insert** is beside Paste and needs a clipboard: it goes in at the
  range's start. **Delete
  time** is beside Cut and takes the range's bars. A clip across the point is
  split there; a section across it grows (Insert) or loses the part cut out
  (Delete time). Insert won't push anything past the end of a track
  (`TAPE_LENGTH_S`).
- **Duplicate section**, in a section's inspector, plays it twice in a row: a
  copy right after it, named the same, and everything after moved on. *The
  chorus again* is one tap.
- **See it first.** Point at **Paste**, **Insert** or **Delete time** (or
  Tab to it) and the lanes show what it will do: Paste outlines what it will
  cover; Insert draws everything after the point moved on, the gap shaded
  and the clipboard dashed in it, and the ruler says *+4 bars*; Delete time
  draws what follows moved up to meet what came before, at a red seam where
  the selection began, and says *−4 bars*. The preview follows the playhead
  while the tape plays, and shows only what the Pi will do: an Insert that
  won't fit shows nothing, and its tap says why. On a touch screen the first
  tap on Insert or Delete time shows it and asks for a second, and the
  second does it where the first showed; turn **Ask before Insert and
  Delete time** off (in ⌗'s menu, beside the ruler) to skip that.
- After each, a toast says what happened (*Inserted 4 bars at bar 9*,
  *Deleted bars 9–12*) with Undo: each is one undo step.

**Selecting clips.** As in a DAW, a tap (or click) on a clip selects it, and
nothing pops up. The **action bar** over the transport says what's selected
(*Track 2 · 10.0 s · take*, or *3 clips*) and acts on it, each one undo.
It comes up half a second after the click, so a double-click's second
click lands where its first did; its keys scroll sideways when the window
is too narrow for them all. On a phone it floats just above the player,
and a lane it would cover scrolls up into view. **Shift**,
**⌘** or **Ctrl** with a click adds a clip or takes it off; on a touch
screen, **Select more** in the bar makes taps do that. ⌘A or Ctrl+A selects
every clip on the tape. A tap on an empty part of a lane, **Done** or
Escape lets go.

| Do | Key | Gets you |
|---|---|---|
| **Cut** | ⌘X / Ctrl+X | Copies them as they lie, then takes them off the tape: **Paste** lays them out again. One undo puts them back |
| **Copy** | ⌘C / Ctrl+C | Copies them to the clipboard as they lie, on their tracks and as far apart: **Paste** lays them out again from the selected track, replacing only what's under each |
| **Bars** | | The bars they cover, on their tracks, as a range: drag its edges in for part of a clip |
| **Split** | S | Cuts the one selected clip in two at the playhead (lit when the playhead is inside it). A clip layered with it there is cut too. With nothing selected, S splits the selected track at the playhead |
| **Duplicate** | ⌘D / Ctrl+D | Lays a copy right after them and selects the copy, so pressing it again carries the run on |
| **Reverse** | | Turns each round |
| **Move here** | | Moves them so the first starts at the playhead, keeping their spacing and tracks |
| **Details…** | Enter, or double-click | The one clip in the inspector: level, nudge, fades, Align, Share as WAV, Start here and End here |
| **Remove** | Delete | Takes them off the tape |
| **Drag any of them** (hold, then drag) | ← → (Shift: a bar) | Moves them all by the same time (and, dragging, the same number of tracks), as far as the tape and its tracks go. The keys move them a step of **⌗**: a bar, a beat or an eighth (a tenth of a second with Off, or without a tempo), stopping at the tape's ends |
| **Done** | Escape | Lets go of them |

Align still works on one clip at a time.

**The inspector.** A clip's settings (level, nudge, fades, Repeat, Join,
Reverse, Share, Start here and End here, Align), a track's (name,
level, pan) and a section's (name, colour) open in the **inspector**, beside
the lanes rather than over them. From 700 px it's a panel on the right, and
the lanes make room for it; on a phone it's a sheet over the foot of the page
at half height, and its grip pulls it up to most of the screen or down to its
title. Nothing behind it stops working: the lanes, the playhead and the bar
all take taps and keys. It follows what you select: tap another clip and it
shows that one, select another track and it shows that track, tap another
section and it shows that. Selecting several clips, or none, closes it, and
so do **Escape** and **Done**. Opened with **Enter** or **Details…** the
keyboard goes into it; opened with a double-click it stays on the lanes, so
**← →** still move the clip.

**Sections.** The strip over the ruler names spans of the tape: an intro, a
verse, a chorus. **Hold and drag** on it to make one over the bars you drag
across; it's named the first of *Intro, Verse, Chorus, Drop, Bridge, Outro*
not yet used, and its inspector opens to call it something else or give it
a colour. With a keyboard, Tab to the strip: **← →** move between sections,
**Enter** selects one and, again, opens its inspector. **Tap a section** to
select its bars on every track, a range, which the loop follows, so **Cut**,
**Copy** and **×2** act on it. **Tap it again** for its
inspector: rename, colour, remove. **Drag an edge** to resize it. On a tape with
a tempo, sections sit on bar lines; they don't overlap; each change is one
undo. Removing one leaves the audio under it as it is. The stems' `.mid`
marks each one, so a DAW shows the arrangement.

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

**Lining clips up exactly:**

Sliding gets a clip near. To put it right to the sample, zoom the tape in
(pinch, or ⌘ or Ctrl with the wheel) until each lane draws single samples.
Every lane shows its detail at once, so you can compare a hit on one track
with a hit on another by eye. Then double-click a clip (or select it and
choose **Details…**) and choose **Align**. The sheet
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

### 8.6 Mixdown and export

*Today.* Both are in the tape's menu, on its name.

- **Bounce the loop** plays the loop's bars once, or **Bounce the whole
  tape** plays from bar 1 to the end of the last clip. Then the tape stops,
  back where it started, and the recording keeps going for two seconds so
  reverb and delay ring out
  ([`TAPE_MIXDOWN_TAIL_S`](configuration.md#the-tape)).
  - What came out of the mixer is saved as a take. The Sidekick's FX and
    anything you played live over the tape are in it.
  - The take is labelled with the tape's name and has its tempo, with bar 1
    at its start.
  - In the Listening Room, a tape's bounces fold into the newest one, which
    wears **MIX ×** and how many there are; the List shows the earlier ones
    under it (§3.1).
  - The loop is ignored and the click is silent while it plays. The readout
    shows how far it's got, then *letting it ring out*. **■** cancels it
    until then, and nothing is saved.
  - If the Pi falls behind while it plays, nothing is saved rather than a
    take with a gap in it; bounce again.
  - It needs the tape playing through the Sidekick and lined up (*SYNC* on
    the bar's window amber or green). It also has to fit in the recording buffer:
    `RING_SECONDS` less the tail and five seconds.
  - To share a song with the Sidekick in it, bounce it and share the take.
    To send the tape as it is from anywhere, even with the interface off,
    use **Share the mix**.
  - The toast that says it is done has **▶**, which plays the new take on
    this device, and **Open**, its page. **Play the last bounce**, after
    *Export stems*, brings that toast back for this tape's newest bounce once
    it has gone, and says which take that is under its name. A
    bounce is a take on its tape's spine in the Listening Room.
- **Share the mix** sends the whole tape as an MP3, from the start to the
  end of the last part:
  - The Pi renders it in a few seconds, with every track at its level and
    pan, mutes and solos as they are, and buses A and B summed. A toast
    says it's rendering, then **Share** opens the phone's share sheet
    (Messages, WhatsApp, mail). It's named after the tape and the day. On a
    computer, or where the sheet can't take a file, it's **Download**.
  - It's dry: no Sidekick EQ or FX, and nothing played live. For those,
    bounce it.
  - It works with the tape playing on a phone and with the interface off.
    It doesn't stop the tape, isn't in undo, and puts nothing on the shelf.
    With the tape on a phone, Bounce offers it.
- **Export stems** downloads a zip:
  - a 32-bit float WAV for each track with audio, each from bar 1 to the end of
    the last clip on any track. They're all the same length, so they line
    up when dropped at the start of a DAW project. Each has its track's
    level and pan, but not its mute or solo, and no FX: the FX happen in the
    Sidekick.
  - a `.mid` with the tempo, 4/4, the loop's In and Out, and each section
    (by its name, where it starts) as markers.

### 8.7 The Bento follows the tape

*Today: the tape leads.* Plug the Bento's USB into the Pi's hub, set
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
more). A part that still lands early or late can be nudged in its clip's inspector.
Headphones matter: over a speaker the mic records the tape too. Recording
needs the HTTPS address, as the Phone button does; listening works anywhere.

### 8.9 Tricks and tape speed

*Today.* Hold a trick pad and it acts until you let go, starting on the next
16th note:

- **Break** winds the tape down to a stop. When you let go, it comes back in
  time.
- **Reverse** plays backwards.
- **Chop** repeats a small slice in time.
- **Memo 1 and 2** remember a mix (levels, mutes, Sidekick settings). Hold
  one to recall it; hold both to blend them.

**Tape speed** slows or speeds the whole tape, pitch and all, like a real tape
machine.

### 8.10 Taking the tape upstairs

The tape can play on your phone as a backing track, anywhere in the house.
Tap **OUT** on the bar's window (it says *JAM ROOM* while the tape is in the
jam room) and choose **This phone**: the jam room goes
silent, and the tape plays here about 0.8 s behind. Everything on the tape
works as usual — play, locate, the loop, mute, solo, levels — and the
playhead and meters are moved back to match what you hear, so a mute shows
`in 0.8 s` until you hear it.

Rec and Catch wait for the jam room: you hear the tape late up here, so a pass
would land off the beat. For an idea, use **Overdub on this device** (8.8);
in This phone mode its Listen and Record stop the tape here, so you don't
hear it twice (in Both they leave the jam room playing).
When you're back downstairs, tap **Play in the jam room** on the laptop or the
bench, or choose **Jam room** under **OUT**: the tape plays on from the same
spot. The bar is in the Listening Room too, so you can move the tape without
opening the Studio.

**Both** plays the jam room as usual and sends the phone a copy, for when
someone is listening elsewhere while you record.

One phone at a time. If the Wi-Fi drops for 6 s, the tape stops where it was;
the page reconnects and plays on, if it's back within 30 s and the tape is
still stopped. If the tape has gone back to the jam room meanwhile, the phone
lets it go. If the sound stops when the screen locks, tap **Tap to play here**
on the strip across the top of the bar.

**Moving between pages** keeps the tape on the phone. Both rooms and the take page join the stream again as they open, and the tape plays on in
the meantime. Most phones hold the sound back until you tap, so the bar
says *tap ▶ to play here* (in the Studio, the strip says *Still on this
phone*): tap **▶** or **Tap to play here** and it's heard again. That tap
never stops the tape. A take's page doesn't play the tape: opening a take
stops it after 6 s, where it was, and coming back finds it there. Playing a
take in the bar in the Listening Room stops it too, in This phone mode, so
the phone never plays both.

### 8.11 The crate

The crate, where clips kept from takes, the ribbon and the tape used to wait,
is no longer on the screen. Nothing was emptied: the Pi keeps what was kept
in it, and how it was routed. **GRAB** (§8.12) is how a bit of a take, or of
the feed, is kept to work with, and its Undo is the safety net the crate was.

### 8.12 The Studio's buffer

The Studio puts a buffer between the feed and the tape: the one slot that GRAB, and a
range's Cut and Copy, fill and DROP empties, out where you can work on it.

- **GRAB** (or **G**), beside Keep on the feed, copies the last 1, 2, 4 or 8
  bars you played into it -- with no tempo yet, twice as many seconds -- or,
  on the feed's selection bar, exactly the span you held. It's a copy, with
  a bar either side, so the feed can't overwrite it while you work. The
  picker starts at the tape's loop in bars (a 3-bar loop starts it at 2, a
  16-bar one at 8), so a grab fits the loop it's for; pick another and it
  stays until the loop changes. The number of bars and the input are on
  GRAB's **▾**: the input follows the armed track's until you pick one, and
  its **Armed track** goes back to following it.
- A selection on the feed has two verbs: **GRAB** (into the buffer) and
  **KEEP** (a take, on the shelf). Every KEEP says what it keeps: *KEEP 2m*
  on the feed's key, *KEEP 41s* on a selection, *KEEP 4 BARS* on the
  buffer's, and *KEEP 30s* on the instrument's pad.
- On a take, **GRAB** is the same key: the selection, or the last N bars
  before the playhead (at the take's tempo; twice N seconds without one),
  with N starting at the loop's length. In the Listening Room it is on
  **Open**, a take's page (§4.1), since a tap plays and the shelf has no sheet.
- The buffer opens, and the lanes fold to strips to make room (**Unfold**
  gives them their height back). Pick the inputs it holds -- two make two
  lanes, dropped on neighbouring tracks -- and drag **IN** and **OUT**, or
  move them with **[ ]** and **⇧[ ⇧]** a step of the snap (⌗) at a time.
  **Audition** loops it here, never through the Pi.
- **DROP ON TRACK N** (or **↵**) lays it on the armed track at the next bar
  line inside the loop, wrapping round to the loop's start when the buffer
  wouldn't fit before its end, **over what is there**; or drag it by its
  grip onto any lane, where it lands exactly where you let go. The key says
  first where it will land: *DROP ON TRACK 2 · bars 1–4*, and *· replaces*
  exactly when it will lay over a part on that track. It is never refused for
  room: a full loop is dropped over. A buffer longer than the loop starts at
  the loop's start and runs past it, and the key and the toast say so. With
  no track armed the key is off and says *arm a track*; with several armed it
  takes the first, and says so. **One undo** takes it back, and what it
  replaced comes back with it. **↵** again, with the tape stopped, lands in
  the same place and replaces its own copy (the playhead hasn't moved); while
  it plays, the next bar line has moved on, so it lands further along. A
  buffer that would end past the tape (a loop near its end) is moved back to
  the latest bar line where it fits, and the key and toast say *moved back to
  fit the tape*; only one longer than the tape is refused.
- **KEEP** (**K**) saves it on the Listening Room's shelf, at the
  tape's tempo. **TOSS** (**⌫**) throws it away, with Undo.
- **CUE** puts it on the **cue lane**, the strip above track 1, as one
  looping part (one undo). **Tap a part there to launch it on the next bar
  line**; it loops, played with the tape, until you tap it again, which
  stops it on the next bar line. **⇧-tap** does either at once. While it
  waits for its bar line the part blinks; while it plays it's lit. With the
  tape stopped a launch starts at once, and **Stop** stops the lane with the
  tape. **Solo** leaves the cue lane alone in the output, **⟲** loops a
  part or plays it once, and **dragging a part onto a track** copies it
  onto the tape there. The lane is saved with the tape, so another device
  sees it; what's playing on it never goes into a bounce.
- **A grab can be undone.** GRAB over a buffer you never dropped, kept or
  tossed -- a grab, or a range's Cut or Copy -- says so — *Replaced the buffer’s 4 BARS from the feed, never
  dropped or kept* — with **Undo**, which puts the old buffer back (and
  drops the grab it undoes). The Pi keeps exactly one replaced grab for it,
  not a growing pile: the next grab over an unused buffer lets go of the one
  before. A buffer you dropped or kept is not kept again, and says nothing; once
  the buffer has been dropped or kept, the Undo says *Already dropped or kept —
  undo the drop instead*. A range's Cut or Copy over an unused buffer says the
  same, with its own Undo (beside the Cut's, which takes the cut off the tape),
  and so does bringing back a tossed buffer over one. Only the newest Undo stays
  on screen, and a toss ends the Undo of the grab it tossed.
  The buffer is the only view of what GRAB, Cut and Copy hold.

On a phone the buffer is a sheet: pull its grip up or down, or hold it and
drag it up onto a lane to drop it there. With Play mode on, the sheet stands
above the mini player, and on a laptop's height the feed folds to its keys
while the buffer is open, so a lane or two stay in sight. The buffer and the
instrument strip take turns: see §8.13.

### 8.13 The instrument strip (a preview)

*With Play mode on (Settings › Preview features › Play mode).* Play mode is a
drawer above the bar in the Studio, not a screen over it.

- **Folded,** it's one row: **INSTRUMENT ▴**, the **KEYS** lamp, and the
  track keys and tricks as small pads. They still play, and whatever plays
  them -- a finger, the keys, a controller, someone else's phone -- they
  light. A pad lit by another hand is bright with a ring; the dim state,
  touched but not yet heard, is only ever your own.
- **Unfolded** (**INSTRUMENT ▴** again): the reel, with the loop as a ring
  round it -- bar ticks, the playhead sweeping in orange, bar.beat in its
  hub -- the four track keys, the six tricks, the punch-in FX and the bend,
  the tape mods, and CATCH, GRAB, DROP and KEEP. The reel answers the sound, not the touch:
  REV turns it backwards, STOP winds it down over the beat, ½× and 2×
  change its speed, CHOP rocks it, and BREAK leaves it turning while the
  sound cuts. It remembers whether it was open, on this device.
- **It takes turns with the buffer** (§8.12): there is
  room for one in full. Unfolding the instrument folds the buffer to a single
  line -- its name, its length, **AUDITION** and ✕ -- and a tap on that line,
  or folding the instrument, opens it again. Bringing the buffer forward (a
  **GRAB** in the feed, or its **Buffer ▴** key) folds the instrument. A
  **GRAB** played on the instrument's own pad or key leaves it open, and the
  buffer comes up as its line.
- **On a phone,** **EDIT | PLAY** sits on the mini player, and the buffer's
  sheet stands above it, so the toggle is never under the sheet. **PLAY**
  makes the bottom panel the instrument, with the sheet dropped to its peek;
  **EDIT** gives the drawers back, the sheet at the height you left it. PLAY's
  lamp lights while a pad sounds.

**Whose keys are they?** The instrument's while it's unfolded, and the
**KEYS** lamp is lit then. Folding it, or a tap on the lanes, gives them back
to editing; a tap on the strip takes them again. MIDI and touch always play.

| Key | Folded: editing | Unfolded: the instrument |
|---|---|---|
| 1 2 3 4 | arm a track | that track drops out, held |
| Q W E R | — · — · — · ● Rec | BREAK, REV, CHOP, STOP, held |
| Z X | — | ½×, 2×, held |
| T Y U I | — | ROLL, FILTER, ECHO, CRUSH, held |
| C G K ↵ | CATCH, GRAB, KEEP, DROP | the same |
| ⇧ held | — | latch: what you let go stays held until ⇧ lifts |
| Space | play/stop | play/stop |
| Esc | closes things | lets go of everything |

Keys are read by where they are, not what's printed on them; holding one
doesn't repeat it; nothing plays while you're typing; and a lost window or a
hidden tab lets go of everything.

**A MIDI controller in the Pi** is the steady way: no Wi-Fi in the way, and
nothing needs to be open.

1. Plug it into the Pi and put part of its name in **Settings › MIDI ›
   Plays the tape** (`TAPE_CONTROLLER`), then restart.
2. Its keys play the pads from note 36 (C2) up: the track keys, the tricks,
   then ROLL, FILTER, ECHO and CRUSH on 46–49 (how hard you strike one is
   its amount), then CATCH, GRAB, DROP and KEEP on 50–53. A sustain pedal
   latches. The mod wheel and aftertouch move the amount of an FX that
   controller holds (or its pedal keeps), never another hand's; the pitch
   wheel bends, CC 21–24 turn WOW, FLUTTER, DRIVE and AGE (saved once a knob
   is still for a second), and program change 0–3 picks a formula. The
   SMK-37 starts with its pads on channel 10.
3. CATCH, GRAB, DROP and KEEP run on the Pi itself: the last pass onto the
   armed track, the last 4 bars into the buffer (open on every Studio within
   a couple of seconds), the buffer onto the armed track's next free span,
   and the last 30 seconds as a take.
4. Unplug it with a pad held and the pad lets go.

**A controller in a laptop** (**＋ MIDI here** under *Playing from*) plays
too, through the browser: Chrome or Edge, over the hub's https:// address or
on localhost. Safari has no Web MIDI, so with an iPhone or iPad the
controller goes into the Pi. Its bindings are that browser's.

**MIDI LEARN.** Pick the controller under *Playing from*, press **MIDI
LEARN**: every pad shows its key on the controller (– for none). Tap a pad --
it blinks -- then play a key or turn a knob on the controller: that's its
key now, taken off any other pad. Esc cancels. A controller in the Pi keeps
what it learned on the Pi, for everyone.

**FX and the bend.** Like the K.O.'s punch-in row: held like a trick, on the grid, and gone when you let go -- nothing saved, nothing to
undo.

| FX | Sound | Its amount |
|---|---|---|
| ROLL | the slice from where it lands, again and again | the slice: 1/4, 1/8, 1/16 or 1/32 |
| FILTER | a resonant low-pass; let go, it sweeps back open over a sixteenth | the cutoff, 20 kHz down to 200 Hz |
| ECHO | a dotted-eighth throw that rings on after you let go | how much goes in |
| CRUSH | fewer bits and a lower rate | 12 bits down to 4 |

Each pad shows its amount and a meter. A key on a controller sets it by how
hard you strike it; on screen it starts where you left it, and sliding your
finger up or down on the held pad moves it. The mod wheel (FILTER) and
aftertouch move it on the controller holding it. Every screen shows it moving, whoever
moves it. **BEND**, under them, is a pitch wheel: drag it left or right to
nudge the tape's speed (up to 8 %), and it springs back to the tape when you
let go. The click stays dry under all of it. In a bounce the FX wait: it
prints the tape and its mods, never what's held, and the strip says so.

**Tape mods.** The tape's own sound, not a gesture: saved with it, undone
with ↶ like any edit, and printed in a bounce.

- **A formula** -- CLEAN, CHROME, FERRIC, WORN -- sets all four at once.
  Move a knob after and it reads *custom*.
- **WOW** is a slow wobble in pitch, **FLUTTER** a fast one, **DRIVE** tape
  saturation, **AGE** the top end going dull.
- **Drag a knob** (or focus it and use the arrows): you hear it as it
  moves, and it's saved when you let go -- one step of undo, not a hundred.
- **On a phone** the mods are the instrument's second page: swipe across the
  panel, or tap *swipe for tape mods*.

DRIVE keeps a tape near −18 dBFS RMS at the level it was, lifts a quieter
one a little (up to 4 dB at full drive) and squeezes a loud one: at full
drive, a loop at −6 dBFS RMS comes out about 10 dB quieter. That's
saturation; turn it down if it's too much. The formulas are a first guess.

### 8.14 Words in the two rooms

Two things to make, a **take** and a **tape**, and one way to listen: a tap
plays, and the bar plays it. This is every word the rooms use, in the order
you meet them. The last column says what each was called before the two
rooms, which is how parts of this guide still name it.

| Word | Means | It was called |
|---|---|---|
| **Studio** | The tape with the feed above the lanes: where you KEEP, GRAB and build. `/` opens it | Capture, the main page, the tape page |
| **Listening Room** | Every take, on shelves: a tap plays one, holding selects | Takes |
| **Rig** | Your devices and the cables between them, from the menu (☰) in the header | unchanged |
| **Feed** | Everything coming in, always recording; the last 15 minutes are kept in memory. The Studio draws it at the top, and Settings sets its length | the ring, the ribbon, Buffer length |
| **Take** | Anything you kept: a KEEP, a bounce, a phone recording or a selection of another take | jam |
| **KEEP** | Makes a take, and nothing else. Its key says how much: *KEEP 30s*, *KEEP 4 BARS* | Capture, Save as take, cutting a take |
| **GRAB** | Fills the buffer: the last bars of the feed or of a take, a selection, or a note's stretch | Copy on the feed, Send to → Tape, Send to → Clipboard, Keep as clip |
| **Buffer** | The one slot GRAB, and a range's Cut and Copy, fill and DROP empties. The Studio shows it between the feed and the tracks | the clipboard |
| **DROP** | The buffer onto the armed track, at the next bar line inside the loop; its key says where. A range's Paste and Insert keep their names | Paste |
| **BOUNCE** | Play the tape once and keep what came out of the mixer as a take, on that tape's spine (the tape's name › Bounce the loop, Bounce the whole tape, Play the last bounce) | Mix down, Cut a record |
| **Tape** | Four tracks of parts. Tapes live in the Studio: its title menu lists them | the Tape page |
| **Part** | A piece of audio on a track | clip |
| **Note** | A moment in a take, with words or without. **✎** makes one | flag, ⚑, Flag now |
| **The bar** | Along the foot of the Studio, the Listening Room and Open: the only way to play. It holds a take or the tape | the player, the dock, the deck |
| **Open** | A take's page (§4.1), from **Open ›** on the bar; the tape opens in the Studio | the take page, SIT DOWN |
| **Repeat** | The bar's ⟲ for a take: its selection, or the whole take. For the tape it is still **Loop** | Loop |
| **Tag** | A take's one tag: a name and a colour | unchanged |
| **FX** | The instrument's held effects (§8.13) | Punch-in FX |
| **● Rec** | Records onto the armed track | a punch |

Two rules that go with them. **KEEP always makes a take;** it never puts
anything on a tape. **GRAB always fills the buffer,** and a GRAB over a buffer
nobody dropped or kept says so, with **Undo**.

### 8.15 Walkthroughs

Six jobs, as buttons. Each step is a thing you press
or see.

1. **Keep it, find it again.** In the Studio press **KEEP** (its key says how
   much: *KEEP 30s*). The toast says *Kept 06:59:53 · 0:30* and where it is,
   with **Name it** and **Undo**. Open the **Listening Room** → the new take is
   first on the *Takes* shelf. Tap it → it plays in the bar.
2. **Lift a moment.** In the Studio press **GRAB** on the feed (the key says
   how much: *GRAB 8 s*, or *GRAB 4 BARS* once the tape has a tempo). The
   buffer opens, with **IN** and **OUT** to trim. If no track is armed, tap a
   track's **●**. Then press **DROP ON TRACK N**. The toast says *Dropped on track N* with
   **Undo**.
3. **Listen back, jot a note.** In the Listening Room tap a take → it plays in
   the bar. At the spot you like press **✎** in the bar → the Sketchbook
   opens over the room at that moment, playing on. Type, *Add note*.
4. **Reuse a bit.** Tap a take in the Listening Room → it plays. Let it play
   past the bit you want, then tap its **name** in the bar → Open. Press **GRAB
   4 BARS** → the Studio opens with up to four bars in the buffer (fewer if
   less had played). If no track is
   armed, tap a track's **●**. Then press **DROP ON TRACK N**.
5. **Finish it.** In the Studio tap the tape's name, then **Bounce the whole tape**, and wait as
   long as the tape is long. The toast says *Bounced as a take* with **▶** and
   **Open**. Press **Open**, then **Download** (**Share** on a phone) → an MP3.
6. **Tidy up.** In the Listening Room hold a take (a finger or a pen for half
   a second; ⇧-click with a mouse) → it is picked and the select bar rises with
   **Done**, **★**, **Tag**, **Export** and **Delete**. Tap another to pick it
   too. **Tag** → choose a tag, which gives it and closes the sheet (with no tags
   yet the sheet offers **+ New tag**, and **Close**). **Delete** → the
   toast says *Deleted 2 takes* with **Undo**. **Done** puts the bar away.

## 9. Tips in the app

*Today.*

**How you get help:**

- **On a computer,** every button has a tooltip.
- **Anywhere,** open the menu (**☰**) and pick **Help mode**, then tap
  anything to read its tip instead of using it. Every tip has **Done**,
  which leaves help mode (so do Escape and **Help mode** again), and **☰**
  is lit while it's on. **☰** and the phone's mini player window are the
  exceptions: each shows its tip and still works, so the menu and the
  player's keys can be read too.
- **The first time you open** the take page or the Studio, three short
  hints point at the gestures that matter most. They're remembered per
  device.
- **The menu's guide** opens this guide at the section for the page you're
  on, and every tip links there too. The app serves it at `/guide.html`.

**One source of truth.** The tip text lives in `web/static/lib/help/tips.js`
and in the table below, and a test fails if the two disagree, or if a control
has no tip.

| Control | Tip |
|---|---|
| Hindsight | Back to the Studio, from anywhere |
| Studio (tab) | The feed, Keep and the tape on one page. The lamp on its faders is the feed: green while it records |
| Listening Room (tab) | Every take, to search, filter, sort and open |
| ☰ (header) | The menu: Settings, the rig, help mode, the guide and Releases. A dot on it means a release is waiting, or the rig needs a look |
| The rig (menu) | Your devices and the cables between them, each cable a setting. Its lamp turns amber when a cable waits for a restart, or the tape is in a tap you're recording from |
| Shelf · List | The takes on shelves, a month to a shelf, or in a list by month and day. This device remembers which |
| ✎ Note | A note at the playhead, with the cursor in its words |
| GRAB (a take) | Into the Studio's buffer, and the Studio opens: the take's selection, else the last bars before the playhead (as many as the tape's loop is long) |
| GRAB (a note) | This note, to the next note or eight bars, into the Studio's buffer |
| Tag (a take) | The take's one tag |
| Made from | The take this one was cut from: a tap opens it |
| From this take | What was cut from this take: a tap opens one |
| Earlier bounces | Earlier bounces of this take's tape: a tap opens one |
| All › (a shelf) | The shelf as a list, where Select and Play all are |
| ‹ The room | Back to the shelves, at the shelf you opened |
| Cancel (search) | Empty the search and go back to the shelves or the list |
| Show everything | Turns off the filter that's narrowing the shelves |
| KEEP | Keep the last 30 s, 2 m, 7 m or all of what you just played as a take |
| ▾ (KEEP) | How much KEEP keeps: the last 30 s, 2 m, 7 m or all of the feed. KEEP keeps that from then on |
| ▾ (GRAB) | How much GRAB takes, the last 1, 2, 4 or 8 bars, and from which input: the armed track's, unless you pick one |
| Feed (lamp) | The feed's lamp: green while it records, amber or red when something wants a look. It opens the feed's readouts, its input channels and the way to the rig |
| Flag now | Mark this moment. Any take that includes it gets a flag here |
| Ribbon | The last 15 minutes, recent end stretched. Hold and drag to select a span; tap a flag for its options |
| Save as take (ribbon) | Save exactly the span you selected on the ribbon as a take |
| × (ribbon) | Forget the span selected on the ribbon |
| Save from here to now | Save a take that starts at this flag and runs to now |
| Delete flag (ribbon) | Remove this flag. Takes saved later won't carry it |
| Phone | Record from this phone's mic or a plugged-in input, straight into Hindsight |
| Settings | The version, Releases and the guide, then preview features for this device, then the Pi’s interface, feed, MIDI and tape. The Pi’s changes apply when Hindsight restarts, which empties the feed |
| Releases | Every release you can install, newer or older, and what moving to one changes. Hindsight restarts, so the ring starts empty |
| All takes | Every take, on a page of its own, to search, filter and sort |
| Search | Find a take by what's on its spine, the day (today, October), its tag, its tempo or its notes. The list opens right under it |
| Filters | Show only starred takes, this week's, or those with MIDI |
| Tags | Show only the takes with this tag, or only the untagged. Press the lit one again to see everything |
| Edit tags | Make, rename, recolor or delete tags. They are the same on every device |
| Sort ▾ | Newest or oldest first, by month and day; the longest first; or by name. The shelves follow it too |
| Tag (take) | Give this take a tag and its cassette wears the tag's color. Press the lit tag again to take it off |
| Cuts | The takes saved from parts of this one. They fold in here to keep the shelf short; tap one to see it |
| Earlier mixes | This tape's earlier mixdowns. The newest stands on the shelf for them all; tap one to see it |
| ‹ (folded take) | Back to the take this one is folded into on the shelf |
| Open | Open the take to select, loop, save or share part of it |
| ▶ Play all | Play the takes shown, one after another, each from its In to its Out. Again to stop |
| Select | Pick several takes to star, tag, export or delete together. Holding a take does the same: a finger or a pen holds, and a mouse uses ⇧-click |
| ★ Star (selecting) | Star the picked takes, or unstar them if they all are |
| Tag (selecting) | Give the picked takes a tag, or take it off again: the tag they all wear is lit. The Listening Room only |
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
| Previous take, Next take | In the take's menu, by name: the take before or after this one in the list |
| Delete this take | In the take's menu: to the trash in one tap, and on to the next take. The toast has Undo |
| from … | This take was saved from another one. Tap to open that one |
| ↶ | Undo your last change to this take: a flag, the selection, the name, tempo, downbeat or lanes |
| Help mode (menu) | Tap anything to read what it does, instead of doing it. Done, on the tip, leaves it |
| The take's name ▾ | This take's menu: rename it, the takes before and after it in the list, its downloads, the downbeat back to the start, and Delete. Under 1000 px its tag too, and on a phone its MIDI |
| Tag… (the take's menu) | Under 1000 px, where the header has no room for it beside the star: the take's one tag |
| Reset the downbeat | Put the downbeat back at the start of the take |
| The guide | How Hindsight works, in plain words |
| Overview | The whole take, in the bar. Tap to move the playhead there; drag the window to move along it; double-tap to see it all. With it focused, ← → move a second |
| Waveform | Drag to move along, pinch to zoom. Hold, then drag, to select. Tap to move the playhead; tap twice to flag |
| ▶ | Play from the playhead |
| To In (take) | Back to In; with nothing selected, to the start of the take |
| ⟲ Loop (bar) | Loop what’s in the bar: the tape’s loop, or a take’s selection (the whole take without one). For a take it is called Repeat |
| ⏏ (bar) | Stop the take in the bar and put the tape back in it |
| Open › (bar) | Open what’s in the bar on its own page: the take, or the tape in the Studio. A double tap on a spine opens a take too |
| The bar’s strip | The whole tape or take: tap or drag to move the playhead. With it focused, ← → step and Space plays |
| ✎ (bar) | A note at the spot you are hearing: the Listening Room’s Sketchbook opens, and the take keeps playing |
| ⟲ Repeat (bar) | Repeat the take in the bar: its selection, or the whole take without one |
| The mini player (phone) | On a phone: a tap, or a drag up, pulls the player up over the page — the whole bar. A swipe down on its grabber or its reels, Back or Esc puts it away |
| ● on the mini player (phone) | Record from this phone, straight into Hindsight: its take goes on the shelf. Tap again to stop. In the Studio, ● is the tape’s: hold it to record from this phone instead |
| ▾ beside ● (phone) | Recording from this phone: start or stop it, pick its input, or see its level first |
| The grabber (bar) | Fold the bar to one row, or unfold it: a tap, or drag it down to fold and up to unfold. Gives the tape lanes room. On a phone, it puts the player away |
| The tempo (the bar’s display) | The tempo of what’s in the bar. In the Studio, with the tape, a tap opens its menu: call the loop more bars or fewer |
| The source (the bar’s display) | What the bar plays: the tape, the take, or the live feed. A tap chooses another: the tape, the live feed, one of the last few takes, or the shelf |
| Where it plays (the bar’s display) | Where what’s in the bar plays: the tape in the jam room, on a phone or both; a take or the feed on this device. A tap opens where the tape plays |
| GRAB (the feed, in the bar) | GRAB the bars around where the feed is into the Studio’s buffer, and go there |
| ⟲ Loop | Repeat the selection instead of playing straight through |
| In | Start the selection at the playhead |
| Out | End the selection at the playhead |
| ⚑ | Drop a flag at the playhead |
| ◂⚑ ⚑▸ | Jump to the previous or next flag. Past the first or last, on to the take before or after |
| ⚑ N | The take's flags as a list, with their names and times. Tap one to play from it |
| ↺ 5 s | Back five seconds, playing or not. Key: J |
| Delete flag | Remove this flag |
| ◂ ▸ beside In and Out | Move that end of the selection to the next snap line, or by 10 ms |
| Downbeat ◂ ▸ | Move the downbeat by 10 ms, or by the Snap step with Snap on. It stays here once the take has a tempo |
| Downbeat time | Tap to place the downbeat exactly, in the editor |
| Set to playhead | Put the downbeat where the playhead is |
| Clear | Forget the selection. The take itself is untouched |
| In / Out time | Tap to place it exactly: the view centres on it and the editor opens. Tap the ruler's "1" to place the downbeat |
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
| Level | Normalize: play and share the selection with its loudest moment just under full scale |
| Save as take | Make a new take of just the selection |
| Name (Save as take) | Name the new take, then Save. On the Listening Room’s shelf it folds in with this take. Cancel saves nothing |
| Share | Send the selection from your phone as an MP3 |
| More | The DAW bundle, the WAV and MIDI downloads, Split here, and delete |
| DAW bundle | The selection's WAV and MIDI, lined up, in a zip for a DAW |
| MIDI (the take's menu) | Under 860 px: watch the take's MIDI rise out of a keyboard as it plays. Wider, it is beside the waveform |
| Lane | Tap for this lane's menu: collapse, show as drums or notes, or hide |
| Send to | Send the selection, or the whole take without one, to the tape or the clipboard |
| Send to → Tape | Put the take, or the selection, on the loaded tape: by its tempo and downbeat if it has them, else at the playhead or as an empty tape's first loop. The line under it says which |
| Send to → Clipboard | Put the take, or the selection, on the clipboard, to Drop or Insert on a tape |
| The tape's name ▾ | The tape’s menu: your tapes (load one, or make a new one); rename or duplicate this one; share the mix, bounce it, export its stems or play its last bounce; record from this phone; and, last, delete it |
| A tape in the list | Load this tape: the transport plays the loaded one |
| New tape | Start an empty tape. Its first loop sets the tempo |
| Rename… | Give this tape a new name |
| Delete this tape… | Delete the tape you have open, after a sheet that names it and what is on it: it can’t be undone. The most recent other tape opens in its place (a new one, if it was the last). Audio it shares with others stays |
| BPM, Bars (empty tape) | Start from a tempo instead of a first loop |
| ↶ ↷ (tape) | Undo or redo the last change to the tape: up to 100 steps. Keys: ⌘Z or Ctrl-Z, with ⇧ to redo |
| Tape overview | The whole tape, in the bar: what’s on each track, the loop in amber. Drag the box to move what the lanes show; tap to move the playhead there; double-tap to go back to the loop. With it focused, ← → move a bar |
| Sections (tape) | Named spans of the tape. Hold and drag to make one; tap one to select its bars, again to rename it; drag its edges to resize it |
| Intro, Verse, Chorus… (section) | Call the section this |
| Name (section) | Call the section anything else |
| Colour (section) | The section's colour on the strip |
| Remove (section) | Take the section away. The audio under it stays |
| Duplicate section | Play this section twice in a row: a copy right after it, and the rest moves later |
| A lane | Tap a clip to select it: the action bar acts on it, and a double-click opens the inspector beside the lanes. Drag its edges to trim it, the squares on its top edge to fade it in or out, or its ⟳ corner (bottom right) to repeat it. Shift, ⌘ or Ctrl with a click, or Select more, selects several. Hold a clip, then drag, to slide it along its track or onto another. Hold an empty part, then drag across bars and lanes: a range, for the action bar's Cut, Copy, Paste, Insert and Delete time; the loop follows it unless it's locked. Tap elsewhere to move the playhead there. Drag sideways to pan, pinch to zoom (⌘ or Ctrl with a scroll on a computer). A punch shows in red as it records |
| A track header | Its number and name: tap to select it (and make it the record track, if one is armed), again for its inspector; on a touch screen › opens it in one tap. Keys 1–4, or ↑ ↓, arm it |
| ● (track) | Arm it, making it the record track: Catch, ● Rec, a free loop's tap and Overdub on this device go onto it, on every device. Lit red on the one that is. A tap moves the arm here, and holding it with a finger, or Shift-click, arms it as well, or takes it off |
| Arm it | In the inspector of a track that isn’t armed: arm it, making it the record track. The arm moves here, as a tap on its ● does |
| Input (track) | What this track records from, lit green while there's signal on it. Tap to choose another from a menu, with each one's meter: it doesn't arm the track |
| M, S | Mute this track, or solo it: only soloed tracks play. On a touch screen they are in its inspector (›) |
| › (track) | On a touch screen: this track’s inspector, with its mute, solo, level and pan, in one tap. It arms nothing. Lit yellow while the track is muted, blue while it is soloed |
| Track level | The track's level into its bus, -30 to +6 dB. Tracks start at -6 |
| ▶ (tape) | Play or stop the tape. Key: Space |
| To the loop’s start (tape) | Back to the loop’s start; with Loop off, to the top of the tape |
| Ruler (tape) | Tap: the playhead to that bar. Hold, then drag: those bars on every track, a range, which the loop follows unless it's locked. Drag sideways to pan, pinch to zoom |
| Fit | Back to the loop and a bar either side, after a pinch, a pan, or the playhead paging the view along |
| Snap (⌗) | What a drag snaps to: a slid clip, a trim, a fade, or a range drawn on the lanes. A bar, a beat, an eighth, or nothing |
| Lock the loop (⌗) | Lock the loop where it is: a range you draw leaves it alone, so you can edit elsewhere while it plays on. Unlocked, the loop follows the range |
| Fold the tracks (⌗) | Fold the tracks away, or show them again: the ruler, the buffer and the bar stay. A DROP from the buffer shows them, so you see where it landed |
| ⌗ (the ruler) | The View menu: what a drag snaps to, the loop’s lock, Fit, folding the tracks, and on a touch screen whether Insert and Delete time ask first. It says the snap, and shows the lock while it’s on |
| Layer / Replace | Onto audio already there: layer on top of it, or replace it |
| Repeat to the loop’s end | Copies of this clip end to end, to the end of the loop: one bar through four |
| Track name | What’s on this track, for you: chords, bass… |
| Pan | Where this track sits between left and right |
| ● Record (tape) | Records the armed track (its ● lit) from its input. Stopped: it's ready (the key glows), then ▶ counts in a bar. Playing: records from the next bar, marked on its lane. Tap again to keep it. Key: R |
| RECORDING | Shows only while a punch is recording onto the tape |
| The metronome | A click on every beat, on bus A. On by itself only while the tape is empty. Key: M |
| Tap (empty tape) | Tap where the loop starts, then where it comes round: each tap snaps to the strongest attack near it |
| ⟲ Loop (tape) | Loop the bracket, or play on to the end of what’s recorded. Key: L |
| 1 bar, 2, 4 | Catch the last bars you played, ending on the last bar line, where they were played |
| Clip level | This clip's level within its track |
| Nudge | Move the clip a few milliseconds, for a part a little early or late |
| Fade in, Fade out (clip) | Fade the clip in from silence, or out to it: 10 ms, a part of a beat, a beat or a bar. Off leaves just the 3 ms declick. Any length: drag the square on the clip's top edge |
| Fade curve (clip) | The fade's shape: Equal power (even, the default), Linear, S-curve (slow at both ends) or Exponential (drops early and tails off, as a sound dies away) |
| Reverse (clip) | Play this clip backwards, or forwards again. Undo puts it back |
| Share as WAV (clip) | Send just this clip, at its level, to another app; a long one downloads |
| Remove (clip) | Take this clip off the tape. Undo brings it back |
| Start here, End here (clip) | Trim the clip's start or end to the playhead, for a clip too short to drag. What's trimmed is kept: drag or trim back out |
| Cut (action bar) | Copy the selected clips as they lie, then take them off the tape: Paste lays them out again, and one Undo puts them back. Key: ⌘X or Ctrl-X |
| Bars (action bar) | What the selected clips cover, on their tracks, out to the snap, as a range: drag its edges in for part of a clip, then Cut, Copy, Paste or Delete time |
| Split (action bar) | Cut the selected clip in two at the playhead, lit while the playhead is inside it. A clip layered with it there is cut too. Key: S |
| Copy (action bar) | Copy the selected clips as they lie, on their tracks: Paste lays them out again. Key: ⌘C or Ctrl-C |
| Duplicate (action bar) | Lay a copy of the selected clips right after them, and select the copy. Key: ⌘D or Ctrl-D |
| Reverse (action bar) | Turn each selected clip round. One undo turns them all back |
| Move here (action bar) | Move the selected clips so the first starts at the playhead, keeping their spacing and tracks |
| Details… (action bar) | The clip in the inspector, beside the lanes: its level, nudge, fades, Align and Share. Key: Enter, or double-click the clip |
| Inspector grip | On a phone: tap to pull the inspector up to most of the screen, or back to half; drag it down to its title |
| Select more (action bar) | Tap clips to add them to the selection, or take them off. On a keyboard, Shift, ⌘ or Ctrl with a click does the same |
| Remove (action bar) | Take the selected clips off the tape. Key: Delete |
| Done (action bar) | Let go of the selected clips. Esc does too |
| Cut (range) | Take the range's bars on its tracks to the clipboard, leaving silence there: the OP-1's lift. Key: ⌘X or Ctrl-X |
| Copy (range) | Put the range's bars on its tracks on the clipboard, a clipboard track for each. Key: ⌘C or Ctrl-C |
| Paste (range) | Put the clipboard at the range's start, from its first track down, over what's there: the OP-1's drop. Key: ⌘V or Ctrl-V |
| Insert (range) | Put the clipboard at the range's start and push everything after it later, on every track |
| Delete time (range) | Cut the range's bars out of every track and close the gap: everything after moves earlier |
| Done (range) | Let go of the range. Esc does too |
| Align | Line the clip up to the sample: the editor bar opens on its first hit |
| Done | Close the editor. Esc does too |
| ZOOM on the tape | Drag sideways to zoom about the clip’s first hit: right is closer |
| POSITION on the tape | Drag sideways to move the whole clip: zoomed out it travels bars, zoomed in it moves samples |
| ◂ ▸ on the tape | Move the clip a millisecond, or a sample when zoomed right in |
| ▶ on the tape | Play from a second before the hit, or pause |
| Hit → Grid | Move the clip so its first hit lands on the nearest line of the Snap setting, or the nearest beat with Snap off |
| Track picker | Choose the track to line this clip up against |
| Hit → Track | Move the clip so its hit lands on the nearest hit of the chosen track |
| Catch | Catch the last time round the loop onto the record track, from its input; pointing at it outlines the pass on its lane. It lights after one whole pass of the loop: until then a press says why. The last 1, 2 or 4 bars are in the track's inspector and under its ▾. Key: C |
| ▾ (Catch) | What Catch takes: the last pass, or the last 1, 2 or 4 bars, onto the armed tracks. One that can't go yet says why |
| Passes | Every time round the loop, kept. Tap one to put it on the record track |
| Join | Join this clip and the half that was split from it back into one |
| ×2 | Double the loop, copying what's in it over what follows. On the action bar while the range is the loop |
| Ask before Insert and Delete time | In ⌗’s View menu, on a touch screen: the first tap on Insert or Delete time shows what it will do, and the second does it. Turn it off to do it on the first |
| Duplicate | Copy this whole tape. Costs no disk space |
| Mix down | Play the loop, or the whole tape, once and save what came out of the mixer as a take: FX and live playing included |
| Bounce | Play the loop, or the whole tape, once and keep what came out of the mixer as a take: FX and live playing included. Its toast has ▶ to hear it and Open for its page |
| Play the last bounce | The newest take bounced from this tape, named under it: ▶ to hear it, Open for its page. For when the bounce's toast has gone |
| Share the mix | Send the whole tape as an MP3: the Pi renders every track at its level and pan, then Share opens the phone’s share sheet. It works with the interface off, and goes nowhere on the shelf. It’s dry: no Sidekick EQ or FX, nothing played live (that’s Bounce) |
| Export stems | Download a zip with a WAV per track from bar 1, and a .mid with the tempo, for a DAW |
| Bus A / B | Which Sidekick channel this track plays through, for its EQ and FX |
| Source chip | The input of the track the inspector shows (the record track's, while one is armed): what ● Rec and a catch take from it. Choosing one changes only that track. Its meter shows what is coming in. ● clean: none of the tape is in it. ○ the tape is in it too |
| 🎧 Overdub on this device | Play the tape here, not in the jam room, and record a part over it that goes onto the record track where you played it |
| The loop / The whole tape (overdub) | Play the loop round and round, or the whole tape once |
| ♩ Click (overdub) | A click on every beat, in what plays here |
| Round trip (overdub) | How late what you play reaches the recording, from hearing the tape: a part lands that much earlier. −5 and +5 move it by hand, e.g. for Bluetooth headphones |
| Calibrate (overdub) | Measure the round trip: six clicks through the speaker, heard through the mic. Headphones off, somewhere quiet |
| ▶ Listen (overdub) | Play it here, without recording |
| ● Record (overdub) | Record over it; Stop keeps the last full pass, as a punch does, and puts it on the track. The recording is saved as a take too |
| Clock → (tape) | Who follows the tape's MIDI clock (TAPE_CLOCK=lead); ● while they're running |
| SYNC (the bar's display) | While the tape plays in the jam room, how playback and recording line up. Green: to the sample. Amber: by the clocks, nudge a catch if it's off. Red: not lined up yet. Out while it is stopped or plays on a phone |
| Jam room / This phone / Both | The jam room plays through the Sidekick and records; this phone plays a backing track here, about 0.8 s behind; both does both |
| Play in the jam room | Take the tape back from the phone: the jam room plays it from the same spot, and Rec and Catch come back |
| Grab | Copy the last bars of the feed (with no tempo yet, the last seconds) into the buffer, from its sources, to trim and drop. G |
| Last 1 2 4 8 (grab) | How many bars Grab takes. It starts at the tape's loop length, so a grab fits the loop it is for; with no tempo, twice as many seconds |
| Feed source | Which input channel Grab captures into the buffer |
| Grab (ribbon) | Put exactly the span you selected on the ribbon into the buffer |
| KEEP (ribbon) | Keep exactly the span you selected on the ribbon as a take; the key says how long it is |
| Buffer ▴ / ▾ | Open or close the buffer: what you grabbed last waits there |
| Buffer grip | Pull the buffer up or down. Hold it, then drag onto a lane, to drop it there |
| Sources (buffer) | Which inputs the buffer holds, a lane each, all over the same span; they drop on neighbouring tracks |
| Audition | Loop the buffer on this device, never through the Pi, so the jam goes on |
| Unfold | Give the lanes their height back, and leave the buffer open |
| ✕ (buffer) | Close the buffer. What you grabbed stays in it, for Buffer ▴ or another drop |
| Drag to a lane | Drag the buffer onto a lane: that lane opens, and a ghost shows where it lands, on the grid |
| The buffer's window | What was grabbed, a bar either side. Drag IN or OUT, or the squares on its top corners for fades |
| Cue | Put the buffer on the cue lane above the tracks, as one looping part. Tap it there to launch it on the next bar line (⇧ starts it at once) and again to stop it; drag it onto a track to put it on tape. One undo. |
| Drop on track | Lay the buffer on the armed track (with several armed, the first) at the next bar line inside the loop, over what is there: the key says where, and "replaces" when it will. Never refused for room. One undo. Stopped, ↵ again lands in the same place and replaces its own copy; playing, the next bar line has moved on. ↵ |
| KEEP (buffer) | Save the buffer as a take on the Listening Room's shelf, its lanes summed, at the tape's tempo; the key says how long it is. K |
| Toss | Throw the buffer away; Undo brings it back. ⌫ |
| In ◂ ▸ / Out ◂ ▸ | Move IN or OUT a step of the snap (⌗): [ and ] for IN, ⇧[ and ⇧] for OUT |
| Gain (buffer) | The buffer's level, on every lane |
| Normalize (buffer) | Bring the loudest lane's loudest moment to just under full scale, the lanes kept in balance |
| Reverse (buffer) | Play the buffer backwards, or forwards again |
| Fades (buffer) | The fades' curve: equal power, linear, S-curve or exponential. Drag the corners for their length |
| Instrument ▴ | Play mode as a drawer. Folded: the track keys and the tricks as small pads, still live. Unfolded: the reel and every pad, and the computer's keys play it |
| Keys (instrument) | Lit while the computer's keys play the instrument: R is STOP then, not ● Rec, and 1 drops track 1 out. A tap on the lanes, or on this, gives them back to editing |
| A pad | Hold it: dim when touched, bright when it's heard, on the next grid line. Let go and it stops, in time. Bright with a ring: another hand is playing it |
| Playing from | Touch, the keys and every controller play at once; this picks which legends the pads show, and the controller MIDI learn binds |
| ⌗ (instrument) | Where this device's presses land: at once, or the next 16th, 8th, beat or bar |
| Lead | How long a press takes to be heard from the Pi: play that far ahead of the beat |
| MIDI learn | Every pad shows its key on the controller (– for none). Tap a pad, then play a key or turn a knob on the controller. Esc cancels |
| Catch, Grab, Drop, Keep (instrument) | The Studio's verbs from the instrument: the last pass onto the armed track, the last bars into the buffer, the buffer onto the armed track, and the feed (or the open buffer) as a take. C, G, ↵, K |
| Edit / Play (phone) | On a phone: Play makes the bottom panel the instrument; Edit gives the drawers back. Play's lamp lights while a pad sounds |
| Studio (rig) | Back to the Studio |
| Socket | Drag from it to another socket to plug a cable in, or choose it and then where it goes. A pull on a plug unplugs it. Choose it to see what it carries |
| Plug it into | Plug a cable from the chosen socket into this one: it writes the setting the cable is |
| Unplug (rig) | Take this cable out. A cable that's a setting applied on restart stays on, dashed, until Hindsight restarts |
| Arm it (rig) | Arm or disarm this track. Every armed track records at once, each from its own input, as one undo |
| Move tracks to bus | Move the tracks playing into this tap to the bus it doesn't hear, as one undoable edit, so a recording from it is clean |
| Use these taps | Make the inputs a catch can take from this interface's own taps (TAPE_SOURCES). Applies when Hindsight restarts |
| What a KEEP writes | One tap, or every input, written to each take. Applies when Hindsight restarts |
| Where the tape plays (rig) | The room, a phone, or both: the same as the Output button |
| Label it | Name what's plugged into this jack: it shows on the tap and the track's input. A label routes nothing |
| Restart (rig) | Restart Hindsight so the dashed amber cables take effect. The ring starts empty, so capture anything you want to keep first |
| Done (rig) | Close the inspector and let go of the chosen socket |
| Punch-in FX | ROLL, FILTER, ECHO, CRUSH: hold, like a trick. Slide your finger up or down on one to move its amount, which every screen shows; a controller's velocity, mod wheel and aftertouch move it too. T Y U I |
| Bend | Drag left or right to nudge the tape's speed, up to 8 % either way; let go and it springs back to the tape. A controller's pitch wheel does the same |
| Formula (tape mods) | A starting point for the tape's sound: each sets WOW, FLUTTER, DRIVE and AGE. Saved with the tape, and ↶ undoes it. Program change 0–3 on a controller |
| A tape mod's knob | Drag up or down, or use the arrow keys: heard as it moves, saved with the tape when you let go, one step of undo. CC 21–24 on a controller |
| Tape mods (phone) | On a phone the tape mods are the instrument's second page: swipe across the panel, or tap here |

## 10. When something's off

| You see | It means | Do |
|---|---|---|
| The dot by ↶ is amber | Playback and recording are lined up only by the clocks, to a few milliseconds; it locks once the tape plays something with a clear attack on bus A or B | Play the tape for a few seconds, with drums or another percussive part on it. Catches still work meanwhile; nudge one if it's off |
| The dot by ↶ is red | Nothing is lined up yet: the tape hasn't played since Hindsight started, or there's no output | Press ▶. If ▶ reads *no output*, check the Sidekick is on and plugged in |
| A source chip shows ○ | The tape is playing through that channel, so catching from it also records the tape | Catch from aux, or move the track to the other bus |
| A new clip is a flat line, and the toast said *it's silent: nothing came in* | It was recorded from a source with nothing in it, usually aux with nothing plugged in. ● Rec records from the record track's input, named on its header | Undo, tap the track's input, choose the one whose meter moves when you play, and record again |
| "Too long for the ring" on Mixdown | The selection is longer than the last 15 minutes can hold | Mix down in parts, or raise `RING_SECONDS` |
| "…a tape track holds 20 minutes" | What you sent is longer than a track, or would run past its end from where it lands | Send a shorter part, lift something, or raise `TAPE_LENGTH_S` |
| *Phone* says the microphone needs a secure page | You're on the plain `http://` address | Use the HTTPS address from `tailscale serve` |
| *Reconnecting…* at the top of a page | The page can't reach the Pi: it's off or restarting, or the tablet's Wi-Fi is still waking up | Nothing: it tries again every few seconds and catches up on its own; no refresh needed |
| The recorder says *Reconnecting…* | The phone lost the Pi for a moment; the audio is kept on the phone meanwhile | Nothing: it resends when the Pi is back. Keep the page open |
| "The recording paused while the page was hidden" | The phone locked or you switched apps, and the browser stopped the mic | The take skips that stretch. Keep Hindsight in front while recording |
| A take is labelled *Phone (partial)* | The recording never got its Stop: the page closed, or the Pi restarted mid-recording | It holds everything that reached the Pi |
| A capture or catch is refused for disk space | Free space is under `MIN_FREE_GB` | Empty the trash, or delete old takes |
| A take says *⚠ 2 dropouts* | The capture lost audio twice while it was recorded: the interface overran because the Pi fell behind, or the ring's writer did. The take has a short gap at each ⚠ | Listen at each (⚑ N lists them). If it keeps happening, look for what else is running on the Pi, or raise `INPUT_LATENCY_MS` (the interface's buffer, which rides out a stall) |
