# The tape

`internal/tape`: the engine, and playing it through the Sidekick.

```
API ─edit─▶ Tape (model, undo) ─save─▶ tapes/<id>/tape.json
              │ new Mix
              ▼
     render goroutine: transport + Mix ─blocks─▶ FIFO ─pull─▶ Sink (device)
                                                                │ plays
                                                                ▼
     Catch ◀── cycle log + position map ── ring (capture) ◀── Sidekick
```

**The model.** A tape is one `tape.json`: tracks of clips, the grid (the
first loop's exact length in frames, and how many bars it is), the loop,
and each track's mix. A clip points into a pool WAV: `src` and `frames` in
the file, `at` on the tape, a `layer`. Undo is a list of earlier versions of
the whole state, 100 deep, saved in the file; an edit of the same kind
within 2 s extends the last step. Every edit goes through `Tape.Change`,
which validates the result (buses, pan, nothing past the end), on a draft of
the tape that becomes the tape only once it's saved: a refused edit or a
failed save changes nothing, in memory or on disk.

**The store.** `TAPE_DIR/tapes/<id>/tape.json` is rewritten after every
edit through a synced temporary file and a rename. `TAPE_DIR/audio/` is the
pool: every catch and drop is written there once, with handles either side
(`TAPE_HANDLE_S`, at least the 10 ms the crossfades read, so a trimmed clip
can grow back out), and its peaks beside it, and never changed. Clones copy only
`tape.json`. Clean-up deletes pool files that no tape's state or history
uses, and spares any less than a minute old, which may belong to a catch
still being placed.

**The renderer.** `Mix` is built from a state whenever it changes and
swapped in atomically; rebuilds take turns, so the newest is always the one
playing. It carries everything the render goroutine needs (the loop, the
grid, the tape's length), so that goroutine never takes the engine's lock,
and an edit waiting on a slow card can't make it late. It reads pool files
fully into memory as float32; nothing is memory-mapped, because a mapped
file on a bumped USB disk faults and would take the ring down with it. The
pool keeps only the files the tape plays and those its next undo or redo
would, so memory doesn't grow with every tape ever loaded. For each block it sums every clip in
the block's span into its track's bus (A or B) at the clip's and track's
gain and the track's pan, honouring mute and solo. Edges follow what's
beside them: where audio meets audio (two clips end to end, or a clip
wrapping into itself at the loop's seam) a 5 ms equal-power crossfade runs
from the outgoing clip's overhang; an edge with silence beside it gets the
3 ms declick cuts use. A catch split at the seam is the same audio carrying
on, so it gets no fade in. While looping, the wrap itself is an edge when
clips run across the loop's ends: for 5 ms after In, what a clip past Out
would have played next fades out as a clip begun before In fades in, equal
power, only when the tape got there by wrapping (not when it plays through
In).

**The transport and the player.** One render goroutine owns the transport.
It applies queued actions (play, stop, locate) on the exact output frame
their quantum falls on, advances one tape frame per output frame, wraps at
the loop's Out, and renders ahead into a FIFO as far as the device is asked
to buffer (`OUTPUT_LATENCY_MS`, `aheadFor`): never less than the sink's
biggest pull (`audio.PullSize`: the device's 1024 frames, the demo's
`FRAMES_PER_BUFFER`), nor more than a second. At 48 kHz that is five blocks
(107 ms) at the default 100 ms, one (21 ms) at 20 ms; it is counted in
time, so a 96 kHz kit keeps ten. Each block ahead is that much more lead
between a press and its sound; a deeper FIFO rides out a device that, after
a stall, asks for several pulls back to back. The phone's pacer, which
pulls for a phone while the device is away, isn't counted: at a low
setting a phone with no device can hear a gap.
The device's callback takes blocks from the FIFO and never blocks or
allocates; if none is ready it plays silence, counts it as late, and the
tape counts on, so the tape never drifts against the device. Everything the
transport did is kept: a map from output frame to tape position, and a log
of each complete pass of the loop; a pass is logged only if it ran from this
loop's In to its Out unbroken. Loading a tape resets the transport between
two blocks, before the new tape can play: it stops, drops whatever was
queued, and forgets the passes, so one tape's pass is never caught onto
another. Panics in the render goroutine and the device callback are
recovered and reported in the state; the dashcam keeps rolling.

**When a pad lands** (`trick.go`, `landing`). The tape's pads, from a
controller or a client of `GET /api/tapes/play`, are quantised to the line
the player was playing to: the line nearest what they heard at the moment the press reached the
Pi, worked out from the lead (`heardAt`, the blocks rendered ahead and the
device's latency). A hit up to half a unit after a line, and never more
than 100 ms, goes back to it; anything later goes on to the next. A line
still to come lands on its frame. One already rendered lands at once, and
a trick pad's head starts as if it had left the tape on that line
(`anchor` the line, `start` that many frames back), so a STOP is that far
into its wind-down and a ROLL in its phase. Snapping instead to the next
line after the render head, as it once did, put every hit on the beat a
whole unit late to the ear. Releases snap the same way, with nothing to
anchor, and a tap still sounds a whole unit from where its press is first
heard, however late on its line it lands. A late start is crossfaded in
like any other; what it means is each trick's own: STOP is already part
way down, REV jumps back twice the lateness, DOUBLE forward by it. With no output, the tape on a phone's stream (whose delay the Pi
doesn't hear), or no straight play from the line to the render head, a
press lands on the transport's own target, the next line after the
render head.

No page plays the pads now. The web's instrument strip, a drawer above the
Studio's bar behind the per-device Play mode switch, went on 2026-10-30
with the switch: its folded row alone was twelve controls, and the Studio
on a tablet holds 44 (J1.16). The pads can come back in the **Pads**
component (`docs/plan/the-ecosystem.md`, *The components*, where Pads are
so far the cue lane's clips) once the instrument's shape is settled; the strip, its Web MIDI and its tape mods'
knobs are in git (`web/static/lib/play/`, before that date). Until then a
controller plays them: one in the Pi through the bus
(`internal/api/controls.go`, its defaults held to `lib/play/controls.js`),
or the SMK-37's FX page (`keyboard.md`). No page shows the tape mods
either: the keyboard's encoders set them, and its screen shows them.

**Latency, in use** (`latency.go`; [decision 0016](../decisions/0016-measure-latency-in-use.md)).
Every press, set and release a hand plays is timed to the moment it is
heard, and the Pi keeps the figures, never sending them anywhere.

- *Who stamps what.* The engine's `PressStamped`, `SetStamped`,
  `PreviewModStamped` and `ReleaseStamped` take a `Stamp`: the way the
  control came (`ViaPage`, the Play socket; `ViaMIDI`, a controller and its
  mod knobs, `ModKnobs.Via`) and, from a page, its touch and its send on the
  Pi's clock. `Press`, `Set`, `PreviewMod` and `Release` are those with an
  empty `Stamp`, which is never timed: tests, HTTP, a player who has gone.
  The engine stamps the arrival itself (`trickMsg.heard`, which `landing`
  already read).
- *The render path.* As the render goroutine applies a control, a set at
  its drain, a press or release on the block it lands in, it calls
  `timed`: a few atomic stores into a ring of 512 made with the engine, no
  lock and no allocation (`TestTimingAllocatesNothing`, which also holds a
  timed block to an untimed one's allocations). A control applied later
  than the render head it was drained at waited for a grid line: it is
  counted as quantised and not timed, as its wait is the music's. One that
  lands late on a line already rendered goes out at once and is timed;
  one applied where the device played silence (a late render's catch-up)
  was never heard and is not.
- *When it is heard.* A collector, four times a second, reads the ring
  and, once a control's frame has gone to the device, asks `heardAt` (the
  output's clock bridge, or the demo's pull bridge) when the room hears
  it; with the tape on a phone, the phone's own report of the frame it
  plays and when (`HearOnPhone`, from the stream's `fill` message).
  A slot the render goroutine lapped (or may be writing), or a frame
  nobody hears, is counted as missed.
- *The figures.* Each way in to each ear is a path (`page→room`,
  `page→phone`, `midi→room`), with the median, 95th percentile and worst
  of its last 256 controls: in total, from the touch where the page said,
  else its send, else its arrival; and in legs, touch to send (the page's
  own handling), send to Pi (the Wi-Fi), Pi to ear. Beside them, the
  settings they were taken with (the block, `aheadFor`'s lead,
  `OUTPUT_LATENCY_MS`, the lead now) and the underflows so far (late
  blocks, the device's restarts, the phone's underruns). `GET
  /api/latency` says them; the rig's line and the dev overlay draw them
  (`lib/play/latency.js`).
- *The page's clock.* The Play socket answers `{"t":"clock","c"}` with the
  Pi's time as it read the ping and as it answered; `lib/play/piclock.js`
  takes the offset from the quickest of the last sixteen trips, and a
  client adds `touch` (the event's `timeStamp`) and `sent` to each press,
  set and release once it has one. The stream's player says on the same
  clock which output frame its speaker plays. No page opens the socket
  since the strip went, so no page learns the clock and the phone's stream
  reports its delay alone: `page→room` and `page→phone` take no new
  figures, and `midi→room` goes on as before.
- *Not timed yet.* A controller's transport keys (PLAY, STOP) go through
  the verb queue (`api/controls.go`, `queueVerb`) to `Verbs.Transport`,
  not the engine's inbox: they carry no stamp.

The revision, the changes socket and the keyboard's press, which tell a
page the tape has changed, are in `push.md`.

**Catching.** What the tape played at output frame `o` is in the capture
ring at `o + delta`. A catch looks up the output frames it wants -- a pass
from the cycle log, or the last N bars from the position map, back from the
newest frame the ring has heard -- and copies that range of the ring, on the
chosen source's channel pair, into the pool, then places it where it was
played. N bars that cross the loop's end are split into two clips. Catching
needs `delta`:

- The demo knows it exactly. The demo sink is a loopback: what it plays is
  mixed into the demo source's next input block, MAIN and both channel taps
  by bus, as the Sidekick would. `delta` is counted against the frames the
  capture has handed to the ring, so a dropped block or a reopened source
  doesn't throw it off.
- On the Sidekick it's measured (`align.go`, below).

**The output** (`internal/audio/sink_portaudio.go`) is an output-only
PortAudio stream, four channels of 32-bit at 48 kHz, on the capture's own
card: the capture's device if it can play four channels, else the most
direct device matching `DEVICE_MATCH`, and never anything else -- the tape
out of HDMI, on another clock, would be worse than none. It is a separate
stream rather than a duplex one, so the dashcam's health never depends on
playback's. It keeps itself open with its own supervisor, as the capture
does -- backing off while it can't open, or while it fails soon after
opening -- and plays silence while the transport is stopped, so what it has
measured survives stop and play. It's closed with Abort rather than Stop,
since a wedged ALSA stream can keep Stop waiting for tens of seconds with
the lifecycle's lock held. Its callback calls the engine's pull, which
never blocks, notes output underflows, records in a clock bridge of its
own when each buffer's first frame will be heard (the buffer's DAC time from
PortAudio), and recovers its own panics: the binding's recover would exit
the process. The output never rescans by itself, since a rescan closes the
capture's stream too; if the Sidekick's playback wasn't enumerated, it waits
for the capture's next rescan or a restart.

**One PortAudio.** The library is process-global, so the capture and the
output share one lifecycle (`palifecycle.go`), with a registry of open
streams under one lock held across every open, close and rescan. A rescan --
the capture's, when the interface vanishes -- closes every registered stream
before `Pa_Terminate`, which would otherwise close them underneath their
owners and leave a dangling pointer to be freed twice, and moves the
generation on. The output's supervisor sees the generation move and opens
again in the new one.

**Alignment** (`align.go`). Δ is where output frame *o* shows up in the
ring: at *o* + Δ.

- *Estimated:* the capture's clock bridge gives the ring frame being
  converted at a moment, the output's the output frame being heard then;
  their difference, plus the residual of the last lock, is good to a few
  milliseconds.
- *Locked:* every couple of seconds while unlocked (every ten once locked),
  the last second each bus delivered -- kept by the device callback in a
  lock-free history -- is correlated against that bus's channel tap in the
  ring by a phase-transform cross-correlation computed by FFT (`xcorr.go`),
  over ±150 ms around where Δ should be. The signals are differentiated
  twice first, so a loop's bass doesn't drown out the attacks that pin the
  match down. A peak counts only if it's one sharp peak, well above the rest
  of the correlation and any other candidate, so a sustained tone, which
  matches itself every period, is never guessed at; and only within ±50 ms
  of the estimate (±10 ms once a lock has measured how good the estimate
  is), so a rhythm repeating at its true Δ, beyond that, is seen and refused
  rather than an echo of it inside being taken. Two measurements in a row
  must agree to the frame before a lock is taken or moved.
- *Slips:* both sides of the Sidekick run off one crystal, so Δ moves only
  when one side loses frames: the output restarts or underflows, or the
  capture drops a block or the device reports an input overflow. Each starts
  a new segment, estimated until it locks again: from the output frame the
  output says it slipped at, or for the capture's, the step before it was
  noticed. A lock that moves with no slip seen starts a segment where its
  window began, so what played before keeps the old Δ. A catch uses the
  segment its span played in, and a span with a slip inside is refused.

`TAPE_DEMO_ALIGN=true` makes the demo's output keep its Δ to itself, with a
clock bridge like a device's, so the estimate and the lock run in the demo
too; a test checks that a catch then holds exactly what played.

**Sources** (`TAPE_SOURCES`) name capture pairs and the buses heard in each.
A source is clean on a tape when no bus that leaks into it has unmuted audio,
and each caught clip records whether its source was.

**Recording** (`record.go`) adds nothing to the capture: the ring is always
recording. Rec while playing notes the output frame it was asked at; Rec
while stopped arms the track, and the next ▶ becomes a play with a count-in
-- a bar of click rendered with the tape standing at its bar line, then
play. Ending it works out what it covered from the cycle log and the
position map -- the last full pass inside it, or the bars from the first bar
line it played to the last complete one before the tape stopped, moved or
the punch ended -- and catches that span, placing each piece of it where it
played: every wrap in the position map is marked as one, so a span that went
round the loop is split at the loop as it was then, even if it has moved
since. ■ during a punch stops the tape before the catch is written.

**The click** is rendered into bus A by the mix: a 25 ms sine blip on each
beat line, higher on the bar. It's on for a new tape and goes off with the
first audio; the count-in clicks whatever the setting.

**Free loops** (`tap.go`). A tap is timed when it reaches the Pi, and the
capture's clock bridge turns that into a ring frame. The second snaps both
to the strongest attack in the source within 250 ms before and 50 ms after:
the hop of 128 frames whose energy rises most over the few before, then the
first sample there reaching a third of what follows. The span is written to
the pool and becomes the grid, the loop and the first clip; then a "phase"
action starts the transport as if the loop had been going round since the
second tap, using Δ to turn that ring frame into an output frame.

**The crate** (`crate.go`) is `TAPE_DIR/crate.json`: kept clips, each a
window onto a pool file with a name and where it came from. Nothing shows it
(decision 0009): a buffer replaced unused still goes there (`keepBoard`, by
reference), and a range's Insert can still take a kept clip. It's a clean-up
root, its deleted clips too for a week, and an unreadable one stops the
clean-up.

**The clipboard** (`clipboard.go`) is `TAPE_DIR/clipboard.json`: clips in
the pool, laid out from frame 0, one track's worth or more. Copying from a
take or the ring writes the pool first; the clean-up treats the clipboard as
a root. A drop clears the span on each track it lands on and places the
clips, then, stopped, moves the playhead to its end. The audition renders it
through a mix of its own, every track on bus A.

**Drops** copy a span of a take into the pool. On an empty tape the first
drop becomes the grid and the loop; later ones go at the playhead. A merge
drop places every clipboard track on one track instead, each clip on the
lowest layer free.

**Editing** (`edit.go`) never touches audio. A clip is a window onto an
immutable pool file, so lift and copy are windows trimmed to the loop's In
and Out (a lift also clears the span with the same cut a replace uses);
split is two windows; join merges two that carry straight on in one file;
slide re-places a clip at a new start; trim moves one edge of a window
within its file's handles; multiply copies the loop's windows into the span
after it. Reverse is the one edit that writes audio: the clip's window and
its handles, backwards, to a new pool file
(`audio.ReverseWAVSpan`, a block at a time from the end), so every other
edit still reads every clip forwards; turning it back is arithmetic on the
original's frames. Each goes through `Engine.Edit`, so each is one undo
step and is saved before it's heard. A lift's clipboard is written after the
tape; if it can't be, the lift is undone. The crossfades the renderer already
does where clips meet make the joins silent.

**Mixdown** (`mixdown.go`) renders nothing offline. It queues a "once"
action: the transport plays In to Out through a second, loop-off mix built
alongside the playing one (so no seam joins Out to In), with the click
silent and 3 ms fades at the edges, then stops back at In, noting the output
frames the pass began and ended at and whether any of it was a late render.
A goroutine waits for that, waits for the tail and one aligner step to
reach the ring, and, if nothing broke, slipped or played late, maps the
span through the Δ that held into ring frames and hands it to the dashcam's
saver: the take is exactly what MAIN carried, the strips' FX and any live
playing included. A stop, locate or load during the pass, or any of those
or a play during the tail, marks it broken and nothing is saved.

**Export** (`export.go`) is offline: each track with clips gets a mix of its
own (no loop, its mute and solo cleared) from the pool the loaded tape
already holds, rendered block by block straight into a stored zip entry as
32-bit float WAV, with a write deadline moved on each block so a stalled
client can't hold the one export slot. A tempo-map `.mid` rides along.

**The clock** (`clock.go`, `internal/midi/out.go`). With `TAPE_CLOCK=lead`,
a goroutine looks every 5 ms at what the renderer has added to the position
map. For each pulse line -- n × a bar ÷ 96, not a whole number of frames --
that the tape played across -- laid from the bar line before it, so a bar's
first pulse is its bar line -- it finds the output frame, asks the output's
clock bridge when that frame will be heard (the demo's output has none, so
the engine keeps one of when frames were handed over), and hands the pulse
to `midi.Out` to send then. While the tape stands, pulses run on at its
tempo over the output frames. Starting, or a jump, waits for the next
sixteenth and is announced just before it: Start from bar 1, else Song
Position and then Continue; the loop coming round sends Song Position alone,
and any other jump while the followers run (a locate, a new grid) stops
them first. `midi.Out` opens each matching rawmidi node write-only and
non-blocking, outside its lock, gives every device its own goroutine that
sleeps until each message's moment plus the device's nudge, drops a device
whose write fails or whose node vanishes until the next two-second scan,
skips messages more than 250 ms late, and counts each device that appears
or loses messages, so the scheduler tells the followers where the tape is.
On shutdown the engine waits for the scheduler, whose Stop goes out at once,
ahead of anything queued.

**The cue lane** stages clips beside the tape: they're in the tape's state
(`State.Cue`, so undoable and seen by every device). A clip GRAB put there,
or a take's span, keeps what the buffer kept (`cuegrab.go`): `Lanes`, one
clip per input it was grabbed from, each over the window `Grab` says in a
pool file with the grab's handles either side (a bar at the tempo, or
`TAPE_HANDLE_S`), and the clip's own gain, fades and curves applied to every
lane alike; `File` and `Src` are the first lane's. A clip from before then
is one summed file, with no handles: it launches and drops, but its window
and Reverse are a track's job. `GrabToCue` (`POST /api/tapes/cue/grab`)
copies off the ring as `Grab` does, then takes the place of the lane's
newest clip while that one is an untouched GRAB (`Source` "grab", never a
take's or the buffer's; never trimmed, shaped,
renamed or dropped, `Touched` in the state; never launched or kept,
`Engine.cueUsed`, which isn't undone and starts empty), so a run of presses
doesn't fill the lane, or else is added; the tape's Undo brings the one it
replaced back, as a GRAB is one edit of its own. With `clip`, it takes that
clip's span again from other inputs, its window and shape carrying on. The
drawer's edits (`PATCH /api/tapes/cue/clip`: `CueTrim`, inside the handles
as the buffer's trim is; `CueShape`: level, fades, Normalize, Reverse) are
edits of the tape, a run of trims or of levels one Undo; Reverse and
Normalize do their file work first, and they and a GRAB taken again are
refused (409) if the clip moved meanwhile; a window and a shape go in one
request each. `CueDrop` (`POST /api/tapes/cue/drop`) lays the clip as a drop lays the
clipboard, a lane a track from the one given (`merge`: all on that one),
handles and all, over what was there, and marks it touched in the same
edit; a drag (`cue-to-track`) of a clip with lanes is a merged drop on the
track it points at;
`CueKeep` (`POST /api/tapes/cue/keep`) saves it as a take of its window
summed; `CueAudio` (`GET /api/tapes/cue/audio`) is its Audition. All of
them read the clip as a board (`CueClip.boardOf`), so they are the buffer's
own code, and none of them touches the clipboard, which is left to a
range's Cut, Copy and Paste, unseen (`POST /api/clipboard` still takes the
old buffer's GRAB, which nothing in the web sends; `docs/plan/backlog.md`).
Launching one is a
performance, like the tape's pads, so it stays out of the state and out of
undo (`cuelive.go`): a launch or stop rides the transport's action queue
with quantum `bar` (`now` for Shift), and the render goroutine keeps the
voices, rendering each from the output frame it started at, looped, its
lanes summed, into bus A after the tape, the click and the FX. A voice stops with a 3 ms fade; the
transport's Stop and a mixdown's pass stop them all, and the lane's Solo
leaves the tracks out of the output. What plays is `live.cue`. The lane is
not in the mix or its exports: a clip reaches them only once it is dragged
onto a track.

**The verbs** -- KEEP, GRAB, DROP, CATCH and the transport -- are one set
on the Pi, whatever surface presses them (`internal/api/verbs.go`, `Verbs`,
`a.Verbs()`). The tablet's routes (`POST /api/trigger`,
`/api/tapes/transport`, `/api/tapes/catch`, `/api/tapes/cue/grab`, `drop`
and `keep`) and a controller's pads (`piVerbs` in `controls.go`, the
SMK-37's included) call the same methods, so a press refuses for the same
reasons with the same errors: the routes answer them as statuses
(`verbErr`), the keyboard's banner names them (`banner.go`, `refusals`).
The tablet says what it wants in full: which clip, which track, where. A
pad presses its verb bare, and Verbs works it out as the Studio's keys do:
`CatchArmed` catches the last pass onto every armed track, each from its
own input (`armedPairs`), layered or replacing as `controls.json` says;
`GrabArmed` takes the last N bars (2N seconds with no tempo) from the first
armed track's input; `DropArmed` lays the cue lane's newest clip on the
first armed track (moved up so all its lanes fit) at `tape.DropPlace`: the
next bar line inside the loop, over what is there, never refused for room.
The page's DROP key shows where before it is pressed, so it works that out
too (`lib/buffer/model.js`, `dropPlace`); `dropplace_test.go` holds that
file's cases, and the two must agree. A change to a verb goes in `Verbs`,
never in a route or in `piVerbs`.

**On screen** the lane's clips are pads (`lib/tape/cuelane.js`, on
`CUE_PRESS`, `lib/ui/press.js`): a tap launches, ⇧-tap at once, a hold (a
mouse's too, or a right click) says `hindsight:cue-select`, and a drag puts
the clip on a track; a pad has no keys on it. While a pad waits for its bar
line the hand on its dial goes round the bar, turned on the shared ticker
from the playhead (`heardNow`) and parked when nothing waits; a pad new to
the lane comes in peeled off the feed above it (`cue-peel`, a fade with
reduced motion). The drawer is the buffer's code (`lib/buffer/buffer.js`)
reading the open clip as a board (`lib/buffer/cueclip.js` `boardOf`):
mounted in the dock above the bar (`ctx.dockSlot`; a sheet over the lanes on
a phone), opened by GRAB on the clip it made and by a held pad, on the
page's stack as a drawer (Escape, Back and ✕ close it), and gone when its
clip leaves the lane. It says which clip it is open on with
`hindsight:cue-selected`, which lights the pad, and every change it sends
(`lib/buffer/api.js`) answers the tape's state and asks the page to poll
(`hindsight:tape-changed`). GRAB made away from the Studio (a take's page, a
note, the bar's feed) leaves the clip's id in sessionStorage
(`lib/buffer/replaced.js` `remember`), and the Studio opens on it once
(`recallNote`), with its Undo when it took an untouched clip's place.

**The feed strip** in the Studio is the ribbon with GRAB, KEEP and Flag in
one row. A tap on GRAB or KEEP takes the last length and its ▾ picks
another (1, 2, 4 or 8 bars for GRAB; 30 s, 2 m or the whole feed for KEEP);
the input follows the armed track's, with an override in GRAB's ▾. The
readouts (free disk, dropped buffers, the MIDI tempo, *Input channels*)
are in a sheet behind the strip's lamp, which lights when something is
wrong, with a link to the Rig. ● Phone shows on the strip only while it
records.

**The track heads** (`lib/tape/page.js` `buildLanes`; `styles.css`, *The
heads on a touch screen*) are each track's name, ●, input chip, M, S and
level. On a touch screen (`(pointer: coarse)`) the head keeps what a jam
needs: the name, ● a finger wide (44 px), the input chip, and › at its end,
which opens the track's inspector in one tap, on that track, armed or not,
moving no arm. M, S and the level are at the top of the inspector
(`#track-mute`, `#track-solo`, `#track-gain`), and › is lit yellow or blue
while the track is muted or soloed (`data-heard`), so a head with neither
key still says so. With a mouse M, S and the level stay in the head, and
there's no ›. The inspector moves to the record track when the arm moves
(`sheetRec`), not on every render: it once went back to the armed track
under a finger that had opened another's. On a tablet the Studio holds a
budget at rest, checked by J1.16 (`scripts/flows/layout.mjs`,
`STUDIO_BUDGET`): at most 44 controls on the screen (43 at 1024×768, and
the brand at 1280), 1 under 32 px (the sections' strip), every ● 44 px or
more, and all four tracks above the bar. The review of 2026-10-22 counted
65, 30 and 1½; just before the heads it was 51 and 27. The budget's numbers only go down.

The page is `web/static/lib/tape/`. It polls `GET /api/tapes/state` five
times a second, draws the lanes from each pool file's peaks, and sends what
you tap; the Pi holds all the state, so several devices stay in step.
