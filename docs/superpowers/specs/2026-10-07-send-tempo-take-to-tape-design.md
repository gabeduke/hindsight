# Send a take with a tempo to the tape

**Date:** 2026-10-07 · **Status:** design agreed with the owner 2026-10-07 ·
**Repo:** `hindsight`

Builds on [tempo from the recording](2026-10-04-tempo-from-recording-design.md)
and [the tape](2026-10-03-tape-design.md).

## Why

A seven-minute jam, played to a Bento sequence with a known tempo, couldn't be
sent to the tape. Two things stood in the way:

1. **Tracks are six minutes.** `TAPE_LENGTH_S` defaulted to 360, the OP-1's
   figure, and the refusal said only "360 s is longer than a track".
2. **Send to tape treats the selection as a loop.** On an empty tape the span
   became the first loop and its length set the tempo. That is right for four
   bars. For a whole jam it is nonsense, and it is also needless when the take
   already knows its tempo from the MIDI clock (or from the owner typing it
   in) and where bar 1 is.

## What changes

### 1. Tracks hold 20 minutes

`TAPE_LENGTH_S` defaults to **1200**.

It is a limit, not a reservation: nothing is allocated for it. The cost is in
what's on the tape. Tape audio is WAV files in `TAPE_DIR` (stereo, 32-bit,
48 kHz: 23 MB a minute on disk), but the loaded tape reads each clip's file
into RAM whole, as float32 stereo, which is the same 23 MB a minute. So:

| | RAM |
|---|---|
| A 7-minute take on the tape | about 160 MB |
| One full 20-minute track | about 460 MB |
| Four full tracks, plus the one undo or redo state the pool keeps | about 1.8 GB and up |
| The ring at the default 900 s | 1.3 GB (2.6 GB while a full-ring save copies it) |

On the 8 GB Pi 5 the default ring needs, that fits. 1200 was chosen because
the ring keeps 900 s by default, so any take the Pi can save fits on a track,
with room to put a count-in's bars ahead of it. A smaller Pi sets a shorter
`TAPE_LENGTH_S` or `RING_SECONDS`.

A tape stores its length when it's made. A tape made when tracks were six
minutes would otherwise stay six minutes whatever the setting, so **loading a
tape raises its length to the current setting** (never lowers it). Raising a
limit moves nothing.

**The refusal says what to do.** A span longer than a track, or one that would
run past the end from where it lands, answers, for example, *that's 7:02, and
a tape track holds 6 minutes. Raise TAPE_LENGTH_S (now 360) in the Pi's
settings to make room*: the span, the limit in minutes, and the setting. The
copy to the clipboard, the drops and the send all say it.

### 2. A take with a tempo is placed by it

`POST /api/tapes/send?id=` takes `{take, from?, to?, track}`. The Pi reads the
take's `bpm` and `downbeat_frame` from its sidecar, so what it uses is what's
saved, whichever page saved it. It takes the whole take, or `[from, to)`.

With a tempo (20–400 BPM):

- **One clip, loop off.** Nothing is looped and no loop region is made; the
  owner sets one on the ruler later. An empty tape's loop, if it had one, is
  turned off, since it was only the tempo form's placeholder.
- **Bar 1 on a bar line.** The span keeps its place in the take's bar:
  *line* is the take's bar line at or before the span's start (counted from
  the downbeat, with everything before the downbeat counting as the bar
  before it), and the span lands at `anchor + (start − line)`. A whole take
  with a count-in therefore puts its downbeat on `anchor`, and the count-in
  in the bar before it. A selection starting after the downbeat sits as far
  past a bar line on the tape as it does in the take.
- **Nothing cut off.** If that lands before tape frame 0, everything moves on
  by whole bars to the first bar line that leaves room.
- **Which bar line.** On an empty tape, `anchor` is bar 0. On a tape that
  already has audio at the same tempo, it is the first bar line at or after
  the playhead.
- **The tape's tempo.** An empty tape takes the take's: a grid of 4 bars at
  that tempo, as the empty-tape form makes. If it already has the same tempo
  it's left alone. (A tape with no audio has no tempo to keep; its tempo is
  changeable until something is on it.) Same means within 0.1%, about a
  quarter of a second's drift in seven minutes; tempos are measured, and two
  takes of one song differ by a few hundredths of a BPM. Placement uses the
  tape's grid.
- **A different tempo isn't stretched.** The tape's tempo is fixed once it has
  audio, because nothing is ever stretched. Send does what a drop always did:
  puts the span at the playhead, as it is, replacing what's under it, and
  answers with a `warning` naming both tempos. It doesn't line up with the
  bars, and says so. Time-stretching is not invented here.
- The playhead goes to the start of what was sent, unless the tape is
  playing, so ▶ plays it.

### 3. A take with no tempo

A phone recording or a free jam sends as before, with one change: on an empty
tape, a span up to **60 s** is the first loop, and sets the tempo from its
length (bars nearest the last tape's tempo, or 90 BPM). A longer one is one
clip, loop off, and the tape gets no tempo. 60 s is what the guesser can
reasonably label (up to 32 bars at a plausible tempo) and what a loop is for;
a jam isn't one. On a tape that has audio it goes at the playhead.

The same 60 s rule applies when a clipboard is dropped on an empty tape, with
the clipboard's tempo, if it has one, given to the tape.

### 4. The take page says what it will do

Under the buttons, one line, when the tape is on:

- with a tempo: *Sends the whole take at 120 BPM, bar 1 on a tape bar line* (or
  *the selection*);
- with none, and up to 60 s: *… at the tape's playhead; an empty tape makes it
  a loop that sets its tempo*;
- with none, and longer: *… at the tape's playhead as one clip, no loop; an
  empty tape gets no tempo*.

After the send, a toast says what it did: which bar the downbeat landed on,
the tempo the tape took, or the warning for a tempo that didn't match.

## Not in this

- **Time-stretching** a take to a tape of another tempo.
- **The downbeat control** on the take page: Send reads whatever is stored.
- **Streaming long clips** instead of reading them into RAM. That is what
  would remove the RAM column above; today it is the limit on very long tapes.
- **The phone listen file**: it stays at 10 minutes, and says so.

## Checks

- [unit] `GridPlacement`: downbeat on the anchor; a count-in moves on whole
  bars; a selection before, on and after the downbeat; fractional bar lines at
  84 BPM; the downbeat always on a bar line and nothing before 0.
- [unit] Send to an empty tape: tempo set, loop off, one clip, whole length; a
  count-in in the bar before; a selection at its place on the grid; a second
  send at the same tempo on the next bar line at or after the playhead; another
  tempo placed as it is with a warning and the tape unchanged; an empty tape
  with another tempo takes the take's.
- [unit] Too long: the span, the limit in minutes and `TAPE_LENGTH_S` in the
  refusal, with and without a tempo, and for a span that runs past the end
  after placement; nothing left on the tape.
- [unit] No tempo: short is the first loop; over a minute is linear with no
  tempo and no loop; the same for a clipboard drop, which keeps its tempo.
- [unit] A tape made at 360 s loads at 1200; a longer one keeps its own.
- [api] `/api/tapes/send`: the sidecar's tempo and downbeat are used; a
  selection; both-or-neither `from`/`to`; 400, 404, 409; the too-long message.
- [node] The hint for each case; the toast for each answer.
- [demo] Open a take, set its BPM, move the downbeat, **Send to tape** → the
  tape reads that tempo, Loop is off, one clip, the playhead at its start.
- [rig] Re-send last night's seven-minute take → it plays through, in time
  with the Bento's grid on the tape page.
