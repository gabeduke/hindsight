# Setting the tempo

Not agreed yet: this is the map and the choices, for Gabe. His words, on
2026-10-30, after trying a tape: *"can't set the tempo anywhere."* He is
right. A tempo can be typed once, on an empty tape, and never again.

## Where the tempo lives today

A tape's tempo is one `tape.Grid{Frames, Bars}` in its undoable state
(`internal/tape/model.go`): the length of the first loop, and how many bars
of 4/4 it is. The BPM is derived (`Grid.BPM`), because tempos don't divide
into whole frames. Bar 1 is always tape frame 0. Everything that knows a
bar reads `frames / bars`.

How a tape gets a grid, and the only ways it changes:

| How | Where | When |
| --- | --- | --- |
| Type a BPM and bars | `#set-tempo`, `PATCH /api/tapes {tempo:{bpm,bars}}` | empty tape only; refused once any track has a clip |
| The first loop's length | Tap (`tap.go`), a first-loop drop (`engine.go`, `send.go`) | no grid yet |
| A take with a tempo, sent to an empty tape | `send.go` (`TempoSet`) | tape has no audio |
| New tape at the last tape's BPM | `store.go` `Create(bpm)`, `LastTapeBPM` | creation |
| Relabel the bars | the tempo's menu (`renderTempo`, `PATCH {bars}`) | any time: same frames, ½ or ×2 the BPM |

So once audio is down the only "tempo change" is ½ / ×2, which moves no
bar line that wasn't one already.

What shows a tempo, and where it comes from: three sources (the tape's
grid, the MIDI clock in, a take's measured tempo), six places.

| Display | Source |
| --- | --- |
| The bar's tempo key, `#np-tempo` (`lib/bar/display.js`) | the tape's grid in the Studio; a take's `bpm` when a take plays |
| The Studio's stats, `#stat-tempo` ("Tempo, from the MIDI clock") | the clock in (`midi.Clock.BPM` over 8 s, `/api/status`) |
| Capture's tile, `#capture-stat-tempo` (`app.js`) | the clock in; `midi.FixedClock` in the demo |
| The empty tape's form, `#new-bpm` | `suggest_bpm`: the clock, else the newest take's tempo |
| A take's spine, Open, the List | the take's sidecar `bpm` (`TempoFrom`: clock, measured, or you) |
| The keyboard's screen (`internal/api/keyboard_screen.go`) | the tape's grid |

The clock in never reaches the tape: it stamps takes (their `.mid`
tempo map, `midi.BuildTempoMap`) and fills the two stats. A tape playing
at 92 with the Bento at 96 shows both numbers, on different screens, and
nothing says they disagree.

What reads the grid, and so moves if it moves:

- **The click** and **the clock out** (`clock.go`, `TAPE_CLOCK=lead`):
  pulses are laid from the bar line before them. A new grid while playing
  is already handled as a jump: Stop, then Start / Song Position again.
- **Quanta**: snap (`lib/tape/range.js`), loop edges a bar at a time,
  sections on bar lines (`sections.go onBar`), free spans (`freespan.go`),
  punch-in at the next bar (`record.go`), the count-in, the pads in Play
  mode (`lib/play/clock.js`, which assumes bar 1 is frame 0).
- **Catch**: "the last pass" is the cycle log (`transport.go`, the loop's
  real passes, by the loop's frames, not the grid's); "the last N bars"
  and a punch with the loop off are bars of the grid.
- **GRAB and cue clips**: a grab records the tape's `BarFrames` and its
  downbeat; a cue clip's `BPM` comes from that (`grab.go`). Its handles
  are a bar long.
- **Export** (`export.go`): the conductor track is one tempo, the grid's,
  with the loop and sections as markers.
- **Send** (`send.go`): a take lands on the bar lines only if its tempo is
  the tape's to 0.1%; otherwise at the playhead, with a warning.

The audio never reads the grid: a clip is frames from a WAV, played 1:1.

## Three ways to change the tempo with audio down

### (a) Varispeed: play everything faster or slower

The tape's rate changes (×1.04), pitch with it, like a real tape machine.
The grid's frames stay; the BPM displayed is `grid BPM × rate`.

- **Cost:** a resampler on the render path for every track (there is one,
  `audio/resample.go`, used offline), and the transport counting in tape
  frames at a non-integer rate against output frames. Medium-large, and on
  the hot path of the Pi.
- **Breaks:** the position map and cycle log turn fractional (output
  frames ≠ tape frames), so Catch's "last pass" maps back through the
  rate; a catch of live audio at ×1.04 lands on a tape playing slower than
  it was heard, so it would have to be resampled in, or the catch refused
  while varispeed is on. Clock out follows naturally (it scales). Cue
  clips play at the tape's rate or their own: a choice. Export renders
  at the rate, or writes the grid's tempo and a note. Pitch moves, which
  is the sound of it: fine for a nudge (±3%), wrong for 92 → 120.
- **Good for:** following a clock that drifts, matching a song a few BPM
  off, a performance gesture (it is the OP-1's tape speed).

### (b) Stretch: re-render the audio at the new tempo

An offline time-stretch of every clip (new WAVs in the pool), pitch kept.

- **Cost:** a stretcher (none in the repo; rubberband-class quality is a
  C dependency, or a WSOLA of our own that sounds like one), minutes of
  CPU on a Pi for a full tape, and a pool that doubles each time.
- **Breaks:** nothing downstream, once done: the result is a tape at the
  new tempo. But it is destructive in feel (undo restores the old clips,
  the new WAVs stay until GC), artefacts on drums and transients, and every
  edit waits on it. Cue clips and the clipboard stay at the old tempo
  unless stretched too.
- **Good for:** a bounce or export at another tempo. Not for a jam.

### (c) Re-grid: move the bar lines, leave the audio

The grid gets a new bar length; every clip, the loop and the cycle log
keep their frames. Bar 1 stays at frame 0.

- **Cost:** small. The grid is already one value every reader takes
  fresh; the click and clock out already treat a new grid as a jump. The
  change is letting `PATCH {tempo}` through on a tape with audio, as a
  re-grid, and a key to send it.
- **Breaks**, by design, until the audio is played again to it:
  - **Alignment:** clips that sat on bar lines now don't. Snap, sections
    and loop edges snap to the new lines; existing sections stay where
    they are (`sections.go` already keeps one off a bar line).
  - **The loop:** keeps its frames, so a loop of 4 bars at 92 is 4.17 bars
    at 96 and the click goes out of phase at the wrap. The rule could be
    instead: the loop's Out moves to keep its bar count (the audio then
    cuts off early or plays silence late). Decision 2.
  - **Catch:** "the last pass" is unaffected (the cycle log is frames);
    "the last N bars" catches N of the new bars.
  - **Clock out:** followers are stopped and restarted on the new tempo,
    at the next sixteenth; while standing, the idle clock just changes.
  - **Cue clips:** keep the BPM they were grabbed at, so a pad grabbed
    before the change now disagrees with the tape. Shown, not fixed.
  - **Export:** the tempo map says the new BPM; the audio is the old. A
    DAW opening it sees the same misalignment the Studio does.
  - **Send:** a take at the old tempo no longer lands on bar lines.
- **Good for:** the tempo was wrong from the start (a guessed first loop,
  a free tap that read 91.7 for 92), the grid is a guide for what comes
  next, or Gabe's case: *set the tempo*, then play to it. With a click
  that follows, and audio that was played freely, this is what a DAW does
  when you change the project tempo on audio that isn't warped.

## Following an external clock

**What exists:** `midi.Clock` hears 24 ppq from one device
(`MIDI_CLOCK_DEVICE`, else the interface), answers *what tempo was playing
over this interval* (`Clock.BPM`, median of rolling windows) and stamps
takes. `TAPE_CLOCK=lead` sends the tape's clock out (`clock.go`).
`TAPE_CLOCK=follow` is accepted by config and logs *isn't built yet*
(`cmd/hindsight/main.go`).

**What's missing:** nothing turns the clock's tempo into the tape's, no
Start / Stop / Song Position in drives the transport, and there is no
phase: the Pi knows how fast, not where bar 1 is (a Start says that, and
the clock's pulses after it count bars).

**What "follow" can mean without varispeed:**

1. **Start and stop only.** Start in plays from bar 1, Continue plays
   from here, Stop stops. The tape keeps its own tempo. Honest only if
   the two tempos already match; with the re-grid key, the person makes
   them match.
2. **Take its tempo while the tape is empty or standing.** A re-grid to
   the clock's BPM, offered (a toast, *The Bento is at 96, tape at 92:
   Use 96*) or automatic on an empty tape. Playing never changes it.
3. **Lock to it while playing:** this is varispeed, and needs (a).

1 + 2 make "follow" mean *start together, and the grid is the clock's*,
which covers a drum machine leading a jam where the tape adds loops.
Following a drifting human-played clock with audio already down needs (a).

## Decisions for Gabe

1. **Which way the tempo changes with audio down.** Recommended: **(c)
   re-grid now**, the bar lines move and nothing is stretched, which keeps
   the tape's rule that audio is never touched. Varispeed later, as its
   own feature, if a nudge that bends the pitch is wanted for playing or
   for following a clock. Stretch only ever offline, for a bounce.
2. **The loop on a re-grid.** Recommended: **it keeps its frames** (the
   audio's loop is the truth; the click goes out of phase where the tempo
   disagrees with what was played, and that tells you). Alternative: it
   keeps its bars, and Out moves.
3. **What the tempo key does.** Recommended: the bar's tempo key opens
   one menu: the BPM, typed; − and + (0.1 BPM, 1 with a hold); Tap
   (four taps or more, the average of the last eight); and the existing
   bar counts below a line. Every change is one step of undo, coalesced
   while nudging.
4. **One tempo on screen.** Recommended: the tape's tempo is the one the
   bar shows; the clock's appears beside it only when they disagree
   (*92 · clock 96*), and Capture's tile and `#stat-tempo` say *clock*.
   Every BPM on screen says which of the three it is.
5. **What `follow` means.** Recommended: 1 + 2 above: the clock's Start
   and Stop drive the transport, and the clock's tempo is offered as a
   re-grid while the tape stands. Locking while playing waits for (a).
6. **Re-grid while recording.** Recommended: refused while a punch or ●
   Rec is under way (a punch counts bars).

## Build order, if (c)

1. The Pi: `PATCH /api/tapes {tempo:{bpm}}` (no bars) re-grids any tape:
   `Grid.Retempo(bpm, sr)` keeps the bar count and sets the frames, clips
   and loop untouched; refused while recording; one undo step, coalesced as
   `tempo`. Go tests: the grid moves, the audio and loop don't, undo puts
   it back, the clock restarts on it.
2. The tempo key's menu: type, − / +, Tap, then the bar counts.
3. The flow, J1.17 *set the tempo with audio down*.
4. The tempo display rule (decision 4), then `follow` (decision 5).

A prototype of 1–3 is a draft PR, for Gabe to try on the demo.
