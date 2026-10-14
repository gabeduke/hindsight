# Play mode, audible: a read head over a tape that keeps counting

**Date:** 2026-10-14 · **Status:** proposed to Gabe · **Repo:** `hindsight`
**Follows:** `2026-10-14-play-mode-design.md` (the surface),
`2026-10-14-object-library-design.md` (the physics it moves with).

## Why

Gabe's ask was an instrument: *"pleasing animations and intuitive way of
interacting with music"*, the OP-1 Field's feel rather than a DAW's. Play
mode is the surface for it, and today it is silent. Its pads arm, light on
the grid, and do nothing you can hear. An instrument that makes no sound is
a diagram of one.

This is the spec for the sound, and for the picture that has to move with
it, because on the OP-1 the two are the same gesture. Hold STOP: the pitch
falls and the reels wind down together, and letting go snaps both back in
time.

## The idea that makes it small

The tape design (2026-10-03) already said it: *"The tricks leave the
underlying position counting on."* Break comes back in time because the
transport never stopped. Take that literally:

```
transport  ──pos──pos──pos──pos──pos──►   unchanged: rate 1, always
                    │            ▲
          press on a 16th   release on a 16th
                    ▼            │
read head           ╰─ stop / reverse / chop / ½× / 2× ─╯
```

A trick is a **read head** that leaves the transport for as long as a pad is
held. The renderer reads the mix from the head instead of from `tr.pos`. The
transport's position, its segment history, the MIDI clock, catches, punches,
passes and the phone stream's stamps never see the trick, because none of
them read the head. On release the renderer goes back to `tr.pos`, which kept
counting, so the tape lands in time with no arithmetic at all.

That rules out the expensive version, rate segments in the position map,
which the tape design sketched for whole-tape varispeed. That touches every
consumer of `posAt` (clock, catch, punch, stream). Momentary tricks don't
need it, so they don't get it.

## What each pad does

All of them are momentary, quantised, and leave nothing behind: no undo
entry, nothing written to `tape.json`, nothing on the tape.

| Pad | Sound | Picture (reels on the Play screen) |
|---|---|---|
| **1–4** (track keys) | That track drops out while held. Several can be held at once, and they combine with any trick below | That track's key lights; its level bar on the LCD falls |
| **BREAK** | The output cuts to silence, declicked. The tape runs on underneath | Reels keep turning, because the tape is running. The ring goes on sweeping |
| **STOP** | Tape stop: the head slows from 1× to 0 over one beat, so the pitch falls with it, then silence while held | Reels wind down with inertia over the same beat (`spin()`), and stand |
| **REV** | Plays backwards from where it was pressed | Reels turn backwards |
| **CHOP** | Repeats the last grid slice (the quantise switch's division; 16th when it's off), tempo-locked, with 5 ms crossfades at the seams | Reels rock: a slice forward, then back, then forward |
| **½×** / **2×** | Varispeed: pitch and time together, from where it was pressed | Reels at half or double speed |

On release, every one of them returns to the transport's position, which is
in time because it never stopped. The return uses a 5 ms equal-power
crossfade, the one the renderer already uses at seams.

**Only one read-head trick sounds at a time.** BREAK, STOP, REV, CHOP, ½× and
2× each move the head, so the last one pressed wins. Releasing it falls back
to the newest pad still held, or to the transport if none is. That's a stack,
and holding REV then tapping CHOP does what a hand expects. Track keys are
separate and combine with all of them.

## How

### Engine (`internal/tape`)

- **Performance state, outside `State`.** A small `perf` struct owned by the
  render goroutine holds:
  - the track dropout mask;
  - the trick stack;
  - the head: anchor frame, read position as a float, rate, and how far
    into a ramp it is.

  It is never cloned into history, never saved and never rebuilt into a
  `Mix`. That is what "bypasses undo" means concretely: it shares no code
  path with `Edit` or `SetMeta`.
- **Its own queue, which never drops a release.** `Do()` drops an action
  when its 32 slots are full. A dropped release is a pad that sticks, with no
  key that unsticks it. So tricks use their own small queue:
  - a release for a pad cancels that pad's pending press if it hasn't sounded
    yet;
  - a full queue drops presses, never releases;
  - a "release all" always fits.
- **Quantised on the render head, to the grid.** `transport.target` grows
  `16th` and `8th` quanta beside `beat` and `bar`, with `Grid.NextSixteenth`
  and `Grid.NextEighth` beside `NextBeat`. A press or release takes effect on
  the first grid line at or after the render head, and `advance()` splits
  its block there exactly as it already does for a quantised ▶. A tape with
  no grid takes tricks at once.
- **Rendering from the head.** `advance()` keeps advancing `tr.pos` exactly as
  now, but for a span under a trick it renders through the head:
  - **Rate 1** (the slice CHOP plays) is `renderTape` at the head's frame.
  - **Any other rate, or backwards:** the span of tape the head crosses goes
    through `renderTape` into a scratch buffer allocated once, then a 4-point
    Hermite reads it out at the head's fractional positions. The pitch falls
    with the rate, as on tape.
  - A head that runs off the loop's Out, or back past its In, wraps inside
    the loop.
  - The click track follows the transport, not the head. The band's clock
    doesn't stutter.
- **Track dropouts** are a mask the render consults beside `t.silent`, ramped
  over the existing 3 ms declick so a held key doesn't click.
- **Nothing else changes.** The MIDI clock out, catches, passes and punches
  all read `tr.pos`, and so they all stay in time with the band. A punch
  recorded while a trick is held lands where the tape was, not where the head
  was. That is right: the player was playing to the tape's time.

### The wire: `/api/tapes/play` (WebSocket)

The tape design already chose this: *"Tricks travel as press and release
messages on the live WebSocket, not as HTTP requests, so the release isn't
queued behind anything."* The live socket was never built, so this is a small
one of its own.

| Direction | Message |
|---|---|
| page → Pi | `{"t":"press","pad":"stop","q":"16th"}` · `{"t":"release","pad":"stop"}` · `{"t":"release_all"}` |
| Pi → page | `{"t":"lead","ms":212}` on connect and whenever it changes · `{"t":"at","pad":"stop","edge":"on","out":…,"pos":…}` when a press or release actually sounds |

- **A device that drops releases its own pads.** The socket closing (Wi-Fi,
  a locked phone, a closed tab) is a release for everything that connection
  held. This is the server's half of the alt-tab rule the keyboard adapter
  already follows.
- **The room's tricks, not one person's.** Several devices may play. A pad
  sounds while any connection holds it, and each connection's drop releases
  only its own.

### The page (`lib/play`)

- **Send on touch, not on the grid line.** `arm` sends `press` at once and the
  Pi quantises. Sending at the browser's grid line would add the whole
  network trip on top and land late.
- **Draw the true lead.** The surface's next grid line becomes the first one
  at least `lead` ms after the press, where `lead` is what the Pi reports:
  render-ahead (`Out − Delivered`) plus the device's output latency. So the
  pad's dim-to-bright gap is how long it really takes to hear it. That is
  the play-mode spec's "latency you can hear becomes a thing you can see",
  made accurate.
- **The Pi corrects it.** An `at` message moves that pad's bright moment to
  the frame the Pi actually used, through `clock.js`'s origin. If the two
  agree, nothing visibly moves.

### The picture

The Play screen gets the object library's reel window, driven by the shared
ticker and `spin()` toward each trick's rate:
- 0 for STOP, with the inertia that makes a wind-down read as one;
- −1 for REV;
- ½ or 2 for varispeed;
- a rock for CHOP.

It moves on the `at` message, when the sound does. The press shows as the
pad's dim armed state.

This is the first object born in the library rather than moved into it. The
object-library spec named the reels and the ring for exactly this.

## What ports from the OP-1, and what doesn't

Gabe, 2026-10-14: *"Some of the op-1 features work well because it is using
tightly integrated hardware. Midi and web browser interface introduces a lot
of delay which could make some features not quite as portable."* Right, and
the numbers decide which ones.

**From a hand to the speaker:**

| Path | Delay | Made of |
|---|---|---|
| OP-1 Field | a few ms | one box |
| Phone or laptop → Pi → jam-room speakers | **~230–260 ms**, jittery | Wi-Fi (5–50 ms, worse on a busy network), the render running 107 ms ahead, `OUTPUT_LATENCY_MS` (100) and one device buffer (21 ms) |
| A MIDI controller plugged into the Pi | **~230 ms**, steady | no Wi-Fi; the same render and output path |
| Either, with the immediate re-render (build step 5) | **~120–130 ms** | the 107 ms ahead mostly gone |
| Playing to a phone listener | **+~0.8 s** | the stream's buffer |
| The screen itself | **one frame** | drawn in the browser, no Pi involved |

What people can bear depends on what kind of gesture it is:
- **Sound that has to follow the hand**, like a note, a drum hit, scratching
  or a pitch bend: noticeable past about 20 ms, broken by 100.
- **A discrete action that lands on a grid line:** any delay can be hidden,
  if the press arrives before the line minus the delay and the player can
  see how far ahead to play. That is what quantise and the drawn lead are
  for.
- **Scene-level actions on the bar:** don't care.

| OP-1 feature | Kind | Here |
|---|---|---|
| Tape tricks held on the grid (break, stop, reverse, chop, varispeed pads) | Discrete, quantised | **Ports.** This spec. The lead is drawn so the player leads the beat |
| Track mutes held | Discrete, quantised | **Ports.** The track keys |
| Loop in/out, loop on/off, punch on the bar | Discrete, quantised | **Already ported** |
| Launching clips (the crate as pads), on the bar or beat | Discrete, quantised | **Ports.** Play mode phase 2 |
| Mix memos, recalled on the beat | Discrete, quantised | **Ports.** Phase 2 |
| Recording what just happened | Retroactive | **Better than ported.** The ring catches it with zero latency by construction, and no OP-1 does |
| Slow sweeps: a filter, a tape-style amount, a level ride | Continuous, slow | **Ports with care.** A quarter second behind a slow hand reads as smoothing; behind a fast one it reads as lag |
| Varispeed or scratching by dragging the reels | Continuous, fast | **Doesn't port.** The OP-1 study already skipped audible scrub for this reason. Dragging the reels stays a silent scrub |
| Playing notes or drums *through* Hindsight (a sampler or synth voice on the screen or keybed) | Sound must follow the hand | **Doesn't port, and shouldn't.** The FM-1, MPC, Bento and AKS make their sound locally, in a few ms. Hindsight records them |

**The rule this gives:** Hindsight is the tape, not the voice. Anything whose
sound must follow a hand within about 20 ms belongs to the instruments in the
room. Hindsight takes on what can land on the grid or what happens after the
fact. That is the same line the play-mode spec drew for the FM-1 firmware:
it is a sound source, Hindsight is the tape.

**And the picture is always immediate.** It's drawn where the hand is, so
every touch is answered in one frame: the pad dims, and the reels start to
move toward a trick. The sound arrives on its grid line, and the bright state
and the reels' full motion arrive with it. The animation has no latency
problem at all, which is why it carries so much of the feel.

**For the SMK-37:** plugged into the Pi, not into the browser. The Pi already
reads MIDI (`internal/midi`), so keys reach the trick queue without Wi-Fi,
and the lead is steady, which matters more than small. The page mirrors what
the Pi says is held. Web MIDI in a browser stays possible for a laptop away
from the Pi, through the surface's event bus as designed. It is the second
choice, because it adds the Wi-Fi hop back.

## Decisions (recommended picks)

1. **A read head over an unchanged transport.** It is the reason this is
   much smaller than the tape design's rate segments, and why everything
   synced to the tape stays synced. Whole-tape varispeed, which does have to
   move the clock, stays a separate later piece.
2. **BREAK cuts; STOP winds down.** The tape design used "break" for the
   wind-down, and the play-mode spec added a separate STOP. Having both is
   the useful split: a hard cut for drops, a tape stop for endings.
3. **The Pi quantises; the page draws the lead.** The alternative, the page
   timing its sends, can't be in time over Wi-Fi. That was the whole point
   of quantising.
4. **A WebSocket that releases on disconnect.** As the tape design chose. A
   dropped connection must never leave the tape stopped.
5. **CHOP's slice follows the quantise switch.** 16 gives sixteenths and 8
   gives eighths. With quantise off, sixteenths.
6. **Refused during a mixdown, allowed during a punch.** A mixdown is a
   "once" pass through its own render path, and printing tricks into it is a
   later, deliberate feature. A punch reads `tr.pos`, so it is safe.
7. **On a phone listener, allowed, with a note.** The stream buffers about
   0.8 s, so the pads land on the grid but a second after the hand. The
   screen says so rather than hiding it. Play mode is for the jam room's
   speakers.
8. **Hermite interpolation, and 2×'s aliasing accepted as tape.** Cheap on
   the Pi. A proper resampler (`internal/audio/resample.go` has one) is a
   tape-style upgrade, not a v1 need.
9. **Hindsight is the tape, not the voice** (the section above). Features
   whose sound must follow the hand within about 20 ms are not built here,
   however good they are on the OP-1. Those that land on a grid line, or
   happen after the fact, are.
10. **The SMK-37 plugs into the Pi**, and its keys go to the trick queue
    there. Web MIDI in the browser is the fallback for a laptop away from
    the Pi.

## Build order

Each step is a PR, merged and installed before the next.

1. **Engine:** the perf state, the head, the trick queue, the 16th/8th
   quanta, track dropouts. Pure Go, tested against a synthetic `Mix`. No API
   yet.
2. **The socket**, with release-on-disconnect, `lead`, `at`, and a `tricks`
   line in `Live` so a second device can see what's held.
3. **The page:** send on arm, the lead-aware grid, correction from `at`.
   *First audible version.*
4. **The picture:** the reel window on the Play screen, with `spin()` to each
   trick's rate.
5. **Phase 2, own spec:**
   - an immediate form that re-renders the blocks not yet delivered, cutting
     about 100 ms from the lead (the tape design's "immediate" stop, never
     built);
   - mix memos;
   - the Web MIDI adapter for the SMK-37.

Not in this sequence but already agreed, in the object-library spec:
- reels that spin up and coast down on every page;
- every animated object on the one shared ticker;
- tape slack on a transport change.

That is the rest of "pleasing animations", for the whole app rather than
Play mode, and it doesn't wait for any of the above.

## Checks

- **In time:** press at a random sub-sixteenth offset, release later. The
  output after the release is identical, sample for sample (past the 5 ms
  crossfade), to an untricked render at the same output frames. That is
  what "the tape kept counting" means in a test.
- **Each trick's shape**, against a ramp-signal `Mix`:
  - BREAK is silence;
  - STOP's read rate falls linearly to 0 over a beat;
  - REV reads strictly backwards;
  - CHOP's output repeats with the slice's period;
  - ½× and 2× read at that rate.
- **Undo untouched:** a scripted two-minute jam of presses and releases
  leaves `undo` exactly where it was, and `tape.json` unwritten (mtime). The
  pattern is `internal/api/tape_test.go`'s existing zero-undo asserts.
- **Never stuck:**
  - the queue full of presses still accepts a release;
  - a socket closed while a pad is held releases it on the next grid line.
- **Synced gear stays synced:** the MIDI clock's ticks are unchanged by any
  trick (`clock_test.go`'s fake heard function).
- **On every kit's Pi, the smallest first:** render time per block
  at 2× with four tracks, under the late-render counter staying at zero.
- **By ear, on the rig:** hold STOP on a downbeat with the Bento clocked from
  the tape; let go and the tape is back on the Bento's beat.

## Not in this

- Whole-tape varispeed and tape styles (wow, flutter, saturation): those are
  properties of a tape, not gestures.
- Launch pads from the crate (the play-mode spec's phase 2).
- MIDI input of any kind. The surface's event bus is where it will plug in;
  nothing here blocks it.
- FM-1 firmware: still parked, for the reasons the play-mode spec gives.
