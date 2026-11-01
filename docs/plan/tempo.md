# The tempo: what's still open

**Agreed and built (2026-10-30):** a new tempo moves the bar lines, not the
audio, at any time but during a punch; the loop keeps its frames; the
tempo key's panel types, nudges and taps it. That is decision
[0062](../decisions/0062-a-new-tempo-moves-the-bar-lines.md), with why
varispeed and stretch were left. **Still open:** one tempo on screen
(decision 4), and what `follow` means (decision 5). Varispeed is later, its
own feature, if a nudge that bends the pitch is wanted.

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
| Re-grid: type, nudge or tap a BPM | the tempo's panel, `PATCH {tempo:{bpm}}` | any time but a punch (0062) |
| The first loop's length | Tap (`tap.go`), a first-loop drop (`engine.go`, `send.go`) | no grid yet |
| A take with a tempo, sent to an empty tape | `send.go` (`TempoSet`) | tape has no audio |
| New tape at the last tape's BPM | `store.go` `Create(bpm)`, `LastTapeBPM` | creation |
| Relabel the bars | the tempo's menu (`renderTempo`, `PATCH {bars}`) | any time: same frames, ½ or ×2 the BPM |

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
  punch-in at the next bar (`record.go`), the count-in, and the pads
  (`trick.go`, `landing`; the web strip's `lib/play/clock.js`, which
  assumed bar 1 is frame 0, went with Play mode on 2026-10-30).
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
3. **Lock to it while playing:** this is varispeed, and waits for it.

1 + 2 make "follow" mean *start together, and the grid is the clock's*,
which covers a drum machine leading a jam where the tape adds loops.
Following a drifting human-played clock with audio already down needs
varispeed.

## Decisions for Gabe

1–3 and 6 are agreed, and built: 0062.

4. **One tempo on screen.** Recommended: the tape's tempo is the one the
   bar shows; the clock's appears beside it only when they disagree
   (*92 · clock 96*), and Capture's tile and `#stat-tempo` say *clock*.
   Every BPM on screen says which of the three it is.
5. **What `follow` means.** Recommended: 1 + 2 above: the clock's Start
   and Stop drive the transport, and the clock's tempo is offered as a
   re-grid while the tape stands. Locking while playing waits for
   varispeed.

## Build order

1. The tempo display rule (decision 4).
2. `follow` (decision 5): Start / Stop in, then the clock's tempo offered
   as a re-grid.
