# The OP-1 Field's tape, and what Hindsight takes from it

**Date:** 2026-10-03 · **Status:** reference and design input · **Repo:** `hindsight`

What the OP-1 Field's tape actually does, from Teenage Engineering's own
guides, changelog and product page, checked against reviews. Then, for each
part, whether Hindsight adopts it, adapts it or skips it, and where that lands
in the [tape design](2026-10-03-tape-design.md) and the
[editing model](2026-10-03-editing-model-design.md).

TE's web guide renders mostly as diagrams, so the facts come from the PDF guides
for firmware 1.7.0 and earlier, the firmware changelog, and TE's 1.7.0 post.
Anything only users report is marked *(users)*, and anything that's original-OP-1
behaviour not confirmed on the Field is marked *(original)*. Sources are listed
at the end.

## How the OP-1 Field's tape works

### Shape

- **Four stereo tracks, six minutes each at normal speed, 32-bit.** Up to eight
  tapes live in memory and switch instantly. [G17][G22][PP]
- **44.1 kHz** *(users)*. The tape folder accepts 44.1 kHz 32-bit integer WAVs
  and rejects float. [F-WAV]
- **Four tape styles,** chosen per tape: studio, vintage, porta and disc mini.
  They're named for reference machines, from 15 in/s studio tape down to
  cassette and a compressed minidisc-like style. The style is applied as you
  record and can't be changed afterwards *(users)*. [G22][SOS][F-STY]
- **Length is time at normal speed.** Slowing the tape down records more
  real time onto the same six minutes. [G17][F-LOW]

### Recording

- **The flow:** pick a sound, pick a track, set the record level, then hold
  record and play. [G17]
  - **Arm:** recording can be armed without moving the tape, and play starts
    it. [G17] External MIDI can start an armed recording. [CL 1.4.2]
  - **Count-in:** play while armed gives a count-in at the current tempo
    (added 1.6.0, and it can be turned off). [G17][CL]
- **Sources:** whatever the OP-1 is playing, or the selected input: mic or line,
  FM radio, USB audio, or its own output resampled. [G17]
- **Always overdubs.** Recording onto existing audio sums with it. There is no
  replace mode and no erase head; the advice is to lift what's there first.
  [O-TAPE][F-GQ]
- **Punch** by holding record while the tape plays *(users)*. [F-ARM]
- **Looping while recording** overdubs again on every pass. Users work around
  it with timed releases or blank steps; it's one of the common complaints.
  [F-OD]
- **Only the record level and the record pan are printed.** Track level, pan,
  EQ, master FX and drive are all applied after the tape, at playback. [G17][SYN]

### Transport

- **Play, stop and record** are always available. The arrows rewind and
  fast-forward; shift plus arrows jumps between beat markers (and sends song
  position since 1.7.0). [G17][CL]
- **Scrubbing** is done with an encoder. Clicking it lifts the tape head, for
  silent scrubbing. [G17][CL 1.2.5] Reviewers single out how analogue the
  shuttle feels. [SOS]
- **Varispeed:** tape speed moves pitch and time together, as on a real tape
  machine, and can be changed while playing or recording. [G17][SOS] Play in
  reverse is on the shift layer. [G17]

### Loop, grid and tempo

- **Loop keys:** loop in and loop out are set at the tape head, and a third key
  toggles the loop. Both points can be fine-tuned. [G17]
- **The loop is also the edit range:** *lift all* takes all four tracks inside
  the active loop. [G17]
- **A tempo grid lies over the tape,** at a resolution from one bar down to
  8ths. [G17] Tempo and sync settings are saved with each tape. [PP]
- **Measuring a loop's tempo:** since 1.7.0, holding shift shows a free
  loop's BPM, so you can measure a loop and set the tempo from it. The
  metronome can also be aligned to the tape. [CL]

### Editing

- **Lift and drop are cut and paste.** Lift removes a take into the
  clipboard. Drop places the clipboard at the tape head, and the head moves to
  the end of what was dropped, so pressing drop again lays copies end to end
  *(original)*. Drop most likely replaces what's underneath *(users)*.
  [G17][O-TAPE][F-NOOB]
- **Split** cuts a take at the head; **join** merges two neighbouring takes on a
  track; **slide** moves a take along its track. [G17]
- **One clipboard.**
  - It holds one take, or all four tracks after *lift all*.
  - It survives power-off and drops across tracks and tapes.
  - Lift length has been unlimited since 1.2.5.
  - *Merge drop* puts a four-track clipboard onto one track, mixed at the
    clipboard's own levels. [G17][CL 1.2.5, 1.5.0, 1.5.6, 1.6.2]
- **Crossfades on every lift and drop** since 1.6.0. Before that, clicks at edit
  points were a standing complaint. [CL][F-ARR]
- **Lift to sampler** puts tape audio into the synth or drum sampler. [O-TAPE][CL]
- **Undo:** seven steps of undo and redo, added in 1.7.0, fifteen years after
  the original OP-1 shipped without it. TE's reason for the long wait was
  staying true to the feel of recording on a home four-track. [NOW][MRU]

### Tape tricks

Tape mode turns eight keys into momentary tricks, active while held. [G17][SOS]

| Trick | What it does |
|---|---|
| Loop in · loop out · loop on/off | Sets the loop points and toggles the loop |
| **Break** | Stops the tape. An active loop keeps running underneath, so the break comes back in time *(original)*. Tape styles slow down to the stop; disc mini cuts almost at once *(users)* |
| **Reverse** | Runs the tape backwards |
| **Chop** | A tempo-locked repeat |
| **Memo 1, memo 2** | Store sets of parameters; pressing both blends the two *(original)* |

The tricks shape playback; nothing is printed to the tracks. Only a mixdown
captures them.

### Mixer, mixdown and export

- **The mixer** has per-track level, pan and mute, and holding a track key
  solos it. Master EQ, master FX and drive sit after the tape. The mixer is
  saved per tape (1.2.5). [G17][CL]
- **Mixdown** records the master output in real time, FX included, into two
  six-minute slots. [G17]
- **Over USB:**
  - Export gives the four tracks as separate WAVs, trimmed to their recorded
    length since 1.7.0.
  - WAV import onto the tape creates a clip (1.7.0).
  - Since 1.6.0, USB audio carries the four tape tracks and the master live,
    as stems. [G17][CL]

### Sync

- **Sync modes:** free, beat match (the OP-1 as clock master), and MIDI sync.
  [G17]
- **Following an external clock varies the tape speed** to match it. Pitch
  follows tempo; there's no time-stretch. [G17][CL 1.3.2]
- **It sends clock, transport and song position**, so other gear can chase
  the tape. [SOS][CL 1.7.0]

### What people do with it, and what they complain about

**Workflows**

- Start from a four-bar loop and build it up across the four tracks. [F-NOOB]
- Lift and drop a safety copy before an overdub, then drop it back over a bad
  take. [F-UNDO]
- Keep different loop lengths on different tracks. [TIPS]
- Record in from outside, loop parts out, resample, and finish with a mixdown.
  [CDM]
- Many treat the tape as a sketchpad and finish in a DAW. [SINE][GNR]

**Complaints**

- No undo before 1.7, and no quantising. [MR][GNR]
- Overdub-only recording, and loop recording that overdubs every pass. [F-OD]
- Clicks at edits before 1.6. [F-ARR]
- Tape style can't be changed once printed. [F-STY]
- Holding a track key to select it also solos it, cutting the audio. [F-ARM]

## What Hindsight takes from it

The OP-1's tape works because a few strong ideas carry everything: a
fixed-shape tape, one clipboard, the loop doubling as the edit range, the mix
staying off the tape, and tricks that are momentary. Hindsight's starting point
differs in three ways that change how each idea lands. It records
*retroactively* from the ring. Its tape lives on a computer with cheap disk and
non-destructive edits. And it's played from a phone, not a keyboard with
encoders.

| OP-1 | Hindsight | Why |
|---|---|---|
| 4 stereo tracks | **Adopt** | Four keeps the phone page readable and forces decisions. Eight stays a config value |
| Six minutes a track | **Adapt:** no hard length. The overview shows the used length plus room | The limit exists to fit memory; on an SSD it's only a constraint |
| Eight tapes, switched instantly, saved with their mix and tempo | **Adopt,** as the tape browser. Plus **clone**, which costs nothing here because audio files are shared | Clone is the OP-1's own safety-copy habit made free |
| Loop in, loop out, loop on/off | **Adopt everywhere.** *In* and *Out* are the selection on the ribbon, on a take and on a tape; *Loop* is a separate toggle | Today the take page's region forces a loop; separating them fixes the "region traps playback" problem |
| The loop is the edit range | **Adopt.** Copy, lift and save act on the selection | One concept instead of two |
| Lift, drop, split, join, slide; one persistent clipboard; drop advances the head | **Adopt** as the tape's editing verbs, and the clipboard spans the whole app | Drop-drop-drop to lay a loop end to end is the fastest arrangement gesture there is. Copying on a take page and dropping on a tape is *Send to tape* |
| Lift all, merge drop | **Adopt** | Multi-track clipboard; merge drop is a cheap bounce |
| Drop replaces | **Adopt** for drop; overdub stays the rule for *recording* | Same split as the OP-1 |
| Crossfades on every edit | **Adopt:** a 5 ms crossfade wherever audio meets audio on a track, drops end to end included, and a 3 ms fade only beside silence | The OP-1 learned this the hard way |
| Always overdub; loop recording overdubs every pass | **Adapt.** Layers sum, as on the OP-1, but every pass is kept separately and you choose. *Replace* exists | Passes answer the OP-1's commonest tape complaint directly |
| Arm, count-in, hold to punch | **Adopt** arm and count-in. Hold-to-punch goes to the **pedal**: holding a phone button while playing doesn't work | Hands are on the instrument |
| Record level and pan printed; mix after the tape | **Adopt,** and go further: only what the source sent is fixed. A layer's gain, the track mix and the strips' FX are all playback settings | Matches the OP-1 and keeps everything changeable |
| Tape tricks: break, reverse, chop, memo | **Adopt** as momentary *trick pads* on the tape page and on MIDI. They're quantized to the next 16th, because a phone on Wi-Fi is late. Break keeps the loop running underneath. Memo becomes mix memos | The most performative part of the OP-1. Quantizing turns network latency into "in time" |
| Varispeed and reverse | **Adopt** tape speed as a whole-tape playback control, with pitch and time together; reverse per clip and as a trick | Real tape character, cheap to render |
| Tape styles printed at record time | **Adapt:** a non-destructive tape style per tape — wow, flutter, saturation, hiss, bandwidth — applied at playback, printed only by a bounce | Nothing here needs to be printed early |
| Silent scrub with an encoder | **Adopt** silent scrub by dragging the playhead's handle on the ruler. **Skip** audible scrub for now: a quarter-second render pipeline makes it feel laggy | Honest about latency |
| Tempo grid from 1 bar to 8ths | **Adopt** as the snap resolution, on takes with a BPM and on tapes | Snapping was deferred twice in earlier specs |
| Loop BPM readout | **Already designed:** a free first loop sets the tempo | Same idea, arrived at independently |
| Free / beat match / MIDI sync; tape follows external clock by varispeed | **Adopt.** *Lead* is beat match. *Follow* now tracks the external clock by tiny speed changes instead of jumps, as the OP-1 does | Better than re-anchoring once a loop: no jumps, and drift becomes inaudible |
| Sends clock, transport, song position | **Adopt** in lead mode, plus song position on jumps | Lets the Bento chase the tape |
| Mixdown: real-time capture of the master | **Adopt for free.** Hindsight is already recording MAIN. *Mixdown* plays the tape's selection once and saves exactly that span as a take, with the tape's tempo in its `.mid` | The dashcam is the mixdown recorder |
| Export four stems trimmed to their length; import WAV as a clip | **Adopt** (tape export; phone recordings and takes import as clips) | |
| Live stems over USB | **Skip** | The Pi isn't feeding a computer |
| Lift to sampler | **Skip**, and offer **share a clip as WAV** (tape phase 2) instead | The MPC and Bento have their own samplers and import paths |
| Seven undo steps; TE's commit-to-tape philosophy | **Adapt:** a hundred steps, because the model is non-destructive anyway. The commit-to-tape spirit lives on in four tracks, one clipboard, and passes you choose rather than endless takes | The constraint worth keeping is focus, not fear |
| Holding a track key solos it | **Adapt:** solo is its own button. Tapping a track header only selects it | Fixes a complaint the OP-1 still has |

### Vocabulary

The tape design used *lift* for "copy a span of the ring onto a track". On
the OP-1, *lift* means cut to the clipboard, and anyone who has used one will
read it that way. So the ring operation is renamed **catch** ("catch the last
4 bars onto track 2", "catch pass −3"), and *lift* and *drop* keep their OP-1
meanings. The full glossary is in the editing model.

## Sources

**Teenage Engineering**

| Tag | Source |
|---|---|
| [G17] | OP-1 field guide, firmware 1.7.0, https://assets.teenage.engineering/_img/69f248938d433104c4dd1846_original.pdf |
| [G22] | OP-1 field launch guide, https://teenage.engineering/_img/6275254dfb267f0004b9e832_original.pdf |
| [CL] | Firmware changelog, https://teenage.engineering/downloads/op-1/field |
| [PP] | Product page, https://teenage.engineering/products/op-1 |
| [NOW] | TE, OP–1 OS 1.7.0 post, https://teenage.engineering/now |
| [O-TAPE] | Original OP-1 guide, tape, https://teenage.engineering/guides/op-1/original/tape-mode |

**Reviews**

| Tag | Source |
|---|---|
| [SOS] | Sound On Sound review, https://www.soundonsound.com/reviews/teenage-engineering-op-1-field |
| [MR] | MusicRadar review, https://www.musicradar.com/reviews/teenage-engineering-op-1-field |
| [MRU] | MusicRadar on undo, https://www.musicradar.com/music-tech/the-teenage-engineering-op-1-field-finally-gets-undo |
| [GNR] | Gearnews review, https://www.gearnews.com/teenage-engineering-op-1-field-review/ |
| [CDM] | CDM, Andreas Roman, https://cdm.link/teenage-engineering-op-1-field-review-album/ |
| [SYN] | Synthtopia on 1.3.2, https://www.synthtopia.com/content/2022/11/18/teenage-engineering-updates-op-1-field-with-velocity-sensitivity-more/ |
| [SINE] | Sinesquares review, https://www.sinesquares.net/musicgear/teenage-engineering-op-1-field-hands-on-review |

**Users** (op-forums.com/t/…)

| Tag | Path |
|---|---|
| [F-OD] | deactivate-overdub-after-one-loop/23316 |
| [F-ARM] | live-looping-tips-record-arming-and-track-switching/22739 |
| [F-GQ] | op1-field-general-and-specific-questions/24447 |
| [F-NOOB] | op-1-field-total-n00b-questions-tape-presets-sequencers/22378 |
| [F-STY] | how-do-you-like-the-tape-emulation-of-op1f/28390 |
| [F-WAV] | unable-to-copy-file-to-tape-using-mtp-on-macos/22624 |
| [F-ARR] | op1-field-for-assembling-and-arranging-audio-clips-reality-check-please/25011 |
| [F-UNDO] | undo-in-tape-mode/2996 |
| [F-LOW] | low-tape-speed-24-min-mode/1293 |

[TIPS] is a tips digest for the original OP-1, https://github.com/ratbag98/op1tips.

**Not settled by any source:** which operations the Field's undo covers;
whether loop points snap to the grid; the exact tape-speed range; and whether
drop always replaces. None of these changes a decision above.
