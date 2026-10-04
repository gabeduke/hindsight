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
- **Song Position at every jump while running,** the loop coming round
  included, as the OP-1 Field does since 1.7. A follower that ignores it
  keeps counting, which a loop of whole bars keeps in step anyway.
- **Out never shares a node with the capture.** Each rawmidi node is opened
  write-only, which opens its output alone.
- **The demo has a follower:** an in-memory device that reads the clock it's
  sent and says what tempo it hears, shown on the tape page. That checks the
  timing end to end without hardware.
- **Not in this step:** dashcam takes snapping to the tape's bars, and their
  `.mid` carrying the tape's tempo, while the tape leads (the spec's
  `BarSnapper` change).

## Tasks

1. `internal/midi/out.go`: targets with nudges, the scan, a timed queue per
   device, the demo follower. Tests.
2. `internal/tape/clock.go`: the scheduler over the position map, Start,
   Continue, Song Position, Stop; the pull bridge for an output without its
   own. Tests.
3. Config, `main.go`, `live.clock`; the page's *clock →* readout; a tip.
4. Docs.
