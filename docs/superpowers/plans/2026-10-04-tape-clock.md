# The tape leads the clock — step 8a of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md), *Clock* (lead),
`TAPE_CLOCK` and `TAPE_CLOCK_OUT`. **Checks:** [guide](../../guide.md) §8.7.
**Branch:** `tape-clock`, stacked on `tape-mixdown`. The first part of step 8
(tape phase 3); follow mode, strip scenes and the pedal come after, once the
rig has answered the spec's open hardware questions.

## Decisions taken while building

- **Lead only.** The spec recommends it and the owner chose it. `follow` is
  accepted as a setting but runs free, with a log line saying so.
- **Pulses ride the position map.** Each pulse belongs to the output frame
  where the tape is on its line, so loops, locates and late renders need no
  special cases: the clock reads what the transport did.
- **Timed by the output's clock bridge,** the same one the aligner uses, so
  a pulse arrives when its audio is heard. Per-device nudges cover a device
  that acts early or late: `TAPE_CLOCK_OUT=bento:-4`.
- **Start or Continue on a sixteenth.** A follower counts from a sixteenth,
  so a play from mid-bar waits for the next one and says where it is.
- **The loop coming round sends Song Position** without stopping, as the
  OP-1 Field does since 1.7; a follower that ignores it keeps counting, which
  a loop of whole bars keeps in step anyway. **Any other jump while running**
  (a locate, a new tempo) stops the followers and starts them again, since
  many ignore Song Position while running.
- **The clock runs while the tape stands,** at its tempo, so a follower
  knows the tempo before Start.
- **Out never shares a node with the capture.** Each rawmidi node is opened
  write-only, which opens its output alone.
- **The demo has a follower:** an in-memory device that reads the clock it's
  sent and says what tempo it hears, shown on the tape page. That checks the
  timing end to end without hardware.
- **Not in this step:** dashcam takes snapping to the tape's bars, and their
  `.mid` carrying the tape's tempo, while the tape leads (the spec's
  `BarSnapper` change).

## After the independent review

Fixed:
- At tempos where a bar line rounds up (84 BPM, say), a start or a loop
  from bar 2 was a sixteenth late. Pulses are now laid from the bar line
  before them, so a bar's first pulse is its bar line.
- A tempo change while playing left the clock silent or scrambled.
- A device whose open blocked froze the clock and the tape page. Opens are
  now non-blocking, outside the lock, and retried slowly.
- A replugged or late-plugged follower never got Start; it's now told
  where the tape is.
- The Stop at shutdown could be lost behind queued clock, or never sent.
- A locate while running only sent Song Position.
- The page overwrote the readout's help tip.
- Also: no clock before Start, so the clock now runs while the tape stands;
  very late messages are skipped rather than sent in a burst; Song Position
  goes 5 ms before its Continue.

## Tasks

1. `internal/midi/out.go`: targets with nudges, the scan, a timed queue per
   device, the demo follower. Tests.
2. `internal/tape/clock.go`: the scheduler over the position map, Start,
   Continue, Song Position, Stop; the pull bridge for an output without its
   own. Tests.
3. Config, `main.go`, `live.clock`; the page's *clock →* readout; a tip.
4. Docs.
